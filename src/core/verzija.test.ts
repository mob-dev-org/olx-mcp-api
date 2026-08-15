// Cuva da broj verzije ne pocne lagati o sebi.
//
// Verzija stoji na dva mjesta: `package.json` (jer npm tako radi) i `src/core/verzija.ts` (jer je
// `package.json` van rootDir-a pa se ne moze uvesti). Dok su ta dva ista, svejedno je koje se
// cita. Kad se raziduju, audit log tvrdi jedno a `npm` drugo, i dijagnostika prestaje vrijediti
// upravo kad je potrebna. Zato parnost cuva test, ne disciplina.
//
// Ovaj fajl cita fajlove repoa sa diska, sto je u src/core neobicno (ostali testovi rade nad
// privremenim folderima). Radi jer je dubina ista iz src/core i iz dist/core: tsconfig ima
// rootDir=src i outDir=dist, a testovi se vrte iz dist/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VERZIJA } from "./verzija.js";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function citaj(ime: string): string {
  return readFileSync(join(KORIJEN, ime), "utf8");
}

test("VERZIJA je jednaka verziji u package.json, inace audit log tvrdi drugi broj od npm-a", () => {
  const pkg = JSON.parse(citaj("package.json")) as { version?: unknown };
  assert.equal(
    VERZIJA,
    pkg.version,
    "Broj se ne mijenja rucno: pokreni `bun pm version <broj>` ili `bun scripts/upisi-verziju.mjs`",
  );
});

test("VERZIJA je semver oblika, jer se iz nje izvodi ime taga izdanja", () => {
  assert.match(VERZIJA, /^\d+\.\d+\.\d+$/);
});

test("izdanje ima unos u CHANGELOG.md, jer izdanje bez zapisa ne kaze sta je uslo", () => {
  const naslov = new RegExp(`^## ${VERZIJA.replace(/\./g, "\\.")}( |$)`, "m");
  assert.match(
    citaj("CHANGELOG.md"),
    naslov,
    `Dodaj sekciju "## ${VERZIJA} — <datum>" u CHANGELOG.md prije izdanja`,
  );
});
