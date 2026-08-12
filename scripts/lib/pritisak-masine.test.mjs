// Testovi modula za pritisak masine. Isti stil kao resursi.test.mjs/klonovi.test.mjs: node:test
// + node:assert/strict, sve zavisnosti (fs funkcije, homedir) su injektovane lazne
// implementacije, nikakav pravi fajl sistem osim gdje test eksplicitno provjerava putanju.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  citajOznaku,
  odluciAlarmMasine,
  provjeriPritisakMasine,
  putanjaOznakeKlona,
  putanjaOznakeMasine,
  upisiOznaku,
} from "./pritisak-masine.mjs";

// ---- provjeriPritisakMasine ----

test("provjeriPritisakMasine: slobodna memorija ispod praga daje alarm", () => {
  const r = provjeriPritisakMasine(
    { slobodnoBajta: 1 * 1024 ** 3, swapKoristenoBajta: null, swapUkupnoBajta: null },
    { pragSlobodnoBajta: 2 * 1024 ** 3 },
  );
  assert.equal(r.alarm, true);
  assert.match(r.razlog, /slobodno svega/);
});

test("provjeriPritisakMasine: swap omjer preko praga daje alarm", () => {
  const r = provjeriPritisakMasine(
    { slobodnoBajta: 10 * 1024 ** 3, swapKoristenoBajta: 900, swapUkupnoBajta: 1000 },
    { pragSlobodnoBajta: 2 * 1024 ** 3, pragSwapOmjer: 0.85 },
  );
  assert.equal(r.alarm, true);
  assert.match(r.razlog, /swap iskoristen/);
});

test("provjeriPritisakMasine: oba polja null daje nema alarma (nepoznato nije alarm)", () => {
  const r = provjeriPritisakMasine({
    slobodnoBajta: null,
    swapKoristenoBajta: null,
    swapUkupnoBajta: null,
  });
  assert.deepEqual(r, { alarm: false, razlog: null });
});

test("provjeriPritisakMasine: swapUkupnoBajta:0 ne dijeli nulom, nema alarma po toj osnovi", () => {
  const r = provjeriPritisakMasine({
    slobodnoBajta: 10 * 1024 ** 3,
    swapKoristenoBajta: 0,
    swapUkupnoBajta: 0,
  });
  assert.deepEqual(r, { alarm: false, razlog: null });
});

test("provjeriPritisakMasine: oba uslova pogode, razlozi se spajaju u jedan string", () => {
  const r = provjeriPritisakMasine(
    { slobodnoBajta: 1 * 1024 ** 3, swapKoristenoBajta: 900, swapUkupnoBajta: 1000 },
    { pragSlobodnoBajta: 2 * 1024 ** 3, pragSwapOmjer: 0.85 },
  );
  assert.equal(r.alarm, true);
  assert.match(r.razlog, /slobodno svega/);
  assert.match(r.razlog, /swap iskoristen/);
});

// ---- putanjaOznakeMasine ----

test("putanjaOznakeMasine: default na ~/.olx-pik-masina-alarm.json", () => {
  const r = putanjaOznakeMasine({}, () => "/home/mahir");
  assert.equal(r, join("/home/mahir", ".olx-pik-masina-alarm.json"));
});

test("putanjaOznakeMasine: env override ima prednost", () => {
  const r = putanjaOznakeMasine({ OLX_MASINA_ALARM_FAJL: "/tmp/moja-oznaka.json" }, () => "/home/mahir");
  assert.equal(r, "/tmp/moja-oznaka.json");
});

test("putanjaOznakeMasine: prazan env override se ignorise, pada na homedir", () => {
  const r = putanjaOznakeMasine({ OLX_MASINA_ALARM_FAJL: "   " }, () => "/home/mahir");
  assert.equal(r, join("/home/mahir", ".olx-pik-masina-alarm.json"));
});

// ---- putanjaOznakeKlona ----

test("putanjaOznakeKlona: .olx-pik/pritisak-alarm-zadnji.json u korijenu klona", () => {
  assert.equal(putanjaOznakeKlona("/klijenti/pero"), join("/klijenti/pero", ".olx-pik", "pritisak-alarm-zadnji.json"));
});

// ---- citajOznaku ----

test("citajOznaku: ENOENT vraca postoji:false, greska:null (normalno stanje)", () => {
  const readFileSync = () => {
    throw Object.assign(new Error("nema fajla"), { code: "ENOENT" });
  };
  const r = citajOznaku("/ne/postoji.json", { readFileSync });
  assert.deepEqual(r, { postoji: false, oznaka: null, greska: null });
});

test("citajOznaku: drugi kod greske (EACCES) je stvaran problem, greska popunjena", () => {
  const readFileSync = () => {
    throw Object.assign(new Error("dozvola odbijena"), { code: "EACCES" });
  };
  const r = citajOznaku("/nedostupno.json", { readFileSync });
  assert.equal(r.postoji, false);
  assert.equal(r.oznaka, null);
  assert.equal(r.greska, "EACCES");
});

test("citajOznaku: nevalidan JSON je stvaran problem, greska popunjena", () => {
  const readFileSync = () => "{ovo nije json";
  const r = citajOznaku("/postoji-ali-los.json", { readFileSync });
  assert.equal(r.postoji, false);
  assert.equal(r.oznaka, null);
  assert.ok(typeof r.greska === "string" && r.greska.length > 0);
});

test("citajOznaku: validan JSON vraca postoji:true i parsiranu oznaku", () => {
  const readFileSync = () => JSON.stringify({ ts: 1000, razlog: "x" });
  const r = citajOznaku("/ok.json", { readFileSync });
  assert.deepEqual(r, { postoji: true, oznaka: { ts: 1000, razlog: "x" }, greska: null });
});

// ---- upisiOznaku ----

test("upisiOznaku: uspjesan upis vraca ok:true", () => {
  const pozivi = [];
  const writeFileSync = (p, s) => pozivi.push(["write", p, s]);
  const mkdirSync = (p, o) => pozivi.push(["mkdir", p, o]);
  const r = upisiOznaku("/a/b/oznaka.json", { ts: 1 }, { writeFileSync, mkdirSync });
  assert.deepEqual(r, { ok: true, greska: null });
  assert.equal(pozivi[0][0], "mkdir");
  assert.equal(pozivi[1][0], "write");
});

test("upisiOznaku: pad pri pisanju vraca ok:false, ne baca", () => {
  const writeFileSync = () => {
    throw new Error("disk pun");
  };
  const mkdirSync = () => {};
  const r = upisiOznaku("/a/oznaka.json", { ts: 1 }, { writeFileSync, mkdirSync });
  assert.equal(r.ok, false);
  assert.match(r.greska, /disk pun/);
});

// ---- odluciAlarmMasine ----

const PUTANJA_KLONA = join("/klijenti/pero", ".olx-pik", "pritisak-alarm-zadnji.json");

test("odluciAlarmMasine: pritisak.alarm===false nikad ne dira nijedan fajl", () => {
  const citajFajl = () => {
    throw new Error("NE SMIJE BITI POZVANO");
  };
  const pisiFajl = () => {
    throw new Error("NE SMIJE BITI POZVANO");
  };
  const mkdirFn = () => {
    throw new Error("NE SMIJE BITI POZVANO");
  };
  const r = odluciAlarmMasine({
    pritisak: { alarm: false, razlog: null },
    sada: 1000,
    korijenKlona: "/klijenti/pero",
    env: {},
    citajFajl,
    pisiFajl,
    mkdirFn,
  });
  assert.deepEqual(r, { posalji: false, izvor: null });
});

test("odluciAlarmMasine: nema dijeljene oznake -> salje i pise dijeljenu", () => {
  const enoent = Object.assign(new Error("x"), { code: "ENOENT" });
  const pisanja = [];
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "test" },
    sada: 5000,
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: () => {
      throw enoent;
    },
    pisiFajl: (p, s) => pisanja.push({ p, s }),
    mkdirFn: () => {},
  });
  assert.deepEqual(r, { posalji: true, izvor: "dijeljena" });
  assert.equal(pisanja.length, 1);
  assert.equal(pisanja[0].p, join("/home/mahir", ".olx-pik-masina-alarm.json"));
  assert.deepEqual(JSON.parse(pisanja[0].s), { ts: 5000, razlog: "test" });
});

test("odluciAlarmMasine: svjeza dijeljena oznaka -> ne salje, ne pise nista", () => {
  const oznaka = JSON.stringify({ ts: 4000, razlog: "staro" });
  const pisiFajl = () => {
    throw new Error("NE SMIJE BITI POZVANO - oznaka je svjeza");
  };
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "test" },
    sada: 5000,
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: () => oznaka,
    pisiFajl,
    mkdirFn: () => {},
    pragMs: 6 * 60 * 60 * 1000,
  });
  assert.deepEqual(r, { posalji: false, izvor: null });
});

test("odluciAlarmMasine: stara dijeljena oznaka -> salje i prepisuje", () => {
  const staraOznaka = JSON.stringify({ ts: 1000, razlog: "davno" });
  const pisanja = [];
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "novo" },
    sada: 1000 + 7 * 60 * 60 * 1000, // 7h kasnije, preko praga od 6h
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: () => staraOznaka,
    pisiFajl: (p, s) => pisanja.push({ p, s }),
    mkdirFn: () => {},
    pragMs: 6 * 60 * 60 * 1000,
  });
  assert.deepEqual(r, { posalji: true, izvor: "dijeljena" });
  assert.equal(pisanja.length, 1);
  assert.deepEqual(JSON.parse(pisanja[0].s), { ts: 1000 + 7 * 60 * 60 * 1000, razlog: "novo" });
});

test("odluciAlarmMasine: citanje dijeljene baci EACCES -> koristi klonsku (citajFajl pozvan i za klonsku putanju)", () => {
  const citanja = [];
  const citajFajl = (p) => {
    citanja.push(p);
    if (p === join("/home/mahir", ".olx-pik-masina-alarm.json")) {
      throw Object.assign(new Error("dozvola odbijena"), { code: "EACCES" });
    }
    if (p === PUTANJA_KLONA) {
      throw Object.assign(new Error("nema fajla"), { code: "ENOENT" });
    }
    throw new Error(`neocekivana putanja ${p}`);
  };
  const pisanja = [];
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "test" },
    sada: 5000,
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl,
    pisiFajl: (p, s) => pisanja.push({ p, s }),
    mkdirFn: () => {},
  });
  assert.deepEqual(r, { posalji: true, izvor: "klon" });
  assert.ok(citanja.includes(PUTANJA_KLONA), "citajFajl mora biti pozvan i za klonsku putanju");
  assert.equal(pisanja.length, 1);
  assert.equal(pisanja[0].p, PUTANJA_KLONA);
});

test("odluciAlarmMasine: pisanje dijeljene padne (upis vrati ok:false) -> ipak salje, pokusa upisati klonsku", () => {
  const pisanja = [];
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "test" },
    sada: 5000,
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: () => {
      throw Object.assign(new Error("nema fajla"), { code: "ENOENT" });
    },
    pisiFajl: (p) => {
      pisanja.push(p);
      if (p === join("/home/mahir", ".olx-pik-masina-alarm.json")) {
        throw new Error("disk pun");
      }
      // klonski upis uspijeva
    },
    mkdirFn: () => {},
  });
  assert.deepEqual(r, { posalji: true, izvor: "klon" });
  assert.deepEqual(pisanja, [join("/home/mahir", ".olx-pik-masina-alarm.json"), PUTANJA_KLONA]);
});

test("odluciAlarmMasine: sve koordinacije padnu (citanje EACCES i pisanje klonske padne) -> ipak salje", () => {
  const r = odluciAlarmMasine({
    pritisak: { alarm: true, razlog: "test" },
    sada: 5000,
    korijenKlona: "/klijenti/pero",
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: () => {
      throw Object.assign(new Error("dozvola odbijena"), { code: "EACCES" });
    },
    pisiFajl: () => {
      throw new Error("i klon je pokvaren");
    },
    mkdirFn: () => {},
  });
  assert.deepEqual(r, { posalji: true, izvor: "klon" });
});
