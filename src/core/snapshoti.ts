// Citanje i pisanje dnevnih snapshota pregleda (.olx-pik/snapshots/views-YYYY-MM-DD.json).
//
// Jedini core modul pored audit.ts koji dira disk, i to namjerno: format snapshota i logika
// citanja moraju biti isti za CLI (koji pise) i MCP server (koji cita), pa zive na jednom
// mjestu. Racunanje nad snapshotima je u stats.ts (ciste funkcije).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ViewsSnapshot, ViewsSnapshotOglas } from "./stats.js";

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

// ===== radni fajl "stats snapshot" prolaza u toku =====
//
// `stats snapshot` (src/cli/index.ts) radi jedan `getListing` po oglasu i na velikom katalogu
// ne stigne obici sve u jednom pokretanju (OLX_BUDZET_SNAPSHOT_MS). Djelimican snapshot se NIKAD
// ne smije upisati kao snapshot (brana na `!aktivni.potpuno` bi sutra lazno prijavila zive oglase
// kao mrtve), pa nedovrsen prolaz ostavlja trag ovdje i nastavlja se sljedecim pokretanjem.
//
// Ime fajla namjerno POCINJE TACKOM, da ga obrazac za dnevne snapshote (views-YYYY-MM-DD.json)
// nikad ne pokupi kao snapshot.
//
// Spisak `idevi` se puni SAMO na pocetku prolaza (jednim citanjem kataloga) i dalje pokretanja ga
// ne osvjezavaju: snapshot time ostaje koherentan snimak jednog trenutka odluke. Posljedica je da
// oglas objavljen usred prolaza nije u OVOM snapshotu, nego u sljedecem.

export interface SnapshotUToku {
  /** Unix sekunde, pocetak OVOG PROLAZA (ne pocetak ovog pokretanja). Nosi ga i prvo pokretanje. */
  pocetak: number;
  /** Nalog kome prolaz pripada; radni fajl sa drugim nalogom se odbacuje (jedan klon, jedan nalog). */
  account: string;
  /** Spisak ID-eva aktivnih oglasa procitan na POCETKU prolaza, zamrznut do njegovog kraja. */
  idevi: number[];
  /** Oglasi vec obidjeni u prethodnim pokretanjima ovog prolaza. */
  oglasi: ViewsSnapshotOglas[];
  /** Akumulirano kroz sva pokretanja ovog prolaza. */
  broj_poziva: number;
  /** Akumulirano kroz sva pokretanja ovog prolaza (ms). */
  trajanje_ms: number;
}

// OLX_SNAPSHOT_U_TOKU_FILE je override putanje, isti obrazac kao ostale OLX_*_FILE varijable u
// core modulima koji dodiruju disk (izuzeca.ts, plan-fajl.ts, ...). Podrazumijevana putanja lezi
// pored dnevnih snapshota, van gita.
export function putanjaSnapshotaUToku(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_SNAPSHOT_U_TOKU_FILE || `${SNAPSHOT_DIR}/.snapshot-u-toku.json`;
}

// Nepostojeci ili neispravan fajl vraca null umjesto da baci: pozivalac (CLI) to tumaci kao "nema
// prolaza u toku" i krece iznova, isto ponasanje kao ucitajFajl() za dnevne snapshote.
export function ucitajSnapshotUToku(putanja: string = putanjaSnapshotaUToku()): SnapshotUToku | null {
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(sadrzaj) as Partial<SnapshotUToku>;
    if (
      parsed &&
      typeof parsed.pocetak === "number" &&
      typeof parsed.account === "string" &&
      Array.isArray(parsed.idevi) &&
      Array.isArray(parsed.oglasi) &&
      typeof parsed.broj_poziva === "number" &&
      typeof parsed.trajanje_ms === "number"
    ) {
      return parsed as SnapshotUToku;
    }
    console.error(`Radni fajl snapshota (${putanja}) nije ocekivanog oblika, odbacujem.`);
    return null;
  } catch {
    console.error(`Radni fajl snapshota (${putanja}) nije citljiv JSON, odbacujem.`);
    return null;
  }
}

// tmp + rename, isti obrazac kao upisiSnapshot: polovicno upisan radni fajl ne smije biti
// vidljiv ni jednu sekundu (backup stanja kopira ovaj folder dok pogon radi).
export function upisiSnapshotUToku(podaci: SnapshotUToku, putanja: string = putanjaSnapshotaUToku()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(podaci)}\n`, "utf8");
  renameSync(tmp, putanja);
}

// Uspjesan zavrsetak prolaza (snapshot upisan) i odbacivanje pokvarenog/zastarjelog/tudjeg
// radnog fajla oboje prolaze kroz ovu funkciju. Nepostojeci fajl je uspjeh, ne greska.
export function obrisiSnapshotUToku(putanja: string = putanjaSnapshotaUToku()): void {
  try {
    rmSync(putanja, { force: true });
  } catch {
    // Ne bitno na cemu je puklo (npr. prava pristupa): fajl je sporedan trag napretka, ne
    // izvor istine kao snapshot sam; sljedece pokretanje ga jednostavno pravi iznova.
  }
}
