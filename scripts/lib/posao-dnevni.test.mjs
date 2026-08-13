// Testovi jutarnjeg posla `posao dnevni` kroz pravi CLI proces.
//
// Odluke koje posao donosi su vec pokrivene testovima cistih funkcija: dnevniPlanObnova i
// dnevniVrijedanSlanja u src/core/izvjestaj.test.ts, ritam u ritam-obnova.test.ts. Ovdje se
// testira samo orkestracija, koja nigdje nije izvezena kao funkcija: redoslijed poziva prema
// API-ju, sta se desi kad jedna obnova pukne, i da li se do slanja poruke uopste doslo.
//
// Telegram se namjerno ne mockuje. Bez TELEGRAM_* varijabli posaljiPoruku vrati nulu ne
// pozvavsi nista, pa se scenariji dijele na one koji do slanja ne smiju doci (a) i one koji
// slanje preskacu zastavicom --bez-slanja.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pokreniMockOlx } from "./mock-olx-server.mjs";
import { pokreniCli, testniDir, zadnjiJson } from "./pokreni-cli.mjs";

const KANDIDATI = [101, 102, 103].map((id) => ({ id, title: `Oglas ${id}`, refresh_available: true }));

// Bez zapisane odluke klijenta posao samo pita i ne obnavlja nista (obnove_stanje
// "ceka_odluku"), pa scenariji sa obnovama moraju imati ritam na disku.
function zadajRitam(dir, ritam = { strategija: "sve-dostupno", kada: "2026-08-01T00:00:00Z" }) {
  mkdirSync(join(dir, ".olx-pik"), { recursive: true });
  writeFileSync(join(dir, ".olx-pik", "ritam-obnova.json"), `${JSON.stringify(ritam)}\n`, "utf8");
}

function kvotaDnevnik(dir) {
  return readFileSync(join(dir, ".olx-pik", "kvota-dnevnik.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

test("kad nema sta javiti, poruka se ne salje a posao ne pada", async () => {
  // Prazan katalog: nema obnova, nema alarma, dnevniVrijedanSlanja vraca false.
  const mock = await pokreniMockOlx({ aktivni: [], limits: { free_count: 0, free_limit: 30 } });
  const dir = testniDir("dnevni-tiho");
  try {
    zadajRitam(dir);
    const r = await pokreniCli(["posao", "dnevni"], { cwd: dir, mockUrl: mock.url });
    const rezultat = zadnjiJson(r.stdout);

    // Da je orkestracija pokusala slanje, dosla bi do BEZ_ODREDISTA i pala sa kodom 1, jer
    // TELEGRAM_* nije postavljen. Kod 0 je dokaz da do slanja nije ni doslo.
    assert.equal(r.kod, 0, "preskok poruke nije greska");
    assert.equal(rezultat.poslano_poruka, 0);
    assert.equal(rezultat.preskoceno, "nista novo za javiti");
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jedna neuspjela obnova ne obara posao", async () => {
  const mock = await pokreniMockOlx({
    aktivni: KANDIDATI,
    limits: { free_count: 0, free_limit: 30 },
    refreshOdgovori: { 102: 500 },
  });
  const dir = testniDir("dnevni-greska");
  try {
    zadajRitam(dir);
    const r = await pokreniCli(["posao", "dnevni", "--bez-slanja"], { cwd: dir, mockUrl: mock.url });
    const rezultat = zadnjiJson(r.stdout);

    assert.equal(r.kod, 0, "posao ide dalje preko pojedinacne greske");
    assert.equal(rezultat.obnovljeno, 2);
    assert.equal(rezultat.neuspjelih, 1);
    // Prolaz nije stao na gresci: i oglas iza pokvarenog je pokusan.
    assert.deepEqual(
      mock.pozivi.refresh.map((p) => p.id),
      [101, 102, 103],
    );
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stanje naloga se cita prije prve obnove, i dan se upise u kvota dnevnik", async () => {
  const mock = await pokreniMockOlx({ aktivni: KANDIDATI, limits: { free_count: 4, free_limit: 30 } });
  const dir = testniDir("dnevni-redoslijed");
  try {
    zadajRitam(dir);
    const r = await pokreniCli(["posao", "dnevni", "--bez-slanja"], { cwd: dir, mockUrl: mock.url });
    assert.equal(r.kod, 0);

    const indeks = (obrazac) => mock.pozivi.redoslijed.findIndex((p) => obrazac.test(p.putanja));
    const prvaObnova = indeks(/^\/listings\/\d+\/refresh$/);
    assert.ok(prvaObnova > 0, "bar jedna obnova je izvrsena");
    // Plan obnova se racuna iz naloga i kvote; obnova prije toga bi trosila kvotu naslijepo.
    assert.ok(indeks(/^\/me$/) < prvaObnova, "/me je procitan prije prve obnove");
    assert.ok(indeks(/^\/listing\/refresh\/limits$/) < prvaObnova, "kvota je procitana prije prve obnove");
    assert.ok(indeks(/^\/users\/[^/]+\/listings$/) < prvaObnova, "katalog je procitan prije prve obnove");

    const zapisi = kvotaDnevnik(dir);
    assert.equal(zapisi.length, 1);
    assert.equal(zapisi[0].dan, new Date().toISOString().slice(0, 10));
    assert.equal(zapisi[0].free_limit, 30);
    assert.equal(zapisi[0].free_count, 4);
    assert.equal(zapisi[0].aktivnih, KANDIDATI.length);
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--suho ne dira nijednu obnovu, ali kvotu ipak zapise", async () => {
  const mock = await pokreniMockOlx({ aktivni: KANDIDATI, limits: { free_count: 0, free_limit: 30 } });
  const dir = testniDir("dnevni-suho");
  try {
    zadajRitam(dir);
    const r = await pokreniCli(["posao", "dnevni", "--suho"], { cwd: dir, mockUrl: mock.url });
    const rezultat = zadnjiJson(r.stdout);

    assert.equal(r.kod, 0);
    assert.equal(mock.pozivi.refresh.length, 0, "suho ne salje nijedan zahtjev za obnovu");
    assert.equal(rezultat.obnovljeno, null, "suho ne tvrdi broj obnovljenih");
    assert.ok(rezultat.plan.za_obnovu > 0, "plan je izracunat, samo nije izvrsen");
    assert.equal(rezultat.poslano_poruka, 0);

    // Zateceno ponasanje, ne zahtjev: zapisiKvotu stoji IZNAD grane `if (!opts.suho)` u
    // src/cli/index.ts, pa se dnevno ocitanje kvote upisuje i u suhom rezimu. To je i korisno
    // (ocitanje je stvarno i sluzi mjerenju dana reseta), ali nije ocigledno iz imena zastavice,
    // pa test to fiksira: ako se jednom promijeni, neka bude svjesna odluka.
    assert.equal(kvotaDnevnik(dir).length, 1);
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
