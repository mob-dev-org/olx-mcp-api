import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bezSklonjenog,
  jeIzuzet,
  odvojiIzuzete,
  preneseno,
  saDodatim,
  spisak,
  ucitajIzuzeca,
  upisiIzuzeca,
  type Izuzeca,
} from "./izuzeca.js";

const KADA = "2026-07-30T00:00:00.000Z";

test("saDodatim postavi trazeni opseg, a 'sve' oba", () => {
  const samoObnova = saDodatim({}, 5, "obnova", "ne isplati se", KADA);
  assert.equal(samoObnova["5"]?.obnova, true);
  assert.equal(samoObnova["5"]?.izdvajanje, false);

  const oba = saDodatim({}, 6, "sve", null, KADA);
  assert.equal(oba["6"]?.obnova, true);
  assert.equal(oba["6"]?.izdvajanje, true);
});

test("ponovni dodatak drugog opsega ne gubi prethodni", () => {
  let iz = saDodatim({}, 5, "obnova", "prvi razlog", KADA);
  iz = saDodatim(iz, 5, "izdvajanje", null, KADA);
  assert.equal(iz["5"]?.obnova, true, "stari opseg mora ostati");
  assert.equal(iz["5"]?.izdvajanje, true);
  assert.equal(iz["5"]?.razlog, "prvi razlog", "razlog se ne gubi kad novi nije dat");
});

test("bezSklonjenog cisti samo trazeni opseg, a zapis brise kad nista ne ostane", () => {
  const sva = saDodatim({}, 5, "sve", null, KADA);
  const bezObnove = bezSklonjenog(sva, 5, "obnova");
  assert.equal(bezObnove["5"]?.obnova, false);
  assert.equal(bezObnove["5"]?.izdvajanje, true, "drugi opseg ostaje");
  assert.equal(bezObnove["5"]?.objava, true, "treci opseg ostaje");

  const bezIzdvajanja = bezSklonjenog(bezObnove, 5, "izdvajanje");
  assert.notEqual(bezIzdvajanja["5"], undefined, "objava jos ostaje, zapis ne smije nestati");

  const prazno = bezSklonjenog(bezIzdvajanja, 5, "objava");
  assert.equal(prazno["5"], undefined, "kad nijedan opseg ne ostane, zapis se brise");

  assert.deepEqual(bezSklonjenog({}, 99, "sve"), {}, "sklanjanje nepostojeceg ne pada");
});

test("jeIzuzet gleda tacan opseg, ne bilo koji", () => {
  const iz = saDodatim({}, 5, "izdvajanje", null, KADA);
  assert.equal(jeIzuzet(iz, 5, "izdvajanje"), true);
  assert.equal(jeIzuzet(iz, 5, "obnova"), false, "izuzet od izdvajanja se i dalje obnavlja");
  assert.equal(jeIzuzet(iz, 999, "obnova"), false);
});

test("odvojiIzuzete vraca i preskocene, da se mogu prijaviti", () => {
  const iz = saDodatim(saDodatim({}, 2, "obnova", null, KADA), 4, "izdvajanje", null, KADA);
  const kandidati = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  const zaObnovu = odvojiIzuzete(kandidati, iz, "obnova");
  assert.deepEqual(zaObnovu.prolaze.map((k) => k.id), [1, 3, 4]);
  assert.deepEqual(zaObnovu.preskoceni.map((k) => k.id), [2]);

  const zaIzdvajanje = odvojiIzuzete(kandidati, iz, "izdvajanje");
  assert.deepEqual(zaIzdvajanje.prolaze.map((k) => k.id), [1, 2, 3]);
  assert.deepEqual(zaIzdvajanje.preskoceni.map((k) => k.id), [4]);
});

test("saDodatim sa opsegom 'objava' postavlja samo objava", () => {
  const iz = saDodatim({}, 5, "objava", "nizak prioritet", KADA);
  assert.equal(iz["5"]?.objava, true);
  assert.equal(iz["5"]?.obnova, false);
  assert.equal(iz["5"]?.izdvajanje, false);
});

test("saDodatim sa opsegom 'sve' postavlja sva tri opsega", () => {
  const iz = saDodatim({}, 6, "sve", null, KADA);
  assert.equal(iz["6"]?.obnova, true);
  assert.equal(iz["6"]?.izdvajanje, true);
  assert.equal(iz["6"]?.objava, true);
});

test("saDodatim 'objava' preko postojeceg 'obnova' spaja opsege", () => {
  let iz = saDodatim({}, 5, "obnova", null, KADA);
  iz = saDodatim(iz, 5, "objava", null, KADA);
  assert.equal(iz["5"]?.obnova, true);
  assert.equal(iz["5"]?.objava, true);
});

test("bezSklonjenog 'objava' kad zapis ima i 'obnova': zapis ostaje, objava false", () => {
  let iz = saDodatim({}, 5, "obnova", null, KADA);
  iz = saDodatim(iz, 5, "objava", null, KADA);
  const posle = bezSklonjenog(iz, 5, "objava");
  assert.equal(posle["5"]?.objava, false);
  assert.equal(posle["5"]?.obnova, true);
});

test("bezSklonjenog 'objava' kad zapis ima SAMO objava: zapis se brise", () => {
  const iz = saDodatim({}, 5, "objava", null, KADA);
  const posle = bezSklonjenog(iz, 5, "objava");
  assert.equal(posle["5"], undefined);
});

test("bezSklonjenog 'obnova' kad zapis ima samo objava i obnova: ostaje zbog objava", () => {
  let iz = saDodatim({}, 5, "obnova", null, KADA);
  iz = saDodatim(iz, 5, "objava", null, KADA);
  const posle = bezSklonjenog(iz, 5, "obnova");
  assert.notEqual(posle["5"], undefined, "zapis mora ostati jer objava jos vrijedi");
  assert.equal(posle["5"]?.obnova, false);
  assert.equal(posle["5"]?.objava, true);
});

test("bezSklonjenog 'sve' brise zapis bez obzira na opsege", () => {
  let iz = saDodatim({}, 5, "obnova", null, KADA);
  iz = saDodatim(iz, 5, "objava", null, KADA);
  const posle = bezSklonjenog(iz, 5, "sve");
  assert.equal(posle["5"], undefined);
});

test("jeIzuzet radi i za opseg 'objava'", () => {
  const iz = saDodatim({}, 5, "objava", null, KADA);
  assert.equal(jeIzuzet(iz, 5, "objava"), true);
  assert.equal(jeIzuzet(iz, 5, "obnova"), false);
});

test("nazadna kompatibilnost: zapis bez polja 'objava' ponasa se kao objava: false", () => {
  const iz: Izuzeca = { "5": { obnova: true, izdvajanje: false, razlog: null, kada: KADA } };
  assert.equal(jeIzuzet(iz, 5, "objava"), false);

  const s = spisak(iz);
  assert.equal(s[0]?.objava, false);

  const posle = bezSklonjenog(iz, 5, "obnova");
  assert.equal(posle["5"], undefined, "brise se bez laznog 'ostaje zbog objava'");
});

test("odvojiIzuzete sa opsegom 'obnova' ne preskace oglas oznacen samo sa 'objava'", () => {
  const iz = saDodatim({}, 2, "objava", null, KADA);
  const kandidati = [{ id: 1 }, { id: 2 }];
  const r = odvojiIzuzete(kandidati, iz, "obnova");
  assert.deepEqual(r.prolaze.map((k) => k.id), [1, 2], "objava ne blokira obnovu");
  assert.deepEqual(r.preskoceni.map((k) => k.id), []);
});

test("preneseno prenosi i 'objava' oznaku na novi id", () => {
  const iz = saDodatim({}, 42, "objava", "nizak prioritet", KADA);
  const poslije = preneseno(iz, 42, 99, "2026-09-01T00:00:00.000Z");
  assert.equal(jeIzuzet(poslije, 99, "objava"), true);
  assert.equal(poslije["42"], undefined);
});

test("spisak vraca novo polje 'objava' i ostaje sortiran po id-u", () => {
  let iz: Izuzeca = saDodatim({}, 20, "objava", null, KADA);
  iz = saDodatim(iz, 3, "sve", null, KADA);
  const s = spisak(iz);
  assert.deepEqual(s.map((x) => x.id), [3, 20]);
  assert.equal(s[0]?.objava, true);
  assert.equal(s[1]?.objava, true);
});

test("prazan spisak nista ne filtrira: obnova radi kao i prije uvodjenja izuzeca", () => {
  const kandidati = [{ id: 1 }, { id: 2 }];
  const r = odvojiIzuzete(kandidati, {}, "obnova");
  assert.equal(r.prolaze.length, 2);
  assert.equal(r.preskoceni.length, 0);
});

test("spisak sortira po id-u i nosi oba opsega", () => {
  let iz: Izuzeca = saDodatim({}, 20, "obnova", "skup", KADA);
  iz = saDodatim(iz, 3, "sve", null, KADA);
  const s = spisak(iz);
  assert.deepEqual(s.map((x) => x.id), [3, 20]);
  assert.equal(s[1]?.razlog, "skup");
});

test("citanje i upis prezive krug kroz disk, a pokvaren fajl daje prazan spisak", () => {
  const fajl = join(mkdtempSync(join(tmpdir(), "olx-izuzeca-")), "izuzeca.json");
  assert.deepEqual(ucitajIzuzeca(fajl), {}, "bez fajla je prazno");

  const iz = saDodatim({}, 7, "sve", "prodano van platforme", KADA);
  upisiIzuzeca(iz, fajl);
  assert.deepEqual(ucitajIzuzeca(fajl), iz);

  upisiIzuzeca({} as Izuzeca, fajl);
  assert.deepEqual(ucitajIzuzeca(fajl), {});
});

test("preneseno seli izuzece na novi id pri ponovnoj objavi", () => {
  const iz = saDodatim({}, 42, "obnova", "sezonski artikal", KADA);
  const poslije = preneseno(iz, 42, 99, "2026-09-01T00:00:00.000Z");
  assert.equal(poslije["42"], undefined, "stari kljuc se brise");
  assert.equal(jeIzuzet(poslije, 99, "obnova"), true);
  assert.equal(jeIzuzet(poslije, 99, "izdvajanje"), false, "opseg se prenosi tacno, ne siri");
  assert.equal(poslije["99"]?.razlog, "sezonski artikal");
});

test("preneseno bez starog izuzeca ne mijenja nista", () => {
  const iz = saDodatim({}, 5, "sve", null, KADA);
  assert.deepEqual(preneseno(iz, 42, 99, KADA), iz);
});

test("preneseno na id koji vec ima izuzece spaja opsege", () => {
  let iz = saDodatim({}, 42, "obnova", "stari razlog", KADA);
  iz = saDodatim(iz, 99, "izdvajanje", null, KADA);
  const poslije = preneseno(iz, 42, 99, KADA);
  assert.equal(jeIzuzet(poslije, 99, "obnova"), true);
  assert.equal(jeIzuzet(poslije, 99, "izdvajanje"), true);
  assert.equal(poslije["99"]?.razlog, "stari razlog", "razlog starog ima prednost kad novi nema svoj");
});
