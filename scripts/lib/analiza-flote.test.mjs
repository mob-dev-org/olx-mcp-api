// Testovi analize flote. Isti stil kao resursi.test.mjs: node:test + node:assert/strict, sve
// ulazne strukture su konstruisane rucno (nema pravih fajlova, nema I/O), tacno prema ugovoru iz
// zadatka. Svaki nalaz tip se testira u izolaciji (jedan klon, jedan aktivan uslov).

import { test } from "node:test";
import assert from "node:assert/strict";
import { analizirajFlotu, PRAGOVI_DEFAULT } from "./analiza-flote.mjs";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

// ---- pomocnici za konstrukciju ulaza po tacnom ugovoru ----

function praznaKategorija() {
  return { bajta: 0, broj: 0 };
}

function praznoKategorije() {
  return {
    olx_pik_snapshots: praznaKategorija(),
    olx_pik_arhiva: praznaKategorija(),
    olx_pik_klijent_fajlovi: praznaKategorija(),
    olx_pik_slike: praznaKategorija(),
    olx_pik_konkurenti: praznaKategorija(),
    olx_pik_resursi: praznaKategorija(),
    olx_pik_ostalo: praznaKategorija(),
    transkripti: praznaKategorija(),
    telegram_inbox: praznaKategorija(),
    node_modules: { bajta: 50 * MB, izvor: "du" },
    dist: { bajta: 5 * MB, izvor: "du" },
    ostalo_klona: praznaKategorija(),
  };
}

function diskRed({ ts, ukupnoBajta, kategorije, greska = null }) {
  return {
    ts,
    klon: "test-klon",
    shema: 2,
    kategorije: kategorije ?? praznoKategorije(),
    ukupno_bajta: ukupnoBajta,
    novih_fajlova_broj: null,
    novih_fajlova_bajta: null,
    top_novi: [],
    trajanje_skena_ms: 100,
    cpu_klona: { pct: null, izvor: null, razlog: null },
    greska,
  };
}

function masinaRed({ ts, slobodnoBajta, swapUkupnoBajta = 4 * GB, swapKoristenoBajta = 0 }) {
  return {
    ts,
    ukupno_bajta: 16 * GB,
    slobodno_bajta: slobodnoBajta,
    swap_ukupno_bajta: swapUkupnoBajta,
    swap_koristeno_bajta: swapKoristenoBajta,
    load1: 1,
    load5: 1,
    load15: 1,
    load1_po_jezgru: 0.25,
    load5_po_jezgru: 0.25,
    load15_po_jezgru: 0.25,
    broj_jezgara: 4,
    cpu_pct: null,
    cpu_izvor: null,
    cpu_tip: null,
    psi_cpu_avg10: null,
    psi_memory_avg10: null,
    psi_io_avg10: null,
  };
}

function praznAgregat(overrides = {}) {
  return {
    period: { od: null, do: null },
    brojUzoraka: 0,
    cuvarRss: { prosjekBajta: null, peakBajta: null },
    stabloRss: { prosjekBajta: null, peakBajta: null },
    vrijemeUStrazi: { ms: 0, postotak: 0, izvor: "nepoznato" },
    hladniStartovi: { broj: 0, prosjekMs: null, maxMs: null },
    padovi: { broj: 0 },
    masina: { prosjekSlobodnoBajta: null, prosjekSwapKoristenoBajta: null, prosjekLoad1: null },
    savjeti: [],
    ...overrides,
  };
}

const PERIOD_OD = "2026-08-09T09:00:00.000Z";
const PERIOD_DO = "2026-08-12T09:00:00.000Z"; // 3 dana

// ---- 1. rast diska ----

test("rast diska: prelazi apsolutni prag, tekst sadrzi MB, % i oba GB broja", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1300 * MB });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  const n = r.nalazi.find((x) => x.kategorija === "disk" && x.tekst.includes("narastao"));
  assert.ok(n, "nalaz o rastu diska mora postojati");
  assert.equal(n.klon, "klon1");
  assert.match(n.tekst, /300 MB/);
  assert.match(n.tekst, /30%/);
  assert.match(n.tekst, /sa 1 na 1\.3 GB/); // oba GB broja prisutna (pocetni i krajnji)
});

test("rast diska: ispod OBA praga ne generise nalaz", () => {
  // 10 MB i ~1% rasta: daleko ispod defaultnih pragova (200MB / 20%)
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1010 * MB });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("narastao")).length, 0);
});

test("rast diska: skok u jednom danu naspram ravnomjernog rasta, tekstovi se razlikuju", () => {
  const bazniPragovi = { rastDiskaApsolutniMb: 200, rastDiskaPostotak: 1000 }; // iskljuci % granu

  const skokRedovi = [
    diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-10T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-11T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1500 * MB }), // sav rast u zadnjem danu
  ];
  const rSkok = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klonSkok: { diskRedovi: skokRedovi, memorijaAgregat: null } },
    pragovi: bazniPragovi,
  });
  const nSkok = rSkok.nalazi.find((x) => x.tekst.includes("narastao"));
  assert.ok(nSkok);
  assert.match(nSkok.tekst, /Skok u jednom danu \(2026-08-12\), ne ravnomjeran rast\./);

  const ravnomjerniRedovi = [
    diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-10T09:00:00.000Z", ukupnoBajta: 1150 * MB }),
    diskRed({ ts: "2026-08-11T09:00:00.000Z", ukupnoBajta: 1300 * MB }),
    diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1450 * MB }), // 3 jednaka koraka od 150 MB
  ];
  const rRavno = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klonRavno: { diskRedovi: ravnomjerniRedovi, memorijaAgregat: null } },
    pragovi: bazniPragovi,
  });
  const nRavno = rRavno.nalazi.find((x) => x.tekst.includes("narastao"));
  assert.ok(nRavno);
  assert.match(nRavno.tekst, /Ravnomjeran rast kroz period\./);

  assert.notEqual(nSkok.tekst, nRavno.tekst.replace("klonRavno", "klonSkok"));
});

// ---- 2. nova kategorija ----

test("nova kategorija: prazna na pocetku, ima sadrzaj na kraju -> nalaz", () => {
  const kategorijePrvi = praznoKategorije();
  const kategorijeZadnji = praznoKategorije();
  kategorijeZadnji.olx_pik_slike = { bajta: 20 * MB, broj: 3 };

  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijePrvi });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijeZadnji });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  const n = r.nalazi.find((x) => x.tekst.includes("olx_pik_slike"));
  assert.ok(n);
  assert.equal(n.kategorija, "disk");
  assert.equal(n.klon, "klon1");
  assert.match(n.tekst, /bila prazna, sad ima 20 MB/);
});

test("nova kategorija: node_modules i dist NE aktiviraju pravilo cak i kad skoce sa 0", () => {
  const kategorijePrvi = praznoKategorije();
  kategorijePrvi.node_modules = { bajta: 0, izvor: null };
  kategorijePrvi.dist = { bajta: 0, izvor: null };
  const kategorijeZadnji = praznoKategorije();
  kategorijeZadnji.node_modules = { bajta: 300 * MB, izvor: "du" };
  kategorijeZadnji.dist = { bajta: 40 * MB, izvor: "du" };

  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijePrvi });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijeZadnji });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("node_modules") || x.tekst.includes("dist")).length, 0);
});

// ---- 3. nikad u strazi ----

test("nikad u strazi: brojUzoraka > 0 i vrijemeUStrazi.ms === 0 -> upozorenje", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const agregat = praznAgregat({ brojUzoraka: 10, vrijemeUStrazi: { ms: 0, postotak: 0, izvor: "nepoznato" } });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregat } },
  });
  const n = r.nalazi.find((x) => x.kategorija === "sesija" && x.tekst.includes("strazi"));
  assert.ok(n);
  assert.equal(n.ozbiljnost, "upozorenje");
  assert.match(n.tekst, /OLX_SESIJA_STRAZAR/);
});

test("nikad u strazi: vrijemeUStrazi.ms > 0 ne generise nalaz", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const agregat = praznAgregat({ brojUzoraka: 10, vrijemeUStrazi: { ms: 60000, postotak: 5, izvor: "uzorci" } });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregat } },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("strazi")).length, 0);
});

// ---- 4. rast transkripta ----

test("rast transkripta: prelazi prag -> nalaz sa MB brojem i napomenom na kraju teksta", () => {
  const kategorijePrvi = praznoKategorije();
  kategorijePrvi.transkripti = { bajta: 10 * MB, broj: 5 };
  const kategorijeZadnji = praznoKategorije();
  kategorijeZadnji.transkripti = { bajta: 70 * MB, broj: 40 };

  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijePrvi });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijeZadnji });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  const n = r.nalazi.find((x) => x.kategorija === "transkripti");
  assert.ok(n);
  assert.match(n.tekst, /60 MB/);
  assert.ok(n.tekst.endsWith("(pokazatelj obima razgovora, ne mjera potrosnje tokena)."));
});

test("rast transkripta: ispod praga ne generise nalaz", () => {
  const kategorijePrvi = praznoKategorije();
  kategorijePrvi.transkripti = { bajta: 10 * MB, broj: 5 };
  const kategorijeZadnji = praznoKategorije();
  kategorijeZadnji.transkripti = { bajta: 20 * MB, broj: 8 }; // +10MB, ispod default 50MB praga

  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijePrvi });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijeZadnji });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  assert.equal(r.nalazi.filter((x) => x.kategorija === "transkripti").length, 0);
});

// ---- 5. neuspjelo skeniranje ----

test("neuspjelo skeniranje: broji greske i navodi zadnji razlog", () => {
  const redovi = [
    diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-10T09:00:00.000Z", ukupnoBajta: 1000 * MB, greska: "ENOENT prvi put" }),
    diskRed({ ts: "2026-08-11T09:00:00.000Z", ukupnoBajta: 1000 * MB }),
    diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB, greska: "EACCES permisije" }),
  ];
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: redovi, memorijaAgregat: null } },
  });
  const n = r.nalazi.find((x) => x.tekst.includes("skeniranje nije uspjelo"));
  assert.ok(n);
  assert.match(n.tekst, /2 od 4 dana \(EACCES permisije\)/);
});

test("neuspjelo skeniranje: bez gresaka ne generise nalaz", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: null } },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("skeniranje nije uspjelo")).length, 0);
});

// ---- 6. ucestali padovi ----

test("ucestali padovi: broj > 3 -> nalaz imenuje klon", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const agregat = praznAgregat({ padovi: { broj: 5 } });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregat } },
  });
  const n = r.nalazi.find((x) => x.kategorija === "sesija" && x.tekst.includes("padova"));
  assert.ok(n);
  assert.match(n.tekst, /^klon1: 5 padova sesije u periodu/);
});

test("ucestali padovi: broj <= 3 ne generise nalaz", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const agregat = praznAgregat({ padovi: { broj: 3 } });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregat } },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("padova")).length, 0);
});

// ---- 7. masina: pad slobodne memorije / rast swapa ----

test("masina: pad slobodne memorije preko praga -> nalaz na nivou flote (klon null)", () => {
  const masinaRedovi = [
    masinaRed({ ts: "2026-08-09T09:00:00.000Z", slobodnoBajta: 8 * GB }),
    masinaRed({ ts: "2026-08-10T09:00:00.000Z", slobodnoBajta: 8 * GB }),
    masinaRed({ ts: "2026-08-11T09:00:00.000Z", slobodnoBajta: 6 * GB }),
    masinaRed({ ts: "2026-08-12T09:00:00.000Z", slobodnoBajta: 6 * GB }),
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, masinaRedovi });
  const n = r.nalazi.find((x) => x.kategorija === "masina" && x.tekst.includes("slobodna memorija"));
  assert.ok(n);
  assert.equal(n.klon, null);
  assert.match(n.tekst, /2 GB/);
});

test("masina: rast udjela swapa preko praga -> nalaz na nivou flote", () => {
  const masinaRedovi = [
    masinaRed({ ts: "2026-08-09T09:00:00.000Z", slobodnoBajta: 8 * GB, swapUkupnoBajta: 4 * GB, swapKoristenoBajta: 0 }),
    masinaRed({ ts: "2026-08-10T09:00:00.000Z", slobodnoBajta: 8 * GB, swapUkupnoBajta: 4 * GB, swapKoristenoBajta: 0 }),
    masinaRed({ ts: "2026-08-11T09:00:00.000Z", slobodnoBajta: 8 * GB, swapUkupnoBajta: 4 * GB, swapKoristenoBajta: 1 * GB }),
    masinaRed({ ts: "2026-08-12T09:00:00.000Z", slobodnoBajta: 8 * GB, swapUkupnoBajta: 4 * GB, swapKoristenoBajta: 1 * GB }),
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, masinaRedovi });
  const n = r.nalazi.find((x) => x.kategorija === "masina" && x.tekst.includes("swapa"));
  assert.ok(n);
  assert.equal(n.klon, null);
  assert.match(n.tekst, /25 postotnih poena/);
});

test("masina: ispod oba praga ne generise nalaz", () => {
  const masinaRedovi = [
    masinaRed({ ts: "2026-08-09T09:00:00.000Z", slobodnoBajta: 8 * GB }),
    masinaRed({ ts: "2026-08-10T09:00:00.000Z", slobodnoBajta: 8 * GB }),
    masinaRed({ ts: "2026-08-11T09:00:00.000Z", slobodnoBajta: 7.9 * GB }),
    masinaRed({ ts: "2026-08-12T09:00:00.000Z", slobodnoBajta: 7.9 * GB }),
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, masinaRedovi });
  assert.equal(r.nalazi.filter((x) => x.kategorija === "masina").length, 0);
});

// ---- klon sa manje od 2 tacke se preskace u potpunosti ----

test("klon sa jednim diskRed-om se preskace (nema trenda)", () => {
  const jedanRed = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 5000 * MB });
  const agregat = praznAgregat({ brojUzoraka: 10, vrijemeUStrazi: { ms: 0, postotak: 0, izvor: "nepoznato" } });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { klon1: { diskRedovi: [jedanRed], memorijaAgregat: agregat } },
  });
  assert.equal(r.nalazi.length, 0);
});

// ---- nema nalaza ----

test("nema nalaza: prazna lista, tekst i sazetak su ista jedna recenica bez tabela/nabrajanja", () => {
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, masinaRedovi: [] });
  assert.deepEqual(r.nalazi, []);
  assert.equal(r.tekst, "3 dana bez promjene koja trazi paznju.");
  assert.equal(r.sazetak, "3 dana bez promjene koja trazi paznju.");
  assert.ok(!r.tekst.includes("|"));
  assert.ok(!r.tekst.includes("- "));
  assert.ok(!r.tekst.includes("#"));
});

// ---- odsijecanje sazetka na 10 ----

test("sazetak: odsijeca na 10 nalaza i dodaje 'i jos N'", () => {
  const podaciPoKlonu = {};
  for (let i = 1; i <= 12; i++) {
    const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
    const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 2000 * MB }); // svaki klon prelazi prag
    podaciPoKlonu[`klon${i}`] = { diskRedovi: [prvi, zadnji], memorijaAgregat: null };
  }
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu });
  assert.equal(r.nalazi.length, 12);
  const linijeSazetka = r.sazetak.split("\n");
  assert.equal(linijeSazetka.length, 11); // 10 nalaza + "I jos 2." linija
  assert.equal(linijeSazetka[10], "I jos 2.");
  assert.ok(!r.sazetak.includes("|"));
});

// ---- default pragovi su dostupni za override ----

test("PRAGOVI_DEFAULT sadrzi ocekivane kljuceve", () => {
  // cpuProsjekPostotak je dodan naknadno (nalaz 9, klon koji najvise trosi procesor); ovaj test je
  // pisan prije te dopune i ostao je na starom spisku, kod je bio ispravan.
  assert.deepEqual(Object.keys(PRAGOVI_DEFAULT).sort(), [
    "cpuProsjekPostotak",
    "padSlobodneMemorijeGb",
    "rastDiskaApsolutniMb",
    "rastDiskaPostotak",
    "rastSwapaPostotakPoena",
    "rastTranskriptaMb",
    "udioSkokaZaJedanDan",
  ]);
});

// ---- 9. klon koji najvise trosi procesor ----

function agregatSaCpu(cpuKlona, overrides = {}) {
  return praznAgregat({ brojUzoraka: 10, vrijemeUStrazi: { ms: 60000, postotak: 5, izvor: "uzorci" }, cpuKlona, ...overrides });
}

test("cpu klona: najveci prosjek preko praga -> nalaz imenuje pobjednika", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: {
      spor: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu({ prosjekPct: 8, peakPct: 20, cpuPodaciOd: null }) },
      brz: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu({ prosjekPct: 22.4, peakPct: 55, cpuPodaciOd: null }) },
    },
  });
  const n = r.nalazi.find((x) => x.tekst.includes("trosio najvise procesora"));
  assert.ok(n);
  assert.equal(n.klon, "brz");
  assert.equal(n.kategorija, "sesija");
  assert.match(n.tekst, /^brz: trosio najvise procesora u periodu, prosjek 22\.4% \(peak 55%\)\.$/);
});

test("cpu klona: ispod praga ne generise nalaz", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: {
      klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu({ prosjekPct: 5, peakPct: 10, cpuPodaciOd: null }) },
    },
  });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("trosio najvise procesora")).length, 0);
});

test("cpu klona: mjesoviti stari/novi format, cpuKlona:null se tiho preskace, ne baca", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: {
      "novi-cuvar": { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu({ prosjekPct: 30, peakPct: 60, cpuPodaciOd: null }) },
      "stari-cuvar": { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu(null) },
    },
  });
  const cpuNalazi = r.nalazi.filter((x) => x.tekst.includes("trosio najvise procesora"));
  assert.equal(cpuNalazi.length, 1);
  assert.equal(cpuNalazi[0].klon, "novi-cuvar");
});

test("cpu klona: svi klonovi cpuKlona:null -> nema nalaza, nema greske", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  assert.doesNotThrow(() => {
    const r = analizirajFlotu({
      periodOd: PERIOD_OD,
      periodDo: PERIOD_DO,
      podaciPoKlonu: {
        klon1: { diskRedovi: [prvi, zadnji], memorijaAgregat: agregatSaCpu(null) },
        klon2: { diskRedovi: [prvi, zadnji], memorijaAgregat: null },
      },
    });
    assert.equal(r.nalazi.filter((x) => x.tekst.includes("trosio najvise procesora")).length, 0);
  });
});

test("cpu klona: cpuPodaciOd kasniji od periodOd dodaje napomenu o djelomicnom pokrivanju", () => {
  const prvi = diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const zadnji = diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1000 * MB });
  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: {
      klon1: {
        diskRedovi: [prvi, zadnji],
        memorijaAgregat: agregatSaCpu({ prosjekPct: 40, peakPct: 60, cpuPodaciOd: "2026-08-11T00:00:00.000Z" }),
      },
    },
  });
  const n = r.nalazi.find((x) => x.tekst.includes("trosio najvise procesora"));
  assert.ok(n);
  assert.match(n.tekst, /CPU podaci dostupni tek od 2026-08-11, prosjek ne pokriva cio period\./);
});

// ---- 10. budjenja u istoj minuti ----

test("budjenja: klaster iz 2 razlicita klona u istoj minuti -> upozorenje", () => {
  const budjenja = [
    { klon: "alfa", ts: "2026-08-10T03:00:05.000Z", hladniStartMs: 5000 },
    { klon: "beta", ts: "2026-08-10T03:00:40.000Z", hladniStartMs: 6000 },
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, budjenja });
  const n = r.nalazi.find((x) => x.tekst.includes("probudilo se"));
  assert.ok(n);
  assert.equal(n.klon, null);
  assert.equal(n.kategorija, "sesija");
  assert.equal(n.ozbiljnost, "upozorenje");
  assert.match(n.tekst, /^U 03:00 2026-08-10 probudilo se 2 klonova istovremeno: alfa, beta\.$/);
});

test("budjenja: iz ISTOG klona u istoj minuti NIJE klaster", () => {
  const budjenja = [
    { klon: "alfa", ts: "2026-08-10T03:00:05.000Z", hladniStartMs: 5000 },
    { klon: "alfa", ts: "2026-08-10T03:00:40.000Z", hladniStartMs: 6000 },
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, budjenja });
  assert.equal(r.nalazi.filter((x) => x.tekst.includes("probudilo se")).length, 0);
});

test("budjenja: klaster sa CPU potvrdom masine (znacajan skok) dodaje recenicu na kraju", () => {
  const budjenja = [
    { klon: "alfa", ts: "2026-08-10T03:00:05.000Z", hladniStartMs: 5000 },
    { klon: "beta", ts: "2026-08-10T03:00:40.000Z", hladniStartMs: 6000 },
  ];
  const masinaCpuUzorci = [
    { ts: "2026-08-10T02:00:00.000Z", zauzetoPct: 5 },
    { ts: "2026-08-10T02:30:00.000Z", zauzetoPct: 5 },
    { ts: "2026-08-10T03:01:00.000Z", zauzetoPct: 60 }, // unutar +/-2min od 03:00, znacajno iznad prosjeka
    { ts: "2026-08-10T04:00:00.000Z", zauzetoPct: 5 },
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, budjenja, masinaCpuUzorci });
  const n = r.nalazi.find((x) => x.tekst.includes("probudilo se"));
  assert.ok(n);
  assert.match(n.tekst, /Uz vidljiv skok CPU-a na masini \(~60%\)\.$/);
});

test("budjenja: klaster bez CPU potvrde (masinaCpuUzorci prazan) ostaje valjan bez dodatne recenice", () => {
  const budjenja = [
    { klon: "alfa", ts: "2026-08-10T03:00:05.000Z", hladniStartMs: 5000 },
    { klon: "beta", ts: "2026-08-10T03:00:40.000Z", hladniStartMs: 6000 },
  ];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, budjenja, masinaCpuUzorci: [] });
  const n = r.nalazi.find((x) => x.tekst.includes("probudilo se"));
  assert.ok(n);
  assert.ok(!n.tekst.includes("skok CPU-a"));
});

// ---- 11. ugnijezdena kopija ----

test("ugnijezdena kopija: prazna lista -> nema nalaza", () => {
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, ugnijezdeneKopije: [] });
  assert.equal(r.nalazi.length, 0);
});

test("ugnijezdena kopija: jedan element -> tacan tekst, uvijek upozorenje", () => {
  const ugnijezdeneKopije = [{ klon: "glavni-klon", putanja: "/srv/glavni-klon/podfolder/.olx-pik" }];
  const r = analizirajFlotu({ periodOd: PERIOD_OD, periodDo: PERIOD_DO, podaciPoKlonu: {}, ugnijezdeneKopije });
  assert.equal(r.nalazi.length, 1);
  const n = r.nalazi[0];
  assert.equal(n.klon, "glavni-klon");
  assert.equal(n.kategorija, "disk");
  assert.equal(n.ozbiljnost, "upozorenje");
  assert.equal(
    n.tekst,
    "glavni-klon: pronadjena ugnijezdena kopija kod /srv/glavni-klon/podfolder/.olx-pik, provjeri da se isti klon ne broji dvaput u nadzoru.",
  );
});

// ---- kombinovan realan slucaj (za rucnu provjeru izgleda teksta) ----

test("kombinovan slucaj: vise nalaza odjednom, tekst grupise po kategoriji", () => {
  const kategorijePrvi = praznoKategorije();
  kategorijePrvi.transkripti = { bajta: 5 * MB, broj: 2 };
  const kategorijeZadnji = praznoKategorije();
  kategorijeZadnji.transkripti = { bajta: 80 * MB, broj: 30 };

  const redovi = [
    diskRed({ ts: "2026-08-09T09:00:00.000Z", ukupnoBajta: 1000 * MB, kategorije: kategorijePrvi }),
    diskRed({ ts: "2026-08-12T09:00:00.000Z", ukupnoBajta: 1400 * MB, kategorije: kategorijeZadnji }),
  ];
  const agregat = praznAgregat({ brojUzoraka: 10, vrijemeUStrazi: { ms: 0, postotak: 0, izvor: "nepoznato" } });

  const r = analizirajFlotu({
    periodOd: PERIOD_OD,
    periodDo: PERIOD_DO,
    podaciPoKlonu: { "klijent-primjer": { diskRedovi: redovi, memorijaAgregat: agregat } },
  });

  assert.ok(r.nalazi.length >= 3);
  assert.match(r.tekst, /^# Analiza flote \(2026-08-09 do 2026-08-12\)/);
  assert.match(r.tekst, /## Disk/);
  assert.match(r.tekst, /## Transkripti/);
  assert.match(r.tekst, /## Sesija/);
});
