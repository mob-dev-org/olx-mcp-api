// Testovi cistih dijelova Telegram mosta. Tezisna tacka je `dozvoljena`, jer je to kontrola
// pristupa (ko smije pisati botu) i do sada je bila potpuno nepokrivena. Isti stil kao
// scripts/lib/sesija.test.mjs i scripts/lib/straza.test.mjs (node:test + node:assert/strict).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZABRANJENI_ALATI,
  argviSesije,
  dozvoljena,
  idleRokMs,
  izvorSlike,
  lokalniDatum,
  tekstStavke,
  trebaLiNocniRez,
  trebaLiUgasiti,
  trebaLiUzorkovati,
} from "./most.mjs";

// ---- dozvoljena: privatna poruka ----

test("dozvoljena: privatna poruka od posiljaoca u allowFrom prolazi", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: ["111"], groups: {} };
  const poruka = { from: { id: 111 }, chat: { type: "private" } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), true);
});

test("dozvoljena: privatna poruka od posiljaoca koji NIJE u allowFrom je odbijena", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: ["111"], groups: {} };
  const poruka = { from: { id: 222 }, chat: { type: "private" } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), false);
});

test("dozvoljena: dmPolicy disabled odbija cak i posiljaoca iz allowFrom", () => {
  const pristup = { dmPolicy: "disabled", allowFrom: ["111"], groups: {} };
  const poruka = { from: { id: 111 }, chat: { type: "private" } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), false);
});

test("dozvoljena: poruka bez from.id je odbijena", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: ["111"], groups: {} };
  const poruka = { chat: { type: "private" } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), false);
});

// ---- dozvoljena: grupa ----

test("dozvoljena: grupa koja nije u pristup.groups je odbijena", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: {} };
  const poruka = { from: { id: 111 }, chat: { type: "group", id: -100 }, text: "@bot zdravo" };
  assert.equal(dozvoljena(poruka, pristup, "bot"), false);
});

test("dozvoljena: grupa sa praznim allowFrom prima svakog posiljaoca", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: { "-100": { allowFrom: [], requireMention: false } } };
  const poruka = { from: { id: 999 }, chat: { type: "group", id: -100 } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), true);
});

test("dozvoljena: grupa sa popunjenim allowFrom pusta samo posiljaoca sa te liste", () => {
  const pristup = {
    dmPolicy: "allowlist",
    allowFrom: [],
    groups: { "-100": { allowFrom: ["111"], requireMention: false } },
  };
  assert.equal(
    dozvoljena({ from: { id: 111 }, chat: { type: "group", id: -100 } }, pristup, "bot"),
    true,
  );
  assert.equal(
    dozvoljena({ from: { id: 222 }, chat: { type: "group", id: -100 } }, pristup, "bot"),
    false,
  );
});

test("dozvoljena: requireMention podrazumijevano true (izostavljeno polje)", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: { "-100": { allowFrom: [] } } };
  const bezPomena = { from: { id: 1 }, chat: { type: "group", id: -100 }, text: "zdravo" };
  const saPomenom = { from: { id: 1 }, chat: { type: "group", id: -100 }, text: "@bot zdravo" };
  assert.equal(dozvoljena(bezPomena, pristup, "bot"), false);
  assert.equal(dozvoljena(saPomenom, pristup, "bot"), true);
});

test("dozvoljena: requireMention false prolazi i bez pomena", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: { "-100": { allowFrom: [], requireMention: false } } };
  const poruka = { from: { id: 1 }, chat: { type: "group", id: -100 }, text: "zdravo" };
  assert.equal(dozvoljena(poruka, pristup, "bot"), true);
});

test("dozvoljena: requireMention true a botIme je null je odbijena", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: { "-100": { allowFrom: [], requireMention: true } } };
  const poruka = { from: { id: 1 }, chat: { type: "group", id: -100 }, text: "@bot zdravo" };
  assert.equal(dozvoljena(poruka, pristup, null), false);
});

test("dozvoljena: pomen se cita i iz caption, ne samo iz text", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: [], groups: { "-100": { allowFrom: [], requireMention: true } } };
  const poruka = { from: { id: 1 }, chat: { type: "group", id: -100 }, caption: "@bot slika" };
  assert.equal(dozvoljena(poruka, pristup, "bot"), true);
});

test("dozvoljena: ID-jevi se porede kao stringovi (from.id broj, allowFrom string)", () => {
  const pristup = {
    dmPolicy: "allowlist",
    allowFrom: [],
    groups: { "-100": { allowFrom: ["111"], requireMention: false } },
  };
  const poruka = { from: { id: 111 }, chat: { type: "group", id: -100 } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), true);
});

test("dozvoljena: nepoznat tip chata je odbijen", () => {
  const pristup = { dmPolicy: "allowlist", allowFrom: ["111"], groups: { "-100": { allowFrom: [] } } };
  const poruka = { from: { id: 111 }, chat: { type: "channel", id: -100 } };
  assert.equal(dozvoljena(poruka, pristup, "bot"), false);
});

// ---- izvorSlike ----

test("izvorSlike: document sa mime image/jpeg ima prednost nad photo", () => {
  const poruka = {
    document: { file_id: "doc1", file_unique_id: "u1", mime_type: "image/jpeg", file_size: 10 },
    photo: [{ file_id: "p1", file_unique_id: "u2", file_size: 5 }],
  };
  assert.deepEqual(izvorSlike(poruka), { fileId: "doc1", kljuc: "u1", velicina: 10 });
});

test("izvorSlike: document application/pdf se ignorise, uzima se photo ako postoji", () => {
  const poruka = {
    document: { file_id: "doc1", file_unique_id: "u1", mime_type: "application/pdf", file_size: 10 },
    photo: [{ file_id: "p1", file_unique_id: "u2", file_size: 5 }],
  };
  assert.deepEqual(izvorSlike(poruka), { fileId: "p1", kljuc: "u2", velicina: 5 });
});

test("izvorSlike: document application/pdf bez photo daje null", () => {
  const poruka = { document: { file_id: "doc1", file_unique_id: "u1", mime_type: "application/pdf", file_size: 10 } };
  assert.equal(izvorSlike(poruka), null);
});

test("izvorSlike: iz photo niza se uzima zadnja (najveca) velicina", () => {
  const poruka = {
    photo: [
      { file_id: "mala", file_unique_id: "m", file_size: 1 },
      { file_id: "velika", file_unique_id: "v", file_size: 100 },
    ],
  };
  assert.deepEqual(izvorSlike(poruka), { fileId: "velika", kljuc: "v", velicina: 100 });
});

test("izvorSlike: poruka bez document i photo vraca null", () => {
  assert.equal(izvorSlike({}), null);
});

// ---- tekstStavke ----

test("tekstStavke: bez teksta daje (bez teksta)", () => {
  assert.equal(tekstStavke({ tekst: "", slike: [] }), "(bez teksta)");
});

test("tekstStavke: jedna slika daje jedninu", () => {
  const r = tekstStavke({ tekst: "zdravo", slike: ["/a/b.jpg"] });
  assert.match(r, /Poslana je fotografija/);
  assert.match(r, /\/a\/b\.jpg/);
});

test("tekstStavke: vise slika daje mnozinu sa brojem", () => {
  const r = tekstStavke({ tekst: "zdravo", slike: ["/a/1.jpg", "/a/2.jpg"] });
  assert.match(r, /Poslano je 2 fotografija/);
  assert.match(r, /\/a\/1\.jpg, \/a\/2\.jpg/);
});

// ---- argviSesije ----

test("argviSesije: nastavak true daje --resume sa id-om na kraju", () => {
  const argv = argviSesije({ id: "sid-1", nastavak: true, promptPutanja: "/tmp/prompt.md" });
  assert.deepEqual(argv.slice(-2), ["--resume", "sid-1"]);
});

test("argviSesije: nastavak false daje --session-id sa id-om na kraju", () => {
  const argv = argviSesije({ id: "sid-2", nastavak: false, promptPutanja: "/tmp/prompt.md" });
  assert.deepEqual(argv.slice(-2), ["--session-id", "sid-2"]);
});

test("argviSesije: promptPutanja stoji tacno iza --append-system-prompt-file", () => {
  const argv = argviSesije({ id: "sid-3", nastavak: false, promptPutanja: "/tmp/prompt.md" });
  const i = argv.indexOf("--append-system-prompt-file");
  assert.ok(i >= 0);
  assert.equal(argv[i + 1], "/tmp/prompt.md");
});

test("argviSesije: sadrzi --strict-mcp-config i --allowedTools mcp__olx-pik", () => {
  const argv = argviSesije({ id: "sid-4", nastavak: false, promptPutanja: "/tmp/prompt.md" });
  assert.ok(argv.includes("--strict-mcp-config"));
  const i = argv.indexOf("--allowedTools");
  assert.ok(i >= 0);
  assert.equal(argv[i + 1], "mcp__olx-pik");
});

test("argviSesije: --disallowedTools nosi tacno ZABRANJENI_ALATI, tim redom", () => {
  const argv = argviSesije({ id: "sid-5", nastavak: false, promptPutanja: "/tmp/prompt.md" });
  const i = argv.indexOf("--disallowedTools");
  assert.ok(i >= 0);
  assert.deepEqual(argv.slice(i + 1, i + 1 + ZABRANJENI_ALATI.length), ZABRANJENI_ALATI);
});

// ---- idleRokMs / trebaLiUgasiti ----

test("idleRokMs: 30 daje 1800000", () => {
  assert.equal(idleRokMs(30), 1800000);
});

test("idleRokMs: 0 daje null (iskljuceno)", () => {
  assert.equal(idleRokMs(0), null);
});

test("idleRokMs: negativna vrijednost daje null", () => {
  assert.equal(idleRokMs(-5), null);
});

test("idleRokMs: nevaljan unos daje null", () => {
  assert.equal(idleRokMs("abc"), null);
  assert.equal(idleRokMs(undefined), null);
});

test("idleRokMs: decimalna vrijednost 0.05 daje 3000 (mala vrijednost za rucnu probu)", () => {
  assert.equal(idleRokMs(0.05), 3000);
});

test("trebaLiUgasiti: sad tacno na roku daje true (granica je ukljucena)", () => {
  const zadnja = 0;
  const rok = idleRokMs(1); // 60000
  assert.equal(trebaLiUgasiti(zadnja, zadnja + rok, 1), true);
});

test("trebaLiUgasiti: milisekundu prije roka daje false", () => {
  const zadnja = 0;
  const rok = idleRokMs(1);
  assert.equal(trebaLiUgasiti(zadnja, zadnja + rok - 1, 1), false);
});

test("trebaLiUgasiti: idleMin 0 uvijek daje false, ma koliko vremena proslo", () => {
  assert.equal(trebaLiUgasiti(0, Number.MAX_SAFE_INTEGER, 0), false);
});

// ---- lokalniDatum ----

test("lokalniDatum: jednocifreni mjesec i dan dobiju vodecu nulu", () => {
  assert.equal(lokalniDatum(new Date(2026, 0, 5, 10, 0, 0)), "2026-01-05");
});

test("lokalniDatum: kraj godine ostaje u istoj godini", () => {
  assert.equal(lokalniDatum(new Date(2026, 11, 31, 23, 59, 0)), "2026-12-31");
});

// ---- trebaLiNocniRez ----

test("trebaLiNocniRez: pogodjen sat i nov dan daje true", () => {
  const sad = new Date(2026, 7, 15, 4, 0, 0);
  assert.equal(trebaLiNocniRez({ sad, restartSat: 4, zadnjiNocni: "2026-08-14", zauzet: false }), true);
});

test("trebaLiNocniRez: isti dan drugi put daje false (idempotencija u istom danu)", () => {
  const sad = new Date(2026, 7, 15, 4, 30, 0);
  assert.equal(trebaLiNocniRez({ sad, restartSat: 4, zadnjiNocni: "2026-08-15", zauzet: false }), false);
});

test("trebaLiNocniRez: pogresan sat daje false", () => {
  const sad = new Date(2026, 7, 15, 5, 0, 0);
  assert.equal(trebaLiNocniRez({ sad, restartSat: 4, zadnjiNocni: "2026-08-14", zauzet: false }), false);
});

test("trebaLiNocniRez: zauzet true daje false iako je sat pogodjen", () => {
  const sad = new Date(2026, 7, 15, 4, 0, 0);
  assert.equal(trebaLiNocniRez({ sad, restartSat: 4, zadnjiNocni: "2026-08-14", zauzet: true }), false);
});

test("trebaLiNocniRez: nevaljan restartSat daje false", () => {
  const sad = new Date(2026, 7, 15, 4, 0, 0);
  for (const restartSat of [-1, 24, NaN, undefined]) {
    assert.equal(trebaLiNocniRez({ sad, restartSat, zadnjiNocni: "2026-08-14", zauzet: false }), false);
  }
});

test("trebaLiNocniRez: nakon promjene datuma isti sat sljedeceg dana ponovo daje true", () => {
  const danas = new Date(2026, 7, 15, 4, 0, 0);
  const sutra = new Date(2026, 7, 16, 4, 0, 0);
  assert.equal(trebaLiNocniRez({ sad: danas, restartSat: 4, zadnjiNocni: "2026-08-14", zauzet: false }), true);
  assert.equal(trebaLiNocniRez({ sad: sutra, restartSat: 4, zadnjiNocni: "2026-08-15", zauzet: false }), true);
});

// ---- trebaLiUzorkovati ----

test("trebaLiUzorkovati: pogodjena minuta daje true", () => {
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 10, intervalMin: 5, pomak: 0, zadnjaUzorkovanaMinuta: -1 }),
    true,
  );
});

test("trebaLiUzorkovati: ista minuta drugi put daje false", () => {
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 10, intervalMin: 5, pomak: 0, zadnjaUzorkovanaMinuta: 10 }),
    false,
  );
});

test("trebaLiUzorkovati: nepogodjena minuta daje false", () => {
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 11, intervalMin: 5, pomak: 0, zadnjaUzorkovanaMinuta: -1 }),
    false,
  );
});

test("trebaLiUzorkovati: intervalMin 0 ili negativan daje false", () => {
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 10, intervalMin: 0, pomak: 0, zadnjaUzorkovanaMinuta: -1 }),
    false,
  );
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 10, intervalMin: -5, pomak: 0, zadnjaUzorkovanaMinuta: -1 }),
    false,
  );
});

test("trebaLiUzorkovati: pomak veci od intervala se ispravno modulira", () => {
  // pomak 7 uz interval 5 je isto sto i pomak 2: pogadja minute ...2, 7, 12...
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 12, intervalMin: 5, pomak: 7, zadnjaUzorkovanaMinuta: -1 }),
    true,
  );
  assert.equal(
    trebaLiUzorkovati({ minutaOdEpoha: 10, intervalMin: 5, pomak: 7, zadnjaUzorkovanaMinuta: -1 }),
    false,
  );
});
