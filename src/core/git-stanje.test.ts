import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrap, commitIPush, danaDoIsteka, git, imeGrane, masinaSePoklapa, postavkeStanja, procitajMasinu, uKlonu } from "./git-stanje.js";

// Sve ide preko lokalnog bare repoa: bez mreze, bez tokena, isto na macOS i Windowsu.
const IMA_GIT = git(null, ["--version"]).kod === 0;
const opcije = IMA_GIT ? {} : { skip: "git nije dostupan na ovoj masini" };

function daljinski(): string {
  const put = mkdtempSync(join(tmpdir(), "olx-daljinski-"));
  git(null, ["init", "--bare", put]);
  return put;
}

function novaRadna(): string {
  return join(mkdtempSync(join(tmpdir(), "olx-radna-")), "kopija");
}

test("ime grane se cisti, jer ulazi u ref", () => {
  assert.equal(imeGrane("MixBox"), "mixbox");
  assert.equal(imeGrane("neko ime.sa/kosom"), "neko-ime-sa-kosom");
  assert.equal(imeGrane("  "), "bez-imena");
  assert.equal(imeGrane("--x--"), "x");
});

test("postavke traze ime klijenta i repo, i ne pogadjaju ih", () => {
  // Ime iz foldera bi znacilo da preimenovanje foldera tiho pokrene novu praznu granu.
  assert.throws(() => postavkeStanja({ OLX_STANJE_REPO: "x" } as NodeJS.ProcessEnv, "/dom"), /OLX_KLIJENT/);
  assert.throws(() => postavkeStanja({ OLX_KLIJENT: "MixBox" } as NodeJS.ProcessEnv, "/dom"), /OLX_STANJE_REPO/);

  const p = postavkeStanja({ OLX_KLIJENT: "MixBox", OLX_STANJE_REPO: "git@x:y.git" } as NodeJS.ProcessEnv, "/dom");
  assert.equal(p.grana, "mixbox");
  assert.equal(p.radna, join("/dom", "olx-stanje", "mixbox"));
});

test("radna kopija unutar klona se odbija, jer bi zaustavila sva buduca azuriranja", () => {
  // Azurirac preskace svaki klon sa lokalnim izmjenama. Radna kopija unutra znaci da klijent
  // nikad vise ne dobije novu verziju, i to bez ijedne greske.
  const osnovno = { OLX_KLIJENT: "mixbox", OLX_STANJE_REPO: "git@x:y.git" };
  assert.throws(
    () => postavkeStanja({ ...osnovno, OLX_STANJE_RADNA: "/klon/mixbox/.olx-stanje" } as NodeJS.ProcessEnv, "/dom", "/klon/mixbox"),
    /unutar klona/,
  );
  assert.throws(() => postavkeStanja({ ...osnovno, OLX_STANJE_RADNA: "/klon/mixbox" } as NodeJS.ProcessEnv, "/dom", "/klon/mixbox"), /unutar klona/);
  assert.equal(
    postavkeStanja({ ...osnovno, OLX_STANJE_RADNA: "/dom/olx-stanje/mixbox" } as NodeJS.ProcessEnv, "/dom", "/klon/mixbox").radna,
    "/dom/olx-stanje/mixbox",
  );
  // Folder pored klona sa slicnim imenom nije unutar klona.
  assert.equal(uKlonu("/klon/mixbox-stanje", "/klon/mixbox"), false);
});

test("brana vidi kroz simbolicki link", opcije, () => {
  // Uhvaceno u probi: na macOS-u je /tmp link na /private/tmp, pa isti folder ima dva imena i
  // golo poredjenje putanja kaze da je radna kopija van klona kad jeste unutra.
  const stvarni = mkdtempSync(join(tmpdir(), "olx-klon-"));
  const preko = mkdtempSync(join(tmpdir(), "olx-link-"));
  const link = join(preko, "klon");
  symlinkSync(stvarni, link, "dir");
  assert.equal(uKlonu(join(link, "unutra"), stvarni), true, "isti folder preko linka mora biti prepoznat");
  assert.equal(uKlonu(join(stvarni, "unutra"), link), true, "i obrnuto");
});

test("istek tokena se broji unaprijed, jer istekao token tiho ubija backup", () => {
  const danas = new Date("2026-07-30T10:00:00Z");
  assert.equal(danaDoIsteka("2026-08-13", danas), 14);
  assert.equal(danaDoIsteka("2026-07-29", danas), -1);
  assert.equal(danaDoIsteka(undefined, danas), null);
  assert.equal(danaDoIsteka("nije datum", danas), null);
});

test("prvi bootstrap pravi granu, drugi je zatekne", opcije, () => {
  const url = daljinski();
  const radna = novaRadna();
  assert.equal(bootstrap(radna, url, "mixbox", "/klon/mixbox"), "napravljeno");
  assert.ok(existsSync(join(radna, ".gitattributes")), "bez -text bi Windows tiho mijenjao krajeve linija");
  assert.equal(procitajMasinu(radna)?.klon, "/klon/mixbox");
  assert.equal(bootstrap(radna, url, "mixbox", "/klon/mixbox"), "zateceno");
});

test("druga masina klonira postojecu granu, ne pravi novu", opcije, () => {
  const url = daljinski();
  const prva = novaRadna();
  bootstrap(prva, url, "mixbox", "/klon/mixbox");
  const druga = novaRadna();
  assert.equal(bootstrap(druga, url, "mixbox", "/klon/mixbox"), "klonirano");
});

test("radna kopija na pogresnoj grani se prijavljuje, ne popravlja tiho", opcije, () => {
  const url = daljinski();
  const radna = novaRadna();
  bootstrap(radna, url, "mixbox", "/klon/mixbox");
  assert.throws(() => bootstrap(radna, url, "drugi-klijent", "/klon/drugi"), /ocekuje se/);
});

test("bez promjena nema praznog commita", opcije, () => {
  // Ovo je bila stvarna greska u dizajnu: MASINA.json nosi vrijeme, pa bi se svakog dana pravio
  // commit i kad se nijedan podatak nije promijenio, a istorija bi prestala govoriti kad se
  // stanje zaista mijenjalo.
  const url = daljinski();
  const radna = novaRadna();
  bootstrap(radna, url, "mixbox", "/klon/mixbox");
  assert.equal(commitIPush(radna, "mixbox", "prvi", "/klon/mixbox").vrsta, "nista-novo");
  assert.equal(commitIPush(radna, "mixbox", "drugi", "/klon/mixbox").vrsta, "nista-novo");
});

test("promjena se salje i vidi se na daljinskom", opcije, () => {
  const url = daljinski();
  const radna = novaRadna();
  bootstrap(radna, url, "mixbox", "/klon/mixbox");
  writeFileSync(join(radna, "pamcenje.json"), '{"ton":"na ti"}', "utf8");
  const r = commitIPush(radna, "mixbox", "stanje 2026-07-30", "/klon/mixbox");
  assert.equal(r.vrsta, "poslano");

  const provjera = novaRadna();
  bootstrap(provjera, url, "mixbox", "/klon/mixbox");
  assert.ok(existsSync(join(provjera, "pamcenje.json")), "poslano stanje mora postojati na daljinskom");
});

test("razilazenje ide na granu sudara, bez spajanja i bez force", opcije, () => {
  const url = daljinski();
  const prva = novaRadna();
  bootstrap(prva, url, "mixbox", "/klon/mixbox");
  commitIPush(prva, "mixbox", "prvi upis", "/klon/mixbox");

  const druga = novaRadna();
  bootstrap(druga, url, "mixbox", "/klon/mixbox");

  // Obje masine pisu svoje, prva stigne prva.
  writeFileSync(join(prva, "a.json"), "1", "utf8");
  commitIPush(prva, "mixbox", "prva masina", "/klon/mixbox");
  writeFileSync(join(druga, "b.json"), "2", "utf8");
  const r = commitIPush(druga, "mixbox", "druga masina", "/klon/mixbox-drugdje");

  assert.equal(r.vrsta, "sudar");
  assert.ok(r.vrsta === "sudar" && r.grana.startsWith("mixbox-sudar-"), `grana sudara je ${JSON.stringify(r)}`);

  // Nista se ne gubi: obje verzije postoje na daljinskom.
  const grane = git(null, ["ls-remote", "--heads", url]).izlaz;
  assert.ok(grane.includes("refs/heads/mixbox"), "prvobitna grana ostaje netaknuta");
  assert.ok(grane.includes("-sudar-"), "stanje druge masine je spaseno");
});

test("tudja masina na grani zaustavlja posao prije commita", opcije, () => {
  const url = daljinski();
  const prva = novaRadna();
  bootstrap(prva, url, "mixbox", "/klon/na-macu");
  commitIPush(prva, "mixbox", "upis sa maca", "/klon/na-macu");

  const druga = novaRadna();
  bootstrap(druga, url, "mixbox", "/klon/na-windowsu");
  const nalaz = masinaSePoklapa(druga, "mixbox", "/klon/na-windowsu");
  assert.equal(nalaz.ok, false, "ista grana sa dvije putanje klona mora stati");
  assert.equal(nalaz.tudja?.klon, "/klon/na-macu");
});

test("prazna grana znaci prvi upis, ne sudar", opcije, () => {
  const url = daljinski();
  const radna = novaRadna();
  bootstrap(radna, url, "mixbox", "/klon/mixbox");
  assert.equal(masinaSePoklapa(radna, "nepostojeca-grana", "/klon/mixbox").ok, true);
});
