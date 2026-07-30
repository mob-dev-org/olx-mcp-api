#!/usr/bin/env node
// Zadnji dio izdanja: pusti oznaceno izdanje u flotu.
//
// Radi ono sto `izdanje.mjs` namjerno ne radi: push na remote, pomjeranje prekidaca `stabilno` i
// azuriranje klonova. Razdvojeno je zato sto je do taga sve povratno, a od prekidaca nista nije:
// od tog trenutka klonovi uzimaju novi kod pri prvom azuriranju.
//
// Nepovratni dio ide SAMO uz `--pomjeri-stabilno`. Bez te zastavice skripta uradi sve povratno
// (provjere i push commita i tagova) i ispise sta ostaje. Tako "potvrda" stoji u pozivu, a ne u
// pitanju na koje niko ne odgovara kad skriptu pokrece sesija.
//
// Pokretanje:
//   node scripts/pusti-u-flotu.mjs --suho                    # samo pokazi plan
//   node scripts/pusti-u-flotu.mjs                           # push commita i tagova
//   node scripts/pusti-u-flotu.mjs --pomjeri-stabilno         # i prekidac i azuriranje flote
//   node scripts/pusti-u-flotu.mjs --izdanje v0.3.0 --pomjeri-stabilno   # vracanje na staro

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);

const arg = process.argv.slice(2);
const SUHO = arg.includes("--suho");
const POMJERI = arg.includes("--pomjeri-stabilno");
const BEZ_FLOTE = arg.includes("--bez-flote");
const iIzdanje = arg.indexOf("--izdanje");
const PREKIDAC = (process.env.OLX_TAG ?? "stabilno").trim() || "stabilno";
const WIN = process.platform === "win32";

function git(...args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function stani(sta, popravka) {
  console.error(`STOP: ${sta}`);
  if (popravka) console.error(`  -> ${popravka}`);
  process.exit(1);
}

function korak(opis, fn) {
  process.stdout.write(`  ${opis}... `);
  if (SUHO) {
    console.log("(suho, preskacem)");
    return true;
  }
  try {
    fn();
    console.log("ok");
    return true;
  } catch (e) {
    console.log("PALO");
    const detalj = String(e?.stderr ?? e?.message ?? e).trim().split("\n").slice(-3).join("\n");
    if (detalj) console.log(`    ${detalj}`);
    return false;
  }
}

// Koje izdanje pustamo: zadano, ili tag koji stoji na HEAD-u.
let IZDANJE = iIzdanje >= 0 ? arg[iIzdanje + 1] : "";
if (!IZDANJE) {
  try {
    IZDANJE = git("describe", "--tags", "--exact-match", "HEAD");
  } catch {
    stani(
      "HEAD ne stoji na tagu izdanja",
      "napravi izdanje (node scripts/izdanje.mjs <broj>) ili zadaj --izdanje v0.3.0",
    );
  }
}
if (!/^v\d+\.\d+\.\d+$/.test(IZDANJE)) {
  stani(`"${IZDANJE}" nije ime izdanja`, "ime je oblika v0.5.1");
}

console.log(`Pustam u flotu: ${IZDANJE}${SUHO ? "   (suho, nista se ne mijenja)" : ""}`);
console.log("");

// 1. Tag mora postojati lokalno i biti anotiran. Lightweight `v` tag bi pokvario `git describe`
//    na klonovima, jer describe preferira anotirane tagove.
let tip = "";
try {
  tip = git("cat-file", "-t", IZDANJE);
} catch {
  stani(`tag ${IZDANJE} ne postoji lokalno`, 'git tag -l "v*" pa izaberi postojeci');
}
if (tip !== "tag") {
  stani(`tag ${IZDANJE} nije anotiran (${tip})`, `git tag -d ${IZDANJE} && git tag -a ${IZDANJE} -m "${IZDANJE.slice(1)}"`);
}
console.log(`  ok  ${IZDANJE} je anotiran tag`);

// 2. Radna kopija mora biti cista: prekidac ne smije pokazati na stanje koje nije u gitu.
if (git("status", "--porcelain", "--untracked-files=no")) {
  stani("radna kopija ima necommitovane izmjene", "commituj ili odlozi (git stash), pa ponovo");
}
console.log("  ok  radna kopija je cista");

// 3. Commit izdanja mora na remote PRIJE prekidaca. Klon koji dobije prekidac na commit koji
//    remote ne poznaje ne moze napraviti checkout, dakle flota staje.
const shaIzdanja = git("rev-parse", `${IZDANJE}^{commit}`);
if (!korak("push commita i tagova (git push --follow-tags origin main)", () =>
  git("push", "--follow-tags", "origin", "main"),
)) {
  stani("push nije prosao", "provjeri pristup remoteu pa ponovo");
}

if (!SUHO) {
  const naRemoteu = git("ls-remote", "origin", `refs/tags/${IZDANJE}`);
  if (!naRemoteu) stani(`${IZDANJE} nije na remoteu ni poslije pusha`, `git push origin ${IZDANJE}`);
  console.log(`  ok  ${IZDANJE} je na remoteu`);
}

if (!POMJERI) {
  console.log("");
  console.log("Povratni dio je gotov. Nepovratni ostaje, jer ga flota osjeti odmah:");
  console.log("");
  console.log(`  node scripts/pusti-u-flotu.mjs --izdanje ${IZDANJE} --pomjeri-stabilno`);
  console.log("");
  console.log(`Do tada prekidac "${PREKIDAC}" pokazuje na staro izdanje i klonovi vide staro.`);
  process.exit(0);
}

// 4. Prekidac. Od ovog trenutka klonovi pri azuriranju uzimaju novo izdanje.
console.log("");
if (!korak(`prekidac ${PREKIDAC} -> ${IZDANJE}`, () => git("tag", "-f", PREKIDAC, shaIzdanja))) {
  stani("pomjeranje lokalnog prekidaca nije proslo");
}
if (!korak(`push prekidaca (force, jer ${PREKIDAC} je pomicni tag)`, () =>
  git("push", "-f", "origin", PREKIDAC),
)) {
  console.log("");
  console.log("Prekidac je pomjeren LOKALNO ali nije na remoteu, pa flota jos vidi staro.");
  console.log("Ako je blokirano zastitom okruzenja, pokreni rucno:");
  console.log(`  git push -f origin ${PREKIDAC}`);
  process.exit(1);
}

// 5. Flota. Skripta se pokrece na masini gdje klonovi zive, pa se ovdje azuriraju samo klonovi sa
//    ove masine; klonovi na drugoj platformi se azuriraju tamo, svojim blizancem.
const popis = process.env.OLX_KLIJENTI_POPIS ?? join(homedir(), ".olx-klijenti.txt");
console.log("");
if (BEZ_FLOTE) {
  console.log("Preskacem azuriranje flote (--bez-flote). Kad zelis:");
  console.log(WIN ? "  powershell -ExecutionPolicy Bypass -File deploy\\windows\\azuriraj.ps1" : "  scripts/azuriraj-sve.sh");
} else if (!existsSync(popis)) {
  console.log(`Nema popisa klonova (${popis}), pa nema sta azurirati.`);
  console.log("Kad prvi klijent postoji, dodaj putanju klona u taj fajl.");
} else if (SUHO) {
  console.log("Suho: ovdje bih pokrenula azuriranje flote.");
} else {
  console.log("Azuriram flotu...");
  try {
    execFileSync(
      WIN ? "powershell" : "bash",
      WIN
        ? ["-ExecutionPolicy", "Bypass", "-File", join("deploy", "windows", "azuriraj.ps1")]
        : [join("scripts", "azuriraj-sve.sh")],
      { stdio: "inherit" },
    );
  } catch {
    console.log("");
    console.log("Azuriranje je javilo greske. Klon koji je pao nije dirao svoje servise, pa");
    console.log("klijent radi na starom izdanju. Zbir iznad kaze koji je i na kojem koraku.");
    process.exit(1);
  }
}

console.log("");
console.log(`Flota vozi ${IZDANJE}. Provjera na klonu: node scripts/provjeri-izdanje.mjs`);
