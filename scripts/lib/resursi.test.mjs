// Testovi modula za uzorkovanje resursa. Isti stil kao straza.test.mjs: node:test +
// node:assert/strict, nikakva prava mreza, subprocess ni fajl sistem osim mkdtempSync tmp
// foldera. Sve zavisnosti (exec, readFile, totalmem/freemem/loadavg, sada) su injektovane lazne
// implementacije.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHEMA_VERZIJA,
  agregiraj,
  citajProcese,
  citajRedove,
  dijagnostikaSondi,
  ocistiStareResurse,
  parsirajPageFileUsage,
  parsirajProcMeminfo,
  parsirajPsRedove,
  parsirajSwapusage,
  parsirajVmStatSlobodno,
  parsirajWinProcese,
  pidoviStabla,
  pomakKlona,
  ponderisaniProsjek,
  putanjaDiska,
  putanjaResursa,
  redUzorka,
  rssStabla,
  uzorakMasine,
  uzorakMasineDetaljno,
  upisiRed,
  vrijemeUStrazi,
  zbirStabla,
} from "./resursi.mjs";

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

// ---- parsirajPsRedove ----

test("parsirajPsRedove: normalan izlaz sa vise redova", () => {
  const stdout = "  501     1  12345 node\n  502   501   2048 sh\n";
  const r = parsirajPsRedove(stdout);
  assert.deepEqual(r, [
    { pid: 501, ppid: 1, rssBajta: 12345 * 1024, comm: "node" },
    { pid: 502, ppid: 501, rssBajta: 2048 * 1024, comm: "sh" },
  ]);
});

test("parsirajPsRedove: prazan izlaz daje prazan niz", () => {
  assert.deepEqual(parsirajPsRedove(""), []);
  assert.deepEqual(parsirajPsRedove(undefined), []);
  assert.deepEqual(parsirajPsRedove("   \n  \n"), []);
});

test("parsirajPsRedove: visestruki razmaci izmedju polja se ispravno parsiraju", () => {
  const stdout = "   501      1       12345    node\n";
  const r = parsirajPsRedove(stdout);
  assert.deepEqual(r, [{ pid: 501, ppid: 1, rssBajta: 12345 * 1024, comm: "node" }]);
});

test("parsirajPsRedove: comm sa razmakom u sebi ostaje cio (puna putanja, ime sa razmakom)", () => {
  const stdout = "501 1 100 /usr/local/bin/Google Chrome Helper (Renderer)\n";
  const r = parsirajPsRedove(stdout);
  assert.equal(r.length, 1);
  assert.equal(r[0].comm, "/usr/local/bin/Google Chrome Helper (Renderer)");
});

test("parsirajPsRedove: neparsibilan red se preskace bez pada", () => {
  const stdout = "ovo nije ps red\n501 1 100 node\n";
  const r = parsirajPsRedove(stdout);
  assert.equal(r.length, 1);
  assert.equal(r[0].pid, 501);
});

// ---- parsirajWinProcese ----

test("parsirajWinProcese: niz od vise procesa", () => {
  const json = JSON.stringify([
    { ProcessId: 1, ParentProcessId: 0, WorkingSetSize: 1000, Name: "a.exe" },
    { ProcessId: 2, ParentProcessId: 1, WorkingSetSize: 2000, Name: "b.exe" },
  ]);
  const r = parsirajWinProcese(json);
  assert.deepEqual(r, [
    { pid: 1, ppid: 0, rssBajta: 1000, comm: "a.exe" },
    { pid: 2, ppid: 1, rssBajta: 2000, comm: "b.exe" },
  ]);
});

test("parsirajWinProcese: tacno jedan proces dolazi kao objekat, ne niz", () => {
  const json = JSON.stringify({ ProcessId: 5, ParentProcessId: 1, WorkingSetSize: 500, Name: "solo.exe" });
  const r = parsirajWinProcese(json);
  assert.deepEqual(r, [{ pid: 5, ppid: 1, rssBajta: 500, comm: "solo.exe" }]);
});

test("parsirajWinProcese: prazan string daje prazan niz", () => {
  assert.deepEqual(parsirajWinProcese(""), []);
  assert.deepEqual(parsirajWinProcese(undefined), []);
});

test("parsirajWinProcese: nevalidan JSON ne baca, vraca prazan niz", () => {
  assert.deepEqual(parsirajWinProcese("{ovo nije json"), []);
});

// ---- citajProcese ----

test("citajProcese: macOS/Linux grana zove ps i parsira kanonski izlaz", async () => {
  const { exec, pozivi } = laznExec([{ stdout: "1 0 100 launchd\n" }]);
  const r = await citajProcese({ platform: "darwin", exec });
  assert.deepEqual(r, [{ pid: 1, ppid: 0, rssBajta: 100 * 1024, comm: "launchd" }]);
  assert.equal(pozivi[0].cmd, "ps");
  assert.deepEqual(pozivi[0].args, ["-axo", "pid=,ppid=,rss=,comm="]);
});

test("citajProcese: win32 grana zove powershell i parsira kanonski JSON izlaz", async () => {
  const json = JSON.stringify([{ ProcessId: 1, ParentProcessId: 0, WorkingSetSize: 100, Name: "System" }]);
  const { exec, pozivi } = laznExec([{ stdout: json }]);
  const r = await citajProcese({ platform: "win32", exec });
  assert.deepEqual(r, [{ pid: 1, ppid: 0, rssBajta: 100, comm: "System" }]);
  assert.equal(pozivi[0].cmd, "powershell");
  assert.match(pozivi[0].args.join(" "), /Win32_Process/);
});

test("citajProcese: exec koji baca (timeout) vraca null, ne baca", async () => {
  const { exec } = laznExec([new Error("timeout")]);
  const r = await citajProcese({ platform: "linux", exec });
  assert.equal(r, null);
});

// ---- zbirStabla ----

test("zbirStabla: linearni lanac A->B->C sabira sve rsseve", () => {
  const procesi = [
    { pid: 1, ppid: 0, rssBajta: 100 },
    { pid: 2, ppid: 1, rssBajta: 200 },
    { pid: 3, ppid: 2, rssBajta: 300 },
  ];
  assert.deepEqual(zbirStabla(procesi, 1), { ukupnoBajta: 600, brojProcesa: 3 });
});

test("zbirStabla: grananje - roditelj sa dvoje djece, svako sa svojim djetetom", () => {
  const procesi = [
    { pid: 1, ppid: 0, rssBajta: 10 },
    { pid: 2, ppid: 1, rssBajta: 20 },
    { pid: 3, ppid: 1, rssBajta: 30 },
    { pid: 4, ppid: 2, rssBajta: 40 },
    { pid: 5, ppid: 3, rssBajta: 50 },
  ];
  assert.deepEqual(zbirStabla(procesi, 1), { ukupnoBajta: 150, brojProcesa: 5 });
});

test("zbirStabla: rootPid koji ne postoji u nizu vraca null", () => {
  const procesi = [{ pid: 1, ppid: 0, rssBajta: 10 }];
  assert.equal(zbirStabla(procesi, 999), null);
});

test("zbirStabla: ciklus u ppid podacima ne zapinje u beskonacnu petlju", () => {
  const procesi = [
    { pid: 1, ppid: 2, rssBajta: 10 },
    { pid: 2, ppid: 1, rssBajta: 20 },
  ];
  const r = zbirStabla(procesi, 1);
  assert.deepEqual(r, { ukupnoBajta: 30, brojProcesa: 2 });
});

test("zbirStabla: proces koji navodno pokazuje na samog sebe se broji jednom", () => {
  const procesi = [{ pid: 1, ppid: 1, rssBajta: 10 }];
  const r = zbirStabla(procesi, 1);
  assert.deepEqual(r, { ukupnoBajta: 10, brojProcesa: 1 });
});

// ---- pidoviStabla ----

test("pidoviStabla: root sa dvoje djece i unukom vraca sve pid-ove stabla", () => {
  const procesi = [
    { pid: 1, ppid: 0, rssBajta: 10 },
    { pid: 2, ppid: 1, rssBajta: 20 },
    { pid: 3, ppid: 1, rssBajta: 30 },
    { pid: 4, ppid: 2, rssBajta: 40 },
  ];
  const r = pidoviStabla(procesi, 1);
  assert.deepEqual([...r].sort(), [1, 2, 3, 4]);
});

test("pidoviStabla: rootPid koji ne postoji u nizu vraca null", () => {
  const procesi = [{ pid: 1, ppid: 0, rssBajta: 10 }];
  assert.equal(pidoviStabla(procesi, 999), null);
});

test("pidoviStabla: ciklus u ppid podacima ne zapinje u beskonacnu petlju", () => {
  const procesi = [
    { pid: 1, ppid: 2, rssBajta: 10 },
    { pid: 2, ppid: 1, rssBajta: 20 },
  ];
  const r = pidoviStabla(procesi, 1);
  assert.deepEqual([...r].sort(), [1, 2]);
});

// ---- rssStabla ----

test("rssStabla: citajProcese pa zbirStabla", async () => {
  const { exec } = laznExec([{ stdout: "1 0 100 a\n2 1 200 b\n" }]);
  const r = await rssStabla(1, { platform: "linux", exec });
  assert.deepEqual(r, { ukupnoBajta: 300 * 1024, brojProcesa: 2 });
});

test("rssStabla: null ako citajProcese padne", async () => {
  const { exec } = laznExec([new Error("x")]);
  const r = await rssStabla(1, { platform: "linux", exec });
  assert.equal(r, null);
});

// ---- parsirajProcMeminfo ----

test("parsirajProcMeminfo: normalan tekst", () => {
  const sadrzaj = [
    "MemTotal:       16384000 kB",
    "MemFree:         1000000 kB",
    "MemAvailable:    4000000 kB",
    "SwapTotal:       2048000 kB",
    "SwapFree:        1024000 kB",
  ].join("\n");
  const r = parsirajProcMeminfo(sadrzaj);
  assert.deepEqual(r, {
    ukupnoBajta: 16384000 * 1024,
    slobodnoBajta: 4000000 * 1024,
    swapUkupnoBajta: 2048000 * 1024,
    swapSlobodnoBajta: 1024000 * 1024,
  });
});

test("parsirajProcMeminfo: prazan/nepotpun sadrzaj daje null polja, ne baca", () => {
  assert.deepEqual(parsirajProcMeminfo(""), {
    ukupnoBajta: null,
    slobodnoBajta: null,
    swapUkupnoBajta: null,
    swapSlobodnoBajta: null,
  });
  const djelomican = parsirajProcMeminfo("MemTotal:  1000 kB\n");
  assert.equal(djelomican.ukupnoBajta, 1000 * 1024);
  assert.equal(djelomican.slobodnoBajta, null);
});

// ---- parsirajVmStatSlobodno ----

test("parsirajVmStatSlobodno: normalan vm_stat izlaz, velicina stranice se ne pretpostavlja", () => {
  const sadrzaj = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                               1000.",
    "Pages active:                             2000.",
    "Pages inactive:                            500.",
  ].join("\n");
  assert.equal(parsirajVmStatSlobodno(sadrzaj), (1000 + 500) * 16384);
});

test("parsirajVmStatSlobodno: neocekivan format vraca null", () => {
  assert.equal(parsirajVmStatSlobodno("nesto sasvim drugo"), null);
  assert.equal(parsirajVmStatSlobodno(""), null);
});

// ---- parsirajSwapusage ----

test("parsirajSwapusage: normalan sysctl izlaz", () => {
  const sadrzaj = "vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)";
  assert.deepEqual(parsirajSwapusage(sadrzaj), { ukupnoBajta: 2048 * 1024 * 1024, koristenoBajta: 512 * 1024 * 1024 });
});

test("parsirajSwapusage: neocekivan format vraca null", () => {
  assert.equal(parsirajSwapusage("nema tu nista korisno"), null);
  assert.equal(parsirajSwapusage(""), null);
});

// ---- parsirajPageFileUsage ----

test("parsirajPageFileUsage: normalan JSON (jedan pagefile kao objekat)", () => {
  const json = JSON.stringify({ AllocatedBaseSize: 4096, CurrentUsage: 1024 });
  assert.deepEqual(parsirajPageFileUsage(json), {
    ukupnoBajta: 4096 * 1024 * 1024,
    koristenoBajta: 1024 * 1024 * 1024,
  });
});

test("parsirajPageFileUsage: prazan niz (nema pagefile-a) vraca null, ne nulu", () => {
  assert.equal(parsirajPageFileUsage("[]"), null);
});

test("parsirajPageFileUsage: nevalidan JSON vraca null", () => {
  assert.equal(parsirajPageFileUsage("{ovo nije json"), null);
  assert.equal(parsirajPageFileUsage(""), null);
});

// ---- uzorakMasineDetaljno ----

test("uzorakMasineDetaljno: linux grana cita /proc/meminfo za slobodno i swap, loadavg za load", async () => {
  const meminfo = [
    "MemTotal:       16384000 kB",
    "MemAvailable:    4000000 kB",
    "SwapTotal:       2048000 kB",
    "SwapFree:        1024000 kB",
  ].join("\n");
  const readFile = async () => meminfo;
  const r = await uzorakMasineDetaljno({
    platform: "linux",
    readFile,
    totalmem: () => 16384000 * 1024,
    loadavg: () => [1.2, 0.9, 0.7],
  });
  assert.deepEqual(r.vrijednosti, {
    ukupnoBajta: 16384000 * 1024,
    slobodnoBajta: 4000000 * 1024,
    swapUkupnoBajta: 2048000 * 1024,
    swapKoristenoBajta: (2048000 - 1024000) * 1024,
    load1: 1.2,
    load5: 0.9,
    load15: 0.7,
  });
  assert.ok(r.detalji.every((d) => d.ok === true));
});

test("uzorakMasineDetaljno: darwin grana cita vm_stat i sysctl", async () => {
  const { exec } = laznExec((cmd) => {
    if (cmd === "vm_stat") {
      return {
        stdout: "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:  1000.\nPages inactive:  500.\n",
      };
    }
    if (cmd === "sysctl") {
      return { stdout: "total = 2048.00M  used = 512.00M  free = 1536.00M" };
    }
    throw new Error(`neocekivana komanda ${cmd}`);
  });
  const r = await uzorakMasineDetaljno({
    platform: "darwin",
    exec,
    totalmem: () => 17179869184,
    loadavg: () => [0.1, 0.2, 0.3],
  });
  assert.equal(r.vrijednosti.slobodnoBajta, 1500 * 4096);
  assert.equal(r.vrijednosti.swapUkupnoBajta, 2048 * 1024 * 1024);
  assert.equal(r.vrijednosti.swapKoristenoBajta, 512 * 1024 * 1024);
  assert.deepEqual([r.vrijednosti.load1, r.vrijednosti.load5, r.vrijednosti.load15], [0.1, 0.2, 0.3]);
  assert.ok(r.detalji.every((d) => d.ok === true));
});

test("uzorakMasineDetaljno: win32 grana koristi freemem sinhrono i powershell za pagefile, load je null", async () => {
  const { exec } = laznExec([{ stdout: JSON.stringify({ AllocatedBaseSize: 2048, CurrentUsage: 100 }) }]);
  const r = await uzorakMasineDetaljno({
    platform: "win32",
    exec,
    totalmem: () => 1000,
    freemem: () => 500,
  });
  assert.equal(r.vrijednosti.slobodnoBajta, 500);
  assert.equal(r.vrijednosti.swapUkupnoBajta, 2048 * 1024 * 1024);
  assert.equal(r.vrijednosti.swapKoristenoBajta, 100 * 1024 * 1024);
  assert.deepEqual([r.vrijednosti.load1, r.vrijednosti.load5, r.vrijednosti.load15], [null, null, null]);
  const loadDetalj = r.detalji.find((d) => d.naziv === "masina-load");
  assert.equal(loadDetalj.ok, true);
});

test("uzorakMasineDetaljno: samo swap sonda padne, ostatak polja ostaje popunjen (nezavisnost)", async () => {
  const { exec } = laznExec((cmd) => {
    if (cmd === "vm_stat") {
      return { stdout: "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:  1000.\nPages inactive:  0.\n" };
    }
    if (cmd === "sysctl") throw new Error("sysctl nedostupan");
    throw new Error(`neocekivana komanda ${cmd}`);
  });
  const r = await uzorakMasineDetaljno({
    platform: "darwin",
    exec,
    totalmem: () => 1000,
    loadavg: () => [1, 1, 1],
  });
  assert.equal(r.vrijednosti.ukupnoBajta, 1000);
  assert.equal(r.vrijednosti.slobodnoBajta, 1000 * 4096);
  assert.equal(r.vrijednosti.swapUkupnoBajta, null);
  assert.equal(r.vrijednosti.swapKoristenoBajta, null);
  assert.deepEqual([r.vrijednosti.load1, r.vrijednosti.load5, r.vrijednosti.load15], [1, 1, 1]);
  const nazivi = Object.fromEntries(r.detalji.map((d) => [d.naziv, d.ok]));
  assert.equal(nazivi["masina-swap"], false);
  assert.equal(nazivi["masina-slobodno"], true);
  assert.equal(nazivi["masina-ukupno"], true);
  assert.equal(nazivi["masina-load"], true);
});

// ---- uzorakMasine ----

test("uzorakMasine: tanak omotac vraca samo .vrijednosti", async () => {
  const r = await uzorakMasine({ platform: "win32", totalmem: () => 10, freemem: () => 5, exec: async () => { throw new Error("nema pagefile"); } });
  assert.equal(r.ukupnoBajta, 10);
  assert.equal(r.slobodnoBajta, 5);
  assert.equal(r.load1, null);
});

// ---- pomakKlona ----

test("pomakKlona: isti ulaz uvijek daje isti izlaz", () => {
  const a = pomakKlona("/Users/x/klijenti/pero", 5);
  const b = pomakKlona("/Users/x/klijenti/pero", 5);
  assert.equal(a, b);
});

test("pomakKlona: razlicite putanje obicno daju razlicit izlaz", () => {
  const a = pomakKlona("/Users/x/klijenti/pero", 97);
  const b = pomakKlona("/Users/x/klijenti/zoran", 97);
  assert.notEqual(a, b);
});

test("pomakKlona: izlaz je uvijek >= 0 i < mod", () => {
  for (const put of ["a", "abc", "/duga/putanja/koja/ima/vise/segmenata", ""]) {
    const r = pomakKlona(put, 7);
    assert.ok(r >= 0 && r < 7);
  }
});

test("pomakKlona: mod=1 uvijek daje 0", () => {
  assert.equal(pomakKlona("bilo-sta", 1), 0);
  assert.equal(pomakKlona("", 1), 0);
});

// ---- redUzorka ----

test("redUzorka: puni default oblik, sve null osim sheme", () => {
  const r = redUzorka();
  assert.equal(r.shema, SHEMA_VERZIJA);
  for (const kljuc of Object.keys(r)) {
    if (kljuc === "shema") continue;
    assert.equal(r[kljuc], null, `ocekivano null za ${kljuc}`);
  }
});

test("redUzorka: override pojedinih polja", () => {
  const r = redUzorka({ ts: "2026-08-12T10:00:00.000Z", klon: "pero", tip: "klijent", sesijaZiva: true, uStrazi: false });
  assert.equal(r.ts, "2026-08-12T10:00:00.000Z");
  assert.equal(r.klon, "pero");
  assert.equal(r.tip, "klijent");
  assert.equal(r.sesija_ziva, true);
  assert.equal(r.u_strazi, false);
  assert.equal(r.dogadjaj, null);
});

test("redUzorka: masina objekat se raspakuje u masina_* polja", () => {
  const r = redUzorka({
    masina: {
      ukupnoBajta: 1,
      slobodnoBajta: 2,
      swapUkupnoBajta: 3,
      swapKoristenoBajta: 4,
      load1: 5,
      load5: 6,
      load15: 7,
    },
  });
  assert.equal(r.masina_ukupno_bajta, 1);
  assert.equal(r.masina_slobodno_bajta, 2);
  assert.equal(r.masina_swap_ukupno_bajta, 3);
  assert.equal(r.masina_swap_koristeno_bajta, 4);
  assert.equal(r.masina_load1, 5);
  assert.equal(r.masina_load5, 6);
  assert.equal(r.masina_load15, 7);
});

test("redUzorka: cpuKlonaPct se upisuje tacno, izostavljeno daje null", () => {
  const saVrijednoscu = redUzorka({ cpuKlonaPct: 12.5 });
  assert.equal(saVrijednoscu.cpu_klona_pct, 12.5);

  const bezVrijednosti = redUzorka({});
  assert.equal(bezVrijednosti.cpu_klona_pct, null);
});

test("redUzorka: SHEMA_VERZIJA je 2 i upisuje se u red", () => {
  assert.equal(SHEMA_VERZIJA, 2);
  const r = redUzorka();
  assert.equal(r.shema, 2);
});

// ---- putanjaResursa ----

test("putanjaResursa: default putanja sa vodecom nulom u mjesecu", () => {
  const r = putanjaResursa({}, new Date(2026, 0, 15));
  assert.equal(r, ".olx-pik/resursi/resursi-2026-01.jsonl");
});

test("putanjaResursa: override kroz OLX_RESURSI_DIR", () => {
  const r = putanjaResursa({ OLX_RESURSI_DIR: "/tmp/moji-resursi" }, new Date(2026, 11, 1));
  assert.equal(r, "/tmp/moji-resursi/resursi-2026-12.jsonl");
});

// ---- putanjaDiska ----

test("putanjaDiska: default putanja sa vodecom nulom u mjesecu", () => {
  const r = putanjaDiska({}, new Date(2026, 0, 15));
  assert.equal(r, ".olx-pik/resursi/disk-2026-01.jsonl");
});

test("putanjaDiska: override kroz OLX_RESURSI_DIR", () => {
  const r = putanjaDiska({ OLX_RESURSI_DIR: "/tmp/moji-resursi" }, new Date(2026, 11, 1));
  assert.equal(r, "/tmp/moji-resursi/disk-2026-12.jsonl");
});

// ---- upisiRed / citajRedove ----

test("upisiRed pa citajRedove: pisanje i citanje dva reda", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    const putanja = join(dir, "resursi-2026-08.jsonl");
    assert.equal(upisiRed(putanja, { a: 1 }), true);
    assert.equal(upisiRed(putanja, { a: 2 }), true);
    const redovi = citajRedove([putanja]);
    assert.deepEqual(redovi, [{ a: 1 }, { a: 2 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("citajRedove: nevalidan red u fajlu se preskace bez pada", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    const putanja = join(dir, "x.jsonl");
    writeFileSync(putanja, '{"a":1}\novo nije json\n{"a":2}\n\n', "utf8");
    assert.deepEqual(citajRedove([putanja]), [{ a: 1 }, { a: 2 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("citajRedove: fajl koji ne postoji se tiho preskace, vraca prazan niz", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    assert.deepEqual(citajRedove([join(dir, "nema-ga.jsonl")]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upisiRed: kreira direktorij ako ne postoji", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    const putanja = join(dir, "podfolder", "resursi-2026-08.jsonl");
    assert.equal(upisiRed(putanja, { a: 1 }), true);
    assert.ok(existsSync(putanja));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ocistiStareResurse ----

test("ocistiStareResurse: brise fajlove starije od cuvajMjeseci, cuva novije", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    writeFileSync(join(dir, "resursi-2025-01.jsonl"), "");
    writeFileSync(join(dir, "resursi-2026-06.jsonl"), "");
    writeFileSync(join(dir, "resursi-2026-08.jsonl"), "");
    writeFileSync(join(dir, "necega-drugo.txt"), "");
    const r = ocistiStareResurse(dir, { cuvajMjeseci: 6, sada: () => new Date(2026, 7, 15) });
    assert.equal(r.obrisano, 1);
    assert.equal(existsSync(join(dir, "resursi-2025-01.jsonl")), false);
    assert.equal(existsSync(join(dir, "resursi-2026-06.jsonl")), true);
    assert.equal(existsSync(join(dir, "resursi-2026-08.jsonl")), true);
    assert.equal(existsSync(join(dir, "necega-drugo.txt")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ocistiStareResurse: direktorij koji ne postoji vraca {obrisano:0} bez greske", () => {
  assert.deepEqual(ocistiStareResurse("/ne/postoji/nikad/ovaj/folder"), { obrisano: 0 });
});

test("ocistiStareResurse: cisti oba prefiksa (resursi-* i disk-*) u istom prolazu, ostalo ostaje netaknuto", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    writeFileSync(join(dir, "resursi-2025-01.jsonl"), "");
    writeFileSync(join(dir, "resursi-2026-08.jsonl"), "");
    writeFileSync(join(dir, "disk-2025-01.jsonl"), "");
    writeFileSync(join(dir, "disk-2026-08.jsonl"), "");
    writeFileSync(join(dir, "nesto-drugo.jsonl"), "");
    const r = ocistiStareResurse(dir, { cuvajMjeseci: 6, sada: () => new Date(2026, 7, 15) });
    assert.equal(r.obrisano, 2);
    assert.equal(existsSync(join(dir, "resursi-2025-01.jsonl")), false);
    assert.equal(existsSync(join(dir, "disk-2025-01.jsonl")), false);
    assert.equal(existsSync(join(dir, "resursi-2026-08.jsonl")), true);
    assert.equal(existsSync(join(dir, "disk-2026-08.jsonl")), true);
    assert.equal(existsSync(join(dir, "nesto-drugo.jsonl")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ocistiStareResurse: cisti i treci prefiks masina-* (nadzor-flote.mjs dnevni uzorak masine)", () => {
  const dir = mkdtempSync(join(tmpdir(), "resursi-test-"));
  try {
    writeFileSync(join(dir, "masina-2025-01.jsonl"), "");
    writeFileSync(join(dir, "masina-2026-08.jsonl"), "");
    const r = ocistiStareResurse(dir, { cuvajMjeseci: 6, sada: () => new Date(2026, 7, 15) });
    assert.equal(r.obrisano, 1);
    assert.equal(existsSync(join(dir, "masina-2025-01.jsonl")), false);
    assert.equal(existsSync(join(dir, "masina-2026-08.jsonl")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ponderisaniProsjek ----

test("ponderisaniProsjek: normalan slucaj", () => {
  const r = ponderisaniProsjek([
    { vrijednost: 10, tezina: 1 },
    { vrijednost: 20, tezina: 3 },
  ]);
  assert.equal(r, (10 * 1 + 20 * 3) / 4);
});

test("ponderisaniProsjek: null vrijednosti se preskacu", () => {
  const r = ponderisaniProsjek([
    { vrijednost: null, tezina: 5 },
    { vrijednost: 10, tezina: 2 },
  ]);
  assert.equal(r, 10);
});

test("ponderisaniProsjek: prazan niz vraca null", () => {
  assert.equal(ponderisaniProsjek([]), null);
  assert.equal(ponderisaniProsjek([{ vrijednost: null, tezina: 1 }]), null);
});

// ---- vrijemeUStrazi ----

test("vrijemeUStrazi: jedan potpuno zatvoren par gasenje-straze -> budjenje", () => {
  const redovi = [
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T10:30:00.000Z", dogadjaj: "budjenje", hladni_start_ms: 1000 },
  ];
  const r = vrijemeUStrazi(redovi);
  assert.equal(r.ms, 30 * 60_000);
  assert.equal(r.izvor, "dogadjaji");
});

test("vrijemeUStrazi: nesparen gasenje-straze na kraju sa uzorcima u strazi poslije - uzorci", () => {
  const redovi = [
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T10:05:00.000Z", dogadjaj: null, u_strazi: true, interval_min: 5 },
    { ts: "2026-08-12T10:10:00.000Z", dogadjaj: null, u_strazi: true, interval_min: 5 },
  ];
  const r = vrijemeUStrazi(redovi);
  assert.equal(r.ms, 10 * 60_000);
  assert.equal(r.izvor, "uzorci");
});

test("vrijemeUStrazi: mjesavina - zatvoren par pa nesparen gasenje sa uzorcima poslije - dogadjaji+uzorci", () => {
  const redovi = [
    { ts: "2026-08-12T08:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T08:10:00.000Z", dogadjaj: "budjenje" },
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T10:05:00.000Z", dogadjaj: null, u_strazi: true, interval_min: 5 },
  ];
  const r = vrijemeUStrazi(redovi);
  assert.equal(r.ms, 10 * 60_000 + 5 * 60_000);
  assert.equal(r.izvor, "dogadjaji+uzorci");
});

test("vrijemeUStrazi: nema nikakvih dogadjaja ni uzoraka u strazi - nepoznato, ms:0", () => {
  const redovi = [
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: null, u_strazi: false, interval_min: 5 },
  ];
  const r = vrijemeUStrazi(redovi);
  assert.deepEqual(r, { ms: 0, izvor: "nepoznato" });
  assert.deepEqual(vrijemeUStrazi([]), { ms: 0, izvor: "nepoznato" });
});

test("vrijemeUStrazi: vise uzastopnih parova se sabiraju", () => {
  const redovi = [
    { ts: "2026-08-12T08:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T08:10:00.000Z", dogadjaj: "budjenje" },
    { ts: "2026-08-12T09:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T09:20:00.000Z", dogadjaj: "budjenje" },
  ];
  const r = vrijemeUStrazi(redovi);
  assert.equal(r.ms, 10 * 60_000 + 20 * 60_000);
  assert.equal(r.izvor, "dogadjaji");
});

test("vrijemeUStrazi: gasenje-idle (most) se broji identicno kao gasenje-straze", () => {
  const redoviStraza = [
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: "gasenje-straze" },
    { ts: "2026-08-12T10:30:00.000Z", dogadjaj: "budjenje" },
  ];
  const redoviMost = [
    { ts: "2026-08-12T10:00:00.000Z", dogadjaj: "gasenje-idle" },
    { ts: "2026-08-12T10:30:00.000Z", dogadjaj: "budjenje" },
  ];
  assert.deepEqual(vrijemeUStrazi(redoviMost), vrijemeUStrazi(redoviStraza));
});

// ---- agregiraj ----

test("agregiraj: prazan niz vraca sve null/0 bez pada", () => {
  const r = agregiraj([]);
  assert.equal(r.brojUzoraka, 0);
  assert.deepEqual(r.period, { od: null, do: null });
  assert.equal(r.cuvarRss.prosjekBajta, null);
  assert.deepEqual(r.savjeti, []);
  assert.deepEqual(r.padovi, { broj: 0 });
  assert.equal(r.cpuKlona, null);
});

test("agregiraj: cpuKlona je null kad nijedan red nema cpu_klona_pct (sav period shema:1)", () => {
  const redovi = [
    redUzorka({ ts: "2026-08-12T08:00:00.000Z", intervalMin: 5, stabloRssBajta: 100_000_000 }),
    redUzorka({ ts: "2026-08-12T08:05:00.000Z", intervalMin: 5, stabloRssBajta: 105_000_000 }),
  ];
  const r = agregiraj(redovi);
  assert.equal(r.cpuKlona, null);
});

test("agregiraj: mjesoviti shema:1/shema:2 period racuna cpuKlona samo preko redova sa vrijednoscu", () => {
  const redovi = [
    // "shema:1" simulacija: cpu_klona_pct polje uopste ne postoji na redu (stari cuvar).
    redUzorka({ ts: "2026-08-12T08:00:00.000Z", intervalMin: 5 }),
    redUzorka({ ts: "2026-08-12T08:05:00.000Z", intervalMin: 5 }),
    // "shema:2" simulacija: cuvar vec salje CPU% klona.
    redUzorka({ ts: "2026-08-12T08:10:00.000Z", intervalMin: 5, cpuKlonaPct: 10 }),
    redUzorka({ ts: "2026-08-12T08:15:00.000Z", intervalMin: 10, cpuKlonaPct: 20 }),
  ];
  const r = agregiraj(redovi);
  assert.ok(r.cpuKlona !== null);
  // Tezinski prosjek SAMO preko redova sa vrijednoscu: (10*5 + 20*10) / (5+10) = 250/15
  assert.equal(r.cpuKlona.prosjekPct, 250 / 15);
  assert.equal(r.cpuKlona.peakPct, 20);
  assert.equal(r.cpuKlona.cpuPodaciOd, "2026-08-12T08:10:00.000Z");
});

test("agregiraj: normalan slucaj sa mjesavinom uzoraka i dogadjaja", () => {
  const redovi = [
    redUzorka({
      ts: "2026-08-12T08:00:00.000Z",
      intervalMin: 5,
      cuvarRssBajta: 40_000_000,
      stabloRssBajta: 200_000_000,
      masina: { slobodnoBajta: 3_000_000_000, swapKoristenoBajta: 100_000_000, swapUkupnoBajta: 2_000_000_000, load1: 1 },
    }),
    redUzorka({
      ts: "2026-08-12T08:05:00.000Z",
      dogadjaj: "pad",
      exitCode: 1,
    }),
    redUzorka({
      ts: "2026-08-12T08:10:00.000Z",
      dogadjaj: "budjenje",
      hladniStartMs: 5000,
    }),
    redUzorka({
      ts: "2026-08-12T08:15:00.000Z",
      intervalMin: 5,
      cuvarRssBajta: 42_000_000,
      stabloRssBajta: 210_000_000,
      masina: { slobodnoBajta: 3_100_000_000, swapKoristenoBajta: 90_000_000, swapUkupnoBajta: 2_000_000_000, load1: 0.8 },
    }),
  ];
  const r = agregiraj(redovi);
  assert.equal(r.brojUzoraka, 2);
  assert.equal(r.period.od, "2026-08-12T08:00:00.000Z");
  assert.equal(r.period.do, "2026-08-12T08:15:00.000Z");
  assert.equal(r.padovi.broj, 1);
  assert.equal(r.hladniStartovi.broj, 1);
  assert.equal(r.hladniStartovi.prosjekMs, 5000);
  assert.equal(r.cuvarRss.prosjekBajta, 41_000_000);
  assert.equal(r.cuvarRss.peakBajta, 42_000_000);
});

test("agregiraj: savjet o strazi se pojavljuje kad sesija nikad nije bila u strazi kroz dug period", () => {
  const redovi = [];
  const pocetak = new Date("2026-08-01T00:00:00.000Z").getTime();
  for (let i = 0; i < 5; i++) {
    redovi.push(
      redUzorka({
        ts: new Date(pocetak + i * 24 * 60 * 60_000).toISOString(),
        intervalMin: 5,
        uStrazi: false,
      }),
    );
  }
  const r = agregiraj(redovi);
  assert.ok(r.savjeti.some((s) => /strazi/i.test(s) && /OLX_MOST_IDLE_MIN/.test(s)));
});

test("agregiraj: savjet o strazi se NE pojavljuje kad je perioda kratak ili je straza bila aktivna", () => {
  const redovi = [
    redUzorka({ ts: "2026-08-12T08:00:00.000Z", intervalMin: 5 }),
    redUzorka({ ts: "2026-08-12T08:05:00.000Z", intervalMin: 5 }),
  ];
  const r = agregiraj(redovi);
  assert.ok(!r.savjeti.some((s) => /OLX_MOST_IDLE_MIN/.test(s)));
});

test("agregiraj: NIKAD ne prijavljuje moguce curenje SAMO na osnovu rasta RSS-a (masina u redu)", () => {
  const redovi = [];
  for (let i = 0; i < 8; i++) {
    redovi.push(
      redUzorka({
        ts: `2026-08-12T${String(8 + i).padStart(2, "0")}:00:00.000Z`,
        intervalMin: 5,
        stabloRssBajta: 100_000_000 + i * 50_000_000, // ocigledan rast RSS-a
        masina: {
          slobodnoBajta: 3_000_000_000, // stabilno visoka
          swapKoristenoBajta: 10_000_000, // nizak i stabilan
          swapUkupnoBajta: 2_000_000_000,
        },
      }),
    );
  }
  const r = agregiraj(redovi);
  assert.ok(!r.savjeti.some((s) => /curenj/i.test(s)));
});

test("agregiraj: prijavljuje moguce curenje kad RSS raste I slobodna memorija pada", () => {
  const redovi = [];
  for (let i = 0; i < 8; i++) {
    redovi.push(
      redUzorka({
        ts: `2026-08-12T${String(8 + i).padStart(2, "0")}:00:00.000Z`,
        intervalMin: 5,
        stabloRssBajta: 100_000_000 + i * 50_000_000,
        masina: {
          slobodnoBajta: 3_000_000_000 - i * 300_000_000, // opada
          swapKoristenoBajta: 10_000_000,
          swapUkupnoBajta: 2_000_000_000,
        },
      }),
    );
  }
  const r = agregiraj(redovi);
  assert.ok(r.savjeti.some((s) => /curenj/i.test(s)));
});

test("agregiraj: prijavljuje moguce curenje kad RSS raste I swap postane znacajan", () => {
  const redovi = [];
  for (let i = 0; i < 8; i++) {
    redovi.push(
      redUzorka({
        ts: `2026-08-12T${String(8 + i).padStart(2, "0")}:00:00.000Z`,
        intervalMin: 5,
        stabloRssBajta: 100_000_000 + i * 50_000_000,
        masina: {
          slobodnoBajta: 3_000_000_000,
          swapKoristenoBajta: i < 4 ? 10_000_000 : 500_000_000, // preko 10% od 2GB u drugoj polovini
          swapUkupnoBajta: 2_000_000_000,
        },
      }),
    );
  }
  const r = agregiraj(redovi);
  assert.ok(r.savjeti.some((s) => /curenj/i.test(s)));
});

test("agregiraj: hladan start prosjecno preko 20000ms daje savjet", () => {
  const redovi = [
    redUzorka({ ts: "2026-08-12T08:00:00.000Z", dogadjaj: "budjenje", hladniStartMs: 25_000 }),
    redUzorka({ ts: "2026-08-12T09:00:00.000Z", dogadjaj: "budjenje", hladniStartMs: 30_000 }),
  ];
  const r = agregiraj(redovi);
  assert.ok(r.savjeti.some((s) => /hladan start/i.test(s)));
});

test("agregiraj: vise od 3 pada u periodu daje savjet o cron logu", () => {
  const redovi = [1, 2, 3, 4].map((i) =>
    redUzorka({ ts: `2026-08-12T0${i}:00:00.000Z`, dogadjaj: "pad" }),
  );
  const r = agregiraj(redovi);
  assert.ok(r.savjeti.some((s) => /cron-\*\.log/.test(s)));
});

// ---- dijagnostikaSondi ----

test("dijagnostikaSondi: sve sonde uspijevaju", async () => {
  const { exec } = laznExec((cmd) => {
    if (cmd === "ps") return { stdout: `${process.pid} 1 1000 test-proces\n` };
    if (cmd === "vm_stat") {
      return { stdout: "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:  100.\nPages inactive:  50.\n" };
    }
    if (cmd === "sysctl") return { stdout: "total = 100.00M used = 10.00M free = 90.00M" };
    throw new Error(`neocekivana komanda ${cmd}`);
  });
  const r = await dijagnostikaSondi({ platform: "darwin", exec, totalmem: () => 1000, loadavg: () => [0, 0, 0] });
  assert.ok(r.every((d) => d.ok === true));
  const nazivi = r.map((d) => d.naziv).sort();
  assert.deepEqual(nazivi, ["masina-load", "masina-slobodno", "masina-swap", "masina-ukupno", "proces-tabela"].sort());
});

test("dijagnostikaSondi: sve sonde padaju, svaka ima ok:false i razlog, funkcija sama ne baca", async () => {
  const exec = async () => {
    throw new Error("sve je pokvareno");
  };
  const r = await dijagnostikaSondi({
    platform: "darwin",
    exec,
    totalmem: () => {
      throw new Error("totalmem nedostupan");
    },
    loadavg: () => {
      throw new Error("loadavg nedostupan");
    },
  });
  assert.ok(r.every((d) => d.ok === false));
  assert.ok(r.every((d) => typeof d.razlog === "string" && d.razlog.length > 0));
});
