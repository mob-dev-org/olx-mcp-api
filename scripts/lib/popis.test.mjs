// Kapija protiv tihog starenja dokumentacije.
//
// Ovo NIJE provjera da fajl postoji. Provjera je: da li bi generator DANAS napisao tacno ono sto u
// popisu pise, i da li rucna lista pokriva svaku sposobnost koju kod ima. Popis koji zaostane za
// kodom je gori od popisa kojeg nema, jer se u njega vjeruje.
//
// Test se vrti u djetetu procesa, ne uvozom: generator uvozi `dist/mcp/server.js` i
// `dist/cli/index.js`, pa bi u procesu testa ostavio njihovo stanje za sobom.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("popis mogucnosti je usaglasen sa kodom", () => {
  const ishod = spawnSync(process.execPath, [join(KORIJEN, "scripts", "popis-mogucnosti.mjs"), "--provjeri"], {
    cwd: KORIJEN,
    encoding: "utf8",
    // Rok postoji da pad generatora ne zaledi cijeli `npm test`, koji je kapija izdanja.
    timeout: 60000,
  });

  if (ishod.error) assert.fail(`Generator popisa se nije mogao pokrenuti: ${ishod.error.message}`);

  // Poruka generatora se prenosi doslovno: ona vec kaze sta je zaostalo i koju komandu pokrenuti,
  // pa je svako sazimanje ovdje samo gubitak podatka onome ko ovo bude citao za pola godine.
  assert.equal(ishod.status, 0, `\n${ishod.stderr || ishod.stdout}`);
});
