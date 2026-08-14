import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Da li je modul pokrenut kao ULAZ procesa (`node dist/mcp/server.js`), ili ga je neko samo uvezao.
 *
 * Zasto postoji: i MCP server i CLI na kraju modula pokrecu sami sebe (`main()`, `parseAsync`).
 * Dok je to bezuslovno, modul se ne moze uvesti da bi mu se procitao popis alata ili stablo
 * komandi, jer bi uvoz podigao stdio server odnosno izvrsio komandu iz `process.argv` pozivaoca.
 * Generator popisa mogucnosti (`scripts/popis-mogucnosti.mjs`) trazi upravo to citanje.
 *
 * Zasto poredjenje ide preko `realpathSync`, a ne prosto `pathToFileURL(process.argv[1])`:
 * Node podrazumijevano razrjesava simbolicke veze pri ucitavanju modula, pa je `import.meta.url`
 * STVARNA putanja fajla, dok `process.argv[1]` ostaje putanja kojom je proces pozvan. Kad se CLI
 * pozove kroz `npm` bin vezu (`node_modules/.bin/olx`, simbolicka veza na POSIX-u), te dvije se
 * razlikuju i kapija bi tiho ugasila cijeli CLI. `realpathSync` ih svodi na isto.
 *
 * Windows: poredjenje bez obzira na velicinu slova, jer se slovo diska ume vratiti razlicito
 * (`C:\` naspram `c:\`) zavisno od toga kako je proces pokrenut.
 */
export function pokrenutDirektno(importMetaUrl: string): boolean {
  const ulaz = process.argv[1];
  if (!ulaz) return false; // REPL ili `node -e`: niko nije ulaz
  let stvarniUlaz: string;
  let stvarniModul: string;
  try {
    stvarniUlaz = realpathSync(ulaz);
    stvarniModul = realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
  if (process.platform === "win32") {
    return stvarniUlaz.toLowerCase() === stvarniModul.toLowerCase();
  }
  return stvarniUlaz === stvarniModul;
}
