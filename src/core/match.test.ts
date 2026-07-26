// Testovi za spajanje kataloga. Podaci su izmisljeni, ali oblikovani po obrascima koji se stvarno
// javljaju u nesavrsenim katalozima: SKU sa velicinom na kraju, dva modela koja dijele kod modela,
// isti artikal napisan drugim redom rijeci i sa dijakriticima, i blizanci iz istog programa.
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
  type KatalogItem,
} from "./match.js";

// matchCatalog vraca jedan rezultat po ulaznom oglasu; helper cuva tipove od undefined.
function only<T>(items: T[]): T {
  assert.equal(items.length, 1, "ocekivan tacno jedan rezultat");
  return items[0] as T;
}

test("normalizeTitle skida dijakritike i interpunkciju", () => {
  assert.equal(normalizeTitle("Planinarske čarape crno-žute - LUNA P4110"), "planinarske carape crno zute luna p4110");
  assert.equal(normalizeTitle("VEGA NORDA planinarske cipele vodootporne S3"), "vega norda planinarske cipele vodootporne s3");
  assert.equal(normalizeTitle("Podmetači za stol, mix dezena"), "podmetaci za stol mix dezena");
});

test("normalizeTitle pokriva dj i dz koje NFD ne dekomponuje", () => {
  assert.equal(normalizeTitle("Đevđir"), "devdir");
  assert.equal(normalizeTitle("Džemperi"), "dzemperi");
  assert.equal(normalizeTitle("Šćepan Ćiro"), "scepan ciro");
});

test("skuModelCode svodi tri oblika sifre na isti kod", () => {
  assert.equal(skuModelCode("M0221"), "M0221");
  assert.equal(skuModelCode("CA-M0221-CWA-39"), "M0221");
  assert.equal(skuModelCode("ca-m0221-cwa"), "M0221");
  assert.equal(skuModelCode("P4110"), "P4110");
  assert.equal(skuModelCode(null), undefined);
  assert.equal(skuModelCode(""), undefined);
});

test("skuBaseKey cuva razlikovni dio i skida samo velicinu", () => {
  assert.equal(skuBaseKey("CA-M0330-0WA-42"), "CAM03300WA");
  assert.equal(skuBaseKey("CA-M0330-0WB-42"), "CAM03300WB");
  assert.notEqual(skuBaseKey("CA-M0330-0WA"), skuBaseKey("CA-M0330-0WB"));
  assert.equal(skuBaseKey("P4120-XXL"), "P4120");
  assert.equal(skuBaseKey("P4130-46"), "P4130");
});

// Obrazac koji je u praksi pravio lazne parove: dva razlicita modela dijele kod modela (M0330) i
// razlikuju se samo u nastavku sifre, pa ih je lako spojiti na isti proizvod.
test("modeli koji dijele kod modela ne smiju se spojiti na isti proizvod", () => {
  const pik: PikItem[] = [
    { id: 1001, title: "VEGA TERRA planinarske cipele vodootporne S3", sku: "CA-M0330-0WA" },
    { id: 1002, title: "VEGA TERRA ESD planinarske cipele vodootporne S3", sku: "CA-M0330-0WB" },
  ];
  const katalog: KatalogItem[] = [
    {
      handle: "vega-terra-esd-m0330",
      title: "Vega TERRA ESD planinarske vodootporne cipele S3",
      skus: ["CA-M0330-0WB-38", "CA-M0330-0WB-42"],
      totalInventory: 3,
    },
    {
      handle: "vega-terra-m0330",
      title: "Vega TERRA planinarske vodootporne cipele S3",
      skus: ["CA-M0330-0WA-38", "CA-M0330-0WA-42"],
      totalInventory: 7,
    },
  ];
  const results = matchCatalog(pik, katalog);
  const terra = results.find((r) => r.pikId === 1001);
  const terraEsd = results.find((r) => r.pikId === 1002);
  assert.equal(terra?.shopifyHandle, "vega-terra-m0330", "TERRA mora dobiti svoj proizvod");
  assert.equal(terraEsd?.shopifyHandle, "vega-terra-esd-m0330", "TERRA ESD mora dobiti svoj proizvod");
  assert.notEqual(terra?.shopifyHandle, terraEsd?.shopifyHandle);
  assert.equal(terra?.totalInventory, 7);
  assert.equal(terraEsd?.totalInventory, 3);
});

test("dvosmislen kod modela ne daje automatski SKU match", () => {
  const pik: PikItem[] = [{ id: 9, title: "VEGA TERRA planinarske cipele", sku: "M0330" }];
  const katalog: KatalogItem[] = [
    { handle: "vega-terra-m0330", title: "Vega TERRA planinarske cipele", skus: ["CA-M0330-0WA-40"], totalInventory: 7 },
    { handle: "vega-terra-esd-m0330", title: "Vega TERRA ESD planinarske cipele", skus: ["CA-M0330-0WB-40"], totalInventory: 3 },
  ];
  const result = only(matchCatalog(pik, katalog));
  assert.notEqual(result.method, "sku", "kod modela je dvosmislen, ne smije proci kao SKU match");
});

test("modelTokens vadi kod modela i normu iz naslova", () => {
  const tokens = modelTokens("VEGA NORDA planinarske cipele vodootporne S3");
  assert.ok(tokens.has("s3"));
  const other = modelTokens("Planinarske čarape crno-žute - LUNA P4110");
  assert.ok(other.has("p4110"));
});

test("isti artikal se prepoznaje uprkos dijakriticima i drugom redu rijeci", () => {
  const idf = buildIdf([
    "VEGA NORDA planinarske cipele vodootporne S3",
    "Vega NORDA planinarske vodootporne cipele S3",
    "VEGA LUNA planinarske cipele vodootporne S1P",
    "VEGA ORION planinarske cipele vodootporne S3",
  ]);
  const score = scorePair(
    "VEGA NORDA planinarske cipele vodootporne S3",
    "Vega NORDA planinarske vodootporne cipele S3",
    idf,
  );
  assert.ok(score >= 0.72, `ocekivan skor iznad praga, dobijeno ${score}`);
});

test("blizanci iz istog programa ne smiju dobiti visi skor od pravog para", () => {
  const corpus = [
    "Set pribora za jelo, Plavi Zmaj",
    "Set pribora za jelo, Zeleni Robot",
    "Set inox pribora za jelo, dječiji",
  ];
  const idf = buildIdf(corpus);
  const pravi = scorePair("Set pribora za jelo, Plavi Zmaj", "Set pribora za jelo, Plavi Zmaj", idf);
  const lazni = scorePair("Set pribora za jelo, Plavi Zmaj", "Set pribora za jelo, Zeleni Robot", idf);
  assert.ok(pravi > lazni, `pravi ${pravi} mora biti veci od laznog ${lazni}`);
});

test("SKU ima prioritet nad naslovom i vraca skor 1", () => {
  const pik: PikItem[] = [{ id: 1003, title: "VEGA NORDA planinarske cipele vodootporne S3", sku: "M0221" }];
  const katalog: KatalogItem[] = [
    { handle: "vega-orion", title: "Vega ORION planinarske vodootporne cipele S3", skus: ["CA-M0999-AAA-40"], totalInventory: 5 },
    { handle: "vega-norda-m0221", title: "Vega NORDA planinarske vodootporne cipele S3", skus: ["CA-M0221-CWA-39"], totalInventory: 61 },
  ];
  const result = only(matchCatalog(pik, katalog));
  assert.equal(result.method, "sku");
  assert.equal(result.decision, "matched");
  assert.equal(result.shopifyHandle, "vega-norda-m0221");
  assert.equal(result.totalInventory, 61);
  assert.equal(result.score, 1);
});

test("kod modela se prepoznaje i iz handlea kad varijante nemaju SKU", () => {
  const pik: PikItem[] = [{ id: 1, title: "Nesto skroz drugo", sku: "M0221" }];
  const katalog: KatalogItem[] = [{ handle: "vega-norda-m0221", title: "Vega NORDA cipele", totalInventory: 61 }];
  const result = only(matchCatalog(pik, katalog));
  assert.equal(result.method, "sku");
  assert.equal(result.shopifyHandle, "vega-norda-m0221");
});

test("fallback po naslovu radi za artikle bez SKU", () => {
  const pik: PikItem[] = [{ id: 1004, title: "Baloni sa zviždaljkom, Fiesta Nova", sku: null }];
  const katalog: KatalogItem[] = [
    { handle: "baloni-zvizdaljka", title: "Baloni sa zviždaljkom, Fiesta Nova", totalInventory: 50 },
    { handle: "podmetaci", title: "Podmetači za stol, mix dezena", totalInventory: 146 },
  ];
  const result = only(matchCatalog(pik, katalog));
  assert.equal(result.method, "title");
  assert.equal(result.decision, "matched");
  assert.equal(result.totalInventory, 50);
});

test("dvosmislen slucaj ide na rucnu provjeru, ne na automatski match", () => {
  const pik: PikItem[] = [{ id: 2, title: "Set pribora za jelo", sku: null }];
  const katalog: KatalogItem[] = [
    { handle: "zmaj", title: "Set pribora za jelo, Plavi Zmaj", totalInventory: 50 },
    { handle: "robot", title: "Set pribora za jelo, Zeleni Robot", totalInventory: 50 },
  ];
  const result = only(matchCatalog(pik, katalog));
  assert.equal(result.decision, "review");
  assert.ok(result.candidates.length >= 2);
});

test("nepovezan oglas daje no_match, ne nasilan par", () => {
  const pik: PikItem[] = [{ id: 3, title: "Mobitel Alpha X22 Ultra", sku: null }];
  const katalog: KatalogItem[] = [
    { handle: "podmetaci", title: "Podmetači za stol, mix dezena", totalInventory: 146 },
    { handle: "baloni", title: "Baloni Fiesta Nova, mješoviti oblici", totalInventory: 50 },
  ];
  const result = only(matchCatalog(pik, katalog));
  assert.equal(result.decision, "no_match");
  assert.equal(result.shopifyHandle, undefined);
});

test("override sa ignore iskljucuje bundle oglase bez pandana", () => {
  const pik: PikItem[] = [{ id: 1005, title: "Mix paleta - 3000 raznih artikala (veleprodaja)", sku: null }];
  const katalog: KatalogItem[] = [{ handle: "baloni", title: "Baloni Fiesta Nova", totalInventory: 50 }];
  const result = only(matchCatalog(pik, katalog, {
    overrides: { "1005": { ignore: true, note: "paleta, nema pandan" } },
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
  const katalog: KatalogItem[] = [
    { handle: "vega-norda-m0221", title: "Vega NORDA planinarske vodootporne cipele S3", skus: ["CA-M0221-CWA-39"], totalInventory: 61 },
    { handle: "vega-kvarc", title: "Vega KVARC planinarske vodootporne cipele S1P", skus: ["CA-M0474-PWE-36"], totalInventory: 217 },
    { handle: "futrole-mix-dezena", title: "Futrole za naocale, mix dezena", totalInventory: 4536 },
    { handle: "podmetaci-za-stol", title: "Podmetači za stol, mix dezena", totalInventory: 146 },
    { handle: "stolnjaci-i-museme", title: "Stolnjaci i mušeme, mix dezena", totalInventory: 146 },
    { handle: "jastuci-za-stolice", title: "Jastuci za stolice, mix dezena", totalInventory: 100 },
  ];
  const pik: PikItem[] = [
    { id: 1006, title: "Futrole za naocale, mix dezena", sku: null },
    { id: 1007, title: "Podmetači za stol, mix dezena", sku: null },
    { id: 1008, title: "Stolnjaci i mušeme, mix dezena", sku: null },
    { id: 1009, title: "Jastuci za stolice, mix dezena", sku: null },
    { id: 1003, title: "VEGA NORDA planinarske cipele vodootporne S3", sku: "M0221" },
  ];
  const ocekivano: Record<string, string> = {
    "1006": "futrole-mix-dezena",
    "1007": "podmetaci-za-stol",
    "1008": "stolnjaci-i-museme",
    "1009": "jastuci-za-stolice",
    "1003": "vega-norda-m0221",
  };

  const results = matchCatalog(pik, katalog);
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
