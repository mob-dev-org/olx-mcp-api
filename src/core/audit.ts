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

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export type AuditSource = "cli" | "mcp" | "nepoznato";

export interface AuditEntry {
  // ISO vrijeme zavrsetka poziva.
  ts: string;
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
 * Zbir potrosenih kredita u zadanom danu, procitan iz JSONL loga.
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
    if (!linija.trim()) continue;
    try {
      const z = JSON.parse(linija) as Partial<AuditEntry>;
      if (z.ok !== true) continue;
      if (typeof z.krediti !== "number" || !Number.isFinite(z.krediti)) continue;
      if (typeof z.ts !== "string" || !z.ts.startsWith(dan)) continue;
      ukupno += z.krediti;
    } catch {
      // Pokvarena linija se preskace; plafon mora raditi i na ostecenom logu.
    }
  }
  return ukupno;
}
