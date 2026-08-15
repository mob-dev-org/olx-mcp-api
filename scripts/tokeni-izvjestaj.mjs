#!/usr/bin/env bun
// Potrosnja tokena OVOG klona (jednog klijenta), za predikciju troska API-ja.
//
// Izvor su transkripti Claude sesija: svaki odgovor modela nosi tacan usage blok (ulaz,
// kes, izlaz, model). Klijentska sesija pise u .claude-runtime/projects/, admin bot u
// .claude-runtime-admin/projects/, pa je potrosnja po klijentu odvojena sama od sebe.
// Citanje transkripta ne kosta nista: nema modela, nema API poziva.
//
// VAZNO za historiju: Claude Code cisti stare transkripte (podrazumijevano poslije ~30 dana).
// Zato --upisi spaja dnevne zbirove u trajni dnevnik .olx-pik/tokeni-dnevnik.jsonl, koji
// prezivi ciscenje. Pokreni sedmicno (rucno ili iz crona) i predikcija ima punu historiju.
//
// Upotreba iz korijena klona:
//   bun scripts/tokeni-izvjestaj.mjs                 zadnjih 30 dana, tabela po danu
//   bun scripts/tokeni-izvjestaj.mjs --od 7          zadnjih 7 dana
//   bun scripts/tokeni-izvjestaj.mjs --dan 2026-07-28
//   bun scripts/tokeni-izvjestaj.mjs --upisi         azuriraj trajni dnevnik
//   bun scripts/tokeni-izvjestaj.mjs --json          masinski izlaz
//   bun scripts/tokeni-izvjestaj.mjs --dir <putanja> dodatni projects/ folder (testiranje)
//
// Cijene dolaze iz scripts/ai-cijene.mjs (jedno mjesto za sve brojeve). Model kojeg tamo
// nema dobija tokene bez cijene, uz napomenu — broj se ne izmislja.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CIJENE, cijenaPoziva } from "./ai-cijene.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);

const DNEVNIK = join(KORIJEN, ".olx-pik", "tokeni-dnevnik.jsonl");

// ---- argumenti ----

const argv = process.argv.slice(2);
function opcija(ime) {
  const i = argv.indexOf(ime);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}
const samoDan = opcija("--dan");
const odDana = Number(opcija("--od") ?? 30);
const kaoJson = argv.includes("--json");
const upisi = argv.includes("--upisi");
const dodatniDir = opcija("--dir");

// ---- izvori: projects/ folderi po tipu sesije ----

const IZVORI = [
  { sesija: "klijent", dir: join(KORIJEN, ".claude-runtime", "projects") },
  { sesija: "admin-bot", dir: join(KORIJEN, ".claude-runtime-admin", "projects") },
];
if (dodatniDir) IZVORI.push({ sesija: "rucno", dir: resolve(dodatniDir) });

function jsonlFajlovi(dir) {
  if (!existsSync(dir)) return [];
  const rezultat = [];
  for (const s of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, s.name);
    if (s.isDirectory()) rezultat.push(...jsonlFajlovi(p));
    else if (s.name.endsWith(".jsonl")) rezultat.push(p);
  }
  return rezultat;
}

// ---- citanje transkripta ----
// Kljuc zbira: datum x model x sesija. Dedup po requestId (ista poruka zna biti upisana vise
// puta u transkript), pa se tokeni ne broje duplo.

const zbir = new Map(); // "datum|model|sesija" -> { pozivi, ulaz_miss, ulaz_kes, izlaz }
const videni = new Set();

function dodaj(datum, model, sesija, usage, pozivi = 1) {
  const kljuc = `${datum}|${model}|${sesija}`;
  const red = zbir.get(kljuc) ?? { datum, model, sesija, pozivi: 0, ulaz_miss: 0, ulaz_kes: 0, izlaz: 0 };
  red.pozivi += pozivi;
  red.ulaz_miss += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  red.ulaz_kes += usage.cache_read_input_tokens ?? 0;
  red.izlaz += usage.output_tokens ?? 0;
  zbir.set(kljuc, red);
}

for (const { sesija, dir } of IZVORI) {
  for (const fajl of jsonlFajlovi(dir)) {
    let sadrzaj;
    try {
      sadrzaj = readFileSync(fajl, "utf8");
    } catch {
      continue;
    }
    for (const linija of sadrzaj.split("\n")) {
      if (!linija.includes('"usage"')) continue;
      let o;
      try {
        o = JSON.parse(linija);
      } catch {
        continue;
      }
      const usage = o?.message?.usage;
      const model = o?.message?.model;
      const ts = o?.timestamp;
      if (!usage || !model || !ts) continue;
      // Interni placeholder redovi bez stvarnog poziva modela.
      if (model === "<synthetic>") continue;
      const id = o.requestId ?? o.message?.id ?? o.uuid;
      if (id) {
        if (videni.has(id)) continue;
        videni.add(id);
      }
      dodaj(ts.slice(0, 10), model, sesija, usage);
    }
  }
}

// ---- trajni dnevnik ----
// Spajanje po kljucu: za dane koje transkripti jos pokrivaju vazi svjezi zbir (potpuniji),
// za dane koje je ciscenje odnijelo ostaje ono sto je ranije upisano.

if (existsSync(DNEVNIK)) {
  for (const linija of readFileSync(DNEVNIK, "utf8").split("\n")) {
    if (!linija.trim()) continue;
    try {
      const r = JSON.parse(linija);
      const kljuc = `${r.datum}|${r.model}|${r.sesija}`;
      if (!zbir.has(kljuc)) {
        zbir.set(kljuc, r);
      }
    } catch {
      // neispravan red se preskace
    }
  }
}

if (upisi) {
  const redovi = [...zbir.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  mkdirSync(dirname(DNEVNIK), { recursive: true });
  writeFileSync(DNEVNIK, redovi.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.error(`Dnevnik azuriran: ${DNEVNIK} (${redovi.length} redova)`);
}

// ---- filter i cijena ----

const danas = new Date();
const prag = new Date(danas.getTime() - odDana * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const redovi = [...zbir.values()]
  .filter((r) => (samoDan ? r.datum === samoDan : r.datum >= prag))
  .sort((a, b) => a.datum.localeCompare(b.datum) || a.model.localeCompare(b.model));

const bezCijene = new Set();
for (const r of redovi) {
  // U transkriptu model zna nositi datumski sufiks (claude-haiku-4-5-20251001), a u
  // cjenovniku je bez njega.
  const imeZaCijenu = CIJENE[r.model] ? r.model : r.model.replace(/-\d{8}$/, "");
  const cijena = cijenaPoziva(imeZaCijenu, {
    input_tokens: r.ulaz_miss,
    cache_read_input_tokens: r.ulaz_kes,
    output_tokens: r.izlaz,
  });
  r.usd = cijena;
  if (cijena === null) bezCijene.add(r.model);
}

if (kaoJson) {
  console.log(JSON.stringify(redovi, null, 2));
  process.exit(0);
}

// ---- tabela ----

if (redovi.length === 0) {
  console.log(samoDan ? `Nema podataka za ${samoDan}.` : `Nema podataka u zadnjih ${odDana} dana.`);
  console.log("Sesije jos nisu radile, ili transkripti ne postoje u ovom klonu.");
  process.exit(0);
}

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
console.log("datum       sesija     model                 pozivi  ulaz(miss)  ulaz(kes)   izlaz     USD");
let uk = { pozivi: 0, miss: 0, kes: 0, izlaz: 0, usd: 0, usdPoznato: false };
const poDanu = new Map();
for (const r of redovi) {
  console.log(
    `${r.datum}  ${r.sesija.padEnd(9)}  ${r.model.padEnd(20).slice(0, 20)}  ${String(r.pozivi).padStart(6)}  ${k(r.ulaz_miss).padStart(10)}  ${k(r.ulaz_kes).padStart(9)}  ${k(r.izlaz).padStart(6)}  ${r.usd === null ? "      ?" : r.usd.toFixed(4).padStart(7)}`,
  );
  uk.pozivi += r.pozivi;
  uk.miss += r.ulaz_miss;
  uk.kes += r.ulaz_kes;
  uk.izlaz += r.izlaz;
  if (r.usd !== null) {
    uk.usd += r.usd;
    uk.usdPoznato = true;
  }
  poDanu.set(r.datum, (poDanu.get(r.datum) ?? 0) + (r.usd ?? 0));
}

console.log("-".repeat(96));
console.log(
  `UKUPNO${" ".repeat(37)}${String(uk.pozivi).padStart(6)}  ${k(uk.miss).padStart(10)}  ${k(uk.kes).padStart(9)}  ${k(uk.izlaz).padStart(6)}  ${uk.usdPoznato ? uk.usd.toFixed(4).padStart(7) : "      ?"}`,
);

// Projekcija za predikciju: prosjek po aktivnom danu puta 30.
const aktivnihDana = poDanu.size;
if (aktivnihDana > 0 && uk.usdPoznato) {
  const dnevno = uk.usd / aktivnihDana;
  console.log("");
  console.log(`Aktivnih dana u periodu: ${aktivnihDana}. Prosjek po aktivnom danu: $${dnevno.toFixed(4)}.`);
  console.log(`Projekcija na 30 aktivnih dana: $${(dnevno * 30).toFixed(2)}.`);
}
if (bezCijene.size > 0) {
  console.log("");
  console.log(`Cijena nepoznata za: ${[...bezCijene].join(", ")} — dodaj model u scripts/ai-cijene.mjs (CIJENE).`);
  console.log("Tokeni tih modela su izbrojani, samo dolar kolona stoji na ?.");
}
if (!upisi) {
  console.log("");
  console.log("Napomena: transkripti se ciste poslije ~30 dana. Pokreni sa --upisi (npr. sedmicno)");
  console.log("da se zbirovi sacuvaju trajno u .olx-pik/tokeni-dnevnik.jsonl.");
}
