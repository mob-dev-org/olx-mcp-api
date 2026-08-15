// Testovi za loadConfig. Fokus je na razlici izmedju "varijabla nije zadana" i "zadana je prazna":
// prazan red u .env je cesta greska pri postavci klona, pa polje koje praznu vrijednost propusti
// kao ispravnu pravi kvar koji se tesko veze za uzrok.

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

const PODRAZUMIJEVANI_BASE_URL = "https://api.olx.ba";

test("loadConfig: bez OLX_BASE_URL uzima podrazumijevani", () => {
  assert.equal(loadConfig({}).baseUrl, PODRAZUMIJEVANI_BASE_URL);
});

test("loadConfig: prazan OLX_BASE_URL pada na podrazumijevani, ne na prazan string", () => {
  // Regresija: ranije je stajalo `??`, koje praznu vrijednost propusti, pa je baseUrl bio "" i
  // svaki API poziv je pucao bez ocitog razloga.
  assert.equal(loadConfig({ OLX_BASE_URL: "" }).baseUrl, PODRAZUMIJEVANI_BASE_URL);
});

test("loadConfig: OLX_BASE_URL koji je samo razmaci se tretira kao zadan", () => {
  // Namjerno: `||` hvata samo prazan string. Razmaci su i dalje "nesto je zadano", pa se ne
  // pogadja sta je korisnik mislio. Ovo fiksira zateceno ponasanje, da promjena bude svjesna.
  assert.equal(loadConfig({ OLX_BASE_URL: "   " }).baseUrl, "   ");
});

test("loadConfig: zadan OLX_BASE_URL se koristi i gubi kose crte na kraju", () => {
  assert.equal(loadConfig({ OLX_BASE_URL: "https://proba.local//" }).baseUrl, "https://proba.local");
});
