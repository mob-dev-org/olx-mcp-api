// Testovi planera izdvajanja. Budzet je tvrda granica, pa se testira i slucaj gdje veci artikal
// ne stane a manji poslije njega stane. Datumi se zadaju, ne citaju sa sata, da rezultat bude isti
// svaki put.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlan,
  dodajDane,
  dospjeliTermini,
  oznaciTermin,
  planSazetak,
  zaglavljeniTermini,
  type PlanKandidat,
  type SponsorPlan,
} from "./plan.js";
import type { SponsorOptions } from "./types.js";

const OPCIJE: SponsorOptions = { type: 1, days: 7, refresh_every: 0 };

function kandidati(...redovi: [number, string, number?][]): PlanKandidat[] {
  return redovi.map(([id, naslov, cijena]) => (cijena === undefined ? { id, naslov } : { id, naslov, cijena }));
}

function plan(over: Partial<SponsorPlan> = {}): SponsorPlan {
  return {
    verzija: 1,
    napravljen: "2026-07-26T08:00:00.000Z",
    budzet: 100,
    dana_raspored: 3,
    termini: [],
    ...over,
  };
}

test("dodajDane racuna u UTC i ne pomjera datum za jedan dan", () => {
  assert.equal(dodajDane("2026-07-26", 0), "2026-07-26");
  assert.equal(dodajDane("2026-07-26", 1), "2026-07-27");
  assert.equal(dodajDane("2026-07-31", 1), "2026-08-01", "prelazak mjeseca");
  assert.equal(dodajDane("2026-12-31", 1), "2027-01-01", "prelazak godine");
  assert.equal(dodajDane("2028-02-28", 1), "2028-02-29", "prestupna godina");
});

test("plan nikad ne prelazi budzet", () => {
  const p = buildPlan({
    kandidati: kandidati([1, "Prvi", 40], [2, "Drugi", 40], [3, "Treci", 40]),
    budzet: 100,
    danaRaspored: 3,
    opcije: OPCIJE,
    pocetniDatum: "2026-07-26",
    napravljen: "2026-07-26T08:00:00.000Z",
  });

  assert.equal(p.termini.length, 2, "treci artikal bi presao budzet");
  assert.equal(planSazetak(p).planirani_trosak, 80);
  assert.ok(planSazetak(p).planirani_trosak <= p.budzet);
});

test("skup artikal se preskoci, a jeftiniji poslije njega ulazi u plan", () => {
  const p = buildPlan({
    kandidati: kandidati([1, "Skup", 90], [2, "Preskup", 50], [3, "Jeftin", 10]),
    budzet: 100,
    danaRaspored: 2,
    opcije: OPCIJE,
    pocetniDatum: "2026-07-26",
    napravljen: "2026-07-26T08:00:00.000Z",
  });

  assert.deepEqual(
    p.termini.map((t) => t.listing_id),
    [1, 3],
    "preskace se samo ono sto ne stane, ne i sve poslije njega",
  );
  assert.equal(planSazetak(p).planirani_trosak, 100, "budzet moze biti iskoristen do zadnjeg kredita");
});

test("kandidat bez cijene i vec izdvojen oglas ne ulaze u plan", () => {
  const p = buildPlan({
    kandidati: [
      { id: 1, naslov: "Bez cijene" },
      { id: 2, naslov: "Nula", cijena: 0 },
      { id: 3, naslov: "Vec izdvojen", cijena: 20, vec_izdvojen: true },
      { id: 4, naslov: "Dobar", cijena: 20 },
    ],
    budzet: 100,
    danaRaspored: 1,
    opcije: OPCIJE,
    pocetniDatum: "2026-07-26",
    napravljen: "2026-07-26T08:00:00.000Z",
  });

  assert.deepEqual(p.termini.map((t) => t.listing_id), [4]);
});

test("termini se rasporedjuju ravnomjerno po danima", () => {
  const p = buildPlan({
    kandidati: kandidati([1, "A", 10], [2, "B", 10], [3, "C", 10], [4, "D", 10], [5, "E", 10]),
    budzet: 1000,
    danaRaspored: 3,
    opcije: OPCIJE,
    pocetniDatum: "2026-07-26",
    napravljen: "2026-07-26T08:00:00.000Z",
  });

  assert.deepEqual(
    p.termini.map((t) => t.za_datum),
    ["2026-07-26", "2026-07-27", "2026-07-28", "2026-07-26", "2026-07-27"],
  );
  const sazetak = planSazetak(p);
  assert.deepEqual(
    sazetak.po_danima.map((d) => [d.datum, d.termina]),
    [
      ["2026-07-26", 2],
      ["2026-07-27", 2],
      ["2026-07-28", 1],
    ],
  );
});

test("dospjeli su samo planirani termini do danas", () => {
  const p = plan({
    termini: [
      { id: "1-2026-07-25", listing_id: 1, naslov: "Juce", za_datum: "2026-07-25", opcije: OPCIJE, cijena: 10, status: "planiran" },
      { id: "2-2026-07-26", listing_id: 2, naslov: "Danas", za_datum: "2026-07-26", opcije: OPCIJE, cijena: 10, status: "planiran" },
      { id: "3-2026-07-27", listing_id: 3, naslov: "Sutra", za_datum: "2026-07-27", opcije: OPCIJE, cijena: 10, status: "planiran" },
      { id: "4-2026-07-26", listing_id: 4, naslov: "Vec izvrsen", za_datum: "2026-07-26", opcije: OPCIJE, cijena: 10, status: "izvrsen" },
    ],
  });

  assert.deepEqual(
    dospjeliTermini(p, "2026-07-26").map((t) => t.listing_id),
    [1, 2],
    "sutrasnji termin se danas ne izvrsava, a izvrseni se ne ponavlja",
  );
});

test("oznaciTermin ne vraca izvrsen termin u planirano stanje", () => {
  let p = plan({
    termini: [
      { id: "1-2026-07-26", listing_id: 1, naslov: "A", za_datum: "2026-07-26", opcije: OPCIJE, cijena: 10, status: "planiran" },
    ],
  });

  p = oznaciTermin(p, "1-2026-07-26", { status: "izvrsen", izvrseno_u: "2026-07-26T09:00:00.000Z" });
  assert.equal(p.termini[0]?.status, "izvrsen");
  assert.equal(dospjeliTermini(p, "2026-07-31").length, 0, "izvrsen termin vise nije dospio");

  // Ponovno pokretanje istog dana ne smije naci nista za izvrsiti.
  const drugiProlaz = dospjeliTermini(p, "2026-07-26");
  assert.equal(drugiProlaz.length, 0, "dvostruko pokretanje ne naplacuje isto dva puta");
});

test("zaglavljen termin se prepozna i ne izvrsava automatski", () => {
  const p = plan({
    termini: [
      { id: "1-2026-07-26", listing_id: 1, naslov: "Prekinut", za_datum: "2026-07-26", opcije: OPCIJE, cijena: 10, status: "u_toku" },
    ],
  });

  assert.equal(zaglavljeniTermini(p).length, 1);
  assert.equal(dospjeliTermini(p, "2026-07-26").length, 0, "u_toku nije planiran, ne ulazi u izvrsenje");
});

test("sazetak razdvaja planirano od potrosenog", () => {
  const p = plan({
    budzet: 200,
    termini: [
      { id: "1-2026-07-26", listing_id: 1, naslov: "A", za_datum: "2026-07-26", opcije: OPCIJE, cijena: 30, status: "izvrsen" },
      { id: "2-2026-07-27", listing_id: 2, naslov: "B", za_datum: "2026-07-27", opcije: OPCIJE, cijena: 40, status: "planiran" },
      { id: "3-2026-07-27", listing_id: 3, naslov: "C", za_datum: "2026-07-27", opcije: OPCIJE, cijena: 50, status: "cijena_promijenjena" },
    ],
  });

  const s = planSazetak(p);
  assert.equal(s.termina, 3);
  assert.equal(s.izvrseno, 1);
  assert.equal(s.planirano, 1);
  assert.equal(s.preskoceno, 1);
  assert.equal(s.potroseno, 30, "potroseno je samo ono sto je stvarno izvrseno");
  assert.equal(s.planirani_trosak, 120);
  assert.equal(s.ostalo_budzeta, 170);
});
