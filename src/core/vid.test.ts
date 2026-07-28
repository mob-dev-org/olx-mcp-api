import test from "node:test";
import assert from "node:assert/strict";
import { medijskiTip, vidKonfigurisan, PODRAZUMIJEVANO_PITANJE } from "./vid.js";

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
