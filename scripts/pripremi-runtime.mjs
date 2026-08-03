#!/usr/bin/env node
// Priprema klijentski runtime u ovom klonu: .claude-runtime/
//
// Node umjesto basha namjerno: isti fajl radi na macOS-u i Windowsu (pravilo pogona).
//
// Zasto odvojen config dir: CLAUDE_CONFIG_DIR daje klijentskoj sesiji vlastiti ~/.claude. Jednim
// potezom rjesava dvije stvari koje bi inace bile dva problema:
//   1. globalni MCP serveri (serena, excalidraw, pencil, mermaid) se ne ucitavaju uopste,
//   2. TELEGRAM_STATE_DIR ide unutra, pa svaki klijent ima svoj bot i svoj allowlist. Bez toga
//      bi svi klijenti dijelili ~/.claude/channels/telegram i jedan bi citao tudje poruke.
//
// Upotreba iz korijena klona:
//   node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>[,<jos_jedan>...]
//
// Prije ovoga u BotFatheru za tog bota OBAVEZNO: /setprivacy -> Disable.
// Bez toga bot u grupi vidi samo poruke u kojima je izricito spomenut i nista nece raditi.
// (Suprotno od admin bota, kojem privacy ostaje ukljucen; vidi pripremi-admin-runtime.mjs.)

import { chmodSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { instalirajTelegramPlugin } from "./lib/telegram-plugin.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [botToken, idGrupe, korisniciArg] = process.argv.slice(2);
if (!botToken || !idGrupe || !korisniciArg) {
  console.error("Upotreba: node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>[,<telegram_id>...]");
  console.error("Primjer:  node scripts/pripremi-runtime.mjs 123:AAH... -5270659685 7061697037,7061697038");
  process.exit(1);
}
const korisnici = korisniciArg.split(",").map((k) => k.trim()).filter(Boolean);

const RUNTIME = join(KORIJEN, ".claude-runtime");
const TELEGRAM_DIR = join(RUNTIME, "channels", "telegram");

if (existsSync(RUNTIME)) {
  console.error(`Vec postoji ${RUNTIME}.`);
  console.error("Obrisi ga rucno ako hoces ispocetka; skripta ne prepisuje postojeci runtime da ne pobrise uparivanja.");
  process.exit(1);
}

mkdirSync(join(TELEGRAM_DIR, "inbox"), { recursive: true });
mkdirSync(join(TELEGRAM_DIR, "approved"), { recursive: true });

// Prazan .claude.json: nijedan globalni MCP server. Servere donosi projektni .mcp.json.
writeFileSync(join(RUNTIME, ".claude.json"), '{\n  "mcpServers": {}\n}\n', "utf8");

copyFileSync(join(KORIJEN, "runtime", "settings.klijent.json"), join(RUNTIME, "settings.json"));

const tokenFajl = join(TELEGRAM_DIR, ".env");
writeFileSync(tokenFajl, `TELEGRAM_BOT_TOKEN=${botToken}\n`, "utf8");

// allowlist umjesto pairing rezima: stranac ne dobija ni pairing kod.
const access = {
  dmPolicy: "allowlist",
  allowFrom: korisnici,
  groups: {
    [String(idGrupe)]: {
      requireMention: false,
      allowFrom: korisnici,
    },
  },
  pending: {},
};
const accessFajl = join(TELEGRAM_DIR, "access.json");
writeFileSync(accessFajl, `${JSON.stringify(access, null, 2)}\n`, "utf8");

// chmod na Windowsu ne znaci nista i tiho prolazi; na macOS/Linux stiti token.
try {
  chmodSync(tokenFajl, 0o600);
  chmodSync(accessFajl, 0o600);
} catch {
  // Windows
}

console.log(`Runtime pripremljen: ${RUNTIME}`);
console.log("");

// Telegram plugin ide odmah u runtime: bez njega bot ne prima poruke, a jutarnji izvjestaji
// svejedno stizu (njih salje cron mimo sesije), pa se kvar previdi. Neuspjeh ne rusi pripremu;
// preflight (provjeri-klon.mjs) ostaje kapija.
const plugin = instalirajTelegramPlugin(RUNTIME);
console.log("");

let korak = 0;
const stavka = (tekst) => console.log(`  ${++korak}. ${tekst}`);
console.log("Sljedeci koraci:");
stavka("U .env ovog klona postavi OLX_TOKEN, OLX_MCP_PROFILE=klijent i OLX_MAX_SPEND_PER_DAY.");
stavka("U BotFatheru za ovog bota: /setprivacy -> Disable (inace bot ne vidi poruke u grupi).");
if (!plugin.ok) {
  stavka("Instaliraj Telegram plugin rucno (komande iznad), pa provjeri: node scripts/provjeri-klon.mjs");
}
if (process.platform === "win32") {
  stavka("Ako sesija ide na pretplatu (OLX_KLIJENT_AI nije deepseek), jednom po klonu u PowerShellu:");
  console.log('     $env:CLAUDE_CONFIG_DIR=".claude-runtime" pa claude login (kredencijali zive u config diru).');
  console.log("     Sa OLX_KLIJENT_AI=deepseek login ne treba: auth ide kroz OLX_DEEPSEEK_AUTH_TOKEN iz .env.");
  stavka("Instaliraj poslove: powershell -ExecutionPolicy Bypass -File deploy\\windows\\instaliraj-zadatke.ps1");
  stavka("Rucni test sesije (u istom terminalu): node scripts/pokreni-klijenta.mjs");
} else {
  stavka("Instaliraj poslove: scripts/instaliraj-cron.sh");
  stavka("Rucni test sesije: node scripts/pokreni-klijenta.mjs ili node scripts/cuvar-sesije.mjs");
}
