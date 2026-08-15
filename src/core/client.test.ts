// Testovi zastita u jezgru: spend-guard (nista se ne naplacuje bez confirm), politika retry-a
// (429 se ponavlja, 401 i 5xx na naplati ne) i citanje konfiguracije jednog naloga.
// Mreza se ne dira: fetch je zamijenjen stubom koji broji pozive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OlxClient, OlxAuthError, OlxSpendError, OlxPravilaError, naknadaKategorije } from "./index.js";
import { loadConfig } from "./config.js";
import { potrosenoNaDan, withAuditContext, type AuditEntry } from "./audit.js";
import { VERZIJA } from "./verzija.js";
import type { OlxConfig } from "./config.js";

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  /** Zaglavlja poziva; sluzi da test moze dokazati KOJI je token poslan. */
  headers?: Record<string, string>;
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

  globalThis.fetch = (async (
    input: unknown,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: init?.headers,
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
    mcpProfil: "admin",
    maxSpendPerDay: 0,
    maxStranicaListe: 5000,
    budzetListeMs: 20000,
    budzetListeGrupniMs: 120000,
    budzetListeKonkurentMs: 20000,
    maxOglasaUOdgovoru: 500,
    maxStavkiUOdgovoru: 200,
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
  // Cijena se dohvata i kad je confirm postavljen: treba za dnevni plafon i za iznos u audit logu.
  const { calls, restore } = stubFetch([
    { status: 200, body: PRICE_BODY },
    { status: 500, body: { message: "server" } },
  ]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 3 }));
    await assert.rejects(() => client.sponsorListing(123, { type: 2, days: 7 }, true));
    const postovi = calls.filter((c) => c.method === "POST");
    assert.equal(postovi.length, 1, "naplata se NE ponavlja na 5xx (moguca dupla naplata)");
    assert.equal(calls[0]?.method, "GET", "prvo cijena");
    assert.ok(calls[0]?.url.includes("/sponsore/price"));
    // refresh_every je na API-ju obavezan, pa ga klijent uvijek posalje.
    assert.ok(postovi[0]?.body?.includes('"refresh_every":0'));
  } finally {
    restore();
  }
});

test("sponsorListing zapisuje potroseno kredita u audit log", async () => {
  const { restore } = stubFetch([
    { status: 200, body: PRICE_BODY },
    { status: 200, body: { message: "ok" } },
  ]);
  const zapisi: AuditEntry[] = [];
  try {
    const client = new OlxClient(testConfig(), { audit: (e) => zapisi.push(e) });
    await client.sponsorListing(123, { type: 2, days: 7 }, true);
    const naplata = zapisi.find((z) => z.path.endsWith("/sponsore") && z.method === "POST");
    assert.equal(naplata?.krediti, 60, "iznos iz cijene ulazi u log, inace se dnevna potrosnja ne moze sabrati");
    assert.equal(naplata?.ok, true);
  } finally {
    restore();
  }
});

test("dnevni plafon zaustavlja izdvajanje prije nego zahtjev ode na mrezu", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: PRICE_BODY }]);
  const logFajl = join(tmpdir(), `olx-plafon-${process.pid}.jsonl`);
  // Danas je vec potroseno 80 kredita, plafon je 100, a ova radnja trazi 60.
  writeFileSync(
    logFajl,
    `${JSON.stringify({ ts: new Date().toISOString(), operation: "t", source: "cli", method: "POST", path: "/x", status: 200, ok: true, duration_ms: 1, attempts: 1, krediti: 80 })}\n`,
    "utf8",
  );
  try {
    const client = new OlxClient(testConfig({ auditFile: logFajl, maxSpendPerDay: 100 }));
    await assert.rejects(
      () => client.sponsorListing(123, { type: 2, days: 7 }, true),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        assert.match(err.message, /dnevni plafon 100/);
        return true;
      },
    );
    assert.equal(
      calls.some((c) => c.method === "POST"),
      false,
      "naplata ne smije otici na mrezu kad je plafon probijen",
    );
  } finally {
    restore();
    rmSync(logFajl, { force: true });
  }
});

test("dnevni plafon propusta radnju koja jos stane u plafon", async () => {
  const { calls, restore } = stubFetch([
    { status: 200, body: PRICE_BODY },
    { status: 200, body: { message: "ok" } },
  ]);
  const logFajl = join(tmpdir(), `olx-plafon-ok-${process.pid}.jsonl`);
  writeFileSync(
    logFajl,
    `${JSON.stringify({ ts: new Date().toISOString(), operation: "t", source: "cli", method: "POST", path: "/x", status: 200, ok: true, duration_ms: 1, attempts: 1, krediti: 30 })}\n`,
    "utf8",
  );
  try {
    const client = new OlxClient(testConfig({ auditFile: logFajl, maxSpendPerDay: 100 }));
    await client.sponsorListing(123, { type: 2, days: 7 }, true);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1, "30 plus 60 je ispod plafona 100");
  } finally {
    restore();
    rmSync(logFajl, { force: true });
  }
});

test("dnevni plafon ODBIJA radnju kad audit log postoji a nije citljiv (fails closed)", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: PRICE_BODY }]);
  // Direktorij umjesto fajla: readFileSync baca EISDIR, sto NIJE ENOENT, pa se radnja odbija.
  const logDir = join(tmpdir(), `olx-plafon-dir-${process.pid}`);
  mkdirSync(logDir, { recursive: true });
  try {
    const client = new OlxClient(testConfig({ auditFile: logDir, maxSpendPerDay: 100 }));
    await assert.rejects(
      () => client.sponsorListing(123, { type: 2, days: 7 }, true),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        assert.match(err.message, /nije citljiv/);
        return true;
      },
    );
    assert.equal(
      calls.some((c) => c.method === "POST"),
      false,
      "naplata ne smije otici na mrezu kad se plafon ne moze provjeriti",
    );
  } finally {
    restore();
    rmSync(logDir, { recursive: true, force: true });
  }
});

test("akcijska cijena ulazi u dnevni plafon kao najmanje 1 kredit", async () => {
  const { calls, restore } = stubFetch([]);
  const logFajl = join(tmpdir(), `olx-plafon-discount-${process.pid}.jsonl`);
  // Plafon 100, potroseno tacno 100: i radnja od "samo" 1 kredit mora stati.
  writeFileSync(
    logFajl,
    `${JSON.stringify({ ts: new Date().toISOString(), operation: "t", source: "cli", method: "POST", path: "/x", status: 200, ok: true, duration_ms: 1, attempts: 1, krediti: 100 })}\n`,
    "utf8",
  );
  try {
    const client = new OlxClient(testConfig({ auditFile: logFajl, maxSpendPerDay: 100 }));
    await assert.rejects(
      () => client.setDiscount(123, { price: 10, days: 7 }, true),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        return true;
      },
    );
    assert.equal(calls.length, 0, "zahtjev ne smije otici na mrezu");
  } finally {
    restore();
    rmSync(logFajl, { force: true });
  }
});

test("dnevni plafon ne racuna jucerasnju potrosnju ni odbijene pokusaje", async () => {
  const juce = new Date(Date.now() - 86_400_000).toISOString();
  const zapis = (o: Record<string, unknown>) =>
    JSON.stringify({ operation: "t", source: "cli", method: "POST", path: "/x", status: 200, duration_ms: 1, attempts: 1, ...o });
  const sadrzaj = [
    zapis({ ts: juce, ok: true, krediti: 500 }),
    zapis({ ts: new Date().toISOString(), ok: false, krediti: 400, error: "odbijeno bez potvrde" }),
    zapis({ ts: new Date().toISOString(), ok: true, krediti: 25 }),
    "{ ovo nije validan json",
    "",
  ].join("\n");
  assert.equal(potrosenoNaDan(sadrzaj, new Date().toISOString().slice(0, 10)), 25);
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
  // Prvi poziv je citanje kategorije, radi provjere naknade za objavu.
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 23, name: "Bez naknade", listing_fee: 0 } },
    { status: 500, body: { message: "server" } },
  ]);
  try {
    const client = new OlxClient(testConfig({ maxRetries: 3 }));
    await assert.rejects(() => client.createListing({ title: "Test", category_id: 23 }));
    assert.equal(calls.filter((c) => c.method === "POST").length, 1, "POST /listings se ne ponavlja");
  } finally {
    restore();
  }
});

test("createListing bez confirm ne salje zahtjev ni kad naknada NIJE citljiva", async () => {
  // Nepoznata cijena nije isto sto i nula: prije se objava tiho propustala, pa bi se u naplatnoj
  // kategoriji naplatilo bez rijeci. Sada nepoznato trazi potvrdu.
  const { calls, restore } = stubFetch([{ status: 500, body: { message: "kategorija nedostupna" } }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.createListing({ title: "Nesto", category_id: 18 }),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError, "mora biti greska troska, ne obicna greska");
        return true;
      },
    );
    assert.equal(calls.filter((c) => c.method === "POST").length, 0, "POST /listings se ne salje");
  } finally {
    restore();
  }
});

test("publishListing bez confirm ne objavljuje nacrt u naplatnoj kategoriji", async () => {
  // Rupa iz prakse: brana je stajala samo na kreiranju, pa se nacrt (kreiran ranije, van bota,
  // ili prebacen u drugu kategoriju) objavljivao bez ijedne rijeci o cijeni.
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 5, title: "Golf", category_id: 18 } },
    { status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } },
  ]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.publishListing(5),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        assert.ok(String((err as Error).message).includes("70"), "cijena mora biti u poruci");
        return true;
      },
    );
    assert.equal(calls.filter((c) => c.url.includes("/publish")).length, 0, "publish se ne salje");
  } finally {
    restore();
  }
});

test("publishListing sa confirm objavljuje", async () => {
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 5, title: "Golf", category_id: 18 } },
    { status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } },
    { status: 200, body: { message: "ok", status: "active" } },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const r = await client.publishListing(5, { confirm: true });
    assert.equal(r.status, "active");
    assert.equal(calls.filter((c) => c.url.includes("/publish")).length, 1);
  } finally {
    restore();
  }
});

test("publishListing u besplatnoj kategoriji ne trazi confirm", async () => {
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 9, title: "Baloni", category_id: 754 } },
    { status: 200, body: { id: 754, name: "Party dekoracije", listing_fee: 0 } },
    { status: 200, body: { message: "ok", status: "active" } },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const r = await client.publishListing(9);
    assert.equal(r.status, "active");
    assert.equal(calls.filter((c) => c.url.includes("/publish")).length, 1);
  } finally {
    restore();
  }
});

test("updateListing bez confirm ne prebacuje oglas u naplatnu kategoriju", async () => {
  // Drugi ulaz u istu rupu: besplatan nacrt se prebaci u naplatnu kategoriju pa objavi.
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.updateListing(5, { category_id: 18 }),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        return true;
      },
    );
    assert.equal(calls.filter((c) => c.method === "PUT").length, 0, "PUT se ne salje");
  } finally {
    restore();
  }
});

test("updateListing bez kategorije ne trazi confirm i ne cita kategoriju", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 5, title: "Novi naslov" } }]);
  try {
    const client = new OlxClient(testConfig());
    await client.updateListing(5, { title: "Novi naslov" });
    assert.equal(calls.length, 1, "samo PUT, bez citanja kategorije");
    assert.equal(calls[0]?.method, "PUT");
  } finally {
    restore();
  }
});

test("createListing bez confirm ne salje zahtjev u naplatnoj kategoriji", async () => {
  // Automobili nose listing_fee 70 kredita.
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.createListing({ title: "Golf 7 1.6 TDI", category_id: 18 }),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError);
        assert.match(err.message, /70 kredita/);
        return true;
      },
    );
    assert.equal(
      calls.some((c) => c.method === "POST"),
      false,
      "objava se ne salje dok trosak nije potvrdjen",
    );
  } finally {
    restore();
  }
});

test("createListing sa confirm objavi u naplatnoj kategoriji i zapise trosak", async () => {
  const { restore } = stubFetch([
    { status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } },
    { status: 200, body: { data: { id: 999, title: "Golf 7" } } },
  ]);
  const zapisi: AuditEntry[] = [];
  try {
    const client = new OlxClient(testConfig(), { audit: (e) => zapisi.push(e) });
    const oglas = await client.createListing({ title: "Golf 7 1.6 TDI", category_id: 18 }, { confirm: true });
    assert.equal(oglas.id, 999);
    assert.equal(zapisi.find((z) => z.path === "/listings")?.krediti, 70);
  } finally {
    restore();
  }
});

test("createListing u besplatnoj kategoriji ne trazi confirm", async () => {
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 754, name: "Party dekoracije", listing_fee: 0 } },
    { status: 200, body: { data: { id: 1000, title: "Baloni" } } },
  ]);
  const zapisi: AuditEntry[] = [];
  try {
    const client = new OlxClient(testConfig(), { audit: (e) => zapisi.push(e) });
    await client.createListing({ title: "Baloni za rodjendan", category_id: 754 });
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
    assert.equal(zapisi.find((z) => z.path === "/listings")?.krediti, undefined, "besplatno se ne biljezi kao trosak");
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

// Brana protiv buduceg dizanja budzeta bez racuna: 75 s je smisljen broj (oko 131 stranica,
// oko 2620 oglasa pri 0,57 s po stranici), a krov prekoracaja od 107 s uz grupni budzet od 120 s
// mora ostati ispod MCP zida od 300 s. Konkurentski budzet ostaje na starih 20000, jer se
// konkurenti obilaze serijski i dizanje razgovornog budzeta ne smije usporiti taj obilazak.
test("loadConfig cuva razgovorni budzet liste na 75 s i konkurentski na 20 s, ispod MCP zida", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.budzetListeMs, 75000, "razgovorni budzet liste je podignut na 75 s");
  assert.equal(config.budzetListeKonkurentMs, 20000, "konkurent ima vlastiti, kratak budzet");
  assert.ok(
    config.budzetListeGrupniMs + 107000 < 300000,
    "krov prekoracaja (~107 s) plus grupni budzet mora ostati ispod MCP zida od 300 s",
  );
});

test("loadConfig prima dan ciklusa kvote samo kao valjan dan u mjesecu", () => {
  // Rezerva za nalog bez shopa. Pogresan upis se odbacuje umjesto da se steze: stegnut dan bi
  // postao rok koji se onda TVRDI klijentu, a to je tacno ono sto pravila-brojeva zabranjuje.
  assert.equal(loadConfig({} as NodeJS.ProcessEnv).danCiklusaKvote, undefined, "prazno ostaje prazno");
  assert.equal(loadConfig({ OLX_DAN_CIKLUSA_KVOTE: "24" } as NodeJS.ProcessEnv).danCiklusaKvote, 24);
  assert.equal(loadConfig({ OLX_DAN_CIKLUSA_KVOTE: "1" } as NodeJS.ProcessEnv).danCiklusaKvote, 1);
  assert.equal(loadConfig({ OLX_DAN_CIKLUSA_KVOTE: "31" } as NodeJS.ProcessEnv).danCiklusaKvote, 31);

  for (const lose of ["0", "32", "-5", "prvi", "1.9"]) {
    const c = loadConfig({ OLX_DAN_CIKLUSA_KVOTE: lose } as NodeJS.ProcessEnv);
    if (lose === "1.9") {
      assert.equal(c.danCiklusaKvote, 1, "decimalni dan se odsijeca na cio dan u opsegu");
    } else {
      assert.equal(c.danCiklusaKvote, undefined, `vrijednost "${lose}" se ne smije primiti`);
    }
  }
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
    assert.equal(sve.oglasi.length, 3, "spojene su sve tri stranice");
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
    const ograniceno = await client.listAllByState("finished", "primjer_shop", { maxStranica: 2 });
    assert.equal(ograniceno.oglasi.length, 2, "maxStranica sijece prelistavanje");
    assert.equal(calls2.length, 2);
    assert.equal(ograniceno.potpuno, false, "osigurac je odsjekao listu, nije potpuna");
    assert.equal(ograniceno.razlog, "osigurac");
  } finally {
    restore2();
  }
});

// Glavni regresioni test: prvi klijent ima 2000 artikala u katalogu, a stari kod je
// listAllByState tiho sjekao na maxPages=50 * per_page 20 = 1000, pa je pozivalac dobijao
// goli niz i mislio da je to cijeli katalog. Broj 2500 namjerno prelazi taj stari plafon
// (i stvarni katalog prvog klijenta) da regresija ne moze proci neopazeno.
test("listAllByState cita cijeli katalog od 2500 oglasa, ne staje na starom plafonu od 1000", async () => {
  const PER_PAGE = 20;
  const UKUPNO_STRANICA = 125;
  const UKUPNO_OGLASA = 2500;
  const stranice = Array.from({ length: UKUPNO_STRANICA }, (_, i) => {
    const page = i + 1;
    return {
      status: 200,
      body: {
        data: Array.from({ length: PER_PAGE }, (_, j) => {
          const id = (page - 1) * PER_PAGE + j + 1;
          return { id, title: `Oglas ${id}` };
        }),
        meta: { total: UKUPNO_OGLASA, last_page: UKUPNO_STRANICA, current_page: page, per_page: PER_PAGE },
      },
    };
  });
  const { calls, restore } = stubFetch(stranice);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listAllByState("active", "primjer_shop");
    assert.equal(rezultat.oglasi.length, 2500, "stari kod bi ovdje vratio 1000 (maxPages 50 * per_page 20)");
    assert.equal(rezultat.potpuno, true);
    assert.equal(rezultat.ukupno, 2500);
    assert.equal(rezultat.procitanoStranica, 125);
    assert.equal(rezultat.razlog, undefined);
    assert.equal(calls.length, 125);
  } finally {
    restore();
  }
});

// Uslov (b): iscrpljen budzet vremena NIJE tisina i NIJE prazan rezultat. Prelistavanje se
// prekida, ali sve vec procitane stranice ostaju u odgovoru, a `ukupno` i dalje dolazi sa
// API-ja (meta.total prve stranice), ne iz duzine nepotpune liste.
test("listAllByState kad budzet istekne staje ali zadrzava vec procitane stranice", async () => {
  const stranica = (page: number) => ({
    data: [{ id: page, title: `Oglas ${page}` }],
    meta: { total: 500, last_page: 5, current_page: page, per_page: 100 },
  });
  const { calls, restore } = stubFetch([
    { status: 200, body: stranica(1) },
    { status: 200, body: stranica(2) },
    { status: 200, body: stranica(3) },
    { status: 200, body: stranica(4) },
    { status: 200, body: stranica(5) },
  ]);
  try {
    const client = new OlxClient(testConfig({ minRequestIntervalMs: 20 }));
    const rezultat = await client.listAllByState("active", "primjer_shop", { budzetMs: 1 });
    assert.ok(rezultat.oglasi.length > 0, "prva stranica nije bacena");
    assert.equal(rezultat.potpuno, false);
    assert.equal(rezultat.razlog, "budzet");
    assert.equal(rezultat.ukupno, 500, "ukupno dolazi sa API-ja, ne iz duzine nepotpune liste");
    assert.ok(calls.length < 5, "prelistavanje je stalo prije zadnje stranice");
  } finally {
    restore();
  }
});

// Prelistavanje velikog kataloga traje minutama, a obnova jednog oglasa ga u medjuvremenu
// premjesti na prvu stranicu, pa bi se bez dedupa isti oglas pojavio dvaput.
test("listAllByState dedup-uje isti oglas kad se pojavi na dvije stranice", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: {
        data: [{ id: 1, title: "Oglas 1" }, { id: 2, title: "Oglas 2" }, { id: 3, title: "Oglas 3" }],
        meta: { total: 5, last_page: 2, current_page: 1, per_page: 3 },
      },
    },
    {
      status: 200,
      body: {
        data: [{ id: 3, title: "Oglas 3" }, { id: 4, title: "Oglas 4" }, { id: 5, title: "Oglas 5" }],
        meta: { total: 5, last_page: 2, current_page: 2, per_page: 3 },
      },
    },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listAllByState("active", "primjer_shop");
    const idovi = rezultat.oglasi.map((o) => o.id);
    assert.equal(rezultat.oglasi.length, 5, "duplikat (id 3) se broji samo jednom");
    assert.equal(new Set(idovi).size, idovi.length, "svi id-jevi su jedinstveni");
  } finally {
    restore();
  }
});

test("listAllByState prijavljuje da se katalog mijenjao tokom citanja", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: {
        data: [{ id: 1, title: "Oglas 1" }],
        meta: { total: 100, last_page: 2, current_page: 1, per_page: 1 },
      },
    },
    {
      status: 200,
      body: {
        data: [{ id: 2, title: "Oglas 2" }],
        meta: { total: 98, last_page: 2, current_page: 2, per_page: 1 },
      },
    },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listAllByState("active", "primjer_shop");
    assert.equal(rezultat.potpuno, false);
    assert.equal(rezultat.razlog, "katalog_se_mijenjao");
  } finally {
    restore();
  }
});

// Prednost razloga: kad osigurac vec sijece listu, promjena kataloga izmedju prve i zadnje
// procitane stranice se ne smije prepisati preko "katalog_se_mijenjao".
test("listAllByState: osigurac ima prednost nad katalog_se_mijenjao", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: {
        data: [{ id: 1, title: "Oglas 1" }],
        meta: { total: 100, last_page: 10, current_page: 1, per_page: 1 },
      },
    },
    {
      status: 200,
      body: {
        data: [{ id: 2, title: "Oglas 2" }],
        meta: { total: 100, last_page: 10, current_page: 2, per_page: 1 },
      },
    },
    {
      status: 200,
      body: {
        data: [{ id: 3, title: "Oglas 3" }],
        meta: { total: 90, last_page: 10, current_page: 3, per_page: 1 },
      },
    },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listAllByState("active", "primjer_shop", { maxStranica: 3 });
    assert.equal(rezultat.potpuno, false);
    assert.equal(rezultat.razlog, "osigurac", "osigurac se ne smije prepisati sa katalog_se_mijenjao");
  } finally {
    restore();
  }
});

// ---- listNajstarijiAktivni ----
// `olx_sponsor_plan` trazi najstarije aktivne oglase. Umjesto citanja cijelog kataloga, ova
// metoda cita prvu stranicu pa (kad poredak stoji) stranice od kraja, dok ne skupi dovoljno
// kandidata. Testovi provjeravaju bas to: manje poziva nego puno citanje, i da se poredak
// zaista provjerava prije nego se mu povjeruje.

// Katalog od 5 stranica po 2 oglasa, sa datumima koji uredno opadaju od prve ka zadnjoj stranici
// (najskorije obnovljeni prvi): stranica 1 nosi najvece datume, stranica 5 najmanje.
function stranicaSaDatumima(page: number, lastPage: number, datumi: number[]) {
  return {
    status: 200,
    body: {
      data: datumi.map((date, i) => ({ id: (page - 1) * datumi.length + i + 1, title: `Oglas ${date}`, date })),
      meta: { total: lastPage * datumi.length, last_page: lastPage, current_page: page, per_page: datumi.length },
    },
  };
}

test("listNajstarijiAktivni cita samo prvu i zadnje stranice, ne cijeli katalog", async () => {
  // Stub odgovara po REDOSLIJEDU poziva, ne po trazenoj stranici, pa se ovdje daju bas ona
  // dva odgovora koja ce metoda stvarno zatraziti: stranicu 1, pa (preskacuci 2, 3, 4) odmah
  // stranicu 5.
  const { calls, restore } = stubFetch([
    stranicaSaDatumima(1, 5, [100, 99]),
    stranicaSaDatumima(5, 5, [92, 91]),
  ]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listNajstarijiAktivni("primjer_shop", { najmanje: 3 });
    assert.equal(rezultat.poredakPouzdan, true);
    // Stranica 1 (2 oglasa) pa stranica 5 (2 oglasa) je vec >= 3 trazena, pa se staje: ukupno 2
    // procitane stranice od mogucih 5.
    assert.equal(rezultat.procitanoStranica, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls[1]?.url.includes("page=5"), "druga procitana stranica je zadnja, ne druga");
    const datumi = rezultat.oglasi.map((o) => o.date);
    assert.deepEqual(datumi, [...datumi].sort((a, b) => (a ?? 0) - (b ?? 0)), "rezultat je sortiran uzlazno");
    assert.ok(
      datumi.every((d) => d === 91 || d === 92 || d === 99 || d === 100),
      "vraceni oglasi su sa prve i zadnje procitane stranice",
    );
  } finally {
    restore();
  }
});

// Regresija: granica izmedju dvije procitane stranice sa kraja mora porediti stranicu koja se
// upravo cita (novija) sa prethodno procitanom (starijom), ne obrnuto. Test sa citanjem SAMO
// jedne stranice s kraja tu gresku ne bi vidio (nema druge granice za provjeru), zato ovdje
// najmanje trazi da se procita bar tri stranice sa kraja na urednom katalogu.
test("listNajstarijiAktivni: uredan katalog ostaje poredakPouzdan i kad se cita vise stranica s kraja", async () => {
  const { calls, restore } = stubFetch([
    stranicaSaDatumima(1, 5, [100, 99]),
    stranicaSaDatumima(5, 5, [92, 91]),
    stranicaSaDatumima(4, 5, [94, 93]),
    stranicaSaDatumima(3, 5, [96, 95]),
  ]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listNajstarijiAktivni("primjer_shop", { najmanje: 7 });
    assert.equal(rezultat.poredakPouzdan, true, "uredan katalog se ne smije proglasiti nepouzdanim");
    assert.equal(rezultat.procitanoStranica, 4, "procitane su stranice 1, 5, 4 i 3");
    assert.equal(calls.length, 4);
    assert.ok(calls[2]?.url.includes("page=4"));
    assert.ok(calls[3]?.url.includes("page=3"));
    assert.equal(rezultat.oglasi.length, 8);
  } finally {
    restore();
  }
});

test("listNajstarijiAktivni vraca poredakPouzdan: false kad date nije nerastuci", async () => {
  const { calls, restore } = stubFetch([stranicaSaDatumima(1, 3, [50, 60])]);
  try {
    const client = new OlxClient(testConfig());
    const rezultat = await client.listNajstarijiAktivni("primjer_shop", { najmanje: 3 });
    assert.equal(rezultat.poredakPouzdan, false);
    assert.equal(rezultat.oglasi.length, 0);
    assert.equal(calls.length, 1, "provjera pada na prvoj stranici, dalje se ne cita");
  } finally {
    restore();
  }
});

test("listNajstarijiAktivni kad budzet istekne ne baca nego vraca sta je stigao", async () => {
  const { restore } = stubFetch([
    stranicaSaDatumima(1, 5, [100, 99]),
    stranicaSaDatumima(2, 5, [98, 97]),
    stranicaSaDatumima(3, 5, [96, 95]),
    stranicaSaDatumima(4, 5, [94, 93]),
    stranicaSaDatumima(5, 5, [92, 91]),
  ]);
  try {
    const client = new OlxClient(testConfig({ minRequestIntervalMs: 20 }));
    const rezultat = await client.listNajstarijiAktivni("primjer_shop", { najmanje: 10, budzetMs: 1 });
    assert.equal(rezultat.poredakPouzdan, true, "poredak nije prekrsen, samo je vrijeme isteklo");
    assert.ok(rezultat.oglasi.length > 0, "prva stranica nije bacena");
    assert.ok(rezultat.procitanoStranica < 5, "budzet je stao prije kraja");
  } finally {
    restore();
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
    assert.equal(zapis?.version, VERZIJA, "zapis mora reci kojim kodom je radnja izvrsena");
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
  // Prvi odgovor je citanje kategorije (besplatna), drugi je pad same objave. Bez prvog bi
  // provjera naknade pojela stub i objava bi bila odbijena prije POST-a.
  const { restore } = stubFetch([
    { status: 200, body: { id: 1, name: "Besplatna", listing_fee: 0 } },
    { status: 422, body: { message: "Polje je obavezno" } },
  ]);
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
        assert.match(err.message, /Upisi novi OLX_TOKEN u .env/);
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
    // Cijena mora proci, jer se dohvata prije naplate; 401 se testira na samom POST-u.
    if (call.url.includes("/sponsore/price")) return { status: 200, body: PRICE_BODY };
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
    // Drugo mjesto gradnje zapisa (zapisiOdbijeno): mora nositi verziju kao i obicni zapis.
    assert.equal(entries[0]?.version, VERZIJA);
  } finally {
    restore();
  }
});

test("naknadaKategorije cita listing_fee i iz omotaca i iz raspakovanog oblika", () => {
  // Regresija: GET /category/:id vraca { data: {...} }. Citanje sa vrha omotaca uvijek daje
  // undefined, pa spend-guard na objavi nikad ne bi opalio. Provjereno na kategoriji Automobili.
  assert.equal(naknadaKategorije({ data: { id: 18, name: "Automobili", listing_fee: 70 } }), 70);
  assert.equal(naknadaKategorije({ id: 18, listing_fee: 70 }), 70);
  assert.equal(naknadaKategorije({ data: { id: 754, listing_fee: 0 } }), 0);
  assert.equal(naknadaKategorije({ data: { id: 754 } }), 0, "bez polja je 0, ne NaN");
  assert.equal(naknadaKategorije(null), 0);
  assert.equal(naknadaKategorije({ data: { listing_fee: "nije broj" } }), 0);
});

// ---- Guardrails: roba koju platforma ne dozvoljava (clan 8) ----

test("createListing zaustavlja spornu robu prije ijednog mreznog poziva", async () => {
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 5, name: "Ostalo", listing_fee: 0 } }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.createListing({ title: "Kutija Xanaxa", category_id: 5, description: "" }),
      (err: unknown) => {
        assert.ok(err instanceof OlxPravilaError);
        assert.ok(err.pogoci.length > 0, "greska nosi sta je tacno zapelo");
        return true;
      },
    );
    assert.equal(calls.length, 0, "ni kategorija se ne cita: sporan oglas ne trosi nijedan poziv");
  } finally {
    restore();
  }
});

test("potvrda sporne robe NE potvrdjuje i cijenu objave", async () => {
  // Ovo je cijeli razlog zasto su dvije zastavice a ne jedna. Sa jednom bi oglas sa spornom
  // rijecju u naplatnoj kategoriji prosao ovako: padne na robi, covjek potvrdi robu, i cijena
  // od 70 kredita prodje a da je niko nije izgovorio.
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 18, name: "Automobili", listing_fee: 70 } }]);
  try {
    const client = new OlxClient(testConfig());
    await assert.rejects(
      () => client.createListing({ title: "Replika satova", category_id: 18 }, { potvrdiRobu: true }),
      (err: unknown) => {
        assert.ok(err instanceof OlxSpendError, "poslije robe mora doci brana troska");
        return true;
      },
    );
    assert.equal(calls.filter((c) => c.method === "POST").length, 0, "oglas se ne salje");
  } finally {
    restore();
  }
});

test("obican oglas ne osjeti provjeru robe", async () => {
  const { calls, restore } = stubFetch([
    { status: 200, body: { id: 5, name: "Ostalo", listing_fee: 0 } },
    { status: 200, body: { id: 77, title: "Polo majice pamuk" } },
  ]);
  try {
    const client = new OlxClient(testConfig());
    const oglas = await client.createListing({ title: "Polo majice pamuk", category_id: 5 });
    assert.equal(oglas.id, 77);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  } finally {
    restore();
  }
});

test("izmjena samo cijene ne pokrece provjeru robe ni na spornom oglasu", async () => {
  // Grupna promjena cijena salje samo price, pa oglas cije ime sadrzi spornu rijec ne smije
  // oboriti rutinski posao nad cijelim katalogom.
  const { calls, restore } = stubFetch([{ status: 200, body: { id: 5, price: 20 } }]);
  try {
    const client = new OlxClient(testConfig());
    await client.updateListing(5, { price: 20 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "PUT");
  } finally {
    restore();
  }
});

// ---- nov token u .env se preuzima bez restarta sesije ----

test("na 401 se procita .env i nov token se preuzme, bez restarta sesije", async () => {
  // Zasto ovo postoji: `.env` se cita JEDNOM pri startu procesa, pa token koji onboarding upise
  // dok sesija radi ostaje nevidljiv. Bez ovoga je jedini izlaz bio restart cijele Claude sesije.
  const dir = mkdtempSync(join(tmpdir(), "olx-env-"));
  const envFajl = join(dir, ".env");
  writeFileSync(envFajl, "# komentar\nOLX_TOKEN=novi-token-sa-diska\nOLX_BASE_URL=https://api.olx.ba\n");
  const { calls, restore } = stubFetch([
    { status: 401, body: { message: "unauthorized" } },
    { status: 200, body: { id: 7, username: "MixBox" } },
  ]);
  try {
    const client = new OlxClient({ ...testConfig(), token: "stari-token" }, { envFajl });
    const r = (await client.me()) as { id: number };
    assert.equal(r.id, 7, "poziv je ponovljen i uspio");
    assert.equal(calls.length, 2, "tacno jedan ponovljeni poziv");
    assert.equal(calls[1]?.headers?.Authorization, "Bearer novi-token-sa-diska", "drugi poziv nosi NOV token");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("na 401 se ne vrti u krug kad je token u .env isti", async () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-env-"));
  const envFajl = join(dir, ".env");
  writeFileSync(envFajl, "OLX_TOKEN=stari-token\n");
  const { calls, restore } = stubFetch([{ status: 401, body: {} }, { status: 401, body: {} }]);
  try {
    const client = new OlxClient({ ...testConfig(), token: "stari-token" }, { envFajl });
    await assert.rejects(() => client.me(), (e: unknown) => e instanceof OlxAuthError);
    assert.equal(calls.length, 1, "isti token znaci nema ponavljanja");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("na 401 bez .env fajla se ponasa kao i prije", async () => {
  const { calls, restore } = stubFetch([{ status: 401, body: {} }]);
  try {
    const client = new OlxClient({ ...testConfig(), token: "stari-token" }, { envFajl: "/nepostojeci/put/.env" });
    await assert.rejects(() => client.me(), (e: unknown) => e instanceof OlxAuthError);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});
