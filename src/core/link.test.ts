import assert from "node:assert/strict";
import { test } from "node:test";
import { linkOglasa } from "./link.js";

test("linkOglasa sastavi link sa slugom i bez njega", () => {
  // Oba oblika provjerena zivim pozivom 30.07.2026., oba vracaju HTTP 200.
  assert.equal(linkOglasa(78452167, undefined, {}), "https://olx.ba/artikal/78452167");
  assert.equal(
    linkOglasa(78452167, "cars-lightning-mcqueen-rodjendanski-set", {}),
    "https://olx.ba/artikal/78452167/cars-lightning-mcqueen-rodjendanski-set",
  );
});

test("linkOglasa prima id kao string, jer ga alati tako primaju", () => {
  assert.equal(linkOglasa("78452167", undefined, {}), "https://olx.ba/artikal/78452167");
});

test("linkOglasa vraca null kad id nije upotrebljiv", () => {
  // Bolje nista nego link tipa /artikal/undefined poslan korisniku.
  for (const los of [undefined, null, "", "abc", 0, -5, Number.NaN]) {
    assert.equal(linkOglasa(los, undefined, {}), null, `id ${JSON.stringify(los)} mora dati null`);
  }
});

test("prazan ili razmakom pun slug se ponasa kao da ga nema", () => {
  assert.equal(linkOglasa(5, "", {}), "https://olx.ba/artikal/5");
  assert.equal(linkOglasa(5, "   ", {}), "https://olx.ba/artikal/5");
  assert.equal(linkOglasa(5, 123, {}), "https://olx.ba/artikal/5", "slug koji nije string se ignorise");
});

test("kose crte na krajevima ne prave duplu crtu u linku", () => {
  assert.equal(linkOglasa(5, "/moj-slug/", {}), "https://olx.ba/artikal/5/moj-slug");
  assert.equal(linkOglasa(5, undefined, { OLX_PUBLIC_URL: "https://pik.ba/" }), "https://pik.ba/artikal/5");
});

test("domen se mijenja kroz OLX_PUBLIC_URL, zbog rebranda olx.ba u pik.ba", () => {
  assert.equal(linkOglasa(9, "nesto", { OLX_PUBLIC_URL: "https://pik.ba" }), "https://pik.ba/artikal/9/nesto");
});
