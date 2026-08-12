#!/usr/bin/env node
// CLI za telemetriju resursa (RSS memorije sesija/cuvara, stanje masine) koju uzorkuje
// scripts/cuvar-sesije.mjs preko scripts/lib/resursi.mjs. Ovaj fajl NISTA ne uzorkuje sam:
// samo cita zivo stanje (PID fajlovi + platformske sonde) i JSONL istoriju, pa formatira
// citljiv sazetak. Sva racunica (agregacija, RSS stabla, sonde) zivi u lib/resursi.mjs.
//
// Komande:
//   node scripts/resursi.mjs pregled [--svi <root-dir>]
//   node scripts/resursi.mjs izvjestaj [--dana N] [--svi <root-dir>]
//   node scripts/resursi.mjs dijagnostika
//
// Bez `--svi` radi iskljucivo NA TEKUCEM KLONU (KORIJEN ovog fajla). Sa `--svi <root-dir>`
// obradjuje SVAKI direktorij u `root-dir` koji ima podfolder `.olx-pik` (znak da je to klon).
//
// PID fajlove NIKAD ne izmisljamo: imena i format (goli broj + "\n") su potvrdjeni citanjem
// scripts/cuvar-sesije.mjs (SESIJA_PID_FAJL, PID_FAJL konstante). Bez PID fajla ili sa mrtvim
// procesom ovaj CLI kaze "ne radi" i ne pokusava nista drugo (ne trazi proces po cwd ni imenu).

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { procitajEnv } from "./lib/envfajl.mjs";
import { listajPodmapeSaOlxPik } from "./lib/klonovi.mjs";
import {
  agregiraj,
  citajProcese,
  citajRedove,
  dijagnostikaSondi,
  putanjaResursa,
  uzorakMasine,
  zbirStabla,
} from "./lib/resursi.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Imena PID fajlova, tacno kako ih pise scripts/cuvar-sesije.mjs (ne dirati taj fajl, samo
// citati): SESIJA_PID_FAJL je pid ZIVE sesije (dijete cuvara), PID_FAJL je pid samog cuvara.
const TIPOVI_SESIJA = [
  { tip: "klijent", sesijaPid: "sesija-klijent.pid", cuvarPid: "cuvar-sesije.pid" },
  { tip: "admin-bota", sesijaPid: "sesija-admin-bota.pid", cuvarPid: "cuvar-admin-bota.pid" },
];

// ---- sitne formatirajuce funkcije ----

function fmtBajta(bajta, jedinica) {
  if (bajta === null || bajta === undefined) return "nepoznato";
  if (jedinica === "GB") return `${(bajta / 1024 ** 3).toFixed(1)} GB`;
  return `${(bajta / 1024 ** 2).toFixed(1)} MB`;
}

function fmtBroj(v, decimale = 2) {
  return v === null || v === undefined ? "nepoznato" : v.toFixed(decimale);
}

function fmtTrajanje(ms) {
  if (!ms || ms <= 0) return "0min";
  const ukupnoMin = Math.floor(ms / 60_000);
  const dana = Math.floor(ukupnoMin / 1440);
  const sati = Math.floor((ukupnoMin % 1440) / 60);
  const minute = ukupnoMin % 60;
  const dijelovi = [];
  if (dana > 0) dijelovi.push(`${dana} dana`);
  if (sati > 0) dijelovi.push(`${sati}h`);
  if (minute > 0 || dijelovi.length === 0) dijelovi.push(`${minute}min`);
  return dijelovi.join(" ");
}

function fmtDatum(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtMasina(m) {
  const load = [m.load1, m.load5, m.load15].map((v) => fmtBroj(v)).join("/");
  return (
    `Masina: slobodno ~${fmtBajta(m.slobodnoBajta, "GB")} od ${fmtBajta(m.ukupnoBajta, "GB")}, ` +
    `swap koristeno ~${fmtBajta(m.swapKoristenoBajta, "MB")} od ${fmtBajta(m.swapUkupnoBajta, "MB")}, ` +
    `load ${load}`
  );
}

// ---- PID fajlovi (samo citanje, nikad trazenje po cwd/imenu) ----

function citajPid(putanja) {
  try {
    const pid = Number(readFileSync(putanja, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function procesZiv(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stanje jednog klona: za svaki tip sesije provjeri PID fajl sesije i PID fajl cuvara. Ako je
 * bar jedan ziv, `citajProcese()` se poziva TACNO JEDNOM (jedan platformski poziv za citav
 * klon), pa se isti snapshot dijeli izmedju zbirStabla (sesija, sa djecom) i direktnog RSS-a
 * pojedinacnog procesa (cuvar, bez djece, da se ne duplira sa RSS-om stabla sesije koju je
 * cuvar podigao).
 */
async function stanjeKlona(korijenKlona) {
  const olxPikDir = join(korijenKlona, ".olx-pik");
  const stavke = TIPOVI_SESIJA.map((t) => {
    const sesijaPidNum = citajPid(join(olxPikDir, t.sesijaPid));
    const cuvarPidNum = citajPid(join(olxPikDir, t.cuvarPid));
    return {
      tip: t.tip,
      sesijaPidNum,
      sesijaZiva: sesijaPidNum !== null && procesZiv(sesijaPidNum),
      cuvarPidNum,
      cuvarZiv: cuvarPidNum !== null && procesZiv(cuvarPidNum),
      stabloRssBajta: null,
      stabloBrojProcesa: null,
      cuvarRssBajta: null,
    };
  });

  const trebaSnapshot = stavke.some((s) => s.sesijaZiva || s.cuvarZiv);
  const procesi = trebaSnapshot ? await citajProcese() : null;

  for (const s of stavke) {
    if (s.sesijaZiva) {
      const stablo = procesi ? zbirStabla(procesi, s.sesijaPidNum) : null;
      s.stabloRssBajta = stablo?.ukupnoBajta ?? null;
      s.stabloBrojProcesa = stablo?.brojProcesa ?? null;
    }
    if (s.cuvarZiv) {
      const proces = procesi ? procesi.find((p) => p.pid === s.cuvarPidNum) : null;
      s.cuvarRssBajta = proces?.rssBajta ?? null;
    }
  }
  return stavke;
}

// Tanak poziv na scripts/lib/klonovi.mjs. Ponasanje MORA ostati identicno: root koji se ne moze
// citati i dalje javlja tacnu gresku na stderr i gasi proces (CLI kontekst, ne biblioteka), dok
// listajPodmapeSaOlxPik sam po sebi (biblioteka) samo vraca prazan niz i nikad ne baca. Zato se
// citljivost root direktorija provjerava ovdje (ista provjera kao ranije), a stvarno listanje i
// filtriranje po .olx-pik podfolderu radi zajednicki modul.
function listajKlonove(rootDir) {
  try {
    readdirSync(rootDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Ne mogu citati ${rootDir}: ${e.message}`);
    process.exit(1);
  }
  return listajPodmapeSaOlxPik(rootDir).map((putanja) => basename(putanja));
}

// ---- pregled ----

async function pregledJedan() {
  // .env klona se ucitava po specifikaciji (best effort); pregled trenutno nema polje koje
  // zavisi od njega (PID putanje su fiksne relativno na korijen), ucitava se radi
  // konzistentnosti sa izvjestaj komandom i eventualnim buducim poljima.
  procitajEnv(join(KORIJEN, ".env"));

  const ime = basename(KORIJEN);
  const stavke = await stanjeKlona(KORIJEN);
  const masina = await uzorakMasine();

  console.log(`Klon: ${ime}`);
  for (const s of stavke) {
    if (s.sesijaZiva) {
      console.log(
        `Sesija (${s.tip}): radi, pid ${s.sesijaPidNum}, stablo RSS ~${fmtBajta(s.stabloRssBajta, "MB")} ` +
          `(${s.stabloBrojProcesa ?? "nepoznato"} procesa)`,
      );
    } else {
      console.log(`Sesija (${s.tip}): ne radi`);
    }
  }
  for (const s of stavke) {
    if (s.cuvarZiv) {
      console.log(`Cuvar (${s.tip}): pid ${s.cuvarPidNum}, RSS ~${fmtBajta(s.cuvarRssBajta, "MB")}`);
    } else {
      console.log(`Cuvar (${s.tip}): ne radi`);
    }
  }
  console.log(fmtMasina(masina));
}

async function pregledSvi(rootDir) {
  const klonovi = listajKlonove(rootDir);
  if (klonovi.length === 0) {
    console.log(`Nema klonova (foldera sa .olx-pik) u ${rootDir}.`);
    return;
  }

  // Masina je ista za sve klonove na ovoj masini, uzorkuje se jednom.
  const masina = await uzorakMasine();
  console.log(fmtMasina(masina));
  console.log("");

  let zbirRssBajta = 0;
  let zbirProcesa = 0;
  for (const ime of klonovi) {
    const korijenKlona = join(rootDir, ime);
    procitajEnv(join(korijenKlona, ".env")); // vidi napomenu u pregledJedan
    const stavke = await stanjeKlona(korijenKlona);

    const sesije = stavke
      .map((s) =>
        s.sesijaZiva
          ? `${s.tip} radi (~${fmtBajta(s.stabloRssBajta, "MB")}, ${s.stabloBrojProcesa ?? "nepoznato"} proc.)`
          : `${s.tip} ne radi`,
      )
      .join(", ");
    const cuvari = stavke
      .map((s) => (s.cuvarZiv ? `${s.tip} ~${fmtBajta(s.cuvarRssBajta, "MB")}` : `${s.tip} ne radi`))
      .join(", ");
    console.log(`${ime}: sesije [${sesije}] cuvari [${cuvari}]`);

    for (const s of stavke) {
      if (s.sesijaZiva && s.stabloRssBajta !== null) {
        zbirRssBajta += s.stabloRssBajta;
        zbirProcesa += s.stabloBrojProcesa ?? 0;
      }
    }
  }

  console.log("-".repeat(60));
  console.log(
    `Zbir: ${klonovi.length} klona, stablo RSS zivih sesija ukupno ~${fmtBajta(zbirRssBajta, "MB")} (${zbirProcesa} procesa).`,
  );
}

// ---- izvjestaj ----

/** Prvi dan svakog mjeseca izmedju `od` i `doDatuma`, uzastopno. */
function mjeseciURasponu(od, doDatuma) {
  const rezultat = [];
  let d = new Date(od.getFullYear(), od.getMonth(), 1);
  const zadnji = new Date(doDatuma.getFullYear(), doDatuma.getMonth(), 1);
  while (d <= zadnji) {
    rezultat.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return rezultat;
}

// putanjaResursa moze vratiti APSOLUTNU putanju (OLX_RESURSI_DIR postavljen na apsolutnu
// vrijednost, isto kao sto cuvar-sesije.mjs to dozvoljava pri pisanju). path.join na apsolutnu
// drugu komponentu je NE tretira kao korijen vec je ugnijezdi ispod prve, pa se ovdje eksplicitno
// preskace join kad je putanja vec apsolutna.
function putanjaResursaZaKlon(korijenKlona, env, datum) {
  const p = putanjaResursa(env, datum);
  return isAbsolute(p) ? p : join(korijenKlona, p);
}

function redoviZaPeriod(korijenKlona, env, dana) {
  const sada = new Date();
  const granicaTs = sada.getTime() - dana * 86_400_000;
  const od = new Date(granicaTs);
  const putanje = mjeseciURasponu(od, sada).map((datum) => putanjaResursaZaKlon(korijenKlona, env, datum));
  return citajRedove(putanje).filter((r) => r.ts && Date.parse(r.ts) >= granicaTs);
}

/** Pun tekstualni izvjestaj. `naslovOsnova` je npr. "Izvjestaj resursa: <klon>" ili "Zbirno (sva N klona)". */
function punIzvjestaj(naslovOsnova, agregat, dana) {
  const naslov =
    agregat.period.od && agregat.period.do
      ? `${naslovOsnova}, zadnjih ${dana} dana (${fmtDatum(agregat.period.od)} do ${fmtDatum(agregat.period.do)})`
      : `${naslovOsnova}, zadnjih ${dana} dana`;

  if (agregat.brojUzoraka === 0) {
    return `${naslov}\n\nNema podataka za ovaj period.`;
  }

  const linije = [naslov, ""];
  linije.push(
    `RSS cuvara: prosjek ~${fmtBajta(agregat.cuvarRss.prosjekBajta, "MB")}, peak ~${fmtBajta(agregat.cuvarRss.peakBajta, "MB")}`,
  );
  linije.push(
    `RSS stabla sesije: prosjek ~${fmtBajta(agregat.stabloRss.prosjekBajta, "MB")}, peak ~${fmtBajta(agregat.stabloRss.peakBajta, "MB")}`,
  );
  linije.push(
    "  Napomena: RSS stabla je GORNJA GRANICA (dijeljene biblioteke se broje visestruko medju",
  );
  linije.push("  procesima). Slobodna memorija i swap masine su mjerodavniji pokazatelj stvarnog pritiska.");
  linije.push("");
  linije.push(
    `Vrijeme u strazi: ${agregat.vrijemeUStrazi.postotak.toFixed(1)}% (${fmtTrajanje(agregat.vrijemeUStrazi.ms)}), ` +
      `izvor procjene: ${agregat.vrijemeUStrazi.izvor}`,
  );
  linije.push('  (izvor je "dogadjaji" = tacno izmjereno iz parova gasenje/budjenje, "uzorci" ili');
  linije.push('  "dogadjaji+uzorci" = dijelom procijenjeno iz periodicnih uzoraka, "nepoznato" = nema signala)');
  linije.push("");
  const hs = agregat.hladniStartovi;
  const fmtSekunde = (ms) => (ms !== null ? `${(ms / 1000).toFixed(1)}s` : "nepoznato");
  linije.push(
    `Hladni startovi: ${hs.broj}, prosjecno ${fmtSekunde(hs.prosjekMs)}, najduzi ${fmtSekunde(hs.maxMs)}`,
  );
  linije.push(`Padovi: ${agregat.padovi.broj}`);
  linije.push("");
  linije.push(
    `Masina: prosjecno slobodno ~${fmtBajta(agregat.masina.prosjekSlobodnoBajta, "GB")}, ` +
      `prosjecan swap ~${fmtBajta(agregat.masina.prosjekSwapKoristenoBajta, "MB")}, ` +
      `prosjecan load1 ${fmtBroj(agregat.masina.prosjekLoad1)}`,
  );
  linije.push("");
  linije.push("Sta poboljsati:");
  if (agregat.savjeti.length === 0) {
    linije.push("  Nema posebnih zapazanja u ovom periodu.");
  } else {
    for (const savjet of agregat.savjeti) linije.push(`  - ${savjet}`);
  }
  return linije.join("\n");
}

function kratakIzvjestaj(imeKlona, agregat, dana) {
  if (agregat.brojUzoraka === 0) return `${imeKlona}: nema podataka za zadnjih ${dana} dana.`;
  return (
    `${imeKlona}: RSS stabla prosjek ~${fmtBajta(agregat.stabloRss.prosjekBajta, "MB")} ` +
    `(peak ~${fmtBajta(agregat.stabloRss.peakBajta, "MB")}), straza ${agregat.vrijemeUStrazi.postotak.toFixed(1)}%, ` +
    `hladni startovi ${agregat.hladniStartovi.broj}x, padovi ${agregat.padovi.broj}.`
  );
}

function izvjestajJedan(dana) {
  const env = procitajEnv(join(KORIJEN, ".env"));
  const redovi = redoviZaPeriod(KORIJEN, env, dana);
  console.log(punIzvjestaj(`Izvjestaj resursa: ${basename(KORIJEN)}`, agregiraj(redovi), dana));
}

function izvjestajSvi(rootDir, dana) {
  const klonovi = listajKlonove(rootDir);
  if (klonovi.length === 0) {
    console.log(`Nema klonova (foldera sa .olx-pik) u ${rootDir}.`);
    return;
  }

  const sviRedovi = [];
  for (const ime of klonovi) {
    const korijenKlona = join(rootDir, ime);
    const env = procitajEnv(join(korijenKlona, ".env"));
    const redovi = redoviZaPeriod(korijenKlona, env, dana);
    sviRedovi.push(...redovi);
    console.log(kratakIzvjestaj(ime, agregiraj(redovi), dana));
  }
  console.log("");
  console.log(punIzvjestaj(`Zbirno (sva ${klonovi.length} klona)`, agregiraj(sviRedovi), dana));
}

// ---- dijagnostika ----

function citljivaVrijednostSonde(naziv, vrijednost) {
  if (naziv === "proces-tabela") {
    return `${fmtBajta(vrijednost.ukupnoBajta, "MB")}, ${vrijednost.brojProcesa} procesa`;
  }
  if (naziv === "masina-ukupno" || naziv === "masina-slobodno") return fmtBajta(vrijednost, "GB");
  if (naziv === "masina-swap") return fmtBajta(vrijednost, "MB");
  if (naziv === "masina-load") return fmtBroj(vrijednost);
  return String(vrijednost);
}

async function dijagnostika() {
  const rezultati = await dijagnostikaSondi();
  for (const r of rezultati) {
    if (r.ok) {
      console.log(`${r.naziv}: OK (${citljivaVrijednostSonde(r.naziv, r.vrijednost)})`);
    } else {
      console.log(`${r.naziv}: NIJE USPJELO (${r.razlog})`);
    }
  }
}

// ---- argv i usage ----

function zastavica(ime, ostatak, default_) {
  const i = ostatak.indexOf(`--${ime}`);
  if (i === -1) return default_;
  return ostatak[i + 1];
}

function usage() {
  console.error("Upotreba:");
  console.error("  node scripts/resursi.mjs pregled [--svi <root-dir>]");
  console.error("  node scripts/resursi.mjs izvjestaj [--dana N] [--svi <root-dir>]");
  console.error("  node scripts/resursi.mjs dijagnostika");
}

async function main() {
  const [, , komanda, ...ostatak] = process.argv;
  const svi = zastavica("svi", ostatak, null);
  if (ostatak.includes("--svi") && !svi) {
    console.error("--svi trazi putanju direktorija, npr. --svi ~/olx-klonovi");
    process.exit(1);
  }

  if (komanda === "pregled") {
    if (svi) await pregledSvi(svi);
    else await pregledJedan();
    return;
  }

  if (komanda === "izvjestaj") {
    const danaSirovo = Number(zastavica("dana", ostatak, "30"));
    const dana = Number.isFinite(danaSirovo) && danaSirovo > 0 ? danaSirovo : 30;
    if (svi) izvjestajSvi(svi, dana);
    else izvjestajJedan(dana);
    return;
  }

  if (komanda === "dijagnostika") {
    await dijagnostika();
    return;
  }

  usage();
  process.exit(1);
}

await main();
