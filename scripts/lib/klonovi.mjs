// Zajednicki nalazac "spiska klonova flote". Prije ovog modula su postojala DVA nezavisna,
// neuskladjena mehanizma: bash skripte (backup-nadzor.sh, ai-runda.sh) citaju
// ~/.olx-klijenti.txt (jedna apsolutna putanja po redu, override env OLX_KLIJENTI_POPIS), a
// scripts/resursi.mjs je imao svoju privatnu listajKlonove(rootDir) koja skenira poddirektorije
// foldera i uzima one sa .olx-pik podfolderom (opcija --svi <root>). Ovaj modul objedinjuje obje
// putanje iza jedne orkestracije (nadjiKlonove) sa preciznim prioritetom izvora.
//
// Isti princip kao resursi.mjs i straza.mjs: sve zavisnosti (fs funkcije, process.env,
// os.homedir) idu kao injektovani parametri sa default vrijednostima na prave implementacije,
// modul sam ne cita process.env ni os.homedir osim kao default vrijednost parametra. Nijedna
// javna funkcija ne baca izuzetak napolje: sve je best effort.

import { existsSync, readFileSync as readFileSyncNode, readdirSync as readdirSyncNode } from "node:fs";
import { homedir as homedirNode } from "node:os";
import { basename, join } from "node:path";

/**
 * Parsira sirov tekst popisa klonova (~/.olx-klijenti.txt, jedna putanja po liniji). Cista
 * funkcija. Pravila identicna onome sto backup-nadzor.sh vec radi: sve poslije "#" na liniji se
 * odsijeca (komentar), whitespace se trimuje, prazne linije se preskacu. Podrzava i CRLF
 * (Windows) linije. Redoslijed je ocuvan.
 */
export function parsirajPopis(sadrzaj) {
  const rezultat = [];
  if (!sadrzaj) return rezultat;
  for (const sirovaLinija of sadrzaj.split("\n")) {
    const bezKraja = sirovaLinija.replace(/\r$/, "");
    const bezKomentara = bezKraja.split("#")[0];
    const putanja = bezKomentara.trim();
    if (!putanja) continue;
    rezultat.push(putanja);
  }
  return rezultat;
}

// Zajednicki citac direktorija za obje "root" funkcije ispod: jedan poziv readdirSync po pozivu
// javnih funkcija, umjesto da listajPodmapeSaOlxPik i nadjiKlonove citaju isti root dvaput.
function citajUlazeRoota(rootDir, readdirSync) {
  try {
    return { ok: true, ulazi: readdirSync(rootDir, { withFileTypes: true }) };
  } catch (e) {
    return { ok: false, greska: e.message };
  }
}

function filtrirajOlxPikUlaze(rootDir, ulazi, postoji) {
  return ulazi
    .filter((s) => s.isDirectory() && postoji(join(rootDir, s.name, ".olx-pik")))
    .map((s) => s.name)
    .sort()
    .map((ime) => join(rootDir, ime));
}

/**
 * Isto sto je scripts/resursi.mjs ranije radio u svojoj privatnoj listajKlonove funkciji: cita
 * rootDir, zadrzava samo direktorije koji imaju .olx-pik podfolder, vraca APSOLUTNE putanje
 * (ne samo imena), sortirano po imenu. readdirSync/existsSync su injektovani (default prave
 * node:fs funkcije) radi testabilnosti. Ako readdirSync baci (root ne postoji), funkcija NE
 * baca dalje, vraca prazan niz.
 */
export function listajPodmapeSaOlxPik(rootDir, { readdirSync = readdirSyncNode, existsSync: postoji = existsSync } = {}) {
  const citano = citajUlazeRoota(rootDir, readdirSync);
  if (!citano.ok) return [];
  return filtrirajOlxPikUlaze(rootDir, citano.ulazi, postoji);
}

/**
 * Orkestracija sa preciznim prioritetom izvora:
 * 1. `cliRoot` (ako je neprazan string) -> folder sken tog roota.
 * 2. inace `env.OLX_KLIJENTI_ROOT` (ako je neprazan, trim) -> folder sken te putanje.
 * 3. inace popis: putanja je `env.OLX_KLIJENTI_POPIS` (trim) ili, ako nije postavljen,
 *    join(homedir(), ".olx-klijenti.txt"). Cita se preko `citajFajl`, parsira preko
 *    `parsirajPopis`.
 *
 * Povratni oblik je UVIJEK { klonovi, izvor, izvorPutanja, greska }, isti oblik bez obzira na
 * granu:
 * - "root" grana: prazan sken NIJE greska (prazan root je moguc), ali root koji ne postoji
 *   (readdir baci) JESTE greska.
 * - "popis" grana: fajl koji ne postoji ili ciji je citajFajl baci JESTE greska (namjerno
 *   glasno, za razliku od bash skripti koje ovo pregaze tiho). Fajl koji postoji ali je prazan
 *   ili samo komentari NIJE greska, samo prazna flota.
 */
export function nadjiKlonove({
  cliRoot,
  env = process.env,
  homedir = homedirNode,
  citajFajl = (putanja) => readFileSyncNode(putanja, "utf8"),
  readdirSync = readdirSyncNode,
  existsSync: postoji = existsSync,
} = {}) {
  if (typeof cliRoot === "string" && cliRoot.trim() !== "") {
    return nadjiFolderSken(cliRoot, { readdirSync, existsSync: postoji });
  }

  const envRoot = env?.OLX_KLIJENTI_ROOT;
  if (typeof envRoot === "string" && envRoot.trim() !== "") {
    return nadjiFolderSken(envRoot.trim(), { readdirSync, existsSync: postoji });
  }

  const envPopis = env?.OLX_KLIJENTI_POPIS;
  const putanjaPopisa =
    typeof envPopis === "string" && envPopis.trim() !== "" ? envPopis.trim() : join(homedir(), ".olx-klijenti.txt");

  let sadrzaj;
  try {
    sadrzaj = citajFajl(putanjaPopisa);
  } catch (e) {
    return {
      klonovi: [],
      izvor: null,
      izvorPutanja: putanjaPopisa,
      greska: `Nema popisa klonova: ${putanjaPopisa} (${e.message})`,
    };
  }

  const klonovi = parsirajPopis(sadrzaj);
  return { klonovi, izvor: "popis", izvorPutanja: putanjaPopisa, greska: null };
}

// Zajednicka "root" grana za cliRoot i OLX_KLIJENTI_ROOT: prazan sken nije greska, ali root koji
// ne postoji (readdir baci) jeste.
function nadjiFolderSken(rootDir, { readdirSync, existsSync: postoji }) {
  const citano = citajUlazeRoota(rootDir, readdirSync);
  if (!citano.ok) {
    return { klonovi: [], izvor: "root", izvorPutanja: rootDir, greska: `Ne mogu citati ${rootDir}: ${citano.greska}` };
  }
  const klonovi = filtrirajOlxPikUlaze(rootDir, citano.ulazi, postoji);
  return { klonovi, izvor: "root", izvorPutanja: rootDir, greska: null };
}

// Poddirektoriji koje ugnijezdena provjera nikad ne otvara: node_modules i dist su generisani
// (mogu imati desetine hiljada stavki, a nikad nisu klon niti ce klon sadrzavati sami sebe unutar
// njih), .git je interna git struktura. Isti duh kao skip logika u disk.mjs.
const PRESKOCI_PODFOLDER = new Set(["node_modules", ".git", "dist"]);

/**
 * Trazi klon slucajno kopiran UNUTAR drugog klona (npr. `cp -a` greskom napravljen unutar
 * samog sebe: `klon/klon/.olx-pik/...`). Motivacija: takva kopija zagadjuje flotski nadzor, klon
 * se "vidi" dvaput ili se disk mjeri pogresno.
 *
 * Provjera je namjerno PLITKA: za svaki `klon` iz ulaznog niza cita se SAMO jedan nivo
 * (`readdirSync(klonPutanja, {withFileTypes:true})`), nikad rekurzivno dublje. Klon moze imati
 * `node_modules` sa desetinama hiljada fajlova/foldera, pa dubok rekurzivni sken svakog klona ne
 * dolazi u obzir za rutinski nadzor; `node_modules`, `.git` i `dist` se iz istog razloga (i jer
 * po prirodi nikad nisu ugnijezdena kopija klona) preskacu bez otvaranja.
 *
 * Za svaki preostali poddirektorij se provjerava `postoji(<poddirektorij>/.olx-pik)`: ako
 * postoji, poddirektorij je ugnijezdena kopija. `readdirSync` je u try/catch po klonu, klon koji
 * u medjuvremenu nestane ili na koji nema pristupa se tiho preskace (best effort, ne baca), ne
 * prekida obradu ostalih klonova.
 *
 * `klonovi` je niz APSOLUTNIH putanja (isti oblik kao `klonovi` iz `nadjiKlonove`/
 * `listajPodmapeSaOlxPik`). Vraca ravan niz `{ klon, putanja }` preko SVIH ulaznih klonova
 * (ne grupisano po klonu): `klon` je basename klon-foldera, `putanja` je apsolutna putanja
 * ugnijezdene kopije. Ako `klonovi` nije niz, vraca prazan niz bez bacanja.
 */
export function pronadjiUgnijezdeneKopije(klonovi, { readdirSync = readdirSyncNode, existsSync: postoji = existsSync } = {}) {
  if (!Array.isArray(klonovi)) return [];

  const rezultat = [];
  for (const klonPutanja of klonovi) {
    let ulazi;
    try {
      ulazi = readdirSync(klonPutanja, { withFileTypes: true });
    } catch {
      continue; // klon nestao ili nema pristupa, tiho preskoci
    }

    const imeKlonaBase = basename(klonPutanja);
    for (const ulaz of ulazi) {
      if (!ulaz.isDirectory()) continue;
      if (PRESKOCI_PODFOLDER.has(ulaz.name)) continue;

      const putanjaPodfoldera = join(klonPutanja, ulaz.name);
      if (postoji(join(putanjaPodfoldera, ".olx-pik"))) {
        rezultat.push({ klon: imeKlonaBase, putanja: putanjaPodfoldera });
      }
    }
  }

  return rezultat;
}
