// Kome ide poruka: rastavljanje TELEGRAM_CHAT_ID i izbor odredista.
//
// Bot je kod klijenta cesto u vise grupa, a Bot API nema poziv koji vraca u kojima je. Spisak
// zato dolazi iz access.json runtimea, uz `.env` kao dopunu. Jedan id bez zareza mora raditi
// kao i prije.

import assert from "node:assert/strict";
import { test } from "node:test";
import { chatIdovi, izaberiOdredista } from "./telegram.js";

test("jedan id radi kao i prije", () => {
  assert.deepEqual(chatIdovi("-1001234"), ["-1001234"]);
});

test("vise grupa se rastavlja po zarezu i ciste se razmaci", () => {
  assert.deepEqual(chatIdovi(" -1001234 , -1005678 "), ["-1001234", "-1005678"]);
});

test("prazno i nepostavljeno daju prazan spisak, ne odrediste", () => {
  assert.deepEqual(chatIdovi(""), []);
  assert.deepEqual(chatIdovi(undefined), []);
  assert.deepEqual(chatIdovi(" , , "), []);
});

test("duplikat ne salje dvije iste poruke u istu grupu", () => {
  assert.deepEqual(chatIdovi("-1001234,-1001234"), ["-1001234"]);
});

// ---- izbor odredista ----
// Cista funkcija, pa se cijela odluka o tome kome ide poruka testira bez diska i bez mreze.
// `posaljiPoruku` se namjerno ne testira: u njoj poslije ovoga nema nijedne odluke, samo fetch.

test("eksplicitan chatId gazi i .env i access.json", () => {
  assert.deepEqual(izaberiOdredista("-999", "-111", ["-222"]), ["-999"]);
});

test("bez eksplicitnog: unija access.json i .env, access prvi", () => {
  assert.deepEqual(izaberiOdredista(undefined, "-111", ["-222", "-333"]), ["-222", "-333", "-111"]);
});

test("isti id u oba izvora ne salje poruku dvaput", () => {
  assert.deepEqual(izaberiOdredista(undefined, "-222", ["-222"]), ["-222"]);
  assert.deepEqual(izaberiOdredista(undefined, " -222 ", ["-222"]), ["-222"], "razmaci ne prave duplikat");
});

test("jedan izvor prazan ne obara drugi", () => {
  assert.deepEqual(izaberiOdredista(undefined, undefined, ["-222"]), ["-222"], "samo access");
  assert.deepEqual(izaberiOdredista(undefined, "-111", []), ["-111"], "samo .env");
  assert.deepEqual(izaberiOdredista(undefined, "", []), [], "oba prazna");
});
