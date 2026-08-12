// Testovi modula za mjerenje CPU-a/PSI/loada. Isti stil kao resursi.test.mjs: node:test +
// node:assert/strict, nikakva prava mreza, subprocess ni fajl sistem. Sve zavisnosti (exec,
// readFile) su injektovane lazne implementacije.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citajPidStat,
  citajProcStatMasine,
  citajPsi,
  citajPsKumulativno,
  cpuProcentiIzDelte,
  cpuSnapshotPs,
  cpuSnapshotWindows,
  cpuStabla,
  cpuStabloWindows,
  izmjeriCpuMasine,
  loadPoJezgru,
  parsirajProcPidStat,
  parsirajProcStatCpuRed,
  parsirajPsCputime,
  parsirajPsiRed,
  parsirajPsKumulativno,
} from "./cpu.mjs";

// ---- pomocnici ----

// Lazni exec: biljezi pozive, odgovara redom iz `niz` (ili po funkciji ako je `niz` funkcija).
// Element koji je Error se baca.
function laznExec(niz) {
  const pozivi = [];
  let i = 0;
  return {
    pozivi,
    exec: async (cmd, args, opcije) => {
      pozivi.push({ cmd, args, opcije });
      const stavka = typeof niz === "function" ? niz(cmd, args, pozivi.length) : niz[i++];
      if (stavka instanceof Error) throw stavka;
      return stavka;
    },
  };
}

// Fabrikuje jedan /proc/<pid>/stat red sa datim utime/stime/starttime na tacnim pozicijama
// (field3..field22, indeksirano od 0), comm namjerno sa razmakom i zatvorenom zagradom u sebi da
// se provjeri da parsiranje ide od ZADNJE ")" u stringu.
function statLinija(pid, { utime, stime, starttime }) {
  const polja = [
    "S", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    String(utime), String(stime),
    "13", "14", "15", "16", "17", "18",
    String(starttime),
    "20", "21",
  ];
  return `${pid} (proc (helper) x) ${polja.join(" ")}`;
}

// ---- loadPoJezgru ----

test("loadPoJezgru: normalan slucaj dijeli svaki clan brojem jezgara", () => {
  assert.deepEqual(loadPoJezgru([4, 2, 1], 4), [1, 0.5, 0.25]);
});

test("loadPoJezgru: null clanovi se propagiraju", () => {
  assert.deepEqual(loadPoJezgru([null, 2, null], 4), [null, 0.5, null]);
});

test("loadPoJezgru: brojJezgara <= 0 ili nije broj daje sve null", () => {
  assert.deepEqual(loadPoJezgru([4, 2, 1], 0), [null, null, null]);
  assert.deepEqual(loadPoJezgru([4, 2, 1], -1), [null, null, null]);
  assert.deepEqual(loadPoJezgru([4, 2, 1], "4"), [null, null, null]);
  assert.deepEqual(loadPoJezgru([4, 2, 1], undefined), [null, null, null]);
});

// ---- parsirajProcStatCpuRed ----

test("parsirajProcStatCpuRed: normalan red", () => {
  const sadrzaj = "cpu  100 0 50 800 20 5 5 0\ncpu0 50 0 25 400 10 2 2 0\n";
  assert.deepEqual(parsirajProcStatCpuRed(sadrzaj), {
    user: 100,
    nice: 0,
    system: 50,
    idle: 800,
    iowait: 20,
    irq: 5,
    softirq: 5,
    steal: 0,
  });
});

test("parsirajProcStatCpuRed: red koji ne postoji/ne parsira daje null", () => {
  assert.equal(parsirajProcStatCpuRed(""), null);
  assert.equal(parsirajProcStatCpuRed(undefined), null);
  assert.equal(parsirajProcStatCpuRed("nesto sasvim drugo\n"), null);
  assert.equal(parsirajProcStatCpuRed("cpu  100 0 50\n"), null); // premalo polja
});

// ---- cpuProcentiIzDelte ----

test("cpuProcentiIzDelte: normalna delta, rucno izracunati procenti", () => {
  const prethodni = { user: 100, nice: 0, system: 50, idle: 800, iowait: 20, irq: 5, softirq: 5, steal: 0 };
  const trenutni = { user: 150, nice: 0, system: 70, idle: 820, iowait: 25, irq: 5, softirq: 5, steal: 0 };
  // delte: user=50 nice=0 system=20 idle=20 iowait=5 irq=0 softirq=0 steal=0 -> ukupno=95
  const r = cpuProcentiIzDelte(prethodni, trenutni);
  assert.ok(r);
  assert.equal(r.userPct, (50 / 95) * 100);
  assert.equal(r.systemPct, (20 / 95) * 100);
  assert.equal(r.idlePct, (20 / 95) * 100);
  assert.equal(r.iowaitPct, (5 / 95) * 100);
  assert.equal(r.stealPct, (0 / 95) * 100);
  assert.equal(r.zauzetoPct, 100 - (20 / 95) * 100);
});

test("cpuProcentiIzDelte: ukupnoDelta<=0 (isti brojevi, nema promjene) daje null", () => {
  const isti = { user: 100, nice: 0, system: 50, idle: 800, iowait: 20, irq: 5, softirq: 5, steal: 0 };
  assert.equal(cpuProcentiIzDelte(isti, { ...isti }), null);
});

test("cpuProcentiIzDelte: trenutni manji od prethodnog (simulacija reboot-a) daje null", () => {
  const prethodni = { user: 500, nice: 0, system: 200, idle: 3000, iowait: 50, irq: 5, softirq: 5, steal: 0 };
  const trenutni = { user: 10, nice: 0, system: 5, idle: 50, iowait: 1, irq: 0, softirq: 0, steal: 0 };
  assert.equal(cpuProcentiIzDelte(prethodni, trenutni), null);
});

test("cpuProcentiIzDelte: jedan argument null daje null", () => {
  const x = { user: 1, nice: 0, system: 1, idle: 1, iowait: 0, irq: 0, softirq: 0, steal: 0 };
  assert.equal(cpuProcentiIzDelte(null, x), null);
  assert.equal(cpuProcentiIzDelte(x, null), null);
});

// ---- citajProcStatMasine ----

test("citajProcStatMasine: uspjesno citanje parsira prvi red", async () => {
  const readFile = async (putanja) => {
    assert.equal(putanja, "/proc/stat");
    return "cpu  1 2 3 4 5 6 7 8\n";
  };
  const r = await citajProcStatMasine({ readFile });
  assert.deepEqual(r, { user: 1, nice: 2, system: 3, idle: 4, iowait: 5, irq: 6, softirq: 7, steal: 8 });
});

test("citajProcStatMasine: readFile koji baci (macOS/Windows) daje null", async () => {
  const readFile = async () => {
    throw Object.assign(new Error("nema fajla"), { code: "ENOENT" });
  };
  assert.equal(await citajProcStatMasine({ readFile }), null);
});

// ---- cpuSnapshotPs ----

test("cpuSnapshotPs: sabira brojeve i dijeli brojem jezgara", async () => {
  const { exec } = laznExec([{ stdout: "1.2\n0.0\n45.0\n" }]);
  const r = await cpuSnapshotPs({ exec, brojJezgara: 4 });
  assert.deepEqual(r, { zauzetoPct: 46.2 / 4, izvor: "ps-snapshot", tip: "snimak" });
});

test("cpuSnapshotPs: exec koji baci daje null", async () => {
  const { exec } = laznExec([new Error("ps ne postoji")]);
  assert.equal(await cpuSnapshotPs({ exec, brojJezgara: 4 }), null);
});

test("cpuSnapshotPs: brojJezgara<=0 daje null bez pozivanja exec-a", async () => {
  const { exec, pozivi } = laznExec([{ stdout: "1.0\n" }]);
  assert.equal(await cpuSnapshotPs({ exec, brojJezgara: 0 }), null);
  assert.equal(pozivi.length, 0);
});

// ---- cpuSnapshotWindows ----

test("cpuSnapshotWindows: Get-Counter uspije", async () => {
  const { exec } = laznExec([{ stdout: "37.5\n" }]);
  const r = await cpuSnapshotWindows({ exec });
  assert.deepEqual(r, { zauzetoPct: 37.5, izvor: "get-counter", tip: "snimak" });
});

test("cpuSnapshotWindows: Get-Counter padne, fallback Win32_Processor uspije", async () => {
  const { exec } = laznExec([new Error("get-counter nije dostupan"), { stdout: "20\n" }]);
  const r = await cpuSnapshotWindows({ exec });
  assert.deepEqual(r, { zauzetoPct: 20, izvor: "win32-processor-load", tip: "snimak" });
});

test("cpuSnapshotWindows: oba padnu daje null", async () => {
  const { exec } = laznExec([new Error("x"), new Error("y")]);
  assert.equal(await cpuSnapshotWindows({ exec }), null);
});

// ---- izmjeriCpuMasine ----

test("izmjeriCpuMasine: linux, prethodni proc-stat dat, racuna deltu", async () => {
  const redovi = ["cpu  100 0 50 800 20 5 5 0\n", "cpu  150 0 70 820 25 5 5 0\n"];
  let i = 0;
  const readFile = async () => redovi[i++];
  const prvi = await citajProcStatMasine({ readFile });
  const r = await izmjeriCpuMasine({ platform: "linux", readFile, prethodniProcStat: prvi });
  assert.equal(r.izvor, "proc-stat-delta");
  assert.equal(r.tip, "interval");
  assert.deepEqual(r.sirovProcStat, { user: 150, nice: 0, system: 70, idle: 820, iowait: 25, irq: 5, softirq: 5, steal: 0 });
});

test("izmjeriCpuMasine: macOS (/proc/stat nedostupan) pada na ps snimak", async () => {
  const readFile = async () => {
    throw Object.assign(new Error("nema"), { code: "ENOENT" });
  };
  const { exec } = laznExec([{ stdout: "10.0\n10.0\n" }]);
  const r = await izmjeriCpuMasine({ platform: "darwin", readFile, exec, brojJezgara: 4 });
  assert.equal(r.izvor, "ps-snapshot");
  assert.equal(r.tip, "snimak");
  assert.equal(r.sirovProcStat, null);
  assert.equal(r.zauzetoPct, 5);
});

test("izmjeriCpuMasine: win32 ide na cpuSnapshotWindows", async () => {
  const { exec } = laznExec([{ stdout: "42\n" }]);
  const r = await izmjeriCpuMasine({ platform: "win32", exec });
  assert.equal(r.izvor, "get-counter");
  assert.equal(r.zauzetoPct, 42);
  assert.equal(r.sirovProcStat, null);
});

test("izmjeriCpuMasine: sve padne daje objekat sa null poljima, nikad ne baca", async () => {
  const readFile = async () => {
    throw new Error("nema");
  };
  const { exec } = laznExec([new Error("ps ne postoji")]);
  const r = await izmjeriCpuMasine({ platform: "linux", readFile, exec, brojJezgara: 4 });
  assert.deepEqual(r, { zauzetoPct: null, izvor: null, tip: null, sirovProcStat: null });
});

// ---- parsirajPsiRed ----

test("parsirajPsiRed: normalan red", () => {
  const sadrzaj = "some avg10=0.10 avg60=0.20 avg300=0.30 total=12345\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n";
  assert.deepEqual(parsirajPsiRed(sadrzaj, "some"), { avg10: 0.1, avg60: 0.2, avg300: 0.3, total: 12345 });
  assert.deepEqual(parsirajPsiRed(sadrzaj, "full"), { avg10: 0, avg60: 0, avg300: 0, total: 0 });
});

test("parsirajPsiRed: red koji ne postoji daje null", () => {
  const sadrzaj = "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n";
  assert.equal(parsirajPsiRed(sadrzaj, "some"), null);
  assert.equal(parsirajPsiRed(""), null);
  assert.equal(parsirajPsiRed(undefined), null);
});

// ---- citajPsi ----

test("citajPsi: sva tri fajla dostupna", async () => {
  const sadrzajPo = {
    "/proc/pressure/cpu": "some avg10=1.00 avg60=2.00 avg300=3.00 total=10\n",
    "/proc/pressure/memory": "some avg10=0.50 avg60=0.60 avg300=0.70 total=20\n",
    "/proc/pressure/io": "some avg10=0.10 avg60=0.20 avg300=0.30 total=30\n",
  };
  const readFile = async (putanja) => sadrzajPo[putanja];
  const r = await citajPsi({ readFile });
  assert.deepEqual(r, {
    cpu: { some: { avg10: 1, avg60: 2, avg300: 3, total: 10 } },
    memory: { some: { avg10: 0.5, avg60: 0.6, avg300: 0.7, total: 20 } },
    io: { some: { avg10: 0.1, avg60: 0.2, avg300: 0.3, total: 30 } },
  });
});

test("citajPsi: sva tri fajla nedostaju (macOS/Windows), NIKAD ne baca", async () => {
  const readFile = async () => {
    throw Object.assign(new Error("nema fajla"), { code: "ENOENT" });
  };
  const r = await citajPsi({ readFile });
  assert.deepEqual(r, { cpu: null, memory: null, io: null });
});

test("citajPsi: samo jedan fajl nedostaje, ostala dva se citaju nezavisno", async () => {
  const readFile = async (putanja) => {
    if (putanja === "/proc/pressure/memory") throw Object.assign(new Error("nema"), { code: "ENOENT" });
    return "some avg10=1.00 avg60=1.00 avg300=1.00 total=1\n";
  };
  const r = await citajPsi({ readFile });
  assert.equal(r.memory, null);
  assert.ok(r.cpu);
  assert.ok(r.io);
});

// ---- parsirajProcPidStat ----

test("parsirajProcPidStat: comm sa zagradama i razmakom, polja 14/15/22 tacno izvucena", () => {
  const sadrzaj = statLinija(1234, { utime: 1111, stime: 2222, starttime: 999999 });
  assert.deepEqual(parsirajProcPidStat(sadrzaj), {
    utimeTicks: 1111,
    stimeTicks: 2222,
    starttimeTicks: 999999,
  });
});

test("parsirajProcPidStat: nevalidan sadrzaj daje null", () => {
  assert.equal(parsirajProcPidStat(""), null);
  assert.equal(parsirajProcPidStat(undefined), null);
  assert.equal(parsirajProcPidStat("1234 (node)"), null); // nema polja poslije comm
});

// ---- citajPidStat ----

test("citajPidStat: uspjesno citanje", async () => {
  const readFile = async (putanja) => {
    assert.equal(putanja, "/proc/1234/stat");
    return statLinija(1234, { utime: 10, stime: 20, starttime: 30 });
  };
  assert.deepEqual(await citajPidStat(1234, { readFile }), { utimeTicks: 10, stimeTicks: 20, starttimeTicks: 30 });
});

test("citajPidStat: proces ne postoji (ENOENT) daje null", async () => {
  const readFile = async () => {
    throw Object.assign(new Error("nema"), { code: "ENOENT" });
  };
  assert.equal(await citajPidStat(9999, { readFile }), null);
});

// ---- cpuStabla ----

function readFileZaPidove(danasnjiPodaci) {
  return async (putanja) => {
    const m = putanja.match(/^\/proc\/(\d+)\/stat$/);
    if (!m) throw new Error(`neocekivana putanja: ${putanja}`);
    const pid = Number(m[1]);
    const podaci = danasnjiPodaci[pid];
    if (!podaci) throw Object.assign(new Error("nema"), { code: "ENOENT" });
    return statLinija(pid, podaci);
  };
}

test("cpuStabla: linux, dva pida sa istim starttimeTicks racunaju deltu i procenat", async () => {
  const prethodnoStanje = {
    poPidu: {
      100: { cpuSekundi: 15, identitetOznaka: 50000 }, // (1000+500)/100
      200: { cpuSekundi: 3, identitetOznaka: 60000 }, // (200+100)/100
    },
    ts: 1_000_000,
  };
  const readFile = readFileZaPidove({
    100: { utime: 1100, stime: 550, starttime: 50000 },
    200: { utime: 250, stime: 140, starttime: 60000 },
  });
  const r = await cpuStabla([100, 200], {
    platform: "linux",
    readFile,
    prethodnoStanje,
    sadaMs: 1_000_000 + 2000, // 2 sekunde proteklo
  });
  // danas: 100 -> (1100+550)/100=16.5 ; 200 -> (250+140)/100=3.9
  // delte: 100 -> 16.5-15=1.5 ; 200 -> 3.9-3=0.9 ; ukupno=2.4 CPU sekundi
  // pct = (2.4/2)*100 = 120
  assert.equal(r.pct, 120);
  assert.equal(r.izvor, "proc-delta");
  assert.deepEqual(r.pidoviBezBaze, []);
  assert.deepEqual(r.stanjeZaSutra, {
    poPidu: {
      100: { cpuSekundi: 16.5, identitetOznaka: 50000 },
      200: { cpuSekundi: 3.9, identitetOznaka: 60000 },
    },
    ts: 1_000_000 + 2000,
  });
});

test("cpuStabla: linux, razliciti starttimeTicks (PID reuse) ide u pidoviBezBaze, ne racuna se u deltu", async () => {
  const prethodnoStanje = {
    poPidu: { 100: { cpuSekundi: 15, identitetOznaka: 50000 } },
    ts: 1_000_000,
  };
  const readFile = readFileZaPidove({ 100: { utime: 10, stime: 5, starttime: 77777 } }); // drugi proces, isti pid
  const r = await cpuStabla([100], { platform: "linux", readFile, prethodnoStanje, sadaMs: 1_001_000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze, [100]);
});

test("cpuStabla: linux, nov pid bez baze ide u pidoviBezBaze", async () => {
  const prethodnoStanje = { poPidu: {}, ts: 1_000_000 };
  const readFile = readFileZaPidove({ 300: { utime: 1, stime: 1, starttime: 1 } });
  const r = await cpuStabla([300], { platform: "linux", readFile, prethodnoStanje, sadaMs: 1_001_000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze, [300]);
});

test("cpuStabla: linux, prethodnoStanje===null (prvi ikad poziv) - svi pidovi bez baze, pct:null, stanjeZaSutra popunjen", async () => {
  const readFile = readFileZaPidove({
    100: { utime: 10, stime: 5, starttime: 111 },
    200: { utime: 20, stime: 10, starttime: 222 },
  });
  const r = await cpuStabla([100, 200], { platform: "linux", readFile, prethodnoStanje: null, sadaMs: 5000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze.sort(), [100, 200]);
  assert.deepEqual(r.stanjeZaSutra, {
    poPidu: {
      100: { cpuSekundi: 0.15, identitetOznaka: 111 },
      200: { cpuSekundi: 0.3, identitetOznaka: 222 },
    },
    ts: 5000,
  });
});

// ---- parsirajPsCputime ----

test("parsirajPsCputime: format mm:ss", () => {
  assert.equal(parsirajPsCputime("02:30"), 150);
});

test("parsirajPsCputime: format hh:mm:ss", () => {
  assert.equal(parsirajPsCputime("01:02:03"), 3723);
});

test("parsirajPsCputime: format dd-hh:mm:ss", () => {
  assert.equal(parsirajPsCputime("2-03:04:05"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
});

test("parsirajPsCputime: nevalidan string daje null", () => {
  assert.equal(parsirajPsCputime(""), null);
  assert.equal(parsirajPsCputime(undefined), null);
  assert.equal(parsirajPsCputime("nije vrijeme"), null);
  assert.equal(parsirajPsCputime("1:2:3:4"), null);
});

test("parsirajPsCputime: stvaran macOS/BSD format MM:SS.CC (minute ne prelama u sate)", () => {
  // Izmjereno na macOS-u: `ps -o cputime=` UVIJEK ispisuje mm:ss.cc, cak i za stotine minuta
  // kumulativnog CPU vremena (npr. WindowServer "1416:40.82"), nikad hh:mm:ss.
  assert.equal(parsirajPsCputime("02:30.00"), 150);
  assert.equal(parsirajPsCputime("74:45.32"), 74 * 60 + 45.32);
  assert.equal(parsirajPsCputime("1416:40.82"), 1416 * 60 + 40.82);
});

// ---- parsirajPsKumulativno ----

test("parsirajPsKumulativno: normalan red, lstart sa razmacima ostaje netaknut", () => {
  const stdout = "1234 00:02:30 Mon Aug 12 10:00:00 2026\n";
  const r = parsirajPsKumulativno(stdout);
  assert.deepEqual(r, [{ pid: 1234, cpuSekundi: 150, startMarker: "Mon Aug 12 10:00:00 2026" }]);
});

test("parsirajPsKumulativno: vise redova", () => {
  const stdout = "100 00:00:10 Mon Jan  1 00:00:00 2026\n200 01:00:00 Tue Jan  2 01:02:03 2026\n";
  const r = parsirajPsKumulativno(stdout);
  assert.deepEqual(r, [
    { pid: 100, cpuSekundi: 10, startMarker: "Mon Jan  1 00:00:00 2026" },
    { pid: 200, cpuSekundi: 3600, startMarker: "Tue Jan  2 01:02:03 2026" },
  ]);
});

test("parsirajPsKumulativno: red koji ne parsira (nevalidan cputime) se preskace", () => {
  const stdout = "100 nije-vrijeme Mon Jan 1 2026\n200 00:00:05 Tue Jan 2 2026\n";
  const r = parsirajPsKumulativno(stdout);
  assert.deepEqual(r, [{ pid: 200, cpuSekundi: 5, startMarker: "Tue Jan 2 2026" }]);
});

test("parsirajPsKumulativno: stvaran macOS format (MM:SS.CC), lstart bez godine-razmaka", () => {
  const stdout = "   969 226:53.12 Thu Aug  6 12:24:00 2026    \n";
  const r = parsirajPsKumulativno(stdout);
  assert.deepEqual(r, [{ pid: 969, cpuSekundi: 226 * 60 + 53.12, startMarker: "Thu Aug  6 12:24:00 2026" }]);
});

test("parsirajPsKumulativno: prazan/nedefinisan izlaz daje prazan niz", () => {
  assert.deepEqual(parsirajPsKumulativno(""), []);
  assert.deepEqual(parsirajPsKumulativno(undefined), []);
});

// ---- citajPsKumulativno ----

test("citajPsKumulativno: uspjesno citanje", async () => {
  const { exec } = laznExec([{ stdout: "1234 00:01:00 Mon Aug 12 10:00:00 2026\n" }]);
  const r = await citajPsKumulativno({ exec });
  assert.deepEqual(r, [{ pid: 1234, cpuSekundi: 60, startMarker: "Mon Aug 12 10:00:00 2026" }]);
});

test("citajPsKumulativno: exec koji baci daje null", async () => {
  const { exec } = laznExec([new Error("ps ne postoji")]);
  assert.equal(await citajPsKumulativno({ exec }), null);
});

// ---- cpuStabla na macOS (darwin) ----

function laznExecPsKumulativno(stdout) {
  return async () => ({ stdout });
}

test("cpuStabla: darwin, ista bazna oznaka (startMarker) racuna deltu preko cputime", async () => {
  const prethodnoStanje = {
    poPidu: { 500: { cpuSekundi: 10, identitetOznaka: "Mon Aug 12 09:00:00 2026" } },
    ts: 1_000_000,
  };
  const exec = laznExecPsKumulativno("500 00:00:25 Mon Aug 12 09:00:00 2026\n600 00:00:05 Mon Aug 12 09:30:00 2026\n");
  const r = await cpuStabla([500], {
    platform: "darwin",
    exec,
    prethodnoStanje,
    sadaMs: 1_000_000 + 5000, // 5 sekundi proteklo
  });
  // delta cpuSekundi = 25-10 = 15, proteklo 5s -> pct = (15/5)*100 = 300
  assert.equal(r.pct, 300);
  assert.equal(r.izvor, "ps-delta");
  assert.deepEqual(r.pidoviBezBaze, []);
  assert.deepEqual(r.stanjeZaSutra, {
    poPidu: { 500: { cpuSekundi: 25, identitetOznaka: "Mon Aug 12 09:00:00 2026" } },
    ts: 1_000_000 + 5000,
  });
});

test("cpuStabla: darwin, promijenjen startMarker (PID reuse) ide u pidoviBezBaze", async () => {
  const prethodnoStanje = {
    poPidu: { 500: { cpuSekundi: 10, identitetOznaka: "Mon Aug 12 09:00:00 2026" } },
    ts: 1_000_000,
  };
  const exec = laznExecPsKumulativno("500 00:00:03 Mon Aug 12 12:00:00 2026\n"); // drugi proces, isti pid
  const r = await cpuStabla([500], { platform: "darwin", exec, prethodnoStanje, sadaMs: 1_001_000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze, [500]);
});

test("cpuStabla: darwin, nov pid (nema ga u ps izlazu za trazeni spisak) ide u pidoviBezBaze", async () => {
  const prethodnoStanje = { poPidu: {}, ts: 1_000_000 };
  const exec = laznExecPsKumulativno("700 00:00:01 Mon Aug 12 09:00:00 2026\n");
  const r = await cpuStabla([700], { platform: "darwin", exec, prethodnoStanje, sadaMs: 1_001_000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze, [700]);
});

test("cpuStabla: darwin, prethodnoStanje===null (prvi ikad poziv) - svi pidovi bez baze, stanjeZaSutra popunjen", async () => {
  const exec = laznExecPsKumulativno("500 00:00:10 Mon Aug 12 09:00:00 2026\n600 00:00:20 Mon Aug 12 09:30:00 2026\n");
  const r = await cpuStabla([500, 600], { platform: "darwin", exec, prethodnoStanje: null, sadaMs: 5000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze.sort((a, b) => a - b), [500, 600]);
  assert.deepEqual(r.stanjeZaSutra, {
    poPidu: {
      500: { cpuSekundi: 10, identitetOznaka: "Mon Aug 12 09:00:00 2026" },
      600: { cpuSekundi: 20, identitetOznaka: "Mon Aug 12 09:30:00 2026" },
    },
    ts: 5000,
  });
});

test("cpuStabla: darwin, ps padne - svi trazeni pidovi bez baze, ne baca", async () => {
  const exec = async () => {
    throw new Error("ps ne postoji");
  };
  const r = await cpuStabla([500], { platform: "darwin", exec, prethodnoStanje: null, sadaMs: 1000 });
  assert.equal(r.pct, null);
  assert.deepEqual(r.pidoviBezBaze, [500]);
  assert.deepEqual(r.stanjeZaSutra, { poPidu: {}, ts: 1000 });
});

// ---- cpuStabloWindows ----

test("cpuStabloWindows: niz procesa, sabira samo pidove iz spiska", async () => {
  const json = JSON.stringify([
    { IDProcess: 100, PercentProcessorTime: 10 },
    { IDProcess: 200, PercentProcessorTime: 20 },
    { IDProcess: 300, PercentProcessorTime: 999 },
  ]);
  const { exec } = laznExec([{ stdout: json }]);
  const r = await cpuStabloWindows([100, 200], { exec });
  assert.deepEqual(r, { pct: 30, izvor: "win-perf-counter", tip: "snimak" });
});

test("cpuStabloWindows: tacno jedan proces dolazi kao objekat, ne niz", async () => {
  const json = JSON.stringify({ IDProcess: 100, PercentProcessorTime: 42 });
  const { exec } = laznExec([{ stdout: json }]);
  const r = await cpuStabloWindows([100], { exec });
  assert.deepEqual(r, { pct: 42, izvor: "win-perf-counter", tip: "snimak" });
});

test("cpuStabloWindows: exec koji baci daje null", async () => {
  const { exec } = laznExec([new Error("powershell ne postoji")]);
  assert.equal(await cpuStabloWindows([100], { exec }), null);
});

test("cpuStabloWindows: nevalidan JSON daje null", async () => {
  const { exec } = laznExec([{ stdout: "{ovo nije json" }]);
  assert.equal(await cpuStabloWindows([100], { exec }), null);
});

// ---- cpuStabla na win32 delegira na cpuStabloWindows ----

test("cpuStabla: platform win32 delegira na cpuStabloWindows", async () => {
  const json = JSON.stringify([{ IDProcess: 100, PercentProcessorTime: 55 }]);
  const { exec } = laznExec([{ stdout: json }]);
  const r = await cpuStabla([100], { platform: "win32", exec });
  assert.equal(r.pct, 55);
  assert.equal(r.izvor, "win-perf-counter");
  assert.deepEqual(r.pidoviBezBaze, []);
  assert.equal(r.stanjeZaSutra, null);
});
