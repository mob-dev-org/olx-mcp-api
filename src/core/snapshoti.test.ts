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

test("zadnjiSnapshot ne otvara starije fajlove", () => {
  const dir = radniDir();
  const izvornaGreska = console.error;
  const pozivi: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    pozivi.push(args);
  };
  try {
    const stari = snapshot(Math.floor(Date.parse("2026-08-01T03:00:00Z") / 1000), [{ id: 1, views: 10 }]);
    const novi = snapshot(Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000), [{ id: 1, views: 40 }]);
    // Stariji fajl je necitljiv JSON: da je otvoren, ispisao bi na stderr.
    writeFileSync(join(dir, "views-2026-07-30.json"), '{"verzija":2,"ts":175', "utf8");
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);

    assert.deepEqual(zadnjiSnapshot(dir), novi, "vraca se najnoviji ispravan snapshot");
    assert.deepEqual(pozivi, [], "stariji (pokvareni) fajl nije ni otvaran, pa nema ispisa na stderr");
  } finally {
    console.error = izvornaGreska;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zadnjiSnapshot se vraca na prethodni fajl kad je najnoviji pokvaren", () => {
  const dir = radniDir();
  try {
    const prethodni = snapshot(Math.floor(Date.parse("2026-08-05T03:00:00Z") / 1000), [{ id: 1, views: 5 }]);
    upisiSnapshot(prethodni, dir);
    // Najnoviji po imenu, ali necitljiv JSON.
    writeFileSync(join(dir, "views-2026-08-06.json"), '{"verzija":2,"ts":175', "utf8");

    assert.deepEqual(zadnjiSnapshot(dir), prethodni, "preskace pokvaren najnoviji i vraca prethodni ispravan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom u danima izostavlja starije a zadrzava novije", () => {
  const dir = radniDir();
  try {
    const danas = new Date();
    const prijeMjesec = new Date(danas.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prijeDanZaDanom = new Date(danas.getTime() - 1 * 24 * 60 * 60 * 1000);

    const format = (d: Date) => d.toISOString().slice(0, 10);
    const stariTs = Math.floor(Date.parse(`${format(prijeMjesec)}T03:00:00Z`) / 1000);
    const noviTs = Math.floor(Date.parse(`${format(prijeDanZaDanom)}T03:00:00Z`) / 1000);
    const stari = snapshot(stariTs, [{ id: 1, views: 1 }]);
    const novi = snapshot(noviTs, [{ id: 2, views: 2 }]);
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);

    const ucitani = ucitajSnapshote(dir, 7);
    assert.deepEqual(ucitani.map((s) => s.ts), [novi.ts], "samo snapshot unutar 7 dana ostaje");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom ukljucuje fajl tacno na granici", () => {
  const dir = radniDir();
  try {
    const naGranici = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const datum = naGranici.toISOString().slice(0, 10);
    const ts = Math.floor(Date.parse(`${datum}T03:00:00Z`) / 1000);
    const snap = snapshot(ts, [{ id: 1, views: 1 }]);
    upisiSnapshot(snap, dir);

    const ucitani = ucitajSnapshote(dir, 5);
    assert.deepEqual(ucitani.map((s) => s.ts), [snap.ts], "fajl tacno na granici prozora ulazi u rezultat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom koji ne obuhvata nijedan fajl vraca praznu listu", () => {
  const dir = radniDir();
  try {
    const davno = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const datum = davno.toISOString().slice(0, 10);
    const ts = Math.floor(Date.parse(`${datum}T03:00:00Z`) / 1000);
    upisiSnapshot(snapshot(ts, [{ id: 1, views: 1 }]), dir);

    assert.deepEqual(ucitajSnapshote(dir, 2), [], "prozor koji ne obuhvata nijedan fajl ne baca, vraca []");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
