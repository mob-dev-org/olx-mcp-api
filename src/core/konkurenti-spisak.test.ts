// Testovi spiska konkurenata i uparivanja: ciste funkcije bez diska, plus krug kroz fajl.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aktivnaUparivanja,
  bezKonkurenta,
  MAX_PRIJEDLOGA_PO_KONKURENTU,
  odluciUparivanje,
  podrazumijevanoStanje,
  predloziUparivanja,
  saKonkurentom,
  saPrijedlozima,
  ucitajKonkurentiStanje,
  upisiKonkurentiStanje,
  type Uparivanje,
} from "./konkurenti-spisak.js";

const KADA = "2026-08-04T12:00:00.000Z";

function par(overrides: Partial<Uparivanje> = {}): Uparivanje {
  return {
    moj_id: 1,
    moj_naslov: "Friteza 8L profesionalna",
    konkurent: "KonkurentShop",
    njihov_id: 100,
    njihov_naslov: "Profesionalna friteza 8 litara",
    ocjena: 0.8,
    status: "predlozeno",
    kada: KADA,
    ...overrides,
  };
}

test("saKonkurentom ne duplira username (ni uz razliku velikih slova), bezKonkurenta nosi i uparivanja", () => {
  let s = saKonkurentom(podrazumijevanoStanje(), { username: "Shop1", dodao: "klijent", kada: KADA });
  s = saKonkurentom(s, { username: "shop1", dodao: "admin", kada: KADA });
  assert.equal(s.konkurenti.length, 1);

  s = { ...s, uparivanja: [par({ konkurent: "Shop1" }), par({ konkurent: "Drugi", moj_id: 2 })] };
  const bez = bezKonkurenta(s, "SHOP1");
  assert.equal(bez.konkurenti.length, 0);
  assert.equal(bez.uparivanja.length, 1, "uparivanja uklonjenog konkurenta odlaze s njim");
  assert.equal(bez.uparivanja[0]?.konkurent, "Drugi");

  assert.equal(bezKonkurenta(bez, "nepostojeci"), bez, "uklanjanje nepostojeceg vraca isto stanje");
});

test("odluciUparivanje mijenja status i javlja kad par ne postoji", () => {
  const s = { ...podrazumijevanoStanje(), uparivanja: [par()] };
  const potvrda = odluciUparivanje(s, 1, 100, "potvrdi", KADA);
  assert.equal(potvrda.nadjeno, true);
  assert.equal(potvrda.stanje.uparivanja[0]?.status, "potvrdjeno");
  assert.equal(aktivnaUparivanja(potvrda.stanje).length, 1);

  const odbij = odluciUparivanje(potvrda.stanje, 1, 100, "odbij", KADA);
  assert.equal(odbij.stanje.uparivanja[0]?.status, "odbijeno");
  assert.equal(aktivnaUparivanja(odbij.stanje).length, 0);

  const nema = odluciUparivanje(s, 9, 9, "potvrdi", KADA);
  assert.equal(nema.nadjeno, false);
  assert.equal(nema.stanje, s);
});

test("predloziUparivanja: slicni naslovi se sparuju, odbijeni i vec upareni se ne nude ponovo", () => {
  const moji = [
    { id: 1, title: "Friteza profesionalna 8L inox" },
    { id: 2, title: "Rostilj plinski 3 plamenika" },
    { id: 3, title: "Slusalice bluetooth crne" },
  ];
  const njihovi = [
    { id: 100, title: "Profesionalna inox friteza 8L" },
    { id: 200, title: "Plinski rostilj sa 3 plamenika" },
    { id: 300, title: "Zamrzivac sanduk 300L" },
  ];
  const prijedlozi = predloziUparivanja(moji, njihovi, "KonkurentShop", [], KADA);
  const parovi = new Map(prijedlozi.map((p) => [p.moj_id, p.njihov_id]));
  assert.equal(parovi.get(1), 100);
  assert.equal(parovi.get(2), 200);
  assert.equal(parovi.has(3), false, "slusalice nemaju pandan iznad praga");
  assert.ok(prijedlozi.every((p) => p.status === "predlozeno" && p.ocjena > 0));

  // Odbijen par se ne nudi ponovo; potvrdjen moj artikal ne trazi novog kandidata.
  const postojeca: Uparivanje[] = [
    par({ moj_id: 1, njihov_id: 100, status: "odbijeno" }),
    par({ moj_id: 2, njihov_id: 200, status: "potvrdjeno" }),
  ];
  const ponovo = predloziUparivanja(moji, njihovi, "KonkurentShop", postojeca, KADA);
  assert.equal(ponovo.length, 0);
});

test("predloziUparivanja sijece na najvise MAX_PRIJEDLOGA_PO_KONKURENTU", () => {
  const moji = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Artikal model ${i + 1} inox varijanta` }));
  const njihovi = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, title: `Artikal model ${i + 1} inox varijanta` }));
  const prijedlozi = predloziUparivanja(moji, njihovi, "K", [], KADA);
  assert.ok(prijedlozi.length <= MAX_PRIJEDLOGA_PO_KONKURENTU);
});

test("saPrijedlozima preskace duplikate; stanje prezivi krug kroz fajl, pokvaren fajl vraca prazno", () => {
  const s0 = { ...podrazumijevanoStanje(), uparivanja: [par()] };
  const { stanje: s1, dodano } = saPrijedlozima(s0, [par(), par({ moj_id: 5, njihov_id: 500 })]);
  assert.equal(dodano, 1, "postojeci par se ne dodaje ponovo");
  assert.equal(s1.uparivanja.length, 2);

  const dir = mkdtempSync(join(tmpdir(), "konk-"));
  try {
    const putanja = join(dir, "konkurenti.json");
    upisiKonkurentiStanje(s1, putanja);
    const ucitano = ucitajKonkurentiStanje(putanja);
    assert.deepEqual(ucitano, s1);
    assert.deepEqual(ucitajKonkurentiStanje(join(dir, "nema.json")), podrazumijevanoStanje());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
