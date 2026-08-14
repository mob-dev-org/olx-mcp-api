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
import { pokreniCli, testniDir } from "./pokreni-cli.mjs";

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

function danas() {
  return new Date().toISOString().slice(0, 10);
}
