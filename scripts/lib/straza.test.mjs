// Testovi strazar rezima. Nikakva mreza ni stvarno cekanje: fetchImpl, cekaj i sada su svugdje
// ubrizgani lazni. Isti stil kao scripts/lib/sesija.test.mjs (node:test + node:assert/strict).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKOFF_MAX_MS,
  BACKOFF_POCETNI_MS,
  MIN_RUNDA_MS,
  POLL_TIMEOUT_S,
  TIHO_ALARM_MS,
  backoffMs,
  chatIzUpdatea,
  posaljiTyping,
  procitajBotToken,
  strazarUkljucen,
  strazi,
} from "./straza.mjs";

// ---- pomocnici ----

// Lazni fetch: biljezi { url, tijelo } svakog poziva, odgovara redom iz `niz`. Element koji je
// Error se baca (simulira mreznu gresku), ostalo se vraca kao JSON odgovor.
function laznFetch(niz) {
  const pozivi = [];
  let i = 0;
  return {
    pozivi,
    fetchImpl: async (url, opcije) => {
      pozivi.push({ url, tijelo: JSON.parse(opcije.body) });
      const stavka = niz[i++];
      if (stavka instanceof Error) throw stavka;
      return { json: async () => stavka };
    },
  };
}

// Lazno cekanje: ne ceka stvarno, samo biljezi trazeni broj ms. Poziv se moze produziti custom
// logikom preko `naSvaki` (npr. da pomjeri virtuelni sat ili prekine signal u pravom trenutku).
function laznoCekanje(naSvaki) {
  const pozivi = [];
  return {
    pozivi,
    cekaj: async (ms) => {
      pozivi.push(ms);
      naSvaki?.(pozivi.length, ms);
    },
  };
}

// ---- strazi: osnovno ponasanje petlje ----

test("strazi: prazan result nastavlja petlju, a pauzira samo do MIN_RUNDA_MS", async () => {
  const { fetchImpl, pozivi } = laznFetch([
    { ok: true, result: [] },
    { ok: true, result: [{ update_id: 7, message: { chat: { id: 42 } } }] },
  ]);
  const { cekaj, pozivi: cekanja } = laznoCekanje();
  // Sat stoji, pa runda "traje" 0 ms: brana od busy loopa mora dopuniti razliku do MIN_RUNDA_MS.
  // U pogonu cekanje odradi long poll na Telegram strani i brana se ne aktivira.
  const r = await strazi({ token: "T", signal: new AbortController().signal, fetchImpl, cekaj, sada: () => 1000 });
  assert.deepEqual(r, { probudi: true, chatId: "42", updateId: 7 });
  assert.equal(pozivi.length, 2);
  assert.deepEqual(cekanja, [MIN_RUNDA_MS]);
});

test("strazi: INVARIJANTA tijelo je tacno { timeout, limit }, bez offset i allowed_updates", async () => {
  const { fetchImpl, pozivi } = laznFetch([
    { ok: true, result: [] },
    { ok: true, result: [] },
    { ok: true, result: [{ update_id: 1, message: { chat: { id: 1 } } }] },
  ]);
  await strazi({ token: "T", signal: new AbortController().signal, fetchImpl, cekaj: laznoCekanje().cekaj });
  assert.equal(pozivi.length, 3);
  for (const p of pozivi) {
    assert.deepEqual(p.tijelo, { timeout: POLL_TIMEOUT_S, limit: 1 });
    assert.equal(Object.keys(p.tijelo).length, 2);
  }
});

test("strazi: INVARIJANTA svi pozvani URL-ovi zavrsavaju na /getUpdates", async () => {
  const { fetchImpl, pozivi } = laznFetch([
    { ok: true, result: [] },
    { ok: true, result: [{ update_id: 1, message: { chat: { id: 1 } } }] },
  ]);
  await strazi({ token: "tajni-token", signal: new AbortController().signal, fetchImpl, cekaj: laznoCekanje().cekaj });
  assert.ok(pozivi.length > 0);
  for (const p of pozivi) {
    assert.match(p.url, /\/getUpdates$/);
  }
});

test("strazi: neprazan result vraca probudi, tacan chatId i updateId", async () => {
  const { fetchImpl } = laznFetch([{ ok: true, result: [{ update_id: 123, message: { chat: { id: 999 } } }] }]);
  const r = await strazi({ token: "T", signal: new AbortController().signal, fetchImpl, cekaj: laznoCekanje().cekaj });
  assert.deepEqual(r, { probudi: true, chatId: "999", updateId: 123 });
});

test("strazi: poslije budjenja nema novog zahtjeva", async () => {
  const { fetchImpl, pozivi } = laznFetch([
    { ok: true, result: [] },
    { ok: true, result: [{ update_id: 5, message: { chat: { id: 1 } } }] },
  ]);
  const r = await strazi({ token: "T", signal: new AbortController().signal, fetchImpl, cekaj: laznoCekanje().cekaj });
  assert.equal(r.probudi, true);
  assert.equal(pozivi.length, 2);
});

test("strazi: mrezna greska (fetch baci) - backoff niz je 5000,10000,20000,40000,60000,60000", async () => {
  const kontroler = new AbortController();
  const { fetchImpl } = laznFetch(
    Array.from({ length: 6 }, () => new Error("mreza nedostupna")),
  );
  const { cekaj, pozivi: cekanja } = laznoCekanje((duzina) => {
    if (duzina === 6) kontroler.abort();
  });
  const r = await strazi({ token: "T", signal: kontroler.signal, fetchImpl, cekaj, log: () => {} });
  assert.deepEqual(r, { prekinuto: true });
  assert.deepEqual(cekanja, [5000, 10000, 20000, 40000, 60000, 60000]);
});

test("strazi: odgovor ok:false sa error_code 409 - isti backoff, alarm nije pozvan unutar praga", async () => {
  const kontroler = new AbortController();
  const odgovor409 = { ok: false, error_code: 409, description: "Conflict" };
  const { fetchImpl } = laznFetch(Array.from({ length: 3 }, () => odgovor409));
  const { cekaj, pozivi: cekanja } = laznoCekanje((duzina) => {
    if (duzina === 3) kontroler.abort();
  });
  const alarmi = [];
  const r = await strazi({
    token: "T",
    signal: kontroler.signal,
    fetchImpl,
    cekaj,
    log: () => {},
    alarm: (t) => alarmi.push(t),
    sada: () => 0, // vrijeme se ne pomjera, prag se nikad ne dostize
  });
  assert.deepEqual(r, { prekinuto: true });
  assert.deepEqual(cekanja, [5000, 10000, 20000]);
  assert.equal(alarmi.length, 0);
});

test("strazi: tisina duza od TIHO_ALARM_MS - alarm pozvan tacno jednom, ne ponavlja se", async () => {
  const kontroler = new AbortController();
  const sat = { t: 0 };
  const { fetchImpl } = laznFetch(Array.from({ length: 4 }, () => new Error("mreza")));
  const { cekaj, pozivi: cekanja } = laznoCekanje((duzina) => {
    if (duzina === 1) sat.t = 1000; // jos ispod praga
    else if (duzina === 2) sat.t = TIHO_ALARM_MS + 5000; // preko praga
    else if (duzina === 4) kontroler.abort();
  });
  const alarmi = [];
  const r = await strazi({
    token: "T",
    signal: kontroler.signal,
    fetchImpl,
    cekaj,
    log: () => {},
    alarm: (t) => alarmi.push(t),
    sada: () => sat.t,
  });
  assert.deepEqual(r, { prekinuto: true });
  assert.equal(cekanja.length, 4);
  // Runda 1: t=0, jos nema tisine. Runda 2: t=1000, jos nema. Runda 3: t preko praga - alarm.
  // Runda 4: alarmPoslan je vec true, isti prag se ne ponavlja.
  assert.equal(alarmi.length, 1);
  assert.match(alarmi[0], /min/);
});

test("strazi: uspjesan poll poslije niza gresaka resetuje backoff (sljedeca greska ceka opet 5000)", async () => {
  const kontroler = new AbortController();
  const { fetchImpl } = laznFetch([
    new Error("mreza"),
    new Error("mreza"),
    { ok: true, result: [] }, // reset
    new Error("mreza"),
  ]);
  const { cekaj, pozivi: cekanja } = laznoCekanje((duzina) => {
    if (duzina === 4) kontroler.abort();
  });
  const r = await strazi({ token: "T", signal: kontroler.signal, fetchImpl, cekaj, log: () => {}, sada: () => 1000 });
  assert.deepEqual(r, { prekinuto: true });
  // 5000 (greska1), 10000 (greska2), pa uspjesan poll koji resetuje brojac (uz branu od busy
  // loopa jer sat stoji), pa opet 5000 (greska3) umjesto 20000.
  assert.deepEqual(cekanja, [5000, 10000, MIN_RUNDA_MS, 5000]);
});

test("strazi: abort prije prve runde vraca prekinuto i nula fetch poziva", async () => {
  const kontroler = new AbortController();
  kontroler.abort();
  const { fetchImpl, pozivi } = laznFetch([{ ok: true, result: [] }]);
  const r = await strazi({ token: "T", signal: kontroler.signal, fetchImpl, cekaj: laznoCekanje().cekaj });
  assert.deepEqual(r, { prekinuto: true });
  assert.equal(pozivi.length, 0);
});

test("strazi: abort tokom cekanja backoffa vraca prekinuto", async () => {
  const kontroler = new AbortController();
  const { fetchImpl, pozivi } = laznFetch([new Error("mreza")]);
  const cekaj = async () => {
    kontroler.abort();
  };
  const r = await strazi({ token: "T", signal: kontroler.signal, fetchImpl, cekaj, log: () => {} });
  assert.deepEqual(r, { prekinuto: true });
  assert.equal(pozivi.length, 1);
});

// ---- chatIzUpdatea ----

test("chatIzUpdatea: cita chat iz redom message, edited_message, channel_post, callback_query, my_chat_member", () => {
  assert.equal(chatIzUpdatea({ message: { chat: { id: 1 } } }), "1");
  assert.equal(chatIzUpdatea({ edited_message: { chat: { id: 2 } } }), "2");
  assert.equal(chatIzUpdatea({ channel_post: { chat: { id: 3 } } }), "3");
  assert.equal(chatIzUpdatea({ edited_channel_post: { chat: { id: 4 } } }), "4");
  assert.equal(chatIzUpdatea({ callback_query: { message: { chat: { id: 5 } } } }), "5");
  assert.equal(chatIzUpdatea({ my_chat_member: { chat: { id: 6 } } }), "6");
  assert.equal(chatIzUpdatea({}), undefined);
});

// ---- strazarUkljucen ----

test("strazarUkljucen: nedefinisano ili prazno je iskljuceno, bez upozorenja", () => {
  assert.deepEqual(strazarUkljucen({}, true), { ukljucen: false });
  assert.deepEqual(strazarUkljucen({ OLX_SESIJA_STRAZAR: "" }, false), { ukljucen: false });
  assert.deepEqual(strazarUkljucen({ OLX_SESIJA_STRAZAR: "   " }, false), { ukljucen: false });
});

test("strazarUkljucen: '1', ' DA ', 'true' ukljucuju za oba tipa sesije", () => {
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "1" }, true).ukljucen, true);
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "1" }, false).ukljucen, true);
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: " DA " }, false).ukljucen, true);
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "true" }, true).ukljucen, true);
});

test("strazarUkljucen: 'admin' ukljucuje samo admin sesiju", () => {
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "admin" }, true).ukljucen, true);
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "admin" }, false).ukljucen, false);
});

test("strazarUkljucen: 'klijent' ukljucuje samo klijentsku sesiju", () => {
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "klijent" }, false).ukljucen, true);
  assert.equal(strazarUkljucen({ OLX_SESIJA_STRAZAR: "klijent" }, true).ukljucen, false);
});

test("strazarUkljucen: '0' je eksplicitno iskljuceno, bez upozorenja", () => {
  assert.deepEqual(strazarUkljucen({ OLX_SESIJA_STRAZAR: "0" }, true), { ukljucen: false });
  assert.deepEqual(strazarUkljucen({ OLX_SESIJA_STRAZAR: "false" }, true), { ukljucen: false });
});

test("strazarUkljucen: smece daje iskljuceno i upozorenje sa pogresnom vrijednoscu i spiskom", () => {
  const r = strazarUkljucen({ OLX_SESIJA_STRAZAR: "mozda" }, true);
  assert.equal(r.ukljucen, false);
  assert.ok(r.upozorenje);
  assert.match(r.upozorenje, /mozda/);
  assert.match(r.upozorenje, /admin/);
  assert.match(r.upozorenje, /klijent/);
});

// ---- procitajBotToken ----

test("procitajBotToken: cita TELEGRAM_BOT_TOKEN iz <dir>/.env", () => {
  const dir = mkdtempSync(join(tmpdir(), "straza-test-"));
  try {
    writeFileSync(join(dir, ".env"), "TELEGRAM_BOT_TOKEN=123:abc\nDRUGO=nesto\n");
    assert.equal(procitajBotToken(dir), "123:abc");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("procitajBotToken: nedostajuci fajl daje undefined", () => {
  const dir = mkdtempSync(join(tmpdir(), "straza-test-"));
  try {
    assert.equal(procitajBotToken(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("procitajBotToken: prazna vrijednost daje undefined", () => {
  const dir = mkdtempSync(join(tmpdir(), "straza-test-"));
  try {
    writeFileSync(join(dir, ".env"), "TELEGRAM_BOT_TOKEN=\n");
    assert.equal(procitajBotToken(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- backoffMs ----

test("backoffMs: granice 0, 1, 5, 99", () => {
  assert.equal(backoffMs(0), BACKOFF_POCETNI_MS);
  assert.equal(backoffMs(1), 5_000);
  assert.equal(backoffMs(2), 10_000);
  assert.equal(backoffMs(3), 20_000);
  assert.equal(backoffMs(4), 40_000);
  assert.equal(backoffMs(5), BACKOFF_MAX_MS);
  assert.equal(backoffMs(99), BACKOFF_MAX_MS);
});

// ---- posaljiTyping ----

test("posaljiTyping: bez chatId ne poziva fetch", async () => {
  let pozvano = false;
  const r = await posaljiTyping({ token: "T", chatId: undefined, fetchImpl: async () => { pozvano = true; } });
  assert.equal(r, false);
  assert.equal(pozvano, false);
});

test("posaljiTyping: sa chatId salje sendChatAction sa action typing", async () => {
  let zabiljezeno;
  const fetchImpl = async (url, opcije) => {
    zabiljezeno = { url, tijelo: JSON.parse(opcije.body) };
    return { json: async () => ({ ok: true }) };
  };
  const r = await posaljiTyping({ token: "tajni", chatId: "42", fetchImpl });
  assert.equal(r, true);
  assert.match(zabiljezeno.url, /\/sendChatAction$/);
  assert.deepEqual(zabiljezeno.tijelo, { chat_id: "42", action: "typing" });
});

test("posaljiTyping: fetch koji baci daje false, ne baca", async () => {
  const fetchImpl = async () => {
    throw new Error("mreza pukla");
  };
  const r = await posaljiTyping({ token: "T", chatId: "1", fetchImpl });
  assert.equal(r, false);
});
