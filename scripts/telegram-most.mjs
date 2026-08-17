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
//
// Stanje se drzi po ULOZI, ne kao modul-level singleton: mapa `uloge` moze u buducnosti nositi
// vise od jednog unosa (jednobotni rezim, jedan proces, dvije zive sesije). Ova faza mapu jos
// puni tacno jednim unosom (`glavna`, uloga iz argv), pa je ponasanje bajt za bajt isto kao
// prije, ali sve funkcije koje diraju zivo stanje sesije vec primaju unos uloge kao argument.

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
  odlukaPoruke,
  izvorSlike,
  tekstStavke,
  argviSesije,
  idleRokMs,
  trebaLiUgasiti,
  lokalniDatum,
  trebaLiNocniRez,
  trebaLiUzorkovati,
  ulogaMosta,
  stanjeUloge,
  adminTgIdIzEnva,
  jednobotniRezim,
  validanAdminTgId,
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
try {
  ulogaMosta(TIP); // samo provjera: nevalidan TIP mora pasti ODMAH, prije bilo kakve postavke
} catch (e) {
  console.error(`${e.message} Upotreba: bun scripts/telegram-most.mjs [klijent|admin-bot] [--jednom]`);
  process.exit(1);
}

const JEDNOM = process.argv.includes("--jednom");
const KORIJEN = process.cwd(); // most se ionako pokrece iz korijena klona

// Jednobotni rezim (faza C): jedan bot token, dvije zive sesije u istom procesu, rutiranje po
// posiljacu. Ukljucuje se ISKLJUCIVO preko OLX_MOST_ADMIN_TG_ID, dokumentovano u .env.example.
const ADMIN_TG_ID = adminTgIdIzEnva(process.env);
const JEDNOBOTNI = jednobotniRezim(process.env);

// Neispravna, NEPRAZNA vrijednost (npr. negativan grupni ID, slova) znaci da je vlasnik
// POKUSAO ukljuciti jednobotni rezim i pogrijesio unos. Ovo mora biti glasna, odmah vidljiva
// greska: tiho gasenje admin grane bi vlasnika ostavilo da ceka odgovor na privatnu poruku koji
// nikad ne stize (poruka bi tiho pala na "klijent" rutu), a tiho otvaranje admin grane na
// pogresnoj vrijednosti bi bilo jos gore (pogresan ID bi dobio admin ovlasti ili niko ne bi).
// Zato se ovo provjerava PRIJE bilo kakvog drugog posla, cak i prije provjere preduslova.
if (JEDNOBOTNI && !validanAdminTgId(ADMIN_TG_ID)) {
  console.error(
    `OLX_MOST_ADMIN_TG_ID="${ADMIN_TG_ID}" nije ispravan. Vrijednost mora biti pozitivan brojcani ` +
      "Telegram ID COVJEKA (vlasnika), ne grupe: negativan broj izgleda kao ID grupe, ne kao licni " +
      "ID. Popravi OLX_MOST_ADMIN_TG_ID u .env ili ga isprazni da se ugasi jednobotni rezim.",
  );
  process.exit(2);
}

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

// Zajednicka mapa svih zivih uloga mosta. Danas ima TACNO JEDAN unos (uloga iz argv); jednobotni
// rezim (faza C) ce ovamo lijeno dodati drugi, bez dodira ove funkcije.
const uloge = new Map();

/**
 * Vrati potpuno opremljen unos stanja za ulogu `tip`. `stanjeUloge` (lib/most.mjs) pravi lijeno
 * osnovni objekat identiteta; ova funkcija ga dopunjuje poljima koja su ranije zivjela kao
 * modul-level konstante izvedene iz ULOGA/TIP, i jednom ucita stanje sa diska.
 *
 * Idempotentna: drugi poziv sa istim `tip`-om vraca ISTI, vec popunjeni objekat i ne dira nijedno
 * polje ni stanje sa diska ponovo. Prepoznaje vec pripremljen unos po `u.staze`, polju koje
 * `stanjeUloge` sama nikad ne postavlja.
 */
function pripremiUlogu(tip) {
  const u = stanjeUloge(uloge, tip);
  if (u.staze) return u;
  u.staze = stazeSesije(tip, KORIJEN);
  u.inbox = u.staze.inbox;
  u.ai = aiPogon(u.uloga.jeAdmin, process.env);
  // Admin ima poseban override (OLX_MOST_ADMIN_IDLE_MIN, pada na OLX_MOST_IDLE_MIN, pada na 30):
  // cuvar-sesije.mjs je adminu davao kraci idle prag (30 min) nego klijentu, a most vec
  // podrazumijeva 30, pa je paritet zadrzan i bez posebne vrijednosti.
  u.idleMin = u.uloga.jeAdmin
    ? broj(process.env.OLX_MOST_ADMIN_IDLE_MIN, broj(process.env.OLX_MOST_IDLE_MIN, 30))
    : Number(process.env.OLX_MOST_IDLE_MIN) || 30;
  // Marker kojim vanjski proces (onboarding-puller.mjs) trazi da sesija preuzme svjez .env
  // (npr. nov OLX_TOKEN upisan u zivi klon). Prolazan je, brise se odmah po obradi u tikMinute.
  u.restartZahtjev = join(KORIJEN, ".olx-pik", u.uloga.restartZahtjev);
  u.radi = false;
  u.zadnjaUzorkovanaMinuta = -1;
  u.uzorakUToku = false;
  u.zadnjaAktivnost = Date.now();
  u.stanje = citajStanje(u);
  return u;
}

// `glavna` je uloga OVOG procesa: vlasnik bot tokena, vlasnik Telegram `offset`-a i vlasnik pid
// fajla. U jednobotnom rezimu (faza C) je `glavna` UVIJEK klijentska uloga (mutual-exclusion
// brana nize garantuje da TIP admin-bot u tom rezimu nikad ne dodje dovde), a admin unos u mapi
// (`adminUnos`, pripremljen iznad) dijeli njen token i offset, ne dobija svoj.
const glavna = pripremiUlogu(TIP);
// RUNTIME vise NE dolazi iz process.env.CLAUDE_CONFIG_DIR: jedan klon, jedan klijent, a
// naslijedjen CLAUDE_CONFIG_DIR sa masine bi mostu mogao podmetnuti tudji (npr. admin) runtime.
//
// U jednobotnom rezimu RUNTIME i dalje ostaje KLIJENTSKI (glavna.staze.runtime), namjerno:
// dolaznu pristupnu kontrolu (nize, citajPristup) odlucuje access.json OVOG runtime-a, jer je
// bot token klijentski. Posljedica: vlasnikov Telegram ID mora biti u allowFrom klijentskog
// access.json, inace njegova privatna poruka ne prodje dozvoljena() i on dobija tisinu, a admin
// grana (efektivnaUloga/odlukaPoruke) se nikad ne pozove. Admin unos (adminUnos) koristi
// .claude-runtime-admin SAMO za okruzenje zive sesije (CLAUDE_CONFIG_DIR, settings.admin-bot.json,
// prompt, OLX_MCP_PROFILE=admin), nikad za Telegram token ni za pristupnu kontrolu.
const RUNTIME = glavna.staze.runtime;
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
  if (!glavna.uloga.jeAdmin) {
    return process.env.TELEGRAM_BOT_TOKEN || procitajEnv(join(glavna.staze.telegramDir, ".env")).TELEGRAM_BOT_TOKEN;
  }
  return procitajEnv(join(glavna.staze.telegramDir, ".env")).TELEGRAM_BOT_TOKEN;
}
// Bot token je JEDAN, klijentski, procesna konstanta. U jednobotnom rezimu admin unos ga NIKAD
// ne cita sam: `getUpdates` na dva tokena bi bilo dva tokena, a most ima samo jedan, pa admin
// grana koristi ovaj isti TOKEN (vidi OPCIJE_SLANJA nize).
const TOKEN = ucitajToken();

// Nocni rez konteksta (vidi tikMinute nize): u koji sat sesija gubi --resume i kontekst krece
// od nule. Isti podrazumijevani sat kao cuvar-sesije.mjs, radi jednostavnosti pamcenja za
// vlasnika koji podesava .env.
const RESTART_SAT = broj(process.env.OLX_MOST_RESTART_SAT, 3);

// Starost inbox fajlova koji se brisu u nocnom rezu: NAMJERNO ista varijabla kao
// cuvar-sesije.mjs (OLX_SESIJA_INBOX_DANA), ne nova. Isti klon, isti inbox, jedan prekidac.
const INBOX_DANA = broj(process.env.OLX_SESIJA_INBOX_DANA, 7);

if (!TOKEN) {
  console.error(
    glavna.uloga.jeAdmin
      ? `TELEGRAM_BOT_TOKEN nije postavljen u ${join(glavna.staze.telegramDir, ".env")}. Pokreni prvo: ` +
          "bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]"
      : "TELEGRAM_BOT_TOKEN nije postavljen u .env. Most se ne moze pokrenuti.",
  );
  process.exit(2);
}

// Klon sa OLX_KLIJENT_AI=deepseek bez popunjenih OLX_DEEPSEEK_* varijabli NE SMIJE tiho preci
// na Anthropic pretplatu i naplacivati na pogresnom mjestu. Za admina aiPogon uvijek vraca
// pretplatu i brise ANTHROPIC_* iz okruzenja djeteta (okruzenjeSesije to vec primjenjuje).
if (glavna.ai.ok === false) {
  console.error(glavna.ai.poruka);
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
// Zajednicko za sve uloge (isti klon, ista masina): ostaje modul-level, ne po ulozi.
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

const log = (sta) => console.log(`${new Date().toISOString()} ${sta}`);

// ---- stanje i red, oboje na disku ----
// Jedan fajl PO ULOZI: offset, ID sesije i red stavki. Upis je atomican (tmp + rename), pa pad u
// sredini upisa ne moze ostaviti pokvaren fajl.

function citajStanje(u) {
  try {
    const s = JSON.parse(readFileSync(u.uloga.stanjeFajl, "utf8"));
    return { offset: s.offset ?? 0, sesija: s.sesija ?? null, red: Array.isArray(s.red) ? s.red : [] };
  } catch {
    return { offset: 0, sesija: null, red: [] };
  }
}

function sacuvaj(u) {
  mkdirSync(dirname(u.uloga.stanjeFajl), { recursive: true });
  const tmp = `${u.uloga.stanjeFajl}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(u.stanje, null, 2)}\n`, "utf8");
  renameSync(tmp, u.uloga.stanjeFajl);
}

// ---- PID brava (zastita od dvostrukog pokretanja) ----
// Dva mosta na istom klonu bi znacila dva getUpdates konzumera na istom bot tokenu i 409 Conflict
// na Telegramu. Preslikano iz cuvar-sesije.mjs (odbijStart/zauzmiPidFajl): upis je atomican (flag
// "wx"), pa dva mosta pokrenuta u istoj sekundi ne mogu oba proci. Zauzima se PRIJE prvog dodira
// Telegrama (tg("getMe")), jer brava mora stajati prije ijednog poziva, ne poslije.
//
// Pid fajl je jedan po PROCESU (vlasnik je glavna uloga), ne po ulozi u mapi.

const PID_FAJL = join(KORIJEN, ".olx-pik", glavna.uloga.pidFajl);
const ODBIJEN_ALARM_FAJL = join(KORIJEN, ".olx-pik", glavna.uloga.odbijenAlarm);

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
// ulozi u ovom kodu.

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

/**
 * Skine fotografiju u inbox uloge `u`. Vraca putanju ili null.
 *
 * Inbox mora biti ciljne uloge, ne uvijek `glavna`: klijentski i admin runtime imaju razlicite
 * settings.json i razlicite dozvole citanja, pa fotografija iz admin razgovora mora ici u admin
 * inbox da je admin sesija smije citati.
 */
async function skiniFoto(u, poruka) {
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
    mkdirSync(u.inbox, { recursive: true });
    const putanja = resolve(u.inbox, `${Date.now()}-${izvor.kljuc}${ext}`);
    writeFileSync(putanja, Buffer.from(await res.arrayBuffer()));
    return putanja;
  } catch (e) {
    log(`fotografija nije skinuta: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---- ziva sesija ----

// ---- telemetrija resursa: pomocne funkcije ----
// upisiDogadjaj je NAMJERNO potpuno sinhrona (appendFileSync unutar upisiRed): sigurno je pozvati
// je bilo gdje, ukljucujuci SIGINT/SIGTERM handler tik prije process.exit, bez brige da upis nece
// stici. Kad je RESURSI_UKLJUCENO false, vraca se odmah bez ikakvog I/O.
function upisiDogadjaj(u, polja) {
  if (!RESURSI_UKLJUCENO) return;
  try {
    const red = redUzorka({
      ts: new Date().toISOString(),
      klon: KLON_IME,
      tip: u.uloga.telemetrijaTip,
      verzijaKoda: VERZIJA_KODA,
      sesijaZiva: !!u.sesija,
      // Most nema pravu strazu (poll ide stalno, ne samo dok sesija spava), ali ovo polje znaci
      // "klon je u mirnom stanju, sesija ne postoji", pa vrijemeUStrazi u lib/resursi.mjs racuna
      // isto kao za cuvara.
      uStrazi: u.sesija === null,
      cuvarRssBajta: process.memoryUsage().rss,
      ...polja,
    });
    upisiRed(putanjaResursa(process.env), red);
  } catch {
    // telemetrija nikad ne smije srusiti mosta
  }
}

// Async dio: sabira RSS stabla procesa (ako je dat pidZaStablo) i stanje masine, pa upise red
// preko upisiDogadjaj. `u.uzorakUToku` sprjecava preklapanje ako prethodni uzorak jos traje.
// Uvijek razrijesi svoj Promise (i kad je telemetrija iskljucena ili je uzorak vec u toku), da
// pozivalac (npr. ugasiUzSnimak) moze sigurno vezati .finally() na nju.
async function uzmiUzorak(u, extraPolja, pidZaStablo) {
  if (!RESURSI_UKLJUCENO || u.uzorakUToku) return;
  u.uzorakUToku = true;
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
        prethodnoStanje: u.cpuStanje,
        sadaMs: Date.now(),
      });
      u.cpuStanje = cpuRezultat.stanjeZaSutra;
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
        void javiAdministratoru(`Pritisak na masinu (most, ${u.tip}) u ${KORIJEN}: ${pritisak.razlog}.`);
      }
    }
    upisiDogadjaj(u, {
      stabloRssBajta: stablo?.ukupnoBajta ?? null,
      stabloBrojProcesa: stablo?.brojProcesa ?? null,
      cpuKlonaPct,
      masina,
      ...extraPolja,
    });
  } catch {
    // best effort
  } finally {
    u.uzorakUToku = false;
  }
}

// Zajednicka pomocna funkcija za sva tri mjesta gdje most gasi zivu sesiju (idle tajmer, nocni rez
// konteksta, svjez .env): uzme PUN uzorak (RSS stabla + masina) DOK je proces jos ziv, jer je to
// jedini trenutak koji pokazuje koliko je klijent trosio pred spavanje, pa tek onda posalje signal.
// `u.sesija = null` je SINHRONO, odmah; odgodjen je samo sam kill (uzmiUzorak UVIJEK razrijesi svoj
// Promise, pa .finally() garantuje gasenje bez obzira na telemetriju). Ovo ostavlja kratak prozor
// (par sekundi, koliko sonda traje) u kojem bi nova poruka mogla dici novu sesiju dok stara jos
// umire, isti kompromis koji cuvar-sesije.mjs vec pravi (zatraziGasenje/uzmiUzorak).
function ugasiUzSnimak(u, razlog) {
  const s = u.sesija;
  if (!s) return;
  s.namjerno = true; // da exit handler ne prijavi pad
  u.sesija = null;
  const pidPrijeGasenja = s.dijete.pid;
  uzmiUzorak(u, { dogadjaj: "gasenje-idle", razlog }, pidPrijeGasenja).finally(() => s.dijete.kill("SIGTERM"));
}

function otkaziIdle(u) {
  if (u.idleTajmer) {
    clearTimeout(u.idleTajmer);
    u.idleTajmer = null;
  }
}

/** Zakazuje gasenje mirne sesije. Zove se SAMO kad je red prazan i potez zavrsen. */
function zakaziIdle(u) {
  otkaziIdle(u);
  const rok = idleRokMs(u.idleMin);
  if (rok === null || !u.sesija || gasenje) return;
  u.idleTajmer = setTimeout(() => {
    u.idleTajmer = null;
    if (!u.sesija || gasenje) return;
    if (!trebaLiUgasiti(u.zadnjaAktivnost, Date.now(), u.idleMin)) return zakaziIdle(u);
    log(`sesija je mirovala ${u.idleMin} min, gasim je (kontekst ostaje, budi se na prvu poruku)`);
    // u.stanje.sesija se NE dira: to je kljuc za --resume.
    ugasiUzSnimak(u, `${u.idleMin} min mirovanja`);
  }, rok);
  u.idleTajmer.unref?.();
}

// Spawn ostaje vlastit, ne ide kroz pokreniClaude/claudeArgv iz sesija.mjs. Most sa sesijom
// razgovara kroz stdin/stdout u stream-json obliku, pa mu treba stdio ["pipe","pipe","pipe"];
// pokreniClaude u pty grani gasi sav stdio na "ignore" i omotava u `script`, sto bi most
// onesposobilo. Uz to trebaPty rjesava problem interaktivnog --channels puta, a most je -p
// rezim koji prompt prima kroz stdin i taj problem nema.
function pokreniSesiju(u, nastavak) {
  const promptPutanja = sastaviPrompt(u.tip, KORIJEN, log);
  const id = u.stanje.sesija ?? randomUUID();
  const argv = argviSesije({ id, nastavak, promptPutanja, dozvoljeniAlati: u.uloga.dozvoljeniAlati, zabranjeniAlati: u.uloga.zabranjeniAlati });
  const dijete = spawn("claude", argv, {
    env: okruzenjeSesije({
      osnova: process.env,
      aiEnv: u.ai.env,
      obrisi: u.ai.obrisi,
      runtime: u.staze.runtime,
      telegramDir: u.staze.telegramDir,
      mcpProfil: u.staze.mcpProfil,
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
    writeFileSync(join(KORIJEN, ".olx-pik", u.uloga.sesijaPid), `${dijete.pid ?? ""}\n`, "utf8");
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
        upisiDogadjaj(u, { dogadjaj: "budjenje", hladniStartMs: Date.now() - s.pocetakMs });
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
      unlinkSync(join(KORIJEN, ".olx-pik", u.uloga.sesijaPid));
    } catch {
      // vec obrisan ili nije ni upisan
    }
    if (s.namjerno) {
      log(`sesija ugasena zbog mirovanja (kod ${kod})`);
    } else {
      log(`sesija izasla (kod ${kod})${s.greske.trim() ? `: ${s.greske.trim().slice(-300)}` : ""}`);
      // "pad" ide SAMO kad gasenje nije namjerno: namjerno gasenje (idle, nocni rez, svjez .env)
      // ima svoj "gasenje-idle" dogadjaj i nije pad.
      upisiDogadjaj(u, { dogadjaj: "pad", exitCode: kod, exitSignal: signal ?? null, trajanjeSesijeMs: Date.now() - s.pocetakMs });
    }
    if (u.sesija === s) u.sesija = null;
    if (s.cekac) {
      const cekac = s.cekac;
      s.cekac = null;
      cekac({ ok: false, tekst: "", greska: `sesija je pala (kod ${kod})` });
    }
  });
  dijete.on("error", (e) => log(`sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`));

  if (s.id !== u.stanje.sesija) {
    u.stanje = { ...u.stanje, sesija: s.id };
    sacuvaj(u);
  }
  log(`sesija pokrenuta (pid ${dijete.pid ?? "?"}, ${nastavak ? "nastavak" : "nova"} ${s.id})`);
  upisiDogadjaj(u, { dogadjaj: "start" });
  return s;
}

/** Posalje tekst zivoj sesiji i vrati sto je vratila. Pokrece sesiju ako je nema. */
function posaljiSesiji(u, tekst) {
  otkaziIdle(u);
  u.zadnjaAktivnost = Date.now();
  if (!u.sesija) u.sesija = pokreniSesiju(u, Boolean(u.stanje.sesija));
  const s = u.sesija;
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
// kao cuvar-sesije.mjs: nocni ciklus ih skrati na zadnjih ~1 MB. Fajlovi su procesni (dijeljeni
// za sve uloge klona), pa funkcija ostaje bez argumenta uloge.
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

function ocistiInbox(u) {
  if (!existsSync(u.inbox)) return;
  const prag = Date.now() - INBOX_DANA * 24 * 60 * 60 * 1000;
  let obrisano = 0;
  try {
    for (const ime of readdirSync(u.inbox)) {
      const putanja = join(u.inbox, ime);
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

/** Gasi zivu internu sesiju (namjerno, da exit handler ne prijavi pad) i brise njen kljuc, pa
 * sljedeca poruka krece bez --resume. Zove se i kad sesija NIJE ziva: kontekst se rezi svakako,
 * jer bi ga inace sljedeca poruka nastavila kroz --resume. */
function ugasiSesijuBezResuma(u, razlog) {
  otkaziIdle(u);
  ugasiUzSnimak(u, razlog);
  u.stanje = { ...u.stanje, sesija: null };
  sacuvaj(u);
}

function nocniRez(u) {
  ugasiSesijuBezResuma(u, "nocni rez konteksta");
  ocistiInbox(u);
  // skratiLogove i ocistiStareResurse su PROCESNI (dijeljeni fajlovi klona), ne po ulozi.
  // Namjerno: ako u fazi C dvije uloge udare isti sat rezenja, oba pozivaju ove dvije funkcije,
  // ali su obje idempotentne (drugi poziv u istoj minuti nema sta da skrati ili obrise), pa je
  // dupli poziv bezopasan.
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

// TOKEN se salje UVIJEK, bez grane po ulozi: token je procesni i jedan (vidi komentar iznad
// definicije TOKEN), pa izricito prosljedjivanje ovdje uklanja granu i tacnije je od pouzdanja u
// TELEGRAM_BOT_TOKEN iz okruzenja djeteta. posaljiPoruku/posaljiSliku (src/core/telegram.ts,
// telegramConfig) bi bez botToken parametra pale na TELEGRAM_BOT_TOKEN iz process.env, a klon koji
// token drzi SAMO u runtime .env (tako ga pise pripremi-runtime.mjs, ne u .env klona) ne bi imao
// tu varijablu postavljenu, pa bi poziv pao ili otisao na pogresan bot.
const OPCIJE_SLANJA = { botToken: TOKEN };

// posaljiPoruku/posaljiSliku/javiAdminu se ucitavaju dinamicki JEDNOM, u radnik() prije petlje
// (ne staticnim importom na vrhu fajla): modul zivi u dist/, koji ne postoji prije prvog builda,
// pa bi staticni import pao na svjezem klonu jos prije nego most stigne do preduslova.
let telegramFns = null;

/**
 * Obradi TACNO JEDNU stavku sa glave reda uloge `u` i vrati se. Logika je NEDIRNUTA u odnosu na
 * staru petlju: sendChatAction kucanje i njegov clearInterval, posaljiSesiji, provjera gasenja,
 * retry sa novom sesijom, slanje odgovora, slanje slika iz slikeNovijeOd(potezPoceo), vadjenje
 * stavke iz reda TEK poslije uspjesnog slanja, stavka.pokusaja, MAX_POKUSAJA, javiAdminu, pauza
 * od 3000 ms. Izdvojena je na jedan potez da globalni radnik() moze naizmjenice opsluzivati sve
 * uloge, potez po potez, umjesto da jedna uloga isprazni cijeli svoj red prije nego druga dodje
 * na red.
 */
async function obradiStavku(u) {
  const { posaljiPoruku, posaljiSliku, javiAdminu } = telegramFns;
  const stavka = u.stanje.red[0];
  const kucaj = setInterval(() => {
    void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});
  }, 4000);
  void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});

  const potezPoceo = Date.now();
  let odgovor;
  try {
    odgovor = await posaljiSesiji(u, tekstStavke(stavka));
    // Gasenje nije neuspjeh stavke: ostavljamo je u redu netaknutu, bez pokusaja.
    if (gasenje) return;
    // Nastavak moze pasti ako je historija sesije nestala: krecemo od nove, jednom.
    if (!odgovor.ok && u.stanje.sesija && !stavka.novaSesijaProbana) {
      log(`potez pao (${odgovor.greska ?? "bez objasnjenja"}), krecem novu sesiju`);
      stavka.novaSesijaProbana = true;
      u.stanje = { ...u.stanje, sesija: null };
      sacuvaj(u);
      odgovor = await posaljiSesiji(u, tekstStavke(stavka));
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
      u.stanje = { ...u.stanje, red: u.stanje.red.slice(1) };
      sacuvaj(u);
      return;
    } catch (e) {
      log(`slanje na Telegram palo: ${e instanceof Error ? e.message : e}`);
    }
  }

  stavka.pokusaja = (stavka.pokusaja ?? 0) + 1;
  if (stavka.pokusaja >= MAX_POKUSAJA) {
    log(`stavka odustaje poslije ${stavka.pokusaja} pokusaja`);
    u.stanje = { ...u.stanje, red: u.stanje.red.slice(1) };
    sacuvaj(u);
    // Namjerno bez OPCIJE_SLANJA: ovo je alarm vlasniku, isti podrazumijevani kanal kao
    // javiAdministratoru, i za klijentski i za admin most.
    await javiAdminu(
      `Telegram most: poruka iz chata ${stavka.chatId} nije odgovorena poslije ${stavka.pokusaja} pokusaja.\n` +
        `Zadnja greska: ${odgovor.greska ?? "sesija je vratila prazan tekst"}`,
    ).catch(() => {});
  } else {
    sacuvaj(u);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

let radnikAktivan = false;

/**
 * Globalni katanac poteza: JEDAN radnik za SVE uloge u mapi, umjesto po ulozi (obradiRed prije
 * ove faze). Round robin je po JEDNOJ stavci, ne po cijelom redu uloge: tako admin ceka najvise
 * jedan klijentski potez da zavrsi, a ne cijeli klijentski red.
 *
 * Katanac postoji zbog slika: slikeNovijeOd(potezPoceo) vezuje slike za odgovor po VREMENU
 * nastanka, iz JEDNE dijeljene mape (OLX_SLIKA_DIR). Dva paralelna poteza (klijent i admin u isto
 * vrijeme) bi znacila da slika iz klijentske sesije moze otici u vlasnikov privatni razgovor, ili
 * slika iz admin poteza u KLIJENTSKU GRUPU. Razdvajanje mape slika je odlozeno za kasnije, pa ovaj
 * katanac (nikad dva poteza istovremeno) mora sprijeciti to preklapanje.
 */
async function radnik() {
  if (radnikAktivan) return;
  radnikAktivan = true;
  try {
    if (!telegramFns) telegramFns = await import("../dist/core/telegram.js");
    while (!gasenje) {
      let radio = false;
      for (const u of uloge.values()) {
        if (u.stanje.red.length === 0) continue;
        radio = true;
        u.radi = true;
        otkaziIdle(u);
        try {
          await obradiStavku(u);
        } finally {
          u.radi = false;
          u.zadnjaAktivnost = Date.now();
        }
        if (gasenje) break;
      }
      if (!radio) break;
    }
  } finally {
    radnikAktivan = false;
    for (const u of uloge.values()) {
      if (!gasenje && u.stanje.red.length === 0) zakaziIdle(u);
    }
  }
}

// ---- album bafer ----
// Telegram album stize kao vise odvojenih poruka sa istim media_group_id i bez signala da je
// zadnja. Kratko cekanje ih spaja u jednu stavku, pa korisnik ne mora pisati "gotovo". Zajednicki
// za sve uloge (isti proces, isti Telegram poll), zato ostaje modul-level.

const albumi = new Map();

function uRed(u, stavka) {
  u.stanje = { ...u.stanje, red: [...u.stanje.red, stavka] };
  sacuvaj(u);
  void radnik();
}

function ubaci(u, chatId, tekst, slike, albumId) {
  if (!albumId) {
    uRed(u, { chatId, tekst, slike });
    return;
  }
  const postojeci = albumi.get(albumId);
  if (postojeci) {
    postojeci.slike.push(...slike);
    if (tekst && !postojeci.tekst) postojeci.tekst = tekst;
    clearTimeout(postojeci.tajmer);
  }
  // Stavka nosi vlastiti `tip`, jer album moze primiti poruke iz vise poziva ubaci() rasprostrte
  // kroz vrijeme: kad tajmer istekne, unos uloge se trazi ponovo preko stanjeUloge, ne zatvara se
  // preko `u` iz prvog poziva.
  const stavka = postojeci ?? { chatId, tekst, slike: [...slike], tip: u.tip };
  stavka.tajmer = setTimeout(() => {
    albumi.delete(albumId);
    const ciljnaUloga = stanjeUloge(uloge, stavka.tip);
    uRed(ciljnaUloga, { chatId: stavka.chatId, tekst: stavka.tekst, slike: stavka.slike });
  }, ALBUM_CEKANJE_MS);
  albumi.set(albumId, stavka);
}

// ---- glavna petlja ----

let gasenje = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (gasenje) return; // launchd i shell umiju poslati oba signala
    gasenje = true;
    log("gasim se, sto je u redu ostaje za sljedece pokretanje");
    for (const u of uloge.values()) {
      otkaziIdle(u);
      upisiDogadjaj(u, { dogadjaj: "cuvar-gasenje" });
      u.sesija?.dijete.kill("SIGTERM");
    }
    try {
      unlinkSync(PID_FAJL);
    } catch {
      // vec obrisan
    }
    setTimeout(() => process.exit(0), 500);
  });
}

const preduslovi = provjeriPreduslove(TIP, KORIJEN, process.env);
for (const g of preduslovi.greske) console.error(g);
if (preduslovi.greske.length > 0) process.exit(2);
for (const g of preduslovi.upozorenja) console.error(g);

// Jednobotni rezim: klijentska uloga (TIP klijent, `glavna`) u ovom procesu vozi i admin granu,
// pa treba i admin runtime (.claude-runtime-admin, prompt admin-bota) da bi admin poteze mogla
// pokrenuti, iako je argv rekao "klijent".
let adminUnos = null;
if (JEDNOBOTNI) {
  const preduslociAdmin = provjeriPreduslove("admin-bot", KORIJEN, process.env);
  for (const g of preduslociAdmin.greske) console.error(g);
  if (preduslociAdmin.greske.length > 0) {
    // Poruka iz sesija.mjs (iznad) predlaze STARU komandu, sa bot tokenom: tacno za dvobotni
    // rezim, ne za ovaj. U jednobotnom rezimu admin runtime nema svoj bot, pa ide bez njega.
    console.error(
      "U jednobotnom rezimu admin runtime se pravi sa: bun scripts/pripremi-admin-runtime.mjs " +
        "--bez-bota <admin_telegram_id>",
    );
    process.exit(2);
  }
  for (const g of preduslociAdmin.upozorenja) console.error(g);
  adminUnos = pripremiUlogu("admin-bot");
}

const pristup = citajPristup();
if (!pristup) {
  console.error(
    `Nema ${join(RUNTIME, "channels", "telegram", "access.json")}. Most bez allowlista ne prima nista.\n` +
      (glavna.uloga.jeAdmin
        ? "Pripremi runtime: bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]"
        : "Pripremi runtime: bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>"),
  );
  process.exit(2);
}

// ---- jednobotni rezim: brane medjusobne iskljucivosti ----
// Dva getUpdates konzumera na istom bot tokenu daju 409 Conflict Telegramu, a dva procesa koja
// radi --resume na istom sesijskom kljucu bi pokvarila transkript. U jednobotnom rezimu jedan
// proces (klijentska uloga) vozi oba smjera, pa odvojen admin-bot proces vise ne smije raditi
// paralelno s njim, u ni jednom smjeru.
if (JEDNOBOTNI && TIP === "admin-bot") {
  await odbijStart(
    "jednobotni rezim je ukljucen (OLX_MOST_ADMIN_TG_ID je postavljen): u tom rezimu admin poruke " +
      "vozi klijentski most u istom procesu, pa odvojena admin uloga ne smije raditi. Skloni posao admin-bot.",
  );
}
if (JEDNOBOTNI && TIP === "klijent") {
  const adminPidFajl = join(KORIJEN, ".olx-pik", "most-admin.pid");
  let stariAdminPid = 0;
  try {
    stariAdminPid = Number(readFileSync(adminPidFajl, "utf8").trim());
  } catch {
    // fajla nema, nikad nije postojao ili je uredno ociscen
  }
  if (Number.isFinite(stariAdminPid) && stariAdminPid > 0) {
    let ziv = false;
    try {
      process.kill(stariAdminPid, 0);
      ziv = true;
    } catch {
      // proces ne postoji: mrtav pid fajl je ostatak od pada, NE blokira start i ne dira se
      // (nije ovog procesa fajl da ga brise).
    }
    if (ziv) {
      await odbijStart(
        `stari admin most (pid ${stariAdminPid}) jos radi na drugom tokenu. Skloni posao admin-bot ` +
          "da se jednobotni rezim ne sudari sa njim na istom Telegram tokenu.",
      );
    }
  }
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

log(
  `most (${TIP}) radi kao @${botIme}, pogon ${glavna.ai.pogon}, offset ${glavna.stanje.offset}, u redu ${glavna.stanje.red.length}, sesija ${glavna.stanje.sesija ?? "(nova)"}` +
    (JEDNOBOTNI ? `, jednobotni rezim: isti bot vozi klijenta i admina (OLX_MOST_ADMIN_TG_ID=${ADMIN_TG_ID})` : ""),
);
// Ime dogadjaja se NAMJERNO ne mijenja iako most nije cuvar: znaci "nadzorni proces je startovao"
// i tako ga cita analiza flote (scripts/resursi.mjs).
upisiDogadjaj(glavna, { dogadjaj: "cuvar-start" });
if ([...uloge.values()].some((u) => u.stanje.red.length > 0)) void radnik(); // sto je ostalo od proslog pokretanja

// ---- minutni tik: nocni rez konteksta i preuzimanje svjezeg .env ----
// unref?.(): proces zivi od glavne petlje (i od zive sesije, dok postoji), tajmer ga ne smije
// drzati u --jednom rezimu poslije zavrsetka posla.
function tikMinute() {
  if (gasenje) return;
  const sad = new Date();

  for (const u of uloge.values()) {
    // `radnikAktivan` se NAMJERNO ne dodaje ovdje: sjecenje sesije JEDNE uloge (nocni rez, idle,
    // svjez .env) dok DRUGA uloga vodi potez preko globalnog radnik() je bezopasno, jer su to dva
    // razlicita procesa djeteta. `u.radi` vec kaze da je OVA konkretna uloga u potezu.
    const zauzet = u.radi || u.stanje.red.length > 0 || albumi.size > 0;

    // telemetrija resursa: gusce uzorkovanje dok je sesija ziva, rjedje dok je mirna (nema sesije).
    if (RESURSI_UKLJUCENO) {
      const mirno = u.sesija === null;
      const trenutniInterval = mirno ? RESURSI_INTERVAL_STRAZA_MIN : RESURSI_INTERVAL_MIN;
      const pomak = mirno ? RESURSI_POMAK_STRAZA : RESURSI_POMAK_AKTIVNO;
      const minutaOdEpoha = Math.floor(Date.now() / 60_000);
      if (trebaLiUzorkovati({ minutaOdEpoha, intervalMin: trenutniInterval, pomak, zadnjaUzorkovanaMinuta: u.zadnjaUzorkovanaMinuta })) {
        u.zadnjaUzorkovanaMinuta = minutaOdEpoha;
        void uzmiUzorak(u, { intervalMin: trenutniInterval }, u.sesija ? u.sesija.dijete.pid : null);
      }
    }

    // Vanjski zahtjev za svjez .env (npr. nov OLX_TOKEN iz onboardinga): za razliku od
    // cuvar-sesije.mjs, ovdje NEMA restarta procesa koji bi ga sam dici nazad, pa most mora
    // primijeniti novu vrijednost u vlastitom process.env i sam ugasiti sesiju koja je radila bez
    // nje. Kad je uloga zauzeta, njen zahtjev se NE dira: potez u toku se ne smije presjeci na
    // pola, fajl ceka sljedecu minutu.
    if (existsSync(u.restartZahtjev) && !zauzet) {
      let razlog = "vanjski zahtjev";
      try {
        razlog = readFileSync(u.restartZahtjev, "utf8").trim() || razlog;
      } catch {
        // fajl je nestao ili je necitljiv: primjena ide dalje, razlog ostaje opsti
      }
      try {
        unlinkSync(u.restartZahtjev);
      } catch {
        // ako se ne moze obrisati, zahtjev se ne vrti u krug: ignorise se dalje
      }
      osvjeziEnvIzFajla();
      // Sesija koja je radila bez svjezeg tokena nema upotrebljiv kontekst za nastavak.
      ugasiSesijuBezResuma(u, razlog);
      log(`svjez .env primijenjen (${razlog}), sesija ugasena bez --resume`);
    }

    if (trebaLiNocniRez({ sad, restartSat: RESTART_SAT, zadnjiNocni: u.zadnjiNocni, zauzet })) {
      // Upisano PRVO, prije samog posla: sprjecava da se rez ponovi vise puta u istom danu ako
      // vise provjera padne u isti sat.
      u.zadnjiNocni = lokalniDatum(sad);
      nocniRez(u);
    }
  }
}
setInterval(tikMinute, 60_000).unref?.();

while (!gasenje) {
  let noviji;
  try {
    // Offset pripada TOKENU, dakle GLAVNOJ ulozi (vlasniku bot tokena), ne svakoj ulozi
    // pojedinacno: u fazi C drugi unos u mapi deli isti token i isti offset preko `glavna`, ne
    // dobija svoj.
    noviji = await tg("getUpdates", {
      offset: glavna.stanje.offset,
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
    const odluka = poruka ? odlukaPoruke(poruka, pristup, botIme, ADMIN_TG_ID) : { prihvacena: false, uloga: null };
    if (poruka && odluka.prihvacena) {
      const tekst = (poruka.text ?? poruka.caption ?? "").trim();
      if (tekst.startsWith("/")) {
        log(`komanda ${tekst.split(" ")[0]} preskocena`); // komande ne idu u sesiju
      } else {
        // Uslov sadrzi i JEDNOBOTNI: u dvobotnom rezimu je ADMIN_TG_ID prazan, pa odlukaPoruke
        // uvijek vraca "klijent", ali kad je TIP admin-bot onda je `glavna` BAS admin uloga (svoj
        // proces, svoj token). Bez ovog uslova bi se dvobotni admin most pokusao rutirati na
        // adminUnos, koji u tom rezimu ne postoji (null) - ovako dvobotni rezim ostaje bajt za
        // bajt isti, a jednobotni ide na pravi cilj.
        const cilj = JEDNOBOTNI && odluka.uloga === "admin-bot" ? adminUnos : glavna;
        const slika = await skiniFoto(cilj, poruka);
        if (tekst || slika) {
          if (JEDNOBOTNI) log(`poruka iz chata ${poruka.chat.id} rutirana na ulogu ${cilj.tip}`);
          ubaci(cilj, poruka.chat.id, tekst, slika ? [slika] : [], poruka.media_group_id ?? null);
        }
      }
    } else if (poruka) {
      log(`ispusteno: chat ${poruka.chat?.id}, od ${poruka.from?.id}`);
    }
    // Offset se pomjera tek kad je poruka obradjena do reda: pad prije ovoga znaci da je
    // Telegram i dalje drzi i dostavlja je ponovo.
    glavna.stanje = { ...glavna.stanje, offset: u.update_id + 1 };
    sacuvaj(glavna);
  }

  if (JEDNOM) {
    // radnikAktivan pokriva prozor izmedju "stavka je u redu" i "radnik je stigao da je uzme":
    // bez njega bi drain provjera mogla proci kroz sve redove PRAZNE (radnik je jos u pripremi,
    // npr. na dinamickom importu) i probno pokretanje bi zavrsilo prije nego je posao stvarno
    // odradjen.
    while (radnikAktivan || [...uloge.values()].some((u) => u.stanje.red.length > 0) || albumi.size > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const u of uloge.values()) {
      otkaziIdle(u);
      u.sesija?.dijete.kill("SIGTERM");
    }
    break;
  }
}
