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
//   3. Restart na neaktivnost (klijent 1h, admin-bot 30min): "ociscen kontekst po zavrsetku
//      posla" bez ikakve logike u samoj sesiji. Restart je jeftin, placa se samo ponovno
//      kesiranje prefiksa na prvoj sljedecoj poruci.
//   4. Strazar rezim (opciono, OLX_SESIJA_STRAZAR): idle prag i nocni termin sesiju GASE
//      umjesto da je restartuju, jer restart memoriju nikad ne vrati a sesija je ~95% otiska
//      klona. Cuvar tada sam strazari nad bot tokenom i digne sesiju na prvu poruku. Bez
//      prekidaca je svaki put ispod nepromijenjen.
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
// Strazar rezim ima dva stanja umjesto jednog: SESIJA_ZIVA i STRAZA. Granica izmedju njih je
// tvrda i nosi cijeli dizajn: Telegram dopusta samo JEDNOG getUpdates konzumera po tokenu, pa
// straza radi iskljucivo dok je sesija mrtva. Straza nikad ne potvrdjuje offset, dakle poruku
// vidi a ne pojede; kad sesija ustane, plugin povuce istu poruku ponovo i obradi je svojim
// normalnim putem (allowlist, inbox, kanal). Nista se ne gubi ni kad budjenje padne, jer poruka
// do obrade ostaje nepotvrdjena na Telegramu. Detalji i ostale granice su u scripts/lib/straza.mjs.
//
// Start cuvara (boot masine, ponovno pokretanje posla) i u strazar rezimu dize sesiju kao i
// prije: pokvaren setup (login, plugin, bun) se tako otkrije odmah kroz mehaniku brzih padova,
// a ne tek na prvu klijentovu poruku. U strazu se ulazi samo kroz idle prag i nocni termin.
//
// Podesavanja kroz .env (sve opciono):
//   OLX_SESIJA_RESTART_SAT   sat nocnog restarta, default 3
//   OLX_SESIJA_IDLE_SATI     sati mirovanja prije restarta, default 1 (klijent) / 0.5 (admin-bot)
//   OLX_SESIJA_INBOX_DANA    starost inbox fajlova koji se brisu, default 7
//   OLX_SESIJA_STRAZAR       strazar rezim: prazno (default) iskljuceno, 1/true/da oba tipa,
//                            admin samo admin bot, klijent samo klijentska sesija

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
import {
  POLL_TIMEOUT_S,
  posaljiTyping,
  procitajBotToken,
  strazarUkljucen,
  strazi,
} from "./lib/straza.mjs";

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
const IDLE_SATI = broj(process.env.OLX_SESIJA_IDLE_SATI, JE_ADMIN ? 0.5 : 1);
const INBOX_DANA = broj(process.env.OLX_SESIJA_INBOX_DANA, 7);
// Prekidac je po tipu sesije, ne samo po klonu, jer se rezim uvodi postepeno: prvo admin bot
// (koristi se najrjedje a nosi punu drugu sesiju), pa klijentska sesija istog klona, pa flota.
const STRAZAR = strazarUkljucen(process.env, JE_ADMIN);
// Pauza prije prvog poll-a. Plugin poller (bun) umire na EOF stdina i forsira izlaz za 2s, a
// njegov watchdog za sirocad radi na 5s. Ko krene ranije, dobije 409 jer token nije slobodan.
const STRAZA_GRACE_MS = 5_000;
// Typing na Telegramu traje oko 5s, a hladni start sesije je duzi, pa se ponavlja. Krov je tvrd:
// bolje da indikator stane nego da cuvar kuca u prazno bez granice ako budjenje zapne.
const TIPING_INTERVAL_MS = 4_000;
const TIPING_MAX = 8;
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
  // Neprepoznata vrijednost prekidaca ne obara cuvara, ali se ne smije ni presuti u tisini:
  // vlasnik bi mislio da rezim radi, a klon bi trosio memoriju kao i prije.
  if (STRAZAR.upozorenje) console.error(STRAZAR.upozorenje);
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
let strazaTrazena = false;
let strazaOtkazi = null;
let tipingTajmer = null;
let strazaBezTokenaJavljeno = false;

// Jedan izvor istine za "cuvar je u strazi": postoji kontroler kojim se straza prekida. Vrijedi
// i tokom grace pauze prije prvog poll-a, jer se kontroler pravi prije nje.
function uStrazi() {
  return strazaOtkazi !== null;
}

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

    // Straza ide PRIJE grane restarta: idle prag i nocni termin u strazar rezimu sesiju gase, a
    // ne dizu, pa ovdje nema onog `pokreni` za 3s. Bez prekidaca je zastavica uvijek dole.
    if (strazaTrazena) {
      strazaTrazena = false;
      void uStrazu();
      return;
    }

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
  if (!dijete || dijete.exitCode !== null || restartTrazen || strazaTrazena) return;
  log(`Restart sesije: ${razlog}.`);
  restartTrazen = true;
  ugasiDijete();
}

// Blizanac zatraziRestart za strazar rezim: sesija se gasi i NE dize ponovo, umjesto nje ostaje
// straza. Razdvojeno namjerno, da put bez prekidaca ostane nepromijenjen.
function zatraziGasenje(razlog) {
  if (!dijete || dijete.exitCode !== null || restartTrazen || strazaTrazena) return;
  log(`Gasim sesiju i ulazim u strazu: ${razlog}.`);
  strazaTrazena = true;
  ugasiDijete();
}

// Klijent ne smije gledati u tisinu dok sesija ustaje. Sve je best effort: greske se gutaju u
// samom alatu, tajmer je unref pa ne drzi proces, i nista od ovoga ne smije zadrzati budjenje.
function pokreniTiping(token, chatId) {
  zaustaviTiping();
  if (!chatId) return;
  let poslano = 1;
  void posaljiTyping({ token, chatId });
  tipingTajmer = setInterval(() => {
    if (gasenje || poslano >= TIPING_MAX) {
      zaustaviTiping();
      return;
    }
    poslano += 1;
    void posaljiTyping({ token, chatId });
  }, TIPING_INTERVAL_MS);
  tipingTajmer.unref();
}

function zaustaviTiping() {
  if (!tipingTajmer) return;
  clearInterval(tipingTajmer);
  tipingTajmer = null;
}

/**
 * Straza: sesija je mrtva, cuvar sam ceka poruku na bot tokenu i na prvu digne sesiju.
 *
 * Token se cita ISKLJUCIVO iz runtime-a ovog tipa sesije, jer je to isti fajl iz kojeg ga cita
 * Telegram plugin. `.env` klona nije alternativa: tamo stoji klijentski bot, pa bi admin cuvar
 * strazario nad klijentskim botom, krao klijentu poruke i pravio 409 protiv zive sesije.
 *
 * Kad tokena nema, rezim se tiho odustaje i sesija se digne po danasnjem putu: bot koji trosi
 * memoriju je losiji od bota, ali bot koji je gluh nije bot.
 */
async function uStrazu() {
  const token = procitajBotToken(TELEGRAM_DIR);
  if (!token) {
    log(`Straza nije moguca: nema TELEGRAM_BOT_TOKEN u ${join(TELEGRAM_DIR, ".env")}. Dizem sesiju kao i bez strazar rezima.`);
    if (!strazaBezTokenaJavljeno) {
      strazaBezTokenaJavljeno = true;
      await javiAdministratoru(
        `Cuvar (${TIP}) u ${KORIJEN} ne moze u strazu: nema bot tokena u ${TELEGRAM_DIR}. Sesija radi stalno, strazar rezim je bez efekta.`,
      );
    }
    pokreni();
    return;
  }
  strazaBezTokenaJavljeno = false;

  strazaOtkazi = new AbortController();
  const otkazi = strazaOtkazi;
  log(`Straza: sesija ugasena, cekam poruku (long poll ${POLL_TIMEOUT_S}s, offset se ne potvrdjuje).`);
  await new Promise((r) => setTimeout(r, STRAZA_GRACE_MS));

  let nalaz = { prekinuto: true };
  if (!otkazi.signal.aborted) {
    nalaz = await strazi({
      token,
      signal: otkazi.signal,
      log,
      alarm: (tekst) => javiAdministratoru(`Cuvar (${TIP}) u ${KORIJEN}: ${tekst}`),
    });
  }
  strazaOtkazi = null;
  if (nalaz.prekinuto) return;

  log(`Straza: update ${nalaz.updateId} vidjen, dizem sesiju. Poruku obradjuje plugin, ne cuvar.`);
  pokreniTiping(token, nalaz.chatId);
  pokreni();
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
  if (gasenje) return;

  const sad = new Date();
  const danas = lokalniDatum(sad);

  // U strazi nema sesije, pa nema ni health checka ni mjerenja mirovanja. Ostaju dvije duznosti:
  // vanjski zahtjev za restart se samo pokupi (sesija svjez `.env` cita pri budjenju), a nocno
  // ciscenje inboxa i logova mora raditi i bez sesije, inace tiho stane onih noci koje klon
  // prespava u strazi, pa inbox i cron logovi rastu bez granice.
  if (uStrazi()) {
    if (existsSync(RESTART_ZAHTJEV)) {
      try {
        unlinkSync(RESTART_ZAHTJEV);
      } catch {
        // ostaje do sljedece runde; u strazi nema sesije koju bi zahtjev mogao vrtjeti u krug
      }
      log("Zahtjev za restart pokupljen u strazi: nema sta restartovati, svjez .env se cita pri budjenju.");
    }
    if (sad.getHours() === RESTART_SAT && zadnjiNocni !== danas) {
      zadnjiNocni = danas;
      ocistiInbox();
      skratiLogove();
      log("Nocno ciscenje odradjeno u strazi, sesija se ne dize.");
    }
    return;
  }

  if (!dijete || dijete.exitCode !== null || restartTrazen || strazaTrazena) return;

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

  // Nocni restart: jednom dnevno u zadati sat, ali tek kad sesija miruje. U strazar rezimu je to
  // nocno gasenje: sesija ustaje tek na prvu sljedecu poruku, a cron poslovi (jutarnja poruka u
  // 07:20 kroz src/core/telegram.ts) ne idu kroz sesiju pa ih ovo ne dira.
  if (sad.getHours() === RESTART_SAT && zadnjiNocni !== danas) {
    if (mirnoMin >= MIRNO_PRIJE_RESTARTA_MIN) {
      zadnjiNocni = danas;
      ocistiInbox();
      skratiLogove();
      if (STRAZAR.ukljucen) zatraziGasenje("nocno ciscenje konteksta");
      else zatraziRestart("nocno ciscenje konteksta");
    }
    return;
  }

  // Idle prag. Bez strazar rezima mora stajati uslov "bilo je aktivnosti POSLIJE starta", inace
  // bi se prazna sesija restartovala u krug bez ikakvog razloga. U strazar rezimu se mirovanje
  // mjeri od zadnje aktivnosti ILI od starta, sta je novije: prazna sesija se tada smije ugasiti
  // jer je straza pokriva, cime se zatvara rupa u kojoj je sesija bez ijedne poruke zivjela do
  // nocnog termina. Mjeri se od starta a ne odmah, da mehanika brzih padova stigne otkriti
  // pokvaren setup prije nego klon ostane samo na strazi.
  if (IDLE_SATI > 0) {
    if (STRAZAR.ukljucen) {
      const mirnoOdStarta = (Date.now() - Math.max(aktivnost, startTs)) / 60_000;
      if (mirnoOdStarta >= IDLE_SATI * 60) zatraziGasenje(`${IDLE_SATI}h bez aktivnosti, gasim sesiju`);
    } else if (aktivnost > startTs && mirnoMin >= IDLE_SATI * 60) {
      zatraziRestart(`${IDLE_SATI}h bez aktivnosti, ciscenje konteksta`);
    }
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
    // Straza se prekida prije izlaza, da zahtjev u toku ne ostane visiti i da se long poll ne
    // ponovi u procesu koji vise nije nadzornik.
    if (strazaOtkazi) strazaOtkazi.abort();
    zaustaviTiping();
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

log(
  STRAZAR.ukljucen
    ? `Cuvar sesije, strazar rezim: nocni termin u ${RESTART_SAT}h i ${IDLE_SATI}h mirovanja GASE sesiju, cuvar tada strazari i budi je na prvu poruku. Inbox se cisti poslije ${INBOX_DANA} dana.`
    : `Cuvar sesije: nocni restart u ${RESTART_SAT}h, idle restart poslije ${IDLE_SATI}h, inbox se cisti poslije ${INBOX_DANA} dana.`,
);
pokreni();
