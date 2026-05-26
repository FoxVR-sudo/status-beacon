from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any


TLS_BASELINE_FIELDS = (
    "hostname",
    "subject",
    "issuer",
    "serial_number",
    "subject_alt_names",
    "certificate_sha256",
    "public_key_pin_sha256",
    "not_before",
    "not_after",
)


def build_tls_baseline_snapshot(report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(report, dict) or not report.get("applicable") or not report.get("valid"):
        return None

    snapshot: dict[str, Any] = {"applicable": True, "valid": True}
    for field in TLS_BASELINE_FIELDS:
        value = report.get(field)
        if value is not None:
            snapshot[field] = deepcopy(value)
    return snapshot


def annotate_tls_report(
    report: dict[str, Any] | None,
    tls_baseline: dict[str, Any] | None,
    approved_at: datetime | None,
) -> dict[str, Any] | None:
    if not isinstance(report, dict):
        return report

    annotated = deepcopy(report)
    baseline = tls_baseline if isinstance(tls_baseline, dict) and tls_baseline else None

    annotated["baseline_available"] = bool(baseline)
    annotated["baseline_pending_approval"] = bool(
        annotated.get("applicable") and annotated.get("valid") and not baseline
    )
    annotated["baseline_approved_at"] = approved_at.isoformat() if approved_at else None

    if not annotated.get("applicable") or not annotated.get("valid"):
        annotated["changed_certificate"] = False
        annotated["changed_public_key"] = False
        return annotated

    if not baseline:
        annotated["changed_certificate"] = False
        annotated["changed_public_key"] = False
        return annotated

    baseline_cert = baseline.get("certificate_sha256")
    baseline_pin = baseline.get("public_key_pin_sha256")
    current_cert = annotated.get("certificate_sha256")
    current_pin = annotated.get("public_key_pin_sha256")

    annotated["changed_certificate"] = bool(
        baseline_cert and current_cert and baseline_cert != current_cert
    )
    annotated["changed_public_key"] = bool(
        baseline_pin and current_pin and baseline_pin != current_pin
    )
    return annotated