// Testovi zajednickog nalazaca spiska klonova flote. Isti stil kao resursi.test.mjs i
// straza.test.mjs: node:test + node:assert/strict, lazne fs funkcije kao obicni JS
// objekti/mape, bez pravog diska i bez pravih procesa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { nadjiKlonove, listajPodmapeSaOlxPik, parsirajPopis, pronadjiUgnijezdeneKopije } from "./klonovi.mjs";

// ---- pomocnici ----

// Lazni readdirSync: mapa rootDir -> niz Dirent-like objekata ({ name, isDirectory() }), ili
// Error da simulira neuspjeh (root ne postoji).
function laznReaddir(mapa) {
  return (rootDir) => {
    const v = mapa[rootDir];
    if (v instanceof Error) throw v;
    if (!v) throw new Error(`ENOENT: no such file or directory, scandir '${rootDir}'`);
    return v.map((name) => ({ name, isDirectory: () => true }));
  };
}

// Lazni existsSync: skup punih putanja (rootDir/ime/.olx-pik) koje "postoje".
function laznExists(skup) {
  return (putanja) => skup.has(putanja);
}

// ---- parsirajPopis ----

test("parsirajPopis: obicne linije, komentari, prazne linije, trailing whitespace", () => {
  const sadrzaj = [
    "# ovo je komentar",
    "/home/mahir/olx-klonovi/mixbox",
    "",
    "/home/mahir/olx-klonovi/drugi   ",
    "/home/mahir/olx-klonovi/treci # inline komentar",
    "   ",
    "#",
  ].join("\n");
  assert.deepEqual(parsirajPopis(sadrzaj), [
    "/home/mahir/olx-klonovi/mixbox",
    "/home/mahir/olx-klonovi/drugi",
    "/home/mahir/olx-klonovi/treci",
  ]);
});

test("parsirajPopis: CRLF (Windows) linije", () => {
  const sadrzaj = "C:\\klonovi\\mixbox\r\n# komentar\r\nC:\\klonovi\\drugi\r\n";
  assert.deepEqual(parsirajPopis(sadrzaj), ["C:\\klonovi\\mixbox", "C:\\klonovi\\drugi"]);
});

test("parsirajPopis: potpuno prazan string i null/undefined daju prazan niz", () => {
  assert.deepEqual(parsirajPopis(""), []);
  assert.deepEqual(parsirajPopis(undefined), []);
  assert.deepEqual(parsirajPopis(null), []);
});

test("parsirajPopis: redoslijed je ocuvan", () => {
  const sadrzaj = "treci\nprvi\ndrugi\n";
  assert.deepEqual(parsirajPopis(sadrzaj), ["treci", "prvi", "drugi"]);
});

// ---- listajPodmapeSaOlxPik ----

test("listajPodmapeSaOlxPik: vraca samo foldere sa .olx-pik, sortirano, apsolutne putanje", () => {
  const root = "/root";
  const readdirSync = laznReaddir({
    "/root": ["zeta-klon", "alfa-klon", "bez-olx-pik", "nekiFajl.txt"],
  });
  const existsSync = laznExists(
    new Set([join(root, "zeta-klon", ".olx-pik"), join(root, "alfa-klon", ".olx-pik")]),
  );
  const r = listajPodmapeSaOlxPik(root, { readdirSync, existsSync });
  assert.deepEqual(r, [join(root, "alfa-klon"), join(root, "zeta-klon")]);
});

test("listajPodmapeSaOlxPik: ignorise foldere bez .olx-pik i fajlove", () => {
  const root = "/root";
  const readdirSync = () => [
    { name: "klon-a", isDirectory: () => true },
    { name: "klon-b", isDirectory: () => true },
    { name: "obican-fajl", isDirectory: () => false },
  ];
  const existsSync = laznExists(new Set([join(root, "klon-a", ".olx-pik"), join(root, "obican-fajl", ".olx-pik")]));
  const r = listajPodmapeSaOlxPik(root, { readdirSync, existsSync });
  assert.deepEqual(r, [join(root, "klon-a")]);
});

test("listajPodmapeSaOlxPik: root koji ne postoji (readdirSync baci) vraca prazan niz, ne baca", () => {
  const readdirSync = laznReaddir({});
  const r = listajPodmapeSaOlxPik("/nepostojeci", { readdirSync, existsSync: () => false });
  assert.deepEqual(r, []);
});

// ---- nadjiKlonove: prioritet izvora ----

test("nadjiKlonove: cliRoot pobjedjuje nad OLX_KLIJENTI_ROOT i popisom", () => {
  const readdirSync = laznReaddir({ "/cli-root": ["klon1"], "/env-root": ["klon2"] });
  const existsSync = laznExists(new Set([join("/cli-root", "klon1", ".olx-pik"), join("/env-root", "klon2", ".olx-pik")]));
  const r = nadjiKlonove({
    cliRoot: "/cli-root",
    env: { OLX_KLIJENTI_ROOT: "/env-root", OLX_KLIJENTI_POPIS: "/popis.txt" },
    readdirSync,
    existsSync,
    citajFajl: () => {
      throw new Error("citajFajl NE smije biti pozvan kad cliRoot pobjedjuje");
    },
  });
  assert.deepEqual(r, { klonovi: [join("/cli-root", "klon1")], izvor: "root", izvorPutanja: "/cli-root", greska: null });
});

test("nadjiKlonove: OLX_KLIJENTI_ROOT pobjedjuje nad popisom kad cliRoot nije dat", () => {
  const readdirSync = laznReaddir({ "/env-root": ["klon2"] });
  const existsSync = laznExists(new Set([join("/env-root", "klon2", ".olx-pik")]));
  const r = nadjiKlonove({
    env: { OLX_KLIJENTI_ROOT: "/env-root", OLX_KLIJENTI_POPIS: "/popis.txt" },
    readdirSync,
    existsSync,
    citajFajl: () => {
      throw new Error("citajFajl NE smije biti pozvan kad OLX_KLIJENTI_ROOT pobjedjuje");
    },
  });
  assert.deepEqual(r, { klonovi: [join("/env-root", "klon2")], izvor: "root", izvorPutanja: "/env-root", greska: null });
});

test("nadjiKlonove: prazan/whitespace cliRoot se ne racuna kao dat, pada na OLX_KLIJENTI_ROOT", () => {
  const readdirSync = laznReaddir({ "/env-root": ["klon2"] });
  const existsSync = laznExists(new Set([join("/env-root", "klon2", ".olx-pik")]));
  const r = nadjiKlonove({
    cliRoot: "   ",
    env: { OLX_KLIJENTI_ROOT: "/env-root" },
    readdirSync,
    existsSync,
  });
  assert.equal(r.izvor, "root");
  assert.equal(r.izvorPutanja, "/env-root");
});

test("nadjiKlonove: bez cliRoot i bez OLX_KLIJENTI_ROOT pada na popis", () => {
  const r = nadjiKlonove({
    env: { OLX_KLIJENTI_POPIS: "/popis.txt" },
    citajFajl: (p) => {
      assert.equal(p, "/popis.txt");
      return "/klon/prvi\n/klon/drugi\n";
    },
  });
  assert.deepEqual(r, {
    klonovi: ["/klon/prvi", "/klon/drugi"],
    izvor: "popis",
    izvorPutanja: "/popis.txt",
    greska: null,
  });
});

// ---- nadjiKlonove: popis grana ----

test("nadjiKlonove: popis fajl ne postoji -> greska popunjen, izvor null", () => {
  const r = nadjiKlonove({
    env: { OLX_KLIJENTI_POPIS: "/nema/ovdje.txt" },
    citajFajl: () => {
      throw new Error("ENOENT: no such file or directory");
    },
  });
  assert.equal(r.izvor, null);
  assert.equal(r.izvorPutanja, "/nema/ovdje.txt");
  assert.deepEqual(r.klonovi, []);
  assert.ok(typeof r.greska === "string" && r.greska.length > 0);
});

test("nadjiKlonove: popis fajl postoji ali prazan/samo komentari -> greska null, klonovi []", () => {
  const r = nadjiKlonove({
    env: { OLX_KLIJENTI_POPIS: "/prazan.txt" },
    citajFajl: () => "# samo komentar\n\n   \n",
  });
  assert.deepEqual(r, { klonovi: [], izvor: "popis", izvorPutanja: "/prazan.txt", greska: null });
});

test("nadjiKlonove: env.OLX_KLIJENTI_POPIS override umjesto default ~/.olx-klijenti.txt", () => {
  let vidjenaPutanja = null;
  const r = nadjiKlonove({
    env: { OLX_KLIJENTI_POPIS: "/custom/popis.txt" },
    homedir: () => {
      throw new Error("homedir NE smije biti pozvan kad je OLX_KLIJENTI_POPIS postavljen");
    },
    citajFajl: (p) => {
      vidjenaPutanja = p;
      return "/klon/a\n";
    },
  });
  assert.equal(vidjenaPutanja, "/custom/popis.txt");
  assert.equal(r.izvorPutanja, "/custom/popis.txt");
  assert.deepEqual(r.klonovi, ["/klon/a"]);
});

test("nadjiKlonove: bez OLX_KLIJENTI_POPIS koristi homedir()/.olx-klijenti.txt", () => {
  let vidjenaPutanja = null;
  const r = nadjiKlonove({
    env: {},
    homedir: () => "/home/mahir",
    citajFajl: (p) => {
      vidjenaPutanja = p;
      return "/klon/x\n";
    },
  });
  assert.equal(vidjenaPutanja, join("/home/mahir", ".olx-klijenti.txt"));
  assert.equal(r.izvorPutanja, join("/home/mahir", ".olx-klijenti.txt"));
});

// ---- nadjiKlonove: root grana, greska na nepostojeci root ----

test("nadjiKlonove: cliRoot koji ne postoji (readdirSync baci) daje greska, prazan spisak", () => {
  const readdirSync = () => {
    throw new Error("ENOENT: no such file or directory, scandir '/ne-postoji'");
  };
  const r = nadjiKlonove({ cliRoot: "/ne-postoji", readdirSync, existsSync: () => false });
  assert.equal(r.izvor, "root");
  assert.equal(r.izvorPutanja, "/ne-postoji");
  assert.deepEqual(r.klonovi, []);
  assert.ok(typeof r.greska === "string" && r.greska.length > 0);
});

test("nadjiKlonove: cliRoot koji postoji ali je prazan (nema klonova) NIJE greska", () => {
  const readdirSync = () => [];
  const r = nadjiKlonove({ cliRoot: "/prazan-root", readdirSync, existsSync: () => false });
  assert.deepEqual(r, { klonovi: [], izvor: "root", izvorPutanja: "/prazan-root", greska: null });
});

// ---- pronadjiUgnijezdeneKopije ----

// Lazni readdirSync za pronadjiUgnijezdeneKopije: mapa klonPutanja -> niz imena poddirektorija
// (svi tretirani kao direktorijum), ili Error da simulira neuspjeh.
function laznReaddirZaKlon(mapa) {
  return (klonPutanja) => {
    const v = mapa[klonPutanja];
    if (v instanceof Error) throw v;
    if (!v) throw new Error(`ENOENT: no such file or directory, scandir '${klonPutanja}'`);
    return v.map((name) => ({ name, isDirectory: () => true }));
  };
}

test("pronadjiUgnijezdeneKopije: klon bez ugnijezdene kopije daje prazan niz", () => {
  const readdirSync = laznReaddirZaKlon({ "/root/klon-a": ["src", "scripts"] });
  const existsSync = () => false;
  const r = pronadjiUgnijezdeneKopije(["/root/klon-a"], { readdirSync, existsSync });
  assert.deepEqual(r, []);
});

test("pronadjiUgnijezdeneKopije: klon sa tacno jednom ugnijezdenom kopijom", () => {
  const readdirSync = laznReaddirZaKlon({ "/root/klon-a": ["src", "klon-a"] });
  const existsSync = (p) => p === join("/root/klon-a", "klon-a", ".olx-pik");
  const r = pronadjiUgnijezdeneKopije(["/root/klon-a"], { readdirSync, existsSync });
  assert.deepEqual(r, [{ klon: "klon-a", putanja: join("/root/klon-a", "klon-a") }]);
});

test("pronadjiUgnijezdeneKopije: dva klona, samo jedan ima ugnijezdenu kopiju", () => {
  const readdirSync = laznReaddirZaKlon({
    "/root/klon-a": ["src"],
    "/root/klon-b": ["src", "klon-b"],
  });
  const existsSync = (p) => p === join("/root/klon-b", "klon-b", ".olx-pik");
  const r = pronadjiUgnijezdeneKopije(["/root/klon-a", "/root/klon-b"], { readdirSync, existsSync });
  assert.deepEqual(r, [{ klon: "klon-b", putanja: join("/root/klon-b", "klon-b") }]);
});

test("pronadjiUgnijezdeneKopije: node_modules/.git/dist se ne provjeravaju, cak ni ako bi existsSync lagao", () => {
  const readdirSync = laznReaddirZaKlon({ "/root/klon-a": ["node_modules", ".git", "dist"] });
  // existsSync namjerno vraca true za SVAKU putanju: da dokaze da funkcija za preskocene
  // poddirektorije uopste ne poziva postoji(...).
  const existsSync = () => true;
  const r = pronadjiUgnijezdeneKopije(["/root/klon-a"], { readdirSync, existsSync });
  assert.deepEqual(r, []);
});

test("pronadjiUgnijezdeneKopije: readdirSync koji baci za jedan klon ne prekida obradu ostalih", () => {
  const readdirSync = laznReaddirZaKlon({
    "/root/klon-a": new Error("EACCES: permission denied"),
    "/root/klon-b": ["klon-b"],
  });
  const existsSync = (p) => p === join("/root/klon-b", "klon-b", ".olx-pik");
  const r = pronadjiUgnijezdeneKopije(["/root/klon-a", "/root/klon-b"], { readdirSync, existsSync });
  assert.deepEqual(r, [{ klon: "klon-b", putanja: join("/root/klon-b", "klon-b") }]);
});

test("pronadjiUgnijezdeneKopije: klonovi nije niz vraca prazan niz bez bacanja", () => {
  assert.deepEqual(pronadjiUgnijezdeneKopije(undefined), []);
  assert.deepEqual(pronadjiUgnijezdeneKopije(null), []);
  assert.deepEqual(pronadjiUgnijezdeneKopije("nije-niz"), []);
});
