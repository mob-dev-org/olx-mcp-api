#!/usr/bin/env node
// Pokrece testove tako da isti poziv radi na macOS-u, Linuxu i Windowsu, na svakom Node 18+.
//
// Zasto ne direktno `node --test`:
// - `node --test dist/core/` na Windowsu NE silazi u direktorijum nego ga izvrsi kao jedan test i
//   lazno prijavi "1 pass". Cijeli paket je tiho preskocen (izmjereno na Windowsu 30.07.2026), a
//   `npm test` je kapija u azuriranju flote, pa je propustao svako izdanje kao provjereno.
// - `node --test "dist/core/**/*.test.js"` rjesava Windows, ali glob u `--test` postoji od novijih
//   Node verzija; na 20.19.5 javi "Could not find" i ne nadje nista (izmjereno na macOS-u istog
//   dana). Zamjena jedne tihe greske drugom.
// - Shell glob (`dist/core/*.test.js` bez navodnika) radi na macOS-u a ne na Windows cmd-u.
//
// Zato popis fajlova pravi Node sam i predaje ga eksplicitno. Nema shella, nema glob podrske, nema
// tihog preskakanja: kad fajlova nema, ovo pada.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDER = join(KORIJEN, "dist", "core");

if (!existsSync(FOLDER)) {
  console.error(`Nema ${FOLDER}. Pokreni build prije testova (npm run build).`);
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

const dijete = spawn(process.execPath, ["--test", ...fajlovi, ...process.argv.slice(2)], {
  cwd: KORIJEN,
  stdio: "inherit",
});

dijete.on("error", (e) => {
  console.error(`Ne mogu pokrenuti testove: ${e.message}`);
  process.exit(1);
});

dijete.on("exit", (kod, signal) => {
  process.exit(signal ? 1 : (kod ?? 0));
});
