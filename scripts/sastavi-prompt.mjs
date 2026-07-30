#!/usr/bin/env node
// Sastavlja sistemski prompt sesije u JEDAN fajl i ispise njegovu putanju.
//
// Zasto uopste postoji: `--append-system-prompt-file` NIJE aditivan. Izmjereno 30.07.2026. sa dva
// fajla: sesija vidi samo ZADNJI. Dakle profil klijenta i pamcenje se ne mogu dodati kao drugi
// fajl, nego se sve mora spojiti prije pokretanja.
//
// Sadrzaj, u ovom redu:
//   1. runtime/SISTEM-<tip>.md    pravila razgovora
//   2. KLIJENT-javno.md           ko je klijent, ton, footer, granice (opciono, samo klijent)
//   3. pamcenje                   sto je bot sam zapisao kroz razgovore (opciono, samo klijent)
//
// Sretna posljedica: pamcenje se osvjezava na SVAKI start, a sesija se restartuje svaku noc, pa
// zapisano pocinje vaziti sam od sebe i bez ijednog poziva alata.
//
// KLIJENT.md se NE ubacuje: on nosi tokene i komercijalni dogovor i ostaje zabranjen. Javni dio
// klijent smije cuti, zato je odvojen fajl.
//
// Napomena o kesu: sastavljeni prompt je dio prefiksa koji DeepSeek kesira. Mijenja se samo kad
// se mijenja pamcenje ili profil, dakle rijetko, i uvijek izmedju sesija a nikad usred razgovora.
//
// Upotreba:
//   node scripts/sastavi-prompt.mjs [klijent|admin-bot]   # ispise putanju sastavljenog fajla

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TIP = (process.argv[2] ?? "klijent").trim();
const JE_KLIJENT = TIP === "klijent";
const OSNOVA = JE_KLIJENT ? "runtime/SISTEM-klijent.md" : "runtime/SISTEM-admin-bot.md";
const IZLAZ = resolve(JE_KLIJENT ? ".olx-pik/prompt-klijent.md" : ".olx-pik/prompt-admin-bot.md");

if (!existsSync(OSNOVA)) {
  console.error(`Nema ${OSNOVA}. Bez njega sesija nema pravila i ne pokrece se.`);
  process.exit(1);
}

const dijelovi = [readFileSync(OSNOVA, "utf8").trimEnd()];

if (JE_KLIJENT) {
  // Profil klijenta. Nije obavezan: klon bez njega radi kao i do sada.
  if (existsSync("KLIJENT-javno.md")) {
    const profil = readFileSync("KLIJENT-javno.md", "utf8").trim();
    if (profil) dijelovi.push(profil);
  }

  // Pamcenje kroz jezgro, da format bloka stoji na jednom mjestu i ima testove.
  try {
    const { ucitajPamcenje, pamcenjeUProm } = await import("../dist/core/pamcenje.js");
    const blok = pamcenjeUProm(ucitajPamcenje()).trim();
    if (blok) dijelovi.push(blok);
  } catch (e) {
    // Bez builda ili bez fajla pamcenja sesija se i dalje pokrece, samo bez pamcenja: bolje
    // sesija bez pamcenja nego bot koji ne odgovara.
    console.error(`Pamcenje nije ucitano, prompt ide bez njega: ${e instanceof Error ? e.message : e}`);
  }
}

const sadrzaj = `${dijelovi.join("\n\n")}\n`;
mkdirSync(dirname(IZLAZ), { recursive: true });
const tmp = `${IZLAZ}.tmp`;
writeFileSync(tmp, sadrzaj, "utf8");
renameSync(tmp, IZLAZ); // atomicno: sesija nikad ne procita polovicno napisan prompt

// Na stdout ide SAMO putanja, da je pozivalac moze uzeti u varijablu.
console.log(IZLAZ);
