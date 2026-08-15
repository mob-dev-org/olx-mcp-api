import assert from "node:assert/strict";
import { test } from "node:test";
import { vlasnistvoOglasa } from "./vlasnistvo.js";
import type { Listing } from "./types.js";

/** Najmanji oglas koji tip prihvata, plus polje `user` kakvo API stvarno vraca. */
function oglas(user: unknown): Listing {
  return { id: 1, title: "proba", user } as Listing;
}

test("vlasnistvoOglasa: isti username je moj oglas", () => {
  assert.equal(vlasnistvoOglasa(oglas({ id: 7, username: "MixBox" }), "MixBox"), "moj");
});

test("vlasnistvoOglasa: drugi username je tudji oglas", () => {
  assert.equal(vlasnistvoOglasa(oglas({ id: 9, username: "NekiDrugi" }), "MixBox"), "tudji");
});

test("vlasnistvoOglasa: velicina slova i razmaci ne mijenjaju ishod", () => {
  // Username je na platformi jedinstven bez obzira kako je otkucan, pa bi razlika u velicini slova
  // vlastiti oglas proglasila tudjim. To je kvar koji klijent osjeti odmah.
  assert.equal(vlasnistvoOglasa(oglas({ username: "mixbox" }), "MixBox"), "moj");
  assert.equal(vlasnistvoOglasa(oglas({ username: "  MixBox " }), "MixBox"), "moj");
  assert.equal(vlasnistvoOglasa(oglas({ username: "MixBox" }), " mixbox"), "moj");
});

test("vlasnistvoOglasa: bez citljivog vlasnika je nepoznat, ne tudji", () => {
  // Ova razlika je cijela poenta trece vrijednosti: pozivalac oba slucaja odbija, ali `nepoznat`
  // znaci promjenu na API-ju i ide administratoru, dok `tudji` znaci pogresan oglas i ide korisniku.
  for (const bezVlasnika of [undefined, {}, { username: "" }, { username: "   " }, { username: 42 }, null]) {
    assert.equal(vlasnistvoOglasa(oglas(bezVlasnika), "MixBox"), "nepoznat", JSON.stringify(bezVlasnika));
  }
});

test("vlasnistvoOglasa: prazan vlastiti username je nepoznat, ne poklapanje", () => {
  // Kad se vlastiti nalog ne zna, poredjenje nema smisla. Prazno naspram praznog NE smije ispasti
  // "moj", jer bi tada oglas bez vlasnika prosao kao vlastiti.
  assert.equal(vlasnistvoOglasa(oglas({ username: "MixBox" }), ""), "nepoznat");
  assert.equal(vlasnistvoOglasa(oglas({ username: "" }), ""), "nepoznat");
});
