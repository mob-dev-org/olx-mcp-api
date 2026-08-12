// Testovi modula za skeniranje diska. Isti stil kao resursi.test.mjs: node:test +
// node:assert/strict, bez pravog diska za obidjiDirektorijum/sazmiSkeniranje (mock fs kao obicni
// JS objekti/mape), exec za velicinaFolderaBrzo mockovan isto kako resursi.test.mjs mockuje
// citajProcese/uzorakMasineDetaljno.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOLDERI_KLIJENTSKOG_MATERIJALA,
  obidjiDirektorijum,
  sazmiSkeniranje,
  velicinaFolderaBrzo,
} from "./disk.mjs";

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

// Grešku iz promisify(execFile) simulira obican Error sa dodatim poljima (code/killed), isto
// kao sto ih Node stvarno postavlja.
function greskaKomande({ code, killed } = {}) {
  const e = new Error("komanda pala");
  if (code !== undefined) e.code = code;
  if (killed !== undefined) e.killed = killed;
  return e;
}

// Mock direktorijske strukture za obidjiDirektorijum: mapa putanja -> niz "dirent" stavki, i
// mapa putanja -> stat objekat (ili Error da statSync baci).
function mockFs({ direktorijumi, statovi, statBaca = new Set() } = {}) {
  const readdirSync = (put) => {
    const stavke = direktorijumi[put];
    if (!stavke) throw new Error(`ENOENT: ${put}`);
    return stavke;
  };
  const statSync = (put) => {
    if (statBaca.has(put)) throw new Error(`EACCES: ${put}`);
    const s = statovi[put];
    if (!s) throw new Error(`ENOENT: ${put}`);
    return s;
  };
  return { readdirSync, statSync };
}

function dirent(name, { direktorijum = false, fajl = false, simlink = false } = {}) {
  return {
    name,
    isDirectory: () => direktorijum,
    isFile: () => fajl,
    isSymbolicLink: () => simlink,
  };
}

// ---- obidjiDirektorijum ----

test("obidjiDirektorijum: rekurzija kroz podfoldere", () => {
  const { readdirSync, statSync } = mockFs({
    direktorijumi: {
      "/klon/a": [dirent("x.txt", { fajl: true }), dirent("pod", { direktorijum: true })],
      "/klon/a/pod": [dirent("y.txt", { fajl: true })],
    },
    statovi: {
      "/klon/a/x.txt": { size: 100, mtimeMs: 1000 },
      "/klon/a/pod/y.txt": { size: 200, mtimeMs: 2000 },
    },
  });
  const r = obidjiDirektorijum("/klon/a", { readdirSync, statSync });
  assert.deepEqual(
    r.sort((x, y) => x.relativnaPutanja.localeCompare(y.relativnaPutanja)),
    [
      { relativnaPutanja: "pod/y.txt", apsolutnaPutanja: "/klon/a/pod/y.txt", velicinaBajta: 200, mtimeMs: 2000 },
      { relativnaPutanja: "x.txt", apsolutnaPutanja: "/klon/a/x.txt", velicinaBajta: 100, mtimeMs: 1000 },
    ],
  );
});

test("obidjiDirektorijum: preskace .git direktorij", () => {
  const { readdirSync, statSync } = mockFs({
    direktorijumi: {
      "/klon": [dirent(".git", { direktorijum: true }), dirent("a.txt", { fajl: true })],
    },
    statovi: { "/klon/a.txt": { size: 5, mtimeMs: 1 } },
  });
  const r = obidjiDirektorijum("/klon", { readdirSync, statSync });
  assert.equal(r.length, 1);
  assert.equal(r[0].relativnaPutanja, "a.txt");
});

test("obidjiDirektorijum: fajl koji baca na statSync (dozvole) se preskace bez pada", () => {
  const { readdirSync, statSync } = mockFs({
    direktorijumi: {
      "/klon": [dirent("zabranjen.txt", { fajl: true }), dirent("ok.txt", { fajl: true })],
    },
    statovi: { "/klon/ok.txt": { size: 10, mtimeMs: 5 } },
    statBaca: new Set(["/klon/zabranjen.txt"]),
  });
  const r = obidjiDirektorijum("/klon", { readdirSync, statSync });
  assert.equal(r.length, 1);
  assert.equal(r[0].relativnaPutanja, "ok.txt");
});

test("obidjiDirektorijum: prazan folder vraca prazan niz", () => {
  const { readdirSync, statSync } = mockFs({ direktorijumi: { "/klon": [] }, statovi: {} });
  assert.deepEqual(obidjiDirektorijum("/klon", { readdirSync, statSync }), []);
});

test("obidjiDirektorijum: folder koji se ne moze procitati vraca prazan niz, ne baca", () => {
  const { readdirSync, statSync } = mockFs({ direktorijumi: {}, statovi: {} });
  assert.deepEqual(obidjiDirektorijum("/ne/postoji", { readdirSync, statSync }), []);
});

test("obidjiDirektorijum: relativne putanje koriste / separator i na dubljem nivou", () => {
  const { readdirSync, statSync } = mockFs({
    direktorijumi: {
      "/klon": [dirent("a", { direktorijum: true })],
      "/klon/a": [dirent("b", { direktorijum: true })],
      "/klon/a/b": [dirent("c.txt", { fajl: true })],
    },
    statovi: { "/klon/a/b/c.txt": { size: 1, mtimeMs: 1 } },
  });
  const r = obidjiDirektorijum("/klon", { readdirSync, statSync });
  assert.equal(r.length, 1);
  assert.equal(r[0].relativnaPutanja, "a/b/c.txt");
  assert.ok(!r[0].relativnaPutanja.includes("\\"));
});

test("obidjiDirektorijum: simbolicki link se ne prati (ne ulazi u rezultat, ne rekurzira se)", () => {
  const { readdirSync, statSync } = mockFs({
    direktorijumi: {
      "/klon": [dirent("link", { simlink: true }), dirent("ok.txt", { fajl: true })],
    },
    statovi: { "/klon/ok.txt": { size: 1, mtimeMs: 1 } },
  });
  const r = obidjiDirektorijum("/klon", { readdirSync, statSync });
  assert.equal(r.length, 1);
  assert.equal(r[0].relativnaPutanja, "ok.txt");
});

// ---- velicinaFolderaBrzo ----

test("velicinaFolderaBrzo: du uspjeh, parsira tab-separated izlaz", async () => {
  const { exec } = laznExec([{ stdout: "1234\t/neki/put\n" }]);
  const r = await velicinaFolderaBrzo("/neki/put", { platform: "darwin", exec });
  assert.deepEqual(r, { velicinaBajta: 1234 * 1024, izvor: "du", greska: null });
});

test("velicinaFolderaBrzo: du javlja da folder ne postoji -> 0, ne null", async () => {
  const { exec } = laznExec([greskaKomande({ code: 1 })]);
  const r = await velicinaFolderaBrzo("/nema/ga", { platform: "linux", exec });
  assert.deepEqual(r, { velicinaBajta: 0, izvor: "du", greska: null });
});

test("velicinaFolderaBrzo: exec baci (komanda ne postoji) -> fallback na node-hod preko injektovanog obidjiDirektorijumFn", async () => {
  const { exec } = laznExec([greskaKomande({ code: "ENOENT" })]);
  const obidjiDirektorijumFn = () => [
    { relativnaPutanja: "a", apsolutnaPutanja: "/x/a", velicinaBajta: 100, mtimeMs: 1 },
    { relativnaPutanja: "b", apsolutnaPutanja: "/x/b", velicinaBajta: 50, mtimeMs: 2 },
  ];
  const r = await velicinaFolderaBrzo("/x", { platform: "linux", exec, obidjiDirektorijumFn });
  assert.deepEqual(r, { velicinaBajta: 150, izvor: "node-hod", greska: null });
});

test("velicinaFolderaBrzo: exec baci (timeout) -> fallback na node-hod", async () => {
  const { exec } = laznExec([greskaKomande({ killed: true })]);
  const obidjiDirektorijumFn = () => [{ velicinaBajta: 7 }];
  const r = await velicinaFolderaBrzo("/x", { platform: "linux", exec, obidjiDirektorijumFn });
  assert.deepEqual(r, { velicinaBajta: 7, izvor: "node-hod", greska: null });
});

test("velicinaFolderaBrzo: konacan neuspjeh oba puta -> null sa greskom", async () => {
  const { exec } = laznExec([greskaKomande({ code: "ENOENT" })]);
  const obidjiDirektorijumFn = () => {
    throw new Error("ni node hod ne radi");
  };
  const r = await velicinaFolderaBrzo("/x", { platform: "linux", exec, obidjiDirektorijumFn });
  assert.equal(r.velicinaBajta, null);
  assert.equal(r.izvor, null);
  assert.equal(r.greska, "ni node hod ne radi");
});

test("velicinaFolderaBrzo: win32 uspjeh parsira broj iz powershell izlaza", async () => {
  const { exec, pozivi } = laznExec([{ stdout: "123456\r\n" }]);
  const r = await velicinaFolderaBrzo("C:\\klon\\dist", { platform: "win32", exec });
  assert.deepEqual(r, { velicinaBajta: 123456, izvor: "powershell", greska: null });
  assert.equal(pozivi[0].cmd, "powershell");
});

test("velicinaFolderaBrzo: win32 prazan izlaz (folder ne postoji) -> 0", async () => {
  const { exec } = laznExec([{ stdout: "" }]);
  const r = await velicinaFolderaBrzo("C:\\nema\\ga", { platform: "win32", exec });
  assert.deepEqual(r, { velicinaBajta: 0, izvor: "powershell", greska: null });
});

test("velicinaFolderaBrzo: win32 exec baci -> fallback na node-hod", async () => {
  const { exec } = laznExec([greskaKomande({ code: "ENOENT" })]);
  const obidjiDirektorijumFn = () => [{ velicinaBajta: 42 }];
  const r = await velicinaFolderaBrzo("C:\\x", { platform: "win32", exec, obidjiDirektorijumFn });
  assert.deepEqual(r, { velicinaBajta: 42, izvor: "node-hod", greska: null });
});

// ---- sazmiSkeniranje ----

test("sazmiSkeniranje: kategorizacija i ukupnoBajta zbir preskace null polja", () => {
  const r = sazmiSkeniranje({
    svojFajlovi: {
      olx_pik_snapshots: [{ velicinaBajta: 100 }, { velicinaBajta: 50 }],
      olx_pik_konkurenti: [{ velicinaBajta: 10 }],
    },
    teskeKategorije: {
      node_modules: { velicinaBajta: 1000, izvor: "du" },
      dist: { velicinaBajta: null, izvor: null },
    },
  });
  assert.deepEqual(r.kategorije.olx_pik_snapshots, { bajta: 150, broj: 2 });
  assert.deepEqual(r.kategorije.olx_pik_konkurenti, { bajta: 10, broj: 1 });
  assert.deepEqual(r.kategorije.node_modules, { bajta: 1000, izvor: "du" });
  assert.deepEqual(r.kategorije.dist, { bajta: null, izvor: null });
  assert.deepEqual(r.kategorije.olx_pik_arhiva, { bajta: 0, broj: 0 });
  // 150 + 10 + 1000, dist (null) preskocen
  assert.equal(r.ukupnoBajta, 1160);
});

test("sazmiSkeniranje: odVremena === null daje novihFajlova* null i prazan topNovi", () => {
  const r = sazmiSkeniranje({
    svojFajlovi: { olx_pik_ostalo: [{ relativnaPutanja: "a", velicinaBajta: 999, mtimeMs: 9_999_999_999 }] },
    odVremena: null,
  });
  assert.equal(r.novihFajlovaBroj, null);
  assert.equal(r.novihFajlovaBajta, null);
  assert.deepEqual(r.topNovi, []);
});

test("sazmiSkeniranje: topNovi postuje odVremena prag (samo mtime stariji od praga se izostavlja)", () => {
  const prag = new Date("2026-08-01T00:00:00.000Z");
  const r = sazmiSkeniranje({
    svojFajlovi: {
      olx_pik_ostalo: [
        { putanjaOdKorijena: ".olx-pik/staro.json", velicinaBajta: 500, mtimeMs: prag.getTime() - 1000 },
        { putanjaOdKorijena: ".olx-pik/novo.json", velicinaBajta: 300, mtimeMs: prag.getTime() + 1000 },
      ],
    },
    odVremena: prag,
  });
  assert.equal(r.novihFajlovaBroj, 1);
  assert.equal(r.novihFajlovaBajta, 300);
  assert.deepEqual(r.topNovi, [{ putanja: ".olx-pik/novo.json", velicinaBajta: 300, mtimeMs: prag.getTime() + 1000 }]);
});

test("sazmiSkeniranje: topNovi sortiran opadajuce po velicini i odsjecen na 10", () => {
  const prag = new Date(1000);
  const svojFajlovi = {
    olx_pik_resursi: Array.from({ length: 15 }, (_, i) => ({
      putanjaOdKorijena: `.olx-pik/resursi/f${i}.jsonl`,
      velicinaBajta: i,
      mtimeMs: 2000,
    })),
  };
  const r = sazmiSkeniranje({ svojFajlovi, odVremena: prag });
  assert.equal(r.novihFajlovaBroj, 15);
  assert.equal(r.topNovi.length, 10);
  assert.equal(r.topNovi[0].velicinaBajta, 14);
  assert.equal(r.topNovi[9].velicinaBajta, 5);
  for (let i = 1; i < r.topNovi.length; i++) {
    assert.ok(r.topNovi[i - 1].velicinaBajta >= r.topNovi[i].velicinaBajta);
  }
});

test("sazmiSkeniranje: node_modules/dist nikad ne mogu uci u topNovi (nemaju stavku u svojFajlovi)", () => {
  const prag = new Date(0);
  const r = sazmiSkeniranje({
    svojFajlovi: {
      // Cak i da neko pogresno gurne fajlove pod ova imena, KATEGORIJE_ZA_TOP_NOVI ih ne cita.
      node_modules: [{ putanjaOdKorijena: "node_modules/x", velicinaBajta: 999_999, mtimeMs: 999_999_999_999 }],
      dist: [{ putanjaOdKorijena: "dist/y", velicinaBajta: 999_999, mtimeMs: 999_999_999_999 }],
    },
    teskeKategorije: { node_modules: { velicinaBajta: 5000, izvor: "du" } },
    odVremena: prag,
  });
  assert.deepEqual(r.topNovi, []);
  assert.equal(r.novihFajlovaBroj, 0);
});

test("REGRESIJA: fajl iz FOLDERI_KLIJENTSKOG_MATERIJALA nikad ne izlazi u topNovi, bez obzira na velicinu/datum", () => {
  // .olx-pik/arhiva-artikala/<id>/01.jpg je fotografija klijentove robe, ne pogona. I kad bi bio
  // najveci i najnoviji fajl na klonu, ne smije se pojaviti poimenicno u sedmicnom izvjestaju o
  // disku (granice.md, sekcije "Slike" i "Trag i tajne": to je klijentov materijal, ne dokaz o
  // radu pogona, i izvjestaj vlasniku flote ne smije postati prozor u tudje artikle).
  assert.ok(FOLDERI_KLIJENTSKOG_MATERIJALA.includes(".olx-pik/arhiva-artikala"));
  const prag = new Date(0);
  const ogromnaNovaSlika = {
    putanjaOdKorijena: ".olx-pik/arhiva-artikala/78059920/01.jpg",
    relativnaPutanja: "78059920/01.jpg",
    velicinaBajta: 50_000_000, // daleko najveci fajl u ovom skeniranju
    mtimeMs: Date.now(), // upravo sad, definitivno "novo"
  };
  const r = sazmiSkeniranje({
    svojFajlovi: {
      olx_pik_arhiva: [ogromnaNovaSlika],
      olx_pik_ostalo: [{ putanjaOdKorijena: ".olx-pik/malo.json", velicinaBajta: 10, mtimeMs: Date.now() }],
    },
    odVremena: prag,
  });
  assert.deepEqual(r.kategorije.olx_pik_arhiva, { bajta: 50_000_000, broj: 1 });
  assert.ok(
    !r.topNovi.some((t) => t.putanja.includes("01.jpg")),
    "slika iz arhive artikala ne smije se pojaviti u topNovi",
  );
  assert.equal(r.novihFajlovaBroj, 1, "slika se broji u agregatu novog, samo se ne imenuje");
});

test("sazmiSkeniranje: kategorije klijentskog materijala u izlazu su samo agregat (bajta, broj), bez imena fajlova", () => {
  const r = sazmiSkeniranje({
    svojFajlovi: {
      olx_pik_slike: [
        { relativnaPutanja: "artikal1.jpg", velicinaBajta: 1000, mtimeMs: 1 },
        { relativnaPutanja: "artikal2.jpg", velicinaBajta: 2000, mtimeMs: 2 },
      ],
      telegram_inbox: [{ relativnaPutanja: "poruka.json", velicinaBajta: 5, mtimeMs: 1 }],
    },
  });
  assert.deepEqual(r.kategorije.olx_pik_slike, { bajta: 3000, broj: 2 });
  assert.deepEqual(r.kategorije.telegram_inbox, { bajta: 5, broj: 1 });
  assert.deepEqual(Object.keys(r.kategorije).sort(), [
    "dist",
    "node_modules",
    "olx_pik_arhiva",
    "olx_pik_klijent_fajlovi",
    "olx_pik_konkurenti",
    "olx_pik_ostalo",
    "olx_pik_resursi",
    "olx_pik_slike",
    "olx_pik_snapshots",
    "ostalo_klona",
    "telegram_inbox",
    "transkripti",
  ]);
});

test("sazmiSkeniranje: prazan poziv (default argumenti) ne baca i vraca konzistentan oblik", () => {
  const r = sazmiSkeniranje();
  assert.equal(r.ukupnoBajta, 0);
  assert.equal(r.novihFajlovaBroj, null);
  assert.deepEqual(r.topNovi, []);
  assert.deepEqual(r.kategorije.node_modules, { bajta: null, izvor: null });
});
