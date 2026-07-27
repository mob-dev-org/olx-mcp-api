// Testovi agregacionog sloja: sve ciste funkcije, bez mreze i bez mockova.
// "Sada" je fiksiran timestamp da rezultati budu deterministicni.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alarmiNaloga,
  efekatIzdvajanja,
  konkurentIzvjestaj,
  kompaktList,
  kompaktListing,
  median,
  oglasIzvjestaj,
  profilStatistika,
  type ViewsSnapshot,
} from "./stats.js";
import type { Listing, ListingSummary, OlxPublicProfile, OlxUser, RefreshLimits } from "./types.js";

// 2026-07-27 00:00 UTC, fiksno "sada" za sve testove.
const SADA = 1_785_456_000;
const DAN = 86_400;

function oglas(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return { id: 1, title: "Testni oglas", price: 100, date: SADA - DAN, sponsored: 0, ...overrides };
}

function me(overrides: Record<string, unknown> = {}): OlxUser {
  return {
    id: 1,
    username: "TestShop",
    credits: 2000,
    new_questions_count: 0,
    feedbacks: { positive: 5, negative: 1 },
    shop: { package: "Gold", ends_at: SADA + 90 * DAN },
    ...overrides,
  };
}

function limits(overrides: Partial<RefreshLimits> = {}): RefreshLimits {
  return { free_limit: 1800, free_count: 900, paid_count: 0, listing_count: 10, ...overrides };
}

test("median radi za paran i neparan broj elemenata i prazan niz", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("profilStatistika sazima nalog, kvotu, cijene i sponzorisane", () => {
  const aktivni = [
    oglas({ id: 1, price: 100 }),
    oglas({ id: 2, price: 300, sponsored: 2 }),
    oglas({ id: 3, price: 0 }),
    oglas({ id: 4, price: 200, price_by_agreement: true }),
  ];
  const s = profilStatistika({
    me: me(),
    refreshLimits: limits(),
    aktivni,
    ukupno: { istekli: 21, skriveni: 2, neaktivni: 1, zavrseni: 302 },
    sadaTs: SADA,
  });
  assert.equal(s.nalog.paket, "Gold");
  assert.equal(s.nalog.paket_istice_za_dana, 90);
  assert.equal(s.nalog.krediti, 2000);
  assert.equal(s.kvota_obnova.preostalo, 900);
  assert.equal(s.kvota_obnova.iskoristeno_procenat, 50);
  assert.equal(s.oglasi.aktivni, 4);
  assert.equal(s.oglasi.zavrseni, 302);
  assert.equal(s.cijene.na_upit, 2, "cijena 0 i price_by_agreement su 'na upit'");
  assert.equal(s.cijene.median, 200, "median samo od upotrebljivih cijena");
  assert.equal(s.sponzorisano.broj, 1);
  assert.equal(s.sponzorisano.procenat, 25);
  assert.equal(s.pregledi, null, "bez views ulaza nema pregleda bloka");
});

test("profilStatistika pronalazi neobnovljene preko praga i sortira po starosti", () => {
  const aktivni = [
    oglas({ id: 1, date: SADA - 30 * DAN, title: "najstariji" }),
    oglas({ id: 2, date: SADA - 10 * DAN, title: "stariji" }),
    oglas({ id: 3, date: SADA - DAN, title: "svjez" }),
  ];
  const s = profilStatistika({
    me: me(),
    refreshLimits: limits(),
    aktivni,
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    pragNeobnovljenoDana: 7,
  });
  assert.equal(s.neobnovljeni.length, 2, "svjez oglas ne ulazi");
  assert.equal(s.neobnovljeni[0]?.id, 1, "najstariji je prvi");
  assert.equal(s.neobnovljeni[0]?.dana_od_obnove, 30);
});

test("profilStatistika racuna preglede dnevno i vraca top i dno", () => {
  const pregledi = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    title: `Oglas ${i + 1}`,
    views: (i + 1) * 100,
    created_at: SADA - 10 * DAN,
  }));
  const s = profilStatistika({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas()],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    pregledi,
    sadaTs: SADA,
  });
  assert.ok(s.pregledi);
  assert.equal(s.pregledi.obuhvaceno, 7);
  assert.equal(s.pregledi.top[0]?.id, 7, "najvise pregleda dnevno je prvi");
  assert.equal(s.pregledi.top[0]?.pregleda_dnevno, 70, "700 pregleda kroz 10 dana");
  assert.equal(s.pregledi.dno[0]?.id, 1, "dno pocinje od najslabijeg");
});

test("konkurentIzvjestaj racuna kadencu obnove, akcije i aktivnost", () => {
  const profil: OlxPublicProfile = {
    id: 5,
    username: "Konkurent",
    type: "shop",
    shop: { package: "Platinum" },
    feedbacks: { positive: 10, negative: 2 },
    created_at: SADA - 5 * 365 * DAN,
    avg_response_time: 15,
    last_time_active_at: SADA - 3 * DAN,
  };
  const aktivni = [
    oglas({ id: 1, date: SADA - DAN, sponsored: 1, has_discount: true }),
    oglas({ id: 2, date: SADA - DAN, sponsored: 2 }),
    oglas({ id: 3, date: SADA - 20 * DAN }),
    oglas({ id: 4, date: SADA - 20 * DAN }),
  ];
  const k = konkurentIzvjestaj(profil, aktivni, 156, SADA);
  assert.equal(k.profil.paket, "Platinum");
  assert.equal(k.profil.godina_na_platformi, 5);
  assert.equal(k.profil.zadnja_aktivnost_prije_dana, 3);
  assert.equal(k.oglasi.zavrseni, 156);
  assert.equal(k.sponzorisano.broj, 2);
  assert.equal(k.sponzorisano.premium, 1);
  assert.equal(k.akcije.broj, 1);
  assert.equal(k.obnove.obnovljeno_u_48h, 2);
  assert.equal(k.obnove.procenat_48h, 50);
  assert.equal(k.obnove.median_dana_od_obnove, 10.5);
});

test("oglasIzvjestaj racuna preglede dnevno, atribute i sponzor detalje", () => {
  const listing: Listing = {
    id: 78059920,
    title: "Party veleprodaja - paleta 3000 kom",
    short_description: "Party artikli na veleprodaju",
    additional: { description: "Opis oglasa" },
    price: 1500,
    status: "active",
    available: false,
    views: 100,
    questions: 2,
    created_at: SADA - 10 * DAN,
    date: SADA - DAN,
    images: ["a.jpg", "b.jpg"],
    attributes: [
      { id: 1, name: "Gorivo", value: "Dizel" },
      { id: 2, name: "Prazan", value: "" },
    ],
    sponsored: 1,
    sponsor_active: {
      price: 54,
      sponsored_until: SADA + 6 * DAN,
      criterias: { type: 1, days: 7, refresh_every: 24 },
    },
    sponsor_scheduled: null,
  };
  const r = oglasIzvjestaj(listing, SADA);
  assert.equal(r.pregledi.dnevno, 10, "100 pregleda kroz 10 dana");
  assert.equal(r.pitanja, 2);
  assert.equal(r.dana_od_obnove, 1);
  assert.equal(r.slika_broj, 2);
  assert.equal(r.popunjenih_atributa, 1, "prazan atribut se ne broji");
  assert.equal(r.ima_podnaslov, true);
  assert.equal(r.sponzorisan, true);
  assert.equal(r.sponzor_detalji?.placeno_kredita, 54);
  assert.equal(r.sponzor_detalji?.istice_za_dana, 6);
  assert.equal(r.zakazano_izdvajanje, false);
});

test("oglasIzvjestaj za tudji oglas bez sponsor_active i bez views ne pada", () => {
  const listing: Listing = { id: 5, title: "Tudji" };
  const r = oglasIzvjestaj(listing, SADA);
  assert.equal(r.pregledi.ukupno, null);
  assert.equal(r.sponzor_detalji, null);
  assert.equal(r.na_upit, true, "bez cijene je na upit");
});

test("alarmiNaloga pali alarme na pragovima i ok kad je sve cisto", () => {
  const cisto = alarmiNaloga(me(), limits(), 0, SADA);
  assert.equal(cisto.ok, true);
  assert.equal(cisto.alarmi.length, 0);

  const losMe = me({ new_questions_count: 3, credits: 100, shop: { package: "Gold", ends_at: SADA + 5 * DAN } });
  const r = alarmiNaloga(losMe, limits(), 21, SADA);
  assert.equal(r.ok, false);
  const tipovi = r.alarmi.map((a) => a.tip).sort();
  assert.deepEqual(tipovi, ["istekli", "krediti", "paket", "pitanja"]);
  assert.equal(r.alarmi.find((a) => a.tip === "krediti")?.vrijednost, 100);
  assert.equal(r.alarmi.find((a) => a.tip === "paket")?.vrijednost, 5);
});

test("alarmiNaloga: kvota propada samo pred kraj mjeseca uz slabo koristenje", () => {
  // 2026-07-27 je 4 dana do kraja jula.
  const slabo = limits({ free_count: 100 });
  const r = alarmiNaloga(me(), slabo, 0, SADA);
  assert.equal(r.alarmi.some((a) => a.tip === "kvota_obnova"), true, "27. u mjesecu i 5.6% iskoristeno");

  // Sredina mjeseca: bez alarma iako je koristenje slabo.
  const sredina = SADA - 15 * DAN;
  const r2 = alarmiNaloga(me({ shop: { package: "Gold", ends_at: sredina + 90 * DAN } }), slabo, 0, sredina);
  assert.equal(r2.alarmi.some((a) => a.tip === "kvota_obnova"), false);
});

test("efekatIzdvajanja racuna preglede dnevno prije i tokom i faktor", () => {
  const period = { od_ts: SADA - 7 * DAN, do_ts: SADA };
  const snap = (ts: number, views: number): ViewsSnapshot => ({
    verzija: 1,
    ts,
    oglasi: [{ id: 42, views }],
  });
  const snapshoti = [
    snap(SADA - 14 * DAN, 100),
    snap(SADA - 8 * DAN, 160), // prije: 60 pregleda kroz 6 dana = 10/dan
    snap(SADA - 6 * DAN, 200),
    snap(SADA - DAN, 450), // tokom: 250 kroz 5 dana = 50/dan
  ];
  const e = efekatIzdvajanja(snapshoti, 42, period);
  assert.equal(e.prije.pregleda_dnevno, 10);
  assert.equal(e.tokom.pregleda_dnevno, 50);
  assert.equal(e.faktor, 5);
  assert.equal(e.upozorenje, null);
});

test("efekatIzdvajanja upozorava kad nema dovoljno tacaka", () => {
  const period = { od_ts: SADA - 7 * DAN, do_ts: SADA };
  const prazno = efekatIzdvajanja([], 42, period);
  assert.ok(prazno.upozorenje?.includes("Nijedan snapshot"));

  const samoJednaPrije = efekatIzdvajanja(
    [{ verzija: 1, ts: SADA - 10 * DAN, oglasi: [{ id: 42, views: 100 }] }],
    42,
    period,
  );
  assert.ok(samoJednaPrije.upozorenje?.includes("PRIJE"));
  assert.equal(samoJednaPrije.faktor, null);
});

test("kompaktList zadrzava kljucna polja i izbacuje balast", () => {
  const items = [
    oglas({ id: 9, title: "Kompakt", price: 50, sponsored: 2, has_discount: true, image: "x.jpg", images: ["x.jpg"], labels: [], user_id: 7 }),
  ];
  const k = kompaktList(items);
  assert.equal(k.length, 1);
  const stavka = k[0]!;
  assert.deepEqual(Object.keys(stavka).sort(), [
    "date",
    "has_discount",
    "id",
    "price",
    "refresh_available",
    "sponsored",
    "status",
    "title",
    "visible",
  ]);
  assert.equal(stavka.sponsored, 2);
  assert.equal(stavka.has_discount, true);
});

test("kompaktListing izbacuje user i puni category blok, a zadrzava views i sponzor polja", () => {
  const listing: Listing = {
    id: 1,
    title: "Puni",
    views: 100,
    questions: 1,
    user: { id: 7, username: "x", settings: {} },
    category: { id: 754, name: "Party dekoracije", listing_fee: 0, icon: "..." },
    images: ["a.jpg", "b.jpg", "c.jpg"],
    attributes: [{ id: 1, name: "Gorivo", value: "Dizel" }],
    sponsor_active: { price: 54 },
  };
  const k = kompaktListing(listing);
  assert.equal("user" in k, false, "user blok se izbacuje");
  assert.deepEqual(k.category, { id: 754, name: "Party dekoracije" });
  assert.equal(k.views, 100);
  assert.equal(k.slika_broj, 3);
  assert.equal(k.prva_slika, "a.jpg");
  assert.deepEqual(k.sponsor_active, { price: 54 });
});
