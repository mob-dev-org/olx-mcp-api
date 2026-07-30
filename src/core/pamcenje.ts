// Pamcenje o klijentu koje prezivljava restart sesije.
//
// Zasto postoji. Klijentska sesija se resetuje svaku noc i na dva sata mirovanja, i nikad se ne
// nastavlja (`--resume` se ne koristi). Uz to je `Read(./KLIJENT.md)` klijentskoj sesiji
// zabranjen, kao i Grep, Glob, Skill i Bash. Rezultat je bio da bot NIKAD nije znao ton, footer
// opisa ni navike klijenta, i da je svaka takva informacija iz razgovora nestajala u 3h.
// Jedina trajna stvar koju je bot mogao zapisati bila su izuzeca po oglasu (`izuzeca.ts`).
//
// Ovaj modul je drugi dio odgovora: preferencije na nivou SHOPA. Prvi dio je `KLIJENT-javno.md`
// koji `scripts/sastavi-prompt.mjs` ubacuje u sistemski prompt.
//
// Kljucna odluka: polja su IMENOVANA, nema slobodnih kljuceva. Slabiji model (DeepSeek vozi
// klijentsku sesiju) bi sa slobodnom shemom izmisljao kljuceve, pa bi se isto znanje upisivalo
// pod tri imena i pamcenje bi se raspalo. Slobodan tekst ima svoje mjesto: `napomene`.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Imenovana polja. Sve van ovog popisa ide u `napomene`. */
export const POLJA = ["ton", "footer_opisa", "kontakt", "radno_vrijeme", "dostava", "nacin_placanja"] as const;
export type Polje = (typeof POLJA)[number];

export interface Napomena {
  tekst: string;
  kada: string;
}

export interface Pamcenje {
  polja: Partial<Record<Polje, { vrijednost: string; kada: string }>>;
  napomene: Napomena[];
}

export const PRAZNO: Pamcenje = { polja: {}, napomene: [] };

/** Najvise napomena koje se drze. Starije se odbacuju, da prompt ne raste bez granice. */
export const MAX_NAPOMENA = 20;

export function putanjaPamcenja(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_PAMCENJE_FILE || ".olx-pik/pamcenje.json";
}

export function ucitajPamcenje(putanja = putanjaPamcenja()): Pamcenje {
  try {
    const sirovo = JSON.parse(readFileSync(putanja, "utf8")) as Partial<Pamcenje>;
    return {
      polja: sirovo?.polja && typeof sirovo.polja === "object" ? sirovo.polja : {},
      napomene: Array.isArray(sirovo?.napomene) ? sirovo.napomene : [],
    };
  } catch {
    return { polja: {}, napomene: [] }; // nema fajla ili je pokvaren: bot pocinje bez pamcenja
  }
}

export function upisiPamcenje(p: Pamcenje, putanja = putanjaPamcenja()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts i plan-fajl.ts
}

// ---- ciste funkcije ----

export function jePolje(ime: string): ime is Polje {
  return (POLJA as readonly string[]).includes(ime);
}

/** Nova mapa sa postavljenim poljem. Prazna vrijednost brise polje, ne pamti prazninu. */
export function saPoljem(p: Pamcenje, polje: Polje, vrijednost: string, kada: string): Pamcenje {
  const cist = vrijednost.trim();
  const polja = { ...p.polja };
  if (!cist) delete polja[polje];
  else polja[polje] = { vrijednost: cist, kada };
  return { ...p, polja };
}

export function bezPolja(p: Pamcenje, polje: Polje): Pamcenje {
  const polja = { ...p.polja };
  delete polja[polje];
  return { ...p, polja };
}

/**
 * Dodaje napomenu. Ista napomena se ne duplira (poredi se bez razlike u velicini slova i
 * razmacima), jer bi inace bot istu stvar zapisao svaki put kad je klijent ponovi.
 */
export function saNapomenom(p: Pamcenje, tekst: string, kada: string): Pamcenje {
  const cist = tekst.trim();
  if (!cist) return p;
  const kljuc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (p.napomene.some((n) => kljuc(n.tekst) === kljuc(cist))) return p;
  const napomene = [...p.napomene, { tekst: cist, kada }];
  return { ...p, napomene: napomene.slice(-MAX_NAPOMENA) };
}

export function bezNapomene(p: Pamcenje, tekst: string): Pamcenje {
  const kljuc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cilj = kljuc(tekst);
  return { ...p, napomene: p.napomene.filter((n) => kljuc(n.tekst) !== cilj) };
}

export function prazno(p: Pamcenje): boolean {
  return Object.keys(p.polja).length === 0 && p.napomene.length === 0;
}

/**
 * Pamcenje kao blok teksta za sistemski prompt. Zove ga `scripts/sastavi-prompt.mjs` pri svakom
 * startu sesije, pa bot zna sve bez ijednog poziva alata. Prazno pamcenje ne dodaje nista, da se
 * prompt ne puni praznim naslovima.
 */
export function pamcenjeUProm(p: Pamcenje): string {
  if (prazno(p)) return "";
  const r: string[] = ["## Sto vec znas o ovom klijentu", ""];
  r.push("Zapisano iz proslih razgovora. Koristi to, ne pitaj ponovo i ne citaj kao listu.");
  r.push("");
  const imena: Record<Polje, string> = {
    ton: "Ton kojim mu se obracas",
    footer_opisa: "Standardni zavrsni blok opisa oglasa",
    kontakt: "Kontakt osoba",
    radno_vrijeme: "Radno vrijeme",
    dostava: "Dostava",
    nacin_placanja: "Placanje",
  };
  for (const polje of POLJA) {
    const v = p.polja[polje];
    if (v) r.push(`- ${imena[polje]}: ${v.vrijednost}`);
  }
  if (p.napomene.length > 0) {
    r.push("", "Ostalo sto je rekao:");
    for (const n of p.napomene) r.push(`- ${n.tekst}`);
  }
  return `${r.join("\n")}\n`;
}
