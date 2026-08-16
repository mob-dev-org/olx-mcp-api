#!/usr/bin/env bun
// Telegram most: bot koji NE zavisi od zive interaktivne Claude Code sesije.
//
// Zasto postoji. Kanal (`--channels`) radi samo u interaktivnoj sesiji, a interaktivna sesija
// trazi terminal; pod launchd terminala nema. Uz to je kanal eksperimentalna funkcija koju
// jedna varijabla okruzenja tiho ugasi (izmjereno, olx-dokumentacija/deepseek-nalazi.md).
//
//   Telegram getUpdates -> red na disku -> ziva `claude -p` sesija (stdin) -> sendMessage
//
// Sesija je JEDAN dugozivi proces u stream-json rezimu. Izmjereno je da takva sesija prima
// poruke kroz stdin kad god ih posaljemo, odgovara, i pamti kontekst izmedju poruka, sve bez
// terminala. Time nema troska pokretanja po poruci i kes prefiksa ostaje topao.
//
// Nijedna poruka se ne gubi, i to nosi red na disku, ne transport:
//   1. Telegram offset se pomjera SAMO nakon sto je poruka zapisana u red (fsync kroz rename).
//   2. Stavka se brise iz reda SAMO nakon sto je odgovor poslan na Telegram.
//   Ako proces padne izmedju, poruka je i dalje u redu i obradi se ponovo. Isporuka je dakle
//   najmanje jednom, sto je za ovaj posao ispravan izbor: dupli odgovor je neugodan, propusten
//   je izgubljen klijent.
//
// Jedan kod, dvije uloge (isti obrazac kao cuvar-sesije.mjs):
//
//   bun scripts/telegram-most.mjs             klijentski bot (default)
//   bun scripts/telegram-most.mjs admin-bot   vlasnikov admin bot
//
// Pokretanje:
//   bun scripts/telegram-most.mjs                 # klijent, pogon
//   bun scripts/telegram-most.mjs admin-bot       # admin bot, pogon
//   bun scripts/telegram-most.mjs --jednom        # klijent, obradi sto ceka pa izadji (za probu)
//   bun scripts/telegram-most.mjs admin-bot --jednom
//
// Pogon (DeepSeek ili pretplata) bira se okruzenjem: ovaj proces samo prenosi svoje okruzenje.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ucitajEnvGlobalno, procitajEnv } from "./lib/envfajl.mjs";
import { stazeSesije, provjeriPreduslove, aiPogon, sastaviPrompt, okruzenjeSesije } from "./lib/sesija.mjs";
import {
  dozvoljena,
  izvorSlike,
  tekstStavke,
  argviSesije,
  idleRokMs,
  trebaLiUgasiti,
  lokalniDatum,
  trebaLiNocniRez,
  trebaLiUzorkovati,
  ulogaMosta,
} from "./lib/most.mjs";
import {
  citajProcese,
  ocistiStareResurse,
  pidoviStabla,
  pomakKlona,
  putanjaResursa,
  redUzorka,
  upisiRed,
  uzorakMasine,
  zbirStabla,
} from "./lib/resursi.mjs";
import { odluciAlarmMasine, provjeriPritisakMasine } from "./lib/pritisak-masine.mjs";
import { cpuStabla } from "./lib/cpu.mjs";

// ---- konfiguracija ----

if (existsSync(".env")) ucitajEnvGlobalno(".env"); // .env sa neispravnim redom: provjeri-klon.mjs to prijavljuje jasnije

// Argument uloge je prvi pozicioni argument koji NIJE zastavica (isti obrazac kao TIP u
// cuvar-sesije.mjs, ali most argumente cita iz process.argv.slice(2) direktno jer i --jednom
// zivi u istom nizu).
const TIP = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "klijent";
let ULOGA;
try {
  ULOGA = ulogaMosta(TIP);
} catch (e) {
  console.error(`${e.message} Upotreba: bun scripts/telegram-most.mjs [klijent|admin-bot] [--jednom]`);
  process.exit(1);
}

const JEDNOM = process.argv.includes("--jednom");
const KORIJEN = process.cwd(); // most se ionako pokrece iz korijena klona
const staze = stazeSesije(TIP, KORIJEN);
// RUNTIME vise NE dolazi iz process.env.CLAUDE_CONFIG_DIR: jedan klon, jedan klijent, a
// naslijedjen CLAUDE_CONFIG_DIR sa masine bi mostu mogao podmetnuti tudji (npr. admin) runtime.
const RUNTIME = staze.runtime;
const INBOX = staze.inbox;
const STANJE_FAJL = ULOGA.stanjeFajl;
const ALBUM_CEKANJE_MS = 2500;
const POLL_TIMEOUT_S = 50;
const POTEZ_TIMEOUT_MS = Number(process.env.OLX_MOST_POTEZ_TIMEOUT_MS) || 300000;
const MAX_POKUSAJA = 3;

/**
 * Bot token za ovu ulogu. Klijent: `.env` klona, uz rezervu iz runtime `.env` kad klonski nije
 * popunjen. Admin: ISKLJUCIVO iz runtime `.env` (`.claude-runtime-admin/channels/telegram/.env`),
 * NIKAD iz `.env` klona: tamo stoji KLIJENTSKI bot, pa bi admin most na njemu krao klijentu
 * poruke i pravio 409 Conflict protiv zivog klijentskog mosta (isto obrazlozenje kao u
 * cuvar-sesije.mjs, komentar iznad funkcije uStrazu).
 */
function ucitajToken() {
  if (!ULOGA.jeAdmin) {
    return process.env.TELEGRAM_BOT_TOKEN || procitajEnv(join(staze.telegramDir, ".env")).TELEGRAM_BOT_TOKEN;
  }
  return procitajEnv(join(staze.telegramDir, ".env")).TELEGRAM_BOT_TOKEN;
}
const TOKEN = ucitajToken();

// RAM po klijentu: ziva sesija drzi cijelo stablo procesa u memoriji i na floti od vise klijenata
// to ne staje. `--resume` vraca kontekst kad stigne sljedeca poruka, pa gasenje nije gubitak.
// `0` iskljucuje gasenje, sesija tada ostaje ziva dok god most zivi.
//
// Admin ima poseban override (OLX_MOST_ADMIN_IDLE_MIN, pada na OLX_MOST_IDLE_MIN, pada na 30):
// cuvar-sesije.mjs je adminu davao kraci idle prag (30 min) nego klijentu, a most vec
// podrazumijeva 30, pa je paritet zadrzan i bez posebne vrijednosti. Override postoji da se admin
// moze podesiti nezavisno od klijenta. `broj()` (definisana nize, hoisted) tretira prazan string
// kao "nije podeseno", isto sto i odsutna varijabla.
const IDLE_MIN = ULOGA.jeAdmin
  ? broj(process.env.OLX_MOST_ADMIN_IDLE_MIN, broj(process.env.OLX_MOST_IDLE_MIN, 30))
  : Number(process.env.OLX_MOST_IDLE_MIN) || 30;

// Kao broj() u cuvar-sesije.mjs, uz JEDNU namjernu razliku: PRAZNA vrijednost ovdje pada na
// default, a kod cuvara ne. Number("") je 0, konacan i nenegativan, pa cuvar sa `OLX_SESIJA_
// RESTART_SAT=` iz .env.example dobije sat 0 (rez u ponoc, a komentar obecava 3h), a sa
// `OLX_SESIJA_INBOX_DANA=` dobije prag 0 dana (svaki nocni ciklus obrise CIJELI inbox). Bun
// ucita .env sam prije prve linije, pa prazan kljuc iz primjera stvarno stigne kao "". Most tu
// gresku ne nasljedjuje: prazno znaci "nije podeseno", isto sto i odsutna varijabla.
function broj(v, fallback) {
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Nocni rez konteksta (vidi tikMinute nize): u koji sat sesija gubi --resume i kontekst krece
// od nule. Isti podrazumijevani sat kao cuvar-sesije.mjs, radi jednostavnosti pamcenja za
// vlasnika koji podesava .env.
const RESTART_SAT = broj(process.env.OLX_MOST_RESTART_SAT, 3);

// Starost inbox fajlova koji se brisu u nocnom rezu: NAMJERNO ista varijabla kao
// cuvar-sesije.mjs (OLX_SESIJA_INBOX_DANA), ne nova. Isti klon, isti inbox, jedan prekidac.
const INBOX_DANA = broj(process.env.OLX_SESIJA_INBOX_DANA, 7);

// Marker kojim vanjski proces (onboarding-puller.mjs, oko reda 155) trazi da sesija preuzme svjez
// .env (npr. nov OLX_TOKEN upisan u zivi klon). Prolazan je, brise se odmah po obradi u tikMinute.
const RESTART_ZAHTJEV = join(KORIJEN, ".olx-pik", ULOGA.restartZahtjev);

if (!TOKEN) {
  console.error(
    ULOGA.jeAdmin
      ? `TELEGRAM_BOT_TOKEN nije postavljen u ${join(staze.telegramDir, ".env")}. Pokreni prvo: ` +
          "bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]"
      : "TELEGRAM_BOT_TOKEN nije postavljen u .env. Most se ne moze pokrenuti.",
  );
  process.exit(2);
}

// Klon sa OLX_KLIJENT_AI=deepseek bez popunjenih OLX_DEEPSEEK_* varijabli NE SMIJE tiho preci
// na Anthropic pretplatu i naplacivati na pogresnom mjestu. Za admina aiPogon uvijek vraca
// pretplatu i brise ANTHROPIC_* iz okruzenja djeteta (okruzenjeSesije to vec primjenjuje).
const ai = aiPogon(ULOGA.jeAdmin, process.env);
if (ai.ok === false) {
  console.error(ai.poruka);
  process.exit(2);
}

// ---- telemetrija resursa (best effort, vidi scripts/lib/resursi.mjs) ----
// Ista telemetrija kao cuvar-sesije.mjs, istim JSONL formatom i istim varijablama okruzenja, da
// vlasnik flote i dalje vidi trosak RAM-a po klijentu kad klon predje sa cuvara na most. Dva
// intervala jer aktivna sesija treba gusce uzorkovanje od mirne sesije: RSS mirne sesije je ravan,
// cesce uzorkovanje tamo ne bi nista pokazalo. Prva vrijednost prazna ili 0 gasi telemetriju U
// CJELINI; druga sama za sebe, ako je 0, iskljucuje SAMO uzorkovanje dok sesija ne postoji.
const RESURSI_INTERVAL_MIN = broj(process.env.OLX_RESURSI_INTERVAL_MIN, 5);
const RESURSI_INTERVAL_STRAZA_MIN = broj(process.env.OLX_RESURSI_INTERVAL_STRAZA_MIN, 30);
const RESURSI_UKLJUCENO = RESURSI_INTERVAL_MIN > 0;
const RESURSI_DIR = process.env.OLX_RESURSI_DIR || ".olx-pik/resursi";
const RESURSI_CUVAJ_MJESECI = 12;
// Prag za alarm van reda kad je masina pod pritiskom (vidi scripts/lib/pritisak-masine.mjs).
const PRAG_SLOBODNO_BAJTA = broj(process.env.OLX_RESURSI_PRAG_SLOBODNO_MB, 2048) * 1024 * 1024;
const PRAG_SWAP_OMJER = broj(process.env.OLX_RESURSI_PRAG_SWAP_OMJER, 0.85);
const PRAG_ALARM_MS = broj(process.env.OLX_RESURSI_PRAG_ALARM_SATI, 6) * 60 * 60 * 1000;
const KLON_IME = basename(KORIJEN);
// Determinisan pomak po klonu (hash putanje, NE Math.random): kad vise klonova radi na istoj
// masini, ne krenu svi u istoj sekundi u ps/powershell poziv. Stabilan kroz restarte mosta.
const RESURSI_POMAK_AKTIVNO = pomakKlona(KORIJEN, Math.max(1, RESURSI_INTERVAL_MIN));
const RESURSI_POMAK_STRAZA = pomakKlona(KORIJEN, Math.max(1, RESURSI_INTERVAL_STRAZA_MIN));

// Verzija koda se cita JEDNOM na startu, keširano u konstanti da upisiDogadjaj ostane potpuno
// sinhrona funkcija (bitno za SIGINT/SIGTERM handler, koji ne smije cekati na async). Kad je
// telemetrija iskljucena, import se PRESKACE u potpunosti, da ponasanje ostane bajt za bajt isto
// kao danas.
async function ucitajVerzijuKoda() {
  try {
    const modul = await import(pathToFileURL(join(KORIJEN, "dist", "core", "verzija.js")).href);
    return modul.VERZIJA ?? null;
  } catch {
    return null;
  }
}
const VERZIJA_KODA = RESURSI_UKLJUCENO ? await ucitajVerzijuKoda() : null;

// CPU bazna linija (kumulativno CPU vrijeme po pidu) izmedju tikova, u memoriji mosta (restart
// mosta prirodno resetuje bazu). `uzorakUToku` sprjecava preklapanje uzoraka. `zadnjaUzorkovanaMinuta`
// sprjecava dupli uzorak u istoj minuti kad se tikMinute i eksplicitni poziv poklope.
let zadnjaUzorkovanaMinuta = -1;
let uzorakUToku = false;
let cpuStanjeKlona = null;

const log = (sta) => console.log(`${new Date().toISOString()} ${sta}`);

// ---- stanje i red, oboje na disku ----
// Jedan fajl: offset, ID sesije i red stavki. Upis je atomican (tmp + rename), pa pad u
// sredini upisa ne moze ostaviti pokvaren fajl.

function citajStanje() {
  try {
    const s = JSON.parse(readFileSync(STANJE_FAJL, "utf8"));
    return { offset: s.offset ?? 0, sesija: s.sesija ?? null, red: Array.isArray(s.red) ? s.red : [] };
  } catch {
    return { offset: 0, sesija: null, red: [] };
  }
}

let stanje = citajStanje();

function sacuvaj() {
  mkdirSync(dirname(STANJE_FAJL), { recursive: true });
  const tmp = `${STANJE_FAJL}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(stanje, null, 2)}\n`, "utf8");
  renameSync(tmp, STANJE_FAJL);
}

// ---- PID brava (zastita od dvostrukog pokretanja) ----
// Dva mosta na istom klonu bi znacila dva getUpdates konzumera na istom bot tokenu i 409 Conflict
// na Telegramu. Preslikano iz cuvar-sesije.mjs (odbijStart/zauzmiPidFajl): upis je atomican (flag
// "wx"), pa dva mosta pokrenuta u istoj sekundi ne mogu oba proci. Zauzima se PRIJE prvog dodira
// Telegrama (tg("getMe")), jer brava mora stajati prije ijednog poziva, ne poslije.

const PID_FAJL = join(KORIJEN, ".olx-pik", ULOGA.pidFajl);
const ODBIJEN_ALARM_FAJL = join(KORIJEN, ".olx-pik", ULOGA.odbijenAlarm);

async function javiAdministratoru(tekst) {
  try {
    const modul = await import(pathToFileURL(join(KORIJEN, "dist", "core", "telegram.js")).href);
    await modul.javiAdminu(tekst);
  } catch (e) {
    console.error(`Admin poruka nije poslana (${String(e instanceof Error ? e.message : e)}): ${tekst}`);
  }
}

async function odbijStart(razlog) {
  console.error(razlog);
  let zadnji = 0;
  try {
    zadnji = statSync(ODBIJEN_ALARM_FAJL).mtimeMs;
  } catch {
    // alarma jos nije bilo
  }
  // Prigusenje na jednom u 6 sati: launchd/Scheduler vrte novi pokusaj svakih 30s pa bi alarm
  // bez prigusenja bio spam.
  if (Date.now() - zadnji > 6 * 60 * 60 * 1000) {
    try {
      writeFileSync(ODBIJEN_ALARM_FAJL, `${new Date().toISOString()}\n`, "utf8");
    } catch {
      // bez markera ce alarm ici cesce, bolje i to nego nikako
    }
    await javiAdministratoru(`Most (${TIP}) u ${KORIJEN} odbija start: ${razlog}`);
  }
  process.exit(1);
}

async function zauzmiPidFajl() {
  mkdirSync(dirname(PID_FAJL), { recursive: true });
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
      await odbijStart(`vec radi most pid ${stariPid}. Ako to NIJE most (recikliran pid), obrisi ${PID_FAJL}.`);
    }
    try {
      unlinkSync(PID_FAJL);
    } catch {
      // vec obrisan
    }
  }
  await odbijStart(`ne mogu zauzeti ${PID_FAJL} ni iz drugog pokusaja.`);
}

process.on("exit", () => {
  try {
    // Brise se samo VLASTITI pid fajl: da izlazak odbijenog starta nikad ne obrise fajl mosta
    // koji stvarno radi.
    if (Number(readFileSync(PID_FAJL, "utf8").trim()) === process.pid) unlinkSync(PID_FAJL);
  } catch {
    // vec obrisan
  }
});

// ---- kontrola pristupa ----
// Jedan izvor istine sa kanalom: cita se access.json koji pripremi skripte vec pisu, pa se
// allowlist ne drzi na dva mjesta. Bez tog fajla most ne prima nista.
//
// `requireMention` za admin grupu je vrijednost UNUTAR ovog fajla (pripremi-admin-runtime.mjs ga
// pise kao true): odatle dolazi razlika izmedju klijentskog i admin bota u grupi, nema grane po
// ULOGA u ovom kodu.

function citajPristup() {
  try {
    const a = JSON.parse(readFileSync(join(RUNTIME, "channels", "telegram", "access.json"), "utf8"));
    return {
      dmPolicy: a.dmPolicy ?? "allowlist",
      allowFrom: (a.allowFrom ?? []).map(String),
      groups: a.groups ?? {},
    };
  } catch {
    return null;
  }
}

// ---- Telegram ----

async function tg(metoda, tijelo) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metoda}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tijelo ?? {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metoda}: ${j.description ?? res.status}`);
  return j.result;
}

/** Skine fotografiju u inbox koji klijentska sesija smije citati. Vraca putanju ili null. */
async function skiniFoto(poruka) {
  const izvor = izvorSlike(poruka);
  if (!izvor) return null;
  // getFile ne radi preko 20 MB, to je limit Bot API-ja. Bez ove provjere poziv padne bez
  // objasnjenja, a covjek ne zna zasto mu slika nije stigla.
  if (izvor.velicina && izvor.velicina > 20 * 1024 * 1024) {
    log(`fotografija preskocena: ${Math.round(izvor.velicina / 1048576)} MB je preko limita Telegrama (20 MB)`);
    return null;
  }
  try {
    const info = await tg("getFile", { file_id: izvor.fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    if (!res.ok) throw new Error(`preuzimanje fajla: ${res.status}`);
    const ext = (info.file_path.match(/\.[a-z0-9]+$/i) ?? [".jpg"])[0].toLowerCase();
    mkdirSync(INBOX, { recursive: true });
    const putanja = resolve(INBOX, `${Date.now()}-${izvor.kljuc}${ext}`);
    writeFileSync(putanja, Buffer.from(await res.arrayBuffer()));
    return putanja;
  } catch (e) {
    log(`fotografija nije skinuta: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---- ziva sesija ----

let sesija = null; // { dijete, cekaci: [], buf }
let idleTajmer = null;
let zadnjaAktivnost = Date.now();

// ---- telemetrija resursa: pomocne funkcije ----
// upisiDogadjaj je NAMJERNO potpuno sinhrona (appendFileSync unutar upisiRed): sigurno je pozvati
// je bilo gdje, ukljucujuci SIGINT/SIGTERM handler tik prije process.exit, bez brige da upis nece
// stici. Kad je RESURSI_UKLJUCENO false, vraca se odmah bez ikakvog I/O.
function upisiDogadjaj(polja) {
  if (!RESURSI_UKLJUCENO) return;
  try {
    const red = redUzorka({
      ts: new Date().toISOString(),
      klon: KLON_IME,
      tip: ULOGA.telemetrijaTip,
      verzijaKoda: VERZIJA_KODA,
      sesijaZiva: !!sesija,
      // Most nema pravu strazu (poll ide stalno, ne samo dok sesija spava), ali ovo polje znaci
      // "klon je u mirnom stanju, sesija ne postoji", pa vrijemeUStrazi u lib/resursi.mjs racuna
      // isto kao za cuvara.
      uStrazi: sesija === null,
      cuvarRssBajta: process.memoryUsage().rss,
      ...polja,
    });
    upisiRed(putanjaResursa(process.env), red);
  } catch {
    // telemetrija nikad ne smije srusiti mosta
  }
}

// Async dio: sabira RSS stabla procesa (ako je dat pidZaStablo) i stanje masine, pa upise red
// preko upisiDogadjaj. `uzorakUToku` sprjecava preklapanje ako prethodni uzorak jos traje. Uvijek
// razrijesi svoj Promise (i kad je telemetrija iskljucena ili je uzorak vec u toku), da pozivalac
// (npr. ugasiUzSnimak) moze sigurno vezati .finally() na nju.
async function uzmiUzorak(extraPolja, pidZaStablo) {
  if (!RESURSI_UKLJUCENO || uzorakUToku) return;
  uzorakUToku = true;
  try {
    const [procesi, masina] = await Promise.all([
      pidZaStablo ? citajProcese() : Promise.resolve(null),
      uzorakMasine(),
    ]);
    const stablo = procesi ? zbirStabla(procesi, pidZaStablo) : null;
    const pidovi = procesi ? pidoviStabla(procesi, pidZaStablo) : null;

    let cpuKlonaPct = null;
    if (pidovi) {
      const cpuRezultat = await cpuStabla(pidovi, {
        prethodnoStanje: cpuStanjeKlona,
        sadaMs: Date.now(),
      });
      cpuStanjeKlona = cpuRezultat.stanjeZaSutra;
      cpuKlonaPct = cpuRezultat.pct;
    }
    if (masina) {
      const pritisak = provjeriPritisakMasine(masina, {
        pragSlobodnoBajta: PRAG_SLOBODNO_BAJTA,
        pragSwapOmjer: PRAG_SWAP_OMJER,
      });
      const odluka = odluciAlarmMasine({
        pritisak,
        sada: Date.now(),
        korijenKlona: KORIJEN,
        env: process.env,
        pragMs: PRAG_ALARM_MS,
      });
      if (odluka.posalji) {
        void javiAdministratoru(`Pritisak na masinu (most, ${TIP}) u ${KORIJEN}: ${pritisak.razlog}.`);
      }
    }
    upisiDogadjaj({
      stabloRssBajta: stablo?.ukupnoBajta ?? null,
      stabloBrojProcesa: stablo?.brojProcesa ?? null,
      cpuKlonaPct,
      masina,
      ...extraPolja,
    });
  } catch {
    // best effort
  } finally {
    uzorakUToku = false;
  }
}

// Zajednicka pomocna funkcija za sva tri mjesta gdje most gasi zivu sesiju (idle tajmer, nocni rez
// konteksta, svjez .env): uzme PUN uzorak (RSS stabla + masina) DOK je proces jos ziv, jer je to
// jedini trenutak koji pokazuje koliko je klijent trosio pred spavanje, pa tek onda posalje signal.
// `sesija = null` je SINHRONO, odmah; odgodjen je samo sam kill (uzmiUzorak UVIJEK razrijesi svoj
// Promise, pa .finally() garantuje gasenje bez obzira na telemetriju). Ovo ostavlja kratak prozor
// (par sekundi, koliko sonda traje) u kojem bi nova poruka mogla dici novu sesiju dok stara jos
// umire - isti kompromis koji cuvar-sesije.mjs vec pravi (zatraziGasenje/uzmiUzorak).
function ugasiUzSnimak(razlog) {
  const s = sesija;
  if (!s) return;
  s.namjerno = true; // da exit handler ne prijavi pad
  sesija = null;
  const pidPrijeGasenja = s.dijete.pid;
  uzmiUzorak({ dogadjaj: "gasenje-idle", razlog }, pidPrijeGasenja).finally(() => s.dijete.kill("SIGTERM"));
}

function otkaziIdle() {
  if (idleTajmer) {
    clearTimeout(idleTajmer);
    idleTajmer = null;
  }
}

/** Zakazuje gasenje mirne sesije. Zove se SAMO kad je red prazan i potez zavrsen. */
function zakaziIdle() {
  otkaziIdle();
  const rok = idleRokMs(IDLE_MIN);
  if (rok === null || !sesija || gasenje) return;
  idleTajmer = setTimeout(() => {
    idleTajmer = null;
    if (!sesija || gasenje) return;
    if (!trebaLiUgasiti(zadnjaAktivnost, Date.now(), IDLE_MIN)) return zakaziIdle();
    log(`sesija je mirovala ${IDLE_MIN} min, gasim je (kontekst ostaje, budi se na prvu poruku)`);
    // stanje.sesija se NE dira: to je kljuc za --resume.
    ugasiUzSnimak(`${IDLE_MIN} min mirovanja`);
  }, rok);
  idleTajmer.unref?.();
}

// Spawn ostaje vlastit, ne ide kroz pokreniClaude/claudeArgv iz sesija.mjs. Most sa sesijom
// razgovara kroz stdin/stdout u stream-json obliku, pa mu treba stdio ["pipe","pipe","pipe"];
// pokreniClaude u pty grani gasi sav stdio na "ignore" i omotava u `script`, sto bi most
// onesposobilo. Uz to trebaPty rjesava problem interaktivnog --channels puta, a most je -p
// rezim koji prompt prima kroz stdin i taj problem nema.
function pokreniSesiju(nastavak) {
  const promptPutanja = sastaviPrompt(TIP, KORIJEN, log);
  const id = stanje.sesija ?? randomUUID();
  const argv = argviSesije({ id, nastavak, promptPutanja, dozvoljeniAlati: ULOGA.dozvoljeniAlati, zabranjeniAlati: ULOGA.zabranjeniAlati });
  const dijete = spawn("claude", argv, {
    env: okruzenjeSesije({
      osnova: process.env,
      aiEnv: ai.env,
      obrisi: ai.obrisi,
      runtime: staze.runtime,
      telegramDir: staze.telegramDir,
      mcpProfil: staze.mcpProfil,
    }),
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const s = {
    dijete,
    id,
    buf: "",
    cekac: null,
    greske: "",
    namjerno: false,
    pocetakMs: Date.now(),
    budjenjeObjavljeno: false,
  };

  // Pid zive sesije, za scripts/resursi.mjs (tip "most"/"most-admin" cita .olx-pik/<sesijaPid>,
  // analogon sesija-klijent.pid kod cuvara). Bez ovog zapisa telemetrija samo gubi pregled zive
  // sesije, most radi dalje. NE cisti se sirocad po ovom pidu: most sesiju drzi kao svoje dijete i
  // gasi je sam, a lazno prepoznavanje reciklirauog pida bi bilo opasnije nego korisno.
  try {
    writeFileSync(join(KORIJEN, ".olx-pik", ULOGA.sesijaPid), `${dijete.pid ?? ""}\n`, "utf8");
  } catch {
    // bez zapisa telemetrija samo gubi pregled zive sesije, most radi dalje
  }

  dijete.stdout.on("data", (d) => {
    s.buf += d.toString("utf8");
    let i;
    while ((i = s.buf.indexOf("\n")) !== -1) {
      const red = s.buf.slice(0, i);
      s.buf = s.buf.slice(i + 1);
      if (!red.trim()) continue;
      let j;
      try {
        j = JSON.parse(red);
      } catch {
        continue;
      }
      // Prva parsirana linija je prvi znak zivota sesije, precizniji analogon cuvarove
      // mjeriHladniStartIObjavi (koja mjeri do prvog znaka zivota preko mtime transkripta).
      if (!s.budjenjeObjavljeno) {
        s.budjenjeObjavljeno = true;
        upisiDogadjaj({ dogadjaj: "budjenje", hladniStartMs: Date.now() - s.pocetakMs });
      }
      // `result` zatvara potez i nosi konacan tekst.
      if (j.type === "result" && s.cekac) {
        const cekac = s.cekac;
        s.cekac = null;
        cekac({ ok: j.subtype === "success", tekst: typeof j.result === "string" ? j.result.trim() : "" });
      }
    }
  });
  dijete.stderr.on("data", (d) => {
    s.greske = `${s.greske}${d.toString("utf8")}`.slice(-2000);
  });
  dijete.on("exit", (kod, signal) => {
    try {
      unlinkSync(join(KORIJEN, ".olx-pik", ULOGA.sesijaPid));
    } catch {
      // vec obrisan ili nije ni upisan
    }
    if (s.namjerno) {
      log(`sesija ugasena zbog mirovanja (kod ${kod})`);
    } else {
      log(`sesija izasla (kod ${kod})${s.greske.trim() ? `: ${s.greske.trim().slice(-300)}` : ""}`);
      // "pad" ide SAMO kad gasenje nije namjerno: namjerno gasenje (idle, nocni rez, svjez .env)
      // ima svoj "gasenje-idle" dogadjaj i nije pad.
      upisiDogadjaj({ dogadjaj: "pad", exitCode: kod, exitSignal: signal ?? null, trajanjeSesijeMs: Date.now() - s.pocetakMs });
    }
    if (sesija === s) sesija = null;
    if (s.cekac) {
      const cekac = s.cekac;
      s.cekac = null;
      cekac({ ok: false, tekst: "", greska: `sesija je pala (kod ${kod})` });
    }
  });
  dijete.on("error", (e) => log(`sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`));

  if (s.id !== stanje.sesija) {
    stanje = { ...stanje, sesija: s.id };
    sacuvaj();
  }
  log(`sesija pokrenuta (pid ${dijete.pid ?? "?"}, ${nastavak ? "nastavak" : "nova"} ${s.id})`);
  upisiDogadjaj({ dogadjaj: "start" });
  return s;
}

/** Posalje tekst zivoj sesiji i vrati sto je vratila. Pokrece sesiju ako je nema. */
function posaljiSesiji(tekst) {
  otkaziIdle();
  zadnjaAktivnost = Date.now();
  if (!sesija) sesija = pokreniSesiju(Boolean(stanje.sesija));
  const s = sesija;
  if (s.cekac) return Promise.resolve({ ok: false, tekst: "", greska: "sesija je zauzeta" });

  return new Promise((zavrsi) => {
    const tajmer = setTimeout(() => {
      if (s.cekac) {
        s.cekac = null;
        log("potez je prekoracio vrijeme, gasim sesiju");
        s.dijete.kill("SIGTERM");
        zavrsi({ ok: false, tekst: "", greska: "potez nije zavrsio na vrijeme" });
      }
    }, POTEZ_TIMEOUT_MS);

    s.cekac = (rezultat) => {
      clearTimeout(tajmer);
      zavrsi(rezultat);
    };

    s.dijete.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: tekst }] } })}\n`,
      (e) => {
        if (e && s.cekac) {
          const cekac = s.cekac;
          s.cekac = null;
          clearTimeout(tajmer);
          cekac({ ok: false, tekst: "", greska: `upis u sesiju pao: ${e.message}` });
        }
      },
    );
  });
}

// ---- nocni rez konteksta, ciscenje inboxa i cron logova ----
// Most je do sada budio sesiju sa --resume zauvijek: kontekst nikad nije padao na nulu, pa je
// trosak po poruci rastao iz dana u dan. Cuvar-sesije.mjs to rjesava nocnim restartom; ovdje je
// isti princip, samo umjesto restarta procesa gasimo internu sesiju i brisemo kljuc sesije, pa
// sljedeca poruka krece OD NULE, bez --resume.

// Cron logovi rastu bez granice (launchd/Scheduler samo apenduju). Isti obrazac i ista konstanta
// kao cuvar-sesije.mjs: nocni ciklus ih skrati na zadnjih ~1 MB.
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
      log(`log ${ime} skracen sa ${Math.round(st.size / 1024)} KB`);
    } catch {
      // log koji se ne da skratiti nije razlog za pad mosta
    }
  }
}

function ocistiInbox() {
  if (!existsSync(INBOX)) return;
  const prag = Date.now() - INBOX_DANA * 24 * 60 * 60 * 1000;
  let obrisano = 0;
  try {
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
  } catch {
    return; // ciscenje inboxa nije razlog za pad mosta
  }
  if (obrisano > 0) log(`inbox ociscen: ${obrisano} fajlova starijih od ${INBOX_DANA} dana`);
}

/** Zadnji dan (lokalni, "YYYY-MM-DD") kad je odradjen nocni rez konteksta. */
let zadnjiNocni = "";

/** Gasi zivu internu sesiju (namjerno, da exit handler ne prijavi pad) i brise njen kljuc, pa
 * sljedeca poruka krece bez --resume. Zove se i kad sesija NIJE ziva: kontekst se rezi svakako,
 * jer bi ga inace sljedeca poruka nastavila kroz --resume. */
function ugasiSesijuBezResuma(razlog) {
  otkaziIdle();
  ugasiUzSnimak(razlog);
  stanje = { ...stanje, sesija: null };
  sacuvaj();
}

function nocniRez() {
  ugasiSesijuBezResuma("nocni rez konteksta");
  ocistiInbox();
  skratiLogove();
  if (RESURSI_UKLJUCENO) ocistiStareResurse(RESURSI_DIR, { cuvajMjeseci: RESURSI_CUVAJ_MJESECI });
  log(`nocni rez konteksta odradjen (sat ${RESTART_SAT}h): sljedeca poruka krece bez --resume`);
}

/**
 * Prepisuje vrijednosti iz .env u process.env djeteta koje ce se sljedece pokrenuti. Prepisuje se
 * NAMJERNO (obrnuto od process.loadEnvFile semantike, koja ne dira vec postavljeno): cijela svrha
 * markera .olx-pik/restart-sesije je da NOVA vrijednost (npr. svjez OLX_TOKEN iz onboardinga)
 * pobijedi staru koju je most drzao od pokretanja.
 *
 * Izuzetak je TELEGRAM_BOT_TOKEN: most je svoj TOKEN uzeo pri startu i vec uspostavio getUpdates
 * na njemu, pa promjena u .env ovdje ne moze preusmjeriti most na drugi token bez pravog restarta
 * procesa.
 */
function osvjeziEnvIzFajla() {
  const iz = procitajEnv(join(KORIJEN, ".env"));
  for (const [kljuc, vrijednost] of Object.entries(iz)) {
    if (kljuc === "TELEGRAM_BOT_TOKEN") {
      // Prazna vrijednost NIJE razlika nego odsustvo: `.env.example` isporucuje ovaj kljuc prazan,
      // a klon koji token drzi samo u runtime `.env` (tako ga pise pripremi-runtime.mjs) bi inace
      // dobijao ovo upozorenje pri svakom preuzimanju svjezeg .env, bez ijednog stvarnog razloga.
      // Admin ulogu ovo ne dira: njen token ionako ne dolazi iz `.env` klona.
      if (vrijednost.trim() !== "" && vrijednost !== TOKEN) {
        log("TELEGRAM_BOT_TOKEN u .env se razlikuje od zivog: za promjenu bot tokena treba pravi restart mosta.");
      }
      continue;
    }
    process.env[kljuc] = vrijednost;
  }
}

// ---- obrada reda ----

let radi = false;

/** Slike koje su nastale tokom poteza. Sesija ih pravi kroz olx_generiraj_sliku. */
function slikeNovijeOd(od) {
  const dir = process.env.OLX_SLIKA_DIR || ".olx-pik/slike";
  try {
    return readdirSync(dir)
      .map((ime) => join(dir, ime))
      .filter((p) => {
        try {
          return statSync(p).mtimeMs >= od;
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return []; // mape nema dok se prva slika ne napravi
  }
}

// posaljiPoruku/posaljiSliku po defaultu koriste TELEGRAM_BOT_TOKEN iz okruzenja, dakle
// klijentskog bota (src/core/telegram.ts, telegramConfig). Admin ulozi se TOKEN mora izricito
// proslijediti, inace bi odgovori admin botu izasli iz klijentskog bota i zavrsili kod musterije.
const OPCIJE_SLANJA = ULOGA.jeAdmin ? { botToken: TOKEN } : {};

async function obradiRed() {
  if (radi) return;
  radi = true;
  otkaziIdle();
  const { posaljiPoruku, posaljiSliku, javiAdminu } = await import("../dist/core/telegram.js");
  try {
    while (stanje.red.length > 0) {
      const stavka = stanje.red[0];
      const kucaj = setInterval(() => {
        void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});
      }, 4000);
      void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});

      const potezPoceo = Date.now();
      let odgovor;
      try {
        odgovor = await posaljiSesiji(tekstStavke(stavka));
        // Gasenje nije neuspjeh stavke: ostavljamo je u redu netaknutu, bez pokusaja.
        if (gasenje) return;
        // Nastavak moze pasti ako je historija sesije nestala: krecemo od nove, jednom.
        if (!odgovor.ok && stanje.sesija && !stavka.novaSesijaProbana) {
          log(`potez pao (${odgovor.greska ?? "bez objasnjenja"}), krecem novu sesiju`);
          stavka.novaSesijaProbana = true;
          stanje = { ...stanje, sesija: null };
          sacuvaj();
          odgovor = await posaljiSesiji(tekstStavke(stavka));
        }
      } finally {
        clearInterval(kucaj);
      }

      if (odgovor.ok && odgovor.tekst) {
        try {
          await posaljiPoruku(odgovor.tekst, { chatId: String(stavka.chatId), ...OPCIJE_SLANJA });
          log(`odgovoreno u chat ${stavka.chatId} (${odgovor.tekst.length} znakova)`);
          // Slika koju je sesija napravila tokom ovog poteza ide odmah za tekstom. Ne trazi se
          // nikakva saradnja modela: dovoljno je da je fajl nastao, pa i slabiji model ne moze
          // zaboraviti da je posalje.
          for (const putanja of slikeNovijeOd(potezPoceo)) {
            try {
              await posaljiSliku(putanja, { chatId: String(stavka.chatId), ...OPCIJE_SLANJA });
              log(`poslana slika ${putanja}`);
            } catch (e) {
              log(`slika nije poslana: ${e instanceof Error ? e.message : e}`);
            }
          }
          // Tek sada stavka izlazi iz reda: prije ovoga pad znaci ponovnu obradu, ne gubitak.
          stanje = { ...stanje, red: stanje.red.slice(1) };
          sacuvaj();
          continue;
        } catch (e) {
          log(`slanje na Telegram palo: ${e instanceof Error ? e.message : e}`);
        }
      }

      stavka.pokusaja = (stavka.pokusaja ?? 0) + 1;
      if (stavka.pokusaja >= MAX_POKUSAJA) {
        log(`stavka odustaje poslije ${stavka.pokusaja} pokusaja`);
        stanje = { ...stanje, red: stanje.red.slice(1) };
        sacuvaj();
        // Namjerno bez OPCIJE_SLANJA: ovo je alarm vlasniku, isti podrazumijevani kanal kao
        // javiAdministratoru, i za klijentski i za admin most.
        await javiAdminu(
          `Telegram most: poruka iz chata ${stavka.chatId} nije odgovorena poslije ${stavka.pokusaja} pokusaja.\n` +
            `Zadnja greska: ${odgovor.greska ?? "sesija je vratila prazan tekst"}`,
        ).catch(() => {});
      } else {
        sacuvaj();
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } finally {
    radi = false;
    zadnjaAktivnost = Date.now();
    // Tajmer se postavlja tek kad je red ostao prazan i potez zavrsen: dok potez traje sesija se
    // ne smije presjeci na pola.
    if (!gasenje && stanje.red.length === 0) zakaziIdle();
  }
}

// ---- album bafer ----
// Telegram album stize kao vise odvojenih poruka sa istim media_group_id i bez signala da je
// zadnja. Kratko cekanje ih spaja u jednu stavku, pa korisnik ne mora pisati "gotovo".

const albumi = new Map();

function uRed(stavka) {
  stanje = { ...stanje, red: [...stanje.red, stavka] };
  sacuvaj();
  void obradiRed();
}

function ubaci(chatId, tekst, slike, albumId) {
  if (!albumId) {
    uRed({ chatId, tekst, slike });
    return;
  }
  const postojeci = albumi.get(albumId);
  if (postojeci) {
    postojeci.slike.push(...slike);
    if (tekst && !postojeci.tekst) postojeci.tekst = tekst;
    clearTimeout(postojeci.tajmer);
  }
  const stavka = postojeci ?? { chatId, tekst, slike: [...slike] };
  stavka.tajmer = setTimeout(() => {
    albumi.delete(albumId);
    uRed({ chatId: stavka.chatId, tekst: stavka.tekst, slike: stavka.slike });
  }, ALBUM_CEKANJE_MS);
  albumi.set(albumId, stavka);
}

// ---- glavna petlja ----

let gasenje = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (gasenje) return; // launchd i shell umiju poslati oba signala
    gasenje = true;
    otkaziIdle();
    log("gasim se, sto je u redu ostaje za sljedece pokretanje");
    upisiDogadjaj({ dogadjaj: "cuvar-gasenje" });
    try {
      unlinkSync(PID_FAJL);
    } catch {
      // vec obrisan
    }
    sesija?.dijete.kill("SIGTERM");
    setTimeout(() => process.exit(0), 500);
  });
}

const preduslovi = provjeriPreduslove(TIP, KORIJEN, process.env);
for (const g of preduslovi.greske) console.error(g);
if (preduslovi.greske.length > 0) process.exit(2);
for (const u of preduslovi.upozorenja) console.error(u);

const pristup = citajPristup();
if (!pristup) {
  console.error(
    `Nema ${join(RUNTIME, "channels", "telegram", "access.json")}. Most bez allowlista ne prima nista.\n` +
      (ULOGA.jeAdmin
        ? "Pripremi runtime: bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]"
        : "Pripremi runtime: bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>"),
  );
  process.exit(2);
}

// Brava se zauzima tek OVDJE: preduslovi i pristup su vec provjereni, a getMe nize je vec dodir
// Telegrama, pa brava mora stajati prije njega. Vazi i u --jednom rezimu: probno pokretanje ne
// smije udariti u zivi most.
await zauzmiPidFajl();

let botIme = null;
try {
  botIme = (await tg("getMe")).username ?? null;
} catch (e) {
  console.error(`Telegram nije prihvatio token: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

log(`most (${TIP}) radi kao @${botIme}, pogon ${ai.pogon}, offset ${stanje.offset}, u redu ${stanje.red.length}, sesija ${stanje.sesija ?? "(nova)"}`);
// Ime dogadjaja se NAMJERNO ne mijenja iako most nije cuvar: znaci "nadzorni proces je startovao"
// i tako ga cita analiza flote (scripts/resursi.mjs).
upisiDogadjaj({ dogadjaj: "cuvar-start" });
if (stanje.red.length > 0) void obradiRed(); // sto je ostalo od proslog pokretanja

// ---- minutni tik: nocni rez konteksta i preuzimanje svjezeg .env ----
// unref?.(): proces zivi od glavne petlje (i od zive sesije, dok postoji), tajmer ga ne smije
// drzati u --jednom rezimu poslije zavrsetka posla.
function tikMinute() {
  if (gasenje) return;
  const sad = new Date();
  const zauzet = radi || stanje.red.length > 0 || albumi.size > 0;

  // telemetrija resursa: gusce uzorkovanje dok je sesija ziva, rjedje dok je mirna (nema sesije).
  if (RESURSI_UKLJUCENO) {
    const mirno = sesija === null;
    const trenutniInterval = mirno ? RESURSI_INTERVAL_STRAZA_MIN : RESURSI_INTERVAL_MIN;
    const pomak = mirno ? RESURSI_POMAK_STRAZA : RESURSI_POMAK_AKTIVNO;
    const minutaOdEpoha = Math.floor(Date.now() / 60_000);
    if (trebaLiUzorkovati({ minutaOdEpoha, intervalMin: trenutniInterval, pomak, zadnjaUzorkovanaMinuta })) {
      zadnjaUzorkovanaMinuta = minutaOdEpoha;
      void uzmiUzorak({ intervalMin: trenutniInterval }, sesija ? sesija.dijete.pid : null);
    }
  }

  // Vanjski zahtjev za svjez .env (npr. nov OLX_TOKEN iz onboardinga): za razliku od
  // cuvar-sesije.mjs, ovdje NEMA restarta procesa koji bi ga sam dici nazad, pa most mora
  // primijeniti novu vrijednost u vlastitom process.env i sam ugasiti sesiju koja je radila bez
  // nje. Kad je most zauzet, zahtjev se NE dira: potez u toku se ne smije presjeci na pola,
  // fajl ceka sljedecu minutu.
  if (existsSync(RESTART_ZAHTJEV) && !zauzet) {
    let razlog = "vanjski zahtjev";
    try {
      razlog = readFileSync(RESTART_ZAHTJEV, "utf8").trim() || razlog;
    } catch {
      // fajl je nestao ili je necitljiv: primjena ide dalje, razlog ostaje opsti
    }
    try {
      unlinkSync(RESTART_ZAHTJEV);
    } catch {
      // ako se ne moze obrisati, zahtjev se ne vrti u krug: ignorise se dalje
    }
    osvjeziEnvIzFajla();
    // Sesija koja je radila bez svjezeg tokena nema upotrebljiv kontekst za nastavak.
    ugasiSesijuBezResuma(razlog);
    log(`svjez .env primijenjen (${razlog}), sesija ugasena bez --resume`);
  }

  if (trebaLiNocniRez({ sad, restartSat: RESTART_SAT, zadnjiNocni, zauzet })) {
    // Upisano PRVO, prije samog posla: sprjecava da se rez ponovi vise puta u istom danu ako
    // vise provjera padne u isti sat.
    zadnjiNocni = lokalniDatum(sad);
    nocniRez();
  }
}
setInterval(tikMinute, 60_000).unref?.();

while (!gasenje) {
  let noviji;
  try {
    noviji = await tg("getUpdates", {
      offset: stanje.offset,
      timeout: JEDNOM ? 0 : POLL_TIMEOUT_S,
      allowed_updates: ["message"],
    });
  } catch (e) {
    log(`getUpdates pao: ${e instanceof Error ? e.message : e}`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  for (const u of noviji) {
    const poruka = u.message;
    if (poruka && dozvoljena(poruka, pristup, botIme)) {
      const tekst = (poruka.text ?? poruka.caption ?? "").trim();
      if (tekst.startsWith("/")) {
        log(`komanda ${tekst.split(" ")[0]} preskocena`); // komande ne idu u sesiju
      } else {
        const slika = await skiniFoto(poruka);
        if (tekst || slika) ubaci(poruka.chat.id, tekst, slika ? [slika] : [], poruka.media_group_id ?? null);
      }
    } else if (poruka) {
      log(`ispusteno: chat ${poruka.chat?.id}, od ${poruka.from?.id}`);
    }
    // Offset se pomjera tek kad je poruka obradjena do reda: pad prije ovoga znaci da je
    // Telegram i dalje drzi i dostavlja je ponovo.
    stanje = { ...stanje, offset: u.update_id + 1 };
    sacuvaj();
  }

  if (JEDNOM) {
    while (radi || stanje.red.length > 0 || albumi.size > 0) await new Promise((r) => setTimeout(r, 500));
    otkaziIdle();
    sesija?.dijete.kill("SIGTERM");
    break;
  }
}
