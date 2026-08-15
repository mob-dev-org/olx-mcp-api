// Postavke iz `loadConfig`, dobijene MJERENJEM PONASANJA a ne citanjem izvornog koda.
//
// `loadConfig(env)` prima okruzenje kao argument, sto je poklon: mozemo mu podmetnuti okruzenje
// koje biljezi svaki procitani kljuc, i onda ga zvati sa raznim vrijednostima i gledati sta se u
// rezultatu promijeni. Tako se spisak varijabli i njihovi defaulti ne PREPISUJU (pa da ostare),
// nego se svaki put iznova izmjere na kodu koji stvarno radi.
//
// Opisi polja su jedino sto se cita iz teksta `config.ts`, i to je namjerno sporedno: imena, veze
// varijabla na polje i defaulti dolaze iz mjerenja, a opis je ukras. Kad se opis ne nadje, popis
// ostane bez recenice, ali nijedna tvrdnja u njemu nije pogresna.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Vrijednosti kojima se ispituje svaka varijabla. Trebaju biti raznovrsne jer parseri odbacuju sto
 * im ne odgovara: broj za `num`, "1" za `bool`, "klijent" za nabrajanje profila, putanja koja se
 * zavrsava na `.claude-runtime` za prepoznavanje klijentske sesije. Kad ni jedna ne
 * promijeni rezultat, varijabla se prijavljuje kao neutvrdjena umjesto da se nagadja.
 */
const PROBE = ["424242", "proba-vrijednost", "1", "klijent", "/klon/.claude-runtime"];

/** Stabilan otisak vrijednosti polja, da se `undefined` razlikuje od praznog stringa. */
function otisak(v) {
  return JSON.stringify(v ?? null);
}

export async function skupiPostavke(korijen) {
  const { loadConfig } = await import(pathToFileURL(join(korijen, "dist", "core", "config.js")).href);

  // 1) Koje varijable `loadConfig` uopste cita. Ovo je mjerenje, ne prepis, pa ne moze zaostati.
  const citani = new Set();
  const spijun = new Proxy(
    {},
    {
      get: (_c, kljuc) => {
        if (typeof kljuc === "string") citani.add(kljuc);
        return undefined;
      },
      has: (_c, kljuc) => {
        if (typeof kljuc === "string") citani.add(kljuc);
        return false;
      },
    },
  );
  loadConfig(spijun);

  // 2) Podrazumijevani rezultat, kad nijedna varijabla nije postavljena.
  const osnovni = loadConfig({});

  // 2b) Koja polja ne zavise samo od okruzenja nego i od toga KO je proces. `deviceName` se izvodi
  // iz pokrenute skripte, pa bi njegov "default" u popisu bio razlicit zavisno od toga cime je
  // generator pokrenut. Ne pogadja se koje je to polje, nego se izmjeri: isti poziv sa dva razlicita
  // `process.argv[1]`, pa sto se pomjeri nema stabilan default.
  const odProcesa = new Set();
  const stariArgv = process.argv[1];
  try {
    for (const lazni of ["/proba/mcp/server.js", "/proba/cli/index.js"]) {
      process.argv[1] = lazni;
      const r = loadConfig({});
      for (const polje of Object.keys(osnovni)) {
        if (otisak(r[polje]) !== otisak(osnovni[polje])) odProcesa.add(polje);
      }
    }
  } finally {
    process.argv[1] = stariArgv;
  }

  // 3) Koja varijabla drzi koje polje: promijeni jednu, vidi sta se pomjerilo.
  const postavke = [];
  const opisi = citajOpiseInterfejsa(korijen);
  const upozorenja = [];

  for (const varijabla of [...citani].sort()) {
    const pogodjena = new Set();
    for (const proba of PROBE) {
      const rezultat = loadConfig({ [varijabla]: proba });
      for (const polje of Object.keys(osnovni)) {
        if (otisak(rezultat[polje]) !== otisak(osnovni[polje])) pogodjena.add(polje);
      }
    }

    // Zamka praznog stringa: `X=` u .env fajlu je prazan string, ne odsutna varijabla. Kod koji
    // koristi `??` umjesto `||` na tome tiho uzme prazno umjesto podrazumijevanog. Ne biramo
    // stranu, samo prijavljujemo razliku.
    const prazan = loadConfig({ [varijabla]: "" });
    for (const polje of Object.keys(osnovni)) {
      if (otisak(prazan[polje]) !== otisak(osnovni[polje])) {
        upozorenja.push(
          `${varijabla}: prazna vrijednost daje drugaciji rezultat nego odsutna varijabla ` +
            `(polje ${polje}: ${otisak(prazan[polje])} naspram ${otisak(osnovni[polje])})`,
        );
      }
    }

    const polja = [...pogodjena].sort();
    const jedno = polja.length === 1 ? polja[0] : undefined;
    const nestabilno = polja.some((p) => odProcesa.has(p));
    postavke.push({
      varijabla,
      polja,
      // Vise od jednog pogodjenog polja znaci da varijabla ucestvuje u vise izracuna; tada se
      // default ne pripisuje jednom polju.
      podrazumijevano: jedno && !nestabilno ? osnovni[jedno] : undefined,
      // Default se izvodi iz procesa koji cita konfiguraciju, pa se ne moze zapisati kao broj.
      zavisiOdProcesa: nestabilno,
      utvrdjeno: polja.length > 0,
      opis: jedno ? opisi[jedno] : undefined,
    });
  }

  // Polja koja nijedna varijabla ne drzi: izvedena iz drugog izvora (npr. deviceName se izvodi iz
  // pokrenute skripte). Popisuju se izricito, da se ne cini kao da su ispala.
  const drzana = new Set(postavke.flatMap((p) => p.polja));
  const izvedena = Object.keys(osnovni)
    .filter((p) => !drzana.has(p))
    .sort()
    .map((polje) => ({ polje, podrazumijevano: osnovni[polje], opis: opisi[polje] }));

  return { postavke, izvedena, upozorenja };
}

/**
 * Opisi polja iz komentara uz `interface OlxConfig`. Cisto ukras, vidi zaglavlje: kad ovo ne nadje
 * nista, popis je siromasniji ali i dalje tacan, pa se ovdje nikad ne baca.
 */
function citajOpiseInterfejsa(korijen) {
  let tekst;
  try {
    tekst = readFileSync(join(korijen, "src", "core", "config.ts"), "utf8");
  } catch {
    return {};
  }
  const pocetak = tekst.indexOf("export interface OlxConfig {");
  if (pocetak === -1) return {};
  const kraj = tekst.indexOf("\n}", pocetak);
  const tijelo = tekst.slice(pocetak, kraj === -1 ? undefined : kraj);

  const opisi = {};
  let skupljeno = [];
  for (const red of tijelo.split("\n").slice(1)) {
    const t = red.trim();
    if (t.startsWith("//")) {
      skupljeno.push(t.slice(2).trim());
      continue;
    }
    if (t.startsWith("/**") || t.startsWith("*/") || t.startsWith("*")) {
      const cist = t.replace(/^\/\*\*|^\*\/$|^\*/g, "").trim();
      if (cist) skupljeno.push(cist);
      continue;
    }
    const polje = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\??:/);
    if (polje) {
      if (skupljeno.length > 0) opisi[polje[1]] = skupljeno.join(" ");
      skupljeno = [];
      continue;
    }
    if (t === "") skupljeno = [];
  }
  return opisi;
}
