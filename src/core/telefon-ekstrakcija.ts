// Izvlaci broj telefona iz slobodnog teksta (opis shopa, opis oglasa). OLX API ne vraca telefon
// kao strukturirano polje ni za jedan tudji nalog (API-INVENTAR.md: "privatni podaci (email,
// telefon, krediti) se NE vracaju za tudje naloge"), pa je slobodan tekst jedini izvor: prodavac
// ga sam upise da bi ga kupac uopste mogao kontaktirati (API nema citanje ni slanje poruka).
//
// Dva prolaza:
//   1. regexTelefon    besplatan i trenutan, hvata ciste BiH formate (+387/0038/0, mobilni 6x)
//   2. Haiku (izvuciTelefon) tek kad regex ne nadje nista nedvosmisleno: slobodan tekst ima
//      previse zapisa (razmaci, tacke, crtice, broj usred recenice, vise brojeva od kojih je
//      jedan cijena ili sifra artikla) da bi cist regex bio pouzdan u svakom slucaju.
//
// Konfiguracija iz .env klona (vidi .env.example):
//   OLX_TELEFON_API_KEY  kljuc za Haiku poziv; kad izostane pada na OLX_VID_API_KEY (isti
//                        Anthropic nalog vec placa vid.ts pozive, nema razloga za drugi kljuc)
//   OLX_TELEFON_MODEL    default claude-haiku-4-5
//
// Svaki Haiku poziv ide u .olx-pik/ai-usage.jsonl kroz zapisiAiPoziv (izvor "telefon").

import Anthropic from "@anthropic-ai/sdk";
import { zapisiAiPoziv } from "./ai-dnevnik.js";

const PODRAZUMIJEVANI_MODEL = "claude-haiku-4-5";

// Rijeci koje odaju da je pogodjen broj zapravo cijena, sifra ili slicno, ne kontakt telefon.
// Provjerava se posljednjih ~20 znakova prije pogotka.
const DECOY_RIJECI = [
  "sifra",
  "šifra",
  "kod",
  "sku",
  "cijena",
  "cena",
  "kolicin",
  "količin",
  "iban",
  "racun",
  "račun",
  "id ",
  "broj oglasa",
  "postanski",
  "poštanski",
  "godina",
];

const TELEFON_KANDIDAT =
  /(?<!\d)(?:(?:\+|00)?387[\s./-]?)?0?6\d(?:[\s./-]?\d){6}(?!\d)/g;

/** Cisti niz digita, sto omogucava poredjenje kandidata bez obzira na razdvajac. */
function samoDigiti(s: string): string {
  return s.replace(/\D/g, "");
}

/** Normalizuje digite (bez separatora) u kanonski oblik "+387 6X XXX XXX", ili null ako oblik ne odgovara BiH mobilnom broju. */
function normalizuj(digiti: string): string | null {
  let jezgro: string;
  if (digiti.startsWith("00387")) jezgro = digiti.slice(5);
  else if (digiti.startsWith("387") && digiti.length === 11) jezgro = digiti.slice(3);
  else if (digiti.startsWith("0") && digiti.length === 9) jezgro = digiti.slice(1);
  else if (digiti.length === 8) jezgro = digiti;
  else return null;
  if (jezgro.length !== 8 || jezgro[0] !== "6") return null;
  return `+387 ${jezgro.slice(0, 2)} ${jezgro.slice(2, 5)} ${jezgro.slice(5, 8)}`;
}

/**
 * Brz besplatan prolaz kroz tekst: BiH mobilni broj u uobicajenim zapisima (+387, 00387, vodeca
 * nula, sa ili bez razmaka/tacaka/crtica). Vraca null i kad nema pogotka, i kad ima vise
 * medjusobno razlicitih kandidata bez jasnog favorita (odluka ide na Haiku, ne na nagadjanje), i
 * kad su svi pogodjeni kandidati odbaceni kao ocigledna sifra/cijena/id.
 */
export function regexTelefon(tekst: string): string | null {
  if (!tekst) return null;
  const nadjeni = new Set<string>();
  for (const m of tekst.matchAll(TELEFON_KANDIDAT)) {
    const prije = tekst.slice(Math.max(0, m.index! - 20), m.index!).toLowerCase();
    if (DECOY_RIJECI.some((r) => prije.includes(r))) continue;
    const kanon = normalizuj(samoDigiti(m[0]));
    if (kanon) nadjeni.add(kanon);
  }
  if (nadjeni.size !== 1) return null;
  const [jedini] = nadjeni;
  return jedini ?? null;
}

export function telefonKljuc(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.OLX_TELEFON_API_KEY || env.OLX_VID_API_KEY;
}

export function telefonModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_TELEFON_MODEL || PODRAZUMIJEVANI_MODEL;
}

export function telefonKonfigurisan(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(telefonKljuc(env));
}

export interface RezultatEkstrakcije {
  telefon: string | null;
  izvor: "regex" | "haiku" | null;
}

function izvuciJson(tekst: string): { telefon: string | null } | null {
  const ociscen = tekst.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(ociscen) as { telefon: string | null };
  } catch {
    const m = ociscen.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as { telefon: string | null };
    } catch {
      return null;
    }
  }
}

/**
 * Vraca broj telefona iz slobodnog teksta, prvo regexom, pa Haiku modelom kad regex ne nadje
 * nista sigurno. Kad Haiku kljuc nije konfigurisan (OLX_TELEFON_API_KEY / OLX_VID_API_KEY), ne
 * baca gresku nego se tiho oslanja samo na regex: ovo se zove za desetine kandidata u nizu i
 * nedostatak kljuca ne smije oboriti citav prolaz, samo mu smanjiti domet.
 */
export async function izvuciTelefon(tekst: string): Promise<RezultatEkstrakcije> {
  const regex = regexTelefon(tekst);
  if (regex) return { telefon: regex, izvor: "regex" };
  if (!tekst || !tekst.trim() || !telefonKonfigurisan()) return { telefon: null, izvor: null };

  const model = telefonModel();
  const klijent = new Anthropic({ apiKey: telefonKljuc() });
  const upit =
    "Ispod je slobodan tekst opisa OLX/PIK oglasa ili shopa u Bosni i Hercegovini. Pronadji broj " +
    "telefona za kontakt ako postoji, ne izmisljaj ga. Ako ima vise brojeva u tekstu, izaberi onaj " +
    "koji najvise lici na kontakt telefon (BiH mobilni format), ne cijenu, sifru artikla ni godinu. " +
    'Odgovori ISKLJUCIVO JSON objektom bez ikakvog drugog teksta: {"telefon": "+387 61 234 567"} ' +
    'ili {"telefon": null} kad broja nema.\n\n' +
    `Tekst:\n${tekst}`;

  const pocetak = Date.now();
  try {
    const odgovor = await klijent.messages.create({
      model,
      max_tokens: 100,
      messages: [{ role: "user", content: upit }],
    });
    const sirovi = odgovor.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsirano = izvuciJson(sirovi);
    zapisiAiPoziv({
      izvor: "telefon",
      zadatak: "izvuci_telefon",
      model: odgovor.model,
      ulazTokena: odgovor.usage.input_tokens,
      izlazTokena: odgovor.usage.output_tokens,
      trajanjeMs: Date.now() - pocetak,
      ok: true,
    });
    const telefon = typeof parsirano?.telefon === "string" ? parsirano.telefon.trim() : null;
    return { telefon: telefon || null, izvor: telefon ? "haiku" : null };
  } catch (e) {
    zapisiAiPoziv({
      izvor: "telefon",
      zadatak: "izvuci_telefon",
      model,
      trajanjeMs: Date.now() - pocetak,
      ok: false,
      greska: String(e instanceof Error ? e.message : e),
    });
    return { telefon: null, izvor: null };
  }
}
