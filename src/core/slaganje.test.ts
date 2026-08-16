// Testovi slaganja: cista geometrija bez zavisnosti, plus sharp integracioni test kompozicije
// na sicusnim programski napravljenim slikama. imgly segmentacija se testira SAMO uz
// OLX_TEST_IMGLY=1 (spora je i kvalitet joj se ocjenjuje rucno, ne assertom).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  izracunajIzrez4x3,
  izracunajPolozaj,
  izreziArtikal,
  MAX_ELEMENATA,
  nadjiKomponente,
  PLATNO_4_3,
  provjeriSlot,
  rasporediRed,
  slaganjeDostupno,
  slozi,
  ZADANI_SLOT,
} from "./slaganje.js";

/** Crta pravougaonik alpha=255 u masku (Uint8Array reda po red, jedan bajt po pikselu). */
function nacrtajPravougaonik(
  maska: Uint8Array,
  sirina: number,
  pravougaonik: { lijevo: number; gore: number; sirina: number; visina: number },
): void {
  for (let y = pravougaonik.gore; y < pravougaonik.gore + pravougaonik.visina; y++) {
    for (let x = pravougaonik.lijevo; x < pravougaonik.lijevo + pravougaonik.sirina; x++) {
      maska[y * sirina + x] = 255;
    }
  }
}

function seSijeku(
  a: { lijevo: number; gore: number; sirina: number; visina: number },
  b: { lijevo: number; gore: number; sirina: number; visina: number },
): boolean {
  return a.lijevo < b.lijevo + b.sirina && b.lijevo < a.lijevo + a.sirina && a.gore < b.gore + b.visina && b.gore < a.gore + a.visina;
}

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

test("nadjiKomponente: dvije razdvojene mrlje daju dvije komponente sa tacnim bounding boxovima", () => {
  const sirina = 20;
  const visina = 20;
  const maska = new Uint8Array(sirina * visina);
  nacrtajPravougaonik(maska, sirina, { lijevo: 1, gore: 1, sirina: 4, visina: 4 });
  nacrtajPravougaonik(maska, sirina, { lijevo: 12, gore: 10, sirina: 5, visina: 6 });

  const komponente = nadjiKomponente(maska, sirina, visina, { pragPiksela: 1 });
  assert.equal(komponente.length, 2);
  const veca = komponente[0]!;
  const manja = komponente[1]!;
  assert.deepEqual([veca.lijevo, veca.gore, veca.sirina, veca.visina, veca.piksela], [12, 10, 5, 6, 30]);
  assert.deepEqual([manja.lijevo, manja.gore, manja.sirina, manja.visina, manja.piksela], [1, 1, 4, 4, 16]);
});

test("nadjiKomponente: dvije mrlje koje se dodiruju daju jednu komponentu", () => {
  const sirina = 20;
  const visina = 20;
  const maska = new Uint8Array(sirina * visina);
  nacrtajPravougaonik(maska, sirina, { lijevo: 1, gore: 1, sirina: 4, visina: 4 });
  // dodiruje prethodni pravougaonik na ivici x=5,y=1..4
  nacrtajPravougaonik(maska, sirina, { lijevo: 5, gore: 1, sirina: 4, visina: 4 });

  const komponente = nadjiKomponente(maska, sirina, visina, { pragPiksela: 1 });
  assert.equal(komponente.length, 1);
  assert.equal(komponente[0]!.piksela, 32);
});

test("nadjiKomponente: mrlja ispod praga se odbacuje", () => {
  const sirina = 20;
  const visina = 20;
  const maska = new Uint8Array(sirina * visina);
  nacrtajPravougaonik(maska, sirina, { lijevo: 1, gore: 1, sirina: 1, visina: 1 });
  nacrtajPravougaonik(maska, sirina, { lijevo: 10, gore: 10, sirina: 5, visina: 5 });

  const komponente = nadjiKomponente(maska, sirina, visina, { pragPiksela: 5 });
  assert.equal(komponente.length, 1);
  assert.equal(komponente[0]!.piksela, 25);
});

test("nadjiKomponente: prazna maska daje prazan niz", () => {
  const maska = new Uint8Array(20 * 20);
  assert.deepEqual(nadjiKomponente(maska, 20, 20), []);
});

test("nadjiKomponente: neispravan ulaz daje prazan niz", () => {
  assert.deepEqual(nadjiKomponente(new Uint8Array(10), 20, 20), []);
  assert.deepEqual(nadjiKomponente(new Uint8Array(400), 0, 20), []);
  assert.deepEqual(nadjiKomponente(new Uint8Array(400), 20, -1), []);
});

test("nadjiKomponente: rezultat je sortiran po povrsini opadajuce", () => {
  const sirina = 30;
  const visina = 30;
  const maska = new Uint8Array(sirina * visina);
  nacrtajPravougaonik(maska, sirina, { lijevo: 1, gore: 1, sirina: 3, visina: 3 });
  nacrtajPravougaonik(maska, sirina, { lijevo: 10, gore: 10, sirina: 8, visina: 8 });
  nacrtajPravougaonik(maska, sirina, { lijevo: 22, gore: 1, sirina: 5, visina: 5 });

  const komponente = nadjiKomponente(maska, sirina, visina, { pragPiksela: 1 });
  assert.equal(komponente.length, 3);
  assert.ok(komponente[0]!.piksela >= komponente[1]!.piksela);
  assert.ok(komponente[1]!.piksela >= komponente[2]!.piksela);
});

test("rasporediRed: N od 1 do 4 vraca tacno N polozaja", () => {
  for (let n = 1; n <= MAX_ELEMENATA; n++) {
    const artikli = Array.from({ length: n }, () => ({ sirina: 800, visina: 600 }));
    const polozaji = rasporediRed(PLATNO_4_3, artikli, ZADANI_SLOT);
    assert.equal(polozaji.length, n);
  }
});

test("rasporediRed: za N=1 rezultat je identican izracunajPolozaj", () => {
  const artikal = { sirina: 800, visina: 600 };
  const [posebno] = rasporediRed(PLATNO_4_3, [artikal], ZADANI_SLOT);
  const ocekivano = izracunajPolozaj(PLATNO_4_3, artikal, ZADANI_SLOT);
  assert.deepEqual(posebno, ocekivano);
});

test("rasporediRed: nema preklapanja medju polozajima za N=3", () => {
  const artikli = [
    { sirina: 800, visina: 600 },
    { sirina: 400, visina: 900 },
    { sirina: 1000, visina: 700 },
  ];
  const polozaji = rasporediRed(PLATNO_4_3, artikli, ZADANI_SLOT);
  assert.equal(polozaji.length, 3);
  for (let i = 0; i < polozaji.length; i++) {
    for (let j = i + 1; j < polozaji.length; j++) {
      assert.equal(seSijeku(polozaji[i]!, polozaji[j]!), false, `polozaj ${i} i ${j} se ne smiju preklapati`);
    }
  }
});

test("rasporediRed: svi imaju istu donju ivicu", () => {
  const artikli = [
    { sirina: 800, visina: 600 },
    { sirina: 300, visina: 1200 },
    { sirina: 500, visina: 500 },
  ];
  const polozaji = rasporediRed(PLATNO_4_3, artikli, ZADANI_SLOT);
  const donje = polozaji.map((p) => p.gore + p.visina);
  assert.ok(donje.every((d) => d === donje[0]), "sve donje ivice moraju biti jednake");
});

test("rasporediRed: nijedan polozaj ne izlazi iz platna", () => {
  const artikli = [
    { sirina: 800, visina: 600 },
    { sirina: 300, visina: 1400 },
    { sirina: 1200, visina: 300 },
    { sirina: 500, visina: 500 },
  ];
  const polozaji = rasporediRed(PLATNO_4_3, artikli, ZADANI_SLOT);
  for (const p of polozaji) {
    assert.ok(p.lijevo >= 0, "ne izlazi lijevo");
    assert.ok(p.gore >= 0, "ne izlazi gore");
    assert.ok(p.lijevo + p.sirina <= PLATNO_4_3.sirina, "ne izlazi desno");
    assert.ok(p.gore + p.visina <= PLATNO_4_3.visina, "ne izlazi dolje");
  }
});

test("rasporediRed: visok artikal se klampuje po visini a proporcije mu ostaju", () => {
  const artikli = [
    { sirina: 800, visina: 600 },
    { sirina: 300, visina: 1600 }, // visok artikal, treba klampovanje
  ];
  const polozaji = rasporediRed(PLATNO_4_3, artikli, ZADANI_SLOT);
  const visok = polozaji[1]!;
  const izvorniOdnos = 300 / 1600;
  const dobijeniOdnos = visok.sirina / visok.visina;
  assert.ok(Math.abs(dobijeniOdnos - izvorniOdnos) * visok.visina < 1, "proporcije sacuvane u toleranciji piksela");
  const marginaDna = Math.round(PLATNO_4_3.visina * (ZADANI_SLOT.marginaDnaPosto / 100));
  const gornja = Math.round(PLATNO_4_3.visina * 0.28);
  assert.ok(visok.visina <= PLATNO_4_3.visina - marginaDna - gornja, "visina ne prelazi klamp");
});

test("rasporediRed: N=0 daje prazan niz, N=5 baca", () => {
  assert.deepEqual(rasporediRed(PLATNO_4_3, [], ZADANI_SLOT), []);
  const petArtikala = Array.from({ length: 5 }, () => ({ sirina: 800, visina: 600 }));
  assert.throws(() => rasporediRed(PLATNO_4_3, petArtikala, ZADANI_SLOT), /5/);
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
