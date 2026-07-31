import test from "node:test";
import assert from "node:assert/strict";
import { regexTelefon, telefonKljuc, telefonKonfigurisan, telefonModel } from "./telefon-ekstrakcija.js";

test("regexTelefon prepoznaje BiH formate sa i bez razdvajaca", () => {
  assert.equal(regexTelefon("Kontakt: +387 61 234 567"), "+387 61 234 567");
  assert.equal(regexTelefon("Zovite na 0038761234567"), "+387 61 234 567");
  assert.equal(regexTelefon("javite se na 061 234 567 hvala"), "+387 61 234 567");
  assert.equal(regexTelefon("javite se na 061/234-567 hvala"), "+387 61 234 567");
  assert.equal(regexTelefon("061.234.567"), "+387 61 234 567");
  assert.equal(regexTelefon("61234567"), "+387 61 234 567");
});

test("regexTelefon vraca null kad broja nema", () => {
  assert.equal(regexTelefon(""), null);
  assert.equal(regexTelefon("Prodajem stol u odlicnom stanju, malo koristen."), null);
});

test("regexTelefon odbacuje ocigledne sifre, cijene i godine kao decoy", () => {
  assert.equal(regexTelefon("Sifra artikla: 06123456"), null);
  assert.equal(regexTelefon("Cijena 61234567 KM"), null);
  assert.equal(regexTelefon("Godina proizvodnje 61234567"), null);
});

test("regexTelefon vraca null kad ima vise razlicitih kandidata (ambiguozno, ide na Haiku)", () => {
  assert.equal(regexTelefon("Broj 1: 061 234 567, broj 2: 062 345 678"), null);
});

test("regexTelefon ne mijesa broj usred duzeg niza cifara", () => {
  assert.equal(regexTelefon("id narudzbe 990612345670011"), null);
});

test("regexTelefon prepoznaje isti broj naveden dvaput kao jedan rezultat", () => {
  assert.equal(regexTelefon("Tel: 061 234 567, whatsapp isti broj 061234567"), "+387 61 234 567");
});

test("telefonKljuc pada na OLX_VID_API_KEY kad OLX_TELEFON_API_KEY nije postavljen", () => {
  assert.equal(telefonKljuc({ OLX_VID_API_KEY: "vid-kljuc" }), "vid-kljuc");
  assert.equal(telefonKljuc({ OLX_TELEFON_API_KEY: "t-kljuc", OLX_VID_API_KEY: "vid-kljuc" }), "t-kljuc");
  assert.equal(telefonKljuc({}), undefined);
});

test("telefonModel ima default, env ga gazi", () => {
  assert.equal(telefonModel({}), "claude-haiku-4-5");
  assert.equal(telefonModel({ OLX_TELEFON_MODEL: "claude-haiku-4-5-20251001" }), "claude-haiku-4-5-20251001");
});

test("telefonKonfigurisan prati da li postoji ijedan upotrebljiv kljuc", () => {
  assert.equal(telefonKonfigurisan({}), false);
  assert.equal(telefonKonfigurisan({ OLX_VID_API_KEY: "x" }), true);
});
