import test from "node:test";
import assert from "node:assert/strict";
import { daniResetaKvote, izmjereniDanReseta, type RedKvote } from "./kvota-dnevnik.js";

function red(dan: string, freeCount: number, aktivnih = 121): RedKvote {
  return { dan, free_count: freeCount, free_limit: 1800, aktivnih };
}

test("daniResetaKvote nadje dan kad je potroseno palo", () => {
  // Ovo je cijela svrha dnevnika: API ne vraca datum reseta kvote, pa se dan reseta prepoznaje
  // po tome da potroseno skoci nazad. Unutar istog ciklusa potroseno moze samo rasti.
  const redovi = [
    red("2026-07-29", 300),
    red("2026-07-30", 310),
    red("2026-07-31", 318),
    red("2026-08-01", 330), // nije reset: raste dalje, dakle NE vazi kalendarski mjesec
    red("2026-08-23", 480),
    red("2026-08-24", 12), // reset: ciklus pretplate
    red("2026-08-25", 30),
  ];
  assert.deepEqual(daniResetaKvote(redovi), ["2026-08-24"]);
});

test("daniResetaKvote ne javlja reset kad potroseno samo raste", () => {
  assert.deepEqual(daniResetaKvote([red("2026-07-29", 300), red("2026-07-30", 310)]), []);
  assert.deepEqual(daniResetaKvote([red("2026-07-29", 300)]), [], "jedan zapis nema sa cim porediti");
  assert.deepEqual(daniResetaKvote([]), []);
});

test("daniResetaKvote nadje vise resetova kroz duzu seriju", () => {
  const redovi = [red("2026-06-24", 400), red("2026-06-25", 5), red("2026-07-23", 460), red("2026-07-24", 8)];
  assert.deepEqual(daniResetaKvote(redovi), ["2026-06-25", "2026-07-24"]);
});

test("izmjereniDanReseta vrati dan iz stvarnog mjerenja na MixBoxu", () => {
  // Prvi zivi podatak (01.08.2026): potroseno palo 318 -> 59 uz isti free_limit. Pad na 1. u
  // mjesecu ide u prilog kalendaru, suprotno hipotezi ciklusa iz 0.8.0, i zato mjerenje mora
  // pobijediti izvod iz ends_at.
  const redovi = [red("2026-07-30", 310), red("2026-07-31", 318), red("2026-08-01", 59)];
  assert.equal(izmjereniDanReseta(redovi), 1);
});

test("izmjereniDanReseta vrati undefined bez pouzdanog pada", () => {
  assert.equal(izmjereniDanReseta([]), undefined);
  assert.equal(izmjereniDanReseta([red("2026-07-31", 318)]), undefined);
  assert.equal(izmjereniDanReseta([red("2026-07-30", 300), red("2026-07-31", 318)]), undefined, "rast nije reset");
});

test("izmjereniDanReseta ignorise pad preko rupe u danima", () => {
  // Cron koji je preskocio dane bi kao dan reseta dao prvi dan kad je posao ponovo radio,
  // a ne stvarni. Bolje bez mjerenja (pada se na ciklus) nego pogresan dan.
  assert.equal(izmjereniDanReseta([red("2026-07-31", 318), red("2026-08-03", 59)]), undefined);
});

test("izmjereniDanReseta ignorise pad uz promijenjen free_limit", () => {
  // Promjena paketa mijenja brojeve, ali nije reset ciklusa.
  const redovi: RedKvote[] = [
    { dan: "2026-07-31", free_count: 318, free_limit: 1800, aktivnih: 121 },
    { dan: "2026-08-01", free_count: 59, free_limit: 750, aktivnih: 121 },
  ];
  assert.equal(izmjereniDanReseta(redovi), undefined);
});

test("izmjereniDanReseta uzima zadnji reset kad se datumi razilaze", () => {
  // Pretplata ponovo kupljena na nov datum: samo najnovije mjerenje odrazava vazeci ciklus.
  const redovi = [
    red("2026-06-24", 400),
    red("2026-06-25", 5),
    red("2026-07-31", 460),
    red("2026-08-01", 8),
  ];
  assert.equal(izmjereniDanReseta(redovi), 1);
});

test("izmjereniDanReseta radi i sa vise redova istog dana", () => {
  // Ponovljena pokretanja istog jutra upisu vise redova za isti dan; pad unutar istog dana
  // je jednako pouzdan kao pad izmedju dva uzastopna dana.
  const redovi = [red("2026-07-31", 318), red("2026-08-01", 59), red("2026-08-01", 59), red("2026-08-01", 62)];
  assert.equal(izmjereniDanReseta(redovi), 1);
});
