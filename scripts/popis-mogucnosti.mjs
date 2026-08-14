#!/usr/bin/env node
// Pravi popis mogucnosti sistema IZ KODA, umjesto da ga neko odrzava rukom.
//
// Rucni popis je vec jednom ostario, i to tiho: dokumentacija je tvrdila jedno a kod radio drugo,
// niko nije primijetio dok neko nije rucno prebrojao. Zato se popis vise ne pise nego se izvodi iz
// izvora koji ne mogu lagati: registracija alata u serveru, stablo commandera, ponasanje
// `loadConfig`, launchd sabloni, frontmatter skillova.
//
// Pokretanje:
//   node scripts/popis-mogucnosti.mjs             upise popis u olx-dokumentacija/
//   node scripts/popis-mogucnosti.mjs --provjeri  nista ne upisuje, samo javi ako je popis zaostao
//
// Rezim `--provjeri` je ono zbog cega ovo ima smisla: on visi na `npm test`, a `npm test` je kapija
// izdanja, pa zaostao popis ne moze doci do klijenta. Zato ovaj rezim smije citati SAMO fajlove
// repoa i `dist/`: nikad `~/.claude`, nikad git, nikad mrezu. Isti test se vrti i na klijentskim
// klonovima pri azuriranju, gdje bi svaka zavisnost od stanja masine bila lazna uzbuna.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skupiSve } from "./lib/popis-podaci.mjs";
import { uMarkdown } from "./lib/popis-markdown.mjs";
import { uHtml } from "./lib/popis-html.mjs";
import { provjeriPokrivenost } from "./lib/popis-pokrivenost.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUCNA_LISTA = join("olx-dokumentacija", "sta-sistem-radi.md");
const SAMO_PROVJERA = process.argv.includes("--provjeri");

/** Fajlovi koje generator pravi. Kljuc je relativna putanja, da poruke budu iste na svim masinama. */
function izlazi(podaci) {
  return [
    { putanja: join("olx-dokumentacija", "mogucnosti.md"), sadrzaj: uMarkdown(podaci) },
    { putanja: join("olx-dokumentacija", "mogucnosti.html"), sadrzaj: uHtml(podaci) },
  ];
}

const podaci = await skupiSve(KORIJEN);
const zamjerke = [];

// 1) Generisani fajlovi: da li bi generator danas napisao tacno ono sto na disku pise.
for (const { putanja, sadrzaj } of izlazi(podaci)) {
  const puna = join(KORIJEN, putanja);
  if (!SAMO_PROVJERA) {
    writeFileSync(puna, sadrzaj);
    continue;
  }
  if (!existsSync(puna)) {
    zamjerke.push(`${putanja} ne postoji.`);
    continue;
  }
  const naDisku = readFileSync(puna, "utf8");
  if (naDisku !== sadrzaj) zamjerke.push(`${putanja} je zaostao za kodom.\n${razlika(naDisku, sadrzaj)}`);
}

// 2) Rucna lista: sposobnosti se mijenjaju, pa i ona mora pratiti. Provjerava se u OBA rezima, jer
// nju generator ne pise i ne moze je popraviti sam.
const punaRucna = join(KORIJEN, RUCNA_LISTA);
if (!existsSync(punaRucna)) {
  zamjerke.push(`${RUCNA_LISTA} ne postoji. To je jedini dio popisa koji se pise rukom.`);
} else {
  zamjerke.push(...provjeriPokrivenost(podaci, readFileSync(punaRucna, "utf8")));
}

// 3) Poslovi bez Windows blizanca. Pravilo iz .claude/rules/pogon.md kaze da svaki KLIJENTSKI posao
// postoji na obje platforme; do sada to nista nije provjeravalo.
if (podaci.poslovaBezBlizanca.length > 0) {
  zamjerke.push(
    `Klijentski poslovi bez Windows blizanca: ${podaci.poslovaBezBlizanca.join(", ")}.\n` +
      "  Svaki klijentski posao ide i u deploy/windows/instaliraj-zadatke.ps1, inace klijent na " +
      "Windowsu tiho ostaje bez njega.",
  );
}

if (zamjerke.length > 0) {
  console.error("Popis mogucnosti nije usaglasen sa kodom:\n");
  for (const z of zamjerke) console.error(`  ${z}\n`);
  console.error("Popravka generisanog dijela: node scripts/popis-mogucnosti.mjs");
  process.exit(1);
}

if (SAMO_PROVJERA) {
  console.log("Popis mogucnosti je svjez.");
} else {
  for (const { putanja } of izlazi(podaci)) console.log(`upisano: ${putanja}`);
  console.log(`rucna lista (${RUCNA_LISTA}) je pregledana i pokriva sve sto kod moze.`);
}

/**
 * Prvi red koji se razlikuje, sa okolinom. Cio diff se ne ispisuje namjerno: covjek ne treba da
 * cita razliku nego da pokrene generator, a jedan red je dovoljan da vidi da li je to ocekivano.
 */
function razlika(a, b) {
  const ra = a.split("\n");
  const rb = b.split("\n");
  for (let i = 0; i < Math.max(ra.length, rb.length); i += 1) {
    if (ra[i] !== rb[i]) {
      return `  prvi razlicit red (${i + 1}):\n    na disku: ${ra[i] ?? "(kraj fajla)"}\n    iz koda:  ${rb[i] ?? "(kraj fajla)"}`;
    }
  }
  return "  razlika je samo u zavrsnom praznom redu";
}
