#!/usr/bin/env node
// Prepisuje konstantu VERZIJA u src/core/verzija.ts brojem iz package.json.
//
// Pokrece ga npm kroz hook `version`, dakle POSLIJE podizanja broja u package.json a PRIJE
// commita, pa izmjena ulazi u isti commit (npm help version, korak 4). Zato hook u package.json
// odmah radi i `git add` nad izmijenjenim fajlom.
//
// Rucno pokretanje je bezopasno i idempotentno: kad je broj vec isti, ne pise nista.
// Pada sa nenultim kodom kad ne nadje liniju konstante, jer bi tihi prolaz ostavio verziju koja
// laze o sebi, a to je gore od pada izdanja.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CILJ = join(KORIJEN, "src", "core", "verzija.ts");
const OBRAZAC = /^(export const VERZIJA = ")([^"]*)(";)$/m;

const { version } = JSON.parse(readFileSync(join(KORIJEN, "package.json"), "utf8"));

if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json nosi verziju koja nije semver: ${String(version)}`);
  process.exit(1);
}

const staro = readFileSync(CILJ, "utf8");
const nadjeno = staro.match(OBRAZAC);

if (!nadjeno) {
  console.error(`Ne nalazim liniju "export const VERZIJA = ..." u ${CILJ}`);
  console.error("Ako je konstanta preimenovana, popravi i ovu skriptu, ne samo modul.");
  process.exit(1);
}

if (nadjeno[2] === version) {
  console.log(`Verzija je vec ${version}, ne mijenjam nista.`);
  process.exit(0);
}

writeFileSync(CILJ, staro.replace(OBRAZAC, `$1${version}$3`), "utf8");
console.log(`Verzija u src/core/verzija.ts: ${nadjeno[2]} -> ${version}`);
