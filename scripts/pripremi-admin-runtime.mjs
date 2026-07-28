#!/usr/bin/env node
// Priprema runtime za ADMIN bot sesiju ovog klona: .claude-runtime-admin/
//
// Admin bot je vlasnikov privatni kanal za ovaj shop (nadzor, odobrenja, vodjenje bez
// terminala). Radi na vlasnikovoj pretplati i koristi ga ISKLJUCIVO vlasnik; klijent za njega
// ne zna. Node umjesto basha namjerno: isti fajl radi na macOS-u i Windowsu.
//
// Upotreba iz korijena klona:
//   node scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]
//
// Bez id_grupe bot radi samo u direktnim porukama sa administratorom. Sa id_grupe radi i u
// zajednickoj admin grupi, uz requireMention: pise samo kad ga se oznaci ili mu se odgovori.
//
// VAZNO, suprotno od klijentskog bota: u BotFatheru za admin bota privacy OSTAJE UKLJUCEN
// (/setprivacy -> Enable, sto je i default). Bot sa ukljucenim privacy u grupi prima SAMO
// poruke u kojima je oznacen i odgovore na svoje poruke, pa poruka jednom botu ne stize svim
// ostalim botovima u grupi i kontekst mu se ne puni tudjim razgovorima.

import { chmodSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [botToken, adminId, idGrupe] = process.argv.slice(2);
if (!botToken || !adminId) {
  console.error("Upotreba: node scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]");
  console.error("Primjer:  node scripts/pripremi-admin-runtime.mjs 123:AAH... 7061697037 -100987654321");
  process.exit(1);
}

const RUNTIME = join(KORIJEN, ".claude-runtime-admin");
const TELEGRAM_DIR = join(RUNTIME, "channels", "telegram");

if (existsSync(RUNTIME)) {
  console.error(`Vec postoji ${RUNTIME}.`);
  console.error("Obrisi ga rucno ako hoces ispocetka; skripta ne prepisuje postojeci runtime.");
  process.exit(1);
}

mkdirSync(join(TELEGRAM_DIR, "inbox"), { recursive: true });
mkdirSync(join(TELEGRAM_DIR, "approved"), { recursive: true });

// Prazan .claude.json: nijedan globalni MCP server. Servere donosi projektni .mcp.json.
writeFileSync(join(RUNTIME, ".claude.json"), '{\n  "mcpServers": {}\n}\n', "utf8");

copyFileSync(join(KORIJEN, "runtime", "settings.admin-bot.json"), join(RUNTIME, "settings.json"));

const tokenFajl = join(TELEGRAM_DIR, ".env");
writeFileSync(tokenFajl, `TELEGRAM_BOT_TOKEN=${botToken}\n`, "utf8");

// Allowlist sa JEDNIM covjekom: administratorom. Stranac ne dobija ni pairing kod.
const access = {
  dmPolicy: "allowlist",
  allowFrom: [String(adminId)],
  groups: {},
  pending: {},
};
if (idGrupe) {
  access.groups[String(idGrupe)] = {
    // requireMention true: u zajednickoj admin grupi sa vise botova svaki reaguje samo kad
    // mu se obrati. Privacy u BotFatheru (ukljucen) to filtrira vec na Telegram strani.
    requireMention: true,
    allowFrom: [String(adminId)],
  };
}
const accessFajl = join(TELEGRAM_DIR, "access.json");
writeFileSync(accessFajl, `${JSON.stringify(access, null, 2)}\n`, "utf8");

// chmod na Windowsu ne znaci nista i tiho prolazi; na macOS/Linux stiti token.
try {
  chmodSync(tokenFajl, 0o600);
  chmodSync(accessFajl, 0o600);
} catch {
  // Windows
}

console.log(`Admin runtime pripremljen: ${RUNTIME}`);
console.log("");
console.log("Sljedeci koraci:");
console.log("  1. BotFather: privacy za ovog bota OSTAJE UKLJUCEN (nista ne diraj; ako je ranije");
console.log("     gasen, /setprivacy -> Enable). Suprotno od klijentskog bota.");
if (idGrupe) {
  console.log(`  2. Dodaj bota u admin grupu ${idGrupe}. U grupi ga oznaci ili mu odgovori na poruku.`);
} else {
  console.log("  2. Bot radi samo u tvom DM-u. Za zajednicku grupu pokreni ponovo sa [id_grupe].");
}
if (process.platform === "win32") {
  console.log("  3. Windows: kredencijali pretplate zive u config diru, pa jednom po klonu:");
  console.log("     set CLAUDE_CONFIG_DIR=.claude-runtime-admin i pokreni claude login.");
  console.log("  4. Instaliraj poslove: powershell -File deploy\\windows\\instaliraj-zadatke.ps1");
} else {
  console.log("  3. macOS: login ne treba (pretplata je u Keychainu, zajednicka za sve sesije).");
  console.log("  4. Instaliraj poslove ponovo da se doda cuvar admin bota: scripts/instaliraj-cron.sh");
}
console.log("  5. Rucni test: node scripts/cuvar-sesije.mjs admin-bot");
