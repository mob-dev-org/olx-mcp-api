#!/usr/bin/env node
// Napravi izdanje: provjeri preduslove, podigni broj, napravi anotiran tag.
//
// Zasto skripta a ne popis koraka u dokumentu: redoslijed ovdje nije stvar ukusa. Tag na
// neprovjereno stanje, izdanje bez zapisa u CHANGELOG-u ili pomjeren `stabilno` prije nego je
// commit na remoteu su greske koje se vide tek kod klijenta. Skripta ih ne moze zaboraviti.
//
// Sta radi:
//   1. provjeri granu, cistu radnu kopiju i da si u sinhronu sa remoteom
//   2. provjeri da CHANGELOG.md ima sekciju za NOVI broj (prije nego se broj podigne)
//   3. `npm version <broj>` — hook `preversion` vrti testove, hook `version` prepise
//      src/core/verzija.ts, npm napravi commit i anotiran tag vX.Y.Z
//   4. ispise tacne komande koje ostaju rucno: push i pomjeranje prekidaca `stabilno`
//
// Sta NE radi, namjerno: ne pusha i ne pomjera `stabilno`. Oba su potezi koje flota odmah
// osjeti, pa ostaju ljudska odluka. Puna procedura: olx-dokumentacija/arhitektura.md, sekcija 7.
//
// Pokretanje:
//   node scripts/izdanje.mjs 0.5.0
//   node scripts/izdanje.mjs minor          # npm semver rijeci takodjer rade
//   node scripts/izdanje.mjs 0.5.0 --suho   # samo provjere, nista se ne mijenja

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);

const argumenti = process.argv.slice(2);
const SUHO = argumenti.includes("--suho");
const ZELJENI = argumenti.find((a) => !a.startsWith("--"));

if (!ZELJENI) {
  console.error("Koji broj? Primjer: node scripts/izdanje.mjs 0.5.0");
  console.error("Ili semver rijec: patch | minor | major");
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function stani(sta, popravka) {
  console.error(`STOP: ${sta}`);
  if (popravka) console.error(`  -> ${popravka}`);
  process.exit(1);
}

// Koji broj ce izdanje nositi. Semver rijeci razrjesava npm, pa ih racunamo unaprijed da bismo
// mogli provjeriti CHANGELOG PRIJE nego se bilo sta promijeni.
function sljedeciBroj(trenutni, zeljeni) {
  if (/^\d+\.\d+\.\d+$/.test(zeljeni)) return zeljeni;
  const [ma, mi, pa] = trenutni.split(".").map(Number);
  if (zeljeni === "patch") return `${ma}.${mi}.${(pa ?? 0) + 1}`;
  if (zeljeni === "minor") return `${ma}.${(mi ?? 0) + 1}.0`;
  if (zeljeni === "major") return `${(ma ?? 0) + 1}.0.0`;
  stani(`ne razumijem broj "${zeljeni}"`, "daj 0.5.0 ili patch/minor/major");
  return "";
}

const pkg = JSON.parse(readFileSync(join(KORIJEN, "package.json"), "utf8"));
const NOVI = sljedeciBroj(pkg.version, ZELJENI);

console.log(`Izdanje: ${pkg.version} -> ${NOVI}${SUHO ? "  (suho, nista se ne mijenja)" : ""}`);
console.log("");

// 1. Grana. Izdanje ide sa main; tag na feature grani bi ostao bez konteksta u historiji.
const grana = git("rev-parse", "--abbrev-ref", "HEAD");
if (grana !== "main") {
  stani(`nisi na main nego na ${grana}`, "spoji u main pa ponovo, ili tagiraj rucno ako namjerno izdajes sa grane");
}
console.log(`  ok  grana: ${grana}`);

// 2. Cista radna kopija. npm version i sam odbija prljavo stablo, ali greska bude nejasna.
if (git("status", "--porcelain", "--untracked-files=no")) {
  stani("radna kopija ima necommitovane izmjene", "commituj ili odloziti izmjene (git stash)");
}
console.log("  ok  radna kopija je cista");

// 3. Sinhron sa remoteom. Push poslije izdanja bi inace pao ili, gore, izdanje bi nosilo kod
//    koji na remoteu nikad nije bio.
try {
  git("fetch", "--quiet", "--tags", "--force", "origin");
  const iza = git("rev-list", "--count", "HEAD..origin/main");
  const ispred = git("rev-list", "--count", "origin/main..HEAD");
  if (iza !== "0") stani(`main je ${iza} commita IZA origin/main`, "git pull --rebase pa ponovo");
  console.log(`  ok  sinhron sa origin/main (lokalno ispred: ${ispred})`);
} catch {
  console.log("  paznja  remote nije dostupan, preskacem provjeru sinhrona");
}

// 4. Tag tog imena ne smije vec postojati: nepomicni tagovi se ne prepisuju.
const tag = `v${NOVI}`;
const postojeci = git("tag", "-l", tag);
if (postojeci) stani(`tag ${tag} vec postoji`, "izaberi drugi broj; tagovi izdanja se ne pomjeraju");
console.log(`  ok  tag ${tag} je slobodan`);

// 5. CHANGELOG mora imati sekciju za NOVI broj. Isto tvrdi i verzija.test.ts, ali tamo se vidi
//    tek kad `npm version` vec podigne broj, pa bi izdanje puklo na pola.
const changelog = readFileSync(join(KORIJEN, "CHANGELOG.md"), "utf8");
if (!new RegExp(`^## ${NOVI.replace(/\./g, "\\.")}( |$)`, "m").test(changelog)) {
  stani(
    `CHANGELOG.md nema sekciju za ${NOVI}`,
    `dodaj "## ${NOVI} — ${new Date().toISOString().slice(0, 10)}" i tri do pet redova sta je uslo`,
  );
}
console.log(`  ok  CHANGELOG.md ima sekciju za ${NOVI}`);

if (SUHO) {
  console.log("");
  console.log(`Sve provjere prolaze. Pravo izdanje: node scripts/izdanje.mjs ${ZELJENI}`);
  process.exit(0);
}

// 6. npm version radi ostalo: preversion vrti testove, version prepise konstantu, pa commit i tag.
console.log("");
console.log(`Pokrecem npm version ${NOVI} (testovi idu kroz preversion hook)...`);
try {
  execFileSync("npm", ["version", NOVI, "-m", "Izdanje %s"], { stdio: "inherit" });
} catch {
  stani("npm version je pao", "najcesce padnu testovi; popravi pa ponovo, nista nije tagirano");
}

console.log("");
console.log(`Izdanje ${tag} je napravljeno lokalno. Ostaje, u ovom redu:`);
console.log("");
console.log("  git push --follow-tags origin main");
console.log(`  git tag -f stabilno ${tag} && git push -f origin stabilno`);
console.log("  scripts/azuriraj-sve.sh --suho     # pa bez --suho");
console.log("");
console.log("Prekidac `stabilno` se pomjera ZADNJE: to je jedini ref koji flota prati, pa ide");
console.log("na remote samo kad je sve ostalo vec tamo.");
