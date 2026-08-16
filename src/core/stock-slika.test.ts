// Testovi brana referentne (stock) slike. Svaka od njih stoji zbog konkretne stete koju sprjecava,
// pa je i test pisan kao pokusaj zaobilaska, ne kao provjera srecnog puta.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  dozvoljeniHostovi,
  prepoznajSliku,
  preuzmiKandidata,
  provjeriStanjeArtikla,
  provjeriUrl,
  traziKandidate,
  ZADANI_HOSTOVI,
} from "./stock-slika.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

test("provjeriUrl pusta samo https sa hosta koji je DOSLOVNO na spisku", () => {
  assert.equal(provjeriUrl("https://upload.wikimedia.org/a/b.jpg").ok, true);
  assert.equal(provjeriUrl("https://commons.wikimedia.org/a/b.jpg").ok, false);
});

test("provjeriUrl odbija file: i data: sheme, jer bi citale disk servera i zaobisle host", () => {
  const f = provjeriUrl("file:///etc/passwd");
  assert.equal(f.ok, false);
  assert.match(f.ok === false ? f.razlog : "", /shema/);
  assert.equal(provjeriUrl("data:image/png;base64,AAAA").ok, false);
  assert.equal(provjeriUrl("http://upload.wikimedia.org/a.jpg").ok, false);
});

test("provjeriUrl ne nasjeda na host koji dozvoljeni samo SADRZI kao prefiks ili sufiks", () => {
  assert.equal(provjeriUrl("https://upload.wikimedia.org.napadac.com/a.jpg").ok, false);
  assert.equal(provjeriUrl("https://zloupload.wikimedia.org/a.jpg").ok, false);
  assert.equal(provjeriUrl("https://napadac.com/upload.wikimedia.org/a.jpg").ok, false);
});

test("provjeriUrl odbija korisnika i lozinku u URL-u", () => {
  const r = provjeriUrl("https://ko:sta@upload.wikimedia.org/a.jpg");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.razlog : "", /korisnika ili lozinku/);
});

test("provjeriUrl odbija neispravan URL umjesto da baci", () => {
  assert.equal(provjeriUrl("ovo nije url").ok, false);
});

test("dozvoljeniHostovi: .env smije dopisati host, ali zadani ostaju", () => {
  assert.deepEqual(dozvoljeniHostovi({}), [...ZADANI_HOSTOVI]);
  const prosireni = dozvoljeniHostovi({ OLX_STOCK_HOSTOVI: "slike.primjer.ba, drugi.primjer.ba" });
  assert.ok(prosireni.includes("upload.wikimedia.org"));
  assert.ok(prosireni.includes("slike.primjer.ba"));
  assert.ok(prosireni.includes("drugi.primjer.ba"));
  assert.equal(provjeriUrl("https://slike.primjer.ba/a.jpg", prosireni).ok, true);
});

test("prepoznajSliku gleda MAGIC BAJTOVE, pa HTML stranicu greske ne proglasi slikom", () => {
  assert.equal(prepoznajSliku(JPEG), "image/jpeg");
  assert.equal(prepoznajSliku(PNG), "image/png");
  assert.equal(prepoznajSliku(Buffer.from("<!DOCTYPE html>\n<html lang=\"en\">")), null);
  assert.equal(prepoznajSliku(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")), null);
  assert.equal(prepoznajSliku(Buffer.from([1, 2, 3])), null);
});

test("prepoznajSliku prepoznaje webp tek kad su OBA potpisa na mjestu", () => {
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);
  assert.equal(prepoznajSliku(webp), "image/webp");
  const samoRiff = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0]);
  assert.equal(prepoznajSliku(samoRiff), null);
});

test("provjeriStanjeArtikla: polovan artikal se odbija bez obzira na potvrdu", () => {
  const r = provjeriStanjeArtikla({ state: "used", stanje: "new", confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.razlog : "", /polovan/);
  assert.equal(provjeriStanjeArtikla({ stanje: "used", confirm: true }).ok, false);
});

test("provjeriStanjeArtikla: nepoznato stanje se NE tumaci u korist prolaza", () => {
  const r = provjeriStanjeArtikla({});
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.razlog : "", /nije poznato/);
  assert.equal(provjeriStanjeArtikla({ confirm: true }).ok, false);
});

test("provjeriStanjeArtikla: izricito novo prolazi tek uz potvrdu", () => {
  assert.equal(provjeriStanjeArtikla({ stanje: "new" }).ok, false);
  assert.equal(provjeriStanjeArtikla({ stanje: "new", confirm: true }).ok, true);
  // stanje procitano sa postojeceg oglasa je podatak platforme, ne tvrdnja iz razgovora
  assert.equal(provjeriStanjeArtikla({ state: "new" }).ok, true);
});

test("traziKandidate izbacuje SVG i vraca licencu i autora bez HTML-a", async () => {
  const odgovor = {
    query: {
      pages: {
        "1": {
          title: "File:Telefon.jpg",
          imageinfo: [
            {
              thumburl: "https://upload.wikimedia.org/thumb/telefon.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Telefon.jpg",
              mime: "image/jpeg",
              thumbwidth: 1200,
              thumbheight: 900,
              size: 133799,
              extmetadata: {
                LicenseShortName: { value: "CC BY-SA 4.0" },
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Neko">Neko Ime</a>' },
              },
            },
          ],
        },
        "2": {
          title: "File:Telefon.svg",
          imageinfo: [{ thumburl: "https://upload.wikimedia.org/telefon.svg", mime: "image/svg+xml" }],
        },
      },
    },
  };
  const kandidati = await traziKandidate("telefon", {
    fetchFn: (async () => new Response(JSON.stringify(odgovor), { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(kandidati.length, 1);
  assert.equal(kandidati[0]!.naslov, "Telefon.jpg");
  assert.equal(kandidati[0]!.licenca, "CC BY-SA 4.0");
  assert.equal(kandidati[0]!.autor, "Neko Ime");
});

test("preuzmiKandidata odbija URL van spiska prije nego uopste dodirne mrezu", async () => {
  let zvano = false;
  await assert.rejects(
    preuzmiKandidata("https://napadac.com/a.jpg", tmpdir(), {
      fetchFn: (async () => {
        zvano = true;
        return new Response(JPEG, { status: 200 });
      }) as unknown as typeof fetch,
    }),
    /nije na spisku dozvoljenih/,
  );
  assert.equal(zvano, false, "fetch se ne smije ni pozvati za host van spiska");
});

test("preuzmiKandidata ne prati preusmjerenja, jer bi ona izvela van spiska", async () => {
  await assert.rejects(
    preuzmiKandidata("https://upload.wikimedia.org/a.jpg", tmpdir(), {
      fetchFn: (async () =>
        new Response(null, { status: 302, headers: { location: "https://napadac.com/a.jpg" } })) as unknown as typeof fetch,
    }),
    /preusmjerava/,
  );
});

test("preuzmiKandidata odbija sadrzaj koji nije slika, iako je stigao sa dozvoljenog hosta", async () => {
  await assert.rejects(
    preuzmiKandidata("https://upload.wikimedia.org/a.jpg", tmpdir(), {
      fetchFn: (async () =>
        new Response("<!DOCTYPE html><html><body>greska</body></html>", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })) as unknown as typeof fetch,
    }),
    /nije slika/,
  );
});

test("preuzmiKandidata odbija preveliku sliku iz najave i iz stvarnog tijela", async () => {
  await assert.rejects(
    preuzmiKandidata("https://upload.wikimedia.org/a.jpg", tmpdir(), {
      fetchFn: (async () =>
        new Response(JPEG, { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } })) as unknown as typeof fetch,
    }),
    /granica je/,
  );
});

test("preuzmiKandidata upise sliku i vrati izvorni URL za trag", async () => {
  const mapa = mkdtempSync(join(tmpdir(), "stock-"));
  try {
    const r = await preuzmiKandidata("https://upload.wikimedia.org/a.jpg", mapa, {
      fetchFn: (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch,
    });
    assert.equal(r.mime, "image/png");
    assert.equal(r.bajtova, PNG.length);
    assert.match(r.putanja, /\.png$/);
    assert.equal(r.izvorUrl, "https://upload.wikimedia.org/a.jpg");
    assert.deepEqual(readFileSync(r.putanja), PNG);
  } finally {
    rmSync(mapa, { recursive: true, force: true });
  }
});
