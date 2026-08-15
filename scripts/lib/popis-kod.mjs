// Sakupljaci koji citaju STVARNE registracije iz builda, bez pokretanja servera i bez izvrsavanja
// komandi. Oboje se oslanja na kapiju ulaza (src/core/ulaz.ts): `dist/mcp/server.js` i
// `dist/cli/index.js` se pokrecu sami samo kad su ulaz procesa, pa se smiju uvesti.
//
// Zasto ne stdio: `scripts/kontekst-izvjestaj.mjs` do popisa alata dolazi tako sto pokrene server i
// prica sa njim JSON-RPC-om preko cijevi. Za mjerenje velicine je to dovoljno, za izvor istine nije:
// zavisi od roka cekanja, ne vidi sablone resursa, i ne moze reci koji alat pripada kojem profilu
// bez drugog procesa.
//
// Zasto ne parsiranje izvornog koda: regex nad `server.registerTool(` puca tiho, u istoj onoj
// tisini od koje cijeli ovaj popis i bjezi.

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { poPolju } from "./popis-poredak.mjs";

/** Uvoz iz `dist/`, uz jasan pad kad build fali. Bez ovoga bi greska bila "Cannot find module". */
async function uvezi(korijen, relativno) {
  const putanja = join(korijen, ...relativno);
  if (!existsSync(putanja)) {
    throw new Error(`Nema ${relativno.join("/")}. Pokreni build prije generatora popisa (bun run build).`);
  }
  return import(pathToFileURL(putanja).href);
}

/**
 * Alati i resursi MCP servera, oba profila iz jednog uvoza.
 *
 * Uslovni alati postoje samo kad je podesen odgovarajuci vanjski kljuc, pa se kljucevi ovdje
 * postavljaju na lazne vrijednosti PRIJE uvoza. Uvoz ne otvara transport i ne zove ni OLX ni
 * Gemini, pa lazan kljuc nikuda ne ode; jedini efekat je da se uslovna grana registruje i da alat
 * udje u popis sa napomenom pod kojim uslovom radi. Bez toga bi popis izgledao razlicito na masini
 * sa kljucem i bez njega, a on mora biti isti svuda.
 */
export async function skupiMcp(korijen) {
  process.env.OLX_MCP_PROFILE = "admin";
  // Oznake klijentske sesije se brisu iz OVOG procesa prije uvoza servera, iz istog razloga zbog
  // kojeg se gore postavljaju lazni kljucevi: popis mora biti isti na svakoj masini. Server od
  // sada sam prepoznaje klijentski runtime (`odrediMcpProfil`, src/core/config.ts), pa bi
  // generator pokrenut iz ljuske u kojoj je ostao CLAUDE_CONFIG_DIR nekog klona registrovao samo
  // klijentske alate i upisao krnj popis. Time bi `--provjeri` padao samo na nekim masinama, a to
  // je najgora vrsta neuspjeha: izgleda kao slucajan kvar, a nije.
  delete process.env.OLX_SESIJA_TIP;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.OLX_VID_API_KEY ||= "popis-mogucnosti";
  process.env.OLX_SLIKA_API_KEY ||= "popis-mogucnosti";

  const m = await uvezi(korijen, ["dist", "mcp", "server.js"]);
  const { POPIS_ALATA, POPIS_RESURSA, SAMO_ADMIN, SAMO_KLIJENT, USLOVI } = m;

  if (!Array.isArray(POPIS_ALATA) || POPIS_ALATA.length === 0) {
    throw new Error("dist/mcp/server.js nije prijavio nijedan alat. Je li build zastario?");
  }

  // Svaki uslov opisan u serveru mora se pojaviti bar na jednom alatu. Kad se ne pojavi, znaci da
  // ga postavljanje laznih kljuceva iznad nije ucinilo tacnim, pa bi alati te grane tiho ispali iz
  // popisa. To je tacno bolest zbog koje popis postoji, pa se prijavljuje kao pad.
  const vidjeniUslovi = new Set(POPIS_ALATA.map((a) => a.uslov).filter(Boolean));
  for (const uslov of Object.keys(USLOVI)) {
    if (!vidjeniUslovi.has(uslov)) {
      throw new Error(
        `Uslov "${uslov}" je opisan u src/mcp/server.ts ali nijedan alat pod njim nije registrovan. ` +
          "Generator ga ne zna uciniti tacnim, pa bi ti alati nestali iz popisa. Dopuni skupiMcp u scripts/lib/popis-kod.mjs.",
      );
    }
  }

  const alati = POPIS_ALATA.map((a) => ({
    ...a,
    // Profil se izvodi, ne cita drugim procesom: filter u serveru je tacno ovaj uslov.
    profil: SAMO_ADMIN.has(a.ime) ? "admin" : SAMO_KLIJENT.has(a.ime) ? "klijent" : "oba",
    vrsta: a.samoCitanje ? "citanje" : a.razoran ? "trosak ili nepovratno" : "upis",
    uslovOpis: a.uslov ? USLOVI[a.uslov] : undefined,
  })).sort(poPolju("ime"));

  const resursi = [...POPIS_RESURSA].sort(poPolju("ime"));

  return { alati, resursi, uslovi: USLOVI };
}

/**
 * Stablo CLI komandi iz commandera. Stablo je pravi objekat, pa se seta a ne parsira: dobijamo i
 * argumente i opcije, ne samo imena.
 */
export async function skupiCli(korijen) {
  const m = await uvezi(korijen, ["dist", "cli", "index.js"]);
  const program = m.program;
  if (!program || typeof program.commands?.length !== "number") {
    throw new Error("dist/cli/index.js ne izvozi `program`. Je li build zastario?");
  }
  const komande = [];
  obidji(program, [], komande);
  if (komande.length === 0) throw new Error("CLI nije prijavio nijednu komandu.");
  return komande.sort(poPolju("putanja"));
}

/** Rekurzivno skuplja listove i cvorove stabla komandi. Korijen (`olx`) se ne upisuje. */
function obidji(cvor, staza, izlaz) {
  for (const k of cvor.commands) {
    // Commander sam dodaje `help` podkomandu; ona nije mogucnost sistema.
    if (k.name() === "help") continue;
    const putanja = [...staza, k.name()];
    izlaz.push({
      putanja: putanja.join(" "),
      opis: k.description() || undefined,
      // `registeredArguments` postoji od commandera 10; `_args` je stari naziv istog niza.
      argumenti: (k.registeredArguments ?? k._args ?? []).map(
        (a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`) + (a.variadic ? "..." : ""),
      ),
      opcije: k.options.map((o) => ({ zastava: o.flags, opis: o.description || undefined })),
      // Cvor bez vlastite radnje je samo grupa (npr. `listings`), a ne komanda koja nesto radi.
      grupa: k.commands.length > 0,
    });
    obidji(k, putanja, izlaz);
  }
}
