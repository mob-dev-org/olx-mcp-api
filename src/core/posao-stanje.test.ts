// Testovi za ishod zadnjeg pokretanja zakazanog posla i odluku o obavijesti o oporavku.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  procitajIshodPosla,
  trebaObavijestOOporavku,
  ucitajPosaoStanje,
  zapisiIshodPosla,
  type PosaoZapis,
} from "./posao-stanje.js";

test("trebaObavijestOOporavku: nema prethodnog zapisa daje false", () => {
  assert.equal(trebaObavijestOOporavku(null), false);
});

test("trebaObavijestOOporavku: prethodni ok daje false", () => {
  assert.equal(trebaObavijestOOporavku({ ishod: "ok", ts: 1 }), false);
});

test("trebaObavijestOOporavku: prethodni pad daje true", () => {
  assert.equal(trebaObavijestOOporavku({ ishod: "pad", ts: 1, greska: "429" }), true);
});

test("upis pa citanje vraca isti zapis", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    const zapis: PosaoZapis = { ishod: "ok", ts: 1755500000 };
    zapisiIshodPosla("snapshot", zapis, putanja);
    assert.deepEqual(procitajIshodPosla("snapshot", putanja), zapis);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upis za jedan posao cuva zapis drugog posla u istom fajlu", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    zapisiIshodPosla("snapshot", { ishod: "pad", ts: 1, greska: "prvi" }, putanja);
    zapisiIshodPosla("dnevni", { ishod: "ok", ts: 2 }, putanja);
    // Drugi upis (dnevni) ne smije obrisati prvi (snapshot).
    assert.deepEqual(procitajIshodPosla("snapshot", putanja), { ishod: "pad", ts: 1, greska: "prvi" });
    assert.deepEqual(procitajIshodPosla("dnevni", putanja), { ishod: "ok", ts: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nepostojeci fajl daje prazno stanje bez bacanja", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "ne-postoji.json");
  try {
    assert.deepEqual(ucitajPosaoStanje(putanja), {});
    assert.equal(procitajIshodPosla("snapshot", putanja), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pokvaren JSON daje prazno stanje bez bacanja", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    writeFileSync(putanja, "{ ovo nije validan json", "utf8");
    assert.deepEqual(ucitajPosaoStanje(putanja), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zapis posla koji nije ocekivanog oblika se preskace, ostali ostaju citljivi", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    writeFileSync(
      putanja,
      JSON.stringify({
        snapshot: { ishod: "ok", ts: 1 },
        dnevni: { ishod: "nesto-cudno", ts: "nije-broj" },
        sedmicni: "nije ni objekat",
      }),
      "utf8",
    );
    const stanje = ucitajPosaoStanje(putanja);
    assert.deepEqual(stanje.snapshot, { ishod: "ok", ts: 1 });
    assert.equal(stanje.dnevni, undefined);
    assert.equal(stanje.sedmicni, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("greska se skracuje pri upisu", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    const dugackaGreska = "x".repeat(1000);
    zapisiIshodPosla("snapshot", { ishod: "pad", ts: 1, greska: dugackaGreska }, putanja);
    const zapis = procitajIshodPosla("snapshot", putanja);
    assert.ok(zapis);
    assert.equal(zapis?.greska?.length, 300);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prelaz pad pa uspjeh salje obavijest, uspjeh pa uspjeh ne salje", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-posao-stanje-"));
  const putanja = join(dir, "posao-stanje.json");
  try {
    // Prvo pokretanje pada.
    zapisiIshodPosla("snapshot", { ishod: "pad", ts: 1, greska: "429" }, putanja);
    // Drugo pokretanje: PRIJE upisa novog ishoda cita se prethodni zapis, isto kao u CLI.
    let prethodni = procitajIshodPosla("snapshot", putanja);
    assert.equal(trebaObavijestOOporavku(prethodni), true, "pad pa uspjeh salje obavijest");
    zapisiIshodPosla("snapshot", { ishod: "ok", ts: 2 }, putanja);

    // Trece pokretanje: prethodni je sada "ok", pa se obavijest vise ne salje.
    prethodni = procitajIshodPosla("snapshot", putanja);
    assert.equal(trebaObavijestOOporavku(prethodni), false, "uspjeh pa uspjeh ne salje obavijest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
