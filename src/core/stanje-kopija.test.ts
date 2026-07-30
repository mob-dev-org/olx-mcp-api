import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { kopirajURadnu, popisiStanje, uporediSaKopijom, vratiIzRadne } from "./stanje-kopija.js";

function klon(fajlovi: Record<string, string>): string {
  const korijen = mkdtempSync(join(tmpdir(), "olx-klon-"));
  for (const [rel, sadrzaj] of Object.entries(fajlovi)) {
    const puna = join(korijen, rel);
    mkdirSync(join(puna, ".."), { recursive: true });
    writeFileSync(puna, sadrzaj, "utf8");
  }
  return korijen;
}

function praznaRadna(): string {
  return mkdtempSync(join(tmpdir(), "olx-radna-"));
}

test("popis nalazi stanje, a kroz velike mape ne prolazi", () => {
  const korijen = klon({
    ".olx-pik/pamcenje.json": "{}",
    ".olx-pik/snapshots/views-2026-07-29.json": "{}",
    ".olx-pik/slike/slika-1.png": "x",
    ".olx-pik/slike/slika-2.png": "x",
    "KLIJENT.md": "kontekst",
    "package.json": "{}",
  });
  const p = popisiStanje(korijen);
  assert.ok(p.includes(".olx-pik/pamcenje.json"));
  assert.ok(p.includes(".olx-pik/snapshots/views-2026-07-29.json"));
  assert.ok(p.includes("KLIJENT.md"));
  assert.ok(p.includes(".olx-pik/slike"), "crna mapa se vraca kao jedna stavka, da se prijavi kao preskocena");
  assert.ok(!p.some((x) => x.startsWith(".olx-pik/slike/")), "kroz crnu mapu se ne prolazi");
  assert.ok(!p.includes("package.json"), "kod nije stanje");
});

test("prazan klon daje prazan popis, ne gresku", () => {
  assert.deepEqual(popisiStanje(mkdtempSync(join(tmpdir(), "olx-prazan-"))), []);
});

test("kopija prenosi sadrzaj i cuva strukturu", () => {
  const korijen = klon({ ".olx-pik/pamcenje.json": '{"ton":"na ti"}', ".olx-pik/snapshots/views-2026-07-29.json": '{"ts":1}' });
  const radna = praznaRadna();
  const r = kopirajURadnu(korijen, radna, [".olx-pik/pamcenje.json", ".olx-pik/snapshots/views-2026-07-29.json"]);
  assert.equal(r.upisano.length, 2);
  assert.equal(readFileSync(join(radna, ".olx-pik/pamcenje.json"), "utf8"), '{"ton":"na ti"}');
});

test("nepotpun zadnji red jsonl-a se ne prenosi", () => {
  // Audit se dopisuje dok backup radi, pa kopija moze uhvatiti pola reda.
  const korijen = klon({ ".olx-pik/audit.jsonl": '{"a":1}\n{"b":' });
  const radna = praznaRadna();
  kopirajURadnu(korijen, radna, [".olx-pik/audit.jsonl"]);
  assert.equal(readFileSync(join(radna, ".olx-pik/audit.jsonl"), "utf8"), '{"a":1}\n');
});

test("fajl sa tajnom se zaustavlja i prijavljuje, ne salje se", () => {
  const korijen = klon({ ".olx-pik/saznanja.jsonl": '{"tekst":"token je 1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}\n' });
  const radna = praznaRadna();
  const r = kopirajURadnu(korijen, radna, [".olx-pik/saznanja.jsonl"]);
  assert.equal(r.upisano.length, 0, "sumnjiv fajl se NE upisuje");
  assert.equal(r.sumnjivi.length, 1);
  assert.ok(r.sumnjivi[0]?.nalazi.includes("Telegram bot token"));
});

test("backup ne brise ono cega vise nema u klonu", () => {
  // Nestanak fajla je ili uredno ciscenje ili nesreca; backup koji prati nesrecu nije backup.
  const korijen = klon({ ".olx-pik/pamcenje.json": "{}" });
  const radna = praznaRadna();
  kopirajURadnu(korijen, radna, [".olx-pik/pamcenje.json", ".olx-pik/izuzeca.json"]);
  writeFileSync(join(radna, "staro.json"), "{}", "utf8");
  kopirajURadnu(korijen, radna, [".olx-pik/pamcenje.json"]);
  assert.equal(readFileSync(join(radna, "staro.json"), "utf8"), "{}", "zaostali fajl ostaje");
});

test("vracanje ne gazi postojece bez izricitog pregazi", () => {
  const korijen = klon({ ".olx-pik/pamcenje.json": "novo" });
  const radna = praznaRadna();
  mkdirSync(join(radna, ".olx-pik"), { recursive: true });
  writeFileSync(join(radna, ".olx-pik/pamcenje.json"), "staro", "utf8");

  const bez = vratiIzRadne(radna, korijen, [".olx-pik/pamcenje.json"]);
  assert.deepEqual(bez.preskoceno, [".olx-pik/pamcenje.json"]);
  assert.equal(readFileSync(join(korijen, ".olx-pik/pamcenje.json"), "utf8"), "novo", "dan rada nije pregazen");

  const sa = vratiIzRadne(radna, korijen, [".olx-pik/pamcenje.json"], true);
  assert.deepEqual(sa.vraceno, [".olx-pik/pamcenje.json"]);
  assert.equal(readFileSync(join(korijen, ".olx-pik/pamcenje.json"), "utf8"), "staro");
});

test("poredjenje javlja tacnu vrstu razlike", () => {
  const korijen = klon({ ".olx-pik/pamcenje.json": "a", ".olx-pik/izuzeca.json": "isto" });
  const radna = praznaRadna();
  kopirajURadnu(korijen, radna, [".olx-pik/izuzeca.json"]);
  const r = uporediSaKopijom(korijen, radna, [".olx-pik/pamcenje.json", ".olx-pik/izuzeca.json"]);
  assert.deepEqual(r, [{ putanja: ".olx-pik/pamcenje.json", vrsta: "fali u kopiji" }]);
});

test("nepotpun red u klonu nije razlika prema kopiji", () => {
  const korijen = klon({ ".olx-pik/audit.jsonl": '{"a":1}\n' });
  const radna = praznaRadna();
  kopirajURadnu(korijen, radna, [".olx-pik/audit.jsonl"]);
  writeFileSync(join(korijen, ".olx-pik/audit.jsonl"), '{"a":1}\n{"nepot', "utf8");
  assert.deepEqual(uporediSaKopijom(korijen, radna, [".olx-pik/audit.jsonl"]), [], "rep u pisanju nije razlika");
});
