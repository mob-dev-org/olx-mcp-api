// Mjerenje CPU zauzeca, PSI (pressure stall information) i load-a, na nivou cijele masine i po
// pojedinom klonu (stablu procesa). Load1/5/15 je slab signal: na Linuxu broji i procese
// blokirane na disku (ne samo CPU), i nije uporediv izmedju masina sa razlicitim brojem jezgara,
// zato ovaj modul racuna i normalizovan CPU% i (na Linuxu) PSI.
//
// Isti princip kao resursi.mjs/disk.mjs: sve zavisnosti (exec, readFile, process.platform,
// os.cpus) idu kao argumenti default parametara ka pravim implementacijama, modul sam ne cita
// process.env ni process.platform osim kao default vrijednost parametra. Nijedna javna funkcija
// ne baca izuzetak napolje: sve je best effort, `null` na neuspjeh, NIKAD 0 kao zamjena za
// nepoznato.
//
// CPU po klonu (stablu procesa) NIGDJE ne koristi trenutni %cpu iz `ps`: to je zivotni prosjek
// procesa od kad je pokrenut, pa bi klijentska sesija koja satima miruje (strazar rezim) pa
// naglo radi i dalje pokazivala nisko %cpu satima poslije budjenja (razvuceno na sve satove
// mirovanja) - bas suprotno pitanju "ko jede procesor UPRAVO SADA". Zato i Linux (/proc/pid/stat)
// i macOS (`ps -o cputime=`) idu na DELTU kumulativnog CPU vremena izmedju dva mjerenja, isti
// princip kao cpuProcentiIzDelte za masinu, preko zajednicke deltaIzStanja pomocne funkcije.

import { execFile } from "node:child_process";
import { readFile as fsReadFilePromiseImpl } from "node:fs/promises";
import { cpus as osCpusImpl } from "node:os";
import { promisify } from "node:util";

// Isti obrazac kao resursi.mjs/disk.mjs: uvijek async subprocess, nikad sinhroni
// execSync/spawnSync.
const execFileAsyncDefault = promisify(execFile);

// Default citac fajla (tekst, /proc/* je uvijek tekst). Isti obrazac kao citajFajlAsync u
// resursi.mjs.
async function fsReadFilePromise(putanja) {
  return fsReadFilePromiseImpl(putanja, "utf8");
}

// Default broj jezgara masine, uzet iz os.cpus(). Injektovan kroz podrazumijevanu vrijednost
// parametra, modul sam ne cita os.cpus() nigdje drugo.
function osCpuBrojDefault() {
  return osCpusImpl().length;
}

// sysconf(_SC_CLK_TCK) je na skoro svim modernim Linux distribucijama 100. Ne cita se sysconf
// direktno (nema prenosivog naina iz cistog JS-a bez native modula); netacan HZ je jedini poznat
// nacin da ovo pogrijesi.
const HZ_TIKOVA_U_SEKUNDI = 100;

// ---- A. load po jezgru ----

/**
 * Cista funkcija. `loadavg` je `[l1,l5,l15]`, bilo koji clan moze biti `null` (npr. Windows gdje
 * os.loadavg() uvijek vraca 0, resursi.mjs to vec pretvara u null). Vraca `[l1/n, l5/n, l15/n]`
 * sa istim null propagiranjem, ili `[null,null,null]` ako `brojJezgara` nije pozitivan broj.
 */
export function loadPoJezgru(loadavg, brojJezgara) {
  const [l1, l5, l15] = Array.isArray(loadavg) ? loadavg : [null, null, null];
  if (typeof brojJezgara !== "number" || !Number.isFinite(brojJezgara) || brojJezgara <= 0) {
    return [null, null, null];
  }
  const podijeli = (v) => (typeof v === "number" && Number.isFinite(v) ? v / brojJezgara : null);
  return [podijeli(l1), podijeli(l5), podijeli(l15)];
}

// ---- B. CPU% masine ----

/**
 * Parsira PRVI red /proc/stat (Linux), oblik
 * `cpu  <user> <nice> <system> <idle> <iowait> <irq> <softirq> <steal> ...` (polja poslije steal
 * se ignorisu ako postoje). Cista funkcija. `null` ako red ne postoji/ne parsira.
 */
export function parsirajProcStatCpuRed(sadrzaj) {
  if (!sadrzaj) return null;
  const prviRed = sadrzaj.split("\n")[0]?.trim();
  if (!prviRed) return null;
  const poklapanje = prviRed.match(
    /^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/,
  );
  if (!poklapanje) return null;
  const [, user, nice, system, idle, iowait, irq, softirq, steal] = poklapanje;
  return {
    user: Number(user),
    nice: Number(nice),
    system: Number(system),
    idle: Number(idle),
    iowait: Number(iowait),
    irq: Number(irq),
    softirq: Number(softirq),
    steal: Number(steal),
  };
}

// Polja koja ucestvuju u ukupnoDelta racunici, istim redoslijedom kao u /proc/stat.
const POLJA_PROC_STAT = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"];

/**
 * Cista funkcija. Racuna deltu svakog polja izmedju dva citanja parsirajProcStatCpuRed i procente
 * u odnosu na ukupnu deltu. `null` ako je bilo koji argument `null`, ili ako je BILO KOJE trenutno
 * polje MANJE od odgovarajuceg prethodnog (brojac resetovan, npr. reboot masine izmedju dva
 * mjerenja - jiffies monotono rastu dok masina radi), ili ako je ukupnoDelta <= 0.
 */
export function cpuProcentiIzDelte(prethodni, trenutni) {
  if (!prethodni || !trenutni) return null;

  const delte = {};
  for (const polje of POLJA_PROC_STAT) {
    const p = prethodni[polje];
    const t = trenutni[polje];
    if (typeof p !== "number" || typeof t !== "number" || !Number.isFinite(p) || !Number.isFinite(t)) {
      return null;
    }
    if (t < p) return null; // brojac resetovan
    delte[polje] = t - p;
  }

  const ukupnoDelta = POLJA_PROC_STAT.reduce((zbir, polje) => zbir + delte[polje], 0);
  if (ukupnoDelta <= 0) return null;

  const postotak = (x) => (x / ukupnoDelta) * 100;
  const idlePct = postotak(delte.idle);
  return {
    userPct: postotak(delte.user),
    systemPct: postotak(delte.system),
    idlePct,
    iowaitPct: postotak(delte.iowait),
    stealPct: postotak(delte.steal),
    zauzetoPct: 100 - idlePct,
  };
}

/** Cita /proc/stat, vraca parsirajProcStatCpuRed rezultat ili `null` (macOS/Windows, greska citanja). */
export async function citajProcStatMasine({ readFile = fsReadFilePromise } = {}) {
  try {
    const sadrzaj = await readFile("/proc/stat");
    return parsirajProcStatCpuRed(sadrzaj);
  } catch {
    return null;
  }
}

/**
 * macOS (i Linux fallback ako /proc/stat nedostupan): `ps -A -o pcpu=` (bez zaglavlja), saberi sve
 * vrijednosti, podijeli sa brojJezgara da se normalizuje na "% od ukupnog kapaciteta masine".
 * `tip: "snimak"` (za razliku od cpuProcentiIzDelte koji je "interval"). `null` ako `ps` padne ili
 * ne vrati nijedan upotrebljiv broj.
 */
export async function cpuSnapshotPs({ exec = execFileAsyncDefault, timeoutMs, brojJezgara = osCpuBrojDefault() } = {}) {
  if (typeof brojJezgara !== "number" || !Number.isFinite(brojJezgara) || brojJezgara <= 0) return null;
  const rok = timeoutMs ?? 3000;
  try {
    const { stdout } = await exec("ps", ["-A", "-o", "pcpu="], {
      timeout: rok,
      encoding: "utf8",
      killSignal: "SIGKILL",
    });
    const brojevi = (stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (brojevi.length === 0) return null;
    const zbir = brojevi.reduce((a, b) => a + b, 0);
    const zauzetoPct = Math.min(100, zbir / brojJezgara);
    return { zauzetoPct, izvor: "ps-snapshot", tip: "snimak" };
  } catch {
    return null;
  }
}

/**
 * Windows: `Get-Counter` (trenutna stopa), fallback `Get-CimInstance Win32_Processor` prosjek ako
 * prvi padne. `null` ako oba padnu.
 */
export async function cpuSnapshotWindows({ exec = execFileAsyncDefault, timeoutMs } = {}) {
  const rok = timeoutMs ?? 8000;
  const opcije = { timeout: rok, encoding: "utf8", killSignal: "SIGKILL" };

  try {
    const komanda =
      "Get-Counter '\\Processor(_Total)\\% Processor Time' | Select -ExpandProperty CounterSamples | Select -ExpandProperty CookedValue";
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], opcije);
    const broj = Number((stdout ?? "").trim());
    if (Number.isFinite(broj)) {
      return { zauzetoPct: Math.min(100, Math.max(0, broj)), izvor: "get-counter", tip: "snimak" };
    }
  } catch {
    // padni na fallback ispod
  }

  try {
    const komanda =
      "Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select -ExpandProperty Average";
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], opcije);
    const broj = Number((stdout ?? "").trim());
    if (Number.isFinite(broj)) {
      return {
        zauzetoPct: Math.min(100, Math.max(0, broj)),
        izvor: "win32-processor-load",
        tip: "snimak",
      };
    }
  } catch {
    // oba pala
  }

  return null;
}

/**
 * Orkestracija CPU% masine. NIKAD ne baca; ako sve padne vraca
 * `{ zauzetoPct: null, izvor: null, tip: null, sirovProcStat: null }`.
 *
 * Linux/macOS: pokusaj citajProcStatMasine. Ako uspije I prethodniProcStat je dat, racuna se
 * prava delta (tip: "interval"). Ako /proc/stat ne postoji (macOS) ili nema prethodnog mjerenja
 * (prvi ikad poziv, ili delta nije validna npr. reboot), fallback na cpuSnapshotPs. `sirovProcStat`
 * u povratnoj vrijednosti MORA sacuvati pozivalac za SUTRASNJI poziv kao novi prethodniProcStat.
 */
export async function izmjeriCpuMasine({
  platform = process.platform,
  exec = execFileAsyncDefault,
  readFile = fsReadFilePromise,
  brojJezgara,
  prethodniProcStat = null,
  timeoutMs,
} = {}) {
  try {
    if (platform === "win32") {
      const snimak = await cpuSnapshotWindows({ exec, timeoutMs });
      if (snimak) return { ...snimak, sirovProcStat: null };
      return { zauzetoPct: null, izvor: null, tip: null, sirovProcStat: null };
    }

    const opcijeSnimka = { exec, timeoutMs };
    if (brojJezgara !== undefined) opcijeSnimka.brojJezgara = brojJezgara;

    const trenutni = await citajProcStatMasine({ readFile });
    if (trenutni) {
      if (prethodniProcStat) {
        const rezultat = cpuProcentiIzDelte(prethodniProcStat, trenutni);
        if (rezultat) {
          return {
            zauzetoPct: rezultat.zauzetoPct,
            iowaitPct: rezultat.iowaitPct,
            stealPct: rezultat.stealPct,
            izvor: "proc-stat-delta",
            tip: "interval",
            sirovProcStat: trenutni,
          };
        }
      }
      // Nema prethodnog mjerenja (prvi ikad poziv) ili delta nije validna (npr. reboot izmedju
      // dva mjerenja): fallback na trenutni snimak, ali cuvaj procitani /proc/stat za sutra.
      const snimak = await cpuSnapshotPs(opcijeSnimka);
      if (snimak) return { ...snimak, sirovProcStat: trenutni };
      return { zauzetoPct: null, izvor: null, tip: null, sirovProcStat: trenutni };
    }

    // /proc/stat nije dostupan (macOS, ili Linux bez njega): ps snimak, bez baze za sutra.
    const snimak = await cpuSnapshotPs(opcijeSnimka);
    if (snimak) return { ...snimak, sirovProcStat: null };
    return { zauzetoPct: null, izvor: null, tip: null, sirovProcStat: null };
  } catch {
    return { zauzetoPct: null, izvor: null, tip: null, sirovProcStat: null };
  }
}

// ---- C. PSI (Linux, opciono) ----

/**
 * Parsira JEDAN red oblika `some avg10=X avg60=Y avg300=Z total=N` iz
 * /proc/pressure/{cpu,memory,io} (trazi red koji pocinje sa `tip`, "some" ili "full"). Cista
 * funkcija. `null` ako red ne postoji.
 */
export function parsirajPsiRed(sadrzaj, tip = "some") {
  if (!sadrzaj) return null;
  for (const sirovRed of sadrzaj.split("\n")) {
    const red = sirovRed.trim();
    if (red !== tip && !red.startsWith(`${tip} `)) continue;
    const poklapanje = red.match(/avg10=([\d.]+)\s+avg60=([\d.]+)\s+avg300=([\d.]+)\s+total=(\d+)/);
    if (!poklapanje) return null;
    return {
      avg10: Number(poklapanje[1]),
      avg60: Number(poklapanje[2]),
      avg300: Number(poklapanje[3]),
      total: Number(poklapanje[4]),
    };
  }
  return null;
}

// Cita jedan PSI fajl u svom try/catch: fajl koji ne postoji (macOS/Windows, Linux bez
// CONFIG_PSI/psi=1) je NORMALNO stanje, nikad greska.
async function citajJedanPsiFajl(putanja, readFile) {
  try {
    const sadrzaj = await readFile(putanja);
    const some = parsirajPsiRed(sadrzaj, "some");
    return some ? { some } : null;
  } catch {
    return null;
  }
}

/**
 * Cita sva tri fajla (/proc/pressure/cpu, memory, io) nezavisno, svaki u svom try/catch. Samo
 * `some` red je potreban za sada (`full` ne postoji uopste za cpu fajl po Linux dokumentaciji).
 */
export async function citajPsi({ readFile = fsReadFilePromise } = {}) {
  const [cpu, memory, io] = await Promise.all([
    citajJedanPsiFajl("/proc/pressure/cpu", readFile),
    citajJedanPsiFajl("/proc/pressure/memory", readFile),
    citajJedanPsiFajl("/proc/pressure/io", readFile),
  ]);
  return { cpu, memory, io };
}

// ---- D. CPU po klonu (stablo procesa) ----

/**
 * Parsira /proc/<pid>/stat (Linux). Polje `comm` je u zagradama i moze sadrzati razmake i
 * zatvorene zagrade, zato se trazi ZADNJA `)` u stringu (comm se ne pojavljuje poslije nje), sve
 * poslije nje se razdvaja po razmaku - to su polja indeksirana od 3 nadalje (`state` je polje 3).
 * Vraca polja 14 (utime), 15 (stime), 22 (starttime), sva u tikovima (HZ, vidi
 * HZ_TIKOVA_U_SEKUNDI). Cista funkcija. `null` ako parsiranje ne uspije.
 */
export function parsirajProcPidStat(sadrzaj) {
  if (!sadrzaj) return null;
  const zadnjaZagrada = sadrzaj.lastIndexOf(")");
  if (zadnjaZagrada === -1) return null;
  const ostatak = sadrzaj.slice(zadnjaZagrada + 1).trim();
  if (!ostatak) return null;
  const polja = ostatak.split(/\s+/);

  // ostatak pocinje od polja 3 (state), pa polje N (1-indeksirano po /proc/pid/stat dokumentaciji)
  // odgovara polja[N - 3].
  const utime = polja[14 - 3];
  const stime = polja[15 - 3];
  const starttime = polja[22 - 3];
  if (utime === undefined || stime === undefined || starttime === undefined) return null;

  const utimeTicks = Number(utime);
  const stimeTicks = Number(stime);
  const starttimeTicks = Number(starttime);
  if (!Number.isFinite(utimeTicks) || !Number.isFinite(stimeTicks) || !Number.isFinite(starttimeTicks)) {
    return null;
  }
  return { utimeTicks, stimeTicks, starttimeTicks };
}

/** Cita /proc/<pid>/stat. `null` na neuspjeh (proces ne postoji, race, dozvole - normalno). */
export async function citajPidStat(pid, { readFile = fsReadFilePromise } = {}) {
  try {
    const sadrzaj = await readFile(`/proc/${pid}/stat`);
    return parsirajProcPidStat(sadrzaj);
  } catch {
    return null;
  }
}

/**
 * Parsira izlaz `ps -o cputime=` (ili `-o time=`): kumulativno CPU vrijeme procesa od pokretanja.
 * macOS/BSD `ps` UVIJEK ispisuje `"MM:SS.CC"` (minute:sekunda.centisekunda), gdje MM ne prelama u
 * sate/dane cak ni preko stotina minuta kumulativnog CPU vremena (izmjereno na macOS-u: proces sa
 * 1416 minuta kumulativnog CPU-a i dalje prikazan kao "1416:40.82", ne kao hh:mm:ss). Uz to se
 * podrzavaju i "hh:mm:ss" te "dd-hh:mm:ss" (GNU/Linux `ps` stil, radi prenosivosti), svi sa
 * opcionim decimalnim dijelom sekundi. Cista funkcija. Vraca ukupno sekundi (Number, moze imati
 * decimalni dio) ili `null` ako ne parsira.
 */
export function parsirajPsCputime(cputimeStr) {
  if (cputimeStr === null || cputimeStr === undefined) return null;
  let s = String(cputimeStr).trim();
  if (s === "") return null;

  let dana = 0;
  const danaPoklapanje = s.match(/^(\d+)-(.+)$/);
  if (danaPoklapanje) {
    dana = Number(danaPoklapanje[1]);
    s = danaPoklapanje[2];
  }

  const dijelovi = s.split(":");
  if (dijelovi.length < 2 || dijelovi.length > 3) return null;

  for (let i = 0; i < dijelovi.length - 1; i++) {
    if (!/^\d+$/.test(dijelovi[i])) return null;
  }
  const zadnji = dijelovi[dijelovi.length - 1];
  const sekPoklapanje = zadnji.match(/^(\d+)(?:\.(\d+))?$/);
  if (!sekPoklapanje) return null;
  const sekunde = Number(sekPoklapanje[1]) + (sekPoklapanje[2] ? Number(`0.${sekPoklapanje[2]}`) : 0);

  let ukupnoSekundi = dana * 86400;
  if (dijelovi.length === 3) {
    ukupnoSekundi += Number(dijelovi[0]) * 3600 + Number(dijelovi[1]) * 60 + sekunde;
  } else {
    ukupnoSekundi += Number(dijelovi[0]) * 60 + sekunde;
  }
  return ukupnoSekundi;
}

/**
 * Parsira izlaz `ps -axo pid=,cputime=,lstart=` (bez zaglavlja). `lstart` ima RAZMAKE u sebi
 * (npr. "Mon Aug 12 10:00:00 2026"), zato se sa pocetka linije citaju SAMO prva dva tokena
 * (`pid`, `cputime`), sve ostalo do kraja linije je `lstart` string NETAKNUT - koristi se samo
 * kao stabilan identitet procesa (isto kao starttimeTicks na Linuxu), ne parsira se u datum. Red
 * koji ne parsira (ili cije cputime polje ne parsira) se preskace. Cista funkcija.
 */
export function parsirajPsKumulativno(stdout) {
  const rezultat = [];
  if (!stdout) return rezultat;
  for (const sirovaLinija of stdout.split("\n")) {
    const linija = sirovaLinija.trim();
    if (!linija) continue;
    const poklapanje = linija.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!poklapanje) continue;
    const [, pidStr, cputimeStr, lstart] = poklapanje;
    const cpuSekundi = parsirajPsCputime(cputimeStr);
    if (cpuSekundi === null) continue;
    rezultat.push({ pid: Number(pidStr), cpuSekundi, startMarker: lstart.trim() });
  }
  return rezultat;
}

/**
 * Poziva `ps -axo pid=,cputime=,lstart=` (svi procesi sistema, JEDAN poziv). Vraca
 * parsirajPsKumulativno rezultat ili `null` (best effort, `exec` koji baci ili padne).
 */
export async function citajPsKumulativno({ exec = execFileAsyncDefault, timeoutMs } = {}) {
  const rok = timeoutMs ?? 3000;
  try {
    const { stdout } = await exec("ps", ["-axo", "pid=,cputime=,lstart="], {
      timeout: rok,
      encoding: "utf8",
      killSignal: "SIGKILL",
    });
    return parsirajPsKumulativno(stdout);
  } catch {
    return null;
  }
}

/**
 * Zajednicka delta racunica za cpuStabla, dijeljena izmedju Linux i macOS grane. `trenutniPoPidu`
 * je `{[pid]: {cpuSekundi, identitetOznaka}}` (identitetOznaka je starttimeTicks na Linuxu,
 * `startMarker`/lstart string na macOS - poredi se strogom jednakoscu, razlicita vrijednost znaci
 * drugi proces, PID reuse). `prethodnoStanje` je `{ poPidu: {[pid]: {cpuSekundi,identitetOznaka}},
 * ts } | null` iz JUCERASNJEG poziva. Pid bez baze (nov, ili promijenjena identitetOznaka) ide u
 * `pidoviBezBaze`, ne racuna se u deltu. `stanjeZaSutra` uvijek sadrzi SVE pidove iz danasnjeg
 * citanja (ne samo one sa bazom). Cista funkcija.
 */
function deltaIzStanja({ trenutniPoPidu, prethodnoStanje, pidovi, sadaMs }) {
  const stanjaSada = {};
  const pidoviBezBaze = [];
  let sumaDeltaSekundi = 0;
  let imaValjaneBaze = false;

  for (const pid of pidovi) {
    const danas = trenutniPoPidu[pid];
    if (!danas) {
      pidoviBezBaze.push(pid);
      continue;
    }
    stanjaSada[pid] = danas;

    const juce = prethodnoStanje?.poPidu?.[pid];
    if (!juce || juce.identitetOznaka !== danas.identitetOznaka) {
      pidoviBezBaze.push(pid);
      continue;
    }

    sumaDeltaSekundi += danas.cpuSekundi - juce.cpuSekundi;
    imaValjaneBaze = true;
  }

  let pct = null;
  if (imaValjaneBaze && typeof prethodnoStanje?.ts === "number") {
    const protekloSekundi = (sadaMs - prethodnoStanje.ts) / 1000;
    if (protekloSekundi > 0) {
      pct = (sumaDeltaSekundi / protekloSekundi) * 100;
    }
  }

  return { pct, pidoviBezBaze, stanjeZaSutra: { poPidu: stanjaSada, ts: sadaMs } };
}

/**
 * CPU% stabla procesa (klona) preko DELTE kumulativnog CPU vremena, nikad preko trenutnog %cpu
 * (vidi komentar na vrhu fajla zasto). `pidovi` je niz PID-ova cijelog stabla klona (isti spisak
 * koji zbirStabla iz resursi.mjs interno prolazi, pozivalac ga daje gotovog). `prethodnoStanje` je
 * `{ poPidu: {[pid]: {cpuSekundi, identitetOznaka}}, ts } | null` iz JUCERASNJEG poziva za OVAJ
 * klon (vidi deltaIzStanja).
 *
 * Linux: citajPidStat po pidu, cpuSekundi = (utimeTicks+stimeTicks)/HZ, identitetOznaka =
 * starttimeTicks. macOS: JEDAN poziv citajPsKumulativno (jedan `ps` daje sve procese sistema
 * odjednom), filtrirano na `pidovi`, cpuSekundi iz cputime, identitetOznaka = startMarker
 * (lstart). Windows nema ni /proc ni pouzdan kumulativni cputime preko `ps`: delegira se na
 * cpuStabloWindows (WMI vec racuna gotovu stopu preko dva interna uzorka), bez perzistentnog
 * stanja.
 */
export async function cpuStabla(
  pidovi,
  {
    platform = process.platform,
    readFile = fsReadFilePromise,
    exec = execFileAsyncDefault,
    prethodnoStanje = null,
    sadaMs = Date.now(),
    timeoutMs,
  } = {},
) {
  const spisak = Array.isArray(pidovi) ? pidovi : [];

  if (platform === "win32") {
    const rezultat = await cpuStabloWindows(spisak, { exec, timeoutMs });
    return {
      pct: rezultat?.pct ?? null,
      izvor: rezultat?.izvor ?? null,
      pidoviBezBaze: [],
      stanjeZaSutra: null,
    };
  }

  if (platform === "darwin") {
    const svi = await citajPsKumulativno({ exec, timeoutMs });
    const trenutniPoPidu = {};
    if (svi) {
      const skup = new Set(spisak);
      for (const p of svi) {
        if (skup.has(p.pid)) {
          trenutniPoPidu[p.pid] = { cpuSekundi: p.cpuSekundi, identitetOznaka: p.startMarker };
        }
      }
    }
    const { pct, pidoviBezBaze, stanjeZaSutra } = deltaIzStanja({
      trenutniPoPidu,
      prethodnoStanje,
      pidovi: spisak,
      sadaMs,
    });
    return { pct, izvor: "ps-delta", pidoviBezBaze, stanjeZaSutra };
  }

  // Linux (i ostale *nix varijante): /proc po pidu.
  const trenutniPoPidu = {};
  for (const pid of spisak) {
    const danas = await citajPidStat(pid, { readFile });
    if (danas) {
      trenutniPoPidu[pid] = {
        cpuSekundi: (danas.utimeTicks + danas.stimeTicks) / HZ_TIKOVA_U_SEKUNDI,
        identitetOznaka: danas.starttimeTicks,
      };
    }
  }
  const { pct, pidoviBezBaze, stanjeZaSutra } = deltaIzStanja({
    trenutniPoPidu,
    prethodnoStanje,
    pidovi: spisak,
    sadaMs,
  });
  return { pct, izvor: "proc-delta", pidoviBezBaze, stanjeZaSutra };
}

/**
 * Windows: `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process` (WMI vec vraca gotovu
 * izracunatu stopu, bez potrebe za rucnom deltom). Ista objekat-vs-niz kvirka kao
 * parsirajWinProcese u resursi.mjs. `null` na neuspjeh (exec padne, JSON ne parsira).
 */
export async function cpuStabloWindows(pidovi, { exec = execFileAsyncDefault, timeoutMs } = {}) {
  const spisak = Array.isArray(pidovi) ? pidovi : [];
  const rok = timeoutMs ?? 8000;
  try {
    const komanda =
      "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select IDProcess,PercentProcessorTime | ConvertTo-Json -Compress";
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], {
      timeout: rok,
      encoding: "utf8",
      killSignal: "SIGKILL",
    });
    let podaci;
    try {
      podaci = JSON.parse(stdout);
    } catch {
      return null;
    }
    const niz = Array.isArray(podaci) ? podaci : [podaci];
    const skup = new Set(spisak);
    let zbir = 0;
    for (const p of niz) {
      if (!p || typeof p !== "object") continue;
      const pid = Number(p.IDProcess);
      const pct = Number(p.PercentProcessorTime);
      if (!Number.isFinite(pid) || !Number.isFinite(pct)) continue;
      if (skup.has(pid)) zbir += pct;
    }
    return { pct: zbir, izvor: "win-perf-counter", tip: "snimak" };
  } catch {
    return null;
  }
}
