// Mjeri sta se salje modelu u svakom potezu i sta se salje samo po potrebi.
// Sluzi da se odluci sta vrijedi trimovati, umjesto da se nagadja.
// Pokretanje: bun run kontekst          (samo ovaj repo, bez pokretanja tudjih procesa)
//             bun run kontekst -- --sa-globalnim   (mjeri i globalne MCP servere)
//
// Podjela je vazna:
//   uvijek  = MCP seme alata, CLAUDE.md, opisi skillova iz frontmattera
//   po potrebi = tijela skillova, reference, MCP resursi
//
// Drugi dio izvjestaja mjeri ono STO NIJE u ovom repou a ipak ulazi u svaki potez: globalne MCP
// servere iz ~/.claude.json i opise skillova iz instaliranih plugina. To je ono sto gasi
// izolacija (.claude/settings.json kljuc enabledPlugins i scripts/claude-olx.sh).
//
// Globalni MCP serveri se mjere samo uz --sa-globalnim, jer mjerenje znaci pokretanje tih
// procesa (pencil recimo pokrece binarni fajl aplikacije). Bez zastavice se samo nabroje.

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CIJENE } from "./ai-cijene.mjs";

const SA_GLOBALNIM = process.argv.includes("--sa-globalnim");

const ZNAKOVA_PO_TOKENU = 3.6; // gruba procjena za bosanski i engleski tekst pomijesano
const tok = (znakova) => Math.round(znakova / ZNAKOVA_PO_TOKENU);

function velicina(putanja) {
  try {
    return statSync(putanja).size;
  } catch {
    return 0;
  }
}

/**
 * Velicina fajla plus svih fajlova koje ubacuje kroz `@putanja` na pocetku linije.
 * Bez toga bi CLAUDE.md izgledao manji nego sto stvarno jeste, jer granice.md ulazi u kontekst
 * ali se ne broji. Prati includove u dubinu, sa zastitom od kruga.
 */
function velicinaSaIncludovima(putanja, vidjeni = new Set()) {
  if (vidjeni.has(putanja) || !existsSync(putanja)) return 0;
  vidjeni.add(putanja);
  let tekst;
  try {
    tekst = readFileSync(putanja, "utf8");
  } catch {
    return 0;
  }
  let ukupno = tekst.length;
  for (const m of tekst.matchAll(/^@([^\s]+)$/gm)) {
    ukupno += velicinaSaIncludovima(m[1], vidjeni);
  }
  return ukupno;
}

/** Cita opis iz YAML frontmattera skilla, to je dio koji je uvijek u kontekstu. */
function opisSkilla(putanja) {
  const tekst = readFileSync(putanja, "utf8");
  const fm = tekst.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { opis: 0, tijelo: tekst.length };
  const opis = fm[1].match(/description:\s*([\s\S]*?)(?:\n[a-z_]+:|$)/)?.[1] ?? "";
  return { opis: opis.length, tijelo: tekst.length - fm[0].length };
}

/**
 * Pokrene stdio MCP server i procita mu popis alata i resursa.
 *
 * Zavrsava CIM stignu oba odgovora, a `cekaj` je krov a ne takt: fiksno cekanje je znacilo da se
 * na sporoj masini vrati prazna lista, sto je ovaj izvjestaj prikazivao kao pad konteksta na nulu.
 * Rast konteksta hrani odluku o izdanju, pa tiha nula tu nije bezopasna. Zato prekoracenje roka
 * vraca `greska`, a pozivalac za NAS server na to pada.
 *
 * Za tudje (globalne) servere prazan odgovor ostaje podnosljiv, oni se samo preskoce.
 */
// Oznake klijentske sesije se djetetu NE nasljedjuju: ovaj alat MJERI profil koji je sam zadao,
// ne onaj koji zatekne u ljusci. Bez ovoga bi `bun run kontekst` pokrenut iz ljuske u kojoj je
// ostao CLAUDE_CONFIG_DIR nekog klona tiho izmjerio 44 alata umjesto 59 i upisao taj broj u
// izvjestaj, a broj iz alata za mjerenje niko ne provjerava drugim putem. Prazan string, ne
// delete: spread nize mora pregaziti vrijednost iz process.env, a `loadConfig` prazno cita kao
// nezadano. Vidi `odrediMcpProfil` u src/core/config.ts.
const bezOznakaSesije = { OLX_SESIJA_TIP: "", CLAUDE_CONFIG_DIR: "" };

function dohvatiAlate({ command = "node", args = ["dist/mcp/server.js"], env, cekaj = 2500 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "ignore"],
        env: env ? { ...process.env, ...bezOznakaSesije, ...env } : process.env,
      });
    } catch {
      resolve({ alati: [], resursi: [], greska: "pokretanje nije uspjelo" });
      return;
    }
    child.on("error", () => resolve({ alati: [], resursi: [], greska: "pokretanje nije uspjelo" }));
    const alati = [];
    const resursi = [];
    let stigloAlata = false;
    let stigloResursa = false;
    let zavrseno = false;
    const zavrsi = (ishod) => {
      if (zavrseno) return;
      zavrseno = true;
      clearTimeout(krov);
      child.kill();
      resolve(ishod);
    };
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linija = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linija) continue;
        try {
          const m = JSON.parse(linija);
          if (m.id === 2) {
            alati.push(...(m.result?.tools ?? []));
            stigloAlata = true;
          }
          if (m.id === 3) {
            resursi.push(...(m.result?.resources ?? []));
            stigloResursa = true;
          }
        } catch {
          // ignorisi
        }
      }
      if (stigloAlata && stigloResursa) zavrsi({ alati, resursi });
    });
    const posalji = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    posalji({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "kontekst", version: "0" } },
    });
    posalji({ jsonrpc: "2.0", method: "notifications/initialized" });
    posalji({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    posalji({ jsonrpc: "2.0", id: 3, method: "resources/list" });
    const krov = setTimeout(() => {
      zavrseno = true;
      child.kill();
      resolve({ alati, resursi, greska: `nije odgovorio u ${cekaj} ms` });
    }, cekaj);
  });
}

/** Isto, ali za NAS server: prekoracen rok ili prazan popis su pad, ne nula u izvjestaju. */
async function dohvatiNase(env) {
  const ishod = await dohvatiAlate({ env });
  if (ishod.greska || ishod.alati.length === 0) {
    console.error(
      `Ne mogu procitati MCP alate iz dist/mcp/server.js (profil ${env.OLX_MCP_PROFILE}): ` +
        `${ishod.greska ?? "vratio je praznu listu"}.`,
    );
    console.error("Je li build prosao (bun run build)? Izvjestaj bez ovoga lazno pokazuje pad konteksta.");
    process.exit(1);
  }
  return ishod;
}

/** Zbir znakova sema alata, isti oblik racunanja kao za olx-pik. */
function semaZnakova(alati) {
  return alati.reduce(
    (a, t) => a + JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema }).length,
    0,
  );
}

function citajJson(putanja) {
  try {
    return JSON.parse(readFileSync(putanja, "utf8"));
  } catch {
    return null;
  }
}

const { alati, resursi } = await dohvatiNase({ OLX_MCP_PROFILE: "admin" });
const { alati: alatiKlijent } = await dohvatiNase({ OLX_MCP_PROFILE: "klijent" });

const semeSvih = alati.map((t) => ({
  name: t.name,
  znakova: JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema }).length,
}));
const mcpZnakova = semeSvih.reduce((a, t) => a + t.znakova, 0);

// CLAUDE.md se ucitava automatski u OBA runtimea, jer se obje sesije pokrecu iz korijena klona.
// Zato ulazi i u admin i u klijentski zbir. Prompt fajlovi profila se dodaju povrh njega i cine
// se doslovno (bez razrjesavanja @ importa), pa se mjere kakvi jesu.
const claudeMd = velicinaSaIncludovima("CLAUDE.md");
const adminPrompt = velicina("runtime/SISTEM-admin.md");
const klijentPrompt = velicina("runtime/SISTEM-klijent.md");

const skillDir = ".claude/skills";
const skillovi = existsSync(skillDir)
  ? readdirSync(skillDir)
      .filter((d) => existsSync(join(skillDir, d, "SKILL.md")))
      .map((d) => {
        const { opis, tijelo } = opisSkilla(join(skillDir, d, "SKILL.md"));
        const refDir = join(skillDir, d, "references");
        const reference = existsSync(refDir)
          ? readdirSync(refDir).reduce((a, f) => a + velicina(join(refDir, f)), 0)
          : 0;
        return { ime: d, opis, tijelo, reference };
      })
  : [];

// Popis podagenata se, kao i popis skillova, ubacuje u sistemski prompt u SVAKOM potezu.
// Mjeri se da se vidi placa li se izolacija konteksta vise nego sto donosi.
const agentDir = ".claude/agents";
const agenti = existsSync(agentDir)
  ? readdirSync(agentDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ ime: f.replace(/\.md$/, ""), ...opisSkilla(join(agentDir, f)) }))
  : [];
const agentiOpisa = agenti.reduce((a, x) => a + x.opis, 0);

const opisiUkupno = skillovi.reduce((a, s) => a + s.opis, 0);
const tijelaUkupno = skillovi.reduce((a, s) => a + s.tijelo, 0);
const referenceUkupno = skillovi.reduce((a, s) => a + s.reference, 0);

const uvijek = mcpZnakova + claudeMd + adminPrompt + opisiUkupno + agentiOpisa;

function cijena(znakova, model) {
  const c = CIJENE[model];
  return ((tok(znakova) / 1e6) * c.ulazMiss).toFixed(6);
}

console.log("=== uvijek u kontekstu, placa se u svakom potezu ===\n");
const red = (ime, znakova) =>
  console.log(
    `${ime.padEnd(34)} ${String(znakova).padStart(7)} znakova  ${String(tok(znakova)).padStart(6)} tok` +
      `  flash $${cijena(znakova, "deepseek-v4-flash")}  pro $${cijena(znakova, "deepseek-v4-pro")}`,
  );

red(`MCP seme (${alati.length} alata)`, mcpZnakova);
red("CLAUDE.md sa includovima", claudeMd);
red("SISTEM-admin.md", adminPrompt);
red(`opisi skillova (${skillovi.length})`, opisiUkupno);
if (agenti.length > 0) red(`opisi podagenata (${agenti.length})`, agentiOpisa);
console.log("-".repeat(96));
red("UKUPNO profil admin", uvijek);

// Klijentski profil: uze MCP seme i drugi prompt profila, ali ISTI CLAUDE.md i isti skillovi.
const mcpKlijent = semaZnakova(alatiKlijent);
// Klijent ima Task u permissions.deny, pa podagente ne moze pokrenuti. Opisi mu ipak ulaze
// u kontekst, jer se popis agenata gradi iz .claude/agents bez obzira na dozvole.
const ukupnoKlijent = mcpKlijent + claudeMd + klijentPrompt + opisiUkupno + agentiOpisa;
if (klijentPrompt > 0 && alatiKlijent.length > 0) {
  console.log("\n  isti zbir za profil klijent:");
  red(`  MCP seme (${alatiKlijent.length} alata)`, mcpKlijent);
  red("  CLAUDE.md sa includovima", claudeMd);
  red("  SISTEM-klijent.md", klijentPrompt);
  red(`  opisi skillova (${skillovi.length})`, opisiUkupno);
  if (agenti.length > 0) red(`  opisi podagenata (${agenti.length}, klijent ih ne moze zvati)`, agentiOpisa);
  red("  UKUPNO profil klijent", ukupnoKlijent);
}
console.log(
  "\nNapomena: ovo je samo dio prefiksa. Claude Code dodaje svoj sistemski prompt, ugradjene alate\n" +
    "i popis svih skillova sa masine, sto ovaj repo ne kontrolise i ovdje se ne mjeri.",
);

console.log("\n=== po potrebi, placa se samo kad se otvori ===\n");
red("tijela skillova", tijelaUkupno);
red("reference skillova", referenceUkupno);
for (const r of resursi) {
  const putanja = (r.uri ?? "").replace(/^olx:\/\//, "");
  console.log(`  resurs ${r.name ?? putanja}`);
}

console.log("\n=== deset najskupljih MCP alata ===\n");
for (const t of [...semeSvih].sort((a, b) => b.znakova - a.znakova).slice(0, 10)) {
  const dio = ((t.znakova / mcpZnakova) * 100).toFixed(1);
  console.log(`  ${String(t.znakova).padStart(5)} znakova  ${dio.padStart(5)}%  ${t.name}`);
}

// Grupa alata koja je kandidat za izbacivanje: pretraga kategorija i lokacija
// postoji i kao CSV snapshot, pa je u dnevnom radu rijetko potrebna.
const kandidati = semeSvih.filter((t) =>
  /^olx_(categories|category|category_attributes|category_brands|category_children|category_models|cities|city|countries|canton_cities|find_category|suggest_category)$/.test(
    t.name,
  ),
);
const kandidatiZnakova = kandidati.reduce((a, t) => a + t.znakova, 0);
console.log(
  `\n=== kandidat za smanjenje: kategorije i lokacije (${kandidati.length} alata) ===\n` +
    `  ${kandidatiZnakova} znakova, ${tok(kandidatiZnakova)} tokena, ` +
    `${((kandidatiZnakova / mcpZnakova) * 100).toFixed(1)}% MCP prefiksa\n` +
    `  ovi podaci postoje i kao CSV snapshot (olx://categories-index, olx://locations-index)\n` +
    `  i mijenjaju se rijetko, pa mogu ici iza prekidaca umjesto u svaki zahtjev`,
);

// ---------------------------------------------------------------------------------------------
// Izvan repoa: globalni MCP serveri i plugin skillovi. Ovo gasi izolacija.
// ---------------------------------------------------------------------------------------------

console.log("\n=== izvan repoa, ono sto gasi izolacija ===\n");

const globalniServeri = Object.entries(citajJson(join(homedir(), ".claude.json"))?.mcpServers ?? {}).filter(
  ([ime]) => ime !== "olx-pik",
);

let globalniZnakova = 0;
let globalniMjereno = 0;

if (globalniServeri.length === 0) {
  console.log("  globalni MCP serveri: nema ih u ~/.claude.json");
} else if (!SA_GLOBALNIM) {
  console.log(`  globalni MCP serveri (${globalniServeri.length}): ${globalniServeri.map(([i]) => i).join(", ")}`);
  console.log("  nisu izmjereni. Za mjerenje: bun run kontekst -- --sa-globalnim");
  console.log("  (mjerenje ih stvarno pokrece, pa se ne radi bez trazenja)");
} else {
  for (const [ime, spec] of globalniServeri) {
    if (spec.type && spec.type !== "stdio") {
      console.log(`  ${ime.padEnd(18)} tip ${spec.type}, ne mjeri se ovom skriptom`);
      continue;
    }
    const { alati, greska } = await dohvatiAlate({
      command: spec.command,
      args: spec.args ?? [],
      env: spec.env,
      cekaj: 5000,
    });
    if (greska || alati.length === 0) {
      console.log(`  ${ime.padEnd(18)} nije odgovorio, ne racuna se`);
      continue;
    }
    const zn = semaZnakova(alati);
    globalniZnakova += zn;
    globalniMjereno += 1;
    red(`  ${ime} (${alati.length} alata)`, zn);
  }
}

// Opisi skillova iz instaliranih plugina. Cita se samo verzija na koju pokazuje
// installed_plugins.json, ne sve zaostale verzije u kesu.
const instalirani = citajJson(join(homedir(), ".claude", "plugins", "installed_plugins.json"))?.plugins ?? {};
const projektniPlugini = citajJson(".claude/settings.json")?.enabledPlugins ?? {};

let pluginOpisa = 0;
let pluginSkillova = 0;
let ugasenoOpisa = 0;
let ugasenoSkillova = 0;

for (const [kljuc, unosi] of Object.entries(instalirani)) {
  const putanja = unosi?.[0]?.installPath;
  if (!putanja) continue;
  const skillDirPlugina = join(putanja, "skills");
  if (!existsSync(skillDirPlugina)) continue;
  const ugasen = projektniPlugini[kljuc] === false;
  for (const d of readdirSync(skillDirPlugina)) {
    const sm = join(skillDirPlugina, d, "SKILL.md");
    if (!existsSync(sm)) continue;
    const { opis } = opisSkilla(sm);
    pluginOpisa += opis;
    pluginSkillova += 1;
    if (ugasen) {
      ugasenoOpisa += opis;
      ugasenoSkillova += 1;
    }
  }
}

console.log("");
red(`opisi skillova iz plugina (${pluginSkillova})`, pluginOpisa);
red(`  od toga ugaseno u ovom repou (${ugasenoSkillova})`, ugasenoOpisa);

const izvanRepoa = globalniZnakova + pluginOpisa;
const ustedjeno = globalniZnakova + ugasenoOpisa;

console.log("-".repeat(96));
red("UKUPNO izvan repoa", izvanRepoa);
red("od toga gasi izolacija", ustedjeno);

if (!SA_GLOBALNIM && globalniServeri.length > 0) {
  console.log("\n  Brojka za globalne servere fali. Pokreni sa --sa-globalnim za punu sliku.");
} else if (globalniMjereno > 0) {
  console.log(`\n  Izmjereno ${globalniMjereno} od ${globalniServeri.length} globalnih servera.`);
}

console.log("\n=== zbir po scenariju, uvijek u kontekstu ===\n");
red("bez izolacije", uvijek + izvanRepoa);
red("sa izolacijom", uvijek + izvanRepoa - ustedjeno);
if (ustedjeno > 0) {
  console.log(`\n  usteda ${((ustedjeno / (uvijek + izvanRepoa)) * 100).toFixed(1)}% na svakom potezu`);
}

console.log("\n=== projekcija na 100 poteza dnevno, samo ovaj prefiks ===\n");
for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
  const dnevno = (tok(uvijek) / 1e6) * CIJENE[model].ulazMiss * 100;
  console.log(`  ${model.padEnd(20)} dnevno $${dnevno.toFixed(4)}  mjesecno $${(dnevno * 30).toFixed(2)}`);
}
console.log(
  "\n  ako DeepSeek automatski kesira ponovljeni prefiks, ovo pada oko 50 puta.\n" +
    "  provjeri kolonu kes u bun run ai:usage.",
);
