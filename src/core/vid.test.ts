import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zapisiAiPoziv } from "./ai-dnevnik.js";
import {
  medijskiTip,
  opisiSliku,
  provjeriPlafonVida,
  vidEnvLimit,
  vidKljuc,
  vidKonfigurisan,
  vidModel,
  PODRAZUMIJEVANO_PITANJE,
} from "./vid.js";

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

test("vidEnvLimit ima razuman default, veci od plafona generisanja slike, i odbija besmislene vrijednosti", () => {
  assert.equal(vidEnvLimit({}), 150);
  assert.equal(vidEnvLimit({ OLX_VID_MAX_DNEVNO: "20" }), 20);
  assert.equal(vidEnvLimit({ OLX_VID_MAX_DNEVNO: "0" }), 150);
  assert.equal(vidEnvLimit({ OLX_VID_MAX_DNEVNO: "-5" }), 150);
  assert.equal(vidEnvLimit({ OLX_VID_MAX_DNEVNO: "nista" }), 150);
});

test("provjeriPlafonVida propusta ispod granice i odbija na granici", () => {
  assert.deepEqual(provjeriPlafonVida(0, 150), { ok: true });
  assert.deepEqual(provjeriPlafonVida(149, 150), { ok: true });
  const naGranici = provjeriPlafonVida(150, 150);
  assert.equal(naGranici.ok, false);
  if (!naGranici.ok) {
    assert.ok(naGranici.poruka.includes("150/150"));
    assert.ok(naGranici.poruka.includes("OLX_VID_MAX_DNEVNO"));
  }
  const iznad = provjeriPlafonVida(200, 150);
  assert.equal(iznad.ok, false);
});

test("opisiSliku odbija PRIJE poziva Gemini kad je dnevni plafon vida dostignut", async () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-vid-plafon-"));
  const fajl = join(dir, "ai-usage.jsonl");
  const staroDnevnik = process.env.OLX_AI_USAGE_FILE;
  const staroLimit = process.env.OLX_VID_MAX_DNEVNO;
  const staroKljuc = process.env.OLX_SLIKA_API_KEY;
  process.env.OLX_AI_USAGE_FILE = fajl;
  process.env.OLX_VID_MAX_DNEVNO = "1";
  process.env.OLX_SLIKA_API_KEY = "test-kljuc"; // da provjera kljuca ne padne prije provjere plafona
  try {
    zapisiAiPoziv({ izvor: "vid", zadatak: "opis_slike", model: "m", trajanjeMs: 1, ok: true });
    await assert.rejects(
      () => opisiSliku("/ne/postoji/slika.jpg"),
      (e: unknown) => e instanceof Error && /Dnevni plafon opisa slike \(vid\) je dostignut \(1\/1\)/.test(e.message),
    );
  } finally {
    if (staroDnevnik === undefined) delete process.env.OLX_AI_USAGE_FILE;
    else process.env.OLX_AI_USAGE_FILE = staroDnevnik;
    if (staroLimit === undefined) delete process.env.OLX_VID_MAX_DNEVNO;
    else process.env.OLX_VID_MAX_DNEVNO = staroLimit;
    if (staroKljuc === undefined) delete process.env.OLX_SLIKA_API_KEY;
    else process.env.OLX_SLIKA_API_KEY = staroKljuc;
  }
});
