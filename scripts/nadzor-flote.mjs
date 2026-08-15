#!/usr/bin/env bun
// ADMIN flotni posao (bez modela): SVAKI DAN obidje sve klonove flote sa admin masine, skenira
// disk svakog klona (scripts/lib/disk.mjs), upisuje dnevni uzorak stanja masine (CPU/PSI/memorija
// preko scripts/lib/cpu.mjs i scripts/lib/resursi.mjs) i, SVAKA 3 DANA, pokrece agregiranu analizu
// flote (scripts/lib/analiza-flote.mjs) koju upisuje u fajl i salje adminu sazetak na Telegram.
//
// bun scripts/nadzor-flote.mjs [--svi <root>]
//
// Spisak klonova dolazi iz scripts/lib/klonovi.mjs (nadjiKlonove): prioritet cliRoot (--svi) >
// OLX_KLIJENTI_ROOT (env) > popis (~/.olx-klijenti.txt / OLX_KLIJENTI_POPIS). Ako izvor spiska
// klonova uopste nije nadjen, posao zavrsava sa exit 1 BEZ pokusaja skeniranja bilo cega. Prazna
// flota (nema greske, samo nema klonova) zavrsava sa exit 0 bez slanja Telegram poruke.
//
// Skeniranje pojedinacnog klona je izolovano: pad jednog klona (dozvole, tajmaut) se upisuje kao
// greska u disk-YYYY-MM.jsonl tog klona i posao nastavlja na sljedeci, isto kao sto vrijedi za sve
// flotne poslove u ovom repou (vidi olx-dokumentacija/arhitektura.md).
//
// Dvije nezavisne faze na svaki poziv:
//   Korak A (svaki put): disk sken po klonu, ugnijezdene kopije sirom flote, dnevni uzorak stanja
//     masine (CPU/PSI/memorija/load) u <nadzorDir>/masina-YYYY-MM.jsonl, ciscenje starih fajlova.
//     Ovdje se takodje JEDNOM za cijelu flotu pita schtasks/launchctl i po klonu upisuje status
//     potpunosti zakazanih poslova (koji sufiks fali, ako ijedan fali) u disk red. NE salje
//     Telegram poruku.
//   Korak B (samo kad je proslo >= 3 dana od zadnje analize): agregira dnevne redove u nalaze
//     preko analizirajFlotu(), upisuje ih u <nadzorDir>/analiza-YYYY-MM-DD.md i salje sazetak
//     adminu na Telegram.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { procitajEnv } from "./lib/envfajl.mjs";
import { nadjiKlonove, pronadjiUgnijezdeneKopije } from "./lib/klonovi.mjs";
import { obidjiDirektorijum, sazmiSkeniranje, velicinaFolderaBrzo } from "./lib/disk.mjs";
import { izmjeriCpuMasine, citajPsi } from "./lib/cpu.mjs";
import { analizirajFlotu, izracunajStatusPoslova } from "./lib/analiza-flote.mjs";
import {
  agregiraj,
  citajRedove,
  ocistiStareResurse,
  putanjaDiska,
  putanjaResursa,
  upisiRed,
  uzorakMasine,
} from "./lib/resursi.mjs";

// Vremenski budzet po klonu: klon koji visi (folder sa cudnim dozvolama, mrezni disk koji ne
// odgovara) ne smije zaustaviti obilazak cijele flote.
const BUDZET_PO_KLONU_MS = 30_000;

// Koliko dana mora proci izmedju dvije analize flote (Korak B).
const DANA_IZMEDJU_ANALIZA = 3;

// Koliko dana se cuva analiza-YYYY-MM-DD.md u nadzorDir prije brisanja.
const DANA_CUVANJA_ANALIZE = 180;

// Top-level entryji korijena klona koji NE idu u "ostalo_klona" (imaju svoju kategoriju gore, ili
// su irelevantni/vec pokriveni posebno).
const ISKLJUCENO_TOP = new Set([".git", ".olx-pik", ".claude-runtime", ".claude-runtime-admin", "node_modules", "dist"]);

// Prva komponenta relativne putanje unutar .olx-pik -> izlazna kategorija. Sve sto nije ovdje
// (ukljucujuci top-level fajl bez "/") ide u olx_pik_ostalo.
const MAPA_OLX_PIK_PREFIKSA = {
  snapshots: "olx_pik_snapshots",
  "arhiva-artikala": "olx_pik_arhiva",
  "klijent-fajlovi": "olx_pik_klijent_fajlovi",
  slike: "olx_pik_slike",
  konkurenti: "olx_pik_konkurenti",
  resursi: "olx_pik_resursi",
};

// ---- zakazani poslovi: sirovi upit (schtasks/launchctl), JEDNOM po pokretanju cijelog nadzora ----
//
// Svi klonovi zive na istoj admin masini (vidi olx-dokumentacija/arhitektura.md), pa je izlistavanje
// zakazanih poslova JEDAN upit operativnom sistemu za CIJELU flotu, ne po klonu (isti princip kao
// provjeri-klon.mjs, samo sto se ovdje radi jednom za sve klonove umjesto po jednom klonu). Parsiranje
// sufiksa posla po klonu (koje ime fali) je cista funkcija u scripts/lib/analiza-flote.mjs
// (izracunajStatusPoslova), ovdje samo I/O: pokreni komandu, vrati sirove redove ili `null`.
//
// Nikad ne baca: komanda koja ne postoji (Linux, ili masina bez schtasks/launchctl u PATH-u) ili koja
// padne se hvata i vraca `null` ("status poslova danas nepoznat za cijelu flotu"), obilazak flote se
// ne prekida.
function citajRedoveZadataka() {
  try {
    if (process.platform === "win32") {
      const izlaz = execFileSync("schtasks", ["/query", "/fo", "csv"], { encoding: "utf8", stdio: "pipe" });
      return izlaz.split("\n");
    }
    const izlaz = execFileSync("launchctl", ["list"], { encoding: "utf8", stdio: "pipe" });
    return izlaz.split("\n");
  } catch {
    return null;
  }
}

// ---- formatiranje ----

function fmtDatumKratko(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function datumIso(ts) {
  return typeof ts === "string" && ts.length >= 10 ? ts.slice(0, 10) : "?";
}

// ---- putanje resursa/diska razrijesene relativno na korijen KLONA (ne na cwd ovog procesa) ----
// putanjaDiska/putanjaResursa vracaju relativnu putanju osim ako OLX_RESURSI_DIR nije apsolutan;
// ovaj proces se pokrece sa admin masine, cwd nije korijen klona kojeg obradjuje.

function putanjaZaKlon(fn, korijenKlona, env, datum) {
  const p = fn(env, datum);
  return isAbsolute(p) ? p : join(korijenKlona, p);
}

function resursiDirZaKlon(korijenKlona, env) {
  const dir = env?.OLX_RESURSI_DIR || ".olx-pik/resursi";
  return isAbsolute(dir) ? dir : join(korijenKlona, dir);
}

// Mjeseci (kao Date, prvi dan mjeseca) koje treba procitati da se pokrije [periodOd, periodDo].
function mjeseciUPeriodu(periodOd, periodDo) {
  const rezultat = [];
  const pocetak = new Date(Date.parse(periodOd));
  const kraj = new Date(Date.parse(periodDo));
  let d = new Date(pocetak.getFullYear(), pocetak.getMonth(), 1);
  while (d.getFullYear() < kraj.getFullYear() || (d.getFullYear() === kraj.getFullYear() && d.getMonth() <= kraj.getMonth())) {
    rezultat.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return rezultat;
}

function putanjeMasinaZaPeriod(nadzorDir, periodOd, periodDo) {
  return mjeseciUPeriodu(periodOd, periodDo).map((d) => {
    const godina = d.getFullYear();
    const mjesec = String(d.getMonth() + 1).padStart(2, "0");
    return join(nadzorDir, `masina-${godina}-${mjesec}.jsonl`);
  });
}

function unutarPerioda(ts, periodOd, periodDo) {
  if (typeof ts !== "string") return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= Date.parse(periodOd) && t <= Date.parse(periodDo);
}

// ---- sagradnja svojFajlovi mape za jedan klon ----

function skenirajIDodaj(niz, apsolutniFolder, prefiks) {
  for (const f of obidjiDirektorijum(apsolutniFolder)) {
    niz.push({ ...f, putanjaOdKorijena: `${prefiks}/${f.relativnaPutanja}` });
  }
}

function sagradiSvojFajlovi(korijenKlona) {
  const svojFajlovi = {
    olx_pik_snapshots: [],
    olx_pik_arhiva: [],
    olx_pik_klijent_fajlovi: [],
    olx_pik_slike: [],
    olx_pik_konkurenti: [],
    olx_pik_resursi: [],
    olx_pik_ostalo: [],
    transkripti: [],
    telegram_inbox: [],
    ostalo_klona: [],
  };

  // .olx-pik: JEDAN poziv obidjiDirektorijum, potom razvrstavanje po prvoj komponenti putanje.
  for (const f of obidjiDirektorijum(join(korijenKlona, ".olx-pik"))) {
    const prviDio = f.relativnaPutanja.includes("/") ? f.relativnaPutanja.split("/")[0] : null;
    const kategorija = (prviDio && MAPA_OLX_PIK_PREFIKSA[prviDio]) || "olx_pik_ostalo";
    svojFajlovi[kategorija].push({ ...f, putanjaOdKorijena: `.olx-pik/${f.relativnaPutanja}` });
  }

  skenirajIDodaj(svojFajlovi.transkripti, join(korijenKlona, ".claude-runtime", "projects"), ".claude-runtime/projects");
  skenirajIDodaj(
    svojFajlovi.transkripti,
    join(korijenKlona, ".claude-runtime-admin", "projects"),
    ".claude-runtime-admin/projects",
  );

  skenirajIDodaj(
    svojFajlovi.telegram_inbox,
    join(korijenKlona, ".claude-runtime", "channels", "telegram", "inbox"),
    ".claude-runtime/channels/telegram/inbox",
  );
  skenirajIDodaj(
    svojFajlovi.telegram_inbox,
    join(korijenKlona, ".claude-runtime-admin", "channels", "telegram", "inbox"),
    ".claude-runtime-admin/channels/telegram/inbox",
  );

  // Preostali top-level entryji korijena klona (src, runtime, package.json, KLIJENT.md, itd).
  // NE u try/catch ovdje namjerno: ako korijen klona sam ne moze biti procitan (dozvole), to je
  // razlog da CIJELI sken ovog klona padne (poziva ga obidjiJedanKlon unutar svog try/catch).
  const vrhUlazi = readdirSync(korijenKlona, { withFileTypes: true });
  for (const ulaz of vrhUlazi) {
    if (ISKLJUCENO_TOP.has(ulaz.name)) continue;
    const apsolutna = join(korijenKlona, ulaz.name);

    let jeSimlink = false;
    let jeDir = false;
    let jeFajl = false;
    try {
      jeSimlink = typeof ulaz.isSymbolicLink === "function" && ulaz.isSymbolicLink();
      jeDir = typeof ulaz.isDirectory === "function" && ulaz.isDirectory();
      jeFajl = typeof ulaz.isFile === "function" && ulaz.isFile();
    } catch {
      continue;
    }
    if (jeSimlink) continue; // ne prati simbolicke linkove, isti princip kao obidjiDirektorijum

    if (jeDir) {
      skenirajIDodaj(svojFajlovi.ostalo_klona, apsolutna, ulaz.name);
    } else if (jeFajl) {
      try {
        const stat = statSync(apsolutna);
        svojFajlovi.ostalo_klona.push({
          relativnaPutanja: ulaz.name,
          apsolutnaPutanja: apsolutna,
          velicinaBajta: stat.size,
          mtimeMs: stat.mtimeMs,
          putanjaOdKorijena: ulaz.name,
        });
      } catch {
        // fajl nestao izmedju readdir i stat (race), preskoci
      }
    }
  }

  return svojFajlovi;
}

// ---- prethodni disk red (za odVremena, "sta je novo od proslog skena") ----

function nadjiPrethodniRed(korijenKlona, env, imeKlona, sadaMs) {
  const sada = new Date(sadaMs);
  const prosliMjesec = new Date(sada.getFullYear(), sada.getMonth() - 1, 1);
  const putanje = [
    putanjaZaKlon(putanjaDiska, korijenKlona, env, sada),
    putanjaZaKlon(putanjaDiska, korijenKlona, env, prosliMjesec),
  ];
  const redovi = citajRedove(putanje)
    .filter((r) => r.klon === imeKlona && typeof r.ts === "string" && Date.parse(r.ts) < sadaMs)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return redovi.length > 0 ? redovi[redovi.length - 1] : null;
}

// ---- obilazak jednog klona (disk sken + upis + ciscenje) ----

async function obidjiJedanKlon(korijenKlona, env, imeKlona, pocetakMs, poslovi) {
  const prethodniRed = nadjiPrethodniRed(korijenKlona, env, imeKlona, pocetakMs);
  const odVremena = prethodniRed ? new Date(Date.parse(prethodniRed.ts)) : null;

  const svojFajlovi = sagradiSvojFajlovi(korijenKlona);
  const teskeKategorije = {
    node_modules: await velicinaFolderaBrzo(join(korijenKlona, "node_modules")),
    dist: await velicinaFolderaBrzo(join(korijenKlona, "dist")),
  };

  const rezultatSken = sazmiSkeniranje({ svojFajlovi, teskeKategorije, odVremena });
  const trajanjeMs = Date.now() - pocetakMs;

  const red = {
    ts: new Date().toISOString(),
    klon: imeKlona,
    // shema 2: dodano polje `poslovi` (status potpunosti zakazanih poslova, vidi
    // izracunajStatusPoslova u lib/analiza-flote.mjs). Stariji redovi (shema 1) ga nemaju, sto
    // analizirajFlotu tretira isto kao poslovi.poznato === false (tiho preskace nalaz).
    shema: 2,
    kategorije: rezultatSken.kategorije,
    ukupno_bajta: rezultatSken.ukupnoBajta,
    novih_fajlova_broj: rezultatSken.novihFajlovaBroj,
    novih_fajlova_bajta: rezultatSken.novihFajlovaBajta,
    top_novi: rezultatSken.topNovi,
    trajanje_skena_ms: trajanjeMs,
    poslovi,
    greska: null,
  };

  upisiRed(putanjaZaKlon(putanjaDiska, korijenKlona, env, new Date()), red);
  try {
    ocistiStareResurse(resursiDirZaKlon(korijenKlona, env), { cuvajMjeseci: 12 });
  } catch {
    // best effort, isti princip kao ocistiStareResurse samo (klon bez zivog cuvara nema ko drugi
    // da ovo radi, ali jedan neuspjeh ne smije obarati obilazak)
  }

  return { imeKlona, red, uspjeh: true };
}

function redGreske(imeKlona, trajanjeMs, poruka, poslovi) {
  return {
    ts: new Date().toISOString(),
    klon: imeKlona,
    shema: 2,
    kategorije: null,
    ukupno_bajta: null,
    novih_fajlova_broj: null,
    novih_fajlova_bajta: null,
    top_novi: null,
    trajanje_skena_ms: trajanjeMs,
    poslovi,
    greska: poruka,
  };
}

/** Obavija obidjiJedanKlon u vremenski budzet + try/catch: pad ili tajmaut ovog klona nikad ne
 * obara obilazak flote, samo se upisuje kao greska i posao nastavlja na sljedeci klon. */
async function obidjiKlonSaBudzetom(korijenKlona, redoviZadataka) {
  const imeKlona = basename(korijenKlona);
  let env = {};
  try {
    env = procitajEnv(join(korijenKlona, ".env")) ?? {};
  } catch {
    env = {};
  }

  // Status zakazanih poslova se racuna PRIJE budzetiranog disk skena: cist i brz (jedan
  // existsSync + cista funkcija nad vec procitanim redovima), pa se upisuje u red bez obzira da
  // li disk sken tog klona uspije, padne ili istekne (redGreske ga takodje nosi).
  let imaAdminRuntime = false;
  try {
    imaAdminRuntime = existsSync(join(korijenKlona, ".claude-runtime-admin"));
  } catch {
    imaAdminRuntime = false;
  }
  const imaStanjeRepo = typeof env?.OLX_STANJE_REPO === "string" && env.OLX_STANJE_REPO.trim() !== "";
  const poslovi = izracunajStatusPoslova({ redovi: redoviZadataka, imeKlona, imaAdminRuntime, imaStanjeRepo });

  const pocetakMs = Date.now();

  let tajmautTajmer;
  const tajmautPromise = new Promise((resolve) => {
    tajmautTajmer = setTimeout(() => resolve({ vrsta: "tajmaut" }), BUDZET_PO_KLONU_MS);
  });

  let ishod;
  try {
    const posaoPromise = obidjiJedanKlon(korijenKlona, env, imeKlona, pocetakMs, poslovi).catch((e) => ({
      vrsta: "greska",
      poruka: e?.message ?? String(e),
    }));
    ishod = await Promise.race([posaoPromise, tajmautPromise]);
  } finally {
    clearTimeout(tajmautTajmer);
  }

  if (ishod?.vrsta === "tajmaut" || ishod?.vrsta === "greska") {
    const trajanjeMs = Date.now() - pocetakMs;
    const poruka = ishod.vrsta === "tajmaut" ? `tajmaut nakon ${Math.round(BUDZET_PO_KLONU_MS / 1000)}s` : ishod.poruka;
    const red = redGreske(imeKlona, trajanjeMs, poruka, poslovi);
    try {
      upisiRed(putanjaZaKlon(putanjaDiska, korijenKlona, env, new Date()), red);
    } catch {
      // best effort
    }
    try {
      ocistiStareResurse(resursiDirZaKlon(korijenKlona, env), { cuvajMjeseci: 12 });
    } catch {
      // best effort
    }
    return { imeKlona, red, uspjeh: false };
  }

  return ishod;
}

function linijaSazetkaKlona(r) {
  if (!r.uspjeh) {
    return `${r.imeKlona}: GRESKA (${r.red.greska}), trajanje ${r.red.trajanje_skena_ms} ms`;
  }
  return `${r.imeKlona}: ukupno ${r.red.ukupno_bajta} bajta, trajanje ${r.red.trajanje_skena_ms} ms`;
}

// ---- Telegram (fetch direktno, isti obrazac kao scripts/ai-runda.sh / scripts/backup-nadzor.sh) ----

async function posaljiAdminu(tekst) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    console.log("(Telegram token/chat id nisu postavljeni, poruka se ne salje, ispisujem je ovdje:)");
    console.log(tekst);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tekst }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.ok !== true) console.error(`Telegram poruka nije poslana: ${j?.description ?? res.status}`);
  } catch (e) {
    console.error(`Telegram poruka nije poslana: ${e.message}`);
  }
}

// ---- ciscenje starih analiza (analiza-YYYY-MM-DD.md, lokalna, ne dira resursi.mjs) ----

function ocistiStareAnalize(nadzorDir, { cuvajDana = DANA_CUVANJA_ANALIZE, sada = () => new Date() } = {}) {
  let obrisano = 0;
  try {
    const danasMs = sada().getTime();
    for (const ime of readdirSync(nadzorDir)) {
      const m = ime.match(/^analiza-(\d{4})-(\d{2})-(\d{2})\.md$/);
      if (!m) continue;
      const putanja = join(nadzorDir, ime);
      try {
        const stat = statSync(putanja);
        const starostDana = (danasMs - stat.mtimeMs) / 86_400_000;
        if (starostDana > cuvajDana) {
          unlinkSync(putanja);
          obrisano += 1;
        }
      } catch {
        // jedan fajl koji se ne da procitati/obrisati ne smije prekinuti ciscenje ostalih
      }
    }
  } catch {
    // nadzorDir ne postoji ili se ne moze citati, best effort
  }
  return { obrisano };
}

// ---- resolucija nadzorDir ----

function resolucijaNadzorDir({ izvor, izvorPutanja, env = process.env, home = homedir }) {
  const override = env?.OLX_NADZOR_DIR;
  if (typeof override === "string" && override.trim() !== "") {
    return { dir: override.trim(), izvorNadzora: "env override (OLX_NADZOR_DIR)" };
  }
  if (izvor === "root") {
    return { dir: join(izvorPutanja, "nadzor"), izvorNadzora: `root-podfolder (izvorPutanja: ${izvorPutanja})` };
  }
  return { dir: join(home(), "olx-nadzor"), izvorNadzora: "homedir-fallback (izvor popisa nije root)" };
}

// ---- CLI ulaz ----

function zastavica(ime, ostatak, default_) {
  const i = ostatak.indexOf(`--${ime}`);
  if (i === -1) return default_;
  return ostatak[i + 1];
}

function usage() {
  console.error("Upotreba:");
  console.error("  bun scripts/nadzor-flote.mjs [--svi <root>]");
}

async function main() {
  const [, , ...ostatak] = process.argv;
  const cliRoot = zastavica("svi", ostatak, null);
  if (ostatak.includes("--svi") && !cliRoot) {
    console.error("--svi trazi putanju direktorija, npr. --svi ~/olx-klonovi");
    usage();
    process.exit(1);
  }

  const { klonovi, izvor, izvorPutanja, greska } = nadjiKlonove({ cliRoot });

  if (greska !== null) {
    console.error(`Nadzor flote: izvor spiska klonova nije nadjen (${greska})`);
    await posaljiAdminu(`Nadzor flote: izvor spiska klonova nije nadjen (${greska})`);
    process.exit(1);
    return;
  }

  if (klonovi.length === 0) {
    console.log(`Nadzor flote: izvor spiska klonova (${izvor}, ${izvorPutanja}) je prazan, nema klonova za skeniranje.`);
    return;
  }

  const imena = klonovi.map((p) => basename(p));
  console.log(`Izvor spiska klonova: ${izvor} (${izvorPutanja}), ${klonovi.length} klonova: ${imena.join(", ")}`);

  const { dir: nadzorDir, izvorNadzora } = resolucijaNadzorDir({ izvor, izvorPutanja });
  console.log(`Nadzor dir: ${izvorNadzora} -> ${nadzorDir}`);

  try {
    mkdirSync(nadzorDir, { recursive: true });
  } catch (e) {
    const poruka = `Nadzor flote: ne mogu napraviti nadzor dir ${nadzorDir} (${e.message})`;
    console.error(poruka);
    await posaljiAdminu(poruka);
    process.exit(1);
    return;
  }

  // ---- Korak A: dnevna kolekcija (svaki put) ----

  const redoviZadataka = citajRedoveZadataka();
  if (redoviZadataka === null) {
    console.log("Zakazani poslovi: schtasks/launchctl upit nije uspio, status poslova danas nepoznat za cijelu flotu.");
  } else {
    console.log(`Zakazani poslovi: upit uspio (${redoviZadataka.length} redova).`);
  }

  const rezultatiDiska = [];
  for (const korijenKlona of klonovi) {
    const rezultat = await obidjiKlonSaBudzetom(korijenKlona, redoviZadataka);
    rezultatiDiska.push(rezultat);
    console.log(linijaSazetkaKlona(rezultat));
  }

  const ugnijezdeneKopije = pronadjiUgnijezdeneKopije(klonovi);
  if (ugnijezdeneKopije.length > 0) {
    console.log(
      `Ugnijezdene kopije: ${ugnijezdeneKopije.map((u) => `${u.klon} (${u.putanja})`).join(", ")}`,
    );
  }

  const cpuStanjePutanja = join(nadzorDir, "cpu-stanje.json");
  let prethodnoCpuStanje = null;
  try {
    prethodnoCpuStanje = JSON.parse(readFileSync(cpuStanjePutanja, "utf8"));
  } catch {
    prethodnoCpuStanje = null;
  }

  const cpuRezultat = await izmjeriCpuMasine({ prethodniProcStat: prethodnoCpuStanje?.sirovProcStat ?? null });

  try {
    writeFileSync(
      cpuStanjePutanja,
      JSON.stringify({ ts: new Date().toISOString(), sirovProcStat: cpuRezultat.sirovProcStat }, null, 2),
      "utf8",
    );
  } catch {
    // best effort, ne obara posao
  }

  const psi = await citajPsi();
  const masina = await uzorakMasine();

  const sadaDatum = new Date();
  const masinaPutanja = join(
    nadzorDir,
    `masina-${sadaDatum.getFullYear()}-${String(sadaDatum.getMonth() + 1).padStart(2, "0")}.jsonl`,
  );
  const masinaRed = {
    ts: sadaDatum.toISOString(),
    ukupno_bajta: masina.ukupnoBajta,
    slobodno_bajta: masina.slobodnoBajta,
    swap_ukupno_bajta: masina.swapUkupnoBajta,
    swap_koristeno_bajta: masina.swapKoristenoBajta,
    load1: masina.load1,
    load5: masina.load5,
    load15: masina.load15,
    cpu_zauzeto_pct: cpuRezultat.zauzetoPct,
    cpu_izvor: cpuRezultat.izvor,
    psi_cpu_some_avg60: psi.cpu?.some?.avg60 ?? null,
    psi_memory_some_avg60: psi.memory?.some?.avg60 ?? null,
    psi_io_some_avg60: psi.io?.some?.avg60 ?? null,
  };
  upisiRed(masinaPutanja, masinaRed);
  console.log(`Masina uzorak upisan: cpu ${cpuRezultat.zauzetoPct ?? "nepoznato"}% (izvor: ${cpuRezultat.izvor ?? "nepoznato"}).`);

  try {
    ocistiStareResurse(nadzorDir, { cuvajMjeseci: 12 });
  } catch {
    // best effort
  }
  ocistiStareAnalize(nadzorDir);

  // ---- Korak B: uslovna analiza (svaka 3 dana) ----

  const markerPutanja = join(nadzorDir, "zadnja-analiza.json");
  let markerTs = null;
  try {
    markerTs = JSON.parse(readFileSync(markerPutanja, "utf8"))?.ts ?? null;
    if (typeof markerTs !== "string" || !Number.isFinite(Date.parse(markerTs))) markerTs = null;
  } catch {
    markerTs = null;
  }

  const sadaMs = Date.now();
  const pragMs = DANA_IZMEDJU_ANALIZA * 86_400_000;
  const trebaAnalizu = markerTs === null || sadaMs - Date.parse(markerTs) >= pragMs;

  if (!trebaAnalizu) {
    const proteklihDana = (sadaMs - Date.parse(markerTs)) / 86_400_000;
    const preostaloDana = DANA_IZMEDJU_ANALIZA - proteklihDana;
    console.log(
      `Analiza preskocena, zadnja bila prije ${proteklihDana.toFixed(1)} dana, sljedeca za ${preostaloDana.toFixed(1)} dana.`,
    );
    return;
  }

  const periodOd = markerTs ?? new Date(sadaMs - pragMs).toISOString();
  const periodDo = new Date(sadaMs).toISOString();

  const podaciPoKlonu = {};
  const sviResursiRedoviFlote = [];

  for (const korijenKlona of klonovi) {
    const imeKlona = basename(korijenKlona);
    let env = {};
    try {
      env = procitajEnv(join(korijenKlona, ".env")) ?? {};
    } catch {
      env = {};
    }

    const diskPutanje = mjeseciUPeriodu(periodOd, periodDo).map((d) => putanjaZaKlon(putanjaDiska, korijenKlona, env, d));
    const diskRedovi = citajRedove(diskPutanje)
      .filter((r) => r.klon === imeKlona && unutarPerioda(r.ts, periodOd, periodDo))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const resursiPutanje = mjeseciUPeriodu(periodOd, periodDo).map((d) => putanjaZaKlon(putanjaResursa, korijenKlona, env, d));
    const resursiRedoviKlona = citajRedove(resursiPutanje).filter(
      (r) => r.klon === imeKlona && unutarPerioda(r.ts, periodOd, periodDo),
    );
    sviResursiRedoviFlote.push(...resursiRedoviKlona);

    podaciPoKlonu[imeKlona] = { diskRedovi, memorijaAgregat: agregiraj(resursiRedoviKlona) };
  }

  const budjenja = sviResursiRedoviFlote
    .filter((r) => r.dogadjaj === "budjenje")
    .map((r) => ({ ts: r.ts, klon: r.klon, hladniStartMs: r.hladni_start_ms ?? null }));

  const masinaPutanjeZaPeriod = putanjeMasinaZaPeriod(nadzorDir, periodOd, periodDo);
  const masinaRedoviZaPeriod = citajRedove(masinaPutanjeZaPeriod).filter((r) => unutarPerioda(r.ts, periodOd, periodDo));
  const masinaCpuUzorci = masinaRedoviZaPeriod.map((r) => ({ ts: r.ts, zauzetoPct: r.cpu_zauzeto_pct }));

  const rezultatAnalize = analizirajFlotu({
    periodOd,
    periodDo,
    podaciPoKlonu,
    masinaRedovi: masinaRedoviZaPeriod,
    budjenja,
    masinaCpuUzorci,
    ugnijezdeneKopije,
  });

  const analizaPutanja = join(nadzorDir, `analiza-${fmtDatumKratko(new Date())}.md`);
  try {
    writeFileSync(analizaPutanja, rezultatAnalize.tekst, "utf8");
  } catch (e) {
    console.error(`Analiza flote: upis ${analizaPutanja} nije uspio (${e.message})`);
  }

  const poruka = `Analiza flote (${datumIso(periodOd)} do ${datumIso(periodDo)}):\n\n${rezultatAnalize.sazetak}`;
  await posaljiAdminu(poruka);

  try {
    writeFileSync(markerPutanja, JSON.stringify({ ts: periodDo }, null, 2), "utf8");
  } catch {
    // best effort, ali ako padne sljedeci poziv ce ponovo pokusati analizu (period ce se preklopiti)
  }

  console.log(`Analiza izvrsena i upisana u ${analizaPutanja}.`);
}

await main();
