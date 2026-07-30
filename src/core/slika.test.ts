import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brojPozivaDanas, zapisiAiPoziv } from "./ai-dnevnik.js";
import { ODNOSI, RECEPTI, ZADANI_ODNOS, dimenzijeSlike, jeUrl, maxDnevno, najbliziOdnos, sastaviUputu, slikaKonfigurisana } from "./slika.js";

test("slikaKonfigurisana zavisi samo od OLX_SLIKA_API_KEY", () => {
  assert.equal(slikaKonfigurisana({}), false);
  assert.equal(slikaKonfigurisana({ OLX_SLIKA_API_KEY: "" }), false);
  assert.equal(slikaKonfigurisana({ OLX_SLIKA_API_KEY: "AIza-test" }), true);
});

test("maxDnevno ima razuman default i odbija besmislene vrijednosti", () => {
  assert.equal(maxDnevno({}), 10);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "5" }), 5);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "0" }), 10);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "-3" }), 10);
  assert.equal(maxDnevno({ OLX_SLIKA_MAX_DNEVNO: "nista" }), 10);
});

test("jeUrl razlikuje sliku sa oglasa od lokalne putanje", () => {
  assert.equal(jeUrl("https://d4n0y8dshd77z.cloudfront.net/listings/1/lg/img-1.jpg"), true);
  assert.equal(jeUrl("http://primjer.ba/slika.png"), true);
  assert.equal(jeUrl("  https://primjer.ba/a.jpg  "), true, "razmaci ne smiju prevariti provjeru");
  assert.equal(jeUrl("/inbox/1234-abc.jpg"), false);
  assert.equal(jeUrl("C:\\inbox\\slika.jpg"), false, "Windows putanja nije URL");
  assert.equal(jeUrl("slika.jpg"), false);
});

test("najbliziOdnos uzme odnos od ulazne slike, a ne fiksni 4:3", () => {
  // Portretna slika je bila uzrok problema: 4:3 je prisilio model da prekomponuje kadar.
  assert.equal(najbliziOdnos(588, 812), "3:4", "portret dobija portretni odnos");
  assert.equal(najbliziOdnos(1200, 896), "4:3", "pejzaz ostaje pejzaz");
  assert.equal(najbliziOdnos(1024, 1024), "1:1");
  assert.equal(najbliziOdnos(1920, 1080), "16:9");
  assert.equal(najbliziOdnos(1080, 1920), "9:16");
  // Sve mora biti iz podrzanog popisa, inace Gemini odbije zahtjev.
  for (const [s, v] of [[100, 37], [3, 7], [5000, 1]] as [number, number][]) {
    assert.ok(ODNOSI.includes(najbliziOdnos(s, v)), `${s}x${v} daje nepodrzan odnos`);
  }
});

test("najbliziOdnos na besmislenim dimenzijama pada na zadani odnos", () => {
  for (const [s, v] of [[0, 100], [100, 0], [-5, 5], [Number.NaN, 10]] as [number, number][]) {
    assert.equal(najbliziOdnos(s, v), ZADANI_ODNOS);
  }
});

test("dimenzijeSlike cita PNG zaglavlje", () => {
  // Minimalno PNG zaglavlje: potpis, duzina i tip IHDR, pa sirina i visina.
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(896, 20);
  assert.deepEqual(dimenzijeSlike(b), { sirina: 1200, visina: 896 });
});

test("dimenzijeSlike cita JPEG SOF marker", () => {
  // FFD8 pa APP0 segment koji se preskace, pa SOF0 sa visinom i sirinom.
  const b = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), // APP0, duzina 4
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), // SOF0, duzina 17, precision 8
    (() => {
      const d = Buffer.alloc(4);
      d.writeUInt16BE(812, 0); // visina
      d.writeUInt16BE(588, 2); // sirina
      return d;
    })(),
    Buffer.alloc(10),
  ]);
  assert.deepEqual(dimenzijeSlike(b), { sirina: 588, visina: 812 });
});

test("dimenzijeSlike vraca null za nepoznat format, bez petlje na pokvarenom zaglavlju", () => {
  assert.equal(dimenzijeSlike(Buffer.from("ovo nije slika")), null);
  assert.equal(dimenzijeSlike(Buffer.alloc(0)), null);
  // JPEG potpis pa duzina segmenta 0: ne smije se vrtjeti u krug.
  assert.equal(dimenzijeSlike(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), null);
});

test("svaki recept trazi da artikal ispuni kadar", () => {
  // Bez toga model ostavi bijelu prazninu i artikal se na telefonu vidi kao skupljen.
  for (const [ime, tekst] of Object.entries(RECEPTI)) {
    assert.ok(/fills the frame/i.test(tekst), `recept ${ime} ne trazi da subjekt ispuni kadar`);
  }
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
