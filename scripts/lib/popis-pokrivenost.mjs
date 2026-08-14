// Veza izmedju rucne liste (`olx-dokumentacija/sta-sistem-radi.md`) i onoga sto kod stvarno moze.
//
// Rucna lista je JEDINI dio popisa koji se pise rukom, jer se iz imena alata ne moze izvesti korist
// za klijenta. Ali i ona mora starjeti glasno, ne tiho. Zato svaka njena sekcija nosi jedan
// nevidljivi red:
//
//     <!-- pokriva: olx_create_listing, olx_publish_listing, cli:listings, posao:dnevno -->
//
// i vrijedi jedno pravilo: svaka sposobnost iz koda pojavljuje se u tacno jednoj sekciji.
//
// Sta to znaci u praksi, a to je i bila namjera:
//   promjena opisa alata      niko nista ne dira, opisi se ovdje uopste ne porede
//   nov alat u postojecoj temi jedno ime se dopise u postojeci `pokriva`, recenice ostaju
//   stvarno nova sposobnost    nema je gdje dopisati bez nove sekcije, a nova sekcija trazi recenicu
//
// Imena su doslovna, nikad obrasci tipa `olx_category*`. Obrazac bi progutao stvarno novu
// sposobnost samo zato sto joj ime lici na staru, a to je ista bolest zbog koje popis postoji.

import { imenaZaPokrivanje } from "./popis-podaci.mjs";

const OZNAKA_POKRIVA = /^<!--\s*pokriva:\s*([\s\S]*?)-->\s*$/;

/**
 * Razlaze rucnu listu na sekcije. Sekcija je naslov drugog nivoa, njegov red `pokriva` i proza
 * ispod. Uvod prije prvog naslova se preskace.
 */
export function citajRucnuListu(tekst) {
  const sekcije = [];
  let trenutna = null;
  for (const red of tekst.split(/\r?\n/)) {
    const naslov = red.match(/^##\s+(.*\S)\s*$/);
    if (naslov) {
      if (trenutna) sekcije.push(trenutna);
      trenutna = { naslov: naslov[1], pokriva: [], proza: [] };
      continue;
    }
    if (!trenutna) continue;
    const pokriva = red.match(OZNAKA_POKRIVA);
    if (pokriva) {
      trenutna.pokriva.push(
        ...pokriva[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }
    if (red.trim()) trenutna.proza.push(red.trim());
  }
  if (trenutna) sekcije.push(trenutna);
  return sekcije;
}

/**
 * Vraca spisak zamjerki, prazan kad je sve u redu. Svaka zamjerka je recenica koja kaze sta je
 * pogresno I sta covjek treba da uradi: poruka testa je jedino sto ce neko procitati kad ovo padne
 * za pola godine.
 */
export function provjeriPokrivenost(podaci, tekstRucneListe) {
  const zamjerke = [];
  const sekcije = citajRucnuListu(tekstRucneListe);

  if (sekcije.length === 0) {
    return ["olx-dokumentacija/sta-sistem-radi.md nema nijednu sekciju (naslov drugog nivoa)."];
  }

  const uKodu = new Set(imenaZaPokrivanje(podaci));
  const gdjeJePokriveno = new Map();

  for (const s of sekcije) {
    if (s.pokriva.length === 0) {
      zamjerke.push(
        `Sekcija "${s.naslov}" nema red <!-- pokriva: ... -->. Bez njega se ne zna sta ta recenica ` +
          "opisuje, pa ne moze ni ostarjeti glasno.",
      );
    }
    if (s.proza.length === 0) {
      zamjerke.push(
        `Sekcija "${s.naslov}" nema nijednu recenicu. Popis sposobnosti bez objasnjenja obicnim ` +
          "jezikom ne koristi nikome.",
      );
    }
    for (const ime of s.pokriva) {
      if (!uKodu.has(ime)) {
        zamjerke.push(
          `Sekcija "${s.naslov}" pokriva "${ime}", cega u kodu nema. Ili je preimenovano, ili ` +
            "uklonjeno; ukloni ga i iz rucne liste.",
        );
        continue;
      }
      const vec = gdjeJePokriveno.get(ime);
      if (vec) {
        zamjerke.push(
          `"${ime}" je pokriveno dva puta, u "${vec}" i u "${s.naslov}". Svaka sposobnost pripada ` +
            "tacno jednoj temi, inace covjek ne zna koju recenicu da kaze.",
        );
        continue;
      }
      gdjeJePokriveno.set(ime, s.naslov);
    }
  }

  const nepokriveno = [...uKodu].filter((i) => !gdjeJePokriveno.has(i)).sort();
  if (nepokriveno.length > 0) {
    zamjerke.push(
      `Sistem ovo moze, a rucna lista o tome cuti: ${nepokriveno.join(", ")}.\n` +
        "  Dopisi svako ime u <!-- pokriva: ... --> one sekcije kojoj tematski pripada. Ako ne " +
        "pripada nijednoj,\n  to je stvarno nova sposobnost i trazi novu sekciju sa jednom " +
        "recenicom obicnim jezikom.",
    );
  }

  return zamjerke;
}
