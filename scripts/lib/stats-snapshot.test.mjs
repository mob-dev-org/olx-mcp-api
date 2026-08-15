// Testovi nocnog posla `stats snapshot` kroz pravi CLI proces.
//
// Racunanje nad snapshotima pokriva stats.ts, upis pokriva src/core/snapshoti.test.ts, a
// zauzimanje kljuca src/core/plan-fajl.test.ts. Ovdje ostaje samo ono sto ni jedan od njih ne
// vidi: da li orkestracija u CLI-ju pada kako treba i da li kljuc uopste stoji na tom putu.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pokreniMockOlx } from "./mock-olx-server.mjs";
import { pokreniCli, testniDir, zadnjiJson } from "./pokreni-cli.mjs";

const OGLASI = [
  { id: 11, title: "Prvi", views: 10 },
  { id: 12, title: "Drugi", views: 20 },
  { id: 13, title: "Treci", views: 30 },
];

test("stats snapshot pada sa kodom 1 kad getListing pukne usred prolaza", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI, getListingOdgovori: { 12: 500 } });
  const dir = testniDir("snapshot-pad");
  try {
    const r = await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url });

    assert.equal(r.kod, 1, "posao mora pasti, a ne tiho preskociti oglas");
    assert.match(r.stderr, /snapshot/i, "posaoFail javlja koji posao je pao");
    // Djelimicna serija je gora od nikakve: prirast pregleda bi se racunao nad snimkom kojem
    // fali dio kataloga.
    assert.equal(existsSync(join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json")), false);
    // Kljuc se otpusta i kad posao padne, inace bi sutrasnji pokusaj zatekao zaglavljen lock.
    assert.equal(existsSync(join(dir, ".olx-pik", "snapshots", "snapshot.lock")), false, "kljuc je otpusten");
    // Prolaz je stao na prvom padu, nije nastavio kroz ostatak kataloga.
    assert.deepEqual(
      mock.pozivi.getListing.map((p) => p.id),
      [11, 12],
    );
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stats snapshot odbija rad dok kljuc drzi ziv proces", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-kljuc");
  try {
    // Vlastiti pid: proces koji sigurno zivi dok test traje, isti ishod kao da paralelni
    // snapshot jos radi, ali bez trke izmedju dva procesa u testu.
    const snapshoti = join(dir, ".olx-pik", "snapshots");
    mkdirSync(snapshoti, { recursive: true });
    writeFileSync(join(snapshoti, "snapshot.lock"), String(process.pid), "utf8");

    const r = await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url });

    assert.equal(r.kod, 1, "drugi snapshot ne smije proci dok prvi traje");
    assert.match(r.stderr, /vec u toku/i, "poruka kaze da posao vec radi");
    // Nijedan oglas nije dohvacen: kljuc stoji prije prolaza kroz katalog, pa se dupli posao
    // ne placa ni jednim pozivom API-ju.
    assert.equal(mock.pozivi.getListing.length, 0);
    // Tudji kljuc se ne otima.
    assert.equal(readFileSync(join(snapshoti, "snapshot.lock"), "utf8"), String(process.pid));
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stats snapshot na budzetu 0 staje uredno: pise radni fajl, ne pise snapshot", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-budzet");
  try {
    // Budzet 0 znaci da provjera nakon PRVOG obradjenog oglasa uvijek prijavi da je budzet
    // potrosen (Date.now() - start >= 0 je uvijek tacno), pa se prolaz zaustavlja nakon jednog.
    const r = await pokreniCli(["stats", "snapshot"], {
      cwd: dir,
      mockUrl: mock.url,
      env: { OLX_BUDZET_SNAPSHOT_MS: "0" },
    });

    assert.equal(r.kod, 0, "prekid na budzetu je planiran nastavak, ne kvar");
    assert.deepEqual(mock.pozivi.getListing.map((p) => p.id), [11], "obradjen tacno jedan oglas");
    assert.equal(
      existsSync(join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json")),
      false,
      "djelimican snapshot se nikad ne pise",
    );

    const radniPutanja = join(dir, ".olx-pik", "snapshots", ".snapshot-u-toku.json");
    assert.equal(existsSync(radniPutanja), true, "radni fajl je upisan");
    const radni = JSON.parse(readFileSync(radniPutanja, "utf8"));
    assert.equal(radni.account, "testni-shop");
    assert.deepEqual(radni.idevi, [11, 12, 13], "cio spisak zamrznut na pocetku prolaza");
    assert.deepEqual(radni.oglasi.map((o) => o.id), [11]);

    const izlaz = zadnjiJson(r.stdout);
    assert.equal(izlaz?.nastavlja_se, true);
    assert.equal(izlaz?.oglasa_obidjeno, 1);
    assert.equal(izlaz?.oglasa_ukupno, 3);

    assert.equal(existsSync(join(dir, ".olx-pik", "snapshots", "snapshot.lock")), false, "kljuc je otpusten");
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("drugo pokretanje nastavlja po zapamcenom spisku i dovrsi snapshot", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-nastavak");
  try {
    // Prvo pokretanje: budzet 0, stane nakon oglasa 11.
    await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url, env: { OLX_BUDZET_SNAPSHOT_MS: "0" } });
    assert.deepEqual(mock.pozivi.getListing.map((p) => p.id), [11]);

    // Drugo pokretanje: normalan budzet, nastavlja TACNO od preostalih ID-eva (12, 13), ne
    // ponavlja 11.
    const r = await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url });

    assert.equal(r.kod, 0);
    assert.deepEqual(mock.pozivi.getListing.map((p) => p.id), [11, 12, 13], "11 nije ponovo procitan");

    const snapshotPutanja = join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json");
    assert.equal(existsSync(snapshotPutanja), true, "snapshot je konacno upisan");
    const snapshot = JSON.parse(readFileSync(snapshotPutanja, "utf8"));
    assert.equal(snapshot.verzija, 3);
    assert.deepEqual(
      snapshot.oglasi.map((o) => o.id).sort((a, b) => a - b),
      [11, 12, 13],
      "svi oglasi kataloga su u konacnom snapshotu",
    );
    assert.ok(
      snapshot.oglasi.every((o) => typeof o.procitano_ts === "number"),
      "svaki oglas nosi trenutak kad je procitan",
    );

    assert.equal(
      existsSync(join(dir, ".olx-pik", "snapshots", ".snapshot-u-toku.json")),
      false,
      "radni fajl je obrisan poslije uspjesnog zavrsetka",
    );
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prolaz stariji od granice se odbacuje, snapshot se ne pise i prolaz krece iznova", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-prestar");
  try {
    const snapshoti = join(dir, ".olx-pik", "snapshots");
    mkdirSync(snapshoti, { recursive: true });
    // Radni fajl "star" 1 sat, uz granicu od samo 1000 ms: odmah premasena.
    const staraOsoba = {
      pocetak: Math.floor(Date.now() / 1000) - 3600,
      account: "testni-shop",
      idevi: [11, 12, 13],
      oglasi: [{ id: 11, views: 10 }],
      broj_poziva: 2,
      trajanje_ms: 100,
    };
    writeFileSync(join(snapshoti, ".snapshot-u-toku.json"), JSON.stringify(staraOsoba), "utf8");

    const r = await pokreniCli(["stats", "snapshot"], {
      cwd: dir,
      mockUrl: mock.url,
      env: { OLX_MAX_TRAJANJE_SNAPSHOT_PROLAZA_MS: "1000" },
    });

    assert.equal(r.kod, 0, "odbacen prestar prolaz i restart nije kvar posla");
    assert.match(r.stderr, /trajao duze/i, "javlja se razlog odbacivanja");
    // Prolaz je krenuo iznova od pocetka kataloga: svi oglasi su procitani, ukljucujuci 11
    // (nije preuzet iz odbacenog radnog fajla).
    assert.deepEqual(mock.pozivi.getListing.map((p) => p.id), [11, 12, 13]);

    const snapshotPutanja = join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json");
    assert.equal(existsSync(snapshotPutanja), true, "novi prolaz je stigao do kraja i upisao snapshot");
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("radni fajl sa drugim nalogom se odbacuje", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-tudji-nalog");
  try {
    const snapshoti = join(dir, ".olx-pik", "snapshots");
    mkdirSync(snapshoti, { recursive: true });
    const tudji = {
      pocetak: Math.floor(Date.now() / 1000),
      account: "neki-drugi-shop",
      idevi: [11, 12, 13],
      oglasi: [{ id: 11, views: 999 }],
      broj_poziva: 2,
      trajanje_ms: 100,
    };
    writeFileSync(join(snapshoti, ".snapshot-u-toku.json"), JSON.stringify(tudji), "utf8");

    const r = await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url });

    assert.equal(r.kod, 0);
    assert.match(r.stderr, /drugom nalogu/i);
    // Prolaz je krenuo iznova, dakle 11 je ponovo procitan (nije preuzet tudji zapis).
    assert.deepEqual(mock.pozivi.getListing.map((p) => p.id), [11, 12, 13]);

    const snapshotPutanja = join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json");
    const snapshot = JSON.parse(readFileSync(snapshotPutanja, "utf8"));
    assert.equal(snapshot.account, "testni-shop");
    assert.equal(
      snapshot.oglasi.find((o) => o.id === 11)?.views,
      10,
      "vrijednost je iz svjeze procitanog oglasa, ne iz tudjeg zapisa",
    );
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stats snapshot i dalje odbija upis nepotpune liste aktivnih oglasa (brana ostaje)", async () => {
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-nepotpuno");
  try {
    // Osigurac na 0 stranica cini prvu (i jedinu) stranicu "previse", pa je lista nepotpuna
    // (razlog "osigurac") bez ijednog dodatnog poziva.
    const r = await pokreniCli(["stats", "snapshot"], {
      cwd: dir,
      mockUrl: mock.url,
      env: { OLX_MAX_STRANICA_LISTE: "0" },
    });

    assert.equal(r.kod, 1, "brana i dalje odbija nepotpunu listu");
    assert.match(r.stderr, /nije potpuna/i);
    assert.equal(mock.pozivi.getListing.length, 0, "obilazak oglasa nije ni pocinjao");
    assert.equal(
      existsSync(join(dir, ".olx-pik", "snapshots", "views-" + danas() + ".json")),
      false,
    );
    assert.equal(
      existsSync(join(dir, ".olx-pik", "snapshots", ".snapshot-u-toku.json")),
      false,
      "ni radni fajl se ne pravi kad lista nije potpuna",
    );
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function danas() {
  return new Date().toISOString().slice(0, 10);
}

test("prorjedjivanje ide tek poslije potpunog prolaza, ne poslije prekida na budzetu", async () => {
  // Prag i gustina namjerno agresivni, da bi stari fajl sigurno bio kandidat za brisanje.
  // Prekinut prolaz ne smije dirati istoriju: inace bi neuspjeli prolaz svakodnevno grickao
  // seriju bez ijednog novog snapshota.
  const mock = await pokreniMockOlx({ aktivni: OGLASI });
  const dir = testniDir("snapshot-proredjivanje");
  const env = { OLX_SNAPSHOT_PROREDJIVANJE_PRAG_DANA: "1", OLX_SNAPSHOT_PROREDJIVANJE_GUSTINA_DANA: "7" };
  try {
    const snapDir = join(dir, ".olx-pik", "snapshots");
    mkdirSync(snapDir, { recursive: true });
    // Dva stara fajla u istom sedmicnom bloku: prorjedjivanje smije zadrzati samo stariji.
    const stari = ["views-2020-01-02.json", "views-2020-01-03.json"];
    for (const f of stari) {
      writeFileSync(join(snapDir, f), JSON.stringify({ verzija: 2, ts: 1577923200, oglasi: [] }), "utf8");
    }

    await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url, env: { ...env, OLX_BUDZET_SNAPSHOT_MS: "0" } });
    for (const f of stari) {
      assert.equal(existsSync(join(snapDir, f)), true, `prekinut prolaz ne smije obrisati ${f}`);
    }

    const r = await pokreniCli(["stats", "snapshot"], { cwd: dir, mockUrl: mock.url, env });
    assert.equal(r.kod, 0);
    assert.equal(existsSync(join(snapDir, "views-" + danas() + ".json")), true, "potpun prolaz je upisao snapshot");
    assert.equal(zadnjiJson(r.stdout)?.proredjeno, 1, "tacno jedan stari fajl je proredjen");
    assert.equal(existsSync(join(snapDir, "views-2020-01-02.json")), true, "najstariji u bloku se zadrzava");
    assert.equal(existsSync(join(snapDir, "views-2020-01-03.json")), false, "ostatak bloka se brise");
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
