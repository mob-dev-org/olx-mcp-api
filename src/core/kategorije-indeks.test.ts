// Testovi za suziKategorijeIndeks: rez mora biti vidljiv (napomena + brojevi), a zaglavlje i
// kolone se ne smiju mijenjati.

import test from "node:test";
import assert from "node:assert/strict";
import { PODRAZUMIJEVAN_MAX_NIVO, suziKategorijeIndeks } from "./kategorije-indeks.js";

const ZAGLAVLJE = "id,parent_id,level,path,name,brand_required,model_required,has_models,show_condition,listing_fee,base_listing_price";

const PRIMJER_CSV =
  [
    ZAGLAVLJE,
    "1,,1,Vozila,Vozila,0,0,0,1,0,0",
    "18,1,2,Vozila > Automobili,Automobili,0,0,0,1,70,18",
    "99,18,3,Vozila > Automobili > BMW,BMW,1,0,1,1,70,18",
    '100,18,3,"Vozila > Automobili > Mercedes, Benz",Mercedes,1,0,1,1,70,18',
    "101,99,4,Vozila > Automobili > BMW > Serija 3,Serija 3,0,1,1,1,70,18",
  ].join("\n") + "\n";

test("suziKategorijeIndeks: zadrzava samo redove do zadanog nivoa", () => {
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 2);
  assert.equal(rez.ukupno, 5);
  assert.equal(rez.prikazano, 2);
  assert.equal(rez.maxNivo, 2);
});

test("suziKategorijeIndeks: napomena o rezu je vidljiva na vrhu i nosi brojeve", () => {
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 2);
  const prviRedovi = rez.text.split("\n").slice(0, 4);
  assert.ok(prviRedovi.every((r) => r.startsWith("#")), "prva 4 reda su komentari napomene");
  assert.ok(rez.text.includes("Prikazano 2 od 5"));
  assert.ok(rez.text.includes("olx_find_category"));
  assert.ok(rez.text.includes("olx_category_children"));
});

test("suziKategorijeIndeks: zaglavlje ostaje nepromijenjeno i dolazi poslije napomene", () => {
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 2);
  const redovi = rez.text.split("\n");
  const zaglavljeIdx = redovi.indexOf(ZAGLAVLJE);
  assert.ok(zaglavljeIdx > 0, "zaglavlje postoji i nije prvi red");
  assert.ok(redovi.slice(0, zaglavljeIdx).every((r) => r.startsWith("#")));
});

test("suziKategorijeIndeks: postovanje navodnika sa zarezom u polju (path)", () => {
  // Red za "Mercedes, Benz" ima level 3 pa ne ulazi u rez do nivoa 2, ali provjeri da parsiranje
  // reda sa zarezom unutar navodnika ne pomjeri kolonu level za redove koji JESU relevantni.
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 3);
  assert.equal(rez.prikazano, 4); // sve osim reda na nivou 4
});

test("suziKategorijeIndeks: podrazumijevani prag suzava a ne prazni", () => {
  const rez = suziKategorijeIndeks(PRIMJER_CSV);
  assert.equal(rez.maxNivo, PODRAZUMIJEVAN_MAX_NIVO);
  assert.ok(rez.prikazano > 0);
  assert.ok(rez.prikazano < rez.ukupno);
});

test("suziKategorijeIndeks: prazan CSV (samo zaglavlje) ne puca", () => {
  const rez = suziKategorijeIndeks(ZAGLAVLJE + "\n", 2);
  assert.equal(rez.ukupno, 0);
  assert.equal(rez.prikazano, 0);
});

test("suziKategorijeIndeks: admin uputa imenuje alate koje klijent nema", () => {
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 2, false);
  assert.match(rez.text, /olx_find_category/);
  assert.match(rez.text, /olx_category_children/);
});

test("suziKategorijeIndeks: klijentu se ne nudi alat iz SAMO_ADMIN", () => {
  // Regresija: olx_find_category i olx_category_children su u SAMO_ADMIN, pa u klijentskom
  // profilu ne postoje. Uputa koja ih imenuje poslala bi klijenta na alat koji ne moze pozvati.
  const rez = suziKategorijeIndeks(PRIMJER_CSV, 2, true);
  assert.doesNotMatch(rez.text, /olx_find_category/);
  assert.doesNotMatch(rez.text, /olx_category_children/);
  assert.match(rez.text, /olx_suggest_category/);
});

test("suziKategorijeIndeks: oba profila zadrzavaju vidljiv rez i ukupan broj", () => {
  for (const zaKlijenta of [false, true]) {
    const rez = suziKategorijeIndeks(PRIMJER_CSV, 2, zaKlijenta);
    assert.match(rez.text, new RegExp(`Prikazano ${rez.prikazano} od ${rez.ukupno}`));
  }
});
