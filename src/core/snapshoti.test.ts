// Testovi citanja i pisanja snapshota. Racunanje nad snapshotima je u stats.ts i ima svoje
// testove; ovdje se provjerava samo dodir sa diskom: da upisano moze da se procita, da se
// polovicno upisan fajl nikad ne vidi, i da jedan pokvaren fajl ne obori cijelu seriju.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  imaSnapshotaStarijihOd,
  obrisiOdbijenProlaz,
  obrisiSnapshotUToku,
  odlukaOUpisuSnimka,
  proredjiStareSnapshote,
  putanjaOdbijenogProlaza,
  putanjaSnapshotaUToku,
  SNAPSHOT_DIR,
  ucitajOdbijenProlaz,
  ucitajSnapshote,
  ucitajSnapshotUToku,
  upisiOdbijenProlaz,
  upisiSnapshot,
  upisiSnapshotUToku,
  zadnjiSnapshot,
} from "./snapshoti.js";
import type { OdbijenProlaz, SnapshotUToku } from "./snapshoti.js";
import type { ViewsSnapshot } from "./stats.js";

const SEDAM_DANA_S = 7 * 24 * 60 * 60;

function radniDir(): string {
  return mkdtempSync(join(tmpdir(), "olx-snapshoti-"));
}

function snapshot(ts: number, oglasi: ViewsSnapshot["oglasi"] = []): ViewsSnapshot {
  return { verzija: 2, ts, account: "testni-shop", oglasi };
}

test("upisiSnapshot pa ucitajSnapshote vraca isti sadrzaj", () => {
  const dir = radniDir();
  try {
    const ulaz = snapshot(Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000), [
      { id: 1, views: 120, title: "Prvi oglas", slika_broj: 4, ima_podnaslov: true, opis_znakova: 300, atributa: 6 },
      { id: 2, views: 0, title: "Drugi oglas" },
    ]);
    const putanja = upisiSnapshot(ulaz, dir);
    assert.equal(putanja, `${dir}/views-2026-08-10.json`, "ime fajla je izvedeno iz ts snapshota");
    assert.equal(existsSync(putanja), true, "fajl je na disku");

    const ucitani = ucitajSnapshote(dir);
    assert.equal(ucitani.length, 1);
    assert.deepEqual(ucitani[0], ulaz, "round-trip ne gubi ni jedno polje");
    assert.deepEqual(zadnjiSnapshot(dir), ulaz);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upisiSnapshot ne ostavlja privremeni .tmp fajl", () => {
  const dir = radniDir();
  try {
    const putanja = upisiSnapshot(snapshot(Math.floor(Date.parse("2026-08-11T03:00:00Z") / 1000)), dir);
    assert.equal(existsSync(`${putanja}.tmp`), false, "tmp je preimenovan, ne ostavljen");
    // Ni jedan drugi .tmp ostatak: backup stanja kopira ovaj folder dok pogon radi.
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.endsWith(".tmp")),
      [],
      "u folderu nema nijednog .tmp ostatka",
    );
    assert.deepEqual(readdirSync(dir), ["views-2026-08-11.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote preskace pokvaren fajl umjesto da baci", () => {
  const dir = radniDir();
  try {
    const stari = snapshot(Math.floor(Date.parse("2026-08-01T03:00:00Z") / 1000), [{ id: 1, views: 10 }]);
    const novi = snapshot(Math.floor(Date.parse("2026-08-03T03:00:00Z") / 1000), [{ id: 1, views: 40 }]);
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);
    // Presjecen upis sa starije verzije toolkita (prije tmp+rename obrasca) izgleda ovako.
    writeFileSync(join(dir, "views-2026-08-02.json"), '{"verzija":2,"ts":1754', "utf8");
    // Validan JSON ali pogresnog oblika: ni ovo ne smije uci u seriju ni oboriti citanje.
    writeFileSync(join(dir, "views-2026-08-04.json"), '{"verzija":2,"ts":"nije broj","oglasi":[]}', "utf8");

    const ucitani = ucitajSnapshote(dir);
    assert.deepEqual(
      ucitani.map((s) => s.ts),
      [stari.ts, novi.ts],
      "vracaju se samo ispravni snapshoti, hronoloski",
    );
    assert.deepEqual(zadnjiSnapshot(dir), novi);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote na nepostojecem folderu vraca praznu listu", () => {
  assert.deepEqual(ucitajSnapshote(join(tmpdir(), "olx-snapshoti-ne-postoji-nikako")), []);
  assert.equal(zadnjiSnapshot(join(tmpdir(), "olx-snapshoti-ne-postoji-nikako")), null);
});

test("zadnjiSnapshot ne otvara starije fajlove", () => {
  const dir = radniDir();
  const izvornaGreska = console.error;
  const pozivi: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    pozivi.push(args);
  };
  try {
    const stari = snapshot(Math.floor(Date.parse("2026-08-01T03:00:00Z") / 1000), [{ id: 1, views: 10 }]);
    const novi = snapshot(Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000), [{ id: 1, views: 40 }]);
    // Stariji fajl je necitljiv JSON: da je otvoren, ispisao bi na stderr.
    writeFileSync(join(dir, "views-2026-07-30.json"), '{"verzija":2,"ts":175', "utf8");
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);

    assert.deepEqual(zadnjiSnapshot(dir), novi, "vraca se najnoviji ispravan snapshot");
    assert.deepEqual(pozivi, [], "stariji (pokvareni) fajl nije ni otvaran, pa nema ispisa na stderr");
  } finally {
    console.error = izvornaGreska;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zadnjiSnapshot se vraca na prethodni fajl kad je najnoviji pokvaren", () => {
  const dir = radniDir();
  try {
    const prethodni = snapshot(Math.floor(Date.parse("2026-08-05T03:00:00Z") / 1000), [{ id: 1, views: 5 }]);
    upisiSnapshot(prethodni, dir);
    // Najnoviji po imenu, ali necitljiv JSON.
    writeFileSync(join(dir, "views-2026-08-06.json"), '{"verzija":2,"ts":175', "utf8");

    assert.deepEqual(zadnjiSnapshot(dir), prethodni, "preskace pokvaren najnoviji i vraca prethodni ispravan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom u danima izostavlja starije a zadrzava novije", () => {
  const dir = radniDir();
  try {
    const danas = new Date();
    const prijeMjesec = new Date(danas.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prijeDanZaDanom = new Date(danas.getTime() - 1 * 24 * 60 * 60 * 1000);

    const format = (d: Date) => d.toISOString().slice(0, 10);
    const stariTs = Math.floor(Date.parse(`${format(prijeMjesec)}T03:00:00Z`) / 1000);
    const noviTs = Math.floor(Date.parse(`${format(prijeDanZaDanom)}T03:00:00Z`) / 1000);
    const stari = snapshot(stariTs, [{ id: 1, views: 1 }]);
    const novi = snapshot(noviTs, [{ id: 2, views: 2 }]);
    upisiSnapshot(stari, dir);
    upisiSnapshot(novi, dir);

    const ucitani = ucitajSnapshote(dir, 7);
    assert.deepEqual(ucitani.map((s) => s.ts), [novi.ts], "samo snapshot unutar 7 dana ostaje");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom ukljucuje fajl tacno na granici", () => {
  const dir = radniDir();
  try {
    const naGranici = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const datum = naGranici.toISOString().slice(0, 10);
    const ts = Math.floor(Date.parse(`${datum}T03:00:00Z`) / 1000);
    const snap = snapshot(ts, [{ id: 1, views: 1 }]);
    upisiSnapshot(snap, dir);

    const ucitani = ucitajSnapshote(dir, 5);
    assert.deepEqual(ucitani.map((s) => s.ts), [snap.ts], "fajl tacno na granici prozora ulazi u rezultat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshote sa prozorom koji ne obuhvata nijedan fajl vraca praznu listu", () => {
  const dir = radniDir();
  try {
    const davno = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const datum = davno.toISOString().slice(0, 10);
    const ts = Math.floor(Date.parse(`${datum}T03:00:00Z`) / 1000);
    upisiSnapshot(snapshot(ts, [{ id: 1, views: 1 }]), dir);

    assert.deepEqual(ucitajSnapshote(dir, 2), [], "prozor koji ne obuhvata nijedan fajl ne baca, vraca []");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===== radni fajl "stats snapshot" prolaza u toku =====

function radniSnapshot(preklop: Partial<SnapshotUToku> = {}): SnapshotUToku {
  return {
    pocetak: Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000),
    account: "testni-shop",
    idevi: [1, 2, 3],
    oglasi: [{ id: 1, views: 10 }],
    broj_poziva: 2,
    trajanje_ms: 500,
    ...preklop,
  };
}

test("upisiSnapshotUToku pa ucitajSnapshotUToku vraca isti sadrzaj", () => {
  const dir = radniDir();
  const putanja = join(dir, ".snapshot-u-toku.json");
  try {
    const ulaz = radniSnapshot();
    upisiSnapshotUToku(ulaz, putanja);
    assert.equal(existsSync(putanja), true, "radni fajl je na disku");
    assert.deepEqual(ucitajSnapshotUToku(putanja), ulaz, "round-trip ne gubi ni jedno polje");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upisiSnapshotUToku ne ostavlja privremeni .tmp fajl", () => {
  const dir = radniDir();
  const putanja = join(dir, ".snapshot-u-toku.json");
  try {
    upisiSnapshotUToku(radniSnapshot(), putanja);
    assert.equal(existsSync(`${putanja}.tmp`), false, "tmp je preimenovan, ne ostavljen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshotUToku na nepostojecem fajlu vraca null", () => {
  const dir = radniDir();
  try {
    assert.equal(ucitajSnapshotUToku(join(dir, "nema-ovog.json")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshotUToku na pokvarenom JSON-u vraca null umjesto da baci", () => {
  const dir = radniDir();
  const putanja = join(dir, ".snapshot-u-toku.json");
  try {
    writeFileSync(putanja, '{"pocetak":175', "utf8");
    assert.equal(ucitajSnapshotUToku(putanja), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajSnapshotUToku na validnom JSON-u pogresnog oblika vraca null", () => {
  const dir = radniDir();
  const putanja = join(dir, ".snapshot-u-toku.json");
  try {
    writeFileSync(putanja, '{"pocetak":"nije broj"}', "utf8");
    assert.equal(ucitajSnapshotUToku(putanja), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("obrisiSnapshotUToku uklanja fajl i ne baca kad fajl ne postoji", () => {
  const dir = radniDir();
  const putanja = join(dir, ".snapshot-u-toku.json");
  try {
    upisiSnapshotUToku(radniSnapshot(), putanja);
    assert.equal(existsSync(putanja), true);
    obrisiSnapshotUToku(putanja);
    assert.equal(existsSync(putanja), false, "radni fajl je uklonjen");
    assert.doesNotThrow(() => obrisiSnapshotUToku(putanja), "brisanje vec obrisanog fajla ne baca");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("putanjaSnapshotaUToku postuje OLX_SNAPSHOT_U_TOKU_FILE override", () => {
  const custom = "/tmp/neki-drugi-put/.snapshot-u-toku.json";
  assert.equal(putanjaSnapshotaUToku({ OLX_SNAPSHOT_U_TOKU_FILE: custom }), custom);
  assert.equal(
    putanjaSnapshotaUToku({}),
    `${SNAPSHOT_DIR}/.snapshot-u-toku.json`,
    "bez override-a se koristi podrazumijevana putanja pored dnevnih snapshota",
  );
});

test("ime radnog fajla ne odgovara obrascu za dnevne snapshote", () => {
  // Bijeli spisak backupa (src/core/backup-spisak.ts) prepoznaje dnevne snapshote po
  // /^views-\d{4}-\d{2}-\d{2}\.json$/. Radni fajl mora pasti izvan tog obrasca.
  const ime = putanjaSnapshotaUToku({}).split("/").pop() ?? "";
  assert.match(ime, /^\./, "ime radnog fajla pocinje tackom");
  assert.equal(/^views-\d{4}-\d{2}-\d{2}\.json$/.test(ime), false);
});

// ===== proredjiStareSnapshote =====

function pisiSnapshotDatuma(dir: string, datum: string): void {
  writeFileSync(join(dir, `views-${datum}.json`), JSON.stringify(snapshot(0)), "utf8");
}

test("proredjiStareSnapshote cuva sve snapshote novije od praga", () => {
  const dir = radniDir();
  try {
    const danas = new Date();
    const format = (d: Date) => d.toISOString().slice(0, 10);
    for (const dana of [0, 3, 10]) {
      pisiSnapshotDatuma(dir, format(new Date(danas.getTime() - dana * 24 * 60 * 60 * 1000)));
    }
    const r = proredjiStareSnapshote(dir, { pragDana: 30, gustinaDana: 7 });
    assert.deepEqual(r, { obrisano: 0, zadrzano: 3 }, "sve unutar praga ostaju, nijedno se ne dira");
    assert.equal(readdirSync(dir).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("proredjiStareSnapshote iznad praga zadrzava samo prvi u svakom bloku od gustinaDana", () => {
  const dir = radniDir();
  try {
    // Fiksni, davno prosli datumi (1970), pa su "iznad praga" bez obzira na danasnji datum.
    // Sa gustinaDana=7: dani od epohe za 01-05 je 4 (blok 0); za 01-08 je 7 (blok 1); za
    // 01-12 je 11 (blok 1, isti kao 01-08). Ocekivano: 01-05 i 01-08 (najstariji u svom bloku)
    // ostaju, 01-12 se brise jer dijeli blok sa vec zadrzanim 01-08.
    pisiSnapshotDatuma(dir, "1970-01-05");
    pisiSnapshotDatuma(dir, "1970-01-08");
    pisiSnapshotDatuma(dir, "1970-01-12");

    const r = proredjiStareSnapshote(dir, { pragDana: 30, gustinaDana: 7 });
    assert.deepEqual(r, { obrisano: 1, zadrzano: 2 });
    assert.deepEqual(
      readdirSync(dir).sort(),
      ["views-1970-01-05.json", "views-1970-01-08.json"],
      "najstariji clan svakog bloka ostaje, ostali u istom bloku se brisu",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("proredjiStareSnapshote ne dira radni fajl ni bilo koje drugo ime", () => {
  const dir = radniDir();
  try {
    pisiSnapshotDatuma(dir, "1970-01-08"); // blok 1 (najstariji, ostaje)
    pisiSnapshotDatuma(dir, "1970-01-12"); // blok 1, isti kao gore, brise se
    writeFileSync(join(dir, ".snapshot-u-toku.json"), "{}", "utf8");
    writeFileSync(join(dir, "nesto-drugo.txt"), "x", "utf8");

    const r = proredjiStareSnapshote(dir, { pragDana: 30, gustinaDana: 7 });
    assert.equal(r.obrisano, 1, "samo views-1970-01-12.json je kandidat za brisanje");
    assert.equal(existsSync(join(dir, ".snapshot-u-toku.json")), true, "radni fajl ostaje netaknut");
    assert.equal(existsSync(join(dir, "nesto-drugo.txt")), true, "nepoznato ime ostaje netaknuto");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("proredjiStareSnapshote na nepostojecem direktoriju vraca nule bez greske", () => {
  assert.deepEqual(
    proredjiStareSnapshote(join(tmpdir(), "olx-snapshoti-proredi-ne-postoji"), { pragDana: 30, gustinaDana: 7 }),
    { obrisano: 0, zadrzano: 0 },
  );
});

test("proredjiStareSnapshote: fajl koji se ne da obrisati ne prekida ciscenje ostalih", () => {
  const dir = radniDir();
  try {
    // Isti blok (1970, blok 1): 01-08 je najstariji i ostaje; 01-09 i 01-12 su kandidati za
    // brisanje. 01-09 je namjerno direktorij (ne fajl), pa unlinkSync na njemu baca; funkcija
    // ipak mora nastaviti i obrisati 01-12.
    pisiSnapshotDatuma(dir, "1970-01-08");
    mkdirSync(join(dir, "views-1970-01-09.json"));
    pisiSnapshotDatuma(dir, "1970-01-12");

    const r = proredjiStareSnapshote(dir, { pragDana: 30, gustinaDana: 7 });
    assert.equal(r.zadrzano, 1, "samo najstariji (01-08) racuna se kao zadrzan");
    assert.equal(r.obrisano, 1, "01-12 je uspjesno obrisan iako je 01-09 pukao");
    assert.equal(existsSync(join(dir, "views-1970-01-08.json")), true);
    assert.equal(existsSync(join(dir, "views-1970-01-09.json")), true, "direktorij koji se ne da obrisati ostaje");
    assert.equal(existsSync(join(dir, "views-1970-01-12.json")), false, "01-12 je obrisan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function danPrije(dana: number): string {
  return new Date(Date.now() - dana * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function napraviSnapshotFajl(dir: string, datum: string): void {
  writeFileSync(join(dir, `views-${datum}.json`), JSON.stringify({ verzija: 2, ts: 1, oglasi: [] }), "utf8");
}

test("imaSnapshotaStarijihOd: nov klon bez starijih snapshota ne pali alarm", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-stariji-nov-"));
  try {
    napraviSnapshotFajl(dir, danPrije(1));
    napraviSnapshotFajl(dir, danPrije(5));
    assert.equal(imaSnapshotaStarijihOd(60, dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("imaSnapshotaStarijihOd: prekinuta serija se prepoznaje po starijem fajlu", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-stariji-prekid-"));
  try {
    napraviSnapshotFajl(dir, danPrije(200));
    napraviSnapshotFajl(dir, danPrije(1));
    assert.equal(imaSnapshotaStarijihOd(60, dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("imaSnapshotaStarijihOd: nepostojeci folder ne baca i ne pali alarm", () => {
  assert.equal(imaSnapshotaStarijihOd(60, join(tmpdir(), "olx-nema-ovog-foldera-nikako")), false);
});

test("imaSnapshotaStarijihOd: radni fajl se ne broji kao snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-stariji-radni-"));
  try {
    writeFileSync(join(dir, ".snapshot-u-toku.json"), JSON.stringify({ pocetak: 1 }), "utf8");
    assert.equal(imaSnapshotaStarijihOd(60, dir), false, "radni fajl nema datum u imenu i ne smije se brojati");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===== SLOJ 2: odlukaOUpisuSnimka (pravi branik za issue #6) =====

const SADA = Math.floor(Date.parse("2026-08-15T06:00:00Z") / 1000);

function odbijenNalaz(over: Partial<OdbijenProlaz> = {}): OdbijenProlaz {
  return { ts: SADA, oglasa: 810, ukupno_prijavljeno: 810, account: "testni-shop", ...over };
}

test("odlukaOUpisuSnimka: nema prethodnog snimka daje upisi (nov klon, nema referenta)", () => {
  const odluka = odlukaOUpisuSnimka({ novi: 500, prethodni: null, odbijen: null, sada: SADA });
  assert.equal(odluka.akcija, "upisi");
  assert.equal(odluka.razlog, "nema_prethodnog_snimka");
  assert.equal(odluka.pad_posto, null);
});

test("odlukaOUpisuSnimka: prag pada, 19% prolazi", () => {
  // 1000 -> 810 je pad od 19%.
  const odluka = odlukaOUpisuSnimka({ novi: 810, prethodni: 1000, odbijen: null, sada: SADA });
  assert.equal(odluka.akcija, "upisi");
  assert.equal(odluka.razlog, "pad_u_granicama");
  assert.ok(Math.abs((odluka.pad_posto ?? 0) - 19) < 1e-9);
});

test("odlukaOUpisuSnimka: prag pada, 21% se odbija", () => {
  // 1000 -> 790 je pad od 21%, nema prethodnog odbijenog nalaza za poredjenje.
  const odluka = odlukaOUpisuSnimka({ novi: 790, prethodni: 1000, odbijen: null, sada: SADA });
  assert.equal(odluka.akcija, "odbij");
  assert.equal(odluka.razlog, "pad_iznad_praga");
  assert.ok(Math.abs((odluka.pad_posto ?? 0) - 21) < 1e-9);
});

test("odlukaOUpisuSnimka: rast kataloga (novi > prethodni) nikad se ne odbija", () => {
  const odluka = odlukaOUpisuSnimka({ novi: 1200, prethodni: 1000, odbijen: null, sada: SADA });
  assert.equal(odluka.akcija, "upisi");
});

test("odlukaOUpisuSnimka: odbijen pa poklapanje u granicama 2% daje upisi_potvrdjen", () => {
  // Prvi prolaz odbijen na 790 (iz prethodnog dana). Danas nezavisan prolaz daje 795 (0.6% razlike
  // od odbijenog, unutar 2%), pad je i dalje iznad praga u odnosu na PRETHODNI upisan snimak.
  const odluka = odlukaOUpisuSnimka({
    novi: 795,
    prethodni: 1000,
    odbijen: odbijenNalaz({ oglasa: 790 }),
    sada: SADA,
  });
  assert.equal(odluka.akcija, "upisi_potvrdjen");
  assert.equal(odluka.razlog, "potvrdjeno_drugim_nezavisnim_prolazom");
});

test("odlukaOUpisuSnimka: odbijen pa NEpoklapanje daje ponovo odbij", () => {
  // Odbijeni nalaz kaze 790, novi prolaz daje 650: previse razlicito da bi bilo ista mjera.
  const odluka = odlukaOUpisuSnimka({
    novi: 650,
    prethodni: 1000,
    odbijen: odbijenNalaz({ oglasa: 790 }),
    sada: SADA,
  });
  assert.equal(odluka.akcija, "odbij");
  assert.equal(odluka.razlog, "pad_ne_poklapa_sa_odbijenim");
});

test("odlukaOUpisuSnimka: zastario nalaz odbijenog prolaza (stariji od 7 dana) se ignorise", () => {
  // Nalaz je star tacno 8 dana: i kad bi se novi broj (795) savrseno poklopio sa njim (790), ne
  // smije se prihvatiti kao potvrda, jer referent nije nezavisna mjera iz nedavnog prolaza.
  const stariNalaz = odbijenNalaz({ oglasa: 790, ts: SADA - 8 * 24 * 60 * 60 });
  const odluka = odlukaOUpisuSnimka({ novi: 795, prethodni: 1000, odbijen: stariNalaz, sada: SADA });
  assert.equal(odluka.akcija, "odbij");
  assert.equal(odluka.razlog, "pad_iznad_praga", "zastario nalaz se tretira kao da ga nema");
});

test("odlukaOUpisuSnimka: nalaz tacno na granici od 7 dana se jos racuna kao validan", () => {
  const nalaz = odbijenNalaz({ oglasa: 795, ts: SADA - SEDAM_DANA_S });
  const odluka = odlukaOUpisuSnimka({ novi: 795, prethodni: 1000, odbijen: nalaz, sada: SADA });
  assert.equal(odluka.akcija, "upisi_potvrdjen");
});

test("odlukaOUpisuSnimka: prilagodjen prag (pragPosto) se postuje", () => {
  const odluka = odlukaOUpisuSnimka({ novi: 950, prethodni: 1000, odbijen: null, pragPosto: 3, sada: SADA });
  assert.equal(odluka.akcija, "odbij", "pad od 5% je iznad zadanog praga od 3%");
});

// ===== odbijen-prolaz.json: citanje/pisanje/brisanje =====

test("upisiOdbijenProlaz pa ucitajOdbijenProlaz vraca isti sadrzaj", () => {
  const dir = radniDir();
  try {
    const putanja = join(dir, ".odbijen-prolaz.json");
    const nalaz = odbijenNalaz();
    upisiOdbijenProlaz(nalaz, putanja);
    assert.deepEqual(ucitajOdbijenProlaz(putanja), nalaz);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ucitajOdbijenProlaz: nepostojeci fajl vraca null", () => {
  assert.equal(ucitajOdbijenProlaz(join(tmpdir(), "olx-nema-ovaj-fajl-nikako.json")), null);
});

test("ucitajOdbijenProlaz: pokvaren JSON vraca null umjesto da baci", () => {
  const dir = radniDir();
  try {
    const putanja = join(dir, ".odbijen-prolaz.json");
    writeFileSync(putanja, "{ ovo nije json", "utf8");
    assert.equal(ucitajOdbijenProlaz(putanja), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("obrisiOdbijenProlaz: nepostojeci fajl je uspjeh, ne greska", () => {
  assert.doesNotThrow(() => obrisiOdbijenProlaz(join(tmpdir(), "olx-nema-ovaj-fajl-nikako-2.json")));
});

test("putanjaOdbijenogProlaza: default lezi pored dnevnih snapshota, override radi", () => {
  assert.equal(putanjaOdbijenogProlaza({}), `${SNAPSHOT_DIR}/.odbijen-prolaz.json`);
  assert.equal(
    putanjaOdbijenogProlaza({ OLX_ODBIJEN_PROLAZ_FILE: "/tmp/drugdje.json" }),
    "/tmp/drugdje.json",
  );
});

// ===== ViewsSnapshot.ukupno_prijavljeno: opciono, stari fajlovi bez njega se i dalje ucitavaju =====

test("stari snapshot fajl bez polja ukupno_prijavljeno se i dalje ucitava", () => {
  const dir = radniDir();
  try {
    // Simulira snapshot verzije 2/3 (prije nego je ukupno_prijavljeno postojalo).
    const stari = { verzija: 2, ts: Math.floor(Date.parse("2026-08-10T03:00:00Z") / 1000), oglasi: [] };
    writeFileSync(join(dir, "views-2026-08-10.json"), `${JSON.stringify(stari)}\n`, "utf8");
    const [ucitan] = ucitajSnapshote(dir);
    assert.ok(ucitan, "stari fajl se ucitava bez pucanja");
    assert.equal(ucitan!.ukupno_prijavljeno, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
