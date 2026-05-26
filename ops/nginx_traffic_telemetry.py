#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - only used on Unix production targets.
    fcntl = None


COMBINED_LOG_RE = re.compile(
    r'^(?P<remote>\S+) \S+ \S+ \[(?P<timestamp>[^\]]+)\] "(?P<request>[^"]*)" (?P<status>\d{3}) (?P<body_bytes>\S+) "(?P<referer>[^"]*)" "(?P<user_agent>[^"]*)"$'
)

DEFAULT_SUSPICIOUS_PATH_PATTERNS = [
    r"/wp-admin",
    r"/wp-login",
    r"/xmlrpc\.php",
    r"/phpmyadmin",
    r"/boaform",
    r"/cgi-bin",
    r"/\.env",
    r"/\.git",
    r"/vendor/phpunit",
    r"/server-status",
    r"/actuator",
    r"/owa/",
]

DEFAULT_SUSPICIOUS_UA_PATTERNS = [
    r"sqlmap",
    r"nikto",
    r"masscan",
    r"nmap",
    r"acunetix",
    r"nessus",
    r"python-requests",
    r"go-http-client",
    r"curl/",
    r"wget",
    r"httpx",
]


@dataclass
class CollectorState:
    inode: int | None = None
    offset: int = 0


@dataclass
class TrafficCounts:
    request_count: int = 0
    error_count: int = 0
    suspicious_count: int = 0

    def to_payload(self, window_minutes: int, source: str) -> dict[str, int | str]:
        return {
            "request_count": self.request_count,
            "error_count": self.error_count,
            "suspicious_count": self.suspicious_count,
            "window_minutes": window_minutes,
            "source": source,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggregate nginx access log traffic and POST a Status Beacon telemetry sample.",
    )
    parser.add_argument("--log-file", required=True, help="Path to the nginx access log file.")
    parser.add_argument("--ingest-url", required=True, help="Status Beacon telemetry endpoint URL.")
    parser.add_argument(
        "--state-file",
        default="/var/lib/status-beacon/nginx-traffic-telemetry.state.json",
        help="JSON file used to persist the processed inode and byte offset.",
    )
    parser.add_argument(
        "--lock-file",
        default="/var/run/status-beacon-nginx-traffic-telemetry.lock",
        help="Lock file path to prevent overlapping runs.",
    )
    parser.add_argument(
        "--window-minutes",
        type=int,
        default=1,
        help="Aggregation window to report in the telemetry payload.",
    )
    parser.add_argument(
        "--source",
        default="nginx-access-log",
        help="Source label stored with the telemetry sample.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=10,
        help="HTTP timeout for the ingest POST request.",
    )
    parser.add_argument(
        "--error-status-threshold",
        type=int,
        default=500,
        help="Count responses with status >= this value as errors.",
    )
    parser.add_argument(
        "--emit-zero-samples",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Send a zero-value sample even when no new log lines were observed.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the payload instead of POSTing it.",
    )
    return parser.parse_args()


def compile_patterns(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]


def load_state(path: Path) -> CollectorState:
    if not path.exists():
        return CollectorState()

    data = json.loads(path.read_text(encoding="utf-8"))
    return CollectorState(inode=data.get("inode"), offset=data.get("offset", 0))


def save_state(path: Path, state: CollectorState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"inode": state.inode, "offset": state.offset}), encoding="utf-8")


def extract_request_path(request_value: str) -> str:
    parts = request_value.split()
    if len(parts) < 2:
        return ""
    return parts[1]


def parse_access_line(line: str) -> tuple[int, str, str] | None:
    match = COMBINED_LOG_RE.match(line.strip())
    if not match:
        return None

    status = int(match.group("status"))
    request_path = extract_request_path(match.group("request"))
    user_agent = match.group("user_agent")
    return status, request_path, user_agent


def collect_counts(
    log_file: Path,
    previous_state: CollectorState,
    suspicious_path_patterns: list[re.Pattern[str]],
    suspicious_ua_patterns: list[re.Pattern[str]],
    error_status_threshold: int,
) -> tuple[TrafficCounts, CollectorState]:
    counts = TrafficCounts()

    with log_file.open("rb") as handle:
        stat_result = os.fstat(handle.fileno())
        start_offset = previous_state.offset
        if previous_state.inode != stat_result.st_ino or previous_state.offset > stat_result.st_size:
            start_offset = 0

        handle.seek(start_offset)
        next_state = CollectorState(inode=stat_result.st_ino, offset=start_offset)

        while True:
            raw_line = handle.readline()
            if not raw_line:
                break

            next_state.offset = handle.tell()
            parsed = parse_access_line(raw_line.decode("utf-8", errors="replace"))
            if parsed is None:
                continue

            status, request_path, user_agent = parsed
            counts.request_count += 1

            if status >= error_status_threshold:
                counts.error_count += 1

            if any(pattern.search(request_path) for pattern in suspicious_path_patterns) or any(
                pattern.search(user_agent) for pattern in suspicious_ua_patterns
            ):
                counts.suspicious_count += 1

    return counts, next_state


def post_payload(ingest_url: str, payload: dict[str, int | str], timeout_seconds: int) -> None:
    request = urllib.request.Request(
        ingest_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Status Beacon ingest failed with HTTP {response.status}")


class FileLock:
    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self) -> "FileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("w", encoding="utf-8")
        if fcntl is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.handle is None:
            return
        if fcntl is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


def main() -> int:
    args = parse_args()
    log_file = Path(args.log_file)
    state_file = Path(args.state_file)
    lock_file = Path(args.lock_file)

    if args.window_minutes <= 0 or args.window_minutes > 60:
        print("window_minutes must be between 1 and 60", file=sys.stderr)
        return 2

    if not log_file.exists():
        print(f"Log file not found: {log_file}", file=sys.stderr)
        return 2

    suspicious_path_patterns = compile_patterns(DEFAULT_SUSPICIOUS_PATH_PATTERNS)
    suspicious_ua_patterns = compile_patterns(DEFAULT_SUSPICIOUS_UA_PATTERNS)

    try:
        with FileLock(lock_file):
            previous_state = load_state(state_file)
            counts, next_state = collect_counts(
                log_file=log_file,
                previous_state=previous_state,
                suspicious_path_patterns=suspicious_path_patterns,
                suspicious_ua_patterns=suspicious_ua_patterns,
                error_status_threshold=args.error_status_threshold,
            )

            if counts.request_count == 0 and not args.emit_zero_samples:
                return 0

            payload = counts.to_payload(window_minutes=args.window_minutes, source=args.source)
            if args.dry_run:
                print(json.dumps(payload, indent=2))
                return 0

            post_payload(args.ingest_url, payload, args.timeout_seconds)
            save_state(state_file, next_state)
            print(json.dumps(payload))
            return 0
    except BlockingIOError:
        print("Another nginx telemetry collector process is already running.", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"Failed to send telemetry sample: {error}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as error:
        print(f"Invalid state file JSON: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())