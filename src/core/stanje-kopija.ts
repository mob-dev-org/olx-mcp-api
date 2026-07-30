// Kopiranje klijentskog stanja iz klona u radnu kopiju backupa i natrag.
//
// Ovaj sloj zna za disk, ali ne zna za git. Odluku sta se kopira donosi `backup-spisak.ts`,
// git radi `git-stanje.ts`. Podjela je namjerna: spisak se testira bez diska, ovaj sloj nad
// privremenim folderom, git nad lokalnim bare repoom, i nista ne trazi mrezu.
//
// Radna kopija je VAN klona (`~/olx-stanje/<klijent>/`). Da je unutra, `git status --porcelain`
// u `azuriraj-sve.sh:54` bi je vidio kao lokalnu izmjenu i klon bi trajno prestao da se azurira.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ciljUKopiji, crniObrasci, nadjiSumnjive, normalizuj, odsijeciNepotpunuLiniju } from "./backup-spisak.js";

/**
 * Gdje se trazi stanje. Nije cijeli klon: `node_modules` i `.git` se nikad ne prolaze, a i sve
 * sto se trazi zivi u ove tri grane plus par fajlova u korijenu.
 */
export const KORIJENI_PRETRAGE = [".olx-pik", ".claude-runtime/channels/telegram", ".claude-runtime-admin/channels/telegram"];

/** Fajlovi u korijenu klona koji nose stanje. Ostalo u korijenu je kod i ne trazi se. */
export const KORIJENSKI_FAJLOVI = ["KLIJENT.md", "KLIJENT-javno.md"];

function crnaMapa(rel: string): boolean {
  return crniObrasci().some(({ obrazac }) => obrazac.test(`${rel}/`));
}

/**
 * Sve putanje stanja koje stvarno postoje, relativne prema korijenu klona, sa kosim crtama
 * naprijed i na Windowsu.
 *
 * Crna mapa se NE prolazi nego se vraca kao jedna stavka: prolazak kroz `.olx-pik/slike` ili
 * kroz transkripte sesija bi kostao vremena, a rezultat bi ionako bio odbacen.
 */
export function popisiStanje(korijen: string, dodatne: string[] = []): string[] {
  const nadjeno: string[] = [];

  const prodji = (rel: string): void => {
    const puna = join(korijen, rel);
    let stavke: import("node:fs").Dirent[];
    try {
      stavke = readdirSync(puna, { withFileTypes: true });
    } catch {
      return; // mape nema, sto je normalno na novom klonu
    }
    for (const s of stavke) {
      const dijete = `${rel}/${s.name}`;
      if (s.isDirectory()) {
        if (crnaMapa(dijete)) nadjeno.push(dijete);
        else prodji(dijete);
      } else if (s.isFile()) {
        nadjeno.push(dijete);
      }
    }
  };

  for (const k of KORIJENI_PRETRAGE) {
    if (existsSync(join(korijen, k))) prodji(k);
  }
  for (const f of [...KORIJENSKI_FAJLOVI, ...dodatne]) {
    const rel = normalizuj(f);
    if (!nadjeno.includes(rel) && existsSync(join(korijen, rel))) nadjeno.push(rel);
  }
  return nadjeno.sort();
}

export interface RezultatKopije {
  upisano: string[];
  /** Fajlovi zaustavljeni zbog sumnjivog sadrzaja: ne salju se, javljaju se adminu. */
  sumnjivi: { putanja: string; nalazi: string[] }[];
}

const TEKSTUALNI = /\.(json|jsonl|md|txt|pokupljeno)$/;

/**
 * Kopira dati spisak iz klona u radnu kopiju.
 *
 * Backup NIKAD ne brise iz radne kopije ono cega vise nema u klonu. Nestanak fajla je ili
 * uredno ciscenje (a takvi su ionako na crnom spisku) ili nesreca, i backup koji prati nesrecu
 * nije backup. Zaostali fajl kosta kilobajt, izgubljen kosta klijenta.
 */
export function kopirajURadnu(korijen: string, radna: string, putanje: string[]): RezultatKopije {
  const upisano: string[] = [];
  const sumnjivi: RezultatKopije["sumnjivi"] = [];

  for (const rel of putanje) {
    const izvor = join(korijen, rel);
    if (!existsSync(izvor)) continue;
    const cilj = join(radna, ciljUKopiji(rel));
    mkdirSync(dirname(cilj), { recursive: true });

    if (TEKSTUALNI.test(rel)) {
      let sadrzaj = readFileSync(izvor, "utf8");
      if (rel.endsWith(".jsonl")) sadrzaj = odsijeciNepotpunuLiniju(sadrzaj);
      const nalazi = nadjiSumnjive(sadrzaj);
      if (nalazi.length > 0) {
        sumnjivi.push({ putanja: rel, nalazi });
        continue;
      }
      writeFileSync(cilj, sadrzaj, "utf8");
    } else {
      copyFileSync(izvor, cilj);
    }
    upisano.push(rel);
  }
  return { upisano, sumnjivi };
}

/** Vraca stanje iz radne kopije u klon. `pregazi` je jedini nacin da se prepise postojeci fajl. */
export function vratiIzRadne(radna: string, korijen: string, putanje: string[], pregazi = false): { vraceno: string[]; preskoceno: string[] } {
  const vraceno: string[] = [];
  const preskoceno: string[] = [];
  for (const rel of putanje) {
    const izvor = join(radna, ciljUKopiji(rel));
    if (!existsSync(izvor)) continue;
    const cilj = join(korijen, rel);
    if (existsSync(cilj) && !pregazi) {
      preskoceno.push(rel);
      continue;
    }
    mkdirSync(dirname(cilj), { recursive: true });
    copyFileSync(izvor, cilj);
    vraceno.push(rel);
  }
  return { vraceno, preskoceno };
}

export interface Razlika {
  putanja: string;
  vrsta: "fali u kopiji" | "razlicit sadrzaj" | "fali u klonu";
}

/**
 * Poredi klon i radnu kopiju bajt za bajt. Ovo je provjera da backup stvarno drzi ono sto
 * mislimo da drzi; bez nje se prvi put saznaje na dan oporavka.
 */
export function uporediSaKopijom(korijen: string, radna: string, putanje: string[]): Razlika[] {
  const razlike: Razlika[] = [];
  for (const rel of putanje) {
    const uKlonu = join(korijen, rel);
    const uKopiji = join(radna, ciljUKopiji(rel));
    const imaKlon = existsSync(uKlonu);
    const imaKopiju = existsSync(uKopiji);
    if (imaKlon && !imaKopiju) {
      razlike.push({ putanja: rel, vrsta: "fali u kopiji" });
      continue;
    }
    if (!imaKlon && imaKopiju) {
      razlike.push({ putanja: rel, vrsta: "fali u klonu" });
      continue;
    }
    if (!imaKlon) continue;
    // Velicina prvo: razlicita velicina je odgovor bez citanja sadrzaja.
    if (statSync(uKlonu).size !== statSync(uKopiji).size) {
      // jsonl u klonu moze biti duzi za nepotpun zadnji red, sto nije razlika
      if (rel.endsWith(".jsonl") && odsijeciNepotpunuLiniju(readFileSync(uKlonu, "utf8")) === readFileSync(uKopiji, "utf8")) continue;
      razlike.push({ putanja: rel, vrsta: "razlicit sadrzaj" });
      continue;
    }
    if (!readFileSync(uKlonu).equals(readFileSync(uKopiji))) razlike.push({ putanja: rel, vrsta: "razlicit sadrzaj" });
  }
  return razlike;
}
