// Testovi za loadConfig. Fokus je na razlici izmedju "varijabla nije zadana" i "zadana je prazna":
// prazan red u .env je cesta greska pri postavci klona, pa polje koje praznu vrijednost propusti
// kao ispravnu pravi kvar koji se tesko veze za uzrok.

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, odrediMcpProfil } from "./config.js";

const PODRAZUMIJEVANI_BASE_URL = "https://api.olx.ba";

test("loadConfig: bez OLX_BASE_URL uzima podrazumijevani", () => {
  assert.equal(loadConfig({}).baseUrl, PODRAZUMIJEVANI_BASE_URL);
});

test("loadConfig: prazan OLX_BASE_URL pada na podrazumijevani, ne na prazan string", () => {
  // Regresija: ranije je stajalo `??`, koje praznu vrijednost propusti, pa je baseUrl bio "" i
  // svaki API poziv je pucao bez ocitog razloga.
  assert.equal(loadConfig({ OLX_BASE_URL: "" }).baseUrl, PODRAZUMIJEVANI_BASE_URL);
});

test("loadConfig: OLX_BASE_URL od samih razmaka pada na podrazumijevani", () => {
  // Adresa od samih razmaka ne moze biti ispravna ni u jednom citanju, a otkazala bi isto kao
  // prazna: svi pozivi pucaju bez ocitog razloga. Zato se trimuje i tretira kao nezadano.
  assert.equal(loadConfig({ OLX_BASE_URL: "   " }).baseUrl, PODRAZUMIJEVANI_BASE_URL);
});

test("loadConfig: OLX_BASE_URL sa razmacima oko adrese zadrzava adresu", () => {
  assert.equal(loadConfig({ OLX_BASE_URL: "  https://proba.local  " }).baseUrl, "https://proba.local");
});

test("loadConfig: zadan OLX_BASE_URL se koristi i gubi kose crte na kraju", () => {
  assert.equal(loadConfig({ OLX_BASE_URL: "https://proba.local//" }).baseUrl, "https://proba.local");
});

// ---- profil MCP servera ----
//
// Pravilo: oznaka klijentske sesije nadjacava .env SAMO U SMJERU SUZAVANJA. Strana na koju se
// grijesi je namjerna, jer propust smije klijentu dati manje alata, nikad vise.

const KLIJENTSKI_RT = "/klon/.claude-runtime";
const ADMIN_RT = "/klon/.claude-runtime-admin";

test("odrediMcpProfil: bez ijedne oznake i bez .env vrijednosti profil je admin", () => {
  assert.equal(odrediMcpProfil({}), "admin");
});

test("odrediMcpProfil: .env sa klijent i dalje suzava i bez oznake sesije", () => {
  assert.equal(odrediMcpProfil({ OLX_MCP_PROFILE: "klijent" }), "klijent");
});

test("BRANA: klijentski runtime daje klijenta i kad .env kaze admin", () => {
  // Najvazniji slucaj u cijeloj izmjeni: podrazumijevana vrijednost u .env se okrece na admin,
  // pa klijentski put NE SMIJE zavisiti od nje.
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: "klijent", OLX_MCP_PROFILE: "admin" }), "klijent");
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: KLIJENTSKI_RT, OLX_MCP_PROFILE: "admin" }), "klijent");
});

test("odrediMcpProfil: admin bot runtime NIJE klijentski, dobija admin", () => {
  // .claude-runtime-admin pocinje istim nizom znakova kao .claude-runtime, pa bi popustljivo
  // poredjenje (startsWith/includes) admin bota tiho svelo na klijentske alate.
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: ADMIN_RT }), "admin");
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: "admin-bot" }), "admin");
});

test("odrediMcpProfil: globalni ~/.claude ne pada u klijentsku granu", () => {
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: "/Users/neko/.claude" }), "admin");
});

test("odrediMcpProfil: zavrsna kosa crta i Windows putanja se citaju isto", () => {
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: KLIJENTSKI_RT + "/" }), "klijent");
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: "C:\\klon\\.claude-runtime" }), "klijent");
  assert.equal(odrediMcpProfil({ CLAUDE_CONFIG_DIR: "C:\\klon\\.claude-runtime-admin" }), "admin");
});

test("odrediMcpProfil: izricit tip sesije je jaci od putanje", () => {
  // Alati za mjerenje (kontekst-izvjestaj, provjeri-prompt) zadaju tip izricito, pa ih zaostao
  // CLAUDE_CONFIG_DIR iz ljuske ne smije gurnuti u profil koji nisu trazili.
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: "admin-bot", CLAUDE_CONFIG_DIR: KLIJENTSKI_RT }), "admin");
});

test("odrediMcpProfil: izricit admin tip NE siri prava preko .env", () => {
  // Suzavanje kroz .env ostaje na snazi: oznaka smije samo suziti, nikad prosiriti.
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: "admin-bot", OLX_MCP_PROFILE: "klijent" }), "klijent");
});

test("odrediMcpProfil: prazne i cudno napisane vrijednosti se citaju predvidivo", () => {
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: "  ", CLAUDE_CONFIG_DIR: KLIJENTSKI_RT }), "klijent");
  assert.equal(odrediMcpProfil({ OLX_SESIJA_TIP: " KLIJENT " }), "klijent");
  assert.equal(odrediMcpProfil({ OLX_MCP_PROFILE: " Klijent " }), "klijent");
});
