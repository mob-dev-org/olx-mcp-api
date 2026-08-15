#!/usr/bin/env bun
// Zaostaje li ovaj klon za izdanjem koje flota treba da vozi?
//
// Zasto postoji: klon stoji detached na tagu i NE prati nista sam. Kad se pomjeri prekidac
// `stabilno`, klon o tome ne zna dok ga neko ne azurira. Ovo je jedini nacin da se to vidi bez
// da se sjetis provjeriti.
//
// Sto NE radi: ne povlaci, ne gradi, ne restartuje. Samo javi i da komandu. Zamjena koda ispod
// zive sesije ostavlja MCP server na starom buildu, a noc bez nadzora nije trenutak za build.
// Povlacenje je `bun scripts/azuriraj-ovaj-klon.mjs`, svjestan potez.
//
// Nikad ne pada i nikad ne blokira: bez mreze, bez gita, bez remotea izlazi tiho sa kodom 0.
// Pozvan je iz SessionStart hooka, pa bi svaki pad bio pad pokretanja sesije.
//
// Pokretanje:
//   bun scripts/provjeri-izdanje.mjs                     # stanje, uvijek ispise
//   bun scripts/provjeri-izdanje.mjs --samo-zaostajanje   # tisina kad je sve u redu (hook)

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMO_ZAOSTAJANJE = process.argv.includes("--samo-zaostajanje");
const TAG = (process.env.OLX_TAG ?? "stabilno").trim() || "stabilno";

// Mreza dobija kratak rok. Bolje bez odgovora nego sesija koja ceka na git.
const ROK_MS = Number(process.env.OLX_PROVJERA_IZDANJA_ROK_MS ?? 5000);

function git(args, { rok } = {}) {
  return execFileSync("git", args, {
    cwd: KORIJEN,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: rok,
    // Bez ovoga git moze zatraziti lozinku i visjeti do roka.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
    .toString()
    .trim();
}

function tiho() {
  process.exit(0);
}

// U KLIJENTSKOJ bot sesiji se ne javlja nista, i to nije stidljivost. Izlaz hooka ulazi u kontekst
// sesije, pa bi bot mogao klijentu spomenuti verziju i azuriranje; klijent o tome ne treba znati
// niti moze ista uraditi. Uz to klijentska sesija nema Bash, pa je komanda tamo bezvrijedna.
// Klijentski klon se nadzire sa admin masine (`azuriraj-sve.sh`, `provjeri-klon.mjs`).
// Prepoznaje se po CLAUDE_CONFIG_DIR koji postavlja cuvar; admin bot (`.claude-runtime-admin`) i
// terminalska sesija (bez te varijable) izvjestaj DOBIJAJU.
const RUNTIME = (process.env.CLAUDE_CONFIG_DIR ?? "").replace(/[/\\]+$/, "");
if (SAMO_ZAOSTAJANJE && RUNTIME.endsWith(".claude-runtime")) tiho();

if (!existsSync(join(KORIJEN, ".git"))) tiho();

let lokalno = "";
let lokalniSha = "";
try {
  lokalniSha = git(["rev-parse", "HEAD"]);
  lokalno = git(["describe", "--tags", "--always"]);
} catch {
  tiho();
}

// Daljinsko stanje: SHA na koji pokazuje prekidac, pa ime izdanja koje sjedi na tom SHA.
// `^{}` red je peeled vrijednost anotiranog taga, dakle commit; lightweight tag ga nema.
let daljinskiSha = "";
let daljinskoIme = "";
try {
  const svi = git(["ls-remote", "--tags", "origin"], { rok: ROK_MS })
    .split("\n")
    .map((r) => r.split("\t"))
    .filter((d) => d.length === 2);

  const shaZaRef = new Map();
  for (const [sha, ref] of svi) shaZaRef.set(ref, sha);

  daljinskiSha = shaZaRef.get(`refs/tags/${TAG}^{}`) ?? shaZaRef.get(`refs/tags/${TAG}`) ?? "";

  if (daljinskiSha) {
    for (const [sha, ref] of svi) {
      const m = ref.match(/^refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/);
      if (m && sha === daljinskiSha) {
        daljinskoIme = m[1] ?? "";
        break;
      }
    }
  }
} catch {
  // Bez mreze se ne moze reci nista o daljinskom stanju; to nije greska klona.
  if (SAMO_ZAOSTAJANJE) tiho();
  console.log(`Izdanje ovog klona: ${lokalno} (daljinsko stanje nepoznato, nema mreze ili remotea)`);
  process.exit(0);
}

if (!daljinskiSha) {
  if (SAMO_ZAOSTAJANJE) tiho();
  console.log(`Izdanje ovog klona: ${lokalno} (daljinski tag "${TAG}" ne postoji)`);
  process.exit(0);
}

if (daljinskiSha === lokalniSha) {
  if (SAMO_ZAOSTAJANJE) tiho();
  console.log(`Izdanje ovog klona: ${lokalno} — najnovije, prekidac "${TAG}" pokazuje ovdje.`);
  process.exit(0);
}

// Razvojni klon (na `main`) je normalno ISPRED prekidaca: tu je izdanje jos nenapravljeno, a ne
// propusteno. Bez ove razlike bi admin klon svaki dan javljao alarm koji ne znaci nista.
// Provjera trazi da daljinski commit postoji lokalno i da je predak HEAD-a; klon koji stvarno
// zaostaje taj commit jos nema, pa oba koraka padnu i to je tacan odgovor.
let ispred = false;
try {
  git(["cat-file", "-e", `${daljinskiSha}^{commit}`]);
  git(["merge-base", "--is-ancestor", daljinskiSha, "HEAD"]);
  ispred = true;
} catch {
  ispred = false;
}

const cilj = daljinskoIme || daljinskiSha.slice(0, 7);

if (ispred) {
  if (SAMO_ZAOSTAJANJE) tiho();
  console.log(
    `Izdanje ovog klona: ${lokalno} — ISPRED prekidaca "${TAG}" (${cilj}).\n` +
      `Normalno za razvojni klon: rad je gotov, izdanje jos nije pusteno u flotu.\n` +
      `Kad je provjereno: bun scripts/izdanje.mjs <broj>`,
  );
  process.exit(0);
}
console.log(
  [
    `KLON ZAOSTAJE: radi na ${lokalno}, a prekidac "${TAG}" pokazuje na ${cilj}.`,
    `Azuriranje ovog klona (gradi i testira prije zamjene, pa restartuje sesije):`,
    `  bun scripts/azuriraj-ovaj-klon.mjs`,
    `Sta je uslo: CHANGELOG.md. Povlacenje NIJE automatsko namjerno, jer zamjena koda ispod zive`,
    `sesije ostavlja MCP server na starom buildu.`,
  ].join("\n"),
);
