import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  efektivniLimit,
  envLimit,
  procitajOverride,
  putanjaOverrida,
  upisiOverride,
  type OverrideLimita,
} from "./slika-limit.js";

test("envLimit ima razuman default i odbija besmislene vrijednosti", () => {
  assert.equal(envLimit({}), 10);
  assert.equal(envLimit({ OLX_SLIKA_MAX_DNEVNO: "5" }), 5);
  assert.equal(envLimit({ OLX_SLIKA_MAX_DNEVNO: "0" }), 10);
  assert.equal(envLimit({ OLX_SLIKA_MAX_DNEVNO: "-3" }), 10);
  assert.equal(envLimit({ OLX_SLIKA_MAX_DNEVNO: "nista" }), 10);
});

test("putanjaOverrida cita OLX_SLIKA_LIMIT_FILE ili pada na podrazumijevanu", () => {
  assert.equal(putanjaOverrida({}), ".olx-pik/slika-limit-danas.json");
  assert.equal(putanjaOverrida({ OLX_SLIKA_LIMIT_FILE: "/tmp/x.json" }), "/tmp/x.json");
});

test("efektivniLimit: override za danas se koristi", () => {
  const override: OverrideLimita = { datum: "2026-08-14", limit: 25, kada: "2026-08-14T08:00:00.000Z", razlog: "akcija" };
  const rezultat = efektivniLimit({}, "2026-08-14", override);
  assert.deepEqual(rezultat, { limit: 25, izvor: "override" });
});

test("efektivniLimit: override za jucer (drugi datum) se ignorise", () => {
  const override: OverrideLimita = { datum: "2026-08-13", limit: 25, kada: "2026-08-13T08:00:00.000Z", razlog: null };
  const rezultat = efektivniLimit({}, "2026-08-14", override);
  assert.deepEqual(rezultat, { limit: 10, izvor: "fallback" });

  const saEnv = efektivniLimit({ OLX_SLIKA_MAX_DNEVNO: "7" }, "2026-08-14", override);
  assert.deepEqual(saEnv, { limit: 7, izvor: "env" });
});

test("efektivniLimit: bez override-a pada na env pa fallback", () => {
  assert.deepEqual(efektivniLimit({}, "2026-08-14", null), { limit: 10, izvor: "fallback" });
  assert.deepEqual(efektivniLimit({ OLX_SLIKA_MAX_DNEVNO: "3" }, "2026-08-14", null), { limit: 3, izvor: "env" });
});

test("procitajOverride: nepostojeci ili pokvaren fajl ne baca, vraca null", () => {
  const dir = mkdtempSync(join(tmpdir(), "slika-limit-"));
  try {
    assert.equal(procitajOverride(join(dir, "nema.json")), null);

    const putanja = join(dir, "override.json");
    upisiOverride({ datum: "2026-08-14", limit: 30, kada: "2026-08-14T08:00:00.000Z", razlog: null }, putanja);
    assert.deepEqual(procitajOverride(putanja), {
      datum: "2026-08-14",
      limit: 30,
      kada: "2026-08-14T08:00:00.000Z",
      razlog: null,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
