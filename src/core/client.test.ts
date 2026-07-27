// Testovi zastita u jezgru: spend-guard (nista se ne naplacuje bez confirm), politika retry-a
// (429 se ponavlja, 401 i 5xx na naplati ne) i citanje konfiguracije jednog naloga.
// Mreza se ne dira: fetch je zamijenjen stubom koji broji pozive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OlxClient, OlxAuthError, OlxSpendError } from "./index.js";
import { loadConfig } from "./config.js";
import { withAuditContext, type AuditEntry } from "./audit.js";
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

test("sponsorPrice serializuje locations kao niz u query stringu", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: PRICE_BODY }]);
  try {
    const client = new OlxClient(testConfig());
    await client.sponsorPrice(123, { type: 1, days: 5, refresh_every: 0, locations: ["homepage"] });
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.includes("locations%5B%5D=homepage"), "locations ide kao locations[]=homepage");
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

test("listAllByState prelistava sve stranice datog stanja i postuje maxPages", async () => {
  const stranica = (page: number, lastPage: number) => ({
    data: [{ id: page * 100, title: `Oglas ${page}` }],
    meta: { total: lastPage, last_page: lastPage, current_page: page, per_page: 1 },
  });
  const { calls, restore } = stubFetch([
    { status: 200, body: stranica(1, 3) },
    { status: 200, body: stranica(2, 3) },
    { status: 200, body: stranica(3, 3) },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const sve = await client.listAllByState("expired", "primjer_shop");
    assert.equal(sve.length, 3, "spojene su sve tri stranice");
    assert.equal(calls.length, 3);
    assert.ok(calls[0]?.url.includes("/users/primjer_shop/listings/expired"), "gadja se expired putanja");
    assert.ok(calls[2]?.url.includes("page=3"));
  } finally {
    restore();
  }

  const { calls: calls2, restore: restore2 } = stubFetch([
    { status: 200, body: stranica(1, 5) },
    { status: 200, body: stranica(2, 5) },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const ograniceno = await client.listAllByState("finished", "primjer_shop", 2);
    assert.equal(ograniceno.length, 2, "maxPages sijece prelistavanje");
    assert.equal(calls2.length, 2);
  } finally {
    restore2();
  }
});

// ---- Audit log i obnova tokena ----
// Sink se injektuje kao funkcija, pa nijedan test ne pise u fajl.

// Stub koji odgovara po URL-u, ne po redu. Potreban je za relogin testove, gdje se izmedju dva
// pokusaja originalnog poziva ubacuje poziv na /auth/login.
function stubFetchByUrl(
  handler: (call: { url: string; method: string; body?: string }, index: number) => StubReply,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const call: FetchCall = {
      url: typeof input === "string" ? input : String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const reply = handler(call, calls.length - 1);
    const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => text,
    };
  }) as unknown as typeof globalThis.fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

function auditCollector(): { entries: AuditEntry[]; sink: (e: AuditEntry) => void } {
  const entries: AuditEntry[] = [];
  return { entries, sink: (e) => entries.push(e) };
}

test("audit biljezi upis, a citanje preskace", async () => {
  const { restore } = stubFetch([{ status: 200, body: { message: "ok" } }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(testConfig(), { audit: sink });
    await client.me();
    assert.equal(entries.length, 0, "GET se ne biljezi bez OLX_AUDIT_READS");

    await client.refreshListing(555);
    assert.equal(entries.length, 1, "obnova mijenja stanje, pa se biljezi");
    const zapis = entries[0];
    assert.equal(zapis?.method, "PUT");
    assert.equal(zapis?.path, "/listings/555/refresh");
    assert.equal(zapis?.ok, true);
    assert.equal(zapis?.status, 200);
    assert.equal(zapis?.attempts, 1);
    assert.ok(typeof zapis?.duration_ms === "number");
  } finally {
    restore();
  }
});

test("audit biljezi i citanja kad je to ukljuceno", async () => {
  const { restore } = stubFetch([{ status: 200, body: { data: { id: 1 } } }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(testConfig({ auditReads: true }), { audit: sink });
    await client.me();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.method, "GET");
    assert.equal(entries[0]?.path, "/me");
  } finally {
    restore();
  }
});

test("audit nikad ne sadrzi lozinku ni tijelo zahtjeva", async () => {
  const { restore } = stubFetch([{ status: 200, body: { token: "svjez-token", user: { id: 1 } } }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(
      testConfig({ username: "korisnik", password: "tajna-lozinka-123" }),
      { audit: sink },
    );
    await client.login();
    assert.equal(entries.length, 1, "login je POST, pa se biljezi");
    const serijalizovano = JSON.stringify(entries[0]);
    assert.equal(serijalizovano.includes("tajna-lozinka-123"), false, "lozinka ne smije u log");
    assert.equal(serijalizovano.includes("svjez-token"), false, "token ne smije u log");
  } finally {
    restore();
  }
});

test("audit nosi ime operacije iz konteksta", async () => {
  const { restore } = stubFetch([{ status: 200, body: {} }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(testConfig(), { audit: sink });
    await withAuditContext({ operation: "olx_refresh_listing", source: "mcp" }, () =>
      client.refreshListing(9),
    );
    assert.equal(entries[0]?.operation, "olx_refresh_listing");
    assert.equal(entries[0]?.source, "mcp");
  } finally {
    restore();
  }
});

test("audit biljezi i neuspjeh, sa statusom i porukom", async () => {
  const { restore } = stubFetch([{ status: 422, body: { message: "Polje je obavezno" } }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(testConfig(), { audit: sink });
    await assert.rejects(() => client.createListing({ title: "Test", category_id: 1 }));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.ok, false);
    assert.equal(entries[0]?.status, 422);
    assert.ok(entries[0]?.error?.includes("422"));
  } finally {
    restore();
  }
});

test("401 sa kredencijalima obnovi token i ponovi citanje", async () => {
  let prviPokusaj = true;
  const { calls, restore } = stubFetchByUrl((call) => {
    if (call.url.endsWith("/auth/login")) return { status: 200, body: { token: "novi-token", user: { id: 1 } } };
    if (prviPokusaj) {
      prviPokusaj = false;
      return { status: 401, body: { message: "unauthorized" } };
    }
    return { status: 200, body: { data: { id: 1, username: "shop_test" } } };
  });
  try {
    const client = new OlxClient(testConfig({ username: "korisnik", password: "lozinka" }));
    const me = await client.me();
    assert.equal(me.username, "shop_test", "poziv uspije nakon obnove tokena");
    assert.equal(calls.length, 3, "originalni poziv, login, pa ponovljeni poziv");
    assert.ok(calls[1]?.url.endsWith("/auth/login"));
    assert.equal(calls[2]?.url.endsWith("/me"), true);
  } finally {
    restore();
  }
});

test("401 bez kredencijala ne pokusava login", async () => {
  const { calls, restore } = stubFetchByUrl(() => ({ status: 401, body: { message: "unauthorized" } }));
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.me(),
      (err: unknown) => {
        assert.ok(err instanceof OlxAuthError);
        assert.match(err.message, /Postavi novi OLX_TOKEN/);
        return true;
      },
    );
    assert.equal(calls.length, 1, "bez lozinke nema sta da se obnovi");
  } finally {
    restore();
  }
});

test("401 i nakon obnove tokena ne pravi petlju", async () => {
  const { calls, restore } = stubFetchByUrl((call) =>
    call.url.endsWith("/auth/login")
      ? { status: 200, body: { token: "novi-token", user: { id: 1 } } }
      : { status: 401, body: { message: "unauthorized" } },
  );
  try {
    const client = new OlxClient(testConfig({ username: "korisnik", password: "lozinka" }));
    await assert.rejects(() => client.me(), (err: unknown) => err instanceof OlxAuthError);
    assert.equal(calls.length, 3, "jedan login, jedan ponovljeni poziv, pa stop");
  } finally {
    restore();
  }
});

test("403 se ne lijeci loginom", async () => {
  const { calls, restore } = stubFetchByUrl(() => ({ status: 403, body: { message: "forbidden" } }));
  try {
    const client = new OlxClient(testConfig({ username: "korisnik", password: "lozinka" }));
    await assert.rejects(
      () => client.me(),
      (err: unknown) => {
        assert.ok(err instanceof OlxAuthError);
        assert.match(err.message, /nema dozvolu/);
        return true;
      },
    );
    assert.equal(calls.length, 1, "403 nije pitanje tokena, nego dozvole");
  } finally {
    restore();
  }
});

test("izdvajanje se ne ponavlja nakon obnove tokena", async () => {
  const { calls, restore } = stubFetchByUrl((call) => {
    if (call.url.endsWith("/auth/login")) return { status: 200, body: { token: "novi-token", user: { id: 1 } } };
    return { status: 401, body: { message: "unauthorized" } };
  });
  try {
    const client = new OlxClient(testConfig({ username: "korisnik", password: "lozinka" }));
    await assert.rejects(
      () => client.sponsorListing(123, { type: 1, days: 7 }, true),
      (err: unknown) => {
        assert.ok(err instanceof OlxAuthError);
        assert.match(err.message, /nije ponovljena automatski/);
        return true;
      },
    );
    const postovi = calls.filter((c) => c.method === "POST" && c.url.includes("/sponsore"));
    assert.equal(postovi.length, 1, "trosak se ne ponavlja tiho nakon obnove tokena");
    assert.equal(calls.filter((c) => c.url.endsWith("/auth/login")).length, 1);
  } finally {
    restore();
  }
});

test("paralelni 401 pozivi dijele jednu obnovu tokena", async () => {
  const vidjeni = new Set<string>();
  const { calls, restore } = stubFetchByUrl((call) => {
    if (call.url.endsWith("/auth/login")) return { status: 200, body: { token: "novi-token", user: { id: 1 } } };
    if (!vidjeni.has(call.url)) {
      vidjeni.add(call.url);
      return { status: 401, body: { message: "unauthorized" } };
    }
    return { status: 200, body: { data: { id: 1 } } };
  });
  try {
    const client = new OlxClient(testConfig({ username: "korisnik", password: "lozinka" }));
    await Promise.all([client.me(), client.getListing(1)]);
    assert.equal(
      calls.filter((c) => c.url.endsWith("/auth/login")).length,
      1,
      "dva 401 istovremeno ne smiju pokrenuti dva logina",
    );
  } finally {
    restore();
  }
});

test("odbijen trosak se biljezi iako zahtjev nije poslan", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: PRICE_BODY }]);
  const { entries, sink } = auditCollector();
  try {
    const client = new OlxClient(testConfig(), { audit: sink });
    await assert.rejects(() => client.sponsorListing(77, { type: 2, days: 7 }, false));
    assert.equal(calls.filter((c) => c.method === "POST").length, 0, "nista nije poslano");
    assert.equal(entries.length, 1, "odbijanje se biljezi");
    assert.equal(entries[0]?.ok, false);
    assert.equal(entries[0]?.path, "/listings/77/sponsore");
    assert.match(String(entries[0]?.error), /odbijeno bez potvrde/);
    assert.match(String(entries[0]?.error), /60 kredita/);
  } finally {
    restore();
  }
});
