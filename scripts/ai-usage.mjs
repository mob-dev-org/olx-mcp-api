// Zbirni pregled potrosnje modela iz .olx-pik/ai-usage.jsonl.
// Pokretanje: npm run ai:usage
// Filtriranje: npm run ai:usage -- --dan 2026-07-26

import { readFileSync, existsSync } from "node:fs";
import { CIJENE, DNEVNIK } from "./ai-cijene.mjs";

const argv = process.argv.slice(2);
const dan = argv.includes("--dan") ? argv[argv.indexOf("--dan") + 1] : null;

if (!existsSync(DNEVNIK)) {
  console.log(`Nema dnevnika (${DNEVNIK}). Pokreni npm run deepseek:proba ili radi kroz sesiju.`);
  process.exit(0);
}

const redovi = readFileSync(DNEVNIK, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((r) => !dan || r.ts.startsWith(dan));

if (!redovi.length) {
  console.log(dan ? `Nema zapisa za ${dan}.` : "Dnevnik je prazan.");
  process.exit(0);
}

const prazno = () => ({ poziva: 0, ulaz: 0, hit: 0, izlaz: 0, cijena: 0, pada: 0, ms: 0 });

function saberi(mapa, kljuc, r) {
  const a = (mapa[kljuc] ??= prazno());
  a.poziva += 1;
  a.ulaz += r.ulaz_ukupno ?? 0;
  a.hit += r.ulaz_hit ?? 0;
  a.izlaz += r.izlaz ?? 0;
  a.cijena += r.cijena_usd ?? 0;
  a.ms += r.trajanje_ms ?? 0;
  if (r.ok === false) a.pada += 1;
}

const poModelu = {};
const poZadatku = {};
const poDanu = {};
for (const r of redovi) {
  saberi(poModelu, r.model_dobijen ?? r.model_trazen ?? "nepoznat", r);
  saberi(poZadatku, r.zadatak ?? "bez oznake", r);
  saberi(poDanu, r.ts.slice(0, 10), r);
}

const usd = (n) => `$${n.toFixed(6)}`;
const pct = (a, b) => (b === 0 ? "0%" : `${Math.round((a / b) * 100)}%`);

function tabela(naslov, mapa, kolona) {
  console.log(`\n== ${naslov} ==`);
  console.log(
    `${kolona.padEnd(26)} ${"poziva".padStart(7)} ${"ulaz".padStart(9)} ${"kes".padStart(6)} ${"izlaz".padStart(8)} ${"cijena".padStart(12)}`,
  );
  const redoviSort = Object.entries(mapa).sort((a, b) => b[1].cijena - a[1].cijena);
  for (const [k, v] of redoviSort) {
    console.log(
      `${k.slice(0, 26).padEnd(26)} ${String(v.poziva).padStart(7)} ${String(v.ulaz).padStart(9)}` +
        ` ${pct(v.hit, v.ulaz).padStart(6)} ${String(v.izlaz).padStart(8)} ${usd(v.cijena).padStart(12)}` +
        (v.pada ? `  (${v.pada} pada)` : ""),
    );
  }
}

const ukupno = Object.values(poModelu).reduce(
  (a, v) => ({
    poziva: a.poziva + v.poziva,
    ulaz: a.ulaz + v.ulaz,
    hit: a.hit + v.hit,
    izlaz: a.izlaz + v.izlaz,
    cijena: a.cijena + v.cijena,
    pada: a.pada + v.pada,
    ms: a.ms + v.ms,
  }),
  prazno(),
);

console.log(`Dnevnik: ${DNEVNIK}${dan ? `, dan ${dan}` : ""}`);
console.log(
  `Ukupno ${ukupno.poziva} poziva, ${ukupno.ulaz} ulaznih i ${ukupno.izlaz} izlaznih tokena, ` +
    `${usd(ukupno.cijena)}, kes pokriva ${pct(ukupno.hit, ukupno.ulaz)} ulaza` +
    (ukupno.pada ? `, ${ukupno.pada} poziva palo` : ""),
);
if (ukupno.poziva) {
  console.log(
    `Prosjek po pozivu: ${Math.round(ukupno.ulaz / ukupno.poziva)} ulaznih tokena, ` +
      `${usd(ukupno.cijena / ukupno.poziva)}, ${Math.round(ukupno.ms / ukupno.poziva)}ms`,
  );
}

tabela("po modelu", poModelu, "model");
tabela("po zadatku", poZadatku, "zadatak");
if (!dan) tabela("po danu", poDanu, "dan");

console.log("\nProjekcija na 100 poteza dnevno, po trenutnom prosjeku:");
if (ukupno.poziva) {
  const poPozivu = ukupno.cijena / ukupno.poziva;
  console.log(`  dnevno oko ${usd(poPozivu * 100)}, mjesecno oko ${usd(poPozivu * 100 * 30)}`);
  const modeli = Object.keys(CIJENE).filter((m) => m.startsWith("claude"));
  console.log(
    `  za poredjenje, isti broj ulaznih tokena na ${modeli[0]} kosta oko ` +
      `$${(((ukupno.ulaz / ukupno.poziva) * 100 * 30) / 1e6 * CIJENE[modeli[0]].ulazMiss).toFixed(2)} mjesecno samo na ulazu`,
  );
}
