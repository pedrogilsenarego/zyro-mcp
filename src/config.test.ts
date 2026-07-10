import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

const KEYS = [
  "IMOCERTO_JWT_SECRET",
  "PORT",
  "PUBLIC_URL",
  "IMOCERTO_API_BASE_URL",
  "FRONTEND_CONSENT_URL",
  "OAUTH_CLIENTS_PATH",
];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("loadConfig throws without IMOCERTO_JWT_SECRET", () => {
  withEnv({}, () => assert.throws(() => loadConfig(), /IMOCERTO_JWT_SECRET/));
});

test("loadConfig applies defaults", () => {
  withEnv({ IMOCERTO_JWT_SECRET: "s" }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.jwtSecret, "s");
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.clientsStorePath, "./data/oauth-clients.json");
    assert.match(cfg.publicUrl, /8080/);
    assert.match(cfg.apiBaseUrl, /\/api$/);
  });
});

test("loadConfig strips trailing slashes and honors overrides", () => {
  withEnv(
    { IMOCERTO_JWT_SECRET: "s", IMOCERTO_API_BASE_URL: "http://be:9/api/", PORT: "9999" },
    () => {
      const cfg = loadConfig();
      assert.equal(cfg.apiBaseUrl, "http://be:9/api");
      assert.equal(cfg.port, 9999);
    },
  );
});

test("loadConfig throws on an invalid PORT", () => {
  withEnv({ IMOCERTO_JWT_SECRET: "s", PORT: "abc" }, () =>
    assert.throws(() => loadConfig(), /PORT/),
  );
});
