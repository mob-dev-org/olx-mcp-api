import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  kompaktSpisak,
  mapirajZaKreiranje,
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
