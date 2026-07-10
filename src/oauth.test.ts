import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { FileClientsStore, ZyroOAuthProvider } from "./oauth.js";

const secret = new TextEncoder().encode("test-secret");
const CONSENT = "http://front/consent";

function tmpFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "zyro-test-"));
  return { file: join(dir, "clients.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeToken(payload: Record<string, unknown> = { userId: "u1" }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
}

function register(store: FileClientsStore) {
  return store.registerClient({
    redirect_uris: ["http://cb"],
    token_endpoint_auth_method: "none",
  } as any);
}

test("FileClientsStore persists registrations across instances", () => {
  const { file, cleanup } = tmpFile();
  try {
    const client = register(new FileClientsStore(file));
    assert.ok(client.client_id);
    assert.ok(client.client_id_issued_at);

    const reloaded = new FileClientsStore(file).getClient(client.client_id);
    assert.equal(reloaded?.client_id, client.client_id);
    assert.deepEqual(reloaded?.redirect_uris, ["http://cb"]);
  } finally {
    cleanup();
  }
});

test("FileClientsStore tolerates a missing or corrupt file", () => {
  assert.equal(
    new FileClientsStore(join(tmpdir(), "zyro-nope", "missing.json")).getClient("x"),
    undefined,
  );
  const { file, cleanup } = tmpFile();
  try {
    writeFileSync(file, "not json");
    assert.equal(new FileClientsStore(file).getClient("x"), undefined);
  } finally {
    cleanup();
  }
});

test("authorize redirects to the consent page carrying the OAuth params", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    let redirectedTo = "";
    const res = { redirect: (url: string) => (redirectedTo = url) } as any;

    await p.authorize(
      { client_id: "c1", redirect_uris: ["http://cb"] } as any,
      { redirectUri: "http://cb", codeChallenge: "chal", scopes: ["listings:write"], state: "s" } as any,
      res,
    );

    const u = new URL(redirectedTo);
    assert.equal(u.origin + u.pathname, CONSENT);
    assert.equal(u.searchParams.get("client_id"), "c1");
    assert.equal(u.searchParams.get("redirect_uri"), "http://cb");
    assert.equal(u.searchParams.get("code_challenge"), "chal");
    assert.equal(u.searchParams.get("state"), "s");
    assert.equal(u.searchParams.get("scope"), "listings:write");
  } finally {
    cleanup();
  }
});

test("completeConsent → exchangeAuthorizationCode issues the JWT once", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    const client = register(p.clientsStore);
    const token = await makeToken({ userId: "u1" });

    const redirectUrl = await p.completeConsent({
      clientId: client.client_id,
      redirectUri: "http://cb",
      state: "s",
      codeChallenge: "chal",
      accessToken: token,
    });
    assert.ok(redirectUrl);
    const code = new URL(redirectUrl!).searchParams.get("code")!;

    assert.equal(await p.challengeForAuthorizationCode(client, code), "chal");

    const tokens = await p.exchangeAuthorizationCode(client, code);
    assert.equal(tokens.access_token, token);
    assert.equal(tokens.token_type, "Bearer");

    // single-use
    await assert.rejects(() => p.exchangeAuthorizationCode(client, code));
  } finally {
    cleanup();
  }
});

test("completeConsent rejects unknown client, bad redirect, invalid token", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    const client = register(p.clientsStore);
    const token = await makeToken();
    const base = { state: "", codeChallenge: "c" };

    assert.equal(
      await p.completeConsent({ ...base, clientId: "nope", redirectUri: "http://cb", accessToken: token }),
      null,
    );
    assert.equal(
      await p.completeConsent({ ...base, clientId: client.client_id, redirectUri: "http://evil", accessToken: token }),
      null,
    );
    assert.equal(
      await p.completeConsent({ ...base, clientId: client.client_id, redirectUri: "http://cb", accessToken: "bad.token" }),
      null,
    );
  } finally {
    cleanup();
  }
});

test("verifyAccessToken exposes the userId from the JWT", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    const token = await makeToken({ userId: "user-42" });
    const info = await p.verifyAccessToken(token);
    assert.equal(info.extra?.userId, "user-42");
    assert.equal(info.token, token);
  } finally {
    cleanup();
  }
});

test("exchangeRefreshToken throws when no refresh function is configured", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    await assert.rejects(() => p.exchangeRefreshToken({} as any, "some-token"));
  } finally {
    cleanup();
  }
});

test("exchangeRefreshToken relays to the grant refresher and returns rotated tokens", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const calls: string[] = [];
    const refreshGrant = async (rt: string) => {
      calls.push(rt);
      return { accessToken: "new-access", refreshToken: "rotated-refresh" };
    };
    const p = new ZyroOAuthProvider(secret, CONSENT, file, refreshGrant);

    const tokens = await p.exchangeRefreshToken({} as any, "old-refresh");
    assert.deepEqual(calls, ["old-refresh"]);
    assert.equal(tokens.access_token, "new-access");
    assert.equal(tokens.refresh_token, "rotated-refresh");
    assert.equal(tokens.token_type, "Bearer");
  } finally {
    cleanup();
  }
});

test("exchangeRefreshToken rejects when the refresher returns null", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file, async () => null);
    await assert.rejects(() => p.exchangeRefreshToken({} as any, "bad"));
  } finally {
    cleanup();
  }
});

test("exchangeAuthorizationCode returns the refresh token when consent issued one", async () => {
  const { file, cleanup } = tmpFile();
  try {
    const p = new ZyroOAuthProvider(secret, CONSENT, file);
    const client = register(p.clientsStore);
    const token = await makeToken();

    const redirectUrl = await p.completeConsent({
      clientId: client.client_id,
      redirectUri: "http://cb",
      state: "",
      codeChallenge: "chal",
      accessToken: token,
      refreshToken: "mcp-refresh",
    });
    const code = new URL(redirectUrl!).searchParams.get("code")!;

    const tokens = await p.exchangeAuthorizationCode(client, code);
    assert.equal(tokens.refresh_token, "mcp-refresh");
  } finally {
    cleanup();
  }
});
