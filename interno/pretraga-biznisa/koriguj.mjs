// Korekcioni prolaz za generičku klasifikaciju: "sporedna_ili_ostalo" iz prvog prolaza
// razdvaja se na pravu sporednu djelatnost (npr. dijelovi) i na "nije ciljna djelatnost"
// (nema veze ni sa ciljem ni sa sporednom - koristi vec sacuvan kes, bez novih API poziva.
// Poziva se: node koriguj.mjs <profil>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");

const imeProfila = process.argv[2] || "vozila";
const profil = JSON.parse(
  fs.readFileSync(path.join(__dirname, "profili", `${imeProfila}.json`), "utf8"),
);

const IZLAZ_DIR = path.join(__dirname, "izlazi", imeProfila);
const PROGRESS_FILE = path.join(IZLAZ_DIR, "progress.jsonl");
const CSV_FILE = path.join(IZLAZ_DIR, "shopovi.csv");
const MD_FILE = path.join(IZLAZ_DIR, "sazetak.md");

function ucitajKesHistogram(username) {
  const safe = username.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const kandidati = [`${safe}.json`, `${safe}__deep_podnaslovi.json`, `${safe}__deep.json`];
  for (const naziv of kandidati) {
    const p = path.join(CACHE_DIR, naziv);
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, "utf8")).podaci;
        return d?.kategorije ?? {};
      } catch {
        // preskoci los kes fajl
      }
    }
  }
  return {};
}

function imaDominantnuSporednu(kategorije) {
  const total = Object.values(kategorije).reduce((a, b) => a + b, 0);
  if (total === 0) return false;
  const sporedna = kategorije[profil.top_category_id_sporedna] ?? 0;
  return sporedna / total >= 0.5;
}

const zapisi = fs
  .readFileSync(PROGRESS_FILE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

let uSporednu = 0;
let uOstalo = 0;
for (const z of zapisi) {
  if (z.klasifikacija !== "sporedna_ili_ostalo") continue;
  if (z.shop_category_id === profil.shop_category_id_sporedna) {
    z.klasifikacija = profil.naziv_sporedne_klase;
    uSporednu++;
    continue;
  }
  const kategorije = ucitajKesHistogram(z.username);
  if (imaDominantnuSporednu(kategorije)) {
    z.klasifikacija = profil.naziv_sporedne_klase;
    uSporednu++;
    continue;
  }
  z.klasifikacija = profil.naziv_ostalih;
  z.obrazlozenje =
    z.obrazlozenje ||
    `shop_category_id nije ${profil.shop_category_id_sporedna} i histogram nema dominantnu kategoriju ${profil.top_category_id_sporedna}; nema veze sa trazenom djelatnoscu`;
  uOstalo++;
}

console.log(
  `Profil ${imeProfila}: prekategorisano u '${profil.naziv_sporedne_klase}': ${uSporednu}, u '${profil.naziv_ostalih}': ${uOstalo}`,
);

function csvVal(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const kolone = [
  "username", "naziv_firme", "paket", "grad", "kanton", "oglasa_snimak", "oglasa_api",
  "oglasa_cilj", "udio_cilj", "shop_category_id", "klasifikacija", "prolaz",
  "obrazlozenje", "link",
];
const linije = [kolone.join(",")];
for (const r of zapisi) linije.push(kolone.map((k) => csvVal(r[k])).join(","));
fs.writeFileSync(CSV_FILE, linije.join("\n") + "\n");

function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function izgradiSazetak(rezultati) {
  const poKlasi = {};
  for (const r of rezultati) poKlasi[r.klasifikacija] = (poKlasi[r.klasifikacija] ?? 0) + 1;

  const ciljni = rezultati.filter((r) => r.klasifikacija === profil.naziv_ciljne_klase);
  const sporedni = rezultati.filter((r) => r.klasifikacija === profil.naziv_sporedne_klase);
  const brojevi = ciljni.map((r) => r.oglasa_cilj ?? 0);

  const poKantonu = {};
  for (const r of rezultati) {
    const k = r.kanton || "Nepoznato";
    poKantonu[k] ??= { ciljni: 0, oglasi: 0 };
    if (r.klasifikacija === profil.naziv_ciljne_klase) {
      poKantonu[k].ciljni++;
      poKantonu[k].oglasi += r.oglasa_cilj ?? 0;
    }
  }

  const top20 = [...ciljni].sort((a, b) => (b.oglasa_cilj ?? 0) - (a.oglasa_cilj ?? 0)).slice(0, 20);

  const lines = [];
  lines.push(`# Sažetak klasifikacije — profil "${imeProfila}"\n`);
  lines.push(`${profil.opis}\n`);
  lines.push("## Broj shopova po klasifikaciji\n");
  for (const [k, v] of Object.entries(poKlasi)) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push(
    `Omjer ${profil.naziv_ciljne_klase} naspram ${profil.naziv_sporedne_klase}: ${ciljni.length} : ${sporedni.length} (${(ciljni.length / (sporedni.length || 1)).toFixed(2)}x).`,
  );
  lines.push("");

  lines.push(`## ${profil.naziv_ciljne_klase} — brojke o oglasima\n`);
  lines.push(`- ukupno oglasa: ${brojevi.reduce((a, b) => a + b, 0)}`);
  lines.push(`- prosjek: ${(brojevi.reduce((a, b) => a + b, 0) / (brojevi.length || 1)).toFixed(1)}`);
  lines.push(`- medijana: ${median(brojevi)}`);
  lines.push(`- min: ${Math.min(...brojevi, 0)}`);
  lines.push(`- max: ${Math.max(...brojevi, 0)}`);
  lines.push("");

  lines.push("## Raspodjela po kantonima\n");
  lines.push("| Kanton | Broj shopova | Oglasi |");
  lines.push("|---|---|---|");
  for (const [k, v] of Object.entries(poKantonu).sort((a, b) => b[1].ciljni - a[1].ciljni)) {
    lines.push(`| ${k} | ${v.ciljni} | ${v.oglasi} |`);
  }
  lines.push("");

  lines.push("## Top 20 po broju oglasa\n");
  lines.push("| Shop | Grad | Oglasi | Link |");
  lines.push("|---|---|---|---|");
  for (const r of top20) lines.push(`| ${r.username} | ${r.grad || ""} | ${r.oglasa_cilj} | ${r.link || ""} |`);
  lines.push("");

  return lines.join("\n");
}

fs.writeFileSync(MD_FILE, izgradiSazetak(zapisi));
console.log("CSV i sazetak regenerisani.");
