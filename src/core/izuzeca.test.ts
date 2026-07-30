import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bezSklonjenog,
  jeIzuzet,
  odvojiIzuzete,
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
  const oba = saDodatim({}, 5, "sve", null, KADA);
  const bezObnove = bezSklonjenog(oba, 5, "obnova");
  assert.equal(bezObnove["5"]?.obnova, false);
  assert.equal(bezObnove["5"]?.izdvajanje, true, "drugi opseg ostaje");

  const prazno = bezSklonjenog(bezObnove, 5, "izdvajanje");
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
