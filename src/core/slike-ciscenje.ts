// Brisanje slika koje su odradile posao: klijentove fotografije iz Telegram inboxa i generisane
// slike iz .olx-pik/slike.
//
// Zasto uz odgodu a ne odmah po uploadu: upload zna proci djelimicno, klijent zna traziti drugu
// glavnu sliku ili ponovni pokusaj minut kasnije. Brisanje u istom potezu bi tada ostavilo posao
// bez izvora. Zato se fajl po uspjesnom uploadu samo OZNACI, a nestane tek kad odgoda istekne.
//
// Zasto uopste brisati: obje mape rastu bez gornje granice. Inbox je do sada cistio cuvar sesije
// po starosti od 7 dana (OLX_SESIJA_INBOX_DANA), a `.olx-pik/slike` nije cistio niko. Brisanje po
// dogadjaju ("slika je objavljena") pogadja pravi trenutak bolje nego brisanje po kalendaru.
//
// Ciscenje po starosti u cuvaru OSTAJE i nije zamijenjeno: ono hvata slike koje nikad nisu
// objavljene (klijent se predomislio, oglas nije zavrsen), a ovo hvata one koje jesu.
//
// Konfiguracija:
//   OLX_SLIKE_ODGODA_MIN     koliko minuta poslije uploada fajl zivi, default 60
//   OLX_SLIKE_POTROSENE_FILE gdje se drzi popis oznacenih, default .olx-pik/slike-potrosene.json

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Popis oznacenih: putanja fajla -> trenutak oznacavanja u ms. */
export type PotroseneSlike = Record<string, number>;

const ZADANA_ODGODA_MIN = 60;

export function putanjaPotrosenih(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_SLIKE_POTROSENE_FILE || ".olx-pik/slike-potrosene.json";
}

export function odgodaMs(env: NodeJS.ProcessEnv = process.env): number {
  const sirovo = Number(env.OLX_SLIKE_ODGODA_MIN);
  const minuta = Number.isFinite(sirovo) && sirovo >= 0 ? sirovo : ZADANA_ODGODA_MIN;
  return minuta * 60_000;
}

/**
 * Mape iz kojih se smije brisati. Sve van njih se ne oznacava ni ne dira.
 *
 * Ovo je glavna brana ovog modula, ne kozmetika: `olx_upload_images` prima proizvoljne putanje sa
 * masine, pa bi bez nje jedan upload iz `~/Slike` obrisao covjeku licnu fotografiju. Brisemo samo
 * ono sto je nas pogon sam napravio.
 */
export function nasemapePutanja(env: NodeJS.ProcessEnv = process.env): string[] {
  const runtime = env.CLAUDE_CONFIG_DIR || ".claude-runtime";
  return [
    resolve(env.OLX_SLIKA_DIR || ".olx-pik/slike"),
    resolve(runtime, "channels", "telegram", "inbox"),
    // Admin runtime ima svoj inbox; klon ga ima kad je postavljen i admin bot.
    resolve(".claude-runtime-admin", "channels", "telegram", "inbox"),
  ];
}

/** Da li putanja lezi unutar mape. Poredi se na razini segmenta, da `/slike-stare` ne prodje. */
function unutar(putanja: string, mapa: string): boolean {
  return putanja === mapa || putanja.startsWith(`${mapa}/`) || putanja.startsWith(`${mapa}\\`);
}

/** Smije li se ovaj fajl uopste brisati. */
export function nasaSlika(putanja: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const puna = resolve(putanja);
  return nasemapePutanja(env).some((mapa) => unutar(puna, mapa));
}

/**
 * Koje oznacene slike su dozrele za brisanje. Cista funkcija, bez diska.
 */
export function zaBrisanje(zapis: PotroseneSlike, sada: number, odgoda: number): string[] {
  return Object.entries(zapis)
    .filter(([, oznaceno]) => sada - oznaceno >= odgoda)
    .map(([putanja]) => putanja);
}

function procitaj(fajl: string): PotroseneSlike {
  if (!existsSync(fajl)) return {};
  try {
    const sirovo: unknown = JSON.parse(readFileSync(fajl, "utf8"));
    if (!sirovo || typeof sirovo !== "object" || Array.isArray(sirovo)) return {};
    const zapis: PotroseneSlike = {};
    for (const [putanja, ts] of Object.entries(sirovo as Record<string, unknown>)) {
      if (typeof ts === "number" && Number.isFinite(ts)) zapis[putanja] = ts;
    }
    return zapis;
  } catch {
    // pokvaren fajl nije razlog da posao padne; krece se od praznog
    return {};
  }
}

function upisi(fajl: string, zapis: PotroseneSlike): void {
  mkdirSync(dirname(fajl), { recursive: true });
  // Preko privremenog fajla, da prekid usred upisa ne ostavi polovican JSON.
  const privremeni = `${fajl}.tmp`;
  writeFileSync(privremeni, `${JSON.stringify(zapis, null, 2)}\n`, "utf8");
  renameSync(privremeni, fajl);
}

/**
 * Oznaci slike kao potrosene. Zove se POSLIJE uspjesnog uploada na OLX.
 *
 * Putanje van nasih mapa se tiho preskacu: nisu greska, samo nisu nase da ih brisemo.
 * Vraca koliko ih je stvarno oznaceno.
 */
export function oznaciPotrosene(
  putanje: string[],
  sada: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const nase = putanje.filter((p) => nasaSlika(p, env)).map((p) => resolve(p));
  if (nase.length === 0) return 0;
  const fajl = putanjaPotrosenih(env);
  try {
    const zapis = procitaj(fajl);
    for (const p of nase) zapis[p] = sada;
    upisi(fajl, zapis);
    return nase.length;
  } catch {
    // best-effort: neuspjelo oznacavanje znaci samo da ce fajl ocistiti cuvar po starosti
    return 0;
  }
}

/**
 * Obrise oznacene slike kojima je odgoda istekla i izbaci ih iz popisa.
 *
 * Zove se lijeno, na pocetku svakog posla sa slikama, umjesto iz zasebnog cron posla: mapa raste
 * samo kad se slike koriste, pa je i ciscenje tada na mjestu, a klon ne dobija jos jedan zadatak
 * koji treba instalirati na dvije platforme.
 *
 * Vraca broj obrisanih fajlova.
 */
export function pocistiPotrosene(sada: number = Date.now(), env: NodeJS.ProcessEnv = process.env): number {
  const fajl = putanjaPotrosenih(env);
  if (!existsSync(fajl)) return 0;
  try {
    const zapis = procitaj(fajl);
    const dozrele = zaBrisanje(zapis, sada, odgodaMs(env));
    if (dozrele.length === 0) return 0;
    let obrisano = 0;
    for (const putanja of dozrele) {
      // Brana se provjerava PONOVO pri brisanju, ne samo pri oznacavanju: popis je fajl na disku
      // i mogao je biti izmijenjen izmedju dva poziva.
      if (nasaSlika(putanja, env)) {
        try {
          unlinkSync(putanja);
          obrisano += 1;
        } catch {
          // fajl je vec nestao ili se ne da obrisati; svakako izlazi iz popisa
        }
      }
      delete zapis[putanja];
    }
    upisi(fajl, zapis);
    return obrisano;
  } catch {
    return 0;
  }
}
