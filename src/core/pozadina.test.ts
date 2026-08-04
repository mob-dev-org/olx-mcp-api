import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  POZADINA_OPIS_MAX,
  mapaPozadine,
  obrisiPozadinu,
  opisZaRecept,
  putanjaPozadine,
  sacuvajPozadinu,
  sazetakPozadine,
  ucitajPozadinu,
} from "./pozadina.js";

function klon(): { dir: string; env: NodeJS.ProcessEnv; fotografija: (ime: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "pozadina-"));
  return {
    dir,
    env: { OLX_POZADINA_DIR: join(dir, "pozadina") },
    fotografija: (ime) => {
      const p = join(dir, ime);
      writeFileSync(p, "x");
      return p;
    },
  };
}

test("bez postavke pozadine nema", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(ucitajPozadinu(env), null);
});

test("prazna postavka se odbija, ne pravi prazan zapis", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const nalaz = sacuvajPozadinu({}, "2026-07-31T10:00:00.000Z", env);
  assert.equal(nalaz.ok, false);
  assert.equal(existsSync(putanjaPozadine(env)), false);
});

test("pozadina samo od opisa radi bez ikakve slike", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const nalaz = sacuvajPozadinu({ opis: "svijetlo sivi beton" }, "2026-07-31T10:00:00.000Z", env);
  assert.ok(nalaz.ok);
  const p = ucitajPozadinu(env);
  assert.equal(p?.opis, "svijetlo sivi beton");
  assert.equal(p?.slika, undefined);
  assert.equal(opisZaRecept(p!), "svijetlo sivi beton");
});

test("slika pozadine se KOPIRA u klon, da original smije nestati iz inboxa", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const izvor = fotografija("iz-inboxa.jpg");
  const nalaz = sacuvajPozadinu({ izvorSlike: izvor }, "2026-07-31T10:00:00.000Z", env);
  assert.ok(nalaz.ok);

  // Original nestaje, kao sto ga ciscenje slika i obrise.
  rmSync(izvor);
  const p = ucitajPozadinu(env);
  assert.ok(p?.slika && existsSync(p.slika), "kopija u klonu mora prezivjeti brisanje originala");
});

test("nova pozadina zamjenjuje staru, ne ostavlja dvije", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ izvorSlike: fotografija("prva.jpg") }, "2026-07-31T10:00:00.000Z", env);
  sacuvajPozadinu({ izvorSlike: fotografija("druga.png") }, "2026-07-31T11:00:00.000Z", env);

  const slike = readdirSync(mapaPozadine(env)).filter((i) => i.startsWith("slika."));
  assert.deepEqual(slike, ["slika.png"], "razlicita ekstenzija ne smije ostaviti staru sliku");
});

test("nepodrzan format i nepostojeci fajl se odbijaju sa razlogom", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const pdf = fotografija("uputa.pdf");
  const nalazPdf = sacuvajPozadinu({ izvorSlike: pdf }, "2026-07-31T10:00:00.000Z", env);
  assert.equal(nalazPdf.ok, false);
  if (!nalazPdf.ok) assert.match(nalazPdf.razlog, /nepodrzan format/);

  const nalazNema = sacuvajPozadinu({ izvorSlike: join(dir, "nema.jpg") }, "2026-07-31T10:00:00.000Z", env);
  assert.equal(nalazNema.ok, false);
  if (!nalazNema.ok) assert.match(nalazNema.razlog, /ne postoji/);
});

test("opisZaRecept pokazuje na POSLJEDNJU sliku, jer artikala moze biti vise", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ izvorSlike: fotografija("p.jpg") }, "2026-07-31T10:00:00.000Z", env);
  const samoSlika = opisZaRecept(ucitajPozadinu(env)!);
  assert.match(samoSlika, /LAST image/);
  // Redni broj se ne smije pominjati: klijent smije poslati vise fotografija artikla.
  assert.ok(!/second image/i.test(samoSlika));

  sacuvajPozadinu({ izvorSlike: fotografija("p2.jpg"), opis: "hrastov stol" }, "2026-07-31T11:00:00.000Z", env);
  const oboje = opisZaRecept(ucitajPozadinu(env)!);
  assert.match(oboje, /LAST image/);
  assert.match(oboje, /hrastov stol/);
});

test("pokvaren zapis se cita kao da pozadine nema", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ opis: "beton" }, "2026-07-31T10:00:00.000Z", env);
  writeFileSync(putanjaPozadine(env), "{ nije json");
  assert.equal(ucitajPozadinu(env), null);
});

test("zapis koji pokazuje na nestalu sliku ne vraca tu sliku", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ izvorSlike: fotografija("p.jpg"), opis: "beton" }, "2026-07-31T10:00:00.000Z", env);
  rmSync(join(mapaPozadine(env), "slika.jpg"));

  const p = ucitajPozadinu(env);
  assert.equal(p?.slika, undefined, "nestala slika ne smije ostati u zapisu");
  assert.equal(p?.opis, "beton", "opis prezivljava nestalu sliku");
});

test("obrisiPozadinu javlja da li je nesto bilo postavljeno", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(obrisiPozadinu(env), false);
  sacuvajPozadinu({ opis: "beton" }, "2026-07-31T10:00:00.000Z", env);
  assert.equal(obrisiPozadinu(env), true);
  assert.equal(ucitajPozadinu(env), null);
});

test("sazetak govori covjeku sta je postavljeno", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ izvorSlike: fotografija("p.jpg"), opis: "beton" }, "2026-07-31T10:00:00.000Z", env);
  const sazetak = sazetakPozadine(ucitajPozadinu(env)!);
  assert.match(sazetak, /slika/);
  assert.match(sazetak, /beton/);
});

test("opis pozadine smije biti duzi od dopune na receptu", () => {
  assert.ok(POZADINA_OPIS_MAX > 100, "inace nema smisla imati zasebnu granicu");
});

test("slot: postavlja se uz sliku, nova slika ga ne resetuje, samo-slot dopunjava postojecu", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r1 = sacuvajPozadinu(
    { izvorSlike: fotografija("p.jpg"), slot: { sirinaPosto: 60, marginaDnaPosto: 12 } },
    "2026-08-04T10:00:00.000Z",
    env,
  );
  assert.ok(r1.ok);
  assert.deepEqual(r1.pozadina.slot, { sidro: "dno-sredina", sirinaPosto: 60, marginaDnaPosto: 12 });

  // zamjena slike bez slota: odluka o polozaju ostaje
  const r2 = sacuvajPozadinu({ izvorSlike: fotografija("nova.png") }, "2026-08-04T11:00:00.000Z", env);
  assert.ok(r2.ok);
  assert.equal(r2.pozadina.slot?.sirinaPosto, 60);

  // samo slot: dopuna bez diranja slike
  const r3 = sacuvajPozadinu({ slot: { marginaDnaPosto: 5 } }, "2026-08-04T12:00:00.000Z", env);
  assert.ok(r3.ok);
  assert.equal(r3.pozadina.slot?.marginaDnaPosto, 5);
  assert.equal(r3.pozadina.slot?.sirinaPosto, 60, "nedirnuto polje ostaje");
  assert.ok(r3.pozadina.slika, "slika je i dalje tu");
});

test("slot: neispravan raspon pada, samo-slot bez pozadine pada sa uputom", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const bezPozadine = sacuvajPozadinu({ slot: { sirinaPosto: 50 } }, "2026-08-04T10:00:00.000Z", env);
  assert.ok(!bezPozadine.ok && /prvo zadaj sliku/.test(bezPozadine.razlog));

  const losRaspon = sacuvajPozadinu(
    { izvorSlike: fotografija("p.jpg"), slot: { sirinaPosto: 95 } },
    "2026-08-04T10:00:00.000Z",
    env,
  );
  assert.ok(!losRaspon.ok && /10 do 90/.test(losRaspon.razlog));
});

test("slot: stari zapis bez slota se cita bez slota, pokvaren slot ne obara citanje", (t) => {
  const { dir, env, fotografija } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  sacuvajPozadinu({ izvorSlike: fotografija("p.jpg"), opis: "beton" }, "2026-07-31T10:00:00.000Z", env);
  // simulacija starog izdanja: zapis bez slota, odnosno sa pokvarenim slotom
  const fajl = putanjaPozadine(env);
  writeFileSync(fajl, JSON.stringify({ opis: "beton", slika: "slika.jpg", postavljeno: "x" }));
  assert.equal(ucitajPozadinu(env)?.slot, undefined, "stari zapis radi, slot se primijeni kasnije kao zadani");

  writeFileSync(fajl, JSON.stringify({ opis: "beton", slika: "slika.jpg", slot: { sirinaPosto: "sve" } }));
  const p = ucitajPozadinu(env);
  assert.ok(p, "pokvaren slot ne obara pozadinu");
  assert.equal(p.slot, undefined);
});
