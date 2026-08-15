#!/usr/bin/env bun
// Pokrece testove tako da isti poziv radi na macOS-u, Linuxu i Windowsu, pod Bunom.
//
// Zasto ne direktno `node --test` / `bun --test` (Bun taj fleg uopste nema, "Cannot use test()
// outside of the test runner", izmjereno 15.08.2026):
// - `node --test dist/core/` na Windowsu NE silazi u direktorijum nego ga izvrsi kao jedan test i
//   lazno prijavi "1 pass". Cijeli paket je tiho preskocen (izmjereno na Windowsu 30.07.2026), a
//   `npm test` je kapija u azuriranju flote, pa je propustao svako izdanje kao provjereno.
// - `node --test "dist/core/**/*.test.js"` rjesava Windows, ali glob u `--test` postoji od novijih
//   Node verzija; na 20.19.5 javi "Could not find" i ne nadje nista (izmjereno na macOS-u istog
//   dana). Zamjena jedne tihe greske drugom.
// - Shell glob (`dist/core/*.test.js` bez navodnika) radi na macOS-u a ne na Windows cmd-u.
// - `bun test <fajl1> <fajl2> ...` sa eksplicitnom listom vise fajlova ODJEDNOM tiho ispusti
//   vecinu testova bez ijedne greske (izmjereno 15.08.2026: 38 core fajlova, 831 testova ukupno
//   pojedinacno, samo 9 kad se preda cio popis odjednom). Bun ovdje NE nudi pouzdan batch mod,
//   pa se svaki fajl pokrece u SVOM pozivu `bun test <fajl>` i rezultati se sabiraju rucno.
//
// Zato popis fajlova pravi skripta sama i predaje ga eksplicitno, fajl po fajl. Nema shella, nema
// glob podrske, nema tihog preskakanja: kad fajlova nema, ovo pada.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDER = join(KORIJEN, "dist", "core");

if (!existsSync(FOLDER)) {
  console.error(`Nema ${FOLDER}. Pokreni build prije testova (bun run build).`);
  process.exit(1);
}

const fajlovi = readdirSync(FOLDER)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join(FOLDER, f));

// Tihi nalazak nula fajlova je greska koju ovaj repo vec jednom nije primijetio na Windowsu.
if (fajlovi.length === 0) {
  console.error(`U ${FOLDER} nema ni jednog *.test.js. Je li build prosao?`);
  process.exit(1);
}

// Testovi pogona (scripts/lib) ne prolaze kroz build, pa se kupe direktno, istim eksplicitnim
// obrascem. Njih smije biti nula (folder je mlad), dist/core provjera iznad ostaje kapija.
const LIB = join(KORIJEN, "scripts", "lib");
if (existsSync(LIB)) {
  fajlovi.push(
    ...readdirSync(LIB)
      .filter((f) => f.endsWith(".test.mjs"))
      .sort()
      .map((f) => join(LIB, f)),
  );
}

const dodatniArgv = process.argv.slice(2);

let jePao = false;
let brojFajlova = 0;
for (const fajl of fajlovi) {
  brojFajlova++;
  const r = spawnSync(process.execPath, ["test", fajl, ...dodatniArgv], {
    cwd: KORIJEN,
    stdio: "inherit",
  });
  if (r.error) {
    console.error(`Ne mogu pokrenuti testove (${fajl}): ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) jePao = true;
}

console.log(`\n${brojFajlova} test-fajlova pokrenuto pojedinacno (Bun --test batch nije pouzdan).`);
process.exit(jePao ? 1 : 0);
