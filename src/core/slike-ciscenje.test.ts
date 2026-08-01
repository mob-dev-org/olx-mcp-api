import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { nasaSlika, odgodaMs, oznaciPotrosene, pocistiPotrosene, putanjaPotrosenih, zaBrisanje } from "./slike-ciscenje.js";

/** Privremeni klon: mape koje modul smatra svojima plus popis potrosenih. */
function klon(): { dir: string; env: NodeJS.ProcessEnv; slika: (ime: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "slike-ciscenje-"));
  const slikeDir = join(dir, "slike");
  mkdirSync(slikeDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    OLX_SLIKA_DIR: slikeDir,
    OLX_SLIKE_POTROSENE_FILE: join(dir, "potrosene.json"),
    CLAUDE_CONFIG_DIR: join(dir, "runtime"),
  };
  return {
    dir,
    env,
    slika: (ime) => {
      const p = join(slikeDir, ime);
      writeFileSync(p, "x");
      return p;
    },
  };
}

test("zaBrisanje uzima samo one kojima je odgoda istekla", () => {
  const zapis = { "/a.jpg": 1000, "/b.jpg": 5000, "/c.jpg": 9000 };
  // sada = 10000, odgoda = 5000 -> dozrelo je sve oznaceno u 5000 ili ranije
  assert.deepEqual(zaBrisanje(zapis, 10_000, 5_000).sort(), ["/a.jpg", "/b.jpg"]);
});

test("zaBrisanje na granici odgode brise, ne ceka jos jedan krug", () => {
  assert.deepEqual(zaBrisanje({ "/a.jpg": 1000 }, 6_000, 5_000), ["/a.jpg"]);
  assert.deepEqual(zaBrisanje({ "/a.jpg": 1000 }, 5_999, 5_000), []);
});

test("zaBrisanje na praznom popisu ne pada", () => {
  assert.deepEqual(zaBrisanje({}, Date.now(), 1000), []);
});

test("odgoda je sat vremena dok se ne kaze drugacije", () => {
  assert.equal(odgodaMs({}), 60 * 60_000);
  assert.equal(odgodaMs({ OLX_SLIKE_ODGODA_MIN: "5" }), 5 * 60_000);
  // besmislena vrijednost ne smije dati NaN i obrisati sve odmah
  assert.equal(odgodaMs({ OLX_SLIKE_ODGODA_MIN: "kasnije" }), 60 * 60_000);
  assert.equal(odgodaMs({ OLX_SLIKE_ODGODA_MIN: "-10" }), 60 * 60_000);
});

test("nasa je samo slika iz mapa koje pogon sam pravi", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.ok(nasaSlika(join(env.OLX_SLIKA_DIR!, "a.png"), env));
  assert.ok(nasaSlika(join(env.CLAUDE_CONFIG_DIR!, "channels", "telegram", "inbox", "b.jpg"), env));
  // Ovo je glavna brana: upload smije dobiti bilo koju putanju sa masine.
  assert.equal(nasaSlika("/Users/neko/Slike/vjencanje.jpg", env), false);
  // Susjedna mapa slicnog imena ne smije proci kao nasa.
  assert.equal(nasaSlika(`${env.OLX_SLIKA_DIR}-stare/a.png`, env), false);
});

test("oznacavaju se samo nase slike, tudje se tiho preskacu", (t) => {
  const { dir, env, slika } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const nasa = slika("nasa.jpg");
  const tudja = join(dir, "tudja.jpg");
  writeFileSync(tudja, "x");

  assert.equal(oznaciPotrosene([nasa, tudja], 1000, env), 1);
  const zapis = JSON.parse(readFileSync(putanjaPotrosenih(env), "utf8"));
  assert.deepEqual(Object.keys(zapis), [resolve(nasa)]);
});

test("pocistiPotrosene brise tek kad odgoda prodje", (t) => {
  const { dir, env, slika } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  env.OLX_SLIKE_ODGODA_MIN = "60";

  const putanja = slika("a.jpg");
  oznaciPotrosene([putanja], 0, env);

  // Pola sata poslije upload jos moze biti ponovljen, fajl mora biti tu.
  assert.equal(pocistiPotrosene(30 * 60_000, env), 0);
  assert.ok(existsSync(putanja));

  assert.equal(pocistiPotrosene(61 * 60_000, env), 1);
  assert.equal(existsSync(putanja), false);
  // Popis se prazni, da ne raste unedogled.
  assert.deepEqual(JSON.parse(readFileSync(putanjaPotrosenih(env), "utf8")), {});
});

test("pocistiPotrosene ne dira fajl koji je u medjuvremenu ispao iz nasih mapa", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  env.OLX_SLIKE_ODGODA_MIN = "0";

  // Rucno podmetnut popis, kao da ga je neko izmijenio na disku.
  const tudja = join(dir, "tudja.jpg");
  writeFileSync(tudja, "x");
  writeFileSync(putanjaPotrosenih(env), JSON.stringify({ [tudja]: 0 }));

  assert.equal(pocistiPotrosene(10_000, env), 0);
  assert.ok(existsSync(tudja), "fajl van nasih mapa se ne smije obrisati ni kad je na popisu");
});

test("pokvaren popis ne obara posao", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(putanjaPotrosenih(env), "{ ovo nije json");
  assert.equal(pocistiPotrosene(Date.now(), env), 0);
  assert.equal(oznaciPotrosene([], Date.now(), env), 0);
});

test("bez popisa na disku ciscenje je bez posla", (t) => {
  const { dir, env } = klon();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(pocistiPotrosene(Date.now(), env), 0);
});
