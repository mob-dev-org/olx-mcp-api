// Test brane modela: pro varijante su iskljucene u kodu, bez izuzetka.

import { test } from "node:test";
import assert from "node:assert/strict";
import { modelDozvoljen } from "./gemini.js";

test("modelDozvoljen: pro segment pada, flash prolazi, 'pro' unutar rijeci prolazi", () => {
  assert.equal(modelDozvoljen("gemini-3.1-pro-image").ok, false);
  assert.equal(modelDozvoljen("gemini-2.5-pro").ok, false);
  assert.equal(modelDozvoljen("models/gemini-PRO").ok, false, "velika slova i prefiks putanje ne pomazu");
  assert.equal(modelDozvoljen("gemini-3.1-flash-lite-image").ok, true);
  assert.equal(modelDozvoljen("gemini-3.1-flash-lite").ok, true);
  assert.equal(modelDozvoljen("hipoteticki-professional-model").ok, true, "segment, ne podniz");
  const odbijen = modelDozvoljen("gemini-2.5-pro");
  assert.ok(!odbijen.ok && /trosk/.test(odbijen.razlog), "razlog objasnjava zasto");
});
