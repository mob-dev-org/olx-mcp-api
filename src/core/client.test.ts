// Testovi zastita u jezgru: spend-guard (nista se ne naplacuje bez confirm), politika retry-a
// (429 se ponavlja, 401 i 5xx na naplati ne) i citanje konfiguracije jednog naloga.
// Mreza se ne dira: fetch je zamijenjen stubom koji broji pozive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OlxClient, OlxAuthError, OlxSpendError } from "./index.js";
import { loadConfig } from "./config.js";
import type { OlxConfig } from "./config.js";

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

interface StubReply {
  status: number;
  body?: unknown;
}

// Zamjenjuje globalni fetch redom pripremljenih odgovora i pamti sve pozive.
// Vraca listu poziva i funkciju za vracanje originalnog fetch-a.
function stubFetch(replies: StubReply[]): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let index = 0;

  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const reply = replies[Math.min(index, replies.length - 1)];
    index++;
    const status = reply?.status ?? 200;
    const text = reply?.body === undefined ? "" : JSON.stringify(reply.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  }) as unknown as typeof globalThis.fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

function testConfig(overrides: Partial<OlxConfig> = {}): OlxConfig {
  return {
    baseUrl: "https://api.example.test",
    token: "test-token",
    deviceName: "test",
    minRequestIntervalMs: 0,
    maxRetries: 1,
    timeoutMs: 5000,
    // Testovi nikad ne pisu audit log u fajl; sink se, gdje treba, injektuje kao funkcija.
    auditFile: ".olx-pik/test-audit.jsonl",
    auditReads: false,
    ...overrides,
  };
}

const PRICE_BODY = { search: 40, refresh: 20, locations: 0, extras: 0, total: 60 };

test("sponsorListing bez confirm baca OlxSpendError i ne salje POST", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: PRICE_BODY }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.sponsorListing(123, { type: 2, days: 7, refresh_every: 8 }, false),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError, "ocekivan OlxSpendError");
        assert.equal(err.price?.total, 60, "greska nosi cijenu da korisnik vidi trosak");
        return true;
      },
    );
    assert.equal(calls.length, 1, "smije se pozvati samo cijena");
    assert.equal(calls[0]?.method, "GET");
    assert.ok(calls[0]?.url.includes("/sponsore/price"), "pozvana je putanja cijene");
    assert.equal(
      calls.some((c) => c.method === "POST"),
      false,
      "nijedan POST na /sponsore bez confirm",
    );
  } finally {
    restore();
  }
});

test("sponsorListing sa confirm salje POST i ne ponavlja ga na 500", async () => {
  const { calls, restore } = stubFetch([{ status: 500, body: { message: "server" } }]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 3 }));
    await assert.rejects(() => client.sponsorListing(123, { type: 2, days: 7 }, true));
    assert.equal(calls.length, 1, "naplata se NE ponavlja na 5xx (moguca dupla naplata)");
    assert.equal(calls[0]?.method, "POST");
    // refresh_every je na API-ju obavezan, pa ga klijent uvijek posalje.
    assert.ok(calls[0]?.body?.includes('"refresh_every":0'));
  } finally {
    restore();
  }
});

test("setDiscount bez confirm baca OlxSpendError i ne dira mrezu", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: {} }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.setDiscount(123, { price: 10, days: 7 }, false),
      (err: unknown) => err instanceof OlxSpendError,
    );
    assert.equal(calls.length, 0, "akcijska cijena bez confirm ne salje nista");
  } finally {
    restore();
  }
});

test("createListing se ne ponavlja na 500 (duplikat oglasa)", async () => {
  const { calls, restore } = stubFetch([{ status: 500, body: { message: "server" } }]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 3 }));
    await assert.rejects(() => client.createListing({ title: "Test", category_id: 23 }));
    assert.equal(calls.length, 1, "POST /listings se ne ponavlja");
  } finally {
    restore();
  }
});

test("401 se ne ponavlja i daje OlxAuthError", async () => {
  const { calls, restore } = stubFetch([{ status: 401, body: { message: "unauthorized" } }]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 3 }));
    await assert.rejects(
      () => client.me(),
      (err: unknown) => err instanceof OlxAuthError,
    );
    assert.equal(calls.length, 1, "neispravan token se ne pokusava ponovo");
  } finally {
    restore();
  }
});

test("429 se ponavlja pa uspije", async () => {
  const { calls, restore } = stubFetch([
    { status: 429, body: { message: "too many" } },
    { status: 200, body: { data: { id: 1, username: "shop_test" } } },
  ]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 2 }));
    const me = await client.me();
    assert.equal(me.username, "shop_test", "envelope { data } se odvija");
    assert.equal(calls.length, 2, "429 se ponovi tacno jednom prije uspjeha");
  } finally {
    restore();
  }
});

test("obnova oglasa ide kao PUT na tacnu putanju", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { message: "ok" } }]);
  try {
    const client = new OlxClient(testConfig());
    await client.refreshListing(555);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "PUT");
    assert.ok(calls[0]?.url.endsWith("/listings/555/refresh"));
  } finally {
    restore();
  }
});

test("userProfile trazi username i odbija prazan unos", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { data: { id: 7, username: "primjer_shop", shop: { package: "Platinum" } } } }]);
  try {
    const client = new OlxClient(testConfig());
    const profile = await client.userProfile("primjer_shop");
    assert.equal(profile.shop?.package, "Platinum");
    assert.ok(calls[0]?.url.endsWith("/users/primjer_shop"));
    await assert.rejects(() => client.userProfile("  "), (err: unknown) => err instanceof OlxAuthError);
    assert.equal(calls.length, 1, "prazan username se odbija prije mreze");
  } finally {
    restore();
  }
});

test("loadConfig cita token iz okruzenja i skida kosu crtu sa base URL-a", () => {
  const config = loadConfig({
    OLX_BASE_URL: "https://api.primjer.test/",
    OLX_TOKEN: "token-klona",
  } as NodeJS.ProcessEnv);

  assert.equal(config.token, "token-klona");
  assert.equal(config.baseUrl, "https://api.primjer.test", "kosa crta na kraju bi napravila dvostruku // u putanji");
});

test("loadConfig ne izmislja token i ostaje na jednom nalogu", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.token, undefined, "bez OLX_TOKEN nema tokena, ne trazi se drugdje");
  assert.equal(config.baseUrl, "https://api.olx.ba");
  // Jedan klon radi za jedan nalog: u konfiguraciji ne postoji pojam profila.
  assert.equal("profiles" in config, false);
});

test("loadConfig vraca default brojeve kad su env vrijednosti neispravne", () => {
  const config = loadConfig({
    OLX_MIN_REQUEST_INTERVAL_MS: "brzo",
    OLX_MAX_RETRIES: "",
    OLX_TIMEOUT_MS: "0",
  } as NodeJS.ProcessEnv);

  assert.equal(config.minRequestIntervalMs, 350, "neispravna vrijednost ne smije ugasiti throttle");
  assert.equal(config.maxRetries, 4);
  assert.equal(config.timeoutMs, 0, "eksplicitna nula je validna vrijednost, ne greska");
});

test("loadConfig postavlja audit log na putanju van gita", () => {
  const podrazumijevano = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(podrazumijevano.auditFile, ".olx-pik/audit.jsonl");
  assert.equal(podrazumijevano.auditReads, false, "citanja se ne loguju bez izricite zastavice");

  const svoje = loadConfig({ OLX_AUDIT_FILE: "moj/log.jsonl", OLX_AUDIT_READS: "1" } as NodeJS.ProcessEnv);
  assert.equal(svoje.auditFile, "moj/log.jsonl");
  assert.equal(svoje.auditReads, true);
});
