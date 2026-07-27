// Agregacija i filtriranje podataka za statistiku, analizu i alarme.
//
// Ovdje su samo ciste funkcije: bez mreze, bez fajlova, bez citanja sata. "Sada" se uvijek
// prima kao unix timestamp u sekundama, pa je rezultat deterministican i testira se bez
// mockova. Dohvat radi OlxClient, pisanje snapshota radi CLI.
//
// Smisao sloja: API vraca velike payloade (puni user blok, kategorija, atributi...), a modelu
// treba izracunata metrika. Ove funkcije sazmu podatke PRIJE nego sto stignu do AI-a.

import type { Listing, ListingSummary, OlxPublicProfile, OlxUser, RefreshLimits } from "./types.js";

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
