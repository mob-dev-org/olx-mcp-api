// Testovi agregacionog sloja: sve ciste funkcije, bez mreze i bez mockova.
// "Sada" je fiksiran timestamp da rezultati budu deterministicni.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alarmiNaloga,
  danCiklusaIzIsteka,
  danaDoResetaKvote,
  danaRijec,
  efekatIzdvajanja,
  konkurentIzvjestaj,
  kompaktCsv,
  kompaktList,
  kompaktListing,
  dnevniPlanObnova,
  izracunajNoveCijene,
  limitObjave,
  median,
  mrtviOglasi,
  obuhvatIz,
  oglasIzvjestaj,
  onboardingIzvjestaj,
  ostvarivihObnova,
  pragObnove,
  profilStatistika,
  promjenaPregleda,
  provjeriNacrt,
  type OnboardingDetalj,
  type ViewsSnapshot,
} from "./stats.js";
import type {
  CategoryAttribute,
  Listing,
  ListingSummary,
  OlxPublicProfile,
  OlxUser,
  RefreshLimits,
  SviOglasi,
} from "./types.js";

// 2026-07-31 00:00 UTC, fiksno "sada" za sve testove.
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
    obuhvat: { potpuno: true, ukupno: 4, procitano: 4 },
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
    obuhvat: { potpuno: true, ukupno: 3, procitano: 3 },
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
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
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
  const k = konkurentIzvjestaj(profil, aktivni, 156, SADA, { potpuno: true, ukupno: 4, procitano: 4 });
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

  // new_questions_count NE pravi alarm: brojac je neprovjeren (0 na nalogu sa pitanjima).
  const losMe = me({ new_questions_count: 3, credits: 100, shop: { package: "Gold", ends_at: SADA + 5 * DAN } });
  const r = alarmiNaloga(losMe, limits(), 21, SADA);
  assert.equal(r.ok, false);
  const tipovi = r.alarmi.map((a) => a.tip).sort();
  assert.deepEqual(tipovi, ["istekli", "krediti", "paket"]);
  assert.equal(r.alarmi.find((a) => a.tip === "krediti")?.vrijednost, 100);
  assert.equal(r.alarmi.find((a) => a.tip === "paket")?.vrijednost, 5);
});

test("alarmiNaloga: kvota propada pred RESETOM KVOTE, ne pred krajem kalendara", () => {
  // Prije je alarm gledao kraj kalendarskog mjeseca. Sada gleda ciklus pretplate, jer se kvota
  // obnavlja po njemu (greska prijavljena 31.07.2026). Katalog je dovoljno velik da je kvota
  // uopste ostvariva, inace alarm ne bi ni imao smisla.
  const slabo = limits({ free_count: 100, listing_count: 2000 });

  // ends_at na 3. u mjesecu: od 31.07. je sljedeci reset 03.08., dakle 3 dana. Alarm se pali.
  const trecegAvgusta = Math.floor(Date.UTC(2026, 9, 3) / 1000); // 03.10.2026, dan ciklusa je 3
  const blizu = alarmiNaloga(me({ shop: { package: "Gold", ends_at: trecegAvgusta } }), slabo, 0, SADA);
  assert.equal(blizu.alarmi.some((a) => a.tip === "kvota_obnova"), true, "3 dana do reseta i slabo koristenje");
  assert.match(
    blizu.alarmi.find((a) => a.tip === "kvota_obnova")?.poruka ?? "",
    /Do obnove kvote 3 dana/,
    "poruka govori o obnovi kvote, ne o kraju kalendarskog mjeseca",
  );

  // me() nosi ends_at na 29.10., dakle dan ciklusa 29: od 31.07. je reset za 29 dana i nema alarma
  // iako je koristenje slabo. Ranije bi ovdje alarm pukao samo zato sto je 31. u mjesecu.
  const daleko = alarmiNaloga(me(), slabo, 0, SADA);
  assert.equal(daleko.alarmi.some((a) => a.tip === "kvota_obnova"), false, "29 dana do reseta nije hitno");
});

test("danaDoResetaKvote: ciklus pretplate, kratki mjeseci i reset danas", () => {
  const dan = (s: string): number => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);
  // Slucaj iz prakse: 31.07.2026. je kod javio 1 dan, a ciklus je isticao 24.08.
  assert.equal(danaDoResetaKvote(dan("2026-07-31"), 24), 24);
  // Bez poznatog ciklusa se pada na prvi u sljedecem mjesecu.
  assert.equal(danaDoResetaKvote(dan("2026-07-21")), 11);
  assert.equal(danaDoResetaKvote(dan("2026-07-31")), 1);
  // Dan 31 ne postoji u februaru, pa se steze na zadnji dan mjeseca.
  assert.equal(danaDoResetaKvote(dan("2026-01-31"), 31), 28, "januar 31 -> februar 28");
  assert.equal(danaDoResetaKvote(dan("2026-02-15"), 31), 13);
  // Reset je danas: kvota je vec obnovljena, pa vazi sljedeci ciklus.
  assert.equal(danaDoResetaKvote(dan("2026-08-24"), 24), 31);
  // ends_at daleko u buducnosti ne znaci daleki reset: mjesecnica je i dalje isti dan u mjesecu.
  assert.equal(danCiklusaIzIsteka(dan("2027-03-24")), 24, "iz isteka se uzima samo DAN");
  assert.equal(danCiklusaIzIsteka(undefined), undefined);
  assert.equal(danCiklusaIzIsteka(0), undefined);
});

test("pragObnove i ostvarivihObnova prate Razred A iz pravila brojeva", () => {
  // shop 7, PRO 21, klasicni 30 (olx://pravila-brojeva). PRO je ranije dobijao 30 i time
  // potcijenjeno ostvarivo.
  assert.equal(pragObnove(true), 7);
  assert.equal(pragObnove(false, true), 21);
  assert.equal(pragObnove(false), 30);
  assert.equal(ostvarivihObnova(100, 30, true), 400, "shop: 4 obnove po oglasu u 30 dana");
  assert.equal(ostvarivihObnova(100, 30, false, true), 100, "PRO: jedna po oglasu");
  assert.equal(ostvarivihObnova(100, 30, false), 100);
});

test("danaRijec sklanja broj dana", () => {
  assert.equal(danaRijec(1), "dan", "1 dana je odavalo da tekst pise program");
  assert.equal(danaRijec(2), "dana");
  assert.equal(danaRijec(24), "dana");
  assert.equal(danaRijec(0), "dana");
});

test("alarmiNaloga: nedostizna kvota ne alarmira (mali katalog, velika kvota)", () => {
  // 10 oglasa fizicki ne moze potrositi kvotu 1800; alarm po sirovoj kvoti bi gorio svaki
  // mjesec kao sum. Sa 100 vec potrosenih je iskoristeno iznad ostvarivog, dakle sve uredu.
  const mali = limits({ free_count: 100, listing_count: 10 });
  const r = alarmiNaloga(me(), mali, 0, SADA);
  assert.equal(r.alarmi.some((a) => a.tip === "kvota_obnova"), false);
});

test("ostvarivihObnova: cooldown po oglasu ogranicava mjesecni maksimum", () => {
  // Shop: obnova istog oglasa svakih 7 dana -> 168 oglasa x 4 = 672 u mjesecu od 30 dana.
  assert.equal(ostvarivihObnova(168, 30, true), 672);
  // U 3 dana svaki oglas najvise jednom.
  assert.equal(ostvarivihObnova(168, 3, true), 168);
  // Bez shopa obnova ide svakih 30 dana: jedna po oglasu.
  assert.equal(ostvarivihObnova(50, 30, false), 50);
  assert.equal(ostvarivihObnova(0, 30, true), 0);
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

test("dnevniPlanObnova ne trazi vise obnova nego sto shop ima oglasa", () => {
  // Slucaj vidjen na klijentskom nalogu 30.07.2026.: kvota skoro nepotrosena, shop sa nekoliko
  // stotina oglasa. Bez gornje granice je izvjestaj javio tempo veci od broja oglasa.
  const limits: RefreshLimits = { free_limit: 1800, free_count: 318, paid_count: 0, listing_count: 0 };

  const bezGranice = dnevniPlanObnova({ refreshLimits: limits, kandidata: 0, sadaTs: SADA });
  const saGranicom = dnevniPlanObnova({
    refreshLimits: limits,
    kandidata: 0,
    sadaTs: SADA,
    aktivnihOglasa: 120,
    imaShop: true,
  });
  assert.ok(saGranicom.cilj_danas <= 120, `cilj ${saGranicom.cilj_danas} ne smije preci broj oglasa`);
  assert.ok(bezGranice.cilj_danas >= saGranicom.cilj_danas, "bez granice cilj je veci ili isti");
  assert.equal(saGranicom.kvota_neostvariva, true, "1482 obnove se ne mogu potrositi sa 120 oglasa");
});

test("tempo se racuna na OSTVARIVO, ne na sirovu kvotu", () => {
  // Ovo je greska prijavljena 31.07.2026. Klijent je dobio tempo izveden iz sirove kvote
  // podijeljene na dane, a isti oglas se besplatno obnavlja tek svakih 7 dana (olx://pravila-brojeva,
  // Razred A), pa taj tempo nijedan katalog ne moze ispuniti.
  const limits: RefreshLimits = { free_limit: 1800, free_count: 318, paid_count: 0, listing_count: 0 };
  const p = dnevniPlanObnova({
    refreshLimits: limits,
    kandidata: 0,
    sadaTs: SADA,
    aktivnihOglasa: 121,
    imaShop: true,
    danCiklusa: 24, // ciklus pretplate, 24.08. je 24 dana od 31.07.
  });
  assert.equal(p.dana_do_reseta, 24, "rok ide iz ciklusa pretplate, ne iz kalendara");
  assert.equal(p.rok_poznat, true);
  // 121 oglas kroz 24 dana uz prag 7 dana: 121 * floor(24/7) = 363
  assert.equal(p.ostvarivo, 363);
  assert.ok(p.cilj_danas <= Math.ceil(121 / 7) + 1, `tempo ${p.cilj_danas} mora biti blizu odrzivih 17, ne 62`);
  assert.equal(p.kvota_neostvariva, true, "1482 preostalo je vise od 363 ostvarivih");
});

test("spor mjerenja i ciklusa se rjesava u korist ciklusa, i nesuglasje ostaje zapisano", () => {
  // Odluka od 03.08.2026: paket se placa od dana aktivacije, pa mjesecni prozor tece od tog dana,
  // ne od prvog u mjesecu. Prvo mjerenje (01.08.2026, pad potrosenog bas 1. u mjesecu) govorilo je
  // u prilog kalendaru i svjesno se tretira kao anomalija jednog prelaza. Nesuglasje ostaje u
  // `rok_izvor` da presuda 24.08. bude mjerljiva iz zapisa (IZVOR_ROKA_KVOTE u stats.ts).
  const limits: RefreshLimits = { free_limit: 1800, free_count: 318, paid_count: 0, listing_count: 0 };
  const zajedno = { refreshLimits: limits, kandidata: 0, sadaTs: SADA, aktivnihOglasa: 121, imaShop: true };

  const sporno = dnevniPlanObnova({ ...zajedno, danCiklusa: 24, izmjereniDanReseta: 1 });
  assert.equal(sporno.dana_do_reseta, 24, "u sporu vazi ciklus, ne mjerenje");
  assert.equal(sporno.rok_poznat, true, "spor je zatvoren, pa se rok izgovara");
  assert.equal(sporno.rok_izvor, "ciklus_uz_spor", "nesuglasje se biljezi, ne brise");

  const samoMjerenje = dnevniPlanObnova({ ...zajedno, izmjereniDanReseta: 1 });
  assert.equal(samoMjerenje.rok_poznat, true, "bez ciklusa je mjerenje jedini dokaz i vazi");
  assert.equal(samoMjerenje.rok_izvor, "izmjereno");

  const slazuSe = dnevniPlanObnova({ ...zajedno, danCiklusa: 24, izmjereniDanReseta: 24 });
  assert.equal(slazuSe.rok_poznat, true, "izvori koji se slazu nisu spor");
  assert.equal(slazuSe.rok_izvor, "ciklus", "mjerenje potvrdjuje ciklus, izvor ostaje ciklus");

  const ciklus = dnevniPlanObnova({ ...zajedno, danCiklusa: 24 });
  assert.equal(ciklus.dana_do_reseta, 24);
  assert.equal(ciklus.rok_izvor, "ciklus");

  const kalendar = dnevniPlanObnova({ ...zajedno });
  assert.equal(kalendar.rok_poznat, false, "bez ijednog izvora rok se ne tvrdi");
  assert.equal(kalendar.rok_izvor, "kalendar");
});

test("alarmiNaloga i onboardingIzvjestaj rok racunaju istom funkcijom kao dnevni plan", () => {
  // Isto pravilo na sva mjesta koja racunaju rok: bez toga dnevna poruka i alarm istog jutra
  // mogu reci razlicit rok, ista klasa greske koja je vec jednom sanirana.
  const slabo = limits({ free_count: 100, listing_count: 2000 });

  // Ciklus 03.08. je 3 dana od SADA, pa alarm ulazi u prozor od 7 dana. Izmjereni dan 1 se
  // razilazi sa ciklusom, ali ciklus pobjedjuje, pa se rok tvrdi bez ograde.
  const blizuCiklusa = me({ shop: { package: "Gold", ends_at: SADA + 3 * DAN } });
  const r = alarmiNaloga(blizuCiklusa, slabo, 0, SADA, {}, 1);
  const poruka = r.alarmi.find((a) => a.tip === "kvota_obnova")?.poruka ?? "";
  assert.match(poruka, /Do obnove kvote 3 dana/, "u sporu vazi ciklus i rok se tvrdi");

  // Bez shopa nema ciklusa, a bez mjerenja nema ni drugog izvora: broj dana se ne izgovara.
  const bezIzvora = alarmiNaloga(me({ shop: null }), slabo, 0, SADA, {});
  const bezRoka = bezIzvora.alarmi.find((a) => a.tip === "kvota_obnova")?.poruka ?? "";
  assert.match(bezRoka, /rok obnove kvote nije poznat/, "nepoznat rok se ne pretvara u broj dana");
  assert.doesNotMatch(bezRoka, /\d+ dana/, "kalendarska pretpostavka ne izlazi kao broj dana");

  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits({ free_limit: 1800, free_count: 1300 }),
    aktivni: [oglas()],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    izmjereniDanReseta: 1,
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
  });
  assert.equal(i.besplatne_obnove.dana_do_reseta, 29, "u sporu vazi ciklus 29, ne mjerenje 1");
  assert.equal(i.besplatne_obnove.rok_poznat, true);

  // Bez ikakvog izvora onboarding ne smije prikazati kalendarski broj kao rok.
  const bezRokaOnb = onboardingIzvjestaj({
    me: me({ shop: null }),
    refreshLimits: limits({ free_limit: 1800, free_count: 1300 }),
    aktivni: [oglas()],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
  });
  assert.equal(bezRokaOnb.besplatne_obnove.dana_do_reseta, null, "nepoznat rok je null, ne broj");
  assert.equal(bezRokaOnb.besplatne_obnove.rok_poznat, false);
  assert.ok(bezRokaOnb.besplatne_obnove.preporuceno_dnevno > 0, "tempo se i dalje racuna, nad 30 dana");
});

test("dnevniPlanObnova ne javlja neostvarivu kvotu kad je ona ostvariva", () => {
  const limits: RefreshLimits = { free_limit: 1800, free_count: 0, paid_count: 0, listing_count: 0 };
  // Pocetak mjeseca: SADA je 31.07., pa 29 dana ranije daje 02.07.
  const pocetakMjeseca = SADA - 29 * DAN;
  const p = dnevniPlanObnova({
    refreshLimits: limits,
    kandidata: 50,
    sadaTs: pocetakMjeseca,
    aktivnihOglasa: 500,
    imaShop: true,
    ritam: { strategija: "ravnomjerno", kada: "2026-07-01T00:00:00.000Z" },
  });
  assert.equal(p.kvota_neostvariva, false, "500 oglasa kroz mjesec uz prag 7 dana pokrije 1800");
  assert.equal(p.za_obnovu, Math.min(p.cilj_danas, 50), "za_obnovu ostaje manji od cilja i kandidata");

  // Bez shopa je prag 30 dana, pa isti katalog kvotu NE moze potrositi.
  const bezShopa = dnevniPlanObnova({
    refreshLimits: limits,
    kandidata: 50,
    sadaTs: pocetakMjeseca,
    aktivnihOglasa: 500,
    imaShop: false,
  });
  assert.equal(bezShopa.kvota_neostvariva, true, "prag 30 dana znaci samo jedna obnova po oglasu");
});

test("ritam trgovca mijenja dnevni cilj", () => {
  const limits: RefreshLimits = { free_limit: 1800, free_count: 318, paid_count: 0, listing_count: 0 };
  const zajedno = { refreshLimits: limits, kandidata: 200, sadaTs: SADA, aktivnihOglasa: 121, imaShop: true, danCiklusa: 24 };

  const ravnomjerno = dnevniPlanObnova({ ...zajedno, ritam: { strategija: "ravnomjerno" } });
  const sve = dnevniPlanObnova({ ...zajedno, ritam: { strategija: "sve-dostupno" } });
  const interval = dnevniPlanObnova({ ...zajedno, ritam: { strategija: "interval", dana: 7 } });

  assert.equal(sve.cilj_danas, 121, "sve-dostupno ide do broja oglasa, granica je samo kvota");
  assert.equal(interval.cilj_danas, Math.ceil(121 / 7), "interval dijeli katalog na dane intervala");
  assert.ok(ravnomjerno.cilj_danas < sve.cilj_danas, "ravnomjerno je uzdrzanije od sve-dostupno");
  assert.equal(ravnomjerno.ritam, "ravnomjerno", "ritam ide u izvjestaj da klijent zna po cemu se radi");
});

test("kompaktCsv nosi ista polja kao kompaktList, uz zaglavlje i jedan red po oglasu", () => {
  const items = [
    oglas({ id: 9, title: "Kompakt", price: 50, sponsored: 2, has_discount: true }),
    oglas({ id: 10, title: "Drugi", price: 70 }),
  ];
  const csv = kompaktCsv(items);
  const redovi = csv.split("\n");
  assert.equal(redovi.length, 3, "zaglavlje plus dva oglasa");
  assert.equal(redovi[0], "id,title,price,sponsored,date,refresh_available,status,visible,has_discount");
  // Isti broj kolona u svakom redu, inace bi CSV bio neupotrebljiv.
  const kolona = redovi[0]!.split(",").length;
  for (const r of redovi) assert.equal(r.split(",").length, kolona);
  assert.ok(redovi[1]!.startsWith("9,Kompakt,50,2,"));
  // boolean ide kao 1/0, ne true/false
  assert.ok(redovi[1]!.endsWith(",1"), "has_discount true mora biti 1");
  assert.ok(redovi[2]!.endsWith(",0"), "has_discount false mora biti 0");
});

test("kompaktCsv citira naslov sa zapetom i navodnikom, da red ne pukne", () => {
  const csv = kompaktCsv([oglas({ id: 1, title: 'Golf 7, "GTD" varijanta', price: 100 })]);
  const red = csv.split("\n")[1]!;
  assert.ok(red.includes('"Golf 7, ""GTD"" varijanta"'), `naslov nije ispravno citiran: ${red}`);
  // Poslije citiranja red i dalje ima tacno onoliko kolona koliko zaglavlje.
  const bezCitata = red.replace(/"(?:[^"]|"")*"/g, "X");
  assert.equal(bezCitata.split(",").length, csv.split("\n")[0]!.split(",").length);
});

test("kompaktCsv na praznoj listi vraca samo zaglavlje", () => {
  assert.equal(kompaktCsv([]), "id,title,price,sponsored,date,refresh_available,status,visible,has_discount");
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

// ===== onboarding izvjestaj =====

function detalj(overrides: Partial<OnboardingDetalj> = {}): OnboardingDetalj {
  return {
    id: 1,
    title: "Testni oglas",
    views: 50,
    questions: 1,
    created_at: SADA - 10 * DAN,
    slika_broj: 5,
    ima_podnaslov: true,
    opis_znakova: 500,
    atributa: 3,
    ...overrides,
  };
}

test("onboardingIzvjestaj racuna preostale besplatne obnove i preporuku po danu", () => {
  // 31.07. je zadnji dan mjeseca, pa ostaje samo taj jedan dan.
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits({ free_limit: 1800, free_count: 1300 }),
    aktivni: [oglas()],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
  });
  assert.equal(i.besplatne_obnove.preostalo, 500);
  // me() nosi shop.ends_at na SADA + 90 dana, dakle 29.10.2026: dan ciklusa je 29, pa je od
  // 31.07. sljedeca obnova kvote 29.08. Rok NIJE 1 dan, kako je kalendarski racun tvrdio.
  assert.equal(i.besplatne_obnove.dana_do_reseta, 29);
  assert.equal(i.besplatne_obnove.rok_poznat, true);
  // Jedan aktivan oglas uz prag 7 dana ne moze primiti 500 obnova; preporuka je zato 1, ne 500.
  assert.equal(i.besplatne_obnove.preporuceno_dnevno, 1);
  assert.equal(i.besplatne_obnove.propusteno_procenat, 27.8);

  // Sredina mjeseca, da se vidi da se preporuka stvarno dijeli na preostale dane.
  const sredina = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits({ free_limit: 1800, free_count: 1300 }),
    aktivni: [oglas()],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA - 10 * DAN,
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
  });
  assert.equal(sredina.besplatne_obnove.dana_do_reseta, 8, "od 21.07. do reseta 29.07. je 8 dana");
  assert.equal(sredina.besplatne_obnove.preporuceno_dnevno, 1, "jedan oglas ne moze vise od jedne obnove dnevno");
});

test("onboardingIzvjestaj radi i bez detalja o oglasima, ali tada nema ucinka", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1, title: "Kratko" }), oglas({ id: 2, title: "Dovoljno dug naslov za pretragu OLX" })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 2, procitano: 2 },
  });
  assert.equal(i.ucinak, null, "bez detalja nema sekcije ucinka");
  const kratki = i.higijena.find((h) => h.kljuc === "naslov_kratak");
  assert.equal(kratki?.broj, 1, "samo jedan naslov je kraci od 30 znakova");
  assert.deepEqual(kratki?.primjeri, [{ id: 1, title: "Kratko" }]);
});

test("onboardingIzvjestaj hvata higijenu iz detalja i sortira nalaze po broju", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1 }), oglas({ id: 2 }), oglas({ id: 3 })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    detalji: [
      detalj({ id: 1, slika_broj: 0, ima_podnaslov: false, opis_znakova: 10, atributa: 0 }),
      detalj({ id: 2, slika_broj: 1, ima_podnaslov: false, opis_znakova: 50 }),
      detalj({ id: 3 }),
    ],
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 3, procitano: 3 },
  });
  const po = Object.fromEntries(i.higijena.map((h) => [h.kljuc, h.broj]));
  assert.equal(po.bez_slike, 1);
  assert.equal(po.malo_slika, 1);
  assert.equal(po.bez_podnaslova, 2);
  assert.equal(po.opis_kratak, 2);
  assert.equal(po.bez_atributa, 1);
  const brojevi = i.higijena.map((h) => h.broj);
  assert.deepEqual(brojevi, [...brojevi].sort((a, b) => b - a), "nalazi su sortirani opadajuce");
});

test("onboardingIzvjestaj razlikuje oglas bez pregleda od gledanog bez upita", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1 }), oglas({ id: 2 }), oglas({ id: 3 })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    detalji: [
      detalj({ id: 1, views: 0, created_at: SADA - 40 * DAN }),
      detalj({ id: 2, views: 0, created_at: SADA - 5 * DAN }),
      detalj({ id: 3, views: 400, questions: 0, created_at: SADA - 20 * DAN }),
    ],
    detaljiTs: SADA - 2 * DAN,
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 3, procitano: 3 },
  });
  assert.ok(i.ucinak);
  assert.equal(i.ucinak.bez_pregleda_30_dana.broj, 1, "mladji od 30 dana se ne racuna");
  assert.equal(i.ucinak.gledani_bez_upita.broj, 1);
  assert.equal(i.ucinak.podaci_stari_dana, 2);
  assert.equal(i.ucinak.top[0]?.id, 3, "najvise pregleda dnevno je na vrhu");
});

test("onboardingIzvjestaj slaze prve poteze tako da besplatno ide prvo", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits({ free_limit: 1800, free_count: 100 }),
    aktivni: [oglas({ id: 1, title: "Kratko" })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    detalji: [detalj({ id: 1, views: 0, created_at: SADA - 60 * DAN })],
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 1, procitano: 1 },
  });
  assert.equal(i.prvi_potezi[0]?.kosta, "besplatno");
  assert.deepEqual(
    i.prvi_potezi.map((p) => p.redoslijed),
    i.prvi_potezi.map((_, idx) => idx + 1),
    "redoslijed je neprekinut niz od jedan",
  );
  assert.equal(i.prvi_potezi.at(-1)?.kosta, "krediti", "trosak kredita ide zadnji");
});

test("onboardingIzvjestaj cita limit oglasa iz nedokumentovanog oblika odgovora", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1 }), oglas({ id: 2 })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    listingLimits: { listing_limit: 500 },
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 2, procitano: 2 },
  });
  assert.equal(i.nalog.limit_oglasa, 500);
  assert.equal(i.nalog.popunjenost_procenat, 0.4);
});

test("onboardingIzvjestaj ne izmislja higijenu kad snapshot verzije 1 nema ta polja", () => {
  // Regresija: snapshoti verzije 1 nose samo views, questions i date. Ako se odsustvo polja
  // tretira kao nula, izvjestaj tvrdi da SVI oglasi nemaju sliku ni opis, sto je neistina koja
  // bi otisla klijentu u prvom izvjestaju.
  const stari: OnboardingDetalj[] = [
    { id: 1, title: "Stari zapis", views: 100, questions: 0, created_at: SADA - 10 * DAN },
    { id: 2, title: "Drugi", views: 5, questions: 0, created_at: SADA - 10 * DAN },
  ];
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1, title: "Dovoljno dug naslov da ne pada na kratko" }), oglas({ id: 2, title: "Isto dovoljno dug naslov ovdje" })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    detalji: stari,
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 2, procitano: 2 },
  });
  assert.equal(i.higijena_provjerena, false, "stari snapshot ne nosi polja za higijenu");
  const kljucevi = i.higijena.map((h) => h.kljuc);
  for (const k of ["bez_slike", "malo_slika", "bez_podnaslova", "opis_kratak", "bez_atributa"]) {
    assert.equal(kljucevi.includes(k), false, `${k} se ne smije prijaviti bez podataka`);
  }
  assert.ok(i.ucinak, "pregledi iz starog snapshota se i dalje koriste");
});

test("onboardingIzvjestaj provjerava higijenu samo na oglasima koji imaju podatak", () => {
  const i = onboardingIzvjestaj({
    me: me(),
    refreshLimits: limits(),
    aktivni: [oglas({ id: 1 }), oglas({ id: 2 })],
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    detalji: [
      detalj({ id: 1, slika_broj: 0 }),
      // Drugi oglas nije obradjen do kraja i nema slika_broj; ne smije se racunati kao bez slike.
      { id: 2, title: "Nepotpun", views: 10, created_at: SADA - 10 * DAN },
    ],
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: 2, procitano: 2 },
  });
  assert.equal(i.higijena_provjerena, true, "bar jedan oglas ima podatak");
  assert.equal(i.higijena.find((h) => h.kljuc === "bez_slike")?.broj, 1, "samo oglas sa poznatim brojem slika");
});

// ===== provjera nacrta oglasa =====

const ATRIBUTI: CategoryAttribute[] = [
  { id: 1, name: "stanje", display_name: "Stanje", options: ["Novo", "Polovno"], required: true },
  { id: 2, name: "boja", display_name: "Boja", options: ["Crna", "Bijela"], required: false },
  { id: 3, name: "napomena", display_name: "Napomena", required: false },
];

test("provjeriNacrt zaustavlja objavu kad obavezan atribut nedostaje", () => {
  const p = provjeriNacrt({ title: "Dovoljno dug naslov za ovaj testni oglas" }, ATRIBUTI);
  assert.equal(p.spreman, false);
  assert.equal(p.nedostaju_obavezni.length, 1);
  assert.equal(p.nedostaju_obavezni[0]?.naziv, "Stanje");
  assert.deepEqual(p.nedostaju_obavezni[0]?.dozvoljeno, ["Novo", "Polovno"]);
});

test("provjeriNacrt hvata predug naslov jer API preko 65 znakova vraca 422", () => {
  const p = provjeriNacrt(
    { title: "x".repeat(66), attributes: [{ id: 1, value: "Novo" }] },
    ATRIBUTI,
  );
  assert.equal(p.spreman, false);
  assert.match(p.greske.find((g) => g.polje === "title")?.problem ?? "", /66 znakova/);
});

test("provjeriNacrt odbija vrijednost koja nije u popisu opcija", () => {
  const p = provjeriNacrt(
    { title: "Dovoljno dug naslov za ovaj testni oglas", attributes: [{ id: 1, value: "Malo koristeno" }] },
    ATRIBUTI,
  );
  assert.equal(p.spreman, false);
  const g = p.greske.find((x) => x.polje === "attribute:1");
  assert.deepEqual(g?.dozvoljeno, ["Novo", "Polovno"]);
});

test("provjeriNacrt prijavljuje atribut koji kategorija ne poznaje", () => {
  const p = provjeriNacrt(
    {
      title: "Dovoljno dug naslov za ovaj testni oglas",
      attributes: [
        { id: 1, value: "Novo" },
        { id: 999, value: "nesto" },
      ],
    },
    ATRIBUTI,
  );
  assert.equal(p.spreman, false);
  assert.match(p.greske.find((g) => g.polje === "attribute:999")?.problem ?? "", /ne postoji u ovoj kategoriji/);
});

test("provjeriNacrt razlikuje upozorenja od gresaka i pusta oglas dalje", () => {
  const p = provjeriNacrt(
    { title: "Kratko", attributes: [{ id: 1, value: "Novo" }] },
    ATRIBUTI,
  );
  assert.equal(p.spreman, true, "kratak naslov i prazan opis ne rusе objavu");
  const polja = p.upozorenja.map((u) => u.polje).sort();
  assert.deepEqual(polja, ["description", "price", "short_description", "title"]);
});

test("provjeriNacrt je zadovoljan kad je sve popunjeno", () => {
  const p = provjeriNacrt(
    {
      title: "HTZ radne cipele zastitna obuca S3, komplet",
      short_description: "Radna obuca sa celicnom kapicom",
      description: "x".repeat(150),
      price: 100,
      attributes: [
        { id: 1, value: "Novo" },
        { id: 2, value: "Crna" },
      ],
    },
    ATRIBUTI,
  );
  assert.equal(p.spreman, true);
  assert.equal(p.greske.length, 0);
  assert.equal(p.upozorenja.length, 0);
});

// ===== dnevni plan i prirast pregleda =====

test("dnevniPlanObnova rasporedjuje ostvarivo na preostale dane i staje na broju kandidata", () => {
  // Bez `aktivnihOglasa` nema stropa ni ostvarivog, pa se pada na sirovu kvotu kroz dane. Tada se
  // rok NE smije izgovoriti korisniku, jer je kraj kalendarskog mjeseca samo pretpostavka.
  const ODLUCEN = { strategija: "ravnomjerno", kada: "2026-07-01T00:00:00.000Z" } as const;
  const puno = dnevniPlanObnova({
    refreshLimits: limits({ free_limit: 1800, free_count: 800 }),
    kandidata: 500,
    sadaTs: SADA - 10 * DAN,
    ritam: ODLUCEN,
  });
  assert.equal(puno.dana_do_reseta, 11);
  assert.equal(puno.rok_poznat, false, "bez ciklusa pretplate rok nije poznat");
  assert.equal(puno.cilj_danas, 91, "1000 kroz 11 dana");
  assert.equal(puno.za_obnovu, 91);

  const malo = dnevniPlanObnova({
    refreshLimits: limits({ free_limit: 1800, free_count: 800 }),
    kandidata: 20,
    sadaTs: SADA - 10 * DAN,
    ritam: ODLUCEN,
  });
  assert.equal(malo.za_obnovu, 20, "ne moze se obnoviti vise nego sto ima kandidata");

  const potroseno = dnevniPlanObnova({
    refreshLimits: limits({ free_limit: 1800, free_count: 1800 }),
    kandidata: 500,
    sadaTs: SADA,
  });
  assert.equal(potroseno.cilj_danas, 0);
  assert.equal(potroseno.za_obnovu, 0);
});

test("promjenaPregleda racuna prirast izmedju dva snimka i preskace nove oglase", () => {
  const snapshoti: ViewsSnapshot[] = [
    {
      verzija: 2,
      ts: SADA - 7 * DAN,
      oglasi: [
        { id: 1, title: "Raste", views: 100 },
        { id: 2, title: "Miruje", views: 50 },
      ],
    },
    {
      verzija: 2,
      ts: SADA,
      oglasi: [
        { id: 1, title: "Raste", views: 180 },
        { id: 2, title: "Miruje", views: 50 },
        { id: 3, title: "Nov oglas", views: 20 },
      ],
    },
  ];
  const p = promjenaPregleda(snapshoti, SADA, 7);
  assert.ok(p);
  assert.equal(p.dana, 7);
  assert.equal(p.obuhvaceno, 2, "nov oglas nema raniju tacku pa se ne racuna");
  assert.equal(p.ukupan_prirast, 80);
  assert.equal(p.rastu[0]?.id, 1);
  assert.equal(p.miruju.length, 1);
  assert.equal(p.miruju[0]?.id, 2);
});

test("promjenaPregleda vraca null kad postoji samo jedan snimak", () => {
  assert.equal(promjenaPregleda([{ verzija: 2, ts: SADA, oglasi: [{ id: 1, views: 10 }] }], SADA, 7), null);
  assert.equal(promjenaPregleda([], SADA, 7), null);
});

// ===== grupna promjena cijene =====

test("izracunajNoveCijene racuna postotak, fiksno i postavi", () => {
  const oglasi = [
    { id: 1, title: "Prvi", price: 100 },
    { id: 2, title: "Drugi", price: 250 },
  ];
  const postotak = izracunajNoveCijene(oglasi, { vrsta: "postotak", iznos: -10 });
  assert.deepEqual(
    postotak.stavke.map((s) => [s.stara, s.nova, s.razlika]),
    [[100, 90, -10], [250, 225, -25]],
  );
  assert.equal(postotak.prosjecna_promjena_procenat, -10);

  const fiksno = izracunajNoveCijene(oglasi, { vrsta: "fiksno", iznos: 15 });
  assert.deepEqual(fiksno.stavke.map((s) => s.nova), [115, 265]);

  const postavi = izracunajNoveCijene(oglasi, { vrsta: "postavi", iznos: 199 });
  assert.deepEqual(postavi.stavke.map((s) => s.nova), [199, 199]);
});

test("izracunajNoveCijene preskace oglase bez cijene i one koji bi pali ispod minimuma", () => {
  const p = izracunajNoveCijene(
    [
      { id: 1, title: "Bez cijene" },
      { id: 2, title: "Nula", price: 0 },
      { id: 3, title: "Skoro besplatan", price: 2 },
      { id: 4, title: "Normalan", price: 100 },
    ],
    { vrsta: "postotak", iznos: -90 },
  );
  assert.equal(p.stavke.length, 1, "samo normalan oglas prolazi");
  assert.equal(p.stavke[0]?.id, 4);
  const razlozi = Object.fromEntries(p.preskoceno.map((x) => [x.id, x.razlog]));
  assert.match(razlozi[1] ?? "", /nema upotrebljivu cijenu/);
  assert.match(razlozi[2] ?? "", /nema upotrebljivu cijenu/);
  assert.match(razlozi[3] ?? "", /ispod minimuma/);
});

test("izracunajNoveCijene ne prijavljuje izmjenu kad se cijena ne mijenja", () => {
  const p = izracunajNoveCijene([{ id: 1, title: "Isti", price: 100 }], { vrsta: "postavi", iznos: 100 });
  assert.equal(p.stavke.length, 0);
  assert.match(p.preskoceno[0]?.razlog ?? "", /ne bi promijenila/);
});

// ===== mrtvi oglasi =====

test("mrtviOglasi hvata oglas sa mnogo pregleda ali bez prirasta, sto stara mjera promasi", () => {
  // Kljucna razlika: oglas 1 ima 500 pregleda ukupno, pa ga `views === 0` provjera ne vidi,
  // iako u posmatranom periodu nije dobio nijedan nov pregled.
  const snapshoti: ViewsSnapshot[] = [
    {
      verzija: 2,
      ts: SADA - 60 * DAN,
      oglasi: [
        { id: 1, title: "Nekad popularan", views: 500 },
        { id: 2, title: "Jos raste", views: 40 },
      ],
    },
    {
      verzija: 2,
      ts: SADA,
      oglasi: [
        { id: 1, title: "Nekad popularan", views: 500 },
        { id: 2, title: "Jos raste", views: 95 },
      ],
    },
  ];
  const r = mrtviOglasi(snapshoti, SADA, 60);
  assert.ok(r);
  assert.equal(r.oglasi.length, 1);
  assert.equal(r.oglasi[0]?.id, 1);
  assert.equal(r.oglasi[0]?.ukupno_pregleda, 500, "ukupan broj se prenosi da se vidi da nije nikad bio mrtav");
  assert.equal(r.period_dana, 60);
});

test("mrtviOglasi vraca null umjesto da cijeli katalog proglasi mrtvim bez podataka", () => {
  assert.equal(mrtviOglasi([], SADA, 60), null);
  assert.equal(mrtviOglasi([{ verzija: 2, ts: SADA, oglasi: [{ id: 1, views: 0 }] }], SADA, 60), null);
});

test("dnevniPlanObnova ne obnavlja nista dok klijent ne kaze svoj ritam", () => {
  // Odluka vlasnika 04.08.2026: automatske obnove nisu default. Bez zapisanog ritma
  // (`kada` prazno) posao ne dira nista, a cilj se i dalje racuna da poruka moze reci
  // koliko bi se danas moglo.
  const ulaz = {
    refreshLimits: { free_limit: 1800, free_count: 300, paid_count: 0, listing_count: 0 },
    kandidata: 40,
    sadaTs: SADA,
    aktivnihOglasa: 120,
    imaShop: true,
  };
  const bezOdluke = dnevniPlanObnova(ulaz);
  assert.equal(bezOdluke.obnove_stanje, "ceka_odluku");
  assert.equal(bezOdluke.za_obnovu, 0, "bez odluke se nista ne obnavlja");
  assert.ok(bezOdluke.cilj_danas > 0, "cilj se i dalje racuna, za tekst pitanja");

  const iskljucio = dnevniPlanObnova({ ...ulaz, ritam: { strategija: "iskljuceno", kada: "2026-08-01T00:00:00.000Z" } });
  assert.equal(iskljucio.obnove_stanje, "iskljuceno");
  assert.equal(iskljucio.za_obnovu, 0);
  assert.equal(iskljucio.cilj_danas, 0);

  const odlucio = dnevniPlanObnova({ ...ulaz, ritam: { strategija: "ravnomjerno", kada: "2026-08-01T00:00:00.000Z" } });
  assert.equal(odlucio.obnove_stanje, "auto");
  assert.ok(odlucio.za_obnovu > 0, "sa odlukom obnove rade kao i prije");
});

test("limitObjave cita omotan i goli oblik jednako i racuna status po pragu", () => {
  const goli = {
    cars: { limit: 0, unlimited: true, listings: 0 },
    "real-estate": { limit: 0, unlimited: true, listings: 0 },
    "car-parts": { limit: 2000, unlimited: false, listings: 0 },
    other: { limit: 2000, unlimited: false, listings: 140 },
  };
  const omotan = { data: goli };

  const izGolog = limitObjave(goli);
  const izOmotanog = limitObjave(omotan);
  assert.deepEqual(izGolog, izOmotanog, "omotan i goli oblik daju isto");

  // Abecedno sortiranje: car-parts, cars, other, real-estate.
  assert.deepEqual(izGolog.map((g) => g.grupa), ["car-parts", "cars", "other", "real-estate"]);

  const cars = izGolog.find((g) => g.grupa === "cars");
  assert.equal(cars?.unlimited, true);
  assert.equal(cars?.preostalo, null);
  assert.equal(cars?.iskoristeno_procenat, null);
  assert.equal(cars?.status, "slobodno");

  const other = izGolog.find((g) => g.grupa === "other");
  assert.equal(other?.iskoristeno_procenat, 7, "140/2000 = 7%");
  assert.equal(other?.status, "slobodno");

  const carParts = izGolog.find((g) => g.grupa === "car-parts");
  assert.equal(carParts?.status, "slobodno", "0/2000 je daleko od praga");
  assert.equal(carParts?.preostalo, 2000);
});

test("limitObjave: limit 0 i unlimited false je nepoznat limit, ne dostignut", () => {
  const nepoznat = limitObjave({ x: { limit: 0, unlimited: false, listings: 5 } });
  assert.equal(nepoznat[0]?.status, "slobodno");
  assert.equal(nepoznat[0]?.preostalo, null);
  assert.equal(nepoznat[0]?.iskoristeno_procenat, null);
});

test("limitObjave prepoznaje blizu_limita na granici i preko, i dostignut", () => {
  const tacnoGranica = limitObjave({ x: { limit: 100, unlimited: false, listings: 90 } });
  assert.equal(tacnoGranica[0]?.status, "blizu_limita", "tacno 90% je vec blizu_limita");

  const iznadGranice = limitObjave({ x: { limit: 100, unlimited: false, listings: 95 } });
  assert.equal(iznadGranice[0]?.status, "blizu_limita");

  const dostignuto = limitObjave({ x: { limit: 100, unlimited: false, listings: 100 } });
  assert.equal(dostignuto[0]?.status, "dostignut");
  assert.equal(dostignuto[0]?.preostalo, 0);

  const preko = limitObjave({ x: { limit: 100, unlimited: false, listings: 110 } });
  assert.equal(preko[0]?.status, "dostignut");
  assert.equal(preko[0]?.preostalo, 0, "preostalo se ne spusta ispod nule");
});

test("limitObjave vraca prazan niz na neupotrebljiv ulaz", () => {
  assert.deepEqual(limitObjave(undefined), []);
  assert.deepEqual(limitObjave(null), []);
  assert.deepEqual(limitObjave(42), []);
  assert.deepEqual(limitObjave({}), []);
});

test("profilStatistika: objava_limit je prazan bez listingLimits, a kandidati_predlog izostaje kad je sve slobodno", () => {
  const aktivni = [oglas({ id: 1 })];
  const s = profilStatistika({
    me: me(),
    refreshLimits: limits(),
    aktivni,
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    obuhvat: { potpuno: true, ukupno: aktivni.length, procitano: aktivni.length },
  });
  assert.deepEqual(s.objava_limit, []);
  assert.equal(s.objava_kandidati_predlog, undefined);
});

test("profilStatistika: objava_kandidati_predlog se emituje i jednak je neobnovljeni kad je grupa dostignuta", () => {
  const aktivni = [
    oglas({ id: 1, date: SADA - 30 * DAN, title: "najstariji" }),
    oglas({ id: 2, date: SADA - DAN, title: "svjez" }),
  ];
  const listingLimits = { other: { limit: 10, unlimited: false, listings: 10 } };
  const s = profilStatistika({
    me: me(),
    refreshLimits: limits(),
    aktivni,
    ukupno: { istekli: 0, skriveni: 0, neaktivni: 0, zavrseni: 0 },
    sadaTs: SADA,
    listingLimits,
    obuhvat: { potpuno: true, ukupno: aktivni.length, procitano: aktivni.length },
  });
  assert.equal(s.objava_limit[0]?.status, "dostignut");
  assert.deepEqual(s.objava_kandidati_predlog, s.neobnovljeni);
});

test("alarmiNaloga: paket ima tri nivoa i stari paketDana mijenja samo srednji", () => {
  const nivo = (dana: number) =>
    alarmiNaloga(me({ shop: { package: "Gold", ends_at: SADA + dana * DAN } }), limits(), 0, SADA).alarmi.find(
      (a) => a.tip === "paket",
    );

  assert.equal(nivo(40), undefined, "40 dana je ispod svih pragova, nema alarma");
  assert.equal(nivo(20)?.nivo, "info");
  assert.equal(nivo(10)?.nivo, "upozorenje");
  assert.equal(nivo(2)?.nivo, "hitno");

  const istekao = alarmiNaloga(me({ shop: { package: "Gold", ends_at: SADA - 3 * DAN } }), limits(), 0, SADA).alarmi.find(
    (a) => a.tip === "paket",
  );
  assert.equal(istekao?.nivo, "hitno");
  assert.match(istekao?.poruka ?? "", /je istekao prije 3/);

  // Stari paketDana: 30 proslijedjen -> 20 dana daje "upozorenje" (dokaz da override mijenja
  // SAMO srednji prag; hitno i info ostaju default 3 i 30).
  const saStarimParametrom = alarmiNaloga(
    me({ shop: { package: "Gold", ends_at: SADA + 20 * DAN } }),
    limits(),
    0,
    SADA,
    { paketDana: 30 },
  ).alarmi.find((a) => a.tip === "paket");
  assert.equal(saStarimParametrom?.nivo, "upozorenje");
});

test("alarmiNaloga: objava_limit alarm nosi nivo po statusu grupe, i izostaje bez listingLimits", () => {
  const blizu = alarmiNaloga(me(), limits(), 0, SADA, {}, undefined, {
    other: { limit: 100, unlimited: false, listings: 95 },
  }).alarmi.find((a) => a.tip === "objava_limit");
  assert.equal(blizu?.nivo, "upozorenje");

  const dostignut = alarmiNaloga(me(), limits(), 0, SADA, {}, undefined, {
    other: { limit: 100, unlimited: false, listings: 100 },
  }).alarmi.find((a) => a.tip === "objava_limit");
  assert.equal(dostignut?.nivo, "hitno");

  const bezLimita = alarmiNaloga(me(), limits(), 0, SADA).alarmi.find((a) => a.tip === "objava_limit");
  assert.equal(bezLimita, undefined);
});

// ===== obuhvatIz =====

test("obuhvatIz prenosi potpuno, ukupno i razlog nepromijenjeno, a procitano racuna iz duzine liste", () => {
  const nepotpuno: SviOglasi = {
    oglasi: [oglas({ id: 1 }), oglas({ id: 2 })],
    potpuno: false,
    ukupno: 2500,
    procitanoStranica: 3,
    stranicaUkupno: 125,
    razlog: "budzet",
  };
  const obuhvat = obuhvatIz(nepotpuno);
  assert.equal(obuhvat.potpuno, false);
  assert.equal(obuhvat.ukupno, 2500);
  assert.equal(obuhvat.razlog, "budzet");
  // procitano prati duzinu liste, NE ukupno: bas tu se razlikuju kad je lista nepotpuna.
  assert.equal(obuhvat.procitano, 2);
  assert.notEqual(obuhvat.procitano, obuhvat.ukupno);
});
