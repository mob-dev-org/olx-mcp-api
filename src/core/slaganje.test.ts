// Testovi slaganja: cista geometrija bez zavisnosti, plus sharp integracioni test kompozicije
// na sicusnim programski napravljenim slikama. imgly segmentacija se testira SAMO uz
// OLX_TEST_IMGLY=1 (spora je i kvalitet joj se ocjenjuje rucno, ne assertom).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  izracunajIzrez4x3,
  izracunajPolozaj,
  izreziArtikal,
  PLATNO_4_3,
  provjeriSlot,
  slaganjeDostupno,
  slozi,
  ZADANI_SLOT,
} from "./slaganje.js";

test("provjeriSlot: zadani prolazi, rasponi i nepoznato sidro padaju", () => {
  assert.equal(provjeriSlot(ZADANI_SLOT).ok, true);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, sirinaPosto: 9 }).ok, false);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, sirinaPosto: 91 }).ok, false);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, sirinaPosto: 10 }).ok, true, "rub raspona prolazi");
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, marginaDnaPosto: -1 }).ok, false);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, marginaDnaPosto: 31 }).ok, false);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, marginaDnaPosto: 0 }).ok, true);
  assert.equal(provjeriSlot({ ...ZADANI_SLOT, sidro: "gore-lijevo" as never }).ok, false);
});

test("izracunajIzrez4x3: pejzaz sijece sirinu, portret visinu, tacno 4:3 nista", () => {
  const pejzaz = izracunajIzrez4x3(2000, 1000);
  assert.ok(pejzaz);
  assert.equal(pejzaz.sirina, 1333);
  assert.equal(pejzaz.visina, 1000);
  assert.equal(pejzaz.gore, 0);
  assert.ok(pejzaz.lijevo > 0, "sijece se lijevo i desno, iz sredine");
  assert.ok(pejzaz.odsjecenoPosto > 30);

  const portret = izracunajIzrez4x3(1000, 2000);
  assert.ok(portret);
  assert.equal(portret.sirina, 1000);
  assert.equal(portret.visina, 750);
  assert.ok(portret.odsjecenoPosto > 60, "portretna pozadina gubi vecinu kadra");

  const tacan = izracunajIzrez4x3(1600, 1200);
  assert.ok(tacan);
  assert.deepEqual([tacan.lijevo, tacan.gore, tacan.sirina, tacan.visina, tacan.odsjecenoPosto], [0, 0, 1600, 1200, 0]);

  assert.equal(izracunajIzrez4x3(0, 100), null);
  assert.equal(izracunajIzrez4x3(Number.NaN, 100), null);
});

test("izracunajPolozaj: zadani slot centrira artikal pri dnu na ciljnoj sirini", () => {
  // siri artikal (foto 800x600): puna ciljna sirina, proporcionalna visina
  const p = izracunajPolozaj(PLATNO_4_3, { sirina: 800, visina: 600 }, ZADANI_SLOT);
  assert.equal(p.sirina, 720, "45% od 1600");
  assert.equal(p.visina, 540, "proporcionalno, bez krivljenja");
  assert.equal(p.lijevo, 440, "centrirano");
  assert.equal(p.gore, 1200 - 96 - 540, "donja ivica na 8% od dna");
});

test("izracunajPolozaj: visok artikal se klampuje po visini i ostaje u kadru, proporcije se cuvaju", () => {
  const artikal = { sirina: 300, visina: 1500 };
  const p = izracunajPolozaj(PLATNO_4_3, artikal, ZADANI_SLOT);
  const marginaDna = Math.round(1200 * 0.08);
  const gornja = Math.round(1200 * 0.28);
  assert.equal(p.visina, 1200 - marginaDna - gornja, "visina na maksimumu");
  assert.ok(p.sirina < Math.round(1600 * 0.45), "uzi od ciljne sirine, ne krivi se");
  assert.ok(Math.abs(p.sirina / p.visina - artikal.sirina / artikal.visina) < 0.01, "proporcije sacuvane");
  assert.ok(p.gore >= gornja, "ne dodiruje vrh");
  assert.equal(p.gore + p.visina + marginaDna, 1200, "donja ivica tacno na margini");
});

test("slozi: sharp kompozicija stavlja artikal na slot, platno ostaje 4:3", async () => {
  const dostupno = await slaganjeDostupno();
  assert.equal(dostupno.ok, true, "sharp i imgly su regularne zavisnosti repoa");

  const sharp = (await import("sharp")).default;
  // sivo platno 1600x1200 i crveni kvadrat 100x100 sa alpha kanalom
  const platno = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .png()
    .toBuffer();
  const artikal = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();

  const slozena = await slozi(platno, artikal, ZADANI_SLOT);
  const meta = await sharp(slozena).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 1200);

  // piksel u sredini slota je crven (artikal), piksel u gornjem lijevom uglu ostaje siv (pozadina)
  const sirovi = await sharp(slozena).raw().toBuffer({ resolveWithObject: true });
  const piksel = (x: number, y: number): [number, number, number] => {
    const i = (y * 1600 + x) * sirovi.info.channels;
    return [sirovi.data[i] ?? 0, sirovi.data[i + 1] ?? 0, sirovi.data[i + 2] ?? 0];
  };
  // artikal 100x100 na 45% sirine = 720x720, centriran, donja ivica na 1104
  assert.deepEqual(piksel(800, 1000), [255, 0, 0], "sredina slota je artikal");
  assert.deepEqual(piksel(10, 10), [200, 200, 200], "ugao platna je netaknuta pozadina");
  assert.deepEqual(piksel(800, 200), [200, 200, 200], "iznad artikla je netaknuta pozadina");
});

test("izreziArtikal: segmentacija vraca alpha PNG i trimuje rub (samo uz OLX_TEST_IMGLY=1)", { skip: process.env.OLX_TEST_IMGLY !== "1" }, async () => {
  const sharp = (await import("sharp")).default;
  const svg = Buffer.from(
    '<svg width="300" height="300"><rect width="300" height="300" fill="white"/><circle cx="150" cy="150" r="90" fill="red"/></svg>',
  );
  const foto = await sharp(svg).png().toBuffer();
  const izrez = await izreziArtikal(foto);
  const meta = await sharp(izrez).metadata();
  assert.equal(meta.hasAlpha, true);
  assert.ok((meta.width ?? 300) < 300, "prozirni rub oko kruga je odsjecen");
});
