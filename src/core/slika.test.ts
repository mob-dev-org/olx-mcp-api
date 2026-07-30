import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brojPozivaDanas, zapisiAiPoziv } from "./ai-dnevnik.js";
import { ODNOSI, RECEPTI, ZADANI_ODNOS, maxDnevno, sastaviUputu, slikaKonfigurisana } from "./slika.js";

test("slikaKonfigurisana zavisi samo od OLX_SLIKA_API_KEY", () => {
  assert.equal(slikaKonfigurisana({}), false);
  assert.equal(slikaKonfigurisana({ OLX_SLIKA_API_KEY: "" }), false);
  assert.equal(slikaKonfigurisana({ OLX_SLIKA_API_KEY: "AIza-test" }), true);
});

test("maxDnevno ima razuman default i odbija besmislene vrijednosti", () => {
  assert.equal(maxDnevno({}), 20);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "5" }), 5);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "0" }), 20);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "-3" }), 20);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "nista" }), 20);
});

test("kartica oglasa je pejzazna, pa je zadani odnos 4:3", () => {
  assert.equal(ZADANI_ODNOS, "4:3");
  assert.ok(ODNOSI.includes(ZADANI_ODNOS));
});

test("sastaviUputu ubaci ime firme u recept", () => {
  const uputa = sastaviUputu("auto-salon", "AUTO KUCA MAHIR");
  assert.ok(uputa.includes("AUTO KUCA MAHIR"));
  assert.ok(!uputa.includes("{LOGO}"));
});

test("bez imena firme recenica sa logom se izbaci, ne ostaje placeholder", () => {
  const uputa = sastaviUputu("auto-salon");
  assert.ok(!uputa.includes("{LOGO}"));
  assert.ok(!uputa.toLowerCase().includes("dealership sign"));
  // ostatak recepta mora prezivjeti
  assert.ok(uputa.includes("showroom"));
});

test("sastaviUputu prihvata i slobodan tekst umjesto imena recepta", () => {
  assert.equal(sastaviUputu("moja vlastita uputa"), "moja vlastita uputa");
});

test("svaki recept zabranjuje popravljanje artikla ili dodavanje teksta", () => {
  for (const [ime, tekst] of Object.entries(RECEPTI)) {
    assert.ok(/watermark/i.test(tekst), `recept ${ime} mora zabraniti vodeni znak`);
    assert.ok(/\btext\b/i.test(tekst), `recept ${ime} mora rijesiti pitanje teksta na slici`);
  }
  // Recepti za stvarni artikal moraju cuvati njegovo stanje, da slika ne laze kupca.
  for (const ime of ["proizvod-bijela", "auto-salon"]) {
    const tekst = RECEPTI[ime] ?? "";
    assert.ok(/do not repair|do not remove scratches/i.test(tekst), `recept ${ime} mora cuvati stanje`);
  }
});

test("brojPozivaDanas broji samo uspjele pozive traženog izvora za današnji dan", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-dnevnik-"));
  const fajl = join(dir, "ai-usage.jsonl");
  const staro = process.env.OLX_AI_USAGE_FILE;
  process.env.OLX_AI_USAGE_FILE = fajl;
  try {
    assert.equal(brojPozivaDanas("slika"), 0, "bez fajla je nula");

    zapisiAiPoziv({ izvor: "slika", zadatak: "generisanje_slike", model: "m", trajanjeMs: 1, ok: true });
    zapisiAiPoziv({ izvor: "slika", zadatak: "generisanje_slike", model: "m", trajanjeMs: 1, ok: true });
    zapisiAiPoziv({ izvor: "slika", zadatak: "generisanje_slike", model: "m", trajanjeMs: 1, ok: false, greska: "pao" });
    zapisiAiPoziv({ izvor: "vid", zadatak: "opis_slike", model: "m", trajanjeMs: 1, ok: true });

    assert.equal(brojPozivaDanas("slika"), 2, "neuspjeli poziv i drugi izvor se ne racunaju");
    assert.equal(brojPozivaDanas("vid"), 1);
    assert.equal(brojPozivaDanas("slika", "2020-01-01"), 0, "drugi dan je nula");

    // pokvaren red ne smije oboriti brojanje
    writeFileSync(fajl, "{ovo nije json}\n", { flag: "a" });
    assert.equal(brojPozivaDanas("slika"), 2);
  } finally {
    if (staro === undefined) delete process.env.OLX_AI_USAGE_FILE;
    else process.env.OLX_AI_USAGE_FILE = staro;
  }
});
