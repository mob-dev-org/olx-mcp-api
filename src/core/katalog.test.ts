// Testovi citanja vanjskog kataloga. Bitno je da razliciti izvozi (Shopify JSON, CSV iz
// WooCommerce ili ERP-a, lokalizovani brojevi) daju isti oblik, i da prazna zaliha ostane
// nepoznata umjesto da postane nula, jer bi nula znacila "nema na stanju".

import assert from "node:assert/strict";
import { test } from "node:test";
import { brojIliNull, katalogIzCsv, katalogIzJson, parseCsv } from "./katalog.js";

test("brojIliNull prihvata decimalni zarez i razmake, a prazno ostavlja nepoznato", () => {
  assert.equal(brojIliNull("12,50"), 12.5, "lokalizovani izvoz salje zarez");
  assert.equal(brojIliNull("1 250"), 1250, "razmak kao separator hiljada");
  assert.equal(brojIliNull(7), 7);
  assert.equal(brojIliNull("0"), 0, "nula je stvarna vrijednost, ne nepoznato");
  assert.equal(brojIliNull(""), null);
  assert.equal(brojIliNull("   "), null);
  assert.equal(brojIliNull("nema"), null);
  assert.equal(brojIliNull(undefined), null);
});

test("parseCsv postuje navodnike, dvostruke navodnike i CRLF", () => {
  const redovi = parseCsv('sifra,naziv\r\nA1,"Cipele, ljetne"\r\nA2,"Natpis ""AKCIJA"" na kutiji"\r\n');
  assert.deepEqual(redovi, [
    ["sifra", "naziv"],
    ["A1", "Cipele, ljetne"],
    ["A2", 'Natpis "AKCIJA" na kutiji'],
  ]);
});

test("CSV katalog prepoznaje kolone bez obzira na pisanje", () => {
  const artikli = katalogIzCsv("SKU , Naziv ,Kolicina,Cijena\nM0221,Cipele Norda,61,129,90\n");
  // Kolona cijene ovdje ima zarez unutar broja bez navodnika, pa se red lomi na vise polja;
  // citac uzima kolone po poziciji, sto znaci da cijena ostaje nepoznata a ne pogresna.
  assert.equal(artikli.length, 1);
  assert.equal(artikli[0]?.handle, "M0221");
  assert.equal(artikli[0]?.title, "Cipele Norda");
  assert.equal(artikli[0]?.totalInventory, 61);
});

test("CSV katalog cita zalihu i cijenu iz engleskih zaglavlja", () => {
  const artikli = katalogIzCsv('sku,name,stock,price\nP4120,Carape zimske,"12","19,90"\n');
  assert.equal(artikli[0]?.handle, "P4120");
  assert.equal(artikli[0]?.title, "Carape zimske");
  assert.equal(artikli[0]?.totalInventory, 12);
  assert.equal(artikli[0]?.price, 19.9);
  assert.deepEqual(artikli[0]?.skus, ["P4120"]);
});

test("CSV bez zalihe ostavlja nepoznato, ne nulu", () => {
  const artikli = katalogIzCsv("sifra,naziv,zaliha\nA1,Prvi,\nA2,Drugi,0\n");
  assert.equal(artikli[0]?.totalInventory, null, "prazna celija je nepoznato");
  assert.equal(artikli[1]?.totalInventory, 0, "izricita nula je nema na stanju");
});

test("CSV bez sifre i naziva se odbija sa jasnom porukom", () => {
  assert.throws(
    () => katalogIzCsv("kolona1,kolona2\nx,y\n", "moj.csv"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /kolonu sifra ili naziv/);
      assert.match(err.message, /kolona1/, "greska pokazuje sta je nadjeno u zaglavlju");
      return true;
    },
  );
});

test("JSON katalog radi i sa engleskim i sa neutralnim imenima polja", () => {
  const engleski = katalogIzJson([
    { handle: "vega-norda-m0221", title: "Vega NORDA cipele", skus: ["CA-M0221-CWA-39"], totalInventory: 61, price: 129.9 },
  ]);
  assert.equal(engleski[0]?.handle, "vega-norda-m0221");
  assert.equal(engleski[0]?.totalInventory, 61);
  assert.equal(engleski[0]?.price, 129.9);

  const neutralni = katalogIzJson({
    products: [{ sifra: "M0221", naziv: "Vega NORDA cipele", zaliha: "61", cijena: "129,90" }],
  });
  assert.equal(neutralni[0]?.handle, "M0221");
  assert.equal(neutralni[0]?.title, "Vega NORDA cipele");
  assert.equal(neutralni[0]?.totalInventory, 61);
  assert.equal(neutralni[0]?.price, 129.9);
  assert.deepEqual(neutralni[0]?.skus, ["M0221"], "sifra sluzi i kao SKU za spajanje");
});

test("JSON koji nije katalog se odbija", () => {
  assert.throws(
    () => katalogIzJson({ nesto: true }, "moj.json"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /nije niz artikala/);
      return true;
    },
  );
});
