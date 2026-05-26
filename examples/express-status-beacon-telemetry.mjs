const DEFAULT_SUSPICIOUS_PATH_PATTERNS = [
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/xmlrpc\.php/i,
  /\/phpmyadmin/i,
  /\/boaform/i,
  /\/cgi-bin/i,
  /\/\.env/i,
  /\/\.git/i,
  /\/vendor\/phpunit/i,
  /\/server-status/i,
  /\/actuator/i,
  /\/owa\//i,
];

const DEFAULT_SUSPICIOUS_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /masscan/i,
  /nmap/i,
  /acunetix/i,
  /nessus/i,
  /python-requests/i,
  /go-http-client/i,
  /curl\//i,
  /wget/i,
  /httpx/i,
];

function shouldFlagSuspicious(req, pathPatterns, userAgentPatterns) {
  const pathname = String(req.path || req.originalUrl || "");
  const userAgent = String(req.headers["user-agent"] || "");
  return pathPatterns.some((pattern) => pattern.test(pathname)) || userAgentPatterns.some((pattern) => pattern.test(userAgent));
}

export function createStatusBeaconTelemetry(options) {
  if (!options?.ingestUrl) {
    throw new Error("createStatusBeaconTelemetry requires an ingestUrl option");
  }

  const windowMs = options.windowMs ?? 60_000;
  const source = options.source ?? "express-app";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const errorStatusThreshold = options.errorStatusThreshold ?? 500;
  const emitZeroSamples = options.emitZeroSamples ?? true;
  const pathPatterns = options.suspiciousPathPatterns ?? DEFAULT_SUSPICIOUS_PATH_PATTERNS;
  const userAgentPatterns = options.suspiciousUserAgentPatterns ?? DEFAULT_SUSPICIOUS_UA_PATTERNS;

  let counts = {
    request_count: 0,
    error_count: 0,
    suspicious_count: 0,
  };

  async function flush() {
    if (!emitZeroSamples && counts.request_count === 0) {
      return;
    }

    const payload = {
      ...counts,
      window_minutes: Math.max(1, Math.round(windowMs / 60_000)),
      source,
    };

    const currentCounts = counts;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(options.ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Status Beacon ingest failed with HTTP ${response.status}`);
      }

      if (counts === currentCounts) {
        counts = {
          request_count: 0,
          error_count: 0,
          suspicious_count: 0,
        };
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  const intervalHandle = setInterval(() => {
    flush().catch((error) => {
      console.error("status-beacon telemetry flush failed", error);
    });
  }, windowMs);

  if (typeof intervalHandle.unref === "function") {
    intervalHandle.unref();
  }

  function middleware(req, res, next) {
    counts.request_count += 1;
    if (shouldFlagSuspicious(req, pathPatterns, userAgentPatterns)) {
      counts.suspicious_count += 1;
    }

    res.on("finish", () => {
      if (res.statusCode >= errorStatusThreshold) {
        counts.error_count += 1;
      }
    });

    next();
  }

  async function shutdown() {
    clearInterval(intervalHandle);
    await flush();
  }

  function registerProcessHandlers() {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, async () => {
        try {
          await shutdown();
        } finally {
          process.exit(0);
        }
      });
    }
  }

  return {
    middleware,
    flush,
    shutdown,
    registerProcessHandlers,
  };
}

/*
Example usage:

import express from "express";
import { createStatusBeaconTelemetry } from "./express-status-beacon-telemetry.mjs";

const app = express();
const telemetry = createStatusBeaconTelemetry({
  ingestUrl: process.env.STATUS_BEACON_INGEST_URL,
  source: "my-production-app",
});

app.use(telemetry.middleware);
telemetry.registerProcessHandlers();
*/