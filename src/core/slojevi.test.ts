// Cuva smjer zavisnosti: `src/core` je jezgro i ne zna da CLI i MCP postoje.
//
// Danas nema ni jednog krsenja, dakle ovo je brana a ne popravka. Zasto brana: CLI i MCP su tanka
// lica nad jezgrom (.claude/rules/core-kod.md). Jedan uvoz u obrnutom smjeru pravi krug iz kojeg
// se izlazi tek refaktorom, a nastaje slucajno, jednim uvozom tipa koji je "zgodan odmah". Kad se
// jednom pojavi, jezgro se ne moze ni testirati ni izvuci bez lica.
//
// Ime fajla je `slojevi`, ne `granice`: `granice` u ovom repou znaci poslovna i eticka
// ogranicenja (olx-dokumentacija/granice.md), pa bi ime zbunjivalo.
//
// Cita se `src/core/*.ts`, ne `dist/core/*.js`, jer `tsc` brise uvoze tipova pa bi
// `import type { X } from "../mcp/..."` prosao neopazeno. Dubina je ista iz oba foldera
// (rootDir=src, outDir=dist), a testovi se vrte iz `dist/`.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IZVOR = join(KORIJEN, "src", "core");

// Hvata `from "..."`, `import "..."` i `import("...")`. Dinamican uvoz sa promjenljivom umjesto
// literala ne hvata i ne pretvara se da hvata; za to bi trebao parser, a takvog uvoza u repou
// nema.
const SPECIFIKATORI = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

// Komentari se izbacuju prije skeniranja. Nije kozmetika: komentari u ovom repou objasnjavaju
// zasto se nesto NE uvozi, pa citiraju upravo one specifikatore koje brana trazi (vidi
// verzija.ts). Bez ovoga brana prijavljuje objasnjenje kao krsenje. Izbacuju se samo linije koje
// pocinju komentarom, ne trailing komentar poslije koda, jer bi rezanje od "//" do kraja linije
// moglo odsjeci pravi uvoz koji stoji na istoj liniji sa URL-om.
function bezKomentara(tekst: string): string {
  return tekst
    .split("\n")
    .filter((linija) => {
      const t = linija.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

// Vraca specifikatore koji izlaze iz `src/core`. Ciste funkcije se testiraju, pa je i ova
// pokrivena sintetickim ulazom nize; bez toga bi greska u obrascu dala test koji je vjecno zelen.
export function izlaziIzJezgra(tekst: string): string[] {
  const van: string[] = [];
  for (const nadjeno of bezKomentara(tekst).matchAll(SPECIFIKATORI)) {
    const spec = nadjeno[1];
    if (spec === undefined || !spec.startsWith(".")) continue;
    // Putanja se razrjesava relativno na src/core, pa svaki izlazak iz tog foldera pada ovdje,
    // ukljucujuci buduci `src/nesto` sloj, ne samo danasnje mcp i cli.
    const razrijeseno = resolve(IZVOR, spec);
    if (!razrijeseno.startsWith(IZVOR)) van.push(spec);
  }
  return van;
}

test("jezgro ne uvozi iz lica: src/core je slijepo za src/mcp i src/cli", () => {
  // Vlastiti fajl se preskace: nize ima sinteticki uzorak sa "../mcp/server.js", pa bi test
  // prijavio sam sebe. To je jedini fajl koji ova brana ne pokriva.
  const ja = "slojevi.test.ts";
  const fajlovi = readdirSync(IZVOR).filter((f) => f.endsWith(".ts") && f !== ja);

  // Bez ove tvrdnje bi promjena putanje (drugi outDir, bundler) dala nula fajlova i test bi
  // ostao zelen zauvijek, a nista ne bi provjeravao.
  assert.ok(fajlovi.length > 10, `ocekivano vise fajlova u ${IZVOR}, nadjeno ${fajlovi.length}`);

  const krsenja: string[] = [];
  for (const fajl of fajlovi) {
    for (const spec of izlaziIzJezgra(readFileSync(join(IZVOR, fajl), "utf8"))) {
      krsenja.push(`${fajl} -> ${spec}`);
    }
  }

  assert.deepEqual(
    krsenja,
    [],
    "Jezgro ne smije uvoziti iz lica. Popravi uvoz, ne test: ono sto dijele ide u src/core.",
  );
});

test("brana stvarno hvata: uvoz iz lica se prepoznaje, uvoz unutar jezgra ne", () => {
  assert.deepEqual(izlaziIzJezgra(`import { x } from "../mcp/server.js";`), ["../mcp/server.js"]);
  assert.deepEqual(izlaziIzJezgra(`import type { Y } from "../cli/index.js";`), ["../cli/index.js"]);
  assert.deepEqual(izlaziIzJezgra(`const m = await import("../mcp/server.js");`), ["../mcp/server.js"]);
  assert.deepEqual(izlaziIzJezgra(`import { loadConfig } from "./config.js";`), []);
  assert.deepEqual(izlaziIzJezgra(`import { readFileSync } from "node:fs";`), []);
  // Komentar koji objasnjava zasto se nesto ne uvozi nije krsenje. Ovo je stvarni slucaj iz
  // verzija.ts, uhvacen prvim pokretanjem brane.
  assert.deepEqual(izlaziIzJezgra(`// - \`import pkg from "../../package.json"\` ne prolazi`), []);
});
