const SUSPICIOUS_PATH_PATTERNS = [
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

const SUSPICIOUS_UA_PATTERNS = [
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

function nextMinuteBoundary(now = Date.now()) {
  return now + (60_000 - (now % 60_000));
}

function isSuspicious(pathname, userAgent) {
  return SUSPICIOUS_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) || SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}

async function getAggregatorStub(env) {
  const id = env.TELEMETRY_AGGREGATOR.idFromName("global");
  return env.TELEMETRY_AGGREGATOR.get(id);
}

export default {
  async fetch(request, env, ctx) {
    const inboundUrl = new URL(request.url);
    const targetUrl = new URL(request.url);
    targetUrl.protocol = "https:";
    targetUrl.host = env.ORIGIN_HOST;

    const originResponse = await fetch(new Request(targetUrl.toString(), request));

    const aggregator = await getAggregatorStub(env);
    ctx.waitUntil(
      aggregator.fetch("https://telemetry.internal/record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pathname: inboundUrl.pathname,
          userAgent: request.headers.get("user-agent") || "",
          status: originResponse.status,
        }),
      }),
    );

    return originResponse;
  },

  async scheduled(_event, env, ctx) {
    const aggregator = await getAggregatorStub(env);
    ctx.waitUntil(
      aggregator.fetch("https://telemetry.internal/flush", {
        method: "POST",
      }),
    );
  },
};

export class TelemetryAggregator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/record") {
      const payload = await request.json();
      const counts = (await this.state.storage.get("counts")) || {
        request_count: 0,
        error_count: 0,
        suspicious_count: 0,
      };

      counts.request_count += 1;
      if (Number(payload.status) >= 500) {
        counts.error_count += 1;
      }
      if (isSuspicious(String(payload.pathname || ""), String(payload.userAgent || ""))) {
        counts.suspicious_count += 1;
      }

      await this.state.storage.put("counts", counts);

      const existingAlarm = await this.state.storage.getAlarm();
      if (existingAlarm === null) {
        await this.state.storage.setAlarm(nextMinuteBoundary());
      }

      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/flush") {
      await this.flush();
      return new Response("flushed");
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.flush();
  }

  async flush() {
    const counts = (await this.state.storage.get("counts")) || {
      request_count: 0,
      error_count: 0,
      suspicious_count: 0,
    };

    const payload = {
      ...counts,
      window_minutes: 1,
      source: this.env.STATUS_BEACON_SOURCE || "cloudflare-worker",
    };

    const response = await fetch(this.env.STATUS_BEACON_INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Status Beacon ingest failed with HTTP ${response.status}`);
    }

    await this.state.storage.put("counts", {
      request_count: 0,
      error_count: 0,
      suspicious_count: 0,
    });
  }
}