import test from "node:test";
import assert from "node:assert/strict";
import { medijskiTip, vidKljuc, vidKonfigurisan, vidModel, vidProvajder, PODRAZUMIJEVANO_PITANJE } from "./vid.js";

test("vidProvajder je anthropic osim kad je izricito gemini", () => {
  assert.equal(vidProvajder({}), "anthropic");
  assert.equal(vidProvajder({ OLX_VID_PROVAJDER: "anthropic" }), "anthropic");
  assert.equal(vidProvajder({ OLX_VID_PROVAJDER: "nesto" }), "anthropic");
  assert.equal(vidProvajder({ OLX_VID_PROVAJDER: "gemini" }), "gemini");
  assert.equal(vidProvajder({ OLX_VID_PROVAJDER: " GEMINI " }), "gemini");
});

test("na Geminiju kljuc pada na OLX_SLIKA_API_KEY, na Anthropicu ne", () => {
  assert.equal(vidKljuc({ OLX_VID_PROVAJDER: "gemini", OLX_SLIKA_API_KEY: "g-kljuc" }), "g-kljuc");
  assert.equal(vidKljuc({ OLX_SLIKA_API_KEY: "g-kljuc" }), undefined, "anthropic ne smije uzeti Gemini kljuc");
  // Izricit kljuc za vid uvijek pobjedjuje, i kad je provajder gemini.
  assert.equal(vidKljuc({ OLX_VID_PROVAJDER: "gemini", OLX_VID_API_KEY: "v", OLX_SLIKA_API_KEY: "g" }), "v");
});

test("vidModel ima default po provajderu, a env ga gazi", () => {
  // Oba imena postoje na endpointu, provjereno pozivom /v1beta/models 30.07.2026.
  assert.equal(vidModel({}), "claude-haiku-4-5");
  assert.equal(vidModel({ OLX_VID_PROVAJDER: "gemini" }), "gemini-3.1-flash-lite");
  assert.equal(vidModel({ OLX_VID_PROVAJDER: "gemini", OLX_VID_MODEL: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
});

test("vidKonfigurisan prati kljuc koji provajder stvarno moze koristiti", () => {
  assert.equal(vidKonfigurisan({ OLX_SLIKA_API_KEY: "g" }), false, "bez gemini provajdera alat se ne registruje");
  assert.equal(vidKonfigurisan({ OLX_VID_PROVAJDER: "gemini", OLX_SLIKA_API_KEY: "g" }), true);
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
