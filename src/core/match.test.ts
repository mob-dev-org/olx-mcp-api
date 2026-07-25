// Testovi za spajanje kataloga. Parovi su stvarni, prepisani iz MixBox PIK i Shopify kataloga.
// Precision je vazniji od recalla: lazni match vodi na skrivanje oglasa koji je stvarno na stanju.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIdf,
  matchCatalog,
  modelTokens,
  normalizeTitle,
  scorePair,
  skuBaseKey,
  skuModelCode,
  summarizeMatches,
  type PikItem,
  type ShopifyItem,
} from "./match.js";

// matchCatalog vraca jedan rezultat po ulaznom oglasu; helper cuva tipove od undefined.
function only<T>(items: T[]): T {
  assert.equal(items.length, 1, "ocekivan tacno jedan rezultat");
  return items[0] as T;
}

test("normalizeTitle skida dijakritike i interpunkciju", () => {
  assert.equal(normalizeTitle("Radne hlače crno-žute - NEON H6401"), "radne hlace crno zute neon h6401");
  assert.equal(normalizeTitle("BASE BULL radne cipele HTZ zastitna obuca S3"), "base bull radne cipele htz zastitna obuca s3");
  assert.equal(normalizeTitle("Otirači za vrata, mix dezena"), "otiraci za vrata mix dezena");
});

test("normalizeTitle pokriva dj i dz koje NFD ne dekomponuje", () => {
  assert.equal(normalizeTitle("Đevđir"), "devdir");
  assert.equal(normalizeTitle("Džemperi"), "dzemperi");
  assert.equal(normalizeTitle("Šćepan Ćiro"), "scepan ciro");
});

test("skuModelCode svodi tri PIK oblika na isti kod", () => {
  assert.equal(skuModelCode("B0714"), "B0714");
  assert.equal(skuModelCode("CA-B0714-CWA-39"), "B0714");
  assert.equal(skuModelCode("ca-b0714-cwa"), "B0714");
  assert.equal(skuModelCode("H6401"), "H6401");
  assert.equal(skuModelCode(null), undefined);
  assert.equal(skuModelCode(""), undefined);
});

test("skuBaseKey cuva razlikovni dio i skida samo velicinu", () => {
  assert.equal(skuBaseKey("CA-B0978-0WA-42"), "CAB09780WA");
  assert.equal(skuBaseKey("CA-B0978-0WB-42"), "CAB09780WB");
  assert.notEqual(skuBaseKey("CA-B0978-0WA"), skuBaseKey("CA-B0978-0WB"));
  assert.equal(skuBaseKey("H6412-XXL"), "H6412");
  assert.equal(skuBaseKey("H6410-46"), "H6410");
});

// Stvaran slucaj sa MixBox naloga: dva razlicita modela dijele kod B0978 i bili su
// pogresno spojeni na isti Shopify proizvod.
test("modeli koji dijele kod modela ne smiju se spojiti na isti proizvod", () => {
  const pik: PikItem[] = [
    { id: 77556922, title: "BASE OREN radne cipele HTZ zastitna obuca S3", sku: "CA-B0978-0WA" },
    { id: 77556923, title: "BASE OREN ESD radne cipele HTZ zastitna obuca S3", sku: "CA-B0978-0WB" },
  ];
  const shopify: ShopifyItem[] = [
    {
      handle: "base-oren-esd-b0978",
      title: "Base OREN ESD radne zaštitne cipele HTZ obuća S3",
      skus: ["CA-B0978-0WB-38", "CA-B0978-0WB-42"],
      totalInventory: 3,
    },
    {
      handle: "base-oren-b0978",
      title: "Base OREN radne zaštitne cipele HTZ obuća S3",
      skus: ["CA-B0978-0WA-38", "CA-B0978-0WA-42"],
      totalInventory: 7,
    },
  ];
  const results = matchCatalog(pik, shopify);
  const oren = results.find((r) => r.pikId === 77556922);
  const orenEsd = results.find((r) => r.pikId === 77556923);
  assert.equal(oren?.shopifyHandle, "base-oren-b0978", "OREN mora dobiti svoj proizvod");
  assert.equal(orenEsd?.shopifyHandle, "base-oren-esd-b0978", "OREN ESD mora dobiti svoj proizvod");
  assert.notEqual(oren?.shopifyHandle, orenEsd?.shopifyHandle);
  assert.equal(oren?.totalInventory, 7);
  assert.equal(orenEsd?.totalInventory, 3);
});

test("dvosmislen kod modela ne daje automatski SKU match", () => {
  const pik: PikItem[] = [{ id: 9, title: "BASE OREN radne cipele", sku: "B0978" }];
  const shopify: ShopifyItem[] = [
    { handle: "base-oren-b0978", title: "Base OREN radne cipele", skus: ["CA-B0978-0WA-40"], totalInventory: 7 },
    { handle: "base-oren-esd-b0978", title: "Base OREN ESD radne cipele", skus: ["CA-B0978-0WB-40"], totalInventory: 3 },
  ];
  const result = only(matchCatalog(pik, shopify));
  assert.notEqual(result.method, "sku", "kod modela je dvosmislen, ne smije proci kao SKU match");
});

test("modelTokens vadi kod modela i normu iz naslova", () => {
  const tokens = modelTokens("BASE BULL radne cipele HTZ zastitna obuca S3");
  assert.ok(tokens.has("s3"));
  const other = modelTokens("Radne hlače crno-žute - NEON H6401");
  assert.ok(other.has("h6401"));
});

test("stvarni par se prepoznaje uprkos dijakriticima i drugom redu rijeci", () => {
  const idf = buildIdf([
    "BASE BULL radne cipele HTZ zastitna obuca S3",
    "Base BULL radne zaštitne cipele HTZ obuća S3",
    "BASE FLY radne cipele HTZ zastitna obuca S1P",
    "BASE MOZART radne cipele HTZ zastitna obuca S3",
  ]);
  const score = scorePair(
    "BASE BULL radne cipele HTZ zastitna obuca S3",
    "Base BULL radne zaštitne cipele HTZ obuća S3",
    idf,
  );
  assert.ok(score >= 0.72, `ocekivan skor iznad praga, dobijeno ${score}`);
});

test("blizanci iz istog programa ne smiju dobiti visi skor od pravog para", () => {
  const corpus = [
    "Set pribora za jelo, Ninja Turtles",
    "Set pribora za jelo, The Good Dinosaur",
    "Set inox pribora za jelo, dječiji",
  ];
  const idf = buildIdf(corpus);
  const pravi = scorePair("Set pribora za jelo, Ninja Turtles", "Set pribora za jelo, Ninja Turtles", idf);
  const lazni = scorePair("Set pribora za jelo, Ninja Turtles", "Set pribora za jelo, The Good Dinosaur", idf);
  assert.ok(pravi > lazni, `pravi ${pravi} mora biti veci od laznog ${lazni}`);
});

test("SKU ima prioritet nad naslovom i vraca skor 1", () => {
  const pik: PikItem[] = [{ id: 77556842, title: "BASE BULL radne cipele HTZ zastitna obuca S3", sku: "B0714" }];
  const shopify: ShopifyItem[] = [
    { handle: "base-mozart", title: "Base MOZART radne zaštitne cipele HTZ obuća S3", skus: ["CA-B0999-AAA-40"], totalInventory: 5 },
    { handle: "base-bull-b0714", title: "Base BULL radne zaštitne cipele HTZ obuća S3", skus: ["CA-B0714-CWA-39"], totalInventory: 61 },
  ];
  const result = only(matchCatalog(pik, shopify));
  assert.equal(result.method, "sku");
  assert.equal(result.decision, "matched");
  assert.equal(result.shopifyHandle, "base-bull-b0714");
  assert.equal(result.totalInventory, 61);
  assert.equal(result.score, 1);
});

test("kod modela se prepoznaje i iz Shopify handlea kad varijante nemaju SKU", () => {
  const pik: PikItem[] = [{ id: 1, title: "Nesto skroz drugo", sku: "B0714" }];
  const shopify: ShopifyItem[] = [{ handle: "base-bull-b0714", title: "Base BULL cipele", totalInventory: 61 }];
  const result = only(matchCatalog(pik, shopify));
  assert.equal(result.method, "sku");
  assert.equal(result.shopifyHandle, "base-bull-b0714");
});

test("fallback po naslovu radi za artikle bez SKU", () => {
  const pik: PikItem[] = [{ id: 78055209, title: "Baloni sa zviždaljkom, Perla Festa", sku: null }];
  const shopify: ShopifyItem[] = [
    { handle: "baloni-zvizdaljka", title: "Baloni sa zviždaljkom, Perla Festa", totalInventory: 50 },
    { handle: "otiraci", title: "Otirači za vrata, mix dezena", totalInventory: 146 },
  ];
  const result = only(matchCatalog(pik, shopify));
  assert.equal(result.method, "title");
  assert.equal(result.decision, "matched");
  assert.equal(result.totalInventory, 50);
});

test("dvosmislen slucaj ide na rucnu provjeru, ne na automatski match", () => {
  const pik: PikItem[] = [{ id: 2, title: "Set pribora za jelo", sku: null }];
  const shopify: ShopifyItem[] = [
    { handle: "ninja", title: "Set pribora za jelo, Ninja Turtles", totalInventory: 50 },
    { handle: "dino", title: "Set pribora za jelo, The Good Dinosaur", totalInventory: 50 },
  ];
  const result = only(matchCatalog(pik, shopify));
  assert.equal(result.decision, "review");
  assert.ok(result.candidates.length >= 2);
});

test("nepovezan oglas daje no_match, ne nasilan par", () => {
  const pik: PikItem[] = [{ id: 3, title: "Samsung Galaxy S22 Ultra", sku: null }];
  const shopify: ShopifyItem[] = [
    { handle: "otiraci", title: "Otirači za vrata, mix dezena", totalInventory: 146 },
    { handle: "baloni", title: "Baloni Perla Festa, mješoviti oblici", totalInventory: 50 },
  ];
  const result = only(matchCatalog(pik, shopify));
  assert.equal(result.decision, "no_match");
  assert.equal(result.shopifyHandle, undefined);
});

test("override sa ignore iskljucuje bundle oglase bez pandana", () => {
  const pik: PikItem[] = [{ id: 78059920, title: "Party mix paleta - 3000 raznih artikala (veleprodaja)", sku: null }];
  const shopify: ShopifyItem[] = [{ handle: "baloni", title: "Baloni Perla Festa", totalInventory: 50 }];
  const result = only(matchCatalog(pik, shopify, {
    overrides: { "78059920": { ignore: true, note: "paleta, nema pandan" } },
  }));
  assert.equal(result.decision, "ignored");
  assert.equal(result.method, "override");
  assert.equal(result.note, "paleta, nema pandan");
});

test("override na nepostojeci handle se prijavi, a ne prodje tiho", () => {
  const pik: PikItem[] = [{ id: 4, title: "Bilo sta", sku: null }];
  const result = only(matchCatalog(pik, [], { overrides: { "4": { shopify_handle: "ne-postoji" } } }));
  assert.equal(result.decision, "matched");
  assert.match(String(result.note), /ne postoji/);
});

test("precision na zlatnom setu: nula laznih pozitiva", () => {
  const shopify: ShopifyItem[] = [
    { handle: "base-bull-b0714", title: "Base BULL radne zaštitne cipele HTZ obuća S3", skus: ["CA-B0714-CWA-39"], totalInventory: 61 },
    { handle: "base-quark", title: "Base QUARK radne zaštitne cipele HTZ obuća S1P", skus: ["CA-B0474-PWE-36"], totalInventory: 217 },
    { handle: "pernice-mix-dezena", title: "Pernice, mix dezena", totalInventory: 4536 },
    { handle: "otiraci-za-vrata", title: "Otirači za vrata, mix dezena", totalInventory: 146 },
    { handle: "stolnjaci-i-museme", title: "Stolnjaci i mušeme, mix dezena", totalInventory: 146 },
    { handle: "jastuci-za-stolice", title: "Jastuci za stolice, mix dezena", totalInventory: 100 },
  ];
  const pik: PikItem[] = [
    { id: 78055128, title: "Pernice, mix dezena", sku: null },
    { id: 78055154, title: "Otirači za vrata, mix dezena", sku: null },
    { id: 78055146, title: "Stolnjaci i mušeme, mix dezena", sku: null },
    { id: 78055137, title: "Jastuci za stolice, mix dezena", sku: null },
    { id: 77556842, title: "BASE BULL radne cipele HTZ zastitna obuca S3", sku: "B0714" },
  ];
  const ocekivano: Record<string, string> = {
    "78055128": "pernice-mix-dezena",
    "78055154": "otiraci-za-vrata",
    "78055146": "stolnjaci-i-museme",
    "78055137": "jastuci-za-stolice",
    "77556842": "base-bull-b0714",
  };

  const results = matchCatalog(pik, shopify);
  for (const result of results) {
    if (result.decision !== "matched") continue;
    assert.equal(
      result.shopifyHandle,
      ocekivano[String(result.pikId)],
      `lazni pozitiv za ${result.pikTitle}: dobijeno ${result.shopifyHandle}, skor ${result.score}`,
    );
  }
  const summary = summarizeMatches(results);
  assert.equal(summary.matched + summary.review, results.length, "nijedan poznati par ne smije pasti u no_match");
});
