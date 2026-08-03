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
// deploy/windows/instaliraj-zadatke.ps1). Zajednicka logika pokretanja (provjere, AI mapiranje,
// argv, spawn) zivi u scripts/lib/sesija.mjs i dijeli se sa rucnim launcherom
// scripts/pokreni-klijenta.mjs, pa se pokretaci ne mogu raziici.
//
// Restart nikad ne pada usred posla: i nocni i idle restart cekaju da sesija miruje. Aktivnost
// se cita sa diska (transkripti sesije i Telegram inbox), ne iz procesa.
//
// Podesavanja kroz .env (sve opciono):
//   OLX_SESIJA_RESTART_SAT   sat nocnog restarta, default 3
//   OLX_SESIJA_IDLE_SATI     sati mirovanja prije restarta, default 2 (klijent) / 1 (admin-bot)
//   OLX_SESIJA_INBOX_DANA    starost inbox fajlova koji se brisu, default 7

import { spawn, spawnSync } from "node:child_process";
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
import {
  aiPogon,
  claudeArgv,
  okruzenjeSesije,
  pokreniClaude,
  provjeriPreduslove,
  sastaviPrompt,
  stazeSesije,
} from "./lib/sesija.mjs";

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

const STAZE = stazeSesije(TIP, KORIJEN);
const RUNTIME = STAZE.runtime;
const TELEGRAM_DIR = STAZE.telegramDir;
const INBOX = STAZE.inbox;
const PID_FAJL = join(KORIJEN, ".olx-pik", JE_ADMIN ? "cuvar-admin-bota.pid" : "cuvar-sesije.pid");
const MCP_PROFIL = STAZE.mcpProfil;

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
// Logika u scripts/lib/sesija.mjs; ovdje samo ispis i izlaz, isti kao prije premjestanja.

{
  const preduslovi = provjeriPreduslove(TIP, KORIJEN, process.env);
  if (preduslovi.greske.length > 0) {
    for (const g of preduslovi.greske) console.error(g);
    process.exit(1);
  }
  for (const u of preduslovi.upozorenja) console.error(u);
}

// ---- zastita od dvostrukog pokretanja ----
// Dva cuvara istog tipa znace dvije sesije na istom botu i dupli odgovori. Upis je atomican
// (flag wx, isti obrazac kao u src/core/plan-fajl.ts): dva cuvara pokrenuta u istoj sekundi
// ne mogu oba proci. Odbijen start se javlja adminu, prigusen na jednom u 6 sati, jer
// launchd/Scheduler vrte novi pokusaj svakih 30s pa bi alarm bez prigusenja bio spam.

const ODBIJEN_ALARM_FAJL = join(KORIJEN, ".olx-pik", `cuvar-${TIP}-odbijen.alarm`);

async function odbijStart(razlog) {
  console.error(razlog);
  let zadnji = 0;
  try {
    zadnji = statSync(ODBIJEN_ALARM_FAJL).mtimeMs;
  } catch {
    // alarma jos nije bilo
  }
  if (Date.now() - zadnji > 6 * 60 * 60 * 1000) {
    try {
      writeFileSync(ODBIJEN_ALARM_FAJL, `${new Date().toISOString()}\n`, "utf8");
    } catch {
      // bez markera ce alarm ici cesce, bolje i to nego nikako
    }
    await javiAdministratoru(`Cuvar (${TIP}) u ${KORIJEN} odbija start: ${razlog}`);
  }
  process.exit(1);
}

mkdirSync(dirname(PID_FAJL), { recursive: true });

async function zauzmiPidFajl() {
  for (let pokusaj = 0; pokusaj < 2; pokusaj++) {
    try {
      writeFileSync(PID_FAJL, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
      return;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    let stariPid = 0;
    try {
      stariPid = Number(readFileSync(PID_FAJL, "utf8").trim());
    } catch {
      // fajl nestao izmedju pokusaja, sljedeca runda petlje ga pokusava upisati
      continue;
    }
    let ziv = false;
    if (Number.isFinite(stariPid) && stariPid > 0) {
      try {
        process.kill(stariPid, 0);
        ziv = true;
      } catch {
        // proces ne postoji, pid fajl je ostatak od pada ili recikliran pid
      }
    }
    if (ziv) {
      await odbijStart(`vec radi cuvar pid ${stariPid}. Ako to NIJE cuvar (recikliran pid), obrisi ${PID_FAJL}.`);
    }
    try {
      unlinkSync(PID_FAJL);
    } catch {
      // vec obrisan
    }
  }
  await odbijStart(`ne mogu zauzeti ${PID_FAJL} ni iz drugog pokusaja.`);
}

await zauzmiPidFajl();

// ---- ciscenje sirocadi ----
// Kad cuvar umre nasilno (Task Scheduler "End task", kill -9), sesija ostane ziva bez
// nadzora. Novi cuvar bi pokrenuo drugu sesiju na istom bot tokenu: dupli odgovori i 409
// sukob na Telegramu. Zato cuvar pamti pid sesije u fajlu i pri startu ugasi ostatak.
// Prije gasenja provjerava IME procesa: recikliran pid ne smije ubiti nevin tudji proces.

const SESIJA_PID_FAJL = join(KORIJEN, ".olx-pik", JE_ADMIN ? "sesija-admin-bota.pid" : "sesija-klijent.pid");
// Marker kojim vanjski proces (npr. onboarding puller) trazi restart sesije. Prolazan je i ne
// ide u backup; obrise se odmah po obradi.
const RESTART_ZAHTJEV = join(KORIJEN, ".olx-pik", JE_ADMIN ? "restart-admin-bota" : "restart-sesije");

function imeProcesa(pid) {
  try {
    const r =
      process.platform === "win32"
        ? spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).ProcessName`], {
            encoding: "utf8",
            timeout: 10_000,
          })
        : spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 10_000 });
    return (r.stdout ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function ocistiSiroce() {
  let pid = 0;
  try {
    pid = Number(readFileSync(SESIJA_PID_FAJL, "utf8").trim());
  } catch {
    return; // nema zapisa, nema sirocadi
  }
  try {
    unlinkSync(SESIJA_PID_FAJL);
  } catch {
    // nebitno
  }
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch {
    return; // proces vise ne postoji
  }
  const ime = imeProcesa(pid);
  if (!/claude|node|cmd/.test(ime)) {
    log(`Stari zapis sesije pokazuje na pid ${pid} (${ime || "nepoznat"}), nije nasa sesija, ne diram.`);
    return;
  }
  log(`Gasim siroce prethodne sesije (pid ${pid}, ${ime}).`);
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15_000 });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // vec mrtav
    }
  }
}

ocistiSiroce();

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

// Cron logovi rastu bez granice (launchd i Scheduler samo apenduju; petlja padova zna
// napisati megabajte za noc). Nocni ciklus ih skrati na zadnjih ~1 MB: dovoljno za svaku
// dijagnostiku, a fajl nikad ne postane problem. Radi i dok launchd drzi otvoren fd, jer
// je fd u append modu pa nastavlja pisati na novi kraj.
const LOG_MAX_BAJTA = 1_000_000;

function skratiLogove() {
  const dir = join(KORIJEN, ".olx-pik");
  let stavke;
  try {
    stavke = readdirSync(dir);
  } catch {
    return;
  }
  for (const ime of stavke) {
    if (!ime.startsWith("cron-") || !ime.endsWith(".log")) continue;
    const putanja = join(dir, ime);
    try {
      const st = statSync(putanja);
      if (st.size <= LOG_MAX_BAJTA) continue;
      const sadrzaj = readFileSync(putanja, "utf8");
      const rep = sadrzaj.slice(-LOG_MAX_BAJTA);
      const odReda = rep.indexOf("\n") + 1; // ne pocinji od presjecenog reda
      writeFileSync(putanja, `[skraceno na zadnjih ~1MB]\n${rep.slice(odReda)}`, "utf8");
      log(`Log ${ime} skracen sa ${Math.round(st.size / 1024)} KB.`);
    } catch {
      // log koji se ne da skratiti nije razlog za pad cuvara
    }
  }
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

// Jedna ljudska poruka u grupu klijenta kad bot stane: tisina je najgori odgovor za uslugu
// koja se placa. Salje se najvise jednom po incidentu (flag se resetuje kad sesija prozivi).
async function porukaKlijentu(tekst) {
  if (JE_ADMIN) return; // admin bot je vlasnikov kanal, njemu ide javiAdministratoru
  try {
    const modul = await import(pathToFileURL(join(KORIJEN, "dist", "core", "telegram.js")).href);
    await modul.posaljiPoruku(tekst);
  } catch (e) {
    console.error(`Poruka klijentu nije poslana (${String(e instanceof Error ? e.message : e)})`);
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
let zdravljeAlarmirano = false;
let klijentObavijesten = false;

// Gasenje djeteta koje stvarno gasi. Na Windowsu dijete je cmd.exe shim, pa bi kill() ubio
// samo njega a claude bi preziveo kao siroce na istom bot tokenu (dvije sesije, dupli
// odgovori); zato taskkill ubija cijelo stablo. Na macOS/Linux SIGTERM, pa SIGKILL poslije
// 30s ako ga sesija ignorise (zaglavljen alat, mrtva mreza): bez eskalacije bi restartTrazen
// ostao dignut zauvijek i cuvar bi postao mrtav nadzornik.
function ugasiDijete() {
  if (!dijete || dijete.exitCode !== null) return;
  const d = dijete;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(d.pid), "/T", "/F"], { stdio: "ignore", shell: false });
    } catch (e) {
      console.error(`taskkill nije uspio: ${String(e)}`);
    }
  } else {
    d.kill();
    setTimeout(() => {
      if (d.exitCode === null) {
        log("Sesija ignorise SIGTERM 30s, saljem SIGKILL.");
        try {
          d.kill("SIGKILL");
        } catch {
          // vec mrtva
        }
      }
    }, 30_000).unref();
  }
  setTimeout(() => {
    if (d.exitCode === null) {
      void javiAdministratoru(
        `Sesija (${TIP}) u ${KORIJEN} se ne da ugasiti ni na SIGKILL (pid ${d.pid}). Treba rucna intervencija.`,
      );
    }
  }, 120_000).unref();
}

function pokreni() {
  // AI pogon (lib): ne dira process.env, sve ide samo u okruzenje djeteta, da cuvar ni
  // slucajno ne preusmjeri neki drugi proces.
  const ai = aiPogon(JE_ADMIN, process.env);
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

  dijete = pokreniClaude({
    argv: claudeArgv(sastaviPrompt(TIP, KORIJEN, log)),
    env: okruzenjeSesije({
      osnova: process.env,
      aiEnv: ai.env,
      obrisi: ai.obrisi,
      runtime: RUNTIME,
      telegramDir: TELEGRAM_DIR,
      mcpProfil: MCP_PROFIL,
    }),
    cwd: KORIJEN,
  });
  startTs = Date.now();
  zdravljeAlarmirano = false;
  try {
    writeFileSync(SESIJA_PID_FAJL, `${dijete.pid ?? ""}\n`, "utf8");
  } catch {
    // bez zapisa nema ciscenja sirocadi poslije nasilnog gasenja cuvara, ali sesija radi
  }
  log(`Sesija pokrenuta (pid ${dijete.pid ?? "?"}, pogon ${ai.pogon}, profil ${MCP_PROFIL}).`);

  dijete.on("error", (e) => {
    console.error(`Sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`);
  });

  dijete.on("exit", async (code, signal) => {
    try {
      unlinkSync(SESIJA_PID_FAJL);
    } catch {
      // vec obrisan
    }
    if (gasenje) process.exit(0);

    if (restartTrazen) {
      restartTrazen = false;
      setTimeout(pokreni, 3000);
      return;
    }

    const trajanje = Date.now() - startTs;
    log(`Sesija pala (code ${code}, signal ${signal ?? "-"}) poslije ${Math.round(trajanje / 1000)}s.`);
    if (trajanje < BRZI_PAD_MS) {
      brzihPadova += 1;
    } else {
      brzihPadova = 0;
      klijentObavijesten = false; // sesija je prozivjela, sljedeci incident je novi incident
    }

    if (brzihPadova >= MAX_BRZIH_PADOVA) {
      brzihPadova = 0;
      await javiAdministratoru(
        `Sesija (${TIP}) u ${KORIJEN} pada odmah po pokretanju (${MAX_BRZIH_PADOVA}x zaredom). Pauza 10 minuta, pa novi pokusaj. Pogledaj .olx-pik/cron-${JE_ADMIN ? "admin-bot" : "sesija"}.log.`,
      );
      if (!klijentObavijesten) {
        klijentObavijesten = true;
        await porukaKlijentu(
          "Asistent trenutno nije dostupan zbog tehnickog problema. Radimo na tome. Ako nesto hitno treba, javite se direktno.",
        );
      }
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
  ugasiDijete();
}

function lokalniDatum(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Prag za "poruka stigla, sesija ne odgovara": inbox dobije fajl (klijent poslao sliku),
// a transkript se ne pomjeri. To hvata zivu-ali-gluhu sesiju (plugin prestao pollovati,
// model visi), koju provjera "proces ziv" ne vidi. Pokriva samo poruke koje ostave fajl u
// inboxu; tekstualne poruke fajl ne ostavljaju, pa je ovo donja granica nadzora, ne potpun.
const ZDRAVLJE_PRAG_MIN = 10;

setInterval(() => {
  if (!dijete || dijete.exitCode !== null || restartTrazen || gasenje) return;

  const sad = new Date();
  const inboxTs = najnovijiMtime(INBOX);
  const transkriptTs = najnovijiMtime(join(RUNTIME, "projects"));
  const aktivnost = Math.max(inboxTs, transkriptTs);
  const mirnoMin = aktivnost > 0 ? (Date.now() - aktivnost) / 60_000 : Infinity;

  // Health check bota, prije svega ostalog.
  if (inboxTs > startTs && inboxTs - transkriptTs > ZDRAVLJE_PRAG_MIN * 60_000) {
    if (!zdravljeAlarmirano) {
      zdravljeAlarmirano = true;
      void javiAdministratoru(
        `Sesija (${TIP}) u ${KORIJEN} izgleda gluha: poruka u inboxu prije ${Math.round((Date.now() - inboxTs) / 60_000)} min, transkript se ne mice. Restartujem je.`,
      );
    }
    zatraziRestart("poruka stigla a sesija ne odgovara");
    return;
  }

  // Zahtjev za restart izvana: fajl, ne signal. Signal bi bio uredniji, ali cuvar radi i na
  // Windowsu gdje Node ne dostavlja SIGHUP, a pogon.md trazi da isti fajl radi na obje platforme.
  //
  // Zasto uopste: `.env` se cita JEDNOM, pri startu procesa (ovaj fajl, red 57, i MCP server).
  // Kad onboarding upise nov OLX_TOKEN u zivi klon, sesija koja vec radi ga ne vidi, pa bi bot
  // radio bez tokena do nocnog restarta. Puller zato ostavi ovaj fajl.
  if (existsSync(RESTART_ZAHTJEV)) {
    let razlog = "vanjski zahtjev";
    try {
      razlog = readFileSync(RESTART_ZAHTJEV, "utf8").trim() || razlog;
    } catch {
      // fajl je nestao ili je necitljiv: restart se ipak radi, razlog ostaje opsti
    }
    try {
      unlinkSync(RESTART_ZAHTJEV);
    } catch {
      // ako se ne moze obrisati, ne vrtimo restart u krug: zahtjev se ignorise dalje
    }
    zatraziRestart(razlog);
    return;
  }

  // Nocni restart: jednom dnevno u zadati sat, ali tek kad sesija miruje.
  const danas = lokalniDatum(sad);
  if (sad.getHours() === RESTART_SAT && zadnjiNocni !== danas) {
    if (mirnoMin >= MIRNO_PRIJE_RESTARTA_MIN) {
      zadnjiNocni = danas;
      ocistiInbox();
      skratiLogove();
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
    if (dijete && dijete.exitCode === null) ugasiDijete();
    else process.exit(0);
    // Ako se dijete ne ugasi za 10s, izlazimo svakako; launchd/Scheduler ce pocistiti.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

process.on("exit", () => {
  try {
    // Brise se samo VLASTITI pid fajl: da izlazak odbijenog starta nikad ne obrise fajl
    // cuvara koji stvarno radi.
    if (Number(readFileSync(PID_FAJL, "utf8").trim()) === process.pid) unlinkSync(PID_FAJL);
  } catch {
    // vec obrisan
  }
});

log(`Cuvar sesije: nocni restart u ${RESTART_SAT}h, idle restart poslije ${IDLE_SATI}h, inbox se cisti poslije ${INBOX_DANA} dana.`);
pokreni();
