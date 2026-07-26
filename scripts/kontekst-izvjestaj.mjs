// Mjeri sta se salje modelu u svakom potezu i sta se salje samo po potrebi.
// Sluzi da se odluci sta vrijedi trimovati, umjesto da se nagadja.
// Pokretanje: npm run kontekst
//
// Podjela je vazna:
//   uvijek  = MCP seme alata, CLAUDE.md, opisi skillova iz frontmattera
//   po potrebi = tijela skillova, reference, MCP resursi

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CIJENE } from "./ai-cijene.mjs";

const ZNAKOVA_PO_TOKENU = 3.6; // gruba procjena za bosanski i engleski tekst pomijesano
const tok = (znakova) => Math.round(znakova / ZNAKOVA_PO_TOKENU);

function velicina(putanja) {
  try {
    return statSync(putanja).size;
  } catch {
    return 0;
  }
}

/** Cita opis iz YAML frontmattera skilla, to je dio koji je uvijek u kontekstu. */
function opisSkilla(putanja) {
  const tekst = readFileSync(putanja, "utf8");
  const fm = tekst.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return { opis: 0, tijelo: tekst.length };
  const opis = fm[1].match(/description:\s*([\s\S]*?)(?:\n[a-z_]+:|$)/)?.[1] ?? "";
  return { opis: opis.length, tijelo: tekst.length - fm[0].length };
}

function dohvatiAlate() {
  return new Promise((resolve) => {
    const child = spawn("node", ["dist/mcp/server.js"], { stdio: ["pipe", "pipe", "ignore"] });
    const alati = [];
    const resursi = [];
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
          if (m.id === 2) alati.push(...(m.result?.tools ?? []));
          if (m.id === 3) resursi.push(...(m.result?.resources ?? []));
        } catch {
          // ignorisi
        }
      }
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
    setTimeout(() => {
      child.kill();
      resolve({ alati, resursi });
    }, 2500);
  });
}

const { alati, resursi } = await dohvatiAlate();

const semeSvih = alati.map((t) => ({
  name: t.name,
  znakova: JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema }).length,
}));
const mcpZnakova = semeSvih.reduce((a, t) => a + t.znakova, 0);

const claudeMd = velicina("CLAUDE.md");

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

const opisiUkupno = skillovi.reduce((a, s) => a + s.opis, 0);
const tijelaUkupno = skillovi.reduce((a, s) => a + s.tijelo, 0);
const referenceUkupno = skillovi.reduce((a, s) => a + s.reference, 0);

const uvijek = mcpZnakova + claudeMd + opisiUkupno;

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
red("CLAUDE.md", claudeMd);
red(`opisi skillova (${skillovi.length})`, opisiUkupno);
console.log("-".repeat(96));
red("UKUPNO iz ovog repoa", uvijek);
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

console.log("\n=== projekcija na 100 poteza dnevno, samo ovaj prefiks ===\n");
for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
  const dnevno = (tok(uvijek) / 1e6) * CIJENE[model].ulazMiss * 100;
  console.log(`  ${model.padEnd(20)} dnevno $${dnevno.toFixed(4)}  mjesecno $${(dnevno * 30).toFixed(2)}`);
}
console.log(
  "\n  ako DeepSeek automatski kesira ponovljeni prefiks, ovo pada oko 50 puta.\n" +
    "  provjeri kolonu kes u npm run ai:usage.",
);
