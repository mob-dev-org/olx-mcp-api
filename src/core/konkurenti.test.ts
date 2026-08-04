// Testovi snimaka konkurenata: citanje v1 i v2 formata i retencija starih snimaka.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snimciZaBrisanje, ucitajKonkurenta, upisiKonkurenta, type KonkurentSnimak } from "./konkurenti.js";
import type { KonkurentIzvjestaj } from "./stats.js";

const IZVJESTAJ = {
  profil: {},
  oglasi: { aktivni: 2, zavrseni: null },
  cijene: { min: 10, median: 15, max: 20, prosjek: 15, na_upit: 0 },
  sponzorisano: { broj: 1, premium: 0, procenat: 50 },
  akcije: { broj: 0, procenat: 0 },
  obnove: {},
} as unknown as KonkurentIzvjestaj;

test("ucitajKonkurenta cita i v1 (izvjestaj) i v2 (agregat) snimke, hronoloski", () => {
  const dir = mkdtempSync(join(tmpdir(), "konk-snimci-"));
  try {
    const v1: KonkurentSnimak = {
      verzija: 1,
      ts: 1_785_000_000,
      username: "Shop",
      izvjestaj: IZVJESTAJ,
      oglasi: [{ id: 1, title: "A", price: 10 }],
    };
    const v2: KonkurentSnimak = {
      verzija: 2,
      ts: 1_785_100_000,
      username: "Shop",
      agregat: { broj: 2, sponzorisano: 1, median_cijene: 15 },
      oglasi: [
        { id: 1, title: "A", price: 12, date: 1_785_000_000, sponsored: 1 },
        { id: 2, title: "B", price: 20 },
      ],
    };
    upisiKonkurenta(v2, dir);
    upisiKonkurenta(v1, dir);
    const snimci = ucitajKonkurenta("Shop", dir);
    assert.equal(snimci.length, 2);
    assert.equal(snimci[0]?.verzija, 1, "hronoloski: stariji prvi");
    assert.equal(snimci[1]?.verzija, 2);
    assert.equal(snimci[1]?.izvjestaj, undefined, "v2 nema izvjestaj i to je validno");
    assert.equal(snimci[1]?.oglasi[0]?.date, 1_785_000_000, "v2 polja prezive krug");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snimciZaBrisanje: svjezi ostaju svi, stariji od granice se prorjede na jedan po sedmici po konkurentu", () => {
  const imena = [
    // svjezi (unutar 30 dana od 2026-08-04): ostaju
    "Shop-2026-08-01.json",
    "Shop-2026-07-20.json",
    // stara sedmica (ISO sedmica 2026-W23: 01.06-07.06): tri snimka, ostaje najnoviji
    "Shop-2026-06-01.json",
    "Shop-2026-06-02.json",
    "Shop-2026-06-05.json",
    // ista sedmica, DRUGI konkurent: njegov jedan snimak ostaje
    "Drugi-2026-06-03.json",
    // fajl koji nije snimak se ne dira
    "necitljivo.txt",
  ];
  const zaBrisanje = snimciZaBrisanje(imena, "2026-08-04", 30);
  assert.deepEqual(zaBrisanje, ["Shop-2026-06-01.json", "Shop-2026-06-02.json"]);
});

test("snimciZaBrisanje: granica tacno na cuvanje_dana ne brise, prazan ulaz vraca prazno", () => {
  assert.deepEqual(snimciZaBrisanje([], "2026-08-04", 30), []);
  // 2026-07-05 je tacno 30 dana prije 2026-08-04: jos nije stariji od granice
  assert.deepEqual(snimciZaBrisanje(["Shop-2026-07-05.json"], "2026-08-04", 30), []);
  // jedan jedini stari snimak u sedmici ostaje (nema sta da se prorijedi)
  assert.deepEqual(snimciZaBrisanje(["Shop-2026-06-01.json"], "2026-08-04", 30), []);
});
