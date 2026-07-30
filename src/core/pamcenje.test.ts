import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_NAPOMENA,
  POLJA,
  bezNapomene,
  bezPolja,
  jePolje,
  pamcenjeUProm,
  prazno,
  saNapomenom,
  saPoljem,
  ucitajPamcenje,
  upisiPamcenje,
  type Pamcenje,
} from "./pamcenje.js";

const KADA = "2026-07-30T10:00:00.000Z";
const P: Pamcenje = { polja: {}, napomene: [] };

test("jePolje pusta samo imenovana polja, jer slobodne kljuceve slabiji model izmislja", () => {
  assert.equal(jePolje("ton"), true);
  assert.equal(jePolje("footer_opisa"), true);
  assert.equal(jePolje("tonn"), false);
  assert.equal(jePolje("boja_loga"), false);
});

test("saPoljem postavi vrijednost, a prazna vrijednost brise polje", () => {
  const sa = saPoljem(P, "ton", "  opusteno, na ti  ", KADA);
  assert.equal(sa.polja.ton?.vrijednost, "opusteno, na ti", "razmaci se skidaju");
  assert.equal(sa.polja.ton?.kada, KADA);

  const bez = saPoljem(sa, "ton", "   ", KADA);
  assert.equal(bez.polja.ton, undefined, "prazna vrijednost ne pamti prazninu");
});

test("bezPolja brise samo trazeno polje", () => {
  let p = saPoljem(P, "ton", "kratko", KADA);
  p = saPoljem(p, "kontakt", "Amir", KADA);
  const r = bezPolja(p, "ton");
  assert.equal(r.polja.ton, undefined);
  assert.equal(r.polja.kontakt?.vrijednost, "Amir");
});

test("ista napomena se ne duplira ni kad je zapisana drugacije", () => {
  let p = saNapomenom(P, "Ne slati izvjestaje subotom", KADA);
  p = saNapomenom(p, "  ne  SLATI izvjestaje   subotom ", KADA);
  assert.equal(p.napomene.length, 1, "duplikat se prepoznaje bez obzira na slova i razmake");
});

test("prazna napomena se ne pamti", () => {
  assert.equal(saNapomenom(P, "   ", KADA).napomene.length, 0);
});

test("napomene su ogranicene, da prompt ne raste bez granice", () => {
  let p = P;
  for (let i = 0; i < MAX_NAPOMENA + 7; i++) p = saNapomenom(p, `napomena ${i}`, KADA);
  assert.equal(p.napomene.length, MAX_NAPOMENA);
  assert.equal(p.napomene[0]?.tekst, `napomena ${7}`, "odbacuju se najstarije, ne najnovije");
});

test("bezNapomene skloni napomenu bez obzira na velicinu slova", () => {
  const p = saNapomenom(P, "Cijene drzi ispod 100 KM", KADA);
  assert.equal(bezNapomene(p, "cijene DRZI ispod 100 km").napomene.length, 0);
});

test("prazno pamcenje ne dodaje nista u prompt", () => {
  assert.equal(prazno(P), true);
  assert.equal(pamcenjeUProm(P), "", "prazan naslov u promptu je trosak bez koristi");
});

test("pamcenjeUProm ispise polja citljivo i doda napomene", () => {
  let p = saPoljem(P, "ton", "na ti, kratko", KADA);
  p = saPoljem(p, "footer_opisa", "Dostava po cijeloj BiH", KADA);
  p = saNapomenom(p, "Ne slati izvjestaje subotom", KADA);
  const tekst = pamcenjeUProm(p);

  assert.ok(tekst.includes("Sto vec znas o ovom klijentu"));
  assert.ok(tekst.includes("na ti, kratko"));
  assert.ok(tekst.includes("Dostava po cijeloj BiH"));
  assert.ok(tekst.includes("Ne slati izvjestaje subotom"));
  // Bot ne smije pamcenje citati korisniku kao spisak.
  assert.ok(tekst.includes("ne citaj kao listu"));
  // Imena polja iz koda ne smiju procurjeti u prompt koji klijent moze cuti.
  assert.ok(!tekst.includes("footer_opisa"), "u promptu ide ljudski naziv, ne ime polja");
});

test("citanje i upis prezive krug kroz disk, pokvaren fajl daje prazno pamcenje", () => {
  const fajl = join(mkdtempSync(join(tmpdir(), "olx-pamcenje-")), "pamcenje.json");
  assert.deepEqual(ucitajPamcenje(fajl), PRAZNO_KOPIJA(), "bez fajla je prazno");

  let p = saPoljem(P, "ton", "profesionalno", KADA);
  p = saNapomenom(p, "Uvijek pitati za velicinu", KADA);
  upisiPamcenje(p, fajl);
  const vraceno = ucitajPamcenje(fajl);
  assert.equal(vraceno.polja.ton?.vrijednost, "profesionalno");
  assert.equal(vraceno.napomene.length, 1);
});

function PRAZNO_KOPIJA(): Pamcenje {
  return { polja: {}, napomene: [] };
}

test("svako imenovano polje ima ljudski naziv u promptu", () => {
  // Bez ovoga bi dodavanje polja u POLJA tiho ispalo iz prompta.
  for (const polje of POLJA) {
    const tekst = pamcenjeUProm(saPoljem(P, polje, "vrijednost-x", KADA));
    assert.ok(tekst.includes("vrijednost-x"), `polje ${polje} ne dolazi u prompt`);
    assert.ok(!tekst.includes(polje), `polje ${polje} ide u prompt kao ime iz koda`);
  }
});
