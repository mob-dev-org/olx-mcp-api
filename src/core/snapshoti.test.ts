// Testovi citanja i pisanja snapshota. Racunanje nad snapshotima je u stats.ts i ima svoje
// testove; ovdje se provjerava samo dodir sa diskom: da upisano moze da se procita, da se
// polovicno upisan fajl nikad ne vidi, i da jedan pokvaren fajl ne obori cijelu seriju.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ucitajSnapshote, upisiSnapshot, zadnjiSnapshot } from "./snapshoti.js";
import type { ViewsSnapshot } from "./stats.js";

function radniDir(): string {
  return mkdtempSync(join(tmpdir(), "olx-snapshoti-"));
}

function snapshot(ts: number, oglasi: ViewsSnapshot["oglasi"] = []): ViewsSnapshot {
  return { verzija: 2, ts, account: "testni-shop", oglasi };
}

test("upisiSnapshot pa ucitajSnapshote vraca isti sadrzaj", () => {
  const dir = radniDir();
  try {
    const ulaz = snapshot(Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000), [
      { id: 1, views: 120, title: "Prvi oglas", slika_broj: 4, ima_podnaslov: true, opis_znakova: 300, atributa: 6 },
      { id: 2, views: 0, title: "Drugi oglas" },
    ]);
    const putanja = upisiSnapshot(ulaz, dir);
    assert.equal(putanja, `${dir}/views-2026-08-10.json`, "ime fajla je izvedeno iz ts snapshota");
    assert.equal(existsSync(putanja), true, "fajl je na disku");

    const ucitani = ucitajSnapshote(dir);
    assert.equal(ucitani.length, 1);
    assert.deepEqual(ucitani[0], ulaz, "round-trip ne gubi ni jedno polje");
    assert.deepEqual(zadnjiSnapshot(dir), ulaz);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upisiSnapshot ne ostavlja privremeni .tmp fajl", () => {
  const dir = radniDir();
  try {
    const putanja = upisiSnapshot(snapshot(Math.floor(Date.parse("2026-08-11T03:00:00Z") / 1000)), dir);
    assert.equal(existsSync(`${putanja}.tmp`), false, "tmp je preimenovan, ne ostavljen");
    // Ni jedan drugi .tmp ostatak: backup stanja kopira ovaj folder dok pogon radi.
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.endsWith(".tmp")),
      [],
      "u folderu nema nijednog .tmp ostatka",
    );
    assert.deepEqual(readdirSync(dir), ["views-2026-08-11.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote preskace pokvaren fajl umjesto da baci", () => {
  const dir = radniDir();
  try {
    const stari = snapshot(Math.floor(Date.parse("2026-08-01T03:00:00Z") / 1000), [{ id: 1, views: 10 }]);
    const novi = snapshot(Math.floor(Date.parse("2026-08-03T03:00:00Z") / 1000), [{ id: 1, views: 40 }]);
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);
    // Presjecen upis sa starije verzije toolkita (prije tmp+rename obrasca) izgleda ovako.
    writeFileSync(join(dir, "views-2026-08-02.json"), '{"verzija":2,"ts":1754', "utf8");
    // Validan JSON ali pogresnog oblika: ni ovo ne smije uci u seriju ni oboriti citanje.
    writeFileSync(join(dir, "views-2026-08-04.json"), '{"verzija":2,"ts":"nije broj","oglasi":[]}', "utf8");

    const ucitani = ucitajSnapshote(dir);
    assert.deepEqual(
      ucitani.map((s) => s.ts),
      [stari.ts, novi.ts],
      "vracaju se samo ispravni snapshoti, hronoloski",
    );
    assert.deepEqual(zadnjiSnapshot(dir), novi);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote na nepostojecem folderu vraca praznu listu", () => {
  assert.deepEqual(ucitajSnapshote(join(tmpdir(), "olx-snapshoti-ne-postoji-nikako")), []);
  assert.equal(zadnjiSnapshot(join(tmpdir(), "olx-snapshoti-ne-postoji-nikako")), null);
});
