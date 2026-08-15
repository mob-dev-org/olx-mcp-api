// Citanje i pisanje dnevnih snapshota pregleda (.olx-pik/snapshots/views-YYYY-MM-DD.json).
//
// Jedini core modul pored audit.ts koji dira disk, i to namjerno: format snapshota i logika
// citanja moraju biti isti za CLI (koji pise) i MCP server (koji cita), pa zive na jednom
// mjestu. Racunanje nad snapshotima je u stats.ts (ciste funkcije).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
/**
 * Ima li na disku snapshota STARIJIH od zadanog prozora. Cita samo imena fajlova, ne otvara
 * nijedan.
 *
 * Sluzi razlikovanju dva stanja koja izgledaju isto pozivaocu koji dobije premalo tacaka:
 * "klon je nov, serija tek pocinje" (nema starijih) i "posao je stao, serija je prekinuta"
 * (ima starijih). Prvo je normalno, drugo je kvar pogona koji niko drugi ne primjecuje
 * automatski: `provjeri-klon.mjs` jeste kapija na 48h, ali je rucna, a nadzor flote gleda
 * samo zauzece diska po mapama.
 */
export function imaSnapshotaStarijihOd(dana: number, dir: string = SNAPSHOT_DIR): boolean {
  if (!existsSync(dir)) return false;
  const granica = datumGranice(dana);
  return imenaSnapshota(dir).some((f) => datumIzImena(f) < granica);
}

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

export interface ProredjivanjeRezultat {
  obrisano: number;
  zadrzano: number;
}

// Prorjeduje stare dnevne snapshote (views-YYYY-MM-DD.json), da .olx-pik/snapshots i backup
// stanja (src/core/backup-spisak.ts) ne rastu bez kraja.
//
// Pravilo (deterministicko, ne zavisi od redoslijeda citanja direktorija): snapshoti noviji od
// `pragDana` se cuvaju SVI. Iznad tog praga se cuva samo PRVI (najstariji) snapshot u svakom
// bloku od `gustinaDana` dana; blok se racuna od "dana 0" (1970-01-01 UTC) kao
// floor(danaOdEpohe / gustinaDana), pa je pripadnost bloku cista funkcija datuma iz imena
// fajla, a ne toga u kom redu ih citajuci direktorij vrati. Zadrzava se najstariji u bloku (ne
// nasumican) jer je fajlovi() lista vec sortirana rastuce prije grupisanja, pa prvi susret sa
// blokom u toj petlji uvijek jeste najstariji clan bloka.
//
// Datum se cita ISKLJUCIVO iz imena fajla (datumIzImena), nikad iz mtime ni sadrzaja: nijedan
// fajl se ne otvara da bi se odlucilo o brisanju. `imenaSnapshota` hvata TACNO obrazac
// "views-YYYY-MM-DD.json", pa radni fajl ".snapshot-u-toku.json" (pocinje tackom) i bilo koje
// drugo ime nikad nisu kandidat za brisanje.
//
// Obrazac preslikava ocistiStareResurse (scripts/lib/resursi.mjs, oko linije 525): try/catch oko
// CIJELOG poziva i oko SVAKOG pojedinacnog brisanja (jedan fajl koji se ne da obrisati ne
// prekida ciscenje ostalih), nepostojeci direktorij vraca nule bez greske, funkcija NIKAD ne
// baca. Samo brise fajlove: ne pise nista na disk i ne zove mrezu.
//
// `pragDana` i `gustinaDana` su konfigurabilni kroz okruzenje (OLX_SNAPSHOT_PROREDJIVANJE_PRAG_DANA,
// OLX_SNAPSHOT_PROREDJIVANJE_GUSTINA_DANA, procitani preko loadConfig u config.ts); ova funkcija
// ostaje cista prema env-u (isti obrazac kao ostale core cisto-racunske funkcije: mrtviOglasi,
// intervalUzPrag) i prima vec izvucene brojeve, sa defaultima koji se poklapaju sa loadConfig().
export function proredjiStareSnapshote(
  dir: string = SNAPSHOT_DIR,
  opcije: { pragDana?: number; gustinaDana?: number } = {},
): ProredjivanjeRezultat {
  const pragDana = opcije.pragDana ?? 90;
  const gustinaDana = opcije.gustinaDana ?? 7;
  let obrisano = 0;
  let zadrzano = 0;
  try {
    if (!existsSync(dir)) return { obrisano: 0, zadrzano: 0 };
    const granica = datumGranice(pragDana);
    const fajlovi = imenaSnapshota(dir); // rastuce sortirano (leksikografski = hronoloski)
    const zadrzaniBlokovi = new Set<number>();

    for (const f of fajlovi) {
      const datum = datumIzImena(f);
      if (datum >= granica) {
        zadrzano += 1;
        continue;
      }
      const danaOdEpohe = Math.floor(Date.parse(`${datum}T00:00:00Z`) / 86_400_000);
      const blok = Math.floor(danaOdEpohe / gustinaDana);
      if (!zadrzaniBlokovi.has(blok)) {
        zadrzaniBlokovi.add(blok); // prvi susret sa blokom je najstariji clan (niz je sortiran)
        zadrzano += 1;
        continue;
      }
      try {
        unlinkSync(`${dir}/${f}`);
        obrisano += 1;
      } catch {
        // jedan fajl koji se ne da obrisati ne smije prekinuti ciscenje ostalih
      }
    }
    return { obrisano, zadrzano };
  } catch {
    return { obrisano, zadrzano };
  }
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
