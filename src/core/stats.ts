// Agregacija i filtriranje podataka za statistiku, analizu i alarme.
//
// Ovdje su samo ciste funkcije: bez mreze, bez fajlova, bez citanja sata. "Sada" se uvijek
// prima kao unix timestamp u sekundama, pa je rezultat deterministican i testira se bez
// mockova. Dohvat radi OlxClient, pisanje snapshota radi CLI.
//
// Smisao sloja: API vraca velike payloade (puni user blok, kategorija, atributi...), a modelu
// treba izracunata metrika. Ove funkcije sazmu podatke PRIJE nego sto stignu do AI-a.

import { linkOglasa } from "./link.js";
import { RITAM_PODRAZUMIJEVANI, type Ritam, type RitamStrategija, ritamZapisan } from "./ritam-obnova.js";
import type {
  CategoryAttribute,
  Listing,
  ListingSummary,
  Obuhvat,
  OlxPublicProfile,
  OlxUser,
  RefreshLimits,
  SviOglasi,
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

// Jedino mjesto koje gradi Obuhvat: nijedno drugo mjesto ga ne smije sastavljati rucno.
export function obuhvatIz(svi: SviOglasi): Obuhvat {
  return { potpuno: svi.potpuno, ukupno: svi.ukupno, procitano: svi.oglasi.length, razlog: svi.razlog };
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
  // Iz olx_listing_limits; oblik nije dokumentovan pa se cita tolerantno.
  listingLimits?: unknown;
  // Koliki dio kataloga stoji iza ovog izvjestaja; gradi se sa `obuhvatIz`.
  obuhvat: Obuhvat;
}

export interface ProfilStatistika {
  nalog: {
    username: string | null;
    paket: string | null;
    paket_istice_za_dana: number | null;
    krediti: number | null;
    nova_pitanja: number | null;
    ocjene: { pozitivne: number; negativne: number } | null;
  };
  kvota_obnova: { free_limit: number; free_count: number; preostalo: number; iskoristeno_procenat: number };
  oglasi: { aktivni: number; istekli: number; skriveni: number; neaktivni: number; zavrseni: number };
  cijene: { min: number | null; median: number | null; max: number | null; prosjek: number | null; na_upit: number };
  sponzorisano: { broj: number; premium: number; procenat: number };
  objava_limit: LimitObjaveGrupa[];
  neobnovljeni: { id: number; title: string; dana_od_obnove: number }[];
  // Predlog za covjeka (nije auto-akcija), koji artikle zavrsiti/sakriti kad je neka grupa blizu
  // limita objave. Kriterij je "najduze neobnavljano", NIJE broj pregleda: dostupno je bez ijednog
  // dodatnog API poziva, dok pregledi postoje samo u views=sample/snapshot rezimu. Emituje se samo
  // kad bar jedna grupa u `objava_limit` ima status blizu_limita ili dostignut.
  objava_kandidati_predlog?: { id: number; title: string; dana_od_obnove: number }[];
  pregledi: {
    obuhvaceno: number;
    top: { id: number; title?: string; views: number; pregleda_dnevno: number | null }[];
    dno: { id: number; title?: string; views: number; pregleda_dnevno: number | null }[];
  } | null;
  // Izvjestaj vrijedi samo za ovaj dio kataloga; nepotpun uzorak se mora vidjeti u izlazu.
  obuhvat: Obuhvat;
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

  const objava = limitObjave(input.listingLimits);
  // Predlog se objavljuje samo kad je stvarno potreban, ne kao stalna prazna praznina.
  const objavaKriticno = objava.some((g) => g.status === "blizu_limita" || g.status === "dostignut");

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
      nova_pitanja: broj(me.new_questions_count),
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
    objava_limit: objava,
    neobnovljeni,
    ...(objavaKriticno ? { objava_kandidati_predlog: neobnovljeni } : {}),
    pregledi,
    obuhvat: input.obuhvat,
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
  /** Izmjereni dan reseta kvote iz kvota dnevnika; vazi kad ciklusa pretplate nema. */
  izmjereniDanReseta?: number;
  /** Dan ciklusa iz `OLX_DAN_CIKLUSA_KVOTE`; vazi samo kad nalog nema `shop.ends_at`. */
  danCiklusaRezerva?: number;
  // Koliki dio kataloga stoji iza ovog izvjestaja; gradi se sa `obuhvatIz`.
  obuhvat: Obuhvat;
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
    nova_pitanja: number | null;
    aktivnih_oglasa: number;
    limit_oglasa: number | null;
    popunjenost_procenat: number | null;
  };
  besplatne_obnove: {
    kvota: number;
    iskorisceno: number;
    preostalo: number;
    /** null kad rok nije poznat: kalendarska pretpostavka se ne prikazuje kao broj dana. */
    dana_do_reseta: number | null;
    /** true kad rok stoji na ciklusu pretplate ili na izmjerenom danu; false znaci da izvora nema. */
    rok_poznat: boolean;
    // Koliko obnova dnevno treba trositi da se OSTVARIVO iskoristi do obnove kvote. Racuna se na
    // ostvarivo, ne na sirovu kvotu (olx://pravila-brojeva), jer prag po oglasu vezuje prije kvote.
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
  // Izvjestaj vrijedi samo za ovaj dio kataloga; nepotpun uzorak se mora vidjeti u izlazu.
  obuhvat: Obuhvat;
}

function primjeri(lista: { id: number; title?: string }[]): { id: number; title: string }[] {
  return lista.slice(0, 10).map((o) => ({ id: o.id, title: o.title ?? String(o.id) }));
}

function nalaz(kljuc: string, poruka: string, lista: { id: number; title?: string }[]): OnboardingNalaz {
  return { kljuc, poruka, broj: lista.length, primjeri: primjeri(lista) };
}

/**
 * Dan u mjesecu na koji se kvota obnova obnavlja, izveden iz datuma isteka paketa.
 *
 * Zasto iz `shop.ends_at`: pretplata se placa po broju mjeseci od datuma placanja, pa mjesecni
 * ciklus tece od tog dana, a ne od prvog u mjesecu. Kalendarski mjesec je bio pretpostavka i
 * davao je pogresan rok (izmjereno 31.07.2026: kod je javio 1 dan, a ciklus je isticao 24.08).
 *
 * PAZNJA, ovo NIJE "dana do isteka paketa": paket kupljen na sest mjeseci ima `ends_at` daleko u
 * buducnosti, a mjesecnica je i dalje isti dan u mjesecu. Zato se uzima samo DAN.
 */
export function danCiklusaIzIsteka(endsAtTs: number | undefined | null): number | undefined {
  if (typeof endsAtTs !== "number" || !Number.isFinite(endsAtTs) || endsAtTs <= 0) return undefined;
  return new Date(endsAtTs * 1000).getUTCDate();
}

/**
 * Broj dana do sljedece obnove kvote, ukljucujuci danasnji. Radi u UTC, isto kao ostatak modula.
 *
 * Sa `danCiklusa` racuna do sljedece pojave tog dana u mjesecu. Bez njega pada na kraj
 * kalendarskog mjeseca, ali tada pozivalac NE smije tvrditi rok korisniku: da se kvota resetuje
 * bas krajem kalendarskog mjeseca je pretpostavka, status stoji u olx://pravila-brojeva.
 */
export function danaDoResetaKvote(sadaTs: number, danCiklusa?: number): number {
  const d = new Date(sadaTs * 1000);
  const danas = d.getUTCDate();
  const godina = d.getUTCFullYear();
  const mjesec = d.getUTCMonth();
  const odMs = Date.UTC(godina, mjesec, danas);

  // Bez poznatog ciklusa se pada na prvi u sljedecem mjesecu, dakle dan reseta je 1. Time su dva
  // slucaja jedan racun: broji se OD danas DO dana reseta, ne racunajuci sam dan reseta, jer je
  // zadnji dan koji se moze iskoristiti onaj prije reseta.
  const zeljeni = typeof danCiklusa === "number" && Number.isFinite(danCiklusa)
    ? Math.min(Math.max(1, Math.floor(danCiklusa)), 31)
    : 1;

  // Dan 29, 30 i 31 ne postoji u svakom mjesecu, pa se steze na zadnji dan ciljnog mjeseca. Bez
  // toga bi Date pretekao u sljedeci mjesec i rok bi skocio za nekoliko dana.
  const stegni = (g: number, m: number): number => Math.min(zeljeni, new Date(Date.UTC(g, m + 1, 0)).getUTCDate());

  // Prvi reset STRIKTNO poslije danas: ako je reset bas danas, kvota je vec obnovljena, pa vazi
  // sljedeci ciklus.
  let ciljMs = Date.UTC(godina, mjesec, stegni(godina, mjesec));
  if (ciljMs <= odMs) ciljMs = Date.UTC(godina, mjesec + 1, stegni(godina, mjesec + 1));

  return Math.max(1, Math.round((ciljMs - odMs) / 86_400_000));
}

/**
 * Koji izvor pobjedjuje kad se izmjereni dan reseta i dan ciklusa pretplate razilaze.
 *
 * Odluka od 03.08.2026: pobjedjuje CIKLUS. Osnov: paket se placa od dana aktivacije, pa mjesecni
 * prozor tece od tog dana, a ne od prvog u mjesecu. Prvo mjerenje (01.08.2026: `free_count` pao
 * 318 na 59 bas prvog u mjesecu, uz dan ciklusa 24) govorilo je u prilog kalendaru; ova odluka ga
 * svjesno tretira kao anomaliju jednog prelaza.
 *
 * Presuda 24.08.2026 i dalje stoji, jer se `.olx-pik/kvota-dnevnik.jsonl` puni nepromijenjeno:
 * padne li `free_count` tek 01.09. a ne 24.08., ovdje se vrijednost prebaci na "mjerenje". Ovo je
 * jedino mjesto koje tada treba dirati.
 */
export const IZVOR_ROKA_KVOTE: "ciklus" | "mjerenje" = "ciklus";

/**
 * Odakle je rok reseta kvote. Vrijednosti sa sufiksom `_uz_spor` znace da mjerenje i ciklus tvrde
 * RAZLICIT dan: rok se izgovara po pobjedniku iz `IZVOR_ROKA_KVOTE`, ali se nesuglasje biljezi da
 * presuda 24.08.2026 ostane mjerljiva iz zapisa.
 */
export type RokIzvor = "izmjereno" | "ciklus" | "kalendar" | "ciklus_uz_spor" | "mjerenje_uz_spor";

export interface RokResetaKvote {
  /** Dan u mjesecu kad se kvota obnavlja, ili `undefined` kad nema ni mjerenja ni ciklusa. */
  danReseta: number | undefined;
  /** true kad se rok smije izgovoriti korisniku. false znaci da je broj pretpostavka (kalendar). */
  rokPoznat: boolean;
  rokIzvor: RokIzvor;
}

/**
 * Jedno mjesto koje rjesava rok reseta kvote, da dnevni plan, onboarding i alarmi ne mogu
 * razici. Ranije je ista logika stajala prepisana na tri mjesta i alarm je govorio rok koji je
 * dnevna poruka precutala.
 *
 * Kalendar (prvi u mjesecu) ostaje samo kad nema nijednog izvora, i tada `rokPoznat` je false:
 * pozivalac broj smije koristiti za grubu procjenu, ali ga ne smije tvrditi kao rok.
 */
export function rokResetaKvote(izmjereniDanReseta?: number, danCiklusa?: number): RokResetaKvote {
  const imaMjerenje = typeof izmjereniDanReseta === "number" && Number.isFinite(izmjereniDanReseta);
  const imaCiklus = typeof danCiklusa === "number" && Number.isFinite(danCiklusa);

  if (imaMjerenje && imaCiklus && izmjereniDanReseta !== danCiklusa) {
    const poCiklusu = IZVOR_ROKA_KVOTE === "ciklus";
    return {
      danReseta: poCiklusu ? danCiklusa : izmjereniDanReseta,
      rokPoznat: true,
      rokIzvor: poCiklusu ? "ciklus_uz_spor" : "mjerenje_uz_spor",
    };
  }
  // Kad se slazu, ciklus je taj koji vazi, a mjerenje ga samo potvrdjuje.
  if (imaCiklus) return { danReseta: danCiklusa, rokPoznat: true, rokIzvor: "ciklus" };
  // Bez ciklusa je mjerenje jedini stvarni dokaz i vrijedi samo za sebe.
  if (imaMjerenje) return { danReseta: izmjereniDanReseta, rokPoznat: true, rokIzvor: "izmjereno" };
  return { danReseta: undefined, rokPoznat: false, rokIzvor: "kalendar" };
}

/**
 * Sklanjanje rijeci "dan" uz broj. Bez ovoga poruka klijentu kaze "1 dana", sto odmah odaje da
 * je tekst sastavio program (prijavljeno iz prakse 31.07.2026).
 */
export function danaRijec(n: number): string {
  return Math.abs(n) === 1 ? "dan" : "dana";
}

/** Prag rucne obnove istog oglasa, u danima (olx://pravila-brojeva, Razred A). */
export function pragObnove(imaShop: boolean, imaPro = false): number {
  if (imaShop) return 7;
  return imaPro ? 21 : 30;
}

/**
 * Koliko obnova katalog FIZICKI moze potrositi u `dana` dana: rucna obnova istog oglasa ide tek
 * nakon praga (shop 7 dana, PRO 21, klasicni 30; olx://pravila-brojeva, Razred A).
 * Kvota veca od ovoga se ne moze iskoristiti ni teoretski, pa se savjeti i alarmi porede sa
 * ostvarivim brojem, ne sa sirovom kvotom; inace "kvota propada" gori vjecno na svakom nalogu
 * ciji je katalog manji od kvote.
 */
export function ostvarivihObnova(brojAktivnih: number, dana: number, imaShop: boolean, imaPro = false): number {
  const prag = pragObnove(imaShop, imaPro);
  return Math.max(0, brojAktivnih) * Math.max(1, Math.floor(dana / prag));
}

export function onboardingIzvjestaj(input: OnboardingInput): OnboardingIzvjestaj {
  const { me, refreshLimits, aktivni, sadaTs } = input;
  const shop = (me.shop ?? null) as { package?: string; ends_at?: number } | null;

  const kvota = refreshLimits.free_limit ?? 0;
  const iskorisceno = refreshLimits.free_count ?? 0;
  const preostalo = Math.max(0, kvota - iskorisceno);
  const danCiklusa = danCiklusaIzIsteka(shop?.ends_at) ?? input.danCiklusaRezerva;
  const { danReseta, rokPoznat } = rokResetaKvote(input.izmjereniDanReseta, danCiklusa);
  const danaDoKraja = danaDoResetaKvote(sadaTs, danReseta);
  // Kad rok nije poznat, `danaDoKraja` je kalendarska pretpostavka, pa ne smije ni u tekst ni u
  // broj koji klijent vidi. Tempo se tada racuna nad neutralnim prozorom od 30 dana.
  const prozorTempa = rokPoznat ? danaDoKraja : 30;

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
    // Savjet je ogranicen ostvarivim: sa N aktivnih i obnovom svakih 7 dana po oglasu, "500
    // dnevno" je fizicki nemoguce i takav savjet samo rusi povjerenje.
    const ostvarivo = ostvarivihObnova(aktivni.length, danaDoKraja, shop !== null);
    const zaPotrositi = Math.min(preostalo, ostvarivo);
    const dnevno = Math.min(Math.ceil(zaPotrositi / danaDoKraja), aktivni.length);
    if (zaPotrositi > 0 && dnevno > 0) {
      potezi.push({
        redoslijed: potezi.length + 1,
        potez:
          preostalo > ostvarivo
            ? `Obnavljati redovno, oko ${dnevno} oglasa dnevno: do obnove kvote katalog moze iskoristiti jos oko ${zaPotrositi} obnova. Kvota (${preostalo} preostalo) je veca nego sto katalog fizicki moze potrositi, jer se isti oglas obnavlja tek nakon praga, i to je normalno.`
            : `Potrositi preostalih ${preostalo} besplatnih obnova do obnove kvote, oko ${dnevno} dnevno`,
        kosta: "besplatno",
      });
    }
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
      nova_pitanja: broj(me.new_questions_count),
      aktivnih_oglasa: aktivni.length,
      limit_oglasa: limitOglasa,
      popunjenost_procenat: limitOglasa && limitOglasa > 0 ? zaokruzi((aktivni.length / limitOglasa) * 100) : null,
    },
    besplatne_obnove: {
      kvota,
      iskorisceno,
      preostalo,
      dana_do_reseta: rokPoznat ? danaDoKraja : null,
      rok_poznat: rokPoznat,
      preporuceno_dnevno:
        preostalo === 0
          ? 0
          : Math.min(
              Math.ceil(Math.min(preostalo, ostvarivihObnova(aktivni.length, prozorTempa, shop !== null)) / prozorTempa),
              aktivni.length,
            ),
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
    obuhvat: input.obuhvat,
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
  // Prazan opis i kratak opis nisu isto. Prazan je greska i zaustavlja objavu: u praksi je oglas
  // objavljen bez ijedne rijeci opisa i to niko nije prijavio (30.07.2026.), jer je upozorenje
  // ostavljalo `spreman: true`. Kratak opis ostaje stvar kvalitete.
  const opis = (nacrt.description ?? "").trim();
  if (!opis) {
    upozorenja.push({ polje: "description", problem: "Opis je prazan. Oglas bez opisa se ne objavljuje.", vrsta: "greska" });
  } else if (opis.length < 100) {
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
  /** Dana do sljedece obnove kvote. Vidi `rok_poznat` prije nego se broj izgovori korisniku. */
  dana_do_reseta: number;
  /**
   * true kad rok stoji na ciklusu pretplate (`shop.ends_at`) ili na izmjerenom danu. Kad je false,
   * broj je kalendarska pretpostavka i tekst ga NE smije tvrditi kao rok.
   */
  rok_poznat: boolean;
  /** Odakle je rok; vidi `RokIzvor` za znacenje sufiksa `_uz_spor`. */
  rok_izvor: RokIzvor;
  /** Koliko obnova katalog fizicki moze potrositi do reseta (prag po oglasu, `ostvarivihObnova`). */
  ostvarivo: number;
  // Koliko bi trebalo obnoviti danas da se ostvarivo ravnomjerno rasporedi do reseta kvote.
  // Ogranicen brojem aktivnih oglasa kad je poznat: oglas se ne moze obnoviti dvaput isti dan,
  // pa cilj veci od broja oglasa nije cilj nego besmislica u izvjestaju.
  cilj_danas: number;
  // Koliko oglasa je uopste dostupno za obnovu (refresh_available).
  kandidata: number;
  // Stvarni broj za danas: manji od cilja i broja kandidata.
  za_obnovu: number;
  // true kad se preostala kvota ne moze potrositi do reseta ni u najboljem slucaju, jer se isti
  // oglas obnavlja tek nakon praga. Tada nema smisla javljati tempo, niti da kvota "propada".
  kvota_neostvariva: boolean;
  /** Koji ritam je primijenjen; ide u izvjestaj da klijent zna po cemu se radi. */
  ritam: RitamStrategija;
  /**
   * Smiju li obnove uopste ici automatski. "auto" kad je klijent rekao svoj ritam,
   * "ceka_odluku" dok nije rekao nista (nista se ne obnavlja, jutarnja poruka ga pita),
   * "iskljuceno" kad je izricito rekao da automatskih obnova ne zeli.
   */
  obnove_stanje: "auto" | "ceka_odluku" | "iskljuceno";
}

export interface DnevniPlanUlaz {
  refreshLimits: RefreshLimits;
  kandidata: number;
  sadaTs: number;
  aktivnihOglasa?: number;
  /** Dan u mjesecu kad se kvota obnavlja; iz `danCiklusaIzIsteka(shop.ends_at)`. */
  danCiklusa?: number;
  /**
   * Dan reseta IZMJEREN iz kvota dnevnika (`izmjereniDanReseta(ucitajKvotuDnevnik())`).
   * Kad se razilazi sa `danCiklusa`, pobjednika bira `IZVOR_ROKA_KVOTE`.
   */
  izmjereniDanReseta?: number;
  imaShop?: boolean;
  imaPro?: boolean;
  ritam?: Ritam;
}

/**
 * Koliko obnova potrositi danas.
 *
 * Ravnomjerno trosenje, ne sve odjednom: obnova vraca oglas na vrh po svjezini, pa 500 obnova u
 * jednom danu i nula narednih daje losiju prosjecnu poziciju nego 100 dnevno kroz pet dana.
 *
 * Racuna se na OSTVARIVO, ne na sirovu kvotu. To je pravilo iz olx://pravila-brojeva ("poredjenja
 * i alarmi idu na ostvarivo"), koje je ova funkcija ranije krsila: dijelila je preostalu kvotu na
 * dane i dobijala tempo koji nijedan katalog ne moze ispuniti (izmjereno 31.07.2026: cilj 121 na
 * shopu gdje je odrzivo oko 17, jer se isti oglas obnavlja tek svakih 7 dana).
 */
export function dnevniPlanObnova(ulaz: DnevniPlanUlaz): DnevniPlanObnova {
  const { refreshLimits, kandidata, sadaTs, aktivnihOglasa, danCiklusa, imaShop = false, imaPro = false } = ulaz;
  const ritam = ulaz.ritam ?? RITAM_PODRAZUMIJEVANI;

  const kvota = refreshLimits.free_limit ?? 0;
  const preostalo = Math.max(0, kvota - (refreshLimits.free_count ?? 0));
  // Rok ide kroz `rokResetaKvote`, jedino mjesto koje rjesava spor mjerenja i ciklusa. Ovdje se
  // logika ne prepisuje, jer je prepisana na tri mjesta vec jednom razisla u praksi.
  const { danReseta, rokPoznat, rokIzvor } = rokResetaKvote(ulaz.izmjereniDanReseta, danCiklusa);
  const dana = danaDoResetaKvote(sadaTs, danReseta);

  // Gornja granica je broj oglasa: isti oglas se ne obnavlja dvaput u istom danu. Bez ovoga
  // izvjestaj klijentu javi tempo tipa "741 dnevno" na shopu od 120 oglasa (viđeno 30.07.2026).
  const strop = typeof aktivnihOglasa === "number" && aktivnihOglasa >= 0 ? aktivnihOglasa : Number.POSITIVE_INFINITY;
  const ostvarivo =
    strop === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : ostvarivihObnova(strop, dana, imaShop, imaPro);
  const zaPotrositi = Math.min(preostalo, ostvarivo);

  // Odluka klijenta je kapija ispred svega: dok je nema, nista se ne obnavlja samo od sebe,
  // nego ga jutarnja poruka pita (odluka vlasnika 04.08.2026). Cilj se i tada racuna, da
  // poruka moze reci koliko bi se danas moglo.
  const stanje: DnevniPlanObnova["obnove_stanje"] =
    ritam.strategija === "iskljuceno" ? "iskljuceno" : ritamZapisan(ritam) ? "auto" : "ceka_odluku";

  let cilj: number;
  if (preostalo === 0 || stanje === "iskljuceno") {
    cilj = 0;
  } else if (ritam.strategija === "sve-dostupno") {
    // Trgovac je rekao da hoce sve sto platforma da. Kvota je jedina granica.
    cilj = Math.min(preostalo, strop);
  } else if (ritam.strategija === "interval" && typeof ritam.dana === "number" && ritam.dana > 0) {
    // Svaki oglas svakih `dana`: dnevni cilj je katalog podijeljen intervalom. Koji je oglas
    // danas na redu presudjuje pozivalac, jer samo on ima datum zadnje obnove po oglasu.
    const poIntervalu = strop === Number.POSITIVE_INFINITY ? preostalo : Math.ceil(strop / ritam.dana);
    cilj = Math.min(poIntervalu, preostalo);
  } else {
    cilj = Math.min(Math.ceil(zaPotrositi / dana), strop);
  }

  return {
    kvota,
    preostalo,
    dana_do_reseta: dana,
    rok_poznat: rokPoznat,
    rok_izvor: rokIzvor,
    ostvarivo: Number.isFinite(ostvarivo) ? ostvarivo : 0,
    cilj_danas: Number.isFinite(cilj) ? cilj : 0,
    kandidata,
    za_obnovu: stanje === "auto" ? Math.min(cilj, kandidata) : 0,
    kvota_neostvariva: preostalo > 0 && Number.isFinite(ostvarivo) && preostalo > ostvarivo,
    ritam: ritam.strategija,
    obnove_stanje: stanje,
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
  // Izvjestaj vrijedi samo za ovaj dio kataloga; nepotpun uzorak se mora vidjeti u izlazu.
  obuhvat: Obuhvat;
}

export function konkurentIzvjestaj(
  profil: OlxPublicProfile,
  aktivni: ListingSummary[],
  zavrsenoUkupno: number | null,
  sadaTs: number,
  obuhvat: Obuhvat,
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
    obuhvat,
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

// ===== limit objave po grupama kategorija =====

export type StatusLimitaObjave = "slobodno" | "blizu_limita" | "dostignut";

export interface LimitObjaveGrupa {
  grupa: string;
  limit: number;
  unlimited: boolean;
  aktivno: number;
  preostalo: number | null;
  iskoristeno_procenat: number | null;
  status: StatusLimitaObjave;
}

/**
 * Limit objave po grupama kategorija, iz `olx_listing_limits`.
 *
 * Oblik odgovora nije dokumentovan; potvrdjen na zivom API-ju kao
 * `{"data":{"cars":{"limit":0,"unlimited":true,"listings":0}, ...}}`. Ulaz prihvata i omotan
 * (`data`) i goli oblik, jer `listingLimits()` u index.ts vraca odgovor neodmotan.
 */
export function limitObjave(listingLimits: unknown, pragBlizuProcenat = 90): LimitObjaveGrupa[] {
  if (typeof listingLimits !== "object" || listingLimits === null) return [];
  const korijen = listingLimits as Record<string, unknown>;
  const grupe = (
    typeof korijen.data === "object" && korijen.data !== null ? (korijen.data as Record<string, unknown>) : korijen
  ) as Record<string, unknown>;

  const rezultat: LimitObjaveGrupa[] = [];
  for (const [naziv, vrijednost] of Object.entries(grupe)) {
    if (typeof vrijednost !== "object" || vrijednost === null) continue;
    const g = vrijednost as Record<string, unknown>;
    const limit = broj(g.limit) ?? 0;
    const aktivno = broj(g.listings) ?? 0;
    const unlimited = Boolean(g.unlimited);

    if (unlimited) {
      rezultat.push({ grupa: naziv, limit, unlimited, aktivno, preostalo: null, iskoristeno_procenat: null, status: "slobodno" });
      continue;
    }
    // Nepoznat limit se tretira kao "ne znam", ne kao dostignut: lazna uzbuna na nedokumentovanoj
    // grupi je gore imati nego preranu tisinu (nula i "ne znam" nisu isto).
    if (limit <= 0) {
      rezultat.push({ grupa: naziv, limit, unlimited, aktivno, preostalo: null, iskoristeno_procenat: null, status: "slobodno" });
      continue;
    }

    const iskoristenoProcenat = zaokruzi((aktivno / limit) * 100);
    const status: StatusLimitaObjave =
      aktivno >= limit ? "dostignut" : iskoristenoProcenat >= pragBlizuProcenat ? "blizu_limita" : "slobodno";
    rezultat.push({
      grupa: naziv,
      limit,
      unlimited,
      aktivno,
      preostalo: Math.max(0, limit - aktivno),
      iskoristeno_procenat: iskoristenoProcenat,
      status,
    });
  }

  return rezultat.sort((a, b) => a.grupa.localeCompare(b.grupa));
}

// ===== alarmi naloga =====

export interface AlarmiPragovi {
  kreditiMin?: number;
  paketDana?: number;
  // Alarm o kvoti se pali kad je do reseta kvote <= krajMjesecaDana, a iskoristeno < kvotaMinProcenat.
  kvotaMinProcenat?: number;
  krajMjesecaDana?: number;
  /** Dan ciklusa iz `OLX_DAN_CIKLUSA_KVOTE`; vazi samo kad nalog nema `shop.ends_at`. */
  danCiklusaRezerva?: number;
  /** Tri praga isteka paketa u danima. `paketDana` (stari parametar) override-uje SAMO srednji. */
  paketNivoi?: { info: number; upozorenje: number; hitno: number };
}

export type NivoAlarma = "info" | "upozorenje" | "hitno";

// `nivo` nose samo alarmi vezani za planiranje unaprijed (`paket`, `objava_limit`); `krediti`,
// `kvota_obnova` i `istekli` su binarni prag koji vec dobro radi, pa im nivo ne treba i ne dodaje se.
export interface Alarm {
  tip: string;
  poruka: string;
  vrijednost: number;
  nivo?: NivoAlarma;
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
  // Izmjereni dan reseta iz kvota dnevnika; jaci od ciklusa pretplate, isto kao u planu obnova.
  izmjereniDanReseta?: number,
  listingLimits?: unknown,
): AlarmiNaloga {
  const kreditiMin = pragovi.kreditiMin ?? 500;
  const kvotaMinProcenat = pragovi.kvotaMinProcenat ?? 50;
  const krajMjesecaDana = pragovi.krajMjesecaDana ?? 7;
  const paketNivoiDefault = { info: 30, upozorenje: 14, hitno: 3 };
  const paketNivoi = pragovi.paketNivoi ?? paketNivoiDefault;
  // Stari `paketDana` mijenja SAMO srednji prag (upozorenje), da postojeci pozivaoci ne moraju
  // znati o tri nivoa da bi zadrzali svoje ponasanje.
  const pragUpozorenje = pragovi.paketDana ?? paketNivoi.upozorenje;
  const pragHitno = paketNivoi.hitno;
  const pragInfo = paketNivoi.info;

  const alarmi: Alarm[] = [];

  // Alarm o pitanjima kupaca NAMJERNO ne postoji: new_questions_count sa API-ja je na zivom
  // nalogu pokazao 0 uz postojeca pitanja, pa se iz njega nista ne alarmira dok se semantika
  // ne izmjeri (uporediti web i API na istom nalogu). Sirova vrijednost ostaje u podacima.
  const shop = (me.shop ?? null) as { ends_at?: number } | null;
  if (shop?.ends_at) {
    const danaDoIsteka = Math.floor((shop.ends_at - sadaTs) / SEKUNDI_U_DANU);
    // Najstroziji pogodjen prag pobjedjuje. Poruka za istekao paket (negativan broj dana) je
    // drugacija: ranije je pisalo "istice za -3 dana", sto je covjeku besmisleno i skriva da je
    // paket VEC istekao.
    let nivo: NivoAlarma | null = null;
    if (danaDoIsteka <= pragHitno) nivo = "hitno";
    else if (danaDoIsteka <= pragUpozorenje) nivo = "upozorenje";
    else if (danaDoIsteka <= pragInfo) nivo = "info";
    if (nivo) {
      const poruka =
        danaDoIsteka >= 0
          ? `Paket shopa istice za ${danaDoIsteka} ${danaRijec(danaDoIsteka)}.`
          : `Paket shopa je istekao prije ${Math.abs(danaDoIsteka)} ${danaRijec(Math.abs(danaDoIsteka))}.`;
      alarmi.push({ tip: "paket", poruka, vrijednost: danaDoIsteka, nivo });
    }
  }

  for (const grupa of limitObjave(listingLimits)) {
    if (grupa.status === "blizu_limita") {
      alarmi.push({
        tip: "objava_limit",
        poruka: `Grupa '${grupa.grupa}' je na ${grupa.iskoristeno_procenat}% limita objave (${grupa.aktivno}/${grupa.limit}), jos ${grupa.preostalo} mjesta.`,
        vrijednost: grupa.iskoristeno_procenat ?? 0,
        nivo: "upozorenje",
      });
    } else if (grupa.status === "dostignut") {
      alarmi.push({
        tip: "objava_limit",
        poruka: `Grupa '${grupa.grupa}' je dostigla limit objave (${grupa.aktivno}/${grupa.limit}) - nema mjesta za nove artikle dok se neki ne zavrsi ili sakrije.`,
        vrijednost: grupa.iskoristeno_procenat ?? 0,
        nivo: "hitno",
      });
    }
  }

  const krediti = broj(me.credits);
  if (krediti !== null && krediti < kreditiMin) {
    alarmi.push({ tip: "krediti", poruka: `Saldo kredita (${krediti}) je ispod praga ${kreditiMin}.`, vrijednost: krediti });
  }

  const freeLimit = refreshLimits.free_limit ?? 0;
  if (freeLimit > 0) {
    // Rok ide kroz istu funkciju kao ostatak modula. Ranije se racunao ovdje rucno i BEZ
    // danasnjeg dana, pa je ista cron poruka mogla reci "1 dana" iz jednog izvora i "0 dana" iz
    // drugog (izmjereno 31.07.2026).
    // Rok ide kroz istu funkciju kao dnevni plan i onboarding, pa alarm ne moze tvrditi rok koji
    // dnevna poruka precuti (bilo tako do 0.9.1: alarm je govorio "za oko N dana", poruka nista).
    const danCiklusa = danCiklusaIzIsteka(shop?.ends_at) ?? pragovi.danCiklusaRezerva;
    const { danReseta, rokPoznat } = rokResetaKvote(izmjereniDanReseta, danCiklusa);
    const doKraja = danaDoResetaKvote(sadaTs, danReseta);
    // Poredjenje ide sa OSTVARIVIM, ne sa sirovom kvotom: listing_count iz refresh/limits je
    // broj oglasa naloga, pa katalog od 168 oglasa nikad ne moze potrositi kvotu 1800 i alarm
    // po sirovoj kvoti bi gorio svaki mjesec kao sum.
    const aktivnih = refreshLimits.listing_count ?? 0;
    const imaShop = Boolean(me.shop);
    const uCiklusu = ostvarivihObnova(aktivnih, 30, imaShop);
    const dostizno = aktivnih > 0 ? Math.min(freeLimit, uCiklusu) : freeLimit;
    const iskoristeno = dostizno > 0 ? zaokruzi(((refreshLimits.free_count ?? 0) / dostizno) * 100) : 100;
    if (doKraja <= krajMjesecaDana && iskoristeno < kvotaMinProcenat) {
      const stize = Math.min(
        Math.max(0, freeLimit - (refreshLimits.free_count ?? 0)),
        aktivnih > 0 ? ostvarivihObnova(aktivnih, doKraja, imaShop) : Number.MAX_SAFE_INTEGER,
      );
      // Bez poznatog roka se broj dana ne izgovara nikako, isto kao u dnevnoj poruci.
      const poruka = rokPoznat
        ? `Do obnove kvote ${doKraja} ${danaRijec(doKraja)}, a iskoristeno ${iskoristeno}% ostvarivih besplatnih obnova; jos oko ${stize} se stize iskoristiti.`
        : `Iskoristeno ${iskoristeno}% ostvarivih besplatnih obnova, a rok obnove kvote nije poznat.`;
      alarmi.push({ tip: "kvota_obnova", poruka, vrijednost: iskoristeno });
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
  /**
   * Trenutak (unix sekunde) kad je BAS OVAJ oglas procitan unutar prolaza, dodano u verziji 3.
   * Prolaz sad moze trajati vise pokretanja (budzet po pokretanju, `stats snapshot` u
   * src/cli/index.ts), pa oglasi u istom snapshotu vise nisu nuzno procitani u istoj sekundi.
   *
   * NAMJERNO SE NE KORISTI NIGDJE U RACUNU: `promjenaPregleda`, `mrtviOglasi` i sav ostatak ovog
   * fajla i dalje racunaju iskljucivo prema `ViewsSnapshot.ts` (trenutak PISANJA snapshota), ne
   * prema ovom polju. Ovo je svjesna odluka vlasnika toolkita: podatak je bezvrijedan unazad (stari
   * snapshoti ga nemaju), pa se skuplja OD SADA za buducu upotrebu, ali se racun koji hrani
   * klijentski alarm u OVOM izdanju ne mijenja. NE brisati ovaj komentar i NE dirati ovo polje kao
   * "mrtav kod" bez provjere da li ga je neko poceo koristiti.
   */
  procitano_ts?: number;
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

/**
 * Ista polja kao kompaktList, ali kao CSV sa zaglavljem.
 *
 * Zasto: u JSON obliku se imena polja ponavljaju za svaki oglas i to je vise od pola payloada.
 * Izmjereno na shopu od 120 oglasa (30.07.2026., zapisano u deepseek-nalazi.md): JSON 6.135
 * tokena, CSV 2.474, dakle 60% manje BEZ izbacivanja ijednog polja. Isti obrazac koji repo
 * vec koristi za katalog kategorija (`olx://categories-index`), i tamo izabran iz istog razloga.
 *
 * Boolean ide kao 1/0, null kao prazno polje. Naslovi se citiraju kad nose zapetu ili navodnik.
 */
export function kompaktCsv(items: ListingSummary[]): string {
  const kompakt = kompaktList(items);
  const polja: (keyof KompaktStavka)[] = [
    "id",
    "title",
    "price",
    "sponsored",
    "date",
    "refresh_available",
    "status",
    "visible",
    "has_discount",
  ];
  const celija = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "1" : "0";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [polja.join(","), ...kompakt.map((o) => polja.map((p) => celija(o[p])).join(","))].join("\n");
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
    // Link je tu da bot ne mora pogadjati kad korisnik trazi "daj link": API ga ne vraca.
    link: linkOglasa(l.id, l.slug),
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
