import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizujUsername, sazmiSpomenute, ucitajSpomenute, zabiljeziSpomenutog } from "./spomenuti-konkurenti.js";

function privremenaPutanja(): string {
  return join(mkdtempSync(join(tmpdir(), "spomenuti-")), "spomenuti-konkurenti.jsonl");
}

test("normalizujUsername: skida link, @ i visak oko imena", () => {
  // Covjek ime zalijepi kako mu dodje. Kad se to ne ocisti, isti konkurent zavrsi kao tri zapisa.
  assert.equal(normalizujUsername("  MixBox "), "MixBox");
  assert.equal(normalizujUsername("@MixBox"), "MixBox");
  assert.equal(normalizujUsername("https://olx.ba/korisnik/MixBox"), "MixBox");
  assert.equal(normalizujUsername("https://pik.ba/shop/MixBox/oglasi?page=2"), "MixBox");
  assert.equal(normalizujUsername("   "), "");
});

test("normalizujUsername: cijela poruka se svodi na prvu rijec i kratku duzinu", () => {
  // Brana protiv toga da zapis postane preprican razgovor: smije nositi ime, ne poruku covjeka.
  assert.equal(normalizujUsername("MixBox prodaje jeftinije nego ja, pogledaj"), "MixBox");
  assert.equal(normalizujUsername("x".repeat(300)).length, 60);
});

test("zabiljeziSpomenutog: upisuje red i vraca ocisceno ime", () => {
  const putanja = privremenaPutanja();
  const ime = zabiljeziSpomenutog("@HaubaBa", "spomenuo cijene guma", putanja, new Date("2026-08-15T10:00:00Z"));
  assert.equal(ime, "HaubaBa");
  const red = JSON.parse(readFileSync(putanja, "utf8").trim());
  assert.equal(red.username, "HaubaBa");
  assert.equal(red.kada, "2026-08-15T10:00:00.000Z");
  assert.equal(red.napomena, "spomenuo cijene guma");
});

test("zabiljeziSpomenutog: prazan unos ne upisuje nista i vraca prazno", () => {
  const putanja = privremenaPutanja();
  assert.equal(zabiljeziSpomenutog("   ", undefined, putanja), "");
  assert.deepEqual(ucitajSpomenute(putanja), []);
});

test("ucitajSpomenute: sazima ponavljanja i broji ih", () => {
  const putanja = privremenaPutanja();
  zabiljeziSpomenutog("HaubaBa", "prvi put", putanja, new Date("2026-08-10T10:00:00Z"));
  zabiljeziSpomenutog("haubaba", "opet on", putanja, new Date("2026-08-14T10:00:00Z"));
  zabiljeziSpomenutog("MATIVdoo", undefined, putanja, new Date("2026-08-12T10:00:00Z"));

  const spisak = ucitajSpomenute(putanja);
  assert.equal(spisak.length, 2, "isto ime u dvije velicine slova mora ostati jedan zapis");
  // Sortirano po zadnjem spominjanju, najsvjezije prvo.
  const [prvi, drugi] = spisak;
  assert.ok(prvi && drugi);
  assert.equal(prvi.username, "HaubaBa");
  assert.equal(prvi.puta, 2);
  assert.equal(prvi.prvi_put, "2026-08-10T10:00:00.000Z");
  assert.equal(prvi.zadnji_put, "2026-08-14T10:00:00.000Z");
  assert.equal(prvi.napomena, "opet on", "zadnja napomena je najsvjezija slika");
  assert.equal(drugi.username, "MATIVdoo");
});

test("ucitajSpomenute: nema fajla znaci prazan spisak, ne greska", () => {
  assert.deepEqual(ucitajSpomenute(join(tmpdir(), "ne-postoji-spomenuti.jsonl")), []);
});

test("sazmiSpomenute: pokvaren red se preskace, ostatak prolazi", () => {
  // Fajl je append-only i pise ga zivi bot; jedan polovicno upisan red ne smije odnijeti cijeli
  // spisak, jer bi tada jedan pad procesa obrisao sve sto smo o konkurentima saznali.
  const putanja = privremenaPutanja();
  zabiljeziSpomenutog("HaubaBa", undefined, putanja, new Date("2026-08-10T10:00:00Z"));
  appendFileSync(putanja, '{"username":"pola\n', "utf8");
  zabiljeziSpomenutog("MATIVdoo", undefined, putanja, new Date("2026-08-11T10:00:00Z"));
  const spisak = ucitajSpomenute(putanja);
  assert.deepEqual(spisak.map((z) => z.username).sort(), ["HaubaBa", "MATIVdoo"]);
});

test("sazmiSpomenute: red bez imena ili bez vremena ispada", () => {
  const spisak = sazmiSpomenute([
    { username: "HaubaBa", kada: "2026-08-10T10:00:00.000Z" },
    { username: "   ", kada: "2026-08-11T10:00:00.000Z" },
  ]);
  assert.deepEqual(
    spisak.map((z) => z.username),
    ["HaubaBa"],
  );
});
