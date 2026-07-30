#!/usr/bin/env node
// Preflight provjera klijentskog klona: sta je usteklo, sta fali i TACNA komanda za popravku.
//
// Pokrece se PRIJE bilo kakvog rada sa klijentom na klonu (onboarding korak, pocetak rada u
// terminalu, dijagnostika). Ne zove OLX, ne trosi nista; cita fajlove i stanje masine.
// Radi na macOS i Windows (zato Node, vidi .claude/rules/pogon.md).
//
// Izlaz: checklista OK / FALI / PAZNJA sa komandom uz svaku stavku koja fali.
// Exit kod: 0 kad nista ne FALI (PAZNJA ne obara), 1 inace.
//
// Pokretanje: node scripts/provjeri-klon.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);
try {
  process.loadEnvFile(".env");
} catch {
  // .env se provjerava kao stavka nize
}

const IME = basename(KORIJEN);
const WIN = process.platform === "win32";
const stavke = [];

function ok(naziv, detalj = "") {
  stavke.push({ status: "OK", naziv, detalj, komanda: "" });
}
function fali(naziv, detalj, komanda) {
  stavke.push({ status: "FALI", naziv, detalj, komanda });
}
function paznja(naziv, detalj, komanda = "") {
  stavke.push({ status: "PAZNJA", naziv, detalj, komanda });
}

function komandaPostoji(ime) {
  try {
    execFileSync(WIN ? "where" : "which", [ime], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// 1. Node verzija: ispod 20.12 se .env TIHO preskace (loadEnvFile ne postoji), pa bi
//    OLX_KLIJENT_AI nestao i klijent bi tiho presao na vlasnikovu pretplatu.
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 20 || (major === 20 && minor >= 12)) ok("Node verzija", process.versions.node);
  else fali("Node verzija", `${process.versions.node} je ispod 20.12, .env se tiho preskace`, "instaliraj Node 22 LTS");
}

// 2. claude u PATH-u
if (komandaPostoji("claude")) ok("claude u PATH-u");
else fali("claude u PATH-u", "sesija se ne moze pokrenuti", "instaliraj Claude Code pa ponovo otvori terminal");

// 3. .env i kljucne varijable
if (!existsSync(".env")) {
  fali(".env", "nema konfiguracije klona", `${WIN ? "copy" : "cp"} .env.example .env  # pa popuni OLX_TOKEN i TELEGRAM_*`);
} else {
  ok(".env postoji");
  if (process.env.OLX_TOKEN || (process.env.OLX_USERNAME && process.env.OLX_PASSWORD)) ok("OLX pristup (token ili kredencijali)");
  else fali("OLX pristup", "ni OLX_TOKEN ni OLX_USERNAME/OLX_PASSWORD nisu postavljeni", "upisi OLX_TOKEN u .env");

  const profil = (process.env.OLX_MCP_PROFILE ?? "").trim().toLowerCase();
  if (profil === "klijent") ok("OLX_MCP_PROFILE=klijent");
  else paznja("OLX_MCP_PROFILE", `"${profil || "(prazno)"}" pada na admin: klijent bi vidio i admin alate`, "postavi OLX_MCP_PROFILE=klijent u .env");

  for (const v of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_CHAT_ID"]) {
    if (process.env[v]) ok(v);
    else fali(v, "bez ovoga izvjestaji i alarmi tiho ne idu (posao bi sada pao sa greskom)", `upisi ${v} u .env`);
  }

  if ((process.env.OLX_KLIJENT_AI ?? "pretplata").trim().toLowerCase() === "deepseek") {
    if (process.env.OLX_DEEPSEEK_BASE_URL && process.env.OLX_DEEPSEEK_AUTH_TOKEN) ok("DeepSeek pogon konfigurisan");
    else fali("DeepSeek pogon", "OLX_KLIJENT_AI=deepseek a OLX_DEEPSEEK_* nije popunjen: cuvar odbija start", "popuni OLX_DEEPSEEK_BASE_URL i OLX_DEEPSEEK_AUTH_TOKEN u .env");
  }

  // Kanal je eksperimentalna funkcija Claude Code-a i registruje se samo ako smije provjeriti
  // sta je dostupno. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC tu provjeru gasi, pa poruke sa
  // Telegrama tiho ne dodju u sesiju: nema greske, bot samo ne odgovara. Izmjereno 30.07.2026.
  // (olx-dokumentacija/deepseek-nalazi.md). U .env je fatalno, jer loadEnvFile to daje sesiji.
  {
    const IME = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
    let uEnvFajlu = false;
    try {
      uEnvFajlu = readFileSync(".env", "utf8")
        .split("\n")
        .some((red) => red.trim().startsWith(`${IME}=`) && !red.trim().startsWith("#"));
    } catch {
      // .env je vec provjeren iznad
    }
    if (uEnvFajlu) {
      fali(IME, "postavljen u .env: Telegram kanal se nece registrovati i bot nece odgovarati", `izbrisi red ${IME} iz .env`);
    } else if (process.env[IME]) {
      paznja(IME, "postavljen u okruzenju: gdje god se sesija tako pokrene, Telegram kanal tiho ne radi", `izbrisi ${IME} iz ~/.claude/deepseek.env i shell profila`);
    } else {
      ok("Kanal nije ugasen varijablom okruzenja");
    }
  }

  if (!Number(process.env.OLX_MAX_SPEND_PER_DAY)) {
    paznja("OLX_MAX_SPEND_PER_DAY", "0 znaci BEZ dnevnog plafona kredita", "postavi plafon u .env prije prvog klijenta");
  } else ok("Dnevni plafon kredita", process.env.OLX_MAX_SPEND_PER_DAY);
}

// 4. KLIJENT.md u KORIJENU (ne u klijenti/)
if (existsSync("KLIJENT.md")) ok("KLIJENT.md u korijenu");
else fali("KLIJENT.md", "pogon (AI runda, skillovi) ne zna ko je klijent", `${WIN ? "copy" : "cp"} KLIJENT.primjer.md KLIJENT.md  # pa popuni`);

// 5. Build postoji i nije stariji od src/
{
  const cli = join("dist", "cli", "index.js");
  if (!existsSync(cli)) {
    fali("Build (dist/)", "nema kompajliranog koda", "npm ci && npm run build");
  } else {
    let najnovijiSrc = 0;
    const obidji = (dir) => {
      for (const s of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, s.name);
        if (s.isDirectory()) obidji(p);
        else najnovijiSrc = Math.max(najnovijiSrc, statSync(p).mtimeMs);
      }
    };
    try {
      obidji("src");
    } catch {
      // bez src/ (npr. arhivski klon) poredjenje nema smisla
    }
    if (najnovijiSrc > statSync(cli).mtimeMs) fali("Build svjezina", "src/ je noviji od dist/, pogon vozi stari kod", "npm run build");
    else ok("Build svjez");
  }
}

// 6. Telegram runtime (klijentska sesija)
{
  const rt = ".claude-runtime";
  const tg = join(rt, "channels", "telegram");
  if (!existsSync(rt)) {
    fali("Telegram runtime", "sesija se ne moze pokrenuti bez .claude-runtime", "node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>");
  } else if (!existsSync(join(tg, ".env")) || !existsSync(join(tg, "access.json"))) {
    fali("Telegram runtime", ".claude-runtime postoji ali fali telegram .env ili access.json", "ponovi pripremu runtime-a");
  } else {
    ok("Telegram runtime pripremljen");
  }
}

// 7. Zakazani poslovi
{
  if (WIN) {
    let izlaz = "";
    try {
      izlaz = execFileSync("schtasks", ["/query", "/fo", "csv"], { encoding: "utf8", stdio: "pipe" });
    } catch {
      // schtasks nedostupan
    }
    if (izlaz.toLowerCase().includes("olx")) ok("Zakazani poslovi (Task Scheduler)");
    else fali("Zakazani poslovi", "nista nije registrovano: nema snapshota, jutarnje poruke ni cuvara", "powershell -ExecutionPolicy Bypass -File deploy/windows/instaliraj-zadatke.ps1");
  } else {
    let izlaz = "";
    try {
      izlaz = execFileSync("launchctl", ["list"], { encoding: "utf8", stdio: "pipe" });
    } catch {
      // launchctl nedostupan (linux?)
    }
    const nasi = izlaz.split("\n").filter((r) => r.includes(`ba.codefactory.olx.${IME}.`));
    if (nasi.length >= 4) ok("Zakazani poslovi (launchd)", `${nasi.length} poslova`);
    else if (nasi.length > 0) paznja("Zakazani poslovi", `samo ${nasi.length} od ocekivana 4+ (snapshot, dnevno, sedmicno, sesija)`, "scripts/instaliraj-cron.sh");
    else fali("Zakazani poslovi", "nista nije instalirano: nema snapshota, jutarnje poruke ni cuvara", "scripts/instaliraj-cron.sh");
  }
}

// 8. Cuvar sesije radi
{
  const pidFajl = join(".olx-pik", "cuvar-sesije.pid");
  let radi = false;
  try {
    const pid = Number(readFileSync(pidFajl, "utf8").trim());
    process.kill(pid, 0);
    radi = true;
  } catch {
    // nema fajla ili proces mrtav
  }
  if (radi) ok("Cuvar sesije radi");
  else paznja("Cuvar sesije", "ne radi (normalno ako poslovi jos nisu instalirani ili je masina svjeze podignuta)", "instalira ga korak zakazanih poslova; rucno: node scripts/cuvar-sesije.mjs");
}

// 9. Snapshot svjezina (temelj mjerenja pregleda)
{
  const dir = join(".olx-pik", "snapshots");
  let zadnji = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("views-")) zadnji = Math.max(zadnji, statSync(join(dir, f)).mtimeMs);
    }
  } catch {
    // jos nema snapshota
  }
  if (!zadnji) paznja("Dnevni snapshot", "jos nijedan: mjerenje pregleda i izdvajanja ne moze poceti", "node dist/cli/index.js stats snapshot");
  else if (Date.now() - zadnji > 48 * 60 * 60 * 1000) paznja("Dnevni snapshot", `zadnji je stariji od 48h (${new Date(zadnji).toISOString().slice(0, 10)})`, "provjeri posao snapshot; rucno: node dist/cli/index.js stats snapshot");
  else ok("Dnevni snapshot svjez");
}

// ---- ispis ----
const sirina = Math.max(...stavke.map((s) => s.naziv.length));
let brojFali = 0;
for (const s of stavke) {
  if (s.status === "FALI") brojFali += 1;
  const oznaka = s.status === "OK" ? "  OK  " : s.status === "FALI" ? " FALI " : "PAZNJA";
  console.log(`[${oznaka}] ${s.naziv.padEnd(sirina)}  ${s.detalj}`);
  if (s.komanda) console.log(`${" ".repeat(9 + sirina)}  -> ${s.komanda}`);
}
console.log("");
if (brojFali > 0) {
  console.log(`Klon "${IME}" NIJE spreman za klijenta: ${brojFali} stavki fali (redoslijed popravki odozgo).`);
  process.exit(1);
}
console.log(`Klon "${IME}" je spreman.` + (stavke.some((s) => s.status === "PAZNJA") ? " Ima stavki za paznju, vidi iznad." : ""));
