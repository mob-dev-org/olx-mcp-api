import test from "node:test";
import assert from "node:assert/strict";
import { objasniPogotke, provjeriRobu } from "./zabranjena-roba.js";

test("prazan nalaz na obicnom oglasu", () => {
  assert.deepEqual(provjeriRobu("Golf 5 1.9 TDI, 2006", "Redovno servisiran, prvi vlasnik."), []);
  assert.deepEqual(provjeriRobu("Polo majice pamuk, vise boja", "Velicine S do XXL, novo."), []);
});

test("hvata lijekove na recept i po imenu preparata", () => {
  const p = provjeriRobu("Prodajem kutiju Xanaxa", "");
  assert.equal(p.length, 1);
  assert.equal(p[0]?.kategorija, "lijekovi i recepti");

  assert.ok(provjeriRobu("Tablete", "Bensedin, neotvoreno").length > 0);
  assert.ok(provjeriRobu("Lijekovi na recept povoljno", "").length > 0);
});

test("hvata pojmove i kad su napisani sa kvacicama ili u padezu", () => {
  // Cijela poenta normalizacije: oglas se pise kako se pise, ne po rjecniku.
  assert.ok(provjeriRobu("Prodajem ukradenu robu", "").length > 0, "padez");
  assert.ok(provjeriRobu("Zaštićena vrsta ptice", "").length > 0, "kvacice");
  assert.ok(provjeriRobu("REPLIKA satova", "").length > 0, "velika slova");
});

test("hvata i ono sto je sakriveno u opisu, ne samo u naslovu", () => {
  const p = provjeriRobu("Kolekcionarski predmet", "U stvari je replika, ne original.");
  assert.ok(p.length > 0);
});

test("svaki pogodak nosi kategoriju kojom se korisniku moze objasniti", () => {
  for (const p of provjeriRobu("Marihuana i kokain", "prisluskivac takodjer")) {
    assert.ok(p.kategorija.length > 3, `pogodak ${p.pojam} nema citljivu kategoriju`);
    assert.ok(p.pojam.length > 0);
  }
});

test("isti pojam se ne prijavljuje dva puta", () => {
  const p = provjeriRobu("Replika, replika, replika", "");
  assert.equal(p.length, 1);
});

test("oruzje NIJE na listi, jer se lovacko i sportsko legalno prodaje", () => {
  // Svjesna odluka, zapisana u modulu: clan 8 ga ne navodi, a upozorenje bi smetalo prodavcu.
  assert.deepEqual(provjeriRobu("Lovacka puska, dozvola uredna", ""), []);
});

test("obicne rijeci koje slicno pocinju ne obaraju provjeru", () => {
  // Lista ide po pocetku tokena, pa je ovo prava opasnost od laznih pozitiva.
  for (const naslov of [
    "Organizator za alat",
    "Portokal cijedjeni, gajba",
    "Kanabis ulje" /* ovo JESTE pogodak, provjerava se nize */,
  ].slice(0, 2)) {
    assert.deepEqual(provjeriRobu(naslov, ""), [], `lazni pozitiv na: ${naslov}`);
  }
  assert.ok(provjeriRobu("Kanabis ulje", "").length > 0, "kanabis ipak mora zapeti");
});

test("objasniPogotke govori jezikom korisnika i navodi clan 8", () => {
  const tekst = objasniPogotke(provjeriRobu("Xanax i marihuana", ""));
  assert.match(tekst, /clan 8/);
  assert.match(tekst, /lijekovi i recepti/);
  assert.match(tekst, /narkotici/);
  assert.ok(!tekst.includes("undefined"));
});
