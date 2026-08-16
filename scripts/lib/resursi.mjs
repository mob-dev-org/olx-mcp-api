// Uzorkovanje resursa (RSS memorije, stanje masine) za flotu klonova. Cuvar sesije (koji se vec
// budi svakih 60s) zove ove funkcije da upise red u JSONL i kasnije napravi agregirani izvjestaj.
//
// Ovaj modul NE zna nista o cuvaru: prima pid sesije, stanje itd kao argumente, isti princip kao
// straza.mjs. Sve zavisnosti (exec, platform, fs funkcije, sada/Date.now) idu kao argumenti
// default parametara ka pravim implementacijama, modul sam ne cita process.env ni
// process.platform (osim kao default vrijednost parametra). Nijedna javna funkcija ne baca
// izuzetak napolje: sve je best effort, `null`/`false`/prazan niz na neuspjeh.
//
// U JSONL red NIKAD ne ide sirovi spisak procesa niti ime tudjeg procesa, samo agregirani
// brojevi (vidi redUzorka). `comm` polje iz parsirajPsRedove/parsirajWinProcese postoji SAMO za
// buducu dijagnostiku, ne smije zavrsiti u redUzorka izlazu.

import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

// Sinhroni subprocess (execSync/spawnSync) je zabranjen ovdje: ovaj modul zove cuvar koji ne
// smije stati dok se ceka na `ps`/`powershell`. Default MORA biti promisify(execFile), nikad
// nista sinhrono.
const execFileAsync = promisify(execFile);

// Default citac fajla za uzorakMasineDetaljno (/proc/meminfo je uvijek tekst).
async function citajFajlAsync(putanja) {
  return readFileAsync(putanja, "utf8");
}

// ---- procesi i RSS stabla ----

/**
 * Parsira izlaz `ps -axo pid=,ppid=,rss=,comm=` (macOS i Linux, isti format bez zaglavlja).
 * Cista funkcija. Comm moze imati razmake u sebi (puna putanja, ime sa zagradama), zato se uzima
 * sve poslije treceg broja, ne cetvrto polje po razmaku. Red koji ne parsira se tiho preskace.
 */
export function parsirajPsRedove(stdout) {
  const rezultat = [];
  if (!stdout) return rezultat;
  for (const sirovaLinija of stdout.split("\n")) {
    const linija = sirovaLinija.trim();
    if (!linija) continue;
    const poklapanje = linija.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!poklapanje) continue;
    const [, pid, ppid, rssKb, comm] = poklapanje;
    rezultat.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssBajta: Number(rssKb) * 1024,
      comm: comm.trim(),
    });
  }
  return rezultat;
}

/**
 * Parsira JSON iz PowerShell `Get-CimInstance Win32_Process | Select
 * ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Json -Compress`. Kad PowerShell
 * selektuje tacno jedan objekat, ConvertTo-Json vraca objekat a ne niz od jednog elementa, zato
 * se ovdje uvijek normalizuje u niz prije obrade. Nevalidan/prazan string daje prazan niz.
 */
export function parsirajWinProcese(stdoutJson) {
  if (!stdoutJson) return [];
  let podaci;
  try {
    podaci = JSON.parse(stdoutJson);
  } catch {
    return [];
  }
  const niz = Array.isArray(podaci) ? podaci : [podaci];
  const rezultat = [];
  for (const p of niz) {
    if (!p || typeof p !== "object") continue;
    const pid = Number(p.ProcessId);
    const ppid = Number(p.ParentProcessId);
    const rssBajta = Number(p.WorkingSetSize);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssBajta)) continue;
    rezultat.push({ pid, ppid, rssBajta, comm: String(p.Name ?? "") });
  }
  return rezultat;
}

/**
 * Tanak omotac oko platformske komande. `exec` je uvijek async (default promisify(execFile)),
 * nikad sinhroni poziv, jer ovo zove cuvar koji ne smije blokirati petlju. Svaka greska (komanda
 * ne postoji, timeout, nevalidan izlaz koji sruši exec) vraca `null`, nikad ne baca.
 */
export async function citajProcese({ platform = process.platform, exec = execFileAsync, timeoutMs } = {}) {
  const rok = timeoutMs ?? (platform === "win32" ? 8000 : 3000);
  const opcije = { timeout: rok, encoding: "utf8", killSignal: "SIGKILL" };
  try {
    if (platform === "win32") {
      const komanda =
        "Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Json -Compress";
      const { stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], opcije);
      return parsirajWinProcese(stdout);
    }
    const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,rss=,comm="], opcije);
    return parsirajPsRedove(stdout);
  } catch {
    return null;
  }
}

/**
 * Sabira RSS root procesa i SVIH njegovih potomaka. Cista funkcija, bez I/O. `rootPid` koji nije
 * u nizu (vec ugasen proces, ili citajProcese vec vratio null pa je pozivalac proslijedio prazan
 * niz) daje `null`. `visited` set stiti od ciklicnih/pokvarenih ppid podataka (proces koji
 * navodno pokazuje na samog sebe ili kruzni lanac).
 */
export function zbirStabla(procesi, rootPid) {
  if (!Array.isArray(procesi)) return null;
  if (!procesi.some((p) => p.pid === rootPid)) return null;

  const djecaPoRoditelju = new Map();
  const poPidu = new Map();
  for (const p of procesi) {
    poPidu.set(p.pid, p);
    if (!djecaPoRoditelju.has(p.ppid)) djecaPoRoditelju.set(p.ppid, []);
    djecaPoRoditelju.get(p.ppid).push(p.pid);
  }

  const posjeceno = new Set();
  const red = [rootPid];
  let ukupnoBajta = 0;
  let brojProcesa = 0;

  while (red.length > 0) {
    const pid = red.shift();
    if (posjeceno.has(pid)) continue;
    posjeceno.add(pid);
    const proces = poPidu.get(pid);
    if (!proces) continue;
    ukupnoBajta += proces.rssBajta;
    brojProcesa += 1;
    for (const dijetePid of djecaPoRoditelju.get(pid) ?? []) {
      if (!posjeceno.has(dijetePid)) red.push(dijetePid);
    }
  }

  return { ukupnoBajta, brojProcesa };
}

/**
 * Isti obilazak stabla kao zbirStabla, ali vraca niz PID-ova cijelog stabla (root + svi potomci)
 * umjesto agregirane RSS sume. Koristi ga cuvar da dobije spisak pid-ova za cpuStabla (cpu.mjs)
 * bez DRUGOG poziva citajProcese() - RSS (zbirStabla) i CPU (cpuStabla) dijele JEDAN citajProcese()
 * rezultat. `null` ako rootPid nije u `procesi` (isti uslov kao zbirStabla).
 */
export function pidoviStabla(procesi, rootPid) {
  if (!Array.isArray(procesi)) return null;
  if (!procesi.some((p) => p.pid === rootPid)) return null;

  const djecaPoRoditelju = new Map();
  const poPidu = new Map();
  for (const p of procesi) {
    poPidu.set(p.pid, p);
    if (!djecaPoRoditelju.has(p.ppid)) djecaPoRoditelju.set(p.ppid, []);
    djecaPoRoditelju.get(p.ppid).push(p.pid);
  }

  const posjeceno = new Set();
  const red = [rootPid];
  const pidovi = [];

  while (red.length > 0) {
    const pid = red.shift();
    if (posjeceno.has(pid)) continue;
    posjeceno.add(pid);
    const proces = poPidu.get(pid);
    if (!proces) continue;
    pidovi.push(pid);
    for (const dijetePid of djecaPoRoditelju.get(pid) ?? []) {
      if (!posjeceno.has(dijetePid)) red.push(dijetePid);
    }
  }

  return pidovi;
}

/** citajProcese pa zbirStabla. `null` ako bilo koji korak padne. */
export async function rssStabla(rootPid, opts = {}) {
  const procesi = await citajProcese(opts);
  if (!procesi) return null;
  return zbirStabla(procesi, rootPid);
}

// ---- masina (memorija, swap, load) ----

/**
 * Parsira /proc/meminfo (Linux). Koristi MemAvailable (kernelova procjena "dostupno"), NE
 * MemFree, jer je tacnija. Polje koje ne nadje u tekstu je `null`, ne pretpostavlja 0.
 */
export function parsirajProcMeminfo(sadrzaj) {
  const rezultat = {
    ukupnoBajta: null,
    slobodnoBajta: null,
    swapUkupnoBajta: null,
    swapSlobodnoBajta: null,
  };
  if (!sadrzaj) return rezultat;
  const uzmiKb = (naziv) => {
    const m = sadrzaj.match(new RegExp(`^${naziv}:\\s+(\\d+)\\s*kB`, "m"));
    return m ? Number(m[1]) * 1024 : null;
  };
  rezultat.ukupnoBajta = uzmiKb("MemTotal");
  rezultat.slobodnoBajta = uzmiKb("MemAvailable");
  rezultat.swapUkupnoBajta = uzmiKb("SwapTotal");
  rezultat.swapSlobodnoBajta = uzmiKb("SwapFree");
  return rezultat;
}

/**
 * Parsira izlaz macOS `vm_stat`. Velicina stranice se cita iz prvog reda ("page size of NNNN
 * bytes"), ne pretpostavlja se 4096 fiksno jer Apple Silicon koristi 16384. Slobodno = (Pages
 * free + Pages inactive) * velicina stranice. `null` ako format ne prepozna.
 */
export function parsirajVmStatSlobodno(sadrzaj) {
  if (!sadrzaj) return null;
  const velicinaM = sadrzaj.match(/page size of (\d+) bytes/);
  const slobodnoM = sadrzaj.match(/Pages free:\s+(\d+)\./);
  const neaktivnoM = sadrzaj.match(/Pages inactive:\s+(\d+)\./);
  if (!velicinaM || !slobodnoM || !neaktivnoM) return null;
  const velicinaStranice = Number(velicinaM[1]);
  const stranice = Number(slobodnoM[1]) + Number(neaktivnoM[1]);
  return stranice * velicinaStranice;
}

/**
 * Parsira izlaz macOS `sysctl -n vm.swapusage`, oblik "total = X.XXM used = X.XXM free = X.XXM
 * (encrypted)". `null` ako regex ne pogodi.
 */
export function parsirajSwapusage(sadrzaj) {
  if (!sadrzaj) return null;
  const totalM = sadrzaj.match(/total\s*=\s*([\d.]+)M/);
  const usedM = sadrzaj.match(/used\s*=\s*([\d.]+)M/);
  if (!totalM || !usedM) return null;
  return {
    ukupnoBajta: Math.round(Number(totalM[1]) * 1024 * 1024),
    koristenoBajta: Math.round(Number(usedM[1]) * 1024 * 1024),
  };
}

/**
 * Parsira JSON iz Windows `Get-CimInstance Win32_PageFileUsage | Select
 * AllocatedBaseSize,CurrentUsage | ConvertTo-Json -Compress` (MB u oba polja). Ista
 * objekat-vs-niz kvirka kao parsirajWinProcese. Prazan niz (nema pagefile-a) daje `null`
 * (nepoznato, ne nula).
 */
export function parsirajPageFileUsage(stdoutJson) {
  if (!stdoutJson) return null;
  let podaci;
  try {
    podaci = JSON.parse(stdoutJson);
  } catch {
    return null;
  }
  const niz = Array.isArray(podaci) ? podaci : [podaci];
  if (niz.length === 0) return null;
  const p = niz[0];
  const ukupnoMb = Number(p?.AllocatedBaseSize);
  const koristenoMb = Number(p?.CurrentUsage);
  if (!Number.isFinite(ukupnoMb) || !Number.isFinite(koristenoMb)) return null;
  return { ukupnoBajta: ukupnoMb * 1024 * 1024, koristenoBajta: koristenoMb * 1024 * 1024 };
}

/**
 * Orkestracija uzorka masine. SVAKO polje je nezavisno best effort: jedan neuspjeh (npr. swap
 * sonda padne) ne obara ostatak. `detalji` niz sluzi CLI dijagnostici (kasniji task).
 */
export async function uzorakMasineDetaljno({
  platform = process.platform,
  exec = execFileAsync,
  readFile = citajFajlAsync,
  totalmem: totalmemFn = totalmem,
  freemem: freememFn = freemem,
  loadavg: loadavgFn = loadavg,
  timeoutMs,
} = {}) {
  const rok = timeoutMs ?? (platform === "win32" ? 8000 : 3000);
  const opcije = { timeout: rok, encoding: "utf8", killSignal: "SIGKILL" };
  const detalji = [];
  const vrijednosti = {
    ukupnoBajta: null,
    slobodnoBajta: null,
    swapUkupnoBajta: null,
    swapKoristenoBajta: null,
    load1: null,
    load5: null,
    load15: null,
  };

  try {
    vrijednosti.ukupnoBajta = totalmemFn();
    detalji.push({ naziv: "masina-ukupno", ok: true });
  } catch (e) {
    detalji.push({ naziv: "masina-ukupno", ok: false, razlog: e.message });
  }

  try {
    if (platform === "win32") {
      // freemem() je sinhron i dovoljno tacan na Windowsu, bez subprocesa.
      vrijednosti.slobodnoBajta = freememFn();
    } else if (platform === "darwin") {
      const { stdout } = await exec("vm_stat", [], opcije);
      const slobodno = parsirajVmStatSlobodno(stdout);
      if (slobodno === null) throw new Error("vm_stat nije vratio ocekivan format");
      vrijednosti.slobodnoBajta = slobodno;
    } else {
      const sadrzaj = await readFile("/proc/meminfo");
      const meminfo = parsirajProcMeminfo(sadrzaj);
      if (meminfo.slobodnoBajta === null) throw new Error("MemAvailable nije pronadjen u /proc/meminfo");
      vrijednosti.slobodnoBajta = meminfo.slobodnoBajta;
    }
    detalji.push({ naziv: "masina-slobodno", ok: true });
  } catch (e) {
    detalji.push({ naziv: "masina-slobodno", ok: false, razlog: e.message });
  }

  try {
    if (platform === "win32") {
      const komanda =
        "Get-CimInstance Win32_PageFileUsage | Select AllocatedBaseSize,CurrentUsage | ConvertTo-Json -Compress";
      const { stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], opcije);
      const swap = parsirajPageFileUsage(stdout);
      if (swap === null) throw new Error("nema pagefile podataka");
      vrijednosti.swapUkupnoBajta = swap.ukupnoBajta;
      vrijednosti.swapKoristenoBajta = swap.koristenoBajta;
    } else if (platform === "darwin") {
      const { stdout } = await exec("sysctl", ["-n", "vm.swapusage"], opcije);
      const swap = parsirajSwapusage(stdout);
      if (swap === null) throw new Error("sysctl vm.swapusage nije vratio ocekivan format");
      vrijednosti.swapUkupnoBajta = swap.ukupnoBajta;
      vrijednosti.swapKoristenoBajta = swap.koristenoBajta;
    } else {
      const sadrzaj = await readFile("/proc/meminfo");
      const meminfo = parsirajProcMeminfo(sadrzaj);
      if (meminfo.swapUkupnoBajta === null || meminfo.swapSlobodnoBajta === null) {
        throw new Error("swap polja nisu pronadjena u /proc/meminfo");
      }
      vrijednosti.swapUkupnoBajta = meminfo.swapUkupnoBajta;
      vrijednosti.swapKoristenoBajta = meminfo.swapUkupnoBajta - meminfo.swapSlobodnoBajta;
    }
    detalji.push({ naziv: "masina-swap", ok: true });
  } catch (e) {
    detalji.push({ naziv: "masina-swap", ok: false, razlog: e.message });
  }

  try {
    if (platform === "win32") {
      // Node dokumentuje da os.loadavg() na Windowsu uvijek vraca [0,0,0]: to nije stvaran
      // podatak o opterecenju, pa se eksplicitno upisuje null umjesto laznih nula.
      vrijednosti.load1 = null;
      vrijednosti.load5 = null;
      vrijednosti.load15 = null;
    } else {
      const [l1, l5, l15] = loadavgFn();
      vrijednosti.load1 = l1;
      vrijednosti.load5 = l5;
      vrijednosti.load15 = l15;
    }
    detalji.push({ naziv: "masina-load", ok: true });
  } catch (e) {
    detalji.push({ naziv: "masina-load", ok: false, razlog: e.message });
  }

  return { vrijednosti, detalji };
}

/** Tanak omotac: samo `.vrijednosti` iz uzorakMasineDetaljno. */
export async function uzorakMasine(opts = {}) {
  return (await uzorakMasineDetaljno(opts)).vrijednosti;
}

// ---- deterministican pomak po klonu ----

/**
 * FNV-1a 32-bit hash nad putanjom klona, pa modulo. Cista funkcija, bez I/O, bez Math.random:
 * isti `putanjaKlona` MORA uvijek dati isti rezultat (stabilno kroz restarte procesa), jer cuvar
 * ovo zove sa apsolutnom putanjom korijena klona da razmakne uzorkovanje medju klonovima.
 */
export function pomakKlona(putanjaKlona, mod) {
  let h = 2166136261;
  const s = String(putanjaKlona ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const dijelilac = Math.max(1, mod);
  return Math.abs(h) % dijelilac;
}

// ---- red, fajl, rotacija ----

// Verzija 2: dodato cpu_klona_pct (CPU% stabla procesa klona, vidi scripts/lib/cpu.mjs).
// Stari redovi upisani sa shema:1 nemaju ovo polje pri citanju iz JSONL, sto se cita kao
// `undefined`/nedostajuce polje, NE kao 0 - agregiraj() to tolerise (vidi cpuKlonaAgregat).
export const SHEMA_VERZIJA = 2;

/**
 * Gradi jedan red za JSONL. Cista funkcija: svako polje koje pozivalac ne proslijedi postaje
 * `null`, `masina` objekat (iz uzorakMasine()) se raspakuje u masina_* polja. Namjerno NEMA
 * polja za sirovi spisak procesa ni imena tudjih procesa (granice.md), samo agregirani brojevi.
 */
export function redUzorka({
  ts,
  klon,
  tip,
  verzijaKoda,
  intervalMin,
  dogadjaj,
  exitCode,
  exitSignal,
  trajanjeSesijeMs,
  hladniStartMs,
  razlog,
  sesijaZiva,
  uStrazi,
  cuvarRssBajta,
  stabloRssBajta,
  stabloBrojProcesa,
  cpuKlonaPct,
  masina,
} = {}) {
  const m = masina ?? {};
  return {
    ts: ts ?? null,
    klon: klon ?? null,
    tip: tip ?? null,
    shema: SHEMA_VERZIJA,
    verzija_koda: verzijaKoda ?? null,
    interval_min: intervalMin ?? null,
    dogadjaj: dogadjaj ?? null,
    exit_code: exitCode ?? null,
    exit_signal: exitSignal ?? null,
    trajanje_sesije_ms: trajanjeSesijeMs ?? null,
    hladni_start_ms: hladniStartMs ?? null,
    razlog: razlog ?? null,
    sesija_ziva: sesijaZiva ?? null,
    u_strazi: uStrazi ?? null,
    cuvar_rss_bajta: cuvarRssBajta ?? null,
    stablo_rss_bajta: stabloRssBajta ?? null,
    stablo_broj_procesa: stabloBrojProcesa ?? null,
    cpu_klona_pct: cpuKlonaPct ?? null,
    masina_ukupno_bajta: m.ukupnoBajta ?? null,
    masina_slobodno_bajta: m.slobodnoBajta ?? null,
    masina_swap_koristeno_bajta: m.swapKoristenoBajta ?? null,
    masina_swap_ukupno_bajta: m.swapUkupnoBajta ?? null,
    masina_load1: m.load1 ?? null,
    masina_load5: m.load5 ?? null,
    masina_load15: m.load15 ?? null,
  };
}

/** Isti stil kao putanjaPamcenja/putanjaKvoteDnevnika u src/core: relativna putanja, env override. */
export function putanjaResursa(env, datum = new Date()) {
  const dir = env?.OLX_RESURSI_DIR || ".olx-pik/resursi";
  const godina = datum.getFullYear();
  const mjesec = String(datum.getMonth() + 1).padStart(2, "0");
  return `${dir}/resursi-${godina}-${mjesec}.jsonl`;
}

/** Isti stil kao putanjaResursa, ali za mjesecni fajl pritiska na disk (jedan fajl po mjesecu). */
export function putanjaDiska(env, datum = new Date()) {
  const dir = env?.OLX_RESURSI_DIR || ".olx-pik/resursi";
  const godina = datum.getFullYear();
  const mjesec = String(datum.getMonth() + 1).padStart(2, "0");
  return `${dir}/disk-${godina}-${mjesec}.jsonl`;
}

/** Upisuje jedan JSONL red. Try/catch, vraca true/false, NIKAD ne baca. */
export function upisiRed(putanja, red) {
  try {
    mkdirSync(dirname(putanja), { recursive: true });
    appendFileSync(putanja, `${JSON.stringify(red)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Cita i parsira redove iz niza JSONL fajlova. Fajl koji ne postoji se tiho preskace (mozda taj
 * mjesec nema podataka, nije greska). Nevalidna linija se preskace bez pada.
 */
export function citajRedove(putanje) {
  const rezultat = [];
  for (const putanja of putanje ?? []) {
    let sadrzaj;
    try {
      if (!existsSync(putanja)) continue;
      sadrzaj = readFileSync(putanja, "utf8");
    } catch {
      continue;
    }
    for (const linija of sadrzaj.split("\n")) {
      const t = linija.trim();
      if (!t) continue;
      try {
        rezultat.push(JSON.parse(t));
      } catch {
        // nevalidan red (npr. presjecen pri padu procesa usred pisanja), preskoci
      }
    }
  }
  return rezultat;
}

/**
 * Brise fajlove `resursi-YYYY-MM.jsonl`, `disk-YYYY-MM.jsonl` I `masina-YYYY-MM.jsonl` (potonji
 * pise scripts/nadzor-flote.mjs u nadzor-dir, dnevni uzorak masine za flotnu analizu) starije od
 * `cuvajMjeseci`, u istom prolazu kroz direktorij. Try/catch oko citavog poziva i oko svakog
 * pojedinacnog brisanja: jedan fajl koji se ne da obrisati ne prekida ciscenje ostalih.
 * Direktorij koji ne postoji vraca {obrisano: 0} bez greske.
 */
export function ocistiStareResurse(dir, { cuvajMjeseci = 12, sada = () => new Date() } = {}) {
  let obrisano = 0;
  try {
    if (!existsSync(dir)) return { obrisano: 0 };
    const danas = sada();
    for (const ime of readdirSync(dir)) {
      const m = ime.match(/^(?:resursi|disk|masina)-(\d{4})-(\d{2})\.jsonl$/);
      if (!m) continue;
      const godina = Number(m[1]);
      const mjesecIndeks = Number(m[2]) - 1;
      const starostMjeseci = (danas.getFullYear() - godina) * 12 + (danas.getMonth() - mjesecIndeks);
      if (starostMjeseci > cuvajMjeseci) {
        try {
          unlinkSync(join(dir, ime));
          obrisano += 1;
        } catch {
          // jedan fajl koji se ne da obrisati ne smije prekinuti ciscenje ostalih
        }
      }
    }
    return { obrisano };
  } catch {
    return { obrisano };
  }
}

// ---- agregacija za izvjestaj ----

/**
 * Tezinski prosjek preko parova {vrijednost, tezina}. Cista funkcija. Preskace parove gdje je
 * vrijednost null/undefined. `null` ako nema nijednog upotrebljivog para ili je ukupna tezina 0.
 */
export function ponderisaniProsjek(parovi) {
  let sumaVrijednosti = 0;
  let sumaTezina = 0;
  let imaValjanih = false;
  for (const par of parovi ?? []) {
    const { vrijednost, tezina } = par;
    if (vrijednost === null || vrijednost === undefined) continue;
    sumaVrijednosti += vrijednost * tezina;
    sumaTezina += tezina;
    imaValjanih = true;
  }
  if (!imaValjanih || sumaTezina === 0) return null;
  return sumaVrijednosti / sumaTezina;
}

/**
 * Koliko je vremena sesija provela u strazi. `redoviHronoloski` MORA biti sortiran po `ts`
 * rastuce (pretpostavka, funkcija sama ne sortira). Prvo se uparuju "gasenje-straze" ->
 * sljedeci "budjenje" (tacno vrijeme). Nesparen "gasenje-straze" na kraju niza (straza jos
 * traje, ili je cuvar restartovan usred sna pa "budjenje" nikad nije upisano u ovom periodu) se
 * dopunjava FALLBACKOM: zbroj interval_min svih periodicnih uzoraka (dogadjaj:null) sa
 * u_strazi:true i ts poslije tog dogadjaja.
 */
export function vrijemeUStrazi(redoviHronoloski) {
  let msDogadjaji = 0;
  let msUzorci = 0;
  let otvorenoTs = null;

  for (const red of redoviHronoloski ?? []) {
    // "gasenje-idle" je isti dogadjaj pod drugim imenom: pise ga most (scripts/telegram-most.mjs),
    // koji nema pravu strazu (poll ide stalno, ne samo dok sesija spava), pa mu "straza" ne
    // odgovara terminoloski, ali je mirni period identican i uparuje se sa istim "budjenje".
    if (red.dogadjaj === "gasenje-straze" || red.dogadjaj === "gasenje-idle") {
      if (otvorenoTs === null) otvorenoTs = Date.parse(red.ts);
    } else if (red.dogadjaj === "budjenje") {
      if (otvorenoTs !== null) {
        msDogadjaji += Date.parse(red.ts) - otvorenoTs;
        otvorenoTs = null;
      }
    } else if ((red.dogadjaj === null || red.dogadjaj === undefined) && otvorenoTs !== null) {
      if (red.u_strazi === true && Date.parse(red.ts) > otvorenoTs) {
        msUzorci += (red.interval_min ?? 0) * 60_000;
      }
    }
  }

  const ms = msDogadjaji + msUzorci;
  let izvor;
  if (ms === 0) izvor = "nepoznato";
  else if (msDogadjaji > 0 && msUzorci > 0) izvor = "dogadjaji+uzorci";
  else if (msDogadjaji > 0) izvor = "dogadjaji";
  else izvor = "uzorci";

  return { ms, izvor };
}

// Prosjek preko periodicnih uzoraka (dogadjaj===null), ponderisan sa interval_min.
function tezinskiProsjekPolja(uzorci, polje) {
  return ponderisaniProsjek(uzorci.map((r) => ({ vrijednost: r[polje], tezina: r.interval_min ?? 0 })));
}

// Max preko SVIH redova (dogadjaj ili ne): trenutak "pred spavanje" (gasenje-straze) cesto JESTE
// peak i mora ucestvovati u maksimumu iako nema interval_min i ne ulazi u ponderisani prosjek.
function maksimumPolja(redovi, polje) {
  let max = null;
  for (const r of redovi) {
    const v = r[polje];
    if (v === null || v === undefined) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/**
 * Agregat CPU% stabla klona. `null` kad NIJEDAN red (uzorak ili dogadjaj) nema brojcanu
 * `cpu_klona_pct` vrijednost - to je signal "klon jos nije nadogradjen na CPU telemetriju"
 * (stariji shema:1 redovi), ne greska. Cim BAREM JEDAN red ima vrijednost (i mjesoviti
 * shema:1/shema:2 period), vraca objekat: prosjek preko periodicnih uzoraka (isti obrazac kao
 * stabloRss), peak preko svih redova, i ts prvog reda (hronoloski) koji ima vrijednost.
 */
function cpuKlonaAgregat(sortirano, uzorci) {
  const imaBiloKoju = sortirano.some((r) => typeof r.cpu_klona_pct === "number");
  if (!imaBiloKoju) return null;

  const prviSaVrijednoscu = sortirano.find((r) => typeof r.cpu_klona_pct === "number");

  return {
    prosjekPct: tezinskiProsjekPolja(uzorci, "cpu_klona_pct"),
    peakPct: maksimumPolja(sortirano, "cpu_klona_pct"),
    cpuPodaciOd: prviSaVrijednoscu.ts,
  };
}

/**
 * Agregira niz redova u kompaktan izvjestaj. Cista funkcija, sortira `redovi` po `ts` interno
 * (za razliku od vrijemeUStrazi, ne pretpostavlja da je pozivalac vec sortirao).
 */
export function agregiraj(redovi) {
  if (!Array.isArray(redovi) || redovi.length === 0) {
    return {
      period: { od: null, do: null },
      brojUzoraka: 0,
      cuvarRss: { prosjekBajta: null, peakBajta: null },
      stabloRss: { prosjekBajta: null, peakBajta: null },
      vrijemeUStrazi: { ms: 0, postotak: 0, izvor: "nepoznato" },
      hladniStartovi: { broj: 0, prosjekMs: null, maxMs: null },
      padovi: { broj: 0 },
      masina: { prosjekSlobodnoBajta: null, prosjekSwapKoristenoBajta: null, prosjekLoad1: null },
      cpuKlona: null,
      savjeti: [],
    };
  }

  const sortirano = [...redovi].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const period = { od: sortirano[0].ts, do: sortirano[sortirano.length - 1].ts };
  const uzorci = sortirano.filter((r) => r.dogadjaj === null || r.dogadjaj === undefined);

  const cuvarRss = {
    prosjekBajta: tezinskiProsjekPolja(uzorci, "cuvar_rss_bajta"),
    peakBajta: maksimumPolja(sortirano, "cuvar_rss_bajta"),
  };
  const stabloRss = {
    prosjekBajta: tezinskiProsjekPolja(uzorci, "stablo_rss_bajta"),
    peakBajta: maksimumPolja(sortirano, "stablo_rss_bajta"),
  };

  const straza = vrijemeUStrazi(sortirano);
  const periodMs = Date.parse(period.do) - Date.parse(period.od);
  const postotak = periodMs > 0 ? (straza.ms / periodMs) * 100 : 0;

  const budjenja = sortirano.filter((r) => r.dogadjaj === "budjenje");
  const hladniValjani = budjenja
    .map((r) => r.hladni_start_ms)
    .filter((v) => v !== null && v !== undefined);
  const hladniStartovi = {
    broj: budjenja.length,
    prosjekMs: hladniValjani.length > 0 ? hladniValjani.reduce((s, v) => s + v, 0) / hladniValjani.length : null,
    maxMs: hladniValjani.length > 0 ? Math.max(...hladniValjani) : null,
  };

  const padovi = { broj: sortirano.filter((r) => r.dogadjaj === "pad").length };

  const masina = {
    prosjekSlobodnoBajta: tezinskiProsjekPolja(uzorci, "masina_slobodno_bajta"),
    prosjekSwapKoristenoBajta: tezinskiProsjekPolja(uzorci, "masina_swap_koristeno_bajta"),
    prosjekLoad1: tezinskiProsjekPolja(uzorci, "masina_load1"),
  };

  const cpuKlona = cpuKlonaAgregat(sortirano, uzorci);

  // Pocetni, lako prosiriv skup uslovnih savjeta. Ne pokusava pokriti sve situacije, samo
  // najcesce simptome na koje je vrijedno upozoriti bez ljudske analize.
  const savjeti = [];

  const periodDana = periodMs / 86_400_000;
  if (periodDana >= 3 && straza.ms === 0) {
    savjeti.push(
      "Sesija u ovom periodu nikad nije bila u strazi; provjeri OLX_SESIJA_STRAZAR i idle prag.",
    );
  }

  // VAZNO OGRANICENJE: rast RSS-a sam po sebi NIKAD ne generise savjet o mogucem curenju.
  // Mora ga pratiti pritisak na memoriju masine (slobodna memorija pada ili swap raste/je
  // znacajan), inace RSS koji raste dok je masina u redu ostaje bez komentara.
  if (uzorci.length >= 4) {
    const pola = Math.floor(uzorci.length / 2);
    const prvaPolovina = uzorci.slice(0, pola);
    const drugaPolovina = uzorci.slice(pola);
    const rssPrva = tezinskiProsjekPolja(prvaPolovina, "stablo_rss_bajta");
    const rssDruga = tezinskiProsjekPolja(drugaPolovina, "stablo_rss_bajta");
    if (rssPrva !== null && rssDruga !== null && rssPrva > 0 && (rssDruga - rssPrva) / rssPrva > 0.3) {
      const slobodnoPrva = tezinskiProsjekPolja(prvaPolovina, "masina_slobodno_bajta");
      const slobodnoDruga = tezinskiProsjekPolja(drugaPolovina, "masina_slobodno_bajta");
      const swapPrva = tezinskiProsjekPolja(prvaPolovina, "masina_swap_koristeno_bajta");
      const swapDruga = tezinskiProsjekPolja(drugaPolovina, "masina_swap_koristeno_bajta");
      const swapUkupnoProsjek = tezinskiProsjekPolja(uzorci, "masina_swap_ukupno_bajta");

      const slobodnoOpada = slobodnoPrva !== null && slobodnoDruga !== null && slobodnoDruga < slobodnoPrva;
      const swapRaste = swapPrva !== null && swapDruga !== null && swapDruga > swapPrva;
      const swapZnacajan =
        swapDruga !== null &&
        swapUkupnoProsjek !== null &&
        swapUkupnoProsjek > 0 &&
        swapDruga / swapUkupnoProsjek > 0.1;

      if (slobodnoOpada || swapRaste || swapZnacajan) {
        savjeti.push(
          "Stablo procesa raste, a memorija ili swap masine su pod pritiskom; provjeri moguce curenje memorije.",
        );
      }
    }
  }

  if (hladniStartovi.prosjekMs !== null && hladniStartovi.prosjekMs > 20_000) {
    savjeti.push("Hladan start je prosjecno preko 20 sekundi; provjeri MCP/plugin start.");
  }

  if (padovi.broj > 3) {
    savjeti.push("Vise od tri pada u ovom periodu; provjeri cron-*.log.");
  }

  return {
    period,
    brojUzoraka: uzorci.length,
    cuvarRss,
    stabloRss,
    vrijemeUStrazi: { ms: straza.ms, postotak, izvor: straza.izvor },
    hladniStartovi,
    padovi,
    masina,
    cpuKlona,
    savjeti,
  };
}

// ---- dijagnostika (za CLI, kasniji task) ----

/**
 * Pokrece i vraca citljiv rezultat za svaku pojedinacnu sondu, bez obzira da li uspije. Svaka
 * sonda je izolovana u svom try/catch, jedan pad ne prekida ostale.
 */
export async function dijagnostikaSondi(opts = {}) {
  const rezultat = [];

  try {
    const procesi = await citajProcese(opts);
    if (!procesi) {
      rezultat.push({ naziv: "proces-tabela", ok: false, razlog: "citajProcese nije uspio" });
    } else {
      const stablo = zbirStabla(procesi, process.pid);
      if (!stablo) {
        rezultat.push({
          naziv: "proces-tabela",
          ok: false,
          razlog: "sopstveni pid nije nadjen u tabeli procesa",
        });
      } else {
        rezultat.push({ naziv: "proces-tabela", ok: true, vrijednost: stablo });
      }
    }
  } catch (e) {
    rezultat.push({ naziv: "proces-tabela", ok: false, razlog: e.message });
  }

  try {
    const { vrijednosti, detalji } = await uzorakMasineDetaljno(opts);
    const poljePoNazivu = {
      "masina-ukupno": "ukupnoBajta",
      "masina-slobodno": "slobodnoBajta",
      "masina-swap": "swapKoristenoBajta",
      "masina-load": "load1",
    };
    for (const d of detalji) {
      if (d.ok) {
        rezultat.push({ naziv: d.naziv, ok: true, vrijednost: vrijednosti[poljePoNazivu[d.naziv]] });
      } else {
        rezultat.push({ naziv: d.naziv, ok: false, razlog: d.razlog });
      }
    }
  } catch (e) {
    for (const naziv of ["masina-ukupno", "masina-slobodno", "masina-swap", "masina-load"]) {
      rezultat.push({ naziv, ok: false, razlog: e.message });
    }
  }

  return rezultat;
}
