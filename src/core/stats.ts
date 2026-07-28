// Agregacija i filtriranje podataka za statistiku, analizu i alarme.
//
// Ovdje su samo ciste funkcije: bez mreze, bez fajlova, bez citanja sata. "Sada" se uvijek
// prima kao unix timestamp u sekundama, pa je rezultat deterministican i testira se bez
// mockova. Dohvat radi OlxClient, pisanje snapshota radi CLI.
//
// Smisao sloja: API vraca velike payloade (puni user blok, kategorija, atributi...), a modelu
// treba izracunata metrika. Ove funkcije sazmu podatke PRIJE nego sto stignu do AI-a.

import type {
  CategoryAttribute,
  Listing,
  ListingSummary,
  OlxPublicProfile,
  OlxUser,
  RefreshLimits,
} from "./types.js";

const SEKUNDI_U_DANU = 86_400;

// ===== pomocne =====

export function median(brojevi: number[]): number | null {
  if (brojevi.length === 0) return null;
  const s = [...brojevi].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 1 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
  return m === undefined ? null : m;
}

function danaOd(ts: number | undefined | null, sadaTs: number): number | null {
  if (typeof ts !== "number" || ts <= 0) return null;
  return Math.max(0, Math.round(((sadaTs - ts) / SEKUNDI_U_DANU) * 10) / 10);
}

function zaokruzi(n: number, decimala = 1): number {
  const f = 10 ** decimala;
  return Math.round(n * f) / f;
}

function broj(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Oglas je "na upit" kad nema upotrebljivu cijenu.
function naUpit(o: { price?: number; price_by_agreement?: unknown }): boolean {
  return Boolean(o.price_by_agreement) || !o.price || o.price <= 0;
}

function cijeneStatistika(items: ListingSummary[]): {
  min: number | null;
  median: number | null;
  max: number | null;
  prosjek: number | null;
  na_upit: number;
} {
  const cijene = items.filter((o) => !naUpit(o)).map((o) => o.price as number);
  const naUpitBroj = items.length - cijene.length;
  if (cijene.length === 0) return { min: null, median: null, max: null, prosjek: null, na_upit: naUpitBroj };
  return {
    min: Math.min(...cijene),
    median: median(cijene),
    max: Math.max(...cijene),
    prosjek: zaokruzi(cijene.reduce((a, b) => a + b, 0) / cijene.length, 2),
    na_upit: naUpitBroj,
  };
}

function sponzorisanoStatistika(items: ListingSummary[]): { broj: number; premium: number; procenat: number } {
  const sponzorisani = items.filter((o) => (o.sponsored ?? 0) > 0);
  const premium = items.filter((o) => o.sponsored === 2).length;
  return {
    broj: sponzorisani.length,
    premium,
    procenat: items.length === 0 ? 0 : zaokruzi((sponzorisani.length / items.length) * 100),
  };
}

// ===== statistika vlastitog profila =====

export interface OglasPregledi {
  id: number;
  title?: string;
  views: number;
  questions?: number;
  created_at?: number;
}

export interface ProfilStatistikaInput {
  me: OlxUser;
  refreshLimits: RefreshLimits;
  aktivni: ListingSummary[];
  ukupno: { istekli: number; skriveni: number; neaktivni: number; zavrseni: number };
  pregledi?: OglasPregledi[];
  sadaTs: number;
  // Oglas se racuna kao "neobnovljen" kad od zadnje obnove (date) prodje vise od praga dana.
  pragNeobnovljenoDana?: number;
}

export interface ProfilStatistika {
  nalog: {
    username: string | null;
    paket: string | null;
    paket_istice_za_dana: number | null;
    krediti: number | null;
    neodgovorena_pitanja: number | null;
    ocjene: { pozitivne: number; negativne: number } | null;
  };
  kvota_obnova: { free_limit: number; free_count: number; preostalo: number; iskoristeno_procenat: number };
  oglasi: { aktivni: number; istekli: number; skriveni: number; neaktivni: number; zavrseni: number };
  cijene: { min: number | null; median: number | null; max: number | null; prosjek: number | null; na_upit: number };
  sponzorisano: { broj: number; premium: number; procenat: number };
  neobnovljeni: { id: number; title: string; dana_od_obnove: number }[];
  pregledi: {
    obuhvaceno: number;
    top: { id: number; title?: string; views: number; pregleda_dnevno: number | null }[];
    dno: { id: number; title?: string; views: number; pregleda_dnevno: number | null }[];
  } | null;
}

export function profilStatistika(input: ProfilStatistikaInput): ProfilStatistika {
  const { me, refreshLimits, aktivni, ukupno, sadaTs } = input;
  const prag = input.pragNeobnovljenoDana ?? 7;

  const shop = (me.shop ?? null) as { package?: string; ends_at?: number } | null;
  const freeLimit = refreshLimits.free_limit ?? 0;
  const freeCount = refreshLimits.free_count ?? 0;

  const neobnovljeni = aktivni
    .map((o) => ({ id: o.id, title: o.title, dana: danaOd(o.date, sadaTs) }))
    .filter((o): o is { id: number; title: string; dana: number } => o.dana !== null && o.dana > prag)
    .sort((a, b) => b.dana - a.dana)
    .slice(0, 10)
    .map((o) => ({ id: o.id, title: o.title, dana_od_obnove: o.dana }));

  let pregledi: ProfilStatistika["pregledi"] = null;
  if (input.pregledi && input.pregledi.length > 0) {
    const saDnevnim = input.pregledi.map((p) => {
      const starost = danaOd(p.created_at, sadaTs);
      return {
        id: p.id,
        title: p.title,
        views: p.views,
        pregleda_dnevno: starost !== null && starost >= 1 ? zaokruzi(p.views / starost) : null,
      };
    });
    const sortirano = [...saDnevnim].sort((a, b) => (b.pregleda_dnevno ?? 0) - (a.pregleda_dnevno ?? 0));
    pregledi = { obuhvaceno: saDnevnim.length, top: sortirano.slice(0, 5), dno: sortirano.slice(-5).reverse() };
  }

  return {
    nalog: {
      username: typeof me.username === "string" ? me.username : null,
      paket: shop?.package ?? null,
      paket_istice_za_dana: shop?.ends_at ? zaokruzi((shop.ends_at - sadaTs) / SEKUNDI_U_DANU, 0) : null,
      krediti: broj(me.credits),
      neodgovorena_pitanja: broj(me.new_questions_count),
      ocjene:
        me.feedbacks && typeof me.feedbacks === "object"
          ? {
              pozitivne: broj((me.feedbacks as Record<string, unknown>).positive) ?? 0,
              negativne: broj((me.feedbacks as Record<string, unknown>).negative) ?? 0,
            }
          : null,
    },
    kvota_obnova: {
      free_limit: freeLimit,
      free_count: freeCount,
      preostalo: Math.max(0, freeLimit - freeCount),
      iskoristeno_procenat: freeLimit === 0 ? 0 : zaokruzi((freeCount / freeLimit) * 100),
    },
    oglasi: {
      aktivni: aktivni.length,
      istekli: ukupno.istekli,
      skriveni: ukupno.skriveni,
      neaktivni: ukupno.neaktivni,
      zavrseni: ukupno.zavrseni,
    },
    cijene: cijeneStatistika(aktivni),
    sponzorisano: sponzorisanoStatistika(aktivni),
    neobnovljeni,
    pregledi,
  };
}

// ===== onboarding izvjestaj =====
//
// Prva stvar koju klijent vidi. Cilj je da iz podataka koje nalog vec ima izvuce ono sto je
// mjerljivo propusteno, bez ijedne izmisljene brojke. Namjerno NEMA procjene zarade u KM:
// brojive cinjenice (neiskoristene besplatne obnove, oglasi bez slike, oglasi bez pregleda)
// ne mogu biti osporene, a procjena zarade moze.
//
// Radi i bez detalja o oglasima. Bez njih daje nalog, kvotu, svjezinu i naslove; sa njima
// dodaje higijenu i ucinak. Detalji dolaze iz dnevnog snapshota, pa ne kostaju nijedan poziv.

export interface OnboardingDetalj {
  id: number;
  title?: string;
  views: number;
  questions?: number;
  created_at?: number;
  date?: number;
  slika_broj?: number;
  ima_podnaslov?: boolean;
  opis_znakova?: number;
  atributa?: number;
}

export interface OnboardingInput {
  me: OlxUser;
  refreshLimits: RefreshLimits;
  aktivni: ListingSummary[];
  ukupno: { istekli: number; skriveni: number; neaktivni: number; zavrseni: number };
  // Iz olx_listing_limits; oblik nije dokumentovan pa se cita tolerantno.
  listingLimits?: unknown;
  detalji?: OnboardingDetalj[];
  sadaTs: number;
  // Datum snapshota iz kojeg su detalji, da izvjestaj kaze koliko su podaci stari.
  detaljiTs?: number;
}

export interface OnboardingNalaz {
  // Kljuc za masinsku obradu, poruka za covjeka.
  kljuc: string;
  poruka: string;
  broj: number;
  // Do 10 primjera, da se odmah zna gdje pogledati.
  primjeri?: { id: number; title: string }[];
}

export interface OnboardingIzvjestaj {
  nalog: {
    username: string | null;
    paket: string | null;
    paket_istice_za_dana: number | null;
    krediti: number | null;
    neodgovorena_pitanja: number | null;
    aktivnih_oglasa: number;
    limit_oglasa: number | null;
    popunjenost_procenat: number | null;
  };
  besplatne_obnove: {
    kvota: number;
    iskorisceno: number;
    preostalo: number;
    dana_do_kraja_mjeseca: number;
    // Koliko obnova dnevno treba trositi da se kvota potrosi do kraja mjeseca.
    preporuceno_dnevno: number;
    propusteno_procenat: number;
  };
  higijena: OnboardingNalaz[];
  // false kad detalja nema ili su iz snapshota verzije 1 koji jos ne nosi polja za higijenu.
  // Tada odsustvo nalaza ne znaci da su oglasi u redu, nego da nisu provjereni.
  higijena_provjerena: boolean;
  svjezina: { neobnovljeno_7: number; neobnovljeno_14: number; neobnovljeno_30: number; najstariji: OnboardingNalaz["primjeri"] };
  ucinak: {
    obuhvaceno: number;
    podaci_stari_dana: number | null;
    top: { id: number; title?: string; views: number; pregleda_dnevno: number | null }[];
    bez_pregleda_30_dana: OnboardingNalaz;
    gledani_bez_upita: OnboardingNalaz;
  } | null;
  izdvajanje: { broj: number; premium: number; procenat: number };
  prvi_potezi: { redoslijed: number; potez: string; kosta: "besplatno" | "krediti" | "samo vrijeme" }[];
}

function primjeri(lista: { id: number; title?: string }[]): { id: number; title: string }[] {
  return lista.slice(0, 10).map((o) => ({ id: o.id, title: o.title ?? String(o.id) }));
}

function nalaz(kljuc: string, poruka: string, lista: { id: number; title?: string }[]): OnboardingNalaz {
  return { kljuc, poruka, broj: lista.length, primjeri: primjeri(lista) };
}

// Broj dana do kraja mjeseca u kojem je `sadaTs`, ukljucujuci danasnji. Radi u UTC, isto kao
// ostatak modula, jer se kvota obnova ionako mjeri po kalendarskom mjesecu a ne po satu.
function danaDoKrajaMjeseca(sadaTs: number): number {
  const d = new Date(sadaTs * 1000);
  const uMjesecu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.max(1, uMjesecu - d.getUTCDate() + 1);
}

export function onboardingIzvjestaj(input: OnboardingInput): OnboardingIzvjestaj {
  const { me, refreshLimits, aktivni, sadaTs } = input;
  const shop = (me.shop ?? null) as { package?: string; ends_at?: number } | null;

  const kvota = refreshLimits.free_limit ?? 0;
  const iskorisceno = refreshLimits.free_count ?? 0;
  const preostalo = Math.max(0, kvota - iskorisceno);
  const danaDoKraja = danaDoKrajaMjeseca(sadaTs);

  // Limit oglasa po paketu: oblik odgovora nije dokumentovan, pa se trazi prvo brojcano polje
  // sa poznatim imenom umjesto da se pretpostavi struktura.
  const ll = (input.listingLimits ?? null) as Record<string, unknown> | null;
  const limitOglasa =
    broj(ll?.limit) ?? broj(ll?.max) ?? broj(ll?.listing_limit) ?? broj(ll?.total) ?? broj(ll?.available) ?? null;

  // ---- higijena ----
  const higijena: OnboardingNalaz[] = [];
  const kratkiNaslovi = aktivni.filter((o) => (o.title ?? "").trim().length < 30);
  if (kratkiNaslovi.length > 0) {
    higijena.push(
      nalaz("naslov_kratak", "Naslov kraci od 30 znakova, premalo kljucnih rijeci za pretragu", kratkiNaslovi),
    );
  }
  const bezCijene = aktivni.filter((o) => broj(o.price) === null || broj(o.price) === 0);
  if (bezCijene.length > 0) {
    higijena.push(nalaz("bez_cijene", "Bez cijene ili na upit, kupci preskacu takve oglase", bezCijene));
  }

  const detalji = input.detalji ?? [];
  // Snapshoti verzije 1 nemaju polja za higijenu. Nedostatak polja NIJE isto sto i nula: kad se
  // tretira kao nula, izvjestaj tvrdi da su svi oglasi bez slike i bez opisa. Zato se svaka
  // provjera radi samo nad oglasima kod kojih to polje stvarno postoji, a provjera se preskace
  // ako ga nema nijedan.
  function provjeri<K extends keyof OnboardingDetalj>(
    polje: K,
    kljuc: string,
    poruka: string,
    pogadja: (v: NonNullable<OnboardingDetalj[K]>) => boolean,
  ): void {
    const sPoljem = detalji.filter((o) => o[polje] !== undefined && o[polje] !== null);
    if (sPoljem.length === 0) return;
    const pogodjeni = sPoljem.filter((o) => pogadja(o[polje] as NonNullable<OnboardingDetalj[K]>));
    if (pogodjeni.length > 0) higijena.push(nalaz(kljuc, poruka, pogodjeni));
  }

  if (detalji.length > 0) {
    provjeri("slika_broj", "bez_slike", "Nijedna slika", (n) => n === 0);
    provjeri("slika_broj", "malo_slika", "Manje od 3 slike", (n) => n > 0 && n < 3);
    provjeri("ima_podnaslov", "bez_podnaslova", "Prazan podnaslov, a podnaslov ulazi u pretragu", (v) => v === false);
    provjeri("opis_znakova", "opis_kratak", "Opis kraci od 100 znakova", (n) => n < 100);
    provjeri("atributa", "bez_atributa", "Nijedan popunjen atribut, oglas ispada iz filtera", (n) => n === 0);
  }
  higijena.sort((a, b) => b.broj - a.broj);

  // Ako detalji postoje ali su iz starog snapshota, higijena je nepotpuna i to se mora reci.
  const higijenaDostupna = detalji.some((o) => o.slika_broj !== undefined);

  // ---- svjezina ----
  const saDanima = aktivni
    .map((o) => ({ id: o.id, title: o.title, dana: danaOd(o.date, sadaTs) }))
    .filter((o): o is { id: number; title: string; dana: number } => o.dana !== null);
  const neobnovljeno = (prag: number) => saDanima.filter((o) => o.dana > prag).length;

  // ---- ucinak ----
  let ucinak: OnboardingIzvjestaj["ucinak"] = null;
  if (detalji.length > 0) {
    const saDnevnim = detalji.map((p) => {
      const starost = danaOd(p.created_at, sadaTs);
      return {
        id: p.id,
        title: p.title,
        views: p.views,
        questions: p.questions ?? 0,
        starost,
        pregleda_dnevno: starost !== null && starost >= 1 ? zaokruzi(p.views / starost) : null,
      };
    });
    const bezPregleda = saDnevnim.filter((o) => o.views === 0 && (o.starost ?? 0) >= 30);
    // Gledan a nijedan upit: pregledi ima, pitanja nema. Sumnja pada na cijenu ili opis, ne na
    // vidljivost, jer je oglas ocito pronadjen.
    const gledaniBezUpita = saDnevnim.filter((o) => o.views >= 100 && o.questions === 0);
    ucinak = {
      obuhvaceno: detalji.length,
      podaci_stari_dana: input.detaljiTs ? danaOd(input.detaljiTs, sadaTs) : null,
      top: [...saDnevnim]
        .sort((a, b) => (b.pregleda_dnevno ?? 0) - (a.pregleda_dnevno ?? 0))
        .slice(0, 10)
        .map((o) => ({ id: o.id, title: o.title, views: o.views, pregleda_dnevno: o.pregleda_dnevno })),
      bez_pregleda_30_dana: nalaz("bez_pregleda", "Nijedan pregled, a stariji od 30 dana", bezPregleda),
      gledani_bez_upita: nalaz("gledan_bez_upita", "Preko 100 pregleda a nijedan upit, provjeri cijenu i opis", gledaniBezUpita),
    };
  }

  // ---- prvi potezi ----
  // Poredani po odnosu ucinka i troska: prvo ono sto ne kosta nista, pa rad, pa kredit.
  const potezi: OnboardingIzvjestaj["prvi_potezi"] = [];
  if (preostalo > 0) {
    potezi.push({
      redoslijed: potezi.length + 1,
      potez: `Potrositi preostalih ${preostalo} besplatnih obnova do kraja mjeseca, oko ${Math.ceil(preostalo / danaDoKraja)} dnevno`,
      kosta: "besplatno",
    });
  }
  const najveci = higijena[0];
  if (najveci) {
    potezi.push({
      redoslijed: potezi.length + 1,
      potez: `Popraviti ${najveci.broj} oglasa: ${najveci.poruka.toLowerCase()}`,
      kosta: "samo vrijeme",
    });
  }
  if (ucinak && ucinak.bez_pregleda_30_dana.broj > 0) {
    potezi.push({
      redoslijed: potezi.length + 1,
      potez: `Preispitati ${ucinak.bez_pregleda_30_dana.broj} oglasa bez ijednog pregleda: naslov, kategorija ili cijena`,
      kosta: "samo vrijeme",
    });
  }
  if (ucinak && ucinak.gledani_bez_upita.broj > 0) {
    potezi.push({
      redoslijed: potezi.length + 1,
      potez: `Provjeriti cijenu na ${ucinak.gledani_bez_upita.broj} oglasa koji se gledaju a ne donose upite`,
      kosta: "samo vrijeme",
    });
  }
  const sponzorisano = sponzorisanoStatistika(aktivni);
  if (sponzorisano.broj === 0 && (broj(me.credits) ?? 0) > 0) {
    potezi.push({
      redoslijed: potezi.length + 1,
      potez: "Izdvojiti nekoliko najtrazenijih artikala i izmjeriti efekat prije nego se potrosi vise",
      kosta: "krediti",
    });
  }

  return {
    nalog: {
      username: typeof me.username === "string" ? me.username : null,
      paket: shop?.package ?? null,
      paket_istice_za_dana: shop?.ends_at ? zaokruzi((shop.ends_at - sadaTs) / SEKUNDI_U_DANU, 0) : null,
      krediti: broj(me.credits),
      neodgovorena_pitanja: broj(me.new_questions_count),
      aktivnih_oglasa: aktivni.length,
      limit_oglasa: limitOglasa,
      popunjenost_procenat: limitOglasa && limitOglasa > 0 ? zaokruzi((aktivni.length / limitOglasa) * 100) : null,
    },
    besplatne_obnove: {
      kvota,
      iskorisceno,
      preostalo,
      dana_do_kraja_mjeseca: danaDoKraja,
      preporuceno_dnevno: preostalo === 0 ? 0 : Math.ceil(preostalo / danaDoKraja),
      propusteno_procenat: kvota === 0 ? 0 : zaokruzi((preostalo / kvota) * 100),
    },
    higijena,
    higijena_provjerena: higijenaDostupna,
    svjezina: {
      neobnovljeno_7: neobnovljeno(7),
      neobnovljeno_14: neobnovljeno(14),
      neobnovljeno_30: neobnovljeno(30),
      najstariji: primjeri([...saDanima].sort((a, b) => b.dana - a.dana)),
    },
    ucinak,
    izdvajanje: sponzorisano,
    prvi_potezi: potezi,
  };
}

// ===== grupna promjena cijene =====

export type PraviloCijene =
  | { vrsta: "postotak"; iznos: number }
  | { vrsta: "fiksno"; iznos: number }
  | { vrsta: "postavi"; iznos: number };

export interface StavkaCijene {
  id: number;
  title: string;
  stara: number;
  nova: number;
  razlika: number;
}

export interface PregledCijena {
  pravilo: PraviloCijene;
  stavke: StavkaCijene[];
  preskoceno: { id: number; title: string; razlog: string }[];
  ukupno_stavki: number;
  prosjecna_promjena_procenat: number | null;
}

// Ispod ove cijene oglas prakticno postaje "na upit" i ispada iz cjenovnih filtera.
const MIN_CIJENA = 1;

/**
 * Racuna nove cijene po pravilu i vraca pregled STARA naspram NOVA, prije bilo kakvog upisa.
 *
 * Cista funkcija: pozivalac dobavlja oglase i odlucuje hoce li primijeniti. Postoji da grupna
 * izmjena nikad ne krene naslijepo, jer je promjena cijene na 100 oglasa nesto sto se rucno ne
 * vraca.
 *
 * Preskace oglase bez upotrebljive cijene i one gdje bi rezultat bio ispod minimuma, umjesto da
 * ih tiho postavi na nulu.
 */
export function izracunajNoveCijene(
  oglasi: { id: number; title: string; price?: number }[],
  pravilo: PraviloCijene,
): PregledCijena {
  const stavke: StavkaCijene[] = [];
  const preskoceno: { id: number; title: string; razlog: string }[] = [];

  for (const o of oglasi) {
    const stara = broj(o.price);
    if (stara === null || stara <= 0) {
      preskoceno.push({ id: o.id, title: o.title, razlog: "nema upotrebljivu cijenu" });
      continue;
    }
    let nova: number;
    if (pravilo.vrsta === "postotak") nova = stara * (1 + pravilo.iznos / 100);
    else if (pravilo.vrsta === "fiksno") nova = stara + pravilo.iznos;
    else nova = pravilo.iznos;

    nova = zaokruzi(nova);
    if (nova < MIN_CIJENA) {
      preskoceno.push({ id: o.id, title: o.title, razlog: `nova cijena ${nova} je ispod minimuma ${MIN_CIJENA}` });
      continue;
    }
    if (nova === stara) {
      preskoceno.push({ id: o.id, title: o.title, razlog: "cijena se ne bi promijenila" });
      continue;
    }
    stavke.push({ id: o.id, title: o.title, stara, nova, razlika: zaokruzi(nova - stara) });
  }

  const prosjek =
    stavke.length === 0 ? null : zaokruzi(stavke.reduce((a, s) => a + (s.razlika / s.stara) * 100, 0) / stavke.length);

  return { pravilo, stavke, preskoceno, ukupno_stavki: stavke.length, prosjecna_promjena_procenat: prosjek };
}

// ===== mrtvi oglasi po prirastu pregleda =====

export interface MrtviOglas {
  id: number;
  title?: string;
  ukupno_pregleda: number;
  prirast: number;
  dana: number;
}

/**
 * Oglasi bez ijednog NOVOG pregleda u zadanom periodu.
 *
 * Razlika naspram `onboardingIzvjestaj.ucinak.bez_pregleda_30_dana`, koja je namjerna: ona gleda
 * kumulativni `views === 0` i zato promasi oglas koji je imao 500 pregleda prije godinu dana a
 * nista u zadnja dva mjeseca. Takav oglas je mrtav jednako kao onaj bez ijednog pregleda, samo
 * to statistika ne kaze. Ovdje se gleda prirast izmedju dva snapshota.
 *
 * Vraca null kad nema dvije upotrebljive tacke, umjesto da proglasi cijeli katalog mrtvim.
 */
export function mrtviOglasi(
  snapshoti: ViewsSnapshot[],
  sadaTs: number,
  danaUnazad = 60,
): { period_dana: number; od_ts: number; do_ts: number; oglasi: MrtviOglas[] } | null {
  const promjena = promjenaPregleda(snapshoti, sadaTs, danaUnazad);
  if (!promjena) return null;

  const zadnji = [...snapshoti].sort((a, b) => a.ts - b.ts).at(-1);
  if (!zadnji) return null;
  const poId = new Map(zadnji.oglasi.map((o) => [o.id, o]));

  const oglasi: MrtviOglas[] = promjena.miruju
    .map((m) => {
      const o = poId.get(m.id);
      return {
        id: m.id,
        title: m.title,
        ukupno_pregleda: o?.views ?? 0,
        prirast: 0,
        dana: promjena.dana,
      };
    })
    .sort((a, b) => b.ukupno_pregleda - a.ukupno_pregleda);

  return { period_dana: promjena.dana, od_ts: promjena.od_ts, do_ts: promjena.do_ts, oglasi };
}

// ===== provjera nacrta oglasa prije slanja =====

export interface NacrtOglasa {
  title?: string;
  short_description?: string;
  description?: string;
  price?: number;
  city_id?: number | string;
  attributes?: { id: number; value: string }[];
}

export interface NacrtNalaz {
  polje: string;
  problem: string;
  // Greska zaustavlja objavu jer bi API vratio 422. Upozorenje je stvar kvalitete oglasa.
  vrsta: "greska" | "upozorenje";
  // Dozvoljene vrijednosti kad ih atribut ima, da se pitanje klijentu postavi kao izbor.
  dozvoljeno?: string[];
}

export interface ProvjeraNacrta {
  spreman: boolean;
  greske: NacrtNalaz[];
  upozorenja: NacrtNalaz[];
  // Atributi koje jos treba popuniti, spremni da se pretvore u pitanja klijentu.
  nedostaju_obavezni: { id: number; naziv: string; dozvoljeno?: string[] }[];
}

export const MAKS_NASLOV = 65;

/**
 * Provjerava nacrt oglasa PRIJE slanja na API.
 *
 * Zasto postoji: `olx_create_listing` ne validira obavezne atribute kategorije, pa API vrati 422
 * tek nakon slanja. U vodjenoj objavi to znaci da oglas pukne nakon sto je klijent vec potvrdio
 * naslov, opis i cijenu, sto je najgori mogucni trenutak za gresku.
 *
 * Cista funkcija: atribute kategorije dohvata pozivalac.
 */
export function provjeriNacrt(nacrt: NacrtOglasa, atributiKategorije: CategoryAttribute[]): ProvjeraNacrta {
  const greske: NacrtNalaz[] = [];
  const upozorenja: NacrtNalaz[] = [];

  const naslov = (nacrt.title ?? "").trim();
  if (naslov.length === 0) {
    greske.push({ polje: "title", problem: "Naslov je obavezan.", vrsta: "greska" });
  } else if (naslov.length > MAKS_NASLOV) {
    greske.push({
      polje: "title",
      problem: `Naslov ima ${naslov.length} znakova, a najvise je ${MAKS_NASLOV}. API vraca 422 preko toga.`,
      vrsta: "greska",
    });
  } else if (naslov.length < 30) {
    upozorenja.push({
      polje: "title",
      problem: `Naslov ima samo ${naslov.length} znakova. Kraci naslovi nose manje kljucnih rijeci za pretragu.`,
      vrsta: "upozorenje",
    });
  }

  if (!(nacrt.short_description ?? "").trim()) {
    upozorenja.push({
      polje: "short_description",
      problem: "Podnaslov je prazan, a ulazi u pretragu.",
      vrsta: "upozorenje",
    });
  }
  if ((nacrt.description ?? "").trim().length < 100) {
    upozorenja.push({ polje: "description", problem: "Opis je kraci od 100 znakova.", vrsta: "upozorenje" });
  }
  if (nacrt.price === undefined || nacrt.price === null || nacrt.price === 0) {
    upozorenja.push({ polje: "price", problem: "Bez cijene, oglas ide kao 'na upit'.", vrsta: "upozorenje" });
  }

  // Vrijednosti atributa se poredе kao tekst, jer ih API tako i prima.
  const dati = new Map((nacrt.attributes ?? []).map((a) => [a.id, String(a.value ?? "").trim()]));
  const nedostaju: ProvjeraNacrta["nedostaju_obavezni"] = [];

  for (const a of atributiKategorije) {
    const vrijednost = dati.get(a.id);
    const naziv = a.display_name ?? a.name;
    const opcije = Array.isArray(a.options) && a.options.length > 0 ? a.options : undefined;

    if (a.required === true && !vrijednost) {
      greske.push({
        polje: `attribute:${a.id}`,
        problem: `Obavezan atribut "${naziv}" nije popunjen. Bez njega API vraca 422.`,
        vrsta: "greska",
        ...(opcije ? { dozvoljeno: opcije } : {}),
      });
      nedostaju.push({ id: a.id, naziv, ...(opcije ? { dozvoljeno: opcije } : {}) });
      continue;
    }
    // Vrijednost van popisa opcija API odbija isto kao da je nema.
    if (vrijednost && opcije && !opcije.includes(vrijednost)) {
      greske.push({
        polje: `attribute:${a.id}`,
        problem: `Vrijednost "${vrijednost}" nije dozvoljena za "${naziv}".`,
        vrsta: "greska",
        dozvoljeno: opcije,
      });
    }
  }

  // Atribut koji kategorija uopste ne poznaje API odbacuje, pa se prijavljuje kao greska.
  const poznati = new Set(atributiKategorije.map((a) => a.id));
  for (const [id] of dati) {
    if (!poznati.has(id)) {
      greske.push({ polje: `attribute:${id}`, problem: `Atribut ${id} ne postoji u ovoj kategoriji.`, vrsta: "greska" });
    }
  }

  return { spreman: greske.length === 0, greske, upozorenja, nedostaju_obavezni: nedostaju };
}

// ===== promjena kod konkurenta =====

export interface PromjenaKonkurenta {
  username: string;
  od_ts: number;
  do_ts: number;
  dana: number;
  oglasi: { prije: number; sada: number; razlika: number };
  novi: { id: number; title: string; price?: number }[];
  nestali: { id: number; title: string }[];
  // Oglasi koji su promijenili cijenu, sa starom i novom.
  cijene: { id: number; title: string; stara: number; nova: number }[];
  sponzorisano: { prije: number; sada: number; razlika: number };
  median_cijena: { prije: number | null; sada: number | null };
  // Kratke recenice o tome sta se promijenilo, spremne za izvjestaj.
  nalazi: string[];
}

/**
 * Razlika dva snimka istog konkurenta.
 *
 * Postoji jer `konkurentIzvjestaj` daje samo trenutno stanje. Iz jednog snimka se ne vidi da li
 * je konkurent dodao 14 oglasa ili spustio cijene, a upravo to je informacija koja mijenja
 * odluku. Zato se cuva i lista ID-jeva, ne samo agregat.
 */
export function promjenaKonkurenta(
  username: string,
  prije: { ts: number; izvjestaj: KonkurentIzvjestaj; oglasi: { id: number; title: string; price?: number; sponsored?: number }[] },
  sada: { ts: number; izvjestaj: KonkurentIzvjestaj; oglasi: { id: number; title: string; price?: number; sponsored?: number }[] },
): PromjenaKonkurenta {
  const prijePoId = new Map(prije.oglasi.map((o) => [o.id, o]));
  const sadaPoId = new Map(sada.oglasi.map((o) => [o.id, o]));

  const novi = sada.oglasi.filter((o) => !prijePoId.has(o.id)).map((o) => ({ id: o.id, title: o.title, price: o.price }));
  const nestali = prije.oglasi.filter((o) => !sadaPoId.has(o.id)).map((o) => ({ id: o.id, title: o.title }));

  const cijene: PromjenaKonkurenta["cijene"] = [];
  for (const o of sada.oglasi) {
    const staro = prijePoId.get(o.id);
    const s = broj(staro?.price);
    const n = broj(o.price);
    if (s !== null && n !== null && s !== n) cijene.push({ id: o.id, title: o.title, stara: s, nova: n });
  }

  const sponzPrije = prije.izvjestaj.sponzorisano.broj;
  const sponzSada = sada.izvjestaj.sponzorisano.broj;
  const dana = zaokruzi((sada.ts - prije.ts) / SEKUNDI_U_DANU);

  const nalazi: string[] = [];
  if (novi.length > 0) nalazi.push(`Dodao ${novi.length} novih oglasa.`);
  if (nestali.length > 0) nalazi.push(`Skinuo ${nestali.length} oglasa.`);
  const snizenja = cijene.filter((c) => c.nova < c.stara).length;
  const poskupljenja = cijene.length - snizenja;
  if (snizenja > 0) nalazi.push(`Snizio cijenu na ${snizenja} oglasa.`);
  if (poskupljenja > 0) nalazi.push(`Podigao cijenu na ${poskupljenja} oglasa.`);
  if (sponzSada > sponzPrije) nalazi.push(`Izdvojio ${sponzSada - sponzPrije} oglasa vise nego prije.`);
  else if (sponzSada < sponzPrije) nalazi.push(`Prestao izdvajati ${sponzPrije - sponzSada} oglasa.`);
  if (nalazi.length === 0) nalazi.push("Nista se nije bitno promijenilo.");

  return {
    username,
    od_ts: prije.ts,
    do_ts: sada.ts,
    dana,
    oglasi: { prije: prije.oglasi.length, sada: sada.oglasi.length, razlika: sada.oglasi.length - prije.oglasi.length },
    novi: novi.slice(0, 10),
    nestali: nestali.slice(0, 10),
    cijene: cijene.slice(0, 10),
    sponzorisano: { prije: sponzPrije, sada: sponzSada, razlika: sponzSada - sponzPrije },
    median_cijena: { prije: prije.izvjestaj.cijene.median, sada: sada.izvjestaj.cijene.median },
    nalazi,
  };
}

// ===== dnevni i sedmicni posao =====

export interface DnevniPlanObnova {
  kvota: number;
  preostalo: number;
  dana_do_kraja_mjeseca: number;
  // Koliko bi trebalo obnoviti danas da se kvota ravnomjerno potrosi do kraja mjeseca.
  cilj_danas: number;
  // Koliko oglasa je uopste dostupno za obnovu (refresh_available).
  kandidata: number;
  // Stvarni broj za danas: manji od cilja i broja kandidata.
  za_obnovu: number;
}

/**
 * Koliko obnova potrositi danas.
 *
 * Ravnomjerno trosenje, ne sve odjednom: obnova vraca oglas na vrh po svjezini, pa 500 obnova u
 * jednom danu i nula narednih daje losiju prosjecnu poziciju nego 100 dnevno kroz pet dana.
 */
export function dnevniPlanObnova(
  refreshLimits: RefreshLimits,
  kandidata: number,
  sadaTs: number,
): DnevniPlanObnova {
  const kvota = refreshLimits.free_limit ?? 0;
  const preostalo = Math.max(0, kvota - (refreshLimits.free_count ?? 0));
  const dana = danaDoKrajaMjeseca(sadaTs);
  const cilj = preostalo === 0 ? 0 : Math.ceil(preostalo / dana);
  return {
    kvota,
    preostalo,
    dana_do_kraja_mjeseca: dana,
    cilj_danas: cilj,
    kandidata,
    za_obnovu: Math.min(cilj, kandidata),
  };
}

export interface PromjenaPregleda {
  od_ts: number;
  do_ts: number;
  dana: number;
  obuhvaceno: number;
  ukupan_prirast: number;
  rastu: { id: number; title?: string; prirast: number }[];
  miruju: { id: number; title?: string }[];
}

/**
 * Razlika pregleda izmedju dva snapshota. Ovo je jedina prava mjera ucinka koju platforma
 * dopusta, jer je `views` kumulativan i sam po sebi ne kaze da li oglas jos radi.
 *
 * Uzima najnoviji snapshot i najstariji koji nije stariji od `danaUnazad`. Vraca null kad nema
 * dvije upotrebljive tacke, umjesto da izmislja prirast iz jedne.
 */
export function promjenaPregleda(
  snapshoti: ViewsSnapshot[],
  sadaTs: number,
  danaUnazad = 7,
): PromjenaPregleda | null {
  const sortirani = [...snapshoti].sort((a, b) => a.ts - b.ts);
  const zadnji = sortirani[sortirani.length - 1];
  if (!zadnji) return null;
  const granica = sadaTs - danaUnazad * SEKUNDI_U_DANU;
  const raniji = sortirani.find((s) => s.ts >= granica && s.ts < zadnji.ts) ?? sortirani[0];
  if (!raniji || raniji.ts >= zadnji.ts) return null;

  const prije = new Map(raniji.oglasi.map((o) => [o.id, o.views]));
  const promjene: { id: number; title?: string; prirast: number }[] = [];
  for (const o of zadnji.oglasi) {
    const staro = prije.get(o.id);
    // Oglas kojeg nema u ranijem snapshotu je nov; prirast bi bio lazno velik.
    if (staro === undefined) continue;
    promjene.push({ id: o.id, title: o.title, prirast: o.views - staro });
  }
  promjene.sort((a, b) => b.prirast - a.prirast);

  return {
    od_ts: raniji.ts,
    do_ts: zadnji.ts,
    dana: zaokruzi((zadnji.ts - raniji.ts) / SEKUNDI_U_DANU),
    obuhvaceno: promjene.length,
    ukupan_prirast: promjene.reduce((a, p) => a + p.prirast, 0),
    rastu: promjene.filter((p) => p.prirast > 0).slice(0, 10),
    miruju: promjene.filter((p) => p.prirast <= 0).map((p) => ({ id: p.id, title: p.title })),
  };
}

// ===== izvjestaj o konkurentu =====

export interface KonkurentIzvjestaj {
  profil: {
    username: string | null;
    tip: string | null;
    paket: string | null;
    godina_na_platformi: number | null;
    zadnja_aktivnost_prije_dana: number | null;
    ocjene: { pozitivne: number; negativne: number };
    prosjecno_vrijeme_odgovora_min: number | null;
  };
  oglasi: { aktivni: number; zavrseni: number | null };
  cijene: { min: number | null; median: number | null; max: number | null; prosjek: number | null; na_upit: number };
  sponzorisano: { broj: number; premium: number; procenat: number };
  akcije: { broj: number; procenat: number };
  obnove: { median_dana_od_obnove: number | null; obnovljeno_u_48h: number; procenat_48h: number };
}

export function konkurentIzvjestaj(
  profil: OlxPublicProfile,
  aktivni: ListingSummary[],
  zavrsenoUkupno: number | null,
  sadaTs: number,
): KonkurentIzvjestaj {
  const daniOdObnove = aktivni
    .map((o) => danaOd(o.date, sadaTs))
    .filter((d): d is number => d !== null);
  const u48h = daniOdObnove.filter((d) => d <= 2).length;
  const akcije = aktivni.filter((o) => Boolean(o.has_discount)).length;

  return {
    profil: {
      username: profil.username ?? null,
      tip: typeof profil.type === "string" ? profil.type : null,
      paket: profil.shop?.package ?? null,
      godina_na_platformi: profil.created_at ? zaokruzi((sadaTs - profil.created_at) / (SEKUNDI_U_DANU * 365)) : null,
      zadnja_aktivnost_prije_dana: danaOd(broj(profil.last_time_active_at), sadaTs),
      ocjene: { pozitivne: profil.feedbacks?.positive ?? 0, negativne: profil.feedbacks?.negative ?? 0 },
      prosjecno_vrijeme_odgovora_min: profil.avg_response_time ?? null,
    },
    oglasi: { aktivni: aktivni.length, zavrseni: zavrsenoUkupno },
    cijene: cijeneStatistika(aktivni),
    sponzorisano: sponzorisanoStatistika(aktivni),
    akcije: { broj: akcije, procenat: aktivni.length === 0 ? 0 : zaokruzi((akcije / aktivni.length) * 100) },
    obnove: {
      median_dana_od_obnove: median(daniOdObnove),
      obnovljeno_u_48h: u48h,
      procenat_48h: aktivni.length === 0 ? 0 : zaokruzi((u48h / aktivni.length) * 100),
    },
  };
}

// ===== izvjestaj o jednom oglasu (nasem ili tudjem) =====

export interface OglasIzvjestaj {
  id: number;
  naslov: string;
  duzina_naslova: number;
  ima_podnaslov: boolean;
  opis_znakova: number;
  cijena: number | null;
  na_upit: boolean;
  akcija: { regularna_cijena: number | null } | null;
  pregledi: { ukupno: number | null; dnevno: number | null };
  pitanja: number | null;
  starost_dana: number | null;
  dana_od_obnove: number | null;
  slika_broj: number;
  popunjenih_atributa: number;
  sponzorisan: boolean;
  sponzor_detalji: {
    placeno_kredita: number | null;
    istice_za_dana: number | null;
    kombinacija: { type?: number; days?: number; refresh_every?: number } | null;
  } | null;
  zakazano_izdvajanje: boolean;
  status: string | null;
  dostupan: boolean | null;
  sku: string | null;
}

export function oglasIzvjestaj(listing: Listing, sadaTs: number): OglasIzvjestaj {
  const views = broj(listing.views);
  const createdAt = broj(listing.created_at);
  const starost = danaOd(createdAt, sadaTs);
  const slike = Array.isArray(listing.images) ? listing.images.length : 0;
  const atributi = Array.isArray(listing.attributes)
    ? (listing.attributes as { value?: unknown }[]).filter((a) => a.value !== null && a.value !== undefined && a.value !== "").length
    : 0;
  const sponsorActive = (listing.sponsor_active ?? null) as {
    price?: number;
    sponsored_until?: number;
    criterias?: { type?: number; days?: number; refresh_every?: number };
  } | null;
  const opis = listing.additional?.description ?? "";

  return {
    id: listing.id,
    naslov: listing.title,
    duzina_naslova: listing.title.length,
    ima_podnaslov: Boolean(listing.short_description && String(listing.short_description).trim().length > 0),
    opis_znakova: opis.length,
    cijena: broj(listing.price),
    na_upit: naUpit(listing),
    akcija: listing.has_discount ? { regularna_cijena: broj(listing.regular_price) } : null,
    pregledi: {
      ukupno: views,
      dnevno: views !== null && starost !== null && starost >= 1 ? zaokruzi(views / starost) : null,
    },
    pitanja: broj(listing.questions),
    starost_dana: starost,
    dana_od_obnove: danaOd(broj(listing.date), sadaTs),
    slika_broj: slike,
    popunjenih_atributa: atributi,
    sponzorisan: Boolean(sponsorActive) || (broj(listing.sponsored) ?? 0) > 0,
    sponzor_detalji: sponsorActive
      ? {
          placeno_kredita: broj(sponsorActive.price),
          istice_za_dana: sponsorActive.sponsored_until ? zaokruzi((sponsorActive.sponsored_until - sadaTs) / SEKUNDI_U_DANU) : null,
          kombinacija: sponsorActive.criterias ?? null,
        }
      : null,
    zakazano_izdvajanje: Boolean(listing.sponsor_scheduled),
    status: listing.status ?? null,
    dostupan: typeof listing.available === "boolean" ? listing.available : null,
    sku: typeof listing.sku_number === "string" && listing.sku_number ? listing.sku_number : null,
  };
}

// ===== alarmi naloga =====

export interface AlarmiPragovi {
  kreditiMin?: number;
  paketDana?: number;
  // Alarm o kvoti se pali kad je do kraja mjeseca <= krajMjesecaDana, a iskoristeno < kvotaMinProcenat.
  kvotaMinProcenat?: number;
  krajMjesecaDana?: number;
}

export interface Alarm {
  tip: string;
  poruka: string;
  vrijednost: number;
}

export interface AlarmiNaloga {
  ok: boolean;
  alarmi: Alarm[];
}

export function alarmiNaloga(
  me: OlxUser,
  refreshLimits: RefreshLimits,
  isteklihOglasa: number,
  sadaTs: number,
  pragovi: AlarmiPragovi = {},
): AlarmiNaloga {
  const kreditiMin = pragovi.kreditiMin ?? 500;
  const paketDana = pragovi.paketDana ?? 14;
  const kvotaMinProcenat = pragovi.kvotaMinProcenat ?? 50;
  const krajMjesecaDana = pragovi.krajMjesecaDana ?? 7;

  const alarmi: Alarm[] = [];

  const pitanja = broj(me.new_questions_count) ?? 0;
  if (pitanja > 0) {
    alarmi.push({ tip: "pitanja", poruka: `${pitanja} neodgovorenih pitanja kupaca ceka odgovor.`, vrijednost: pitanja });
  }

  const shop = (me.shop ?? null) as { ends_at?: number } | null;
  if (shop?.ends_at) {
    const danaDoIsteka = Math.floor((shop.ends_at - sadaTs) / SEKUNDI_U_DANU);
    if (danaDoIsteka <= paketDana) {
      alarmi.push({ tip: "paket", poruka: `Paket shopa istice za ${danaDoIsteka} dana.`, vrijednost: danaDoIsteka });
    }
  }

  const krediti = broj(me.credits);
  if (krediti !== null && krediti < kreditiMin) {
    alarmi.push({ tip: "krediti", poruka: `Saldo kredita (${krediti}) je ispod praga ${kreditiMin}.`, vrijednost: krediti });
  }

  const freeLimit = refreshLimits.free_limit ?? 0;
  if (freeLimit > 0) {
    const iskoristeno = zaokruzi(((refreshLimits.free_count ?? 0) / freeLimit) * 100);
    const datum = new Date(sadaTs * 1000);
    const zadnjiDan = new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth() + 1, 0)).getUTCDate();
    const doKraja = zadnjiDan - datum.getUTCDate();
    if (doKraja <= krajMjesecaDana && iskoristeno < kvotaMinProcenat) {
      alarmi.push({
        tip: "kvota_obnova",
        poruka: `Do kraja mjeseca ${doKraja} dana, a iskoristeno samo ${iskoristeno}% besplatnih obnova; kvota propada.`,
        vrijednost: iskoristeno,
      });
    }
  }

  if (isteklihOglasa > 0) {
    alarmi.push({ tip: "istekli", poruka: `${isteklihOglasa} isteklih oglasa se moze reaktivirati.`, vrijednost: isteklihOglasa });
  }

  return { ok: alarmi.length === 0, alarmi };
}

// ===== efekat izdvajanja iz dnevnih snapshota =====

export interface ViewsSnapshotOglas {
  id: number;
  views: number;
  questions?: number;
  sponsored?: number;
  date?: number;
  created_at?: number;
  status?: string;
  price?: number;
  title?: string;
  // Polja za higijenu oglasa, dodana u verziji 2. Snapshot ionako prolazi kroz svaki oglas
  // pojedinacno, pa ih hvata bez ijednog dodatnog poziva. Stari snapshoti ih nemaju i citaju se
  // i dalje: citac gleda prisustvo polja, ne broj verzije.
  slika_broj?: number;
  ima_podnaslov?: boolean;
  opis_znakova?: number;
  atributa?: number;
  category_id?: number;
}

export interface ViewsSnapshot {
  verzija: number;
  ts: number;
  account?: string;
  broj_poziva?: number;
  trajanje_ms?: number;
  oglasi: ViewsSnapshotOglas[];
}

interface Segment {
  tacaka: number;
  pregleda_dnevno: number | null;
  od_ts: number | null;
  do_ts: number | null;
}

function segment(tacke: { ts: number; views: number }[]): Segment {
  if (tacke.length === 0) return { tacaka: 0, pregleda_dnevno: null, od_ts: null, do_ts: null };
  const prva = tacke[0]!;
  const zadnja = tacke[tacke.length - 1]!;
  const dana = (zadnja.ts - prva.ts) / SEKUNDI_U_DANU;
  return {
    tacaka: tacke.length,
    pregleda_dnevno: dana >= 0.5 ? zaokruzi((zadnja.views - prva.views) / dana) : null,
    od_ts: prva.ts,
    do_ts: zadnja.ts,
  };
}

export interface EfekatIzdvajanja {
  oglas_id: number;
  prije: Segment;
  tokom: Segment;
  poslije: Segment;
  // Odnos pregleda dnevno tokom naspram prije (npr. 2.4 znaci 2.4 puta vise pregleda dnevno).
  faktor: number | null;
  upozorenje: string | null;
}

export function efekatIzdvajanja(
  snapshoti: ViewsSnapshot[],
  oglasId: number,
  period: { od_ts: number; do_ts: number },
): EfekatIzdvajanja {
  const tacke = snapshoti
    .map((s) => {
      const o = s.oglasi.find((x) => x.id === oglasId);
      return o ? { ts: s.ts, views: o.views } : null;
    })
    .filter((t): t is { ts: number; views: number } => t !== null)
    .sort((a, b) => a.ts - b.ts);

  const prije = segment(tacke.filter((t) => t.ts < period.od_ts));
  const tokom = segment(tacke.filter((t) => t.ts >= period.od_ts && t.ts <= period.do_ts));
  const poslije = segment(tacke.filter((t) => t.ts > period.do_ts));

  let upozorenje: string | null = null;
  if (tacke.length === 0) upozorenje = "Nijedan snapshot ne sadrzi ovaj oglas; pokreni 'stats snapshot' dnevno pa probaj ponovo.";
  else if (prije.pregleda_dnevno === null) upozorenje = "Nema dovoljno snapshota PRIJE izdvajanja za baseline (trebaju bar dva na razmaku od pola dana).";
  else if (tokom.pregleda_dnevno === null) upozorenje = "Nema dovoljno snapshota TOKOM izdvajanja (trebaju bar dva na razmaku od pola dana).";

  const faktor =
    prije.pregleda_dnevno !== null && prije.pregleda_dnevno > 0 && tokom.pregleda_dnevno !== null
      ? zaokruzi(tokom.pregleda_dnevno / prije.pregleda_dnevno)
      : null;

  return { oglas_id: oglasId, prije, tokom, poslije, faktor, upozorenje };
}

// ===== kompaktni oblici za postojece alate =====

export interface KompaktStavka {
  id: number;
  title: string;
  price: number | null;
  sponsored: number;
  date: number | null;
  refresh_available: boolean | null;
  status: string | null;
  visible: boolean | null;
  has_discount: boolean;
}

export function kompaktList(items: ListingSummary[]): KompaktStavka[] {
  return items.map((o) => ({
    id: o.id,
    title: o.title,
    price: broj(o.price),
    sponsored: broj(o.sponsored) ?? 0,
    date: broj(o.date),
    refresh_available: typeof o.refresh_available === "boolean" ? o.refresh_available : null,
    status: o.status ?? null,
    visible: typeof o.visible === "boolean" ? o.visible : null,
    has_discount: Boolean(o.has_discount),
  }));
}

// Puni oglas bez balasta: bez user bloka, bez punog category bloka, slike kao broj + prva,
// atributi samo popunjeni { name, value }. Sve sto AI-u treba za analizu i izmjene ostaje.
export function kompaktListing(l: Listing): Record<string, unknown> {
  const category = (l.category ?? null) as { id?: number; name?: string } | null;
  const images = Array.isArray(l.images) ? (l.images as string[]) : [];
  const attributes = Array.isArray(l.attributes)
    ? (l.attributes as { id?: number; name?: string; value?: unknown }[])
        .filter((a) => a.value !== null && a.value !== undefined && a.value !== "")
        .map((a) => ({ id: a.id, name: a.name, value: a.value }))
    : [];
  return {
    id: l.id,
    title: l.title,
    short_description: l.short_description ?? null,
    description: l.additional?.description ?? null,
    price: broj(l.price),
    display_price: l.display_price ?? null,
    regular_price: broj(l.regular_price),
    has_discount: Boolean(l.has_discount),
    price_by_agreement: Boolean(l.price_by_agreement),
    views: broj(l.views),
    questions: broj(l.questions),
    status: l.status ?? null,
    available: l.available ?? null,
    visible: l.visible ?? null,
    state: l.state ?? null,
    quantity: broj(l.quantity),
    listing_type: l.listing_type ?? null,
    created_at: broj(l.created_at),
    updated_at: broj((l.additional as { updated_at?: number } | undefined)?.updated_at),
    date: broj(l.date),
    refresh_available: l.refresh_available ?? null,
    category: category ? { id: category.id, name: category.name } : null,
    category_id: broj(l.category_id),
    brand: (l.brand as { id?: number; name?: string } | null) ?? null,
    model: (l.model as { id?: number; name?: string } | null) ?? null,
    sku_number: l.sku_number ?? null,
    slika_broj: images.length,
    prva_slika: images[0] ?? null,
    attributes,
    sponsored: broj(l.sponsored) ?? 0,
    sponsor_active: l.sponsor_active ?? null,
    sponsor_scheduled: l.sponsor_scheduled ?? null,
    pinned: Boolean(l.pinned),
    shipping: l.shipping ?? null,
  };
}
