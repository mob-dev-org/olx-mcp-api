#!/usr/bin/env node
// Cuvar stalne Claude sesije. Jedan kod, dva tipa sesije:
//
//   node scripts/cuvar-sesije.mjs             klijentska sesija (default)
//   node scripts/cuvar-sesije.mjs admin-bot   vlasnikova admin sesija
//
// Za oba tipa radi isto troje:
//
//   1. KeepAlive: kad sesija padne, digne je ponovo. Pet brzih padova zaredom javlja
//      administratoru na Telegram i pravi pauzu, da pokvaren setup ne vrti petlju u prazno.
//   2. Nocni restart (podrazumijevano 03h): kontekst razgovora krece od nule svaki dan, pa
//      trosak po poruci ne raste. Tom prilikom se iz Telegram inboxa brisu fajlovi stariji
//      od 7 dana, jer ih sesija poslije restarta vise ne koristi.
//   3. Restart na neaktivnost (klijent 2h, admin-bot 1h): "ociscen kontekst po zavrsetku
//      posla" bez ikakve logike u samoj sesiji. Restart je jeftin, placa se samo ponovno
//      kesiranje prefiksa na prvoj sljedecoj poruci.
//
// Razlike po tipu: runtime dir (.claude-runtime / .claude-runtime-admin), sistemski prompt
// (SISTEM-klijent.md / SISTEM-admin-bot.md), MCP profil (klijent / admin), PID fajl i AI pogon:
//
//   - klijent: pogon bira OLX_KLIJENT_AI iz .env. "pretplata" (default) ne dira nista;
//     "deepseek" mapira OLX_DEEPSEEK_* u ANTHROPIC_* varijable SAMO za taj proces, a bez
//     popunjenih varijabli sesija se NE pokrece (granica: klijent ne smije tiho na pretplatu
//     kad je odluceno drugacije).
//   - admin-bot: uvijek pretplata; ANTHROPIC_* varijable se brisu iz okruzenja djeteta da ga
//     nista ne moze preusmjeriti na tudji API.
//
// Pisan u Node-u umjesto basha namjerno: isti fajl radi na macOS-u (launchd poslovi `sesija`
// i `admin-bot`, vidi scripts/instaliraj-cron.sh) i na Windowsu (Task Scheduler, vidi
// deploy/windows/instaliraj-zadatke.ps1). Zato ne poziva scripts/pokreni-klijenta.sh nego
// ponavlja njegove provjere i argumente; kad se mijenja jedno, mijenja se i drugo.
//
// Restart nikad ne pada usred posla: i nocni i idle restart cekaju da sesija miruje. Aktivnost
// se cita sa diska (transkripti sesije i Telegram inbox), ne iz procesa.
//
// Podesavanja kroz .env (sve opciono):
//   OLX_SESIJA_RESTART_SAT   sat nocnog restarta, default 3
//   OLX_SESIJA_IDLE_SATI     sati mirovanja prije restarta, default 2 (klijent) / 1 (admin-bot)
//   OLX_SESIJA_INBOX_DANA    starost inbox fajlova koji se brisu, default 7

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);
try {
  process.loadEnvFile(".env");
} catch {
  // postojanje .env se provjerava nize, sa jasnom porukom
}

// ---- tip sesije ----

const TIP = process.argv[2] ?? "klijent";
if (TIP !== "klijent" && TIP !== "admin-bot") {
  console.error(`Nepoznat tip sesije "${TIP}". Upotreba: node scripts/cuvar-sesije.mjs [klijent|admin-bot]`);
  process.exit(1);
}
const JE_ADMIN = TIP === "admin-bot";

const RUNTIME = join(KORIJEN, JE_ADMIN ? ".claude-runtime-admin" : ".claude-runtime");
const TELEGRAM_DIR = join(RUNTIME, "channels", "telegram");
const INBOX = join(TELEGRAM_DIR, "inbox");
const PID_FAJL = join(KORIJEN, ".olx-pik", JE_ADMIN ? "cuvar-admin-bota.pid" : "cuvar-sesije.pid");
const PROMPT_FAJL = JE_ADMIN ? "runtime/SISTEM-admin-bot.md" : "runtime/SISTEM-klijent.md";
const MCP_PROFIL = JE_ADMIN ? "admin" : "klijent";

const RESTART_SAT = broj(process.env.OLX_SESIJA_RESTART_SAT, 3);
const IDLE_SATI = broj(process.env.OLX_SESIJA_IDLE_SATI, JE_ADMIN ? 1 : 2);
const INBOX_DANA = broj(process.env.OLX_SESIJA_INBOX_DANA, 7);
// Nocni restart ceka da sesija miruje bar ovoliko, da ne presijece posao u toku.
const MIRNO_PRIJE_RESTARTA_MIN = 15;
const BRZI_PAD_MS = 60_000;
const MAX_BRZIH_PADOVA = 5;
const PAUZA_POSLIJE_PADOVA_MS = 10 * 60_000;
const PAUZA_BEZ_AI_KLJUCA_MS = 10 * 60_000;

function broj(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function log(poruka) {
  console.log(`${new Date().toISOString()} [${TIP}] ${poruka}`);
}

// ---- provjere prije starta ----

if (!existsSync(RUNTIME)) {
  console.error(
    JE_ADMIN
      ? `Nema ${RUNTIME}. Pokreni prvo: node scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]`
      : `Nema ${RUNTIME}. Pokreni prvo: scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id>`,
  );
  process.exit(1);
}
if (!existsSync(join(KORIJEN, ".env"))) {
  console.error(`Nema .env u ${KORIJEN}. Kopiraj .env.example i postavi OLX_TOKEN.`);
  process.exit(1);
}
if (!JE_ADMIN && (process.env.OLX_MCP_PROFILE ?? "").trim().toLowerCase() !== "klijent") {
  console.error("Upozorenje: OLX_MCP_PROFILE nije klijent u .env. Klijent ce vidjeti i admin alate.");
}

// ---- AI pogon sesije ----
// Vraca { ok, env, obrisi, pogon, poruka }. Ne dira process.env: sve ide samo u okruzenje
// djeteta, da cuvar ni slucajno ne preusmjeri neki drugi proces.

const ANTHROPIC_VARIJABLE = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
];

function aiPogon() {
  if (JE_ADMIN) {
    // Admin bot je vlasnikov kanal i ide iskljucivo na pretplatu. Sve ANTHROPIC_* se brise
    // da naslijedjen export sa masine ne moze tiho preusmjeriti sesiju.
    return { ok: true, env: {}, obrisi: ANTHROPIC_VARIJABLE, pogon: "pretplata" };
  }
  const izbor = (process.env.OLX_KLIJENT_AI ?? "pretplata").trim().toLowerCase();
  if (izbor !== "deepseek") {
    // Danasnje ponasanje, nista se ne dira. Faza testiranja prvih klijenata ide na pretplati.
    return { ok: true, env: {}, obrisi: [], pogon: "pretplata" };
  }
  const baseUrl = process.env.OLX_DEEPSEEK_BASE_URL;
  const token = process.env.OLX_DEEPSEEK_AUTH_TOKEN;
  if (!baseUrl || !token) {
    return {
      ok: false,
      pogon: "deepseek",
      poruka: "OLX_KLIJENT_AI=deepseek, a OLX_DEEPSEEK_BASE_URL ili OLX_DEEPSEEK_AUTH_TOKEN nije popunjen u .env.",
    };
  }
  const env = { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: token };
  if (process.env.OLX_DEEPSEEK_MODEL) env.ANTHROPIC_MODEL = process.env.OLX_DEEPSEEK_MODEL;
  if (process.env.OLX_DEEPSEEK_HAIKU_MODEL) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = process.env.OLX_DEEPSEEK_HAIKU_MODEL;
  if (process.env.OLX_DEEPSEEK_TIMEOUT_MS) env.API_TIMEOUT_MS = process.env.OLX_DEEPSEEK_TIMEOUT_MS;
  // API odbija zahtjev kad su AUTH_TOKEN i API_KEY postavljeni istovremeno.
  return { ok: true, env, obrisi: ["ANTHROPIC_API_KEY"], pogon: "deepseek" };
}

// ---- zastita od dvostrukog pokretanja ----
// Dva cuvara istog tipa znace dvije sesije na istom botu i dupli odgovori.

mkdirSync(dirname(PID_FAJL), { recursive: true });
if (existsSync(PID_FAJL)) {
  const stariPid = Number(readFileSync(PID_FAJL, "utf8").trim());
  if (Number.isFinite(stariPid) && stariPid > 0) {
    try {
      process.kill(stariPid, 0);
      console.error(`Cuvar (${TIP}) vec radi (pid ${stariPid}). Izlazim.`);
      process.exit(1);
    } catch {
      // proces ne postoji, pid fajl je ostatak od pada
    }
  }
}
writeFileSync(PID_FAJL, `${process.pid}\n`, "utf8");

// ---- aktivnost sesije ----
// Najsvjeziji mtime u transkriptima sesije i Telegram inboxu. Transkript se upisuje na svaki
// potez, pa je pouzdan signal i za poruke koje ne ostavljaju fajl u inboxu.

function najnovijiMtime(dir, dubina = 3) {
  let max = 0;
  if (dubina < 0 || !existsSync(dir)) return max;
  let stavke;
  try {
    stavke = readdirSync(dir, { withFileTypes: true });
  } catch {
    return max;
  }
  for (const s of stavke) {
    const putanja = join(dir, s.name);
    try {
      if (s.isDirectory()) {
        max = Math.max(max, najnovijiMtime(putanja, dubina - 1));
      } else {
        max = Math.max(max, statSync(putanja).mtimeMs);
      }
    } catch {
      // fajl nestao izmedju listanja i citanja
    }
  }
  return max;
}

function zadnjaAktivnost() {
  return Math.max(najnovijiMtime(join(RUNTIME, "projects")), najnovijiMtime(INBOX));
}

function ocistiInbox() {
  if (!existsSync(INBOX)) return;
  const prag = Date.now() - INBOX_DANA * 24 * 60 * 60 * 1000;
  let obrisano = 0;
  for (const ime of readdirSync(INBOX)) {
    const putanja = join(INBOX, ime);
    try {
      const st = statSync(putanja);
      if (st.isFile() && st.mtimeMs < prag) {
        unlinkSync(putanja);
        obrisano += 1;
      }
    } catch {
      // preskoci ono sto se ne da procitati ili obrisati
    }
  }
  if (obrisano > 0) log(`Inbox ociscen: ${obrisano} fajlova starijih od ${INBOX_DANA} dana.`);
}

async function javiAdministratoru(tekst) {
  try {
    const modul = await import(pathToFileURL(join(KORIJEN, "dist", "core", "telegram.js")).href);
    await modul.javiAdminu(tekst);
  } catch (e) {
    console.error(`Admin poruka nije poslana (${String(e instanceof Error ? e.message : e)}): ${tekst}`);
  }
}

// ---- zivotni ciklus sesije ----

let dijete = null;
let startTs = 0;
let restartTrazen = false;
let gasenje = false;
let brzihPadova = 0;
let zadnjiNocni = "";
let javljenoBezKljuca = false;

function pokreni() {
  const ai = aiPogon();
  if (!ai.ok) {
    log(`Sesija NIJE pokrenuta: ${ai.poruka} Novi pokusaj za 10 minuta.`);
    if (!javljenoBezKljuca) {
      javljenoBezKljuca = true;
      void javiAdministratoru(`Klijentska sesija u ${KORIJEN} nije pokrenuta: ${ai.poruka}`);
    }
    setTimeout(pokreni, PAUZA_BEZ_AI_KLJUCA_MS);
    return;
  }
  javljenoBezKljuca = false;

  const okruzenje = {
    ...process.env,
    ...ai.env,
    CLAUDE_CONFIG_DIR: RUNTIME,
    TELEGRAM_STATE_DIR: TELEGRAM_DIR,
    OLX_MCP_PROFILE: MCP_PROFIL,
  };
  for (const kljuc of ai.obrisi) delete okruzenje[kljuc];

  const argv = [
    "--channels", "plugin:telegram@claude-plugins-official",
    "--append-system-prompt-file", PROMPT_FAJL,
    "--setting-sources", "user,project",
  ];
  dijete = spawn("claude", argv, {
    cwd: KORIJEN,
    env: okruzenje,
    stdio: "inherit",
    // Na Windowsu je claude .cmd shim, a njega Node bez shella odbija pokrenuti.
    shell: process.platform === "win32",
  });
  startTs = Date.now();
  log(`Sesija pokrenuta (pid ${dijete.pid ?? "?"}, pogon ${ai.pogon}, profil ${MCP_PROFIL}).`);

  dijete.on("error", (e) => {
    console.error(`Sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`);
  });

  dijete.on("exit", async (code, signal) => {
    if (gasenje) process.exit(0);

    if (restartTrazen) {
      restartTrazen = false;
      setTimeout(pokreni, 3000);
      return;
    }

    const trajanje = Date.now() - startTs;
    log(`Sesija pala (code ${code}, signal ${signal ?? "-"}) poslije ${Math.round(trajanje / 1000)}s.`);
    brzihPadova = trajanje < BRZI_PAD_MS ? brzihPadova + 1 : 0;

    if (brzihPadova >= MAX_BRZIH_PADOVA) {
      brzihPadova = 0;
      await javiAdministratoru(
        `Sesija (${TIP}) u ${KORIJEN} pada odmah po pokretanju (${MAX_BRZIH_PADOVA}x zaredom). Pauza 10 minuta, pa novi pokusaj. Pogledaj .olx-pik/cron-${JE_ADMIN ? "admin-bot" : "sesija"}.log.`,
      );
      setTimeout(pokreni, PAUZA_POSLIJE_PADOVA_MS);
      return;
    }
    setTimeout(pokreni, 5000);
  });
}

function zatraziRestart(razlog) {
  if (!dijete || dijete.exitCode !== null || restartTrazen) return;
  log(`Restart sesije: ${razlog}.`);
  restartTrazen = true;
  dijete.kill();
}

function lokalniDatum(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

setInterval(() => {
  if (!dijete || dijete.exitCode !== null || restartTrazen || gasenje) return;

  const sad = new Date();
  const aktivnost = zadnjaAktivnost();
  const mirnoMin = aktivnost > 0 ? (Date.now() - aktivnost) / 60_000 : Infinity;

  // Nocni restart: jednom dnevno u zadati sat, ali tek kad sesija miruje.
  const danas = lokalniDatum(sad);
  if (sad.getHours() === RESTART_SAT && zadnjiNocni !== danas) {
    if (mirnoMin >= MIRNO_PRIJE_RESTARTA_MIN) {
      zadnjiNocni = danas;
      ocistiInbox();
      zatraziRestart("nocno ciscenje konteksta");
    }
    return;
  }

  // Idle restart: samo ako je bilo aktivnosti POSLIJE zadnjeg starta, inace bi se prazna
  // sesija restartovala u krug bez ikakvog razloga.
  if (IDLE_SATI > 0 && aktivnost > startTs && mirnoMin >= IDLE_SATI * 60) {
    zatraziRestart(`${IDLE_SATI}h bez aktivnosti, ciscenje konteksta`);
  }
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    gasenje = true;
    log(`Primljen ${sig}, gasim sesiju i izlazim.`);
    try {
      unlinkSync(PID_FAJL);
    } catch {
      // vec obrisan
    }
    if (dijete && dijete.exitCode === null) dijete.kill();
    else process.exit(0);
    // Ako se dijete ne ugasi za 10s, izlazimo svakako; launchd/Scheduler ce pocistiti.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

process.on("exit", () => {
  try {
    unlinkSync(PID_FAJL);
  } catch {
    // vec obrisan
  }
});

log(`Cuvar sesije: nocni restart u ${RESTART_SAT}h, idle restart poslije ${IDLE_SATI}h, inbox se cisti poslije ${INBOX_DANA} dana.`);
pokreni();
