import test from "node:test";
import assert from "node:assert/strict";
import { medijskiTip, vidKljuc, vidKonfigurisan, vidModel, PODRAZUMIJEVANO_PITANJE } from "./vid.js";

test("vid je iskljucivo Gemini: kljuc pada na OLX_SLIKA_API_KEY", () => {
  // Odluka vlasnika 04.08.2026: jedan Gemini kljuc pokriva cijeli put slike, Anthropic
  // varijanta je uklonjena. Postavka klijenta je samo OLX_SLIKA_API_KEY.
  assert.equal(vidKljuc({ OLX_SLIKA_API_KEY: "g-kljuc" }), "g-kljuc");
  assert.equal(vidKljuc({}), undefined);
  // Izricit kljuc za vid uvijek pobjedjuje.
  assert.equal(vidKljuc({ OLX_VID_API_KEY: "v", OLX_SLIKA_API_KEY: "g" }), "v");
});

test("vidModel je najjeftiniji Gemini, a env ga gazi", () => {
  assert.equal(vidModel({}), "gemini-3.1-flash-lite");
  assert.equal(vidModel({ OLX_VID_MODEL: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
});

test("vidKonfigurisan prati kljuc", () => {
  assert.equal(vidKonfigurisan({ OLX_SLIKA_API_KEY: "g" }), true, "jedan Gemini kljuc registruje i vid");
  assert.equal(vidKonfigurisan({}), false);
});

test("medijskiTip prepoznaje podrzane formate bez obzira na velika slova", () => {
  assert.equal(medijskiTip("/inbox/slika.jpg"), "image/jpeg");
  assert.equal(medijskiTip("/inbox/SLIKA.JPEG"), "image/jpeg");
  assert.equal(medijskiTip("artikal.png"), "image/png");
  assert.equal(medijskiTip("anim.gif"), "image/gif");
  assert.equal(medijskiTip("web.webp"), "image/webp");
});

test("medijskiTip vraca null za nepodrzane formate", () => {
  assert.equal(medijskiTip("dokument.pdf"), null);
  assert.equal(medijskiTip("video.mp4"), null);
  assert.equal(medijskiTip("bez-ekstenzije"), null);
});

test("vidKonfigurisan zavisi samo od OLX_VID_API_KEY", () => {
  assert.equal(vidKonfigurisan({}), false);
  assert.equal(vidKonfigurisan({ OLX_VID_API_KEY: "" }), false);
  assert.equal(vidKonfigurisan({ OLX_VID_API_KEY: "sk-test" }), true);
});

test("podrazumijevano pitanje trazi opis za oglas i brani izmisljanje", () => {
  assert.ok(PODRAZUMIJEVANO_PITANJE.includes("oglas"));
  assert.ok(PODRAZUMIJEVANO_PITANJE.includes("Ne izmisljaj"));
});
