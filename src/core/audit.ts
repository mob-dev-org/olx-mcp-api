// Audit log: trag svake radnje koja mijenja stanje na nalogu ili trosi kredite.
//
// Zasto postoji: kad se za mjesec dana pita "ko je i kada izdvojio ovaj oglas" ili "je li bot
// obnovio 200 oglasa ili 20", odgovor mora postojati u fajlu, ne u pamcenju. Log je lokalni
// JSONL (jedan zapis po liniji), van gita, po klonu.
//
// Dvije tvrde granice:
// - U log NIKAD ne ide tijelo zahtjeva ni query string. Login nosi lozinku, oglasi mogu nositi
//   licne podatke. Zapis nosi samo metodu, putanju, ishod i trajanje.
// - Greska pisanja loga NE smije oboriti radnju. Log je dokaz, ne uslov rada.

import { appendFileSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export type AuditSource = "cli" | "mcp" | "nepoznato";

export interface AuditEntry {
  // ISO vrijeme zavrsetka poziva.
  ts: string;
  // Verzija toolkita koji je napisao zapis. Odgovara na "kojim kodom je ovo radjeno", jer
  // "sta je radjeno i kada" bez toga ne pomaze kad se ponasanje promijenilo izmedju izdanja.
  // Polje je OBAVEZNO namjerno: tako kompajler ne pusta novo mjesto gradnje zapisa bez verzije.
  // Ime je englesko kao i ostala polja; rijec `verzija` je u ovom kodu zauzeta za verziju SHEME
  // podataka (plan.ts, stats.ts, konkurenti.ts), pa bi znacila dvije razlicite stvari.
  version: string;
  // Ime CLI komande ili MCP alata koji je pokrenuo poziv.
  operation: string;
  source: AuditSource;
  method: string;
  // Putanja bez query stringa.
  path: string;
  // HTTP status, ili 0 kad poziv nije stigao do servera (mreza, timeout).
  status: number;
  ok: boolean;
  duration_ms: number;
  // Koliko je HTTP pokusaja bilo (retry na 429 i 5xx gdje je dozvoljen).
  attempts: number;
  // Username naloga ako je poznat iz prethodnih poziva; nikad se ne dohvata samo zbog loga.
  account?: string;
  error?: string;
  // Koliko je kredita radnja kostala. Postoji samo na radnjama koje trose. Nije dio tijela
  // zahtjeva nego izracunat trosak, pa ne krsi pravilo o tijelu i query stringu. Bez njega se
  // dnevni plafon (OLX_MAX_SPEND_PER_DAY) ne bi mogao izracunati iz loga.
  krediti?: number;
}

export type AuditSink = (entry: AuditEntry) => void;

interface AuditContext {
  operation: string;
  source: AuditSource;
}

const storage = new AsyncLocalStorage<AuditContext>();

// Vezuje ime operacije za sve pozive unutar fn. Koristi se u MCP wrapperu oko alata.
export function withAuditContext<T>(context: AuditContext, fn: () => T): T {
  return storage.run(context, fn);
}

// Postavlja kontekst za trenutni lanac izvrsavanja (CLI, gdje je jedna komanda jedan lanac).
export function setAuditContext(context: AuditContext): void {
  storage.enterWith(context);
}

export function currentAuditContext(): AuditContext {
  return storage.getStore() ?? { operation: "nepoznato", source: "nepoznato" };
}

// Sink koji ne radi nista. Koristi se kad je log iskljucen (prazan OLX_AUDIT_FILE).
export const noopAuditSink: AuditSink = () => {};

// Sink koji dopisuje JSONL u fajl. Sinhroni append je namjeran: dvije paralelne radnje ne smiju
// isprepletati pola linije, a zapis mora biti na disku prije nego proces moze pasti.
export function fileAuditSink(path: string): AuditSink {
  let dirReady = false;
  return (entry: AuditEntry) => {
    try {
      if (!dirReady) {
        mkdirSync(dirname(path), { recursive: true });
        dirReady = true;
      }
      appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (e) {
      // Log ne smije oboriti radnju. Prijavi na stderr (stdout je rezervisan za JSON-RPC).
      console.error(`Audit log nije zapisan (${path}): ${String(e instanceof Error ? e.message : e)}`);
    }
  };
}

// Bira sink na osnovu konfiguracije: prazna putanja znaci da je log iskljucen.
export function auditSinkFromPath(path: string | undefined): AuditSink {
  if (!path || !path.trim()) return noopAuditSink;
  return fileAuditSink(path.trim());
}

/**
 * Doprinos JEDNE linije JSONL loga zbiru potrosnje zadanog dana. Vraca 0 kad linija ne ulazi u
 * racun (prazna, neispravan JSON, neuspjesna radnja, nepoznat ili neuklapajuci trosak/datum).
 *
 * Izvucena iz `potrosenoNaDan` da je dijele citanje cijelog sadrzaja u memoriji (mali fajlovi,
 * postojeci testovi) i citanje u komadima (`potrosenoNaDanUFajlovima`, veliki fajlovi).
 *
 * @param dan datum u obliku YYYY-MM-DD, poredi se sa pocetkom ISO timestampa
 */
function doprinosLinije(linija: string, dan: string): number {
  if (!linija.trim()) return 0;
  try {
    const z = JSON.parse(linija) as Partial<AuditEntry>;
    if (z.ok !== true) return 0;
    if (typeof z.krediti !== "number" || !Number.isFinite(z.krediti)) return 0;
    if (typeof z.ts !== "string" || !z.ts.startsWith(dan)) return 0;
    return z.krediti;
  } catch {
    // Pokvarena linija se preskace; plafon mora raditi i na ostecenom logu.
    return 0;
  }
}

/**
 * Zbir potrosenih kredita u zadanom danu, procitan iz JSONL loga vec ucitanog u memoriju.
 *
 * Cista funkcija nad tekstom loga, da se testira bez fajla. Broje se samo uspjesne radnje sa
 * poznatim troskom: odbijeni pokusaji nose razlog u `error` i nemaju `krediti`, pa ne ulaze.
 * Neispravna linija se preskace umjesto da obori racun, jer bi u suprotnom jedan pokvaren zapis
 * ugasio plafon i pustio neograniceno trosenje.
 *
 * @param dan datum u obliku YYYY-MM-DD, poredi se sa pocetkom ISO timestampa
 */
export function potrosenoNaDan(sadrzajLoga: string, dan: string): number {
  let ukupno = 0;
  for (const linija of sadrzajLoga.split("\n")) {
    ukupno += doprinosLinije(linija, dan);
  }
  return ukupno;
}

// ---- mjesecna rotacija ----

/**
 * Izvodi putanju mjesecnog audit fajla iz zadane osnovne putanje: `.olx-pik/audit.jsonl` za
 * avgust 2026. postaje `.olx-pik/audit-2026-08.jsonl`. Direktorij i osnova imena (bez ekstenzije)
 * se izvode iz zadane putanje, a ne pretpostavljaju kao `.olx-pik`, da override kroz
 * `OLX_AUDIT_FILE` i dalje radi.
 */
export function putanjaMjesecnogAudita(auditFile: string, datum: Date = new Date()): string {
  const dir = dirname(auditFile);
  const ext = extname(auditFile);
  const osnova = basename(auditFile, ext);
  const godina = datum.getFullYear();
  const mjesec = String(datum.getMonth() + 1).padStart(2, "0");
  return join(dir, `${osnova}-${godina}-${mjesec}${ext}`);
}

/**
 * Fajlovi koje treba procitati da se dobije tacna danasnja potrosnja: tekuci mjesecni fajl (u
 * njega se pise od rotacije) i zatecena osnovna putanja (migracioni slucaj: na zivim klonovima
 * stari fajl vec postoji i danasnji zapisi mogu biti u njemu). Redoslijed nije bitan, oba se
 * broje.
 */
export function putanjeAuditaZaCitanje(auditFile: string, datum: Date = new Date()): string[] {
  return [putanjaMjesecnogAudita(auditFile, datum), auditFile];
}

// Velicina bafera za citanje u komadima. Dovoljno veliki da rijetko treba vise od par komada za
// tipican dnevni obim zapisa, dovoljno mali da fajl od nekoliko stotina MB nikad ne uzme cijeli
// odjednom u memoriju.
const VELICINA_BAFERA = 64 * 1024;

/**
 * Cita fajl SINHRONO u komadima fiksne velicine i za svaku kompletnu liniju zove `obradiLiniju`.
 * Linije se sastavljaju preko sirovih bajtova (trazi se 0x0A), ne preko dekodiranog teksta, da
 * multibajtni UTF-8 karakter koji padne tacno na granicu komada ne bude prepolovljen.
 *
 * Fajl koji ne postoji (ENOENT) se tiho preskace: to znaci "iz ovog fajla nula", ne greska.
 * Svaka druga greska otvaranja ili citanja se PROPAGIRA, da pozivalac (dnevni plafon) i dalje
 * pada zatvoreno na ostecenom ili nedostupnom logu.
 */
function citajLinijeUKomadima(putanja: string, obradiLiniju: (linija: string) => void): void {
  let fd: number;
  try {
    fd = openSync(putanja, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw e;
  }
  try {
    const bafer = Buffer.alloc(VELICINA_BAFERA);
    let ostatak = Buffer.alloc(0);
    let procitano: number;
    while ((procitano = readSync(fd, bafer, 0, VELICINA_BAFERA, null)) > 0) {
      const komad = ostatak.length > 0 ? Buffer.concat([ostatak, bafer.subarray(0, procitano)]) : bafer.subarray(0, procitano);
      let pocetak = 0;
      let indeks: number;
      while ((indeks = komad.indexOf(0x0a, pocetak)) !== -1) {
        obradiLiniju(komad.toString("utf8", pocetak, indeks));
        pocetak = indeks + 1;
      }
      ostatak = komad.subarray(pocetak);
    }
    if (ostatak.length > 0) obradiLiniju(ostatak.toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

/**
 * Zbir potrosenih kredita u zadanom danu, citajuci zadane JSONL fajlove SINHRONO u komadima
 * (bez `readFileSync` cijelog fajla u memoriju). Koristi se za dnevni plafon, gdje log moze
 * narasti dovoljno da `readFileSync` baci `ERR_STRING_TOO_LONG`.
 *
 * Fajl koji ne postoji doprinosi 0 i nije greska (vidi `citajLinijeUKomadima`); svaka druga
 * greska se propagira.
 */
export function potrosenoNaDanUFajlovima(putanje: string[], dan: string): number {
  let ukupno = 0;
  for (const putanja of putanje) {
    citajLinijeUKomadima(putanja, (linija) => {
      ukupno += doprinosLinije(linija, dan);
    });
  }
  return ukupno;
}
