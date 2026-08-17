#!/usr/bin/env bun
// Azurira OVAJ klon na izdanje koje nosi prekidac `stabilno` (ili na zadano izdanje).
//
// Blizanac `scripts/azuriraj-sve.sh` radi isto za cijelu flotu sa admin masine. Ovo je za jedan
// klon iz njega samog: kad sjednes u klijentski klon i sesija javi da zaostaje, ili kad se
// oporavlja jedan klon a ostale ne treba dirati. Bun (ne Node, ne bash), jer radi NA klonu
// klijenta, dakle i na Windowsu (.claude/rules/pogon.md).
//
// Razlika prema azuriraj-sve.sh koja je namjerna: ako build ili testovi padnu, klon se VRACA na
// izdanje sa kojeg je krenuo. Tamo checkout ostaje, pa klon zavrsi sa novim `src` i starim
// `dist`, sto je stanje koje ta skripta upravo tvrdi da izbjegava. Ovdje se pamti pocetni HEAD i
// vraca, pa je ishod ili cijelo novo izdanje ili nedirnuto staro.
//
// Restart sesija NIJE u default toku: skripta koju je pokrenula sesija bi restartom ubila samu
// sebe usred posla. Zato se restart trazi izricito (`--restart`), a bez njega se na kraju ispise
// tacna komanda.
//
// Pokretanje:
//   bun scripts/azuriraj-ovaj-klon.mjs                 # na `stabilno`, bez restarta
//   bun scripts/azuriraj-ovaj-klon.mjs --restart       # i restartuj dugozive poslove
//   bun scripts/azuriraj-ovaj-klon.mjs --izdanje v0.3.0  # vracanje na konkretno izdanje
//   bun scripts/azuriraj-ovaj-klon.mjs --suho          # samo pokazi sta bi uradila

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);

const arg = process.argv.slice(2);
const SUHO = arg.includes("--suho");
const RESTART = arg.includes("--restart");
const iIzdanje = arg.indexOf("--izdanje");
const CILJ = iIzdanje >= 0 ? arg[iIzdanje + 1] : (process.env.OLX_TAG ?? "stabilno").trim() || "stabilno";
const WIN = process.platform === "win32";
const IME = basename(KORIJEN);

function git(...args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function korak(opis, fn) {
  process.stdout.write(`  ${opis}... `);
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

if (!existsSync(join(KORIJEN, ".git"))) {
  console.error(`${KORIJEN} nije git klon, nema sta azurirati.`);
  process.exit(1);
}

const pocetniHead = git("rev-parse", "HEAD");
const pocetnoIme = git("describe", "--tags", "--always");
console.log(`Klon: ${IME}`);
console.log(`Sada: ${pocetnoIme} (${pocetniHead.slice(0, 7)})`);
console.log(`Cilj: ${CILJ}`);
console.log("");

// Lokalne izmjene znace da je neko rucno petljao. Pregaziti to je gore od neazuriranog klona,
// pa se ni ne pokusava. Isto pravilo ima i azuriraj-sve.sh.
const izmjene = git("status", "--porcelain", "--untracked-files=no");
if (izmjene) {
  console.error("STOP: klon ima lokalne izmjene, ne diram ga.");
  console.error(izmjene.split("\n").slice(0, 10).map((r) => `  ${r}`).join("\n"));
  console.error("  -> commituj ili odlozi (git stash), pa ponovo");
  process.exit(1);
}

if (SUHO) {
  console.log("Suho: uradila bih fetch --tags --force, checkout, bun install, build, test");
  console.log(RESTART ? "  pa restart dugozivih poslova" : "  bez restarta (dodaj --restart)");
  process.exit(0);
}

if (!korak("fetch tagova (--force, inace pomicni tag ostane na starom)", () =>
  git("fetch", "--tags", "--force", "--quiet", "origin"),
)) {
  process.exit(1);
}

if (!korak(`checkout ${CILJ}`, () => git("checkout", "--detach", "--quiet", CILJ))) {
  console.error(`  -> postoji li to izdanje? git tag -l "v*"`);
  process.exit(1);
}

const novoIme = git("describe", "--tags", "--always");
let palo = "";
// `bun run test` (skript), NE goli `bun test`: bun test je Bunov vlastiti test runner koji
// zaobilazi scripts/testovi.mjs i njegovo pojedinacno-po-fajlu pokretanje (vidi napomenu tamo).
for (const [opis, komanda, argumenti] of [
  ["bun install", "bun", ["install", "--frozen-lockfile"]],
  ["build", "bun", ["run", "build"]],
  ["testovi", "bun", ["run", "test"]],
]) {
  const prosao = korak(opis, () =>
    execFileSync(komanda, argumenti, { stdio: ["ignore", "pipe", "pipe"], shell: WIN }),
  );
  if (!prosao) {
    palo = opis;
    break;
  }
}

// Testovi pisu probni audit u radni folder; ne smije ostati u klijentovom .olx-pik.
rmSync(join(KORIJEN, ".olx-pik", "test-audit.jsonl"), { force: true });

if (palo) {
  console.log("");
  console.log(`PALO na koraku: ${palo}. Vracam klon na ${pocetnoIme}.`);
  const vracen = korak(`checkout ${pocetniHead.slice(0, 7)}`, () =>
    git("checkout", "--detach", "--quiet", pocetniHead),
  );
  if (vracen) {
    // Build mora odgovarati kodu na koji smo se vratili, inace pogon vozi mjesavinu.
    korak("build starog izdanja", () =>
      execFileSync("bun", ["run", "build"], { stdio: ["ignore", "pipe", "pipe"], shell: WIN }),
    );
    console.log("");
    console.log(`Klon je na ${pocetnoIme}, kao prije. Izdanje ${CILJ} nije uslo.`);
    console.log("Popravi uzrok pa ponovo; sesije nisu dirane, klijent nije ostao bez bota.");
  } else {
    console.log("");
    console.log(`RUCNO: vracanje nije proslo. Klon je na ${novoIme} sa neispravnim buildom.`);
    console.log(`  git checkout --detach ${pocetniHead} && bun install && bun run build`);
  }
  process.exit(1);
}

console.log("");
console.log(`Klon je na ${novoIme}. Sta je uslo: CHANGELOG.md`);

// Restart samo DUGOZIVIH poslova. Kalendarski (snapshot, dnevno, sedmicno) se NE diraju: restart
// bi ih IZVRSIO odmah, pa bi klijent dobio jutarnji izvjestaj usred dana i potrosila bi se dnevna
// runda obnova van reda. Oni novi kod uzmu sami na sljedecem terminu, jer su jednokratni procesi.
const poslovi = ["sesija", "admin-bot"];

// Komanda instalatera po platformi: on osvjezava DEFINICIJU posla (plist / Task Scheduler
// zadatak) iz sablona u repou, ne samo kod. Bez ovoga goli kickstart/schtasks pokrece STARU
// komandu iz vec instalirane definicije, jer je ona presla sa cuvar-sesije.mjs na
// telegram-most.mjs. Komanda se ispisuje i kad RESTART nije trazen, da je vlasnik klona kopira
// direktno, i pokrece se kroz korak() kad RESTART jeste trazen.
const komandaInstalatera = WIN
  ? ["powershell", ["-ExecutionPolicy", "Bypass", "-File", "deploy\\windows\\instaliraj-zadatke.ps1", IME]]
  : ["scripts/instaliraj-cron.sh", [IME]];
const komandaInstalateraIspis = WIN
  ? `  powershell -ExecutionPolicy Bypass -File deploy\\windows\\instaliraj-zadatke.ps1 ${IME}`
  : `  scripts/instaliraj-cron.sh ${IME}`;

if (!RESTART) {
  console.log("");
  console.log("Sesije jos drze STARI kod u memoriji. Osvjezi im i definiciju posla, ne samo kod:");
  console.log(komandaInstalateraIspis);
  console.log("Sam kickstart/restart od ovog izdanja NIJE dovoljan: komanda u definiciji posla se");
  console.log("promijenila (cuvar-sesije.mjs -> telegram-most.mjs), pa bi ponovo pokrenula STARU.");
  console.log("Ili ponovo ovaj skript sa --restart. Iz zive sesije to ne pokrecu: ubila bi samu sebe.");
  process.exit(0);
}

console.log("");
const [instalatorProgram, instalatorArgv] = komandaInstalatera;
const instalatorProsao = korak("osvjezi definiciju posla (instalater)", () =>
  execFileSync(instalatorProgram, instalatorArgv, { stdio: ["ignore", "pipe", "pipe"], shell: WIN }),
);

if (!instalatorProsao) {
  // Rezerva: bar kod u memoriju, kad definicija ne moze da se osvjezi (npr. nema admin prava).
  console.log(`  rezerva: kickstart nad postojecom (neosvjezenom) definicijom posla`);
  console.log(`  rucno kasnije: ${komandaInstalateraIspis}`);
  for (const posao of poslovi) {
    const oznaka = `ba.codefactory.olx.${IME}.${posao}`;

    // Provjera postojanja je NAMJERNO izvan korak(): odsustvo posla admin-bot je normalno stanje
    // na jednobotnom klonu (OLX_MOST_ADMIN_TG_ID popunjen, JEDAN bot token vozi obje sesije kroz
    // posao "sesija") i ne smije se prijaviti kao "PALO". Ako komanda za provjeru nije dostupna,
    // tretira se kao "nije instaliran" (isto "nepoznato je NE" pravilo kao drugdje u repou), pa se
    // restart tiho preskace umjesto lazne greske.
    let instaliran = false;
    try {
      if (WIN) {
        execFileSync("schtasks", ["/query", "/tn", oznaka], { stdio: "pipe" });
        instaliran = true;
      } else {
        const lista = execFileSync("launchctl", ["list"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
        instaliran = lista.includes(oznaka);
      }
    } catch {
      instaliran = false;
    }
    if (!instaliran) {
      console.log(`  ${posao}: posao nije instaliran na ovoj masini, restart preskocen (normalno za admin-bot na jednobotnom klonu)`);
      continue;
    }

    korak(`restart ${posao}`, () => {
      if (WIN) {
        try {
          execFileSync("schtasks", ["/end", "/tn", oznaka], { stdio: "pipe" });
        } catch {
          // posao nije bio pokrenut; /run nize je ono sto treba
        }
        execFileSync("schtasks", ["/run", "/tn", oznaka], { stdio: "pipe" });
      } else {
        execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? 501}/${oznaka}`], {
          stdio: "pipe",
        });
      }
    });
  }
} else {
  console.log("  definicija posla osvjezena, sesija i admin-bot podignuti sa novom komandom");
}
