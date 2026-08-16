// Alarm van reda kad je masina pod pritiskom (malo slobodne memorije ili visok swap). Isti
// princip debouncea kao kod ostalih alarma u pogonu (vidi TIHO_ALARM_MS/alarmPoslan): da se isti
// alarm ne salje u nedogled, ali sa dvoslojnom logikom jer je "masina" dijeljena izmedju vise
// klonova na istoj fizickoj masini.
//
// Sve zavisnosti (fs funkcije, homedir) idu kao injektovani parametri default vrijednosti na
// prave implementacije, isti princip kao resursi.mjs i klonovi.mjs: modul sam ne cita process.env
// ni os.homedir osim kao default vrijednost parametra. Nijedna javna funkcija ne baca izuzetak
// napolje.

import {
  mkdirSync as fsMkdirSync,
  readFileSync as fsReadFileSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { homedir as osHomedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Cista funkcija: odlucuje da li je masina pod pritiskom na osnovu jednog uzorka
 * (`uzorakMasine()` iz resursi.mjs). `null` polje znaci nepoznato, NIKAD se ne tretira kao 0
 * (pravilo repoa): kad je slobodno/swap nepoznato, ta osnova jednostavno ne ucestvuje u odluci.
 * Kad su OBA polja null (na Windowsu load je uvijek null po dizajnu, ali slobodno/swap tamo NE bi
 * trebalo biti null), rezultat je "nema alarma", ne greska.
 */
export function provjeriPritisakMasine(
  uzorak,
  { pragSlobodnoBajta = 2 * 1024 ** 3, pragSwapOmjer = 0.85 } = {},
) {
  const razlozi = [];

  const slobodnoBajta = uzorak?.slobodnoBajta ?? null;
  if (slobodnoBajta !== null && slobodnoBajta < pragSlobodnoBajta) {
    const gb = (slobodnoBajta / 1024 ** 3).toFixed(1);
    razlozi.push(`slobodno svega ~${gb} GB`);
  }

  const swapKoristenoBajta = uzorak?.swapKoristenoBajta ?? null;
  const swapUkupnoBajta = uzorak?.swapUkupnoBajta ?? null;
  if (
    swapKoristenoBajta !== null &&
    swapUkupnoBajta !== null &&
    swapUkupnoBajta > 0 &&
    swapKoristenoBajta / swapUkupnoBajta > pragSwapOmjer
  ) {
    const postotak = Math.round((swapKoristenoBajta / swapUkupnoBajta) * 100);
    razlozi.push(`swap iskoristen ${postotak}%`);
  }

  if (razlozi.length === 0) return { alarm: false, razlog: null };
  return { alarm: true, razlog: razlozi.join(", ") };
}

/**
 * Putanja dijeljene oznake na nivou masine (van svih klonova). `env.OLX_MASINA_ALARM_FAJL`
 * (trim, ako neprazan) ima prednost, inace `~/.olx-pik-masina-alarm.json`. `homedir` injektovan
 * radi testiranja.
 */
export function putanjaOznakeMasine(env = process.env, homedir = osHomedir) {
  const override = env?.OLX_MASINA_ALARM_FAJL;
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  return join(homedir(), ".olx-pik-masina-alarm.json");
}

/**
 * Cita i parsira oznaku alarma sa diska. Razlikuje "fajl ne postoji" (normalno stanje, nije
 * greska) od stvarnog problema (nevalidan JSON, EACCES i sl). NIKAD ne baca.
 */
export function citajOznaku(putanja, { readFileSync = fsReadFileSync } = {}) {
  let sadrzaj;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { postoji: false, oznaka: null, greska: null };
    return { postoji: false, oznaka: null, greska: e?.code || e?.message || String(e) };
  }
  try {
    const oznaka = JSON.parse(sadrzaj);
    return { postoji: true, oznaka, greska: null };
  } catch (e) {
    return { postoji: false, oznaka: null, greska: e?.message || String(e) };
  }
}

/** Upisuje oznaku alarma na disk. Kreira direktorij po potrebi. NIKAD ne baca. */
export function upisiOznaku(putanja, oznaka, { writeFileSync = fsWriteFileSync, mkdirSync = fsMkdirSync } = {}) {
  try {
    mkdirSync(dirname(putanja), { recursive: true });
    writeFileSync(putanja, JSON.stringify(oznaka));
    return { ok: true, greska: null };
  } catch (e) {
    return { ok: false, greska: e?.message || String(e) };
  }
}

/** Putanja oznake alarma po klonu (fallback kad dijeljena oznaka nije dostupna). */
export function putanjaOznakeKlona(korijenKlona) {
  return join(korijenKlona, ".olx-pik", "pritisak-alarm-zadnji.json");
}

/**
 * Orkestracija: da li poslati alarm SADA, i preko koje oznake. NIKAD ne baca.
 *
 * Logika je namjerno dvoslojna jer vise klonova na istoj fizickoj masini dijele isto stanje
 * masine (pritisak vidi svaki klon istovremeno), pa bi bez koordinacije deset klonova poslalo
 * deset skoro istih poruka adminu. Zato se prvo pokusa DIJELJENA oznaka (van svih klonova); tek
 * kad ona nije dostupna (dozvole, drugi korisnik, ostecen fajl), svaki klon pada na SVOJU oznaku
 * u `.olx-pik/` i nastavlja debounce samostalno, cak i po cijenu duplih poruka od vise klonova.
 * Namjerni prioritet: bolje poslati alarm (ili poneki visak) nego ga tiho progutati kad je
 * pritisak stvaran, jer je posljedica progutanog alarma (mrtva masina) mnogo skuplja od par
 * suvisnih Telegram poruka.
 *
 * Koraci, TACNO ovim redoslijedom:
 *   1. Nema pritiska -> nema posla, {posalji:false, izvor:null}.
 *   2. Pokusaj DIJELJENU oznaku:
 *      - citajOznaku vrati STVARNU gresku (ne "ne postoji") -> ovaj sloj se NE racuna kao
 *        odgovoren, ide se na klonsku oznaku (korak 3).
 *      - inace: nema oznake ili je oznaka starija od `pragMs` -> treba poslati. Pokusaj upisati
 *        dijeljenu oznaku:
 *          - upis uspije -> gotovo, {posalji:true, izvor:"dijeljena"}.
 *          - upis NE uspije -> dijeljena koordinacija je otkazala usred slanja: alarm SE SALJE
 *            (posalji:true je vec odluceno), a klonska oznaka se upisuje "na slijepo" (bez
 *            prethodnog citanja) samo da sljedeci prolaz zna da je ovaj vec poslan.
 *      - oznaka je svjeza (unutar praga) -> dijeljena koordinacija je vec odradila posao,
 *        {posalji:false, izvor:null}. Fallback na klon se NE pokusava, jer bi to ponistilo svrhu
 *        dijeljene oznake.
 *   3. Fallback po klonu: isti citaj/uporedi-prag/upisi princip, na `putanjaOznakeKlona`. Ova
 *      grana nikad ne baca ni kad i klonska oznaka padne: u tom krajnjem slucaju alarm se svejedno
 *      salje ({posalji:true, izvor:"klon"}).
 */
export function odluciAlarmMasine({
  pritisak,
  sada,
  korijenKlona,
  env = process.env,
  pragMs = 6 * 60 * 60 * 1000,
  homedir = osHomedir,
  citajFajl = fsReadFileSync,
  pisiFajl = fsWriteFileSync,
  mkdirFn = fsMkdirSync,
} = {}) {
  if (!pritisak?.alarm) return { posalji: false, izvor: null };

  // ---- korak 2: dijeljena oznaka ----
  const putanjaDijeljena = putanjaOznakeMasine(env, homedir);
  const citanjeDijeljene = citajOznaku(putanjaDijeljena, { readFileSync: citajFajl });

  if (citanjeDijeljene.greska === null) {
    const oznaka = citanjeDijeljene.oznaka;
    const trebaPoslati = oznaka === null || sada - oznaka.ts > pragMs;
    if (!trebaPoslati) {
      return { posalji: false, izvor: null };
    }
    const upis = upisiOznaku(
      putanjaDijeljena,
      { ts: sada, razlog: pritisak.razlog },
      { writeFileSync: pisiFajl, mkdirSync: mkdirFn },
    );
    if (upis.ok) {
      return { posalji: true, izvor: "dijeljena" };
    }
    // Upis dijeljene oznake nije uspio: pritisak je stvaran, alarm se salje bez obzira, a
    // klonska oznaka se upisuje "na slijepo" (bez prethodnog citanja) radi buduceg debounce-a.
    upisiOznaku(
      putanjaOznakeKlona(korijenKlona),
      { ts: sada, razlog: pritisak.razlog },
      { writeFileSync: pisiFajl, mkdirSync: mkdirFn },
    );
    return { posalji: true, izvor: "klon" };
  }

  // ---- korak 3: fallback po klonu (citanje dijeljene oznake je stvarno palo) ----
  const putanjaKlona = putanjaOznakeKlona(korijenKlona);
  const citanjeKlona = citajOznaku(putanjaKlona, { readFileSync: citajFajl });
  const oznakaKlona = citanjeKlona.greska === null ? citanjeKlona.oznaka : null;
  const trebaPoslatiKlon = oznakaKlona === null || sada - oznakaKlona.ts > pragMs;
  if (!trebaPoslatiKlon) {
    return { posalji: false, izvor: null };
  }
  // Bolje poslati alarm nego ga tiho progutati kad je pritisak stvaran i sve koordinacije padnu,
  // zato upis koji ne uspije ne mijenja odluku (posalji ostaje true).
  upisiOznaku(putanjaKlona, { ts: sada, razlog: pritisak.razlog }, { writeFileSync: pisiFajl, mkdirSync: mkdirFn });
  return { posalji: true, izvor: "klon" };
}
