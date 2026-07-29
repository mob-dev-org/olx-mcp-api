// Citanje i pisanje dnevnih snapshota pregleda (.olx-pik/snapshots/views-YYYY-MM-DD.json).
//
// Jedini core modul pored audit.ts koji dira disk, i to namjerno: format snapshota i logika
// citanja moraju biti isti za CLI (koji pise) i MCP server (koji cita), pa zive na jednom
// mjestu. Racunanje nad snapshotima je u stats.ts (ciste funkcije).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ViewsSnapshot } from "./stats.js";

export const SNAPSHOT_DIR = ".olx-pik/snapshots";

// Nijedan potrosac ne gleda dalje od mjesec-dva unazad (promjena pregleda 2-7 dana, efekat
// izdvajanja do ~30), a fajlovi po danu rastu godinama. Ucitava se zato samo zadnjih 120
// dana; stariji fajlovi ostaju na disku kao arhiva i ne placaju se parsiranjem u svakom
// pozivu statistike.
const MAX_SNAPSHOTA = 120;

// Snapshoti sa diska (zadnjih MAX_SNAPSHOTA), hronoloski. Neispravni fajlovi se preskacu uz
// poruku na stderr (stdout MCP servera je JSON-RPC).
export function ucitajSnapshote(dir: string = SNAPSHOT_DIR): ViewsSnapshot[] {
  if (!existsSync(dir)) return [];
  const fajlovi = readdirSync(dir)
    .filter((f) => f.startsWith("views-") && f.endsWith(".json"))
    .sort()
    .slice(-MAX_SNAPSHOTA);
  const snapshoti: ViewsSnapshot[] = [];
  for (const f of fajlovi) {
    try {
      const parsed = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ViewsSnapshot;
      if (parsed && typeof parsed.ts === "number" && Array.isArray(parsed.oglasi)) snapshoti.push(parsed);
    } catch {
      console.error(`Snapshot ${f} nije citljiv JSON, preskacem.`);
    }
  }
  return snapshoti.sort((a, b) => a.ts - b.ts);
}

export function zadnjiSnapshot(dir: string = SNAPSHOT_DIR): ViewsSnapshot | null {
  const svi = ucitajSnapshote(dir);
  return svi[svi.length - 1] ?? null;
}

// Upisuje snapshot pod imenom izvedenim iz njegovog ts (jedan fajl po danu; ponovno pokretanje
// isti dan prepisuje fajl). Vraca putanju.
export function upisiSnapshot(snapshot: ViewsSnapshot, dir: string = SNAPSHOT_DIR): string {
  const datum = new Date(snapshot.ts * 1000).toISOString().slice(0, 10);
  const putanja = `${dir}/views-${datum}.json`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(putanja, `${JSON.stringify(snapshot)}\n`, "utf8");
  return putanja;
}
