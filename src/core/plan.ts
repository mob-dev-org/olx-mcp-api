// Planer izdvajanja: raspored trosenja kredita kroz dane, sa pamcenjem sta je izvrseno.
//
// Zasto lokalno: API ne prima "izvrsi ovo u ponedjeljak". Zakazivanje postoji samo kroz web
// (potvrdjeno u korpusu pomoci), pa raspored mora voditi ovaj toolkit i sam pokrenuti izdvajanje
// kad termin dodje na red.
//
// Ovdje su samo ciste funkcije, bez mreze i bez fajlova, da se raspored moze testirati bez
// ijednog poziva prema API-ju. Citanje i pisanje plana radi CLI.

import type { SponsorOptions } from "./types.js";

export type TerminStatus =
  // ceka svoj datum
  | "planiran"
  // upisano prije poziva; ako ostane ovako, poziv je prekinut usred izvrsenja i trazi rucnu provjeru
  | "u_toku"
  | "izvrsen"
  | "neuspio"
  // cijena je na dan izvrsenja bila visa od planirane, pa nije naplaceno
  | "cijena_promijenjena"
  | "preskocen";

export interface PlanTermin {
  // Stabilan kljuc: isti oglas isti datum je isti termin i kad se plan ponovo procita.
  id: string;
  listing_id: number;
  naslov: string;
  // YYYY-MM-DD
  za_datum: string;
  opcije: SponsorOptions;
  // Cijena u kreditima u trenutku planiranja (provjerava se ponovo prije naplate).
  cijena: number;
  status: TerminStatus;
  izvrseno_u?: string;
  napomena?: string;
}

export interface SponsorPlan {
  verzija: 1;
  napravljen: string;
  nalog?: string;
  budzet: number;
  dana_raspored: number;
  termini: PlanTermin[];
}

export interface PlanKandidat {
  id: number;
  naslov: string;
  // Cijena izdvajanja za zadane opcije; kandidat bez cijene se preskace.
  cijena?: number;
  // Oglas koji je vec izdvojen: novi poziv bi zakazao jos jedno izdvajanje, ne zamijenio trenutno.
  vec_izdvojen?: boolean;
}

export interface BuildPlanInput {
  kandidati: PlanKandidat[];
  budzet: number;
  danaRaspored: number;
  opcije: SponsorOptions;
  // Datum od kojeg raspored pocinje, YYYY-MM-DD. Zadaje pozivalac, da je rezultat predvidiv.
  pocetniDatum: string;
  napravljen: string;
  nalog?: string;
}

// Dodaje dane na datum u obliku YYYY-MM-DD i vraca isti oblik. Racuna u UTC, da promjena
// vremenske zone ne pomjeri termin za jedan dan.
export function dodajDane(datum: string, dana: number): string {
  const [g, m, d] = datum.split("-").map(Number);
  const base = Date.UTC(g ?? 1970, (m ?? 1) - 1, d ?? 1);
  const pomjeren = new Date(base + dana * 24 * 60 * 60 * 1000);
  return pomjeren.toISOString().slice(0, 10);
}

// Sklapa plan: ide kroz kandidate redom (pozivalac ih je vec poredao po prioritetu), preskace
// one bez cijene i one koji ne stanu u ostatak budzeta, i rasporedjuje ih ravnomjerno po danima.
// Budzet je tvrda granica: zbir planiranih cijena ga nikad ne prelazi.
export function buildPlan(input: BuildPlanInput): SponsorPlan {
  const dana = Math.max(1, Math.floor(input.danaRaspored));
  const termini: PlanTermin[] = [];
  let potroseno = 0;

  for (const kandidat of input.kandidati) {
    const cijena = kandidat.cijena;
    if (typeof cijena !== "number" || !Number.isFinite(cijena) || cijena <= 0) continue;
    if (kandidat.vec_izdvojen) continue;
    if (potroseno + cijena > input.budzet) continue;

    const za_datum = dodajDane(input.pocetniDatum, termini.length % dana);
    termini.push({
      id: `${kandidat.id}-${za_datum}`,
      listing_id: kandidat.id,
      naslov: kandidat.naslov,
      za_datum,
      opcije: input.opcije,
      cijena,
      status: "planiran",
    });
    potroseno += cijena;
  }

  return {
    verzija: 1,
    napravljen: input.napravljen,
    ...(input.nalog ? { nalog: input.nalog } : {}),
    budzet: input.budzet,
    dana_raspored: dana,
    termini,
  };
}

// Termini koji su dospjeli do zadanog datuma i jos nisu izvrseni.
export function dospjeliTermini(plan: SponsorPlan, danas: string): PlanTermin[] {
  return plan.termini.filter((t) => t.status === "planiran" && t.za_datum <= danas);
}

// Termini zaglavljeni u stanju "u_toku": proces je prekinut izmedju poziva i upisa ishoda.
// Njih NE izvrsavamo ponovo automatski, jer je naplata mogla proci.
export function zaglavljeniTermini(plan: SponsorPlan): PlanTermin[] {
  return plan.termini.filter((t) => t.status === "u_toku");
}

// Vraca NOVI plan sa izmijenjenim terminom. Idempotentno po statusu: termin koji je vec izvrsen
// se ne vraca u planirano stanje.
export function oznaciTermin(
  plan: SponsorPlan,
  id: string,
  patch: { status: TerminStatus; izvrseno_u?: string; napomena?: string },
): SponsorPlan {
  return {
    ...plan,
    termini: plan.termini.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
}

export interface PlanSazetak {
  termina: number;
  planirano: number;
  izvrseno: number;
  neuspjelo: number;
  preskoceno: number;
  budzet: number;
  planirani_trosak: number;
  potroseno: number;
  ostalo_budzeta: number;
  po_danima: { datum: string; termina: number; trosak: number }[];
}

export function planSazetak(plan: SponsorPlan): PlanSazetak {
  const po_danima = new Map<string, { termina: number; trosak: number }>();
  let planirani_trosak = 0;
  let potroseno = 0;
  let planirano = 0;
  let izvrseno = 0;
  let neuspjelo = 0;
  let preskoceno = 0;

  for (const t of plan.termini) {
    planirani_trosak += t.cijena;
    if (t.status === "planiran" || t.status === "u_toku") planirano++;
    if (t.status === "izvrsen") {
      izvrseno++;
      potroseno += t.cijena;
    }
    if (t.status === "neuspio") neuspjelo++;
    if (t.status === "preskocen" || t.status === "cijena_promijenjena") preskoceno++;

    const dan = po_danima.get(t.za_datum) ?? { termina: 0, trosak: 0 };
    dan.termina++;
    dan.trosak += t.cijena;
    po_danima.set(t.za_datum, dan);
  }

  return {
    termina: plan.termini.length,
    planirano,
    izvrseno,
    neuspjelo,
    preskoceno,
    budzet: plan.budzet,
    planirani_trosak,
    potroseno,
    ostalo_budzeta: plan.budzet - potroseno,
    po_danima: [...po_danima.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([datum, v]) => ({ datum, ...v })),
  };
}
