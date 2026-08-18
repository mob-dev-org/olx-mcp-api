// Cisti testovi za tempo.ts: sablon endpointa, azuriranje stanja i plan cekanja.
// Nema mreze, nema sata sistema: sve vrijeme je prosljedjeno kao parametar.

import assert from "node:assert/strict";
import { test } from "node:test";
import { azurirajStanje, kljucEndpointa, planKasnjenja, PROZOR_MS, REZERVA_MS, type StanjeTempa } from "./tempo.js";

test("kljucEndpointa normalizuje putanju u sablon", () => {
  const primjeri: Array<[string, string]> = [
    ["/users/MixBox/listings", "/users/*/listings"],
    ["/users/nabavi/listings/expired", "/users/*/listings/expired"],
    ["/listings/123", "/listings/*"],
    ["/listing/refresh/limits", "/listing/refresh/limits"],
    ["/me", "/me"],
    ["/listings/123?foo=bar&baz=1", "/listings/*"],
  ];
  for (const [ulaz, ocekivano] of primjeri) {
    assert.equal(kljucEndpointa(ulaz), ocekivano, `za ${ulaz}`);
  }
});

test("azurirajStanje: nema starog stanja postavlja prozor na sada", () => {
  const sada = 1000;
  const stanje = azurirajStanje(null, { remaining: 59, limit: 60 }, sada);
  assert.equal(stanje.prozorPoceoMs, sada);
  assert.equal(stanje.remaining, 59);
  assert.equal(stanje.limit, 60);
});

test("azurirajStanje: remaining koji pada ostavlja prozor nepromijenjen", () => {
  const staro: StanjeTempa = { remaining: 59, limit: 60, prozorPoceoMs: 1000 };
  const novo = azurirajStanje(staro, { remaining: 40, limit: 60 }, 5000);
  assert.equal(novo.prozorPoceoMs, 1000, "prozor ostaje na starom pocetku");
  assert.equal(novo.remaining, 40);
});

test("azurirajStanje: remaining koji skoci postavlja nov prozor", () => {
  const staro: StanjeTempa = { remaining: 2, limit: 60, prozorPoceoMs: 1000 };
  const novo = azurirajStanje(staro, { remaining: 59, limit: 60 }, 70000);
  assert.equal(novo.prozorPoceoMs, 70000, "skok remaining-a znaci da je prozor resetovan");
});

test("planKasnjenja: bez stanja daje 0", () => {
  assert.equal(planKasnjenja({ stanje: null, sada: 1000 }), 0);
});

test("planKasnjenja: remaining iznad praga daje 0", () => {
  const stanje: StanjeTempa = { remaining: 30, limit: 60, prozorPoceoMs: 0 };
  assert.equal(planKasnjenja({ stanje, sada: 1000 }), 0);
});

test("planKasnjenja: remaining na pragu daje cekanje do kraja prozora", () => {
  const prozorPoceoMs = 1_000_000;
  const stanje: StanjeTempa = { remaining: 5, limit: 60, prozorPoceoMs };
  const sada = prozorPoceoMs + 10_000; // 10s u prozor
  const ocekivano = PROZOR_MS + REZERVA_MS - 10_000;
  assert.equal(planKasnjenja({ stanje, sada }), ocekivano);
});

test("planKasnjenja: istekao prozor daje 0", () => {
  const prozorPoceoMs = 0;
  const stanje: StanjeTempa = { remaining: 0, limit: 60, prozorPoceoMs };
  const sada = PROZOR_MS + REZERVA_MS + 5000; // vec je prosao kraj prozora
  assert.equal(planKasnjenja({ stanje, sada }), 0);
});

test("planKasnjenja: remaining ispod praga (nula) racuna isto kao na pragu", () => {
  const prozorPoceoMs = 500;
  const stanje: StanjeTempa = { remaining: 0, limit: 60, prozorPoceoMs };
  const sada = prozorPoceoMs + 1000;
  assert.equal(planKasnjenja({ stanje, sada }), PROZOR_MS + REZERVA_MS - 1000);
});
