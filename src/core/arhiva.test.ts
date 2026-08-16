import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  arhivirajIzZivog,
  kompaktSpisak,
  mapirajZaKreiranje,
  planReaktivacije,
  zapisIzZavrsenog,
  MAX_BAJTA_SLIKE,
  nazivSlike,
  noviZapis,
  planVracanja,
  preuzmiSlike,
  saOznakomObjave,
  ucitajZapis,
  upisiZapis,
} from "./arhiva.js";
import type { Listing } from "./types.js";

const primjer: Listing = {
  id: 42,
  title: "Friteza 8L",
  short_description: "Profi friteza",
  additional: { description: "Dugacak opis iz additional bloka" },
  price: 250,
  available: true,
  listing_type: "sell",
  state: "new",
  status: "active",
  visible: true,
  quantity: 3,
  price_by_agreement: false,
  shipping: true,
  views: 120,
  sku_number: "FR-8L",
  category_id: 1234,
  category: { id: 1234, name: "Ugostiteljska oprema" },
  brand: { id: 7, name: "Bartscher" },
  model: { id: 9, name: "Pro" },
  attributes: [
    { id: 1, name: "Snaga", value: 3200 },
    { id: 2, name: "Prazno", value: "" },
    { id: 3, name: "Boja", value: "inox" },
  ],
  images: ["https://cdn.olx.ba/a.jpg", "https://cdn.olx.ba/b.webp"],
};

test("mapirajZaKreiranje: create polja, description iz additional, atributi bez praznih", () => {
  const { input, nerekreirljivo } = mapirajZaKreiranje(primjer);
  assert.equal(input.title, "Friteza 8L");
  assert.equal(input.description, "Dugacak opis iz additional bloka");
  assert.equal(input.category_id, 1234);
  assert.equal(input.brand_id, 7);
  assert.equal(input.model_id, 9);
  assert.equal(input.sku_number, "FR-8L");
  assert.deepEqual(input.attributes, [
    { id: 1, value: "3200" },
    { id: 3, value: "inox" },
  ]);
  // Polja koja create ne prima idu covjeku na uvid, ne u create blok.
  assert.deepEqual(nerekreirljivo, { quantity: 3, price_by_agreement: false, shipping: true, views: 120 });
  assert.ok(!("quantity" in input));
});

test("nazivSlike: ekstenzija iz URL-a (i sa query stringom), pa content-type, pa jpg", () => {
  assert.equal(nazivSlike(1, "https://cdn.olx.ba/x.webp"), "01.webp");
  assert.equal(nazivSlike(2, "https://cdn.olx.ba/x.JPEG?w=800"), "02.jpg");
  assert.equal(nazivSlike(3, "https://cdn.olx.ba/bez-ekstenzije", "image/png; charset=binary"), "03.png");
  assert.equal(nazivSlike(4, "https://cdn.olx.ba/bez-icega"), "04.jpg");
});

test("noviZapis nosi meta podatke i URL-ove, saOznakomObjave dopise novi id", () => {
  const z = noviZapis(primjer, "2026-08-04T10:00:00Z");
  assert.equal(z.meta.originalni_id, 42);
  assert.equal(z.meta.naslov, "Friteza 8L");
  assert.equal(z.meta.status_pri_arhiviranju, "active, vidljiv");
  assert.deepEqual(z.meta.url_slika, ["https://cdn.olx.ba/a.jpg", "https://cdn.olx.ba/b.webp"]);
  assert.equal(z.meta.ponovo_objavljen, null);
  const o = saOznakomObjave(z, 99, "2026-09-01T09:00:00Z");
  assert.deepEqual(o.meta.ponovo_objavljen, { novi_id: 99, kada: "2026-09-01T09:00:00Z" });
  assert.equal(z.meta.ponovo_objavljen, null, "original ostaje netaknut");
});

test("planVracanja: skriven se otkriva, nestali se objavljuje, vidljiv i bez-arhive stoje", () => {
  const zapis = noviZapis(primjer, "2026-08-04T10:00:00Z");
  assert.deepEqual(planVracanja(zapis, { ...primjer, visible: false }), { radnja: "otkrij" });
  assert.deepEqual(planVracanja(null, { ...primjer, visible: false }), { radnja: "otkrij" });
  assert.deepEqual(planVracanja(zapis, null), { radnja: "objavi" });
  assert.equal(planVracanja(zapis, primjer).radnja, "stoj");
  assert.equal(planVracanja(null, null).radnja, "stoj");
});

test("kompaktSpisak sortira od najnovijeg i broji slike", () => {
  const a = noviZapis({ ...primjer, id: 1, title: "A" }, "2026-08-01T00:00:00Z");
  const b = { ...noviZapis({ ...primjer, id: 2, title: "B" }, "2026-08-03T00:00:00Z") };
  b.meta.fajlovi_slika = ["01.jpg", "02.jpg"];
  const spisak = kompaktSpisak([a, b]);
  assert.deepEqual(spisak.map((s) => s.id), [2, 1]);
  assert.equal(spisak[0]?.slika_broj, 2);
});

test("upisiZapis i ucitajZapis prezive krug, pokvaren fajl vraca null", () => {
  const dir = mkdtempSync(join(tmpdir(), "arhiva-"));
  try {
    const env = { OLX_ARHIVA_DIR: dir } as NodeJS.ProcessEnv;
    const z = noviZapis(primjer, "2026-08-04T10:00:00Z");
    upisiZapis(z, env);
    assert.deepEqual(ucitajZapis(42, env), z);
    mkdirSync(join(dir, "43"), { recursive: true });
    writeFileSync(join(dir, "43", "oglas.json"), "nije json", "utf8");
    assert.equal(ucitajZapis(43, env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preuzmiSlike: pad jedne ne rusi ostale, prevelika se odbija, redoslijed se cuva", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arhiva-slike-"));
  try {
    const laznaFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("pada")) return new Response("nema", { status: 404 });
      if (u.includes("prevelika")) {
        return new Response(new Uint8Array(8), {
          status: 200,
          headers: { "content-length": String(MAX_BAJTA_SLIKE + 1), "content-type": "image/jpeg" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
    }) as typeof fetch;

    const r = await preuzmiSlike(
      ["https://cdn/x.jpg", "https://cdn/pada.jpg", "https://cdn/prevelika.jpg", "https://cdn/bez-ekstenzije"],
      dir,
      laznaFetch,
    );
    assert.deepEqual(r.fajlovi, ["01.jpg", "04.webp"]);
    assert.equal(r.neuspjele.length, 2);
    assert.match(String(r.neuspjele[0]?.greska), /HTTP 404/);
    assert.match(String(r.neuspjele[1]?.greska), /granica/);
    assert.equal(readFileSync(join(dir, "01.jpg")).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planReaktivacije: aktivan, istekao i nacrt stoje sa uputom, skriven se otkriva", () => {
  const aktivan = planReaktivacije({ ...primjer, status: "active" }, null);
  assert.equal(aktivan.radnja, "stoj");
  assert.match((aktivan as { zasto: string }).zasto, /obnovom ili izdvajanjem/);

  const istekao = planReaktivacije({ ...primjer, status: "expired" }, null);
  assert.equal(istekao.radnja, "stoj");
  assert.match((istekao as { zasto: string }).zasto, /obnovom/);

  const nacrt = planReaktivacije({ ...primjer, status: "inactive" }, null);
  assert.equal(nacrt.radnja, "stoj");

  const skriven = planReaktivacije({ ...primjer, visible: false, status: "active" }, null);
  assert.equal(skriven.radnja, "otkrij");
});

test("planReaktivacije: zavrsen sa cijenom i slikama ide iz zivog, bez cijene stoji dok se ne zada", () => {
  const zavrsen: Listing = { ...primjer, status: "finished" };
  const izZivog = planReaktivacije(zavrsen, null);
  assert.deepEqual(izZivog, { radnja: "objavi_iz_zivog", cijena: 250 });

  // Zavrseni oglasi znaju vratiti cijenu 0 ("na upit"): nula i "ne znam" nisu isto.
  const bezCijene = planReaktivacije({ ...zavrsen, price: 0 }, null);
  assert.equal(bezCijene.radnja, "stoj");
  assert.match((bezCijene as { zasto: string }).zasto, /zadaj cijenu/);

  const saZadatom = planReaktivacije({ ...zavrsen, price: 0 }, null, { zadataCijena: 199 });
  assert.deepEqual(saZadatom, { radnja: "objavi_iz_zivog", cijena: 199 });
});

test("planReaktivacije: bez slika ide iz arhive kad je ima, inace stoji; necitljiv oglas isto", () => {
  const zavrsenBezSlika: Listing = { ...primjer, status: "finished", images: [] };
  const bezicega = planReaktivacije(zavrsenBezSlika, null);
  assert.equal(bezicega.radnja, "stoj");
  assert.match((bezicega as { zasto: string }).zasto, /bez slika/);

  const zapis = noviZapis(primjer, "2026-08-04T10:00:00.000Z");
  zapis.meta.fajlovi_slika = ["01.jpg"];
  assert.equal(planReaktivacije(zavrsenBezSlika, zapis).radnja, "objavi_iz_arhive");

  // getListing pao (necitljiv zavrsen oglas): arhiva je jedini put, bez nje stoj.
  assert.equal(planReaktivacije(null, zapis).radnja, "objavi_iz_arhive");
  const nista = planReaktivacije(null, null);
  assert.equal(nista.radnja, "stoj");
  assert.match((nista as { zasto: string }).zasto, /arhive nema/);
});

test("planReaktivacije: publish grana se pali samo eksplicitnim flagom (dok mjerenje ne prodje)", () => {
  const zavrsen: Listing = { ...primjer, status: "finished" };
  assert.equal(planReaktivacije(zavrsen, null, { publishRadiNaFinished: true }).radnja, "publish");
  assert.notEqual(planReaktivacije(zavrsen, null).radnja, "publish");
});

test("zapisIzZavrsenog: korisnikova cijena ulazi u create, porijeklo u nerekreirljivo", () => {
  const zavrsen: Listing = { ...primjer, status: "finished", price: 0 };
  const z = zapisIzZavrsenog(zavrsen, "2026-08-04T10:00:00.000Z", 199);
  assert.equal(z.create.price, 199);
  assert.equal(z.meta.nerekreirljivo.reaktivacija_iz_statusa, "finished");

  const bezZadate = zapisIzZavrsenog({ ...primjer, status: "finished" }, "2026-08-04T10:00:00.000Z");
  assert.equal(bezZadate.create.price, 250, "bez zadate cijene ostaje original");
});

test("planReaktivacije: zavrsen a skriven ne ide na otkrivanje, jer unhide nad zavrsenim ne radi nista", () => {
  // Redoslijed provjera: status prije skrivenosti. Da je obrnuto, ovaj oglas bi zavrsio na
  // unhide, alat bi javio uspjeh, a oglas bi ostao zavrsen.
  const zavrsenSkriven: Listing = { ...primjer, status: "finished", visible: false };
  assert.deepEqual(planReaktivacije(zavrsenSkriven, null), { radnja: "objavi_iz_zivog", cijena: 250 });

  // Skriven a NIJE zavrsen i dalje ide na otkrivanje: to je besplatan put koji cuva preglede.
  assert.equal(planReaktivacije({ ...primjer, status: "active", visible: false }, null).radnja, "otkrij");
});

test("planReaktivacije: nepoznat i prazan status stoje umjesto da se objave kao zavrseni", () => {
  // Zavrsen se prepoznaje izricito. Prepoznavanje po odsustvu ostalih statusa bi svaki oglas
  // sa nepoznatim statusom poslalo u ponovnu objavu, a ona gubi preglede i historiju.
  const nepoznat = planReaktivacije({ ...primjer, status: "moderation" }, null);
  assert.equal(nepoznat.radnja, "stoj");
  assert.match((nepoznat as { zasto: string }).zasto, /"moderation"/);
  assert.match((nepoznat as { zasto: string }).zasto, /finished/);

  const bezStatusa = planReaktivacije({ ...primjer, status: undefined }, null);
  assert.equal(bezStatusa.radnja, "stoj");
  assert.match((bezStatusa as { zasto: string }).zasto, /prazan/);
});

test("arhivirajIzZivog: svjeze slike prepisuju spisak, cijena i porijeklo udju u zapis", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arhiva-izzivog-"));
  try {
    const env = { OLX_ARHIVA_DIR: dir } as NodeJS.ProcessEnv;
    const laznaFetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;

    const zavrsen: Listing = { ...primjer, status: "finished", price: 0 };
    const z = await arhivirajIzZivog(zavrsen, { cijena: 199, kada: "2026-08-16T10:00:00.000Z", env, fetchFn: laznaFetch });

    // Ekstenzija se cita iz URL-a oglasa (a.jpg, b.webp), ne iz content-type zaglavlja.
    assert.deepEqual(z.meta.fajlovi_slika, ["01.jpg", "02.webp"]);
    assert.equal(z.meta.slike_iz_ranije_arhive, undefined, "svjeze preuzete slike nisu iz ranije arhive");
    assert.equal(z.create.price, 199);
    assert.equal(z.meta.nerekreirljivo.reaktivacija_iz_statusa, "finished");
    assert.deepEqual(ucitajZapis(42, env), z, "zapis je i upisan na disk, ne samo vracen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arhivirajIzZivog: kad nijedna slika ne prodje, spisak iz ranije arhive se cuva umjesto prepisa", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arhiva-spajanje-"));
  try {
    const env = { OLX_ARHIVA_DIR: dir } as NodeJS.ProcessEnv;

    // Ranija arhiva iz vremena kad je oglas bio zdrav: ona je jedini primjerak originalnih slika.
    const stari = noviZapis(primjer, "2026-08-01T10:00:00.000Z");
    stari.meta.fajlovi_slika = ["01.jpg", "02.webp"];
    stari.meta.ponovo_objavljen = { novi_id: 777, kada: "2026-08-02T10:00:00.000Z" };
    upisiZapis(stari, env);

    const padne = (async () => new Response("nema", { status: 404 })) as typeof fetch;
    const zavrsen: Listing = { ...primjer, status: "finished", title: "Friteza 8L, novi naslov" };
    const z = await arhivirajIzZivog(zavrsen, { kada: "2026-08-16T10:00:00.000Z", env, fetchFn: padne });

    assert.deepEqual(z.meta.fajlovi_slika, ["01.jpg", "02.webp"], "slike prezive pad preuzimanja");
    assert.equal(z.meta.slike_iz_ranije_arhive, true);
    assert.equal(z.meta.neuspjele_slike.length, 2, "neuspjeh se svejedno biljezi");
    assert.equal(z.create.title, "Friteza 8L, novi naslov", "tekst se osvjezava sa zivog oglasa");
    assert.deepEqual(z.meta.ponovo_objavljen, { novi_id: 777, kada: "2026-08-02T10:00:00.000Z" }, "ranija objava se pamti");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arhivirajIzZivog: bez ranije arhive pad preuzimanja ostavlja prazan spisak, da se objava zaustavi", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arhiva-prazno-"));
  try {
    const env = { OLX_ARHIVA_DIR: dir } as NodeJS.ProcessEnv;
    const padne = (async () => new Response("nema", { status: 404 })) as typeof fetch;
    const z = await arhivirajIzZivog({ ...primjer, status: "finished" }, { kada: "2026-08-16T10:00:00.000Z", env, fetchFn: padne });
    assert.deepEqual(z.meta.fajlovi_slika, []);
    assert.equal(z.meta.slike_iz_ranije_arhive, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
