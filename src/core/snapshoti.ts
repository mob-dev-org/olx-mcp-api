// Citanje i pisanje dnevnih snapshota pregleda (.olx-pik/snapshots/views-YYYY-MM-DD.json).
//
// Jedini core modul pored audit.ts koji dira disk, i to namjerno: format snapshota i logika
// citanja moraju biti isti za CLI (koji pise) i MCP server (koji cita), pa zive na jednom
// mjestu. Racunanje nad snapshotima je u stats.ts (ciste funkcije).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ViewsSnapshot } from "./stats.js";

export const SNAPSHOT_DIR = ".olx-pik/snapshots";

// Nijedan potrosac ne gleda dalje od mjesec-dva unazad (promjena pregleda 2-7 dana, efekat
// izdvajanja do ~30), a fajlovi po danu rastu godinama. Ucitava se zato samo zadnjih 120
// dana; stariji fajlovi ostaju na disku kao arhiva i ne placaju se parsiranjem u svakom
// pozivu statistike. Pozivalac koji zna da mu treba kraci period (npr. 2 ili 7 dana) moze
// zadati `dana` i platiti parsiranje samo za taj prozor.
const MAX_SNAPSHOTA = 120;

// Datum je jedini dio fajla citljiv bez otvaranja: ime je "views-YYYY-MM-DD.json", pa se
// datum izvlaci rezanjem imena, ne citanjem sadrzaja niti mtime-om diska.
function datumIzImena(fajl: string): string {
  return fajl.slice(6, 16);
}

// ISO YYYY-MM-DD se leksikografski sortira i poredi isto kao hronoloski, pa ne treba
// Date parsiranje za poredjenje granice prozora.
function datumGranice(dana: number): string {
  return new Date(Date.now() - dana * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Imena snapshot-fajlova sa diska, sortirana rastuce (leksikografski = hronoloski).
function imenaSnapshota(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("views-") && f.endsWith(".json"))
    .sort();
}

function ucitajFajl(dir: string, f: string): ViewsSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ViewsSnapshot;
    if (parsed && typeof parsed.ts === "number" && Array.isArray(parsed.oglasi)) return parsed;
    return null;
  } catch {
    console.error(`Snapshot ${f} nije citljiv JSON, preskacem.`);
    return null;
  }
}

// Snapshoti sa diska, hronoloski. Bez `dana`: zadnjih MAX_SNAPSHOTA fajlova (danasnje
// ponasanje, nepromijenjeno). Sa `dana`: samo fajlovi ciji je datum iz imena unutar tog broja
// dana unazad od danas, ukljucujuci i fajl tacno na granici (datum danas - dana ulazi u prozor).
// Neispravni fajlovi se preskacu uz poruku na stderr (stdout MCP servera je JSON-RPC).
export function ucitajSnapshote(dir: string = SNAPSHOT_DIR, dana?: number): ViewsSnapshot[] {
  if (!existsSync(dir)) return [];
  let fajlovi = imenaSnapshota(dir);
  if (dana === undefined) {
    fajlovi = fajlovi.slice(-MAX_SNAPSHOTA);
  } else {
    const granica = datumGranice(dana);
    fajlovi = fajlovi.filter((f) => datumIzImena(f) >= granica);
  }
  const snapshoti: ViewsSnapshot[] = [];
  for (const f of fajlovi) {
    const parsed = ucitajFajl(dir, f);
    if (parsed) snapshoti.push(parsed);
  }
  return snapshoti.sort((a, b) => a.ts - b.ts);
}

// Samo zadnji snapshot, bez parsiranja cijele serije: imena su leksikografski sortirana isto
// kao hronoloski, pa se ide od najnovijeg imena unazad i cita/parsira SAMO onoliko fajlova
// koliko treba da se nadje prvi ispravan. Stariji ispravni fajlovi se ne diraju.
export function zadnjiSnapshot(dir: string = SNAPSHOT_DIR): ViewsSnapshot | null {
  if (!existsSync(dir)) return null;
  const fajlovi = imenaSnapshota(dir).reverse();
  for (const f of fajlovi) {
    const parsed = ucitajFajl(dir, f);
    if (parsed) return parsed;
  }
  return null;
}

// Upisuje snapshot pod imenom izvedenim iz njegovog ts (jedan fajl po danu; ponovno pokretanje
// isti dan prepisuje fajl). Vraca putanju.
export function upisiSnapshot(snapshot: ViewsSnapshot, dir: string = SNAPSHOT_DIR): string {
  const datum = new Date(snapshot.ts * 1000).toISOString().slice(0, 10);
  const putanja = `${dir}/views-${datum}.json`;
  mkdirSync(dir, { recursive: true });
  // tmp + rename, isti obrazac kao plan-fajl.ts i pamcenje.ts: backup stanja kopira ovaj folder
  // dok pogon radi, pa polovicno upisan snapshot ne smije biti vidljiv ni jednu sekundu.
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot)}\n`, "utf8");
  renameSync(tmp, putanja);
  return putanja;
}
