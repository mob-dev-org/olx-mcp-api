#!/usr/bin/env bun
// Priprema runtime za ADMIN bot sesiju ovog klona: .claude-runtime-admin/
//
// Admin bot je vlasnikov privatni kanal za ovaj shop (nadzor, odobrenja, vodjenje bez
// terminala). Radi na vlasnikovoj pretplati i koristi ga ISKLJUCIVO vlasnik; klijent za njega
// ne zna. Node umjesto basha namjerno: isti fajl radi na macOS-u i Windowsu.
//
// Dva rezima:
//
//   bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]
//     STARI rezim, DVA bota: admin bot ima svoj token i svoj proces
//     (telegram-most.mjs admin-bot), odvojen od klijentskog bota. Koristi se kad
//     OLX_MOST_ADMIN_TG_ID u .env klona OSTAJE PRAZAN.
//
//   bun scripts/pripremi-admin-runtime.mjs --bez-bota <admin_telegram_id>
//     JEDNOBOTNI rezim: drugog bota nema, JEDAN klijentski bot token vozi oba smjera, a
//     telegram-most.mjs rutira privatne poruke tacno tog ID-a na admin sesiju. Runtime
//     .claude-runtime-admin i dalje treba (nosi CLAUDE_CONFIG_DIR admin sesije,
//     settings.admin-bot.json, sistemski prompt i OLX_MCP_PROFILE=admin), samo NE dobija
//     bot token. Koristi se kad je OLX_MOST_ADMIN_TG_ID u .env klona POPUNJEN.
//
// Bez id_grupe (stari rezim) bot radi samo u direktnim porukama sa administratorom. Sa
// id_grupe radi i u zajednickoj admin grupi, uz requireMention: pise samo kad ga se oznaci ili
// mu se odgovori. U --bez-bota rezimu grupa nije podrzana ni kao argument: taj bot je ISTI bot
// koji je u klijentskoj grupi (privacy Disabled), pa bi u zajednickoj admin grupi (vise botova,
// privacy Enabled ocekivan) primao cijeli promet i sve to gurao u klijentsku sesiju.
//
// VAZNO, suprotno od klijentskog bota: u BotFatheru za admin bota (stari rezim) privacy OSTAJE
// UKLJUCEN (/setprivacy -> Enable, sto je i default). Bot sa ukljucenim privacy u grupi prima
// SAMO poruke u kojima je oznacen i odgovore na svoje poruke, pa poruka jednom botu ne stize
// svim ostalim botovima u grupi i kontekst mu se ne puni tudjim razgovorima.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { instalirajTelegramPlugin } from "./lib/telegram-plugin.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const UPOTREBA = `Upotreba:
  bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]
    Stari rezim, dva bota (admin bot ima svoj token).
    Primjer: bun scripts/pripremi-admin-runtime.mjs 123:AAH... 7061697037 -100987654321

  bun scripts/pripremi-admin-runtime.mjs --bez-bota <admin_telegram_id>
    Jednobotni rezim, drugog bota nema (koristi se uz OLX_MOST_ADMIN_TG_ID u .env klona).
    Primjer: bun scripts/pripremi-admin-runtime.mjs --bez-bota 7061697037`;

const argv = process.argv.slice(2);
const bezBota = argv[0] === "--bez-bota";

function provjeriId(id) {
  if (!/^\d+$/.test(id)) {
    console.error(`Neispravan admin_telegram_id: "${id}".`);
    console.error(
      "Mora biti pozitivan cio broj, bez minusa i bez slova. Negativan broj izgleda kao ID grupe" +
        " (npr. -100987654321); ovdje treba ID covjeka iz privatnog razgovora, koji je uvijek pozitivan.",
    );
    process.exit(1);
  }
}

let botToken;
let adminId;
let idGrupe;

if (bezBota) {
  adminId = argv[1];
  const visak = argv[2];
  if (!adminId) {
    console.error(UPOTREBA);
    process.exit(1);
  }
  provjeriId(adminId);
  if (visak !== undefined) {
    console.error(`Neocekivan dodatni argument: "${visak}".`);
    console.error(
      "U jednobotnom rezimu (--bez-bota) admin grupa nije podrzana: taj bot je isti bot koji je u" +
        " klijentskoj grupi (privacy Disabled), pa bi u zajednickoj admin grupi primao cijeli promet" +
        " i sve to gurao u klijentsku sesiju. Pokreni bez treceg argumenta.",
    );
    process.exit(1);
  }
} else {
  [botToken, adminId, idGrupe] = argv;
  if (!botToken || !adminId) {
    console.error(UPOTREBA);
    process.exit(1);
  }
  provjeriId(adminId);
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
//
// Uz to se gase uvodni ekrani (izbor teme, dijalog povjerenja, pitanje o novom MCP serveru).
// Isti razlog kao u pripremi-runtime.mjs: bot sesija nema koga da pritisne enter, pa bi stala
// na prvom pitanju wizarda i ostala ziva ali gluha, sto mehanika brzih padova ne vidi.
writeFileSync(
  join(RUNTIME, ".claude.json"),
  `${JSON.stringify(
    {
      mcpServers: {},
      hasCompletedOnboarding: true,
      projects: {
        [KORIJEN]: {
          hasTrustDialogAccepted: true,
          hasCompletedProjectOnboarding: true,
          enabledMcpjsonServers: ["olx-pik"],
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

copyFileSync(join(KORIJEN, "runtime", "settings.admin-bot.json"), join(RUNTIME, "settings.json"));

let tokenFajl = null;
if (!bezBota) {
  tokenFajl = join(TELEGRAM_DIR, ".env");
  writeFileSync(tokenFajl, `TELEGRAM_BOT_TOKEN=${botToken}\n`, "utf8");
}
// U --bez-bota rezimu ovaj fajl se NE pise: drugog bota nema, token vozi klijentski runtime.

// Allowlist sa JEDNIM covjekom: administratorom. Stranac ne dobija ni pairing kod.
//
// U --bez-bota rezimu ovaj access.json ne odlucuje o DOLAZNIM porukama (dolazne odlucuje
// klijentski access.json, jer je token klijentski), ali ostaje pisan i dalje: on je izvor za
// ODREDISTA IZVJESTAJA i za "telegram grupe --admin". groups ostaje prazan jer u ovom rezimu
// admin grupa nije podrzana (vidi objasnjenje na vrhu fajla).
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
  if (tokenFajl) chmodSync(tokenFajl, 0o600);
  chmodSync(accessFajl, 0o600);
} catch {
  // Windows
}

console.log(`Admin runtime pripremljen: ${RUNTIME}`);
console.log("");

// Telegram plugin ide odmah u runtime, isto kao u pripremi-runtime.mjs: bez njega bot ne prima
// poruke. Neuspjeh ne rusi pripremu; preflight (provjeri-klon.mjs) ostaje kapija.
const plugin = instalirajTelegramPlugin(RUNTIME);
console.log("");

let korak = 0;
const stavka = (tekst) => console.log(`  ${++korak}. ${tekst}`);
console.log("Sljedeci koraci:");

if (bezBota) {
  stavka(`U .env klona postavi: OLX_MOST_ADMIN_TG_ID=${adminId}`);
  stavka(
    "Vlasnikov ID mora biti i na allowFrom listi klijentskog access.json, inace privatna poruka" +
      " nikad ne prodje pristupnu kontrolu i vlasnik dobija tisinu.",
  );
  const klijentAccessFajl = join(KORIJEN, ".claude-runtime", "channels", "telegram", "access.json");
  if (existsSync(klijentAccessFajl)) {
    try {
      const klijentAccess = JSON.parse(readFileSync(klijentAccessFajl, "utf8"));
      const allowFrom = Array.isArray(klijentAccess.allowFrom) ? klijentAccess.allowFrom : [];
      if (allowFrom.map(String).includes(String(adminId))) {
        console.log(`     Provjereno: ${adminId} JE na allowFrom listi u ${klijentAccessFajl}.`);
      } else {
        console.log(
          `     PROVJERENO I FALI: ${adminId} NIJE na allowFrom listi u ${klijentAccessFajl}.`,
        );
        console.log(
          "     Dodaj ga rucnim upisom u taj fajl (pripremi-runtime.mjs odbija rad na postojecem runtime-u).",
        );
      }
    } catch (greska) {
      console.log(`     Nisam mogao procitati ${klijentAccessFajl}: ${greska.message}`);
    }
  } else {
    console.log(
      `     ${klijentAccessFajl} jos ne postoji. Kad se klijentski runtime napravi, provjeri da` +
        ` je ${adminId} na njegovoj allowFrom listi.`,
    );
  }
  stavka("Posao admin-bot se u ovom rezimu NE instalira (drugog bota nema).");
  if (!plugin.ok) {
    stavka("Instaliraj Telegram plugin rucno (komande iznad), pa provjeri: bun scripts/provjeri-klon.mjs");
  }
  if (process.platform === "win32") {
    stavka("Windows: kredencijali pretplate zive u config diru, pa jednom po klonu u PowerShellu:");
    console.log('     $env:CLAUDE_CONFIG_DIR=".claude-runtime-admin" pa claude login.');
  } else {
    stavka("macOS: login ne treba (pretplata je u Keychainu, zajednicka za sve sesije).");
  }
  stavka("Rucni test (bez admin bota, klijentska uloga vozi oba smjera): bun scripts/telegram-most.mjs --jednom");
} else {
  stavka("BotFather: privacy za ovog bota OSTAJE UKLJUCEN (nista ne diraj; ako je ranije");
  console.log("     gasen, /setprivacy -> Enable). Suprotno od klijentskog bota.");
  if (idGrupe) {
    stavka(`Dodaj bota u admin grupu ${idGrupe}. U grupi ga oznaci ili mu odgovori na poruku.`);
  } else {
    stavka("Bot radi samo u tvom DM-u. Za zajednicku grupu pokreni ponovo sa [id_grupe].");
  }
  if (!plugin.ok) {
    stavka("Instaliraj Telegram plugin rucno (komande iznad), pa provjeri: bun scripts/provjeri-klon.mjs");
  }
  if (process.platform === "win32") {
    stavka("Windows: kredencijali pretplate zive u config diru, pa jednom po klonu u PowerShellu:");
    console.log('     $env:CLAUDE_CONFIG_DIR=".claude-runtime-admin" pa claude login.');
    stavka("Instaliraj poslove: powershell -File deploy\\windows\\instaliraj-zadatke.ps1");
  } else {
    stavka("macOS: login ne treba (pretplata je u Keychainu, zajednicka za sve sesije).");
    stavka("Instaliraj poslove ponovo da se doda pogon admin bota: scripts/instaliraj-cron.sh");
  }
  stavka("Rucni test: bun scripts/telegram-most.mjs admin-bot --jednom");
}
