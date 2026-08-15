#!/usr/bin/env node
// Pokupi imena prodavaca koja su KLIJENTI sami spomenuli, iz svih klonova flote, na admin masinu.
//
// Klijentu konkurencija nije u paketu i bot mu o njoj ne radi nista. Ali kad covjek sam navede ime
// drugog prodavca, bot ga tiho zapise u .olx-pik/spomenuti-konkurenti.jsonl SVOG klona
// (`olx_zabiljezi_konkurenta`, jezgro u src/core/spomenuti-konkurenti.ts). Ova skripta, sa admin
// masine, obidje klonove iz popisa i slozi te zapise u JEDAN pregled.
//
// Zasto Node a ne bash kao saznanja-pokupi.sh: izlaz nije prepisivanje redova nego objedinjavanje
// po username-u kroz cijelu flotu, a pravilo objedinjavanja vec postoji u jezgru (`sazmiSpomenute`).
// Bash bi ga morao ponoviti, pa bi dva mjesta racunala isto na dva nacina.
//
// Zasto NEMA markera "dokle je pokupljeno", za razliku od saznanja-pokupi.sh: tamo je jedinica rada
// pojedinacno saznanje, pa se svako obradi jednom. Ovdje je vrijedan podatak SLIKA STANJA: koliko
// puta i kod koliko razlicitih klijenata je jedno ime palo. Ime koje se ponavlja kod vise klijenata
// je jaci signal od imena koje je jednom palo kod jednog, a to se vidi samo kad se svaki put cita
// sve. Izlaz se zato prepisuje, ne dopisuje.
//
// Ponasanje pri gresci je isto kao kod uzora: bez popisa klonova staje sa porukom i kodom 1, a
// klon koji nema fajl ili ga ne moze procitati se preskace bez rusenja cijelog prolaza.
//
// Pokretanje: node scripts/spomenuti-pokupi.mjs
// Zakazivanje: deploy/launchd/ba.codefactory.olx.ADMIN.spomenuti.plist

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POPIS = process.env.OLX_KLIJENTI_POPIS || join(homedir(), ".olx-klijenti.txt");
const ULAZ = join(KORIJEN, "olx-dokumentacija", "saznanja-ulaz");
const IZLAZ = join(ULAZ, "spomenuti-prodavci.md");

const { ucitajSpomenute } = await import(
  pathToFileURL(join(KORIJEN, "dist", "core", "spomenuti-konkurenti.js")).href
);

if (!existsSync(POPIS)) {
  console.error(`Nema popisa klonova: ${POPIS}`);
  process.exit(1);
}

/** Klonovi iz popisa: jedan po redu, `#` je komentar, prazni redovi se preskacu. */
function klonovi() {
  return readFileSync(POPIS, "utf8")
    .split("\n")
    .map((red) => red.split("#")[0].trim())
    .filter(Boolean);
}

// kljuc je username u malim slovima, da isto ime iz dva klona ne postane dva reda
const po = new Map();
let klonovaSaZapisima = 0;

for (const klon of klonovi()) {
  const ime = basename(klon);
  const fajl = join(klon, ".olx-pik", "spomenuti-konkurenti.jsonl");
  if (!existsSync(fajl)) continue;

  let zapisi;
  try {
    zapisi = ucitajSpomenute(fajl);
  } catch (e) {
    // Jedan neprocitljiv klon ne obara prolaz kroz ostale: bolje krnj pregled nego nikakav.
    console.error(`${ime}: preskocen (${e instanceof Error ? e.message : String(e)})`);
    continue;
  }
  if (zapisi.length === 0) continue;
  klonovaSaZapisima += 1;

  for (const z of zapisi) {
    const kljuc = z.username.toLowerCase();
    const postojeci = po.get(kljuc);
    if (!postojeci) {
      po.set(kljuc, { username: z.username, ukupno: z.puta, kodKoga: new Map([[ime, z]]) });
      continue;
    }
    postojeci.ukupno += z.puta;
    postojeci.kodKoga.set(ime, z);
  }
}

// Poredak je sam po sebi odgovor na pitanje "koga prvo pogledati": prvo ime koje je palo kod vise
// razlicitih klijenata, pa tek onda ono koje je kod jednog palo mnogo puta.
const redovi = [...po.values()].sort(
  (a, b) => b.kodKoga.size - a.kodKoga.size || b.ukupno - a.ukupno || a.username.localeCompare(b.username),
);

const danas = new Date().toISOString().slice(0, 10);
const linije = [
  "# Prodavci koje su klijenti sami spomenuli",
  "",
  `Pokupljeno ${danas} sa ${klonovaSaZapisima} klonova. Fajl se PREPISUJE pri svakom pokupljanju:`,
  "ovo je slika stanja, ne dnevnik. Izvor je tiha biljeska klijentskog bota; klijentu se odavde",
  "nikad nista ne prikazuje.",
  "",
  `Ukupno razlicitih imena: ${redovi.length}.`,
  "",
];

if (redovi.length === 0) {
  linije.push("Nijedan klon jos nema zapisa.");
} else {
  linije.push("| Prodavac | Klijenata | Spominjanja | Kod koga (zadnji put) | Zadnja napomena |");
  linije.push("| --- | --- | --- | --- | --- |");
  for (const r of redovi) {
    const kod = [...r.kodKoga.entries()]
      .sort((a, b) => (a[1].zadnji_put < b[1].zadnji_put ? 1 : -1))
      .map(([klijent, z]) => `${klijent} (${z.zadnji_put.slice(0, 10)})`)
      .join(", ");
    const zadnja = [...r.kodKoga.values()].sort((a, b) => (a.zadnji_put < b.zadnji_put ? 1 : -1))[0];
    const napomena = (zadnja?.napomena ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 120);
    linije.push(`| ${r.username} | ${r.kodKoga.size} | ${r.ukupno} | ${kod} | ${napomena} |`);
  }
}

mkdirSync(ULAZ, { recursive: true });
writeFileSync(IZLAZ, `${linije.join("\n")}\n`, "utf8");

console.log(`Pokupljeno: ${redovi.length} imena sa ${klonovaSaZapisima} klonova.`);
console.log(`Pregled: ${IZLAZ}`);
