// Prepoznavanje sablona u opisima koje je klijent vec napisao.
//
// Zasto: pri onboardingu klijent trazi "neki standardni header footer, vidi u drugim oglasima
// kako to izgleda". Umjesto da se sablon izmisli, cita se iz onoga sto klijent VEC koristi.
//
// Kljucno ogranicenje, izmjereno na pravom shopu 30.07.2026.: na 25 uzorkovanih opisa ponovljeni
// zavrsni blok se javio u samo 2. Dakle sablon cesto NE postoji, i ove funkcije to moraju reci
// brojem pojava umjesto da nesto predloze. Footer koji se javlja u dva od sto oglasa nije footer
// nego slucaj, a upisan u profil klijenta postao bi obecanje na svim buducim oglasima.

/** Opis ociscen od HTML-a i visestrukih razmaka, da se blokovi mogu porediti. */
export function ocistiOpis(opis: string): string {
  return opis
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Ponavljanje {
  tekst: string;
  pojava: number;
  /** Postotak uzorka u kojem se javlja, zaokruzen. */
  procenat: number;
}

export interface SablonOpisa {
  uzorak: number;
  bez_opisa: number;
  zavrsni_blokovi: Ponavljanje[];
  fraze: Ponavljanje[];
  /** Kratka ocjena za covjeka: postoji li uopste sablon ili ne. */
  nalaz: string;
}

const MIN_DUZINA_BLOKA = 25;

/**
 * Trazi sablon u opisima. Vraca samo ono sto se STVARNO ponavlja, sa brojem pojava.
 *
 * `minPojava` je prag: ispod njega se ne prijavljuje nista, jer bi jedna pojava bila prijedlog iz
 * niceg. Default 3 je izabran po mjerenju: na 25 opisa dvije pojave su bile slucaj, ne navika.
 */
export function nadjiSablon(opisi: string[], opcije: { minPojava?: number } = {}): SablonOpisa {
  const minPojava = opcije.minPojava ?? 3;

  const cisti = opisi.map(ocistiOpis);
  const upotrebljivi = cisti.filter((o) => o.length >= MIN_DUZINA_BLOKA);
  const bezOpisa = cisti.filter((o) => !o).length;

  const prebroj = (kljucevi: string[][]): Ponavljanje[] => {
    const broj = new Map<string, number>();
    // Po opisu se svaki kljuc racuna JEDNOM: inace bi fraza ponovljena tri puta u jednom opisu
    // izgledala kao navika kroz tri oglasa.
    for (const izJednog of kljucevi) {
      for (const k of new Set(izJednog)) broj.set(k, (broj.get(k) ?? 0) + 1);
    }
    return [...broj.entries()]
      .filter(([, n]) => n >= minPojava)
      .map(([tekst, pojava]) => ({
        tekst,
        pojava,
        procenat: upotrebljivi.length === 0 ? 0 : Math.round((pojava / upotrebljivi.length) * 100),
      }))
      .sort((a, b) => b.pojava - a.pojava || b.tekst.length - a.tekst.length)
      .slice(0, 5);
  };

  // Zavrsni blok se trazi kao ZAJEDNICKI ZAVRSETAK, ne kao rep fiksne duzine: rep od 130 znakova
  // na kracem opisu uhvati i njegov jedinstveni pocetak, pa se nista ne poklopi. Kandidati su
  // zadnja jedna do tri recenice svakog opisa, a broji se u koliko opisa se opis TIME zavrsava.
  const kandidati = new Set<string>();
  for (const o of upotrebljivi) {
    const recenice = o.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (let n = 1; n <= Math.min(3, recenice.length); n++) {
      const kandidat = recenice.slice(-n).join(" ").trim();
      if (kandidat.length >= MIN_DUZINA_BLOKA && kandidat.length <= 300) kandidati.add(kandidat);
    }
  }
  const zavrsniSvi = [...kandidati]
    .map((tekst) => {
      const pojava = upotrebljivi.filter((o) => o.endsWith(tekst)).length;
      return {
        tekst,
        pojava,
        procenat: upotrebljivi.length === 0 ? 0 : Math.round((pojava / upotrebljivi.length) * 100),
      };
    })
    .filter((k) => k.pojava >= minPojava)
    // Duzi zajednicki zavrsetak je informativniji od kraceg sa istim brojem pojava.
    .sort((a, b) => b.pojava - a.pojava || b.tekst.length - a.tekst.length);
  // Kraci kandidat koji je samo rep duzeg sa istim brojem pojava je suvisan.
  const zavrsni = zavrsniSvi
    .filter((k, i) => !zavrsniSvi.some((d, j) => j < i && d.pojava === k.pojava && d.tekst.endsWith(k.tekst)))
    .slice(0, 5);
  const fraze = prebroj(
    upotrebljivi.map((o) =>
      o
        .split(/(?<=[.!?•])\s+|\s{2,}/)
        .map((f) => f.trim())
        .filter((f) => f.length >= MIN_DUZINA_BLOKA && f.length <= 140),
    ),
  );

  let nalaz: string;
  if (upotrebljivi.length === 0) {
    nalaz = "Nema upotrebljivih opisa u uzorku, pa se sablon ne moze citati.";
  } else if (zavrsni.length === 0 && fraze.length === 0) {
    nalaz = `Sablon NE postoji: nijedan blok se ne ponavlja u ${minPojava} ili vise od ${upotrebljivi.length} opisa. Ne izmisljaj footer.`;
  } else {
    const najjaci = [...zavrsni, ...fraze].sort((a, b) => b.pojava - a.pojava)[0]!;
    nalaz = `Najcesci ponovljeni tekst se javlja u ${najjaci.pojava} od ${upotrebljivi.length} opisa (${najjaci.procenat}%). Prenesi ga u profil klijenta SAMO ako on potvrdi da je to njegov standard.`;
  }

  return { uzorak: opisi.length, bez_opisa: bezOpisa, zavrsni_blokovi: zavrsni, fraze, nalaz };
}
