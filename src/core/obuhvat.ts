// Dijeljenje dugog spiska u komade. Jedan odgovor MCP alata ne smije nositi vise od praga
// oglasa jer svaki oglas u CSV obliku nosi tokene, a odbijanje odgovora je gore od isporuke u
// komadima: pozivalac koji stvarno treba cijeli katalog dobije ga u vise poziva, umjesto da mu
// se kaze da suzi filterom koji mu ne pomaze.

export interface Komad<T> {
  stavke: T[];
  komad: number;
  komada_ukupno: number;
  ukupno: number;
  ima_jos: boolean;
  van_opsega: boolean;
}

// Prag za grupne alate: kad je spisak `ids` izricito zadan, ne treba citati cijeli katalog da
// bi se pokupili naslovi/cijene, dovoljno je pozvati getListing po jednom ID-u. Ali taj put ima
// gornju granicu, jer niz `ids` u semi nema gornju granicu.
//
// Jedan getListing izmjeren je na oko 0,57 s. 60 ID-eva je oko 34 s, sto ostaje ispod zida MCP
// poziva od 300000 ms (300 s). Naivno "uvijek po ID-u" bi na 500 ID-eva bilo oko 285 s, tj. nova
// varijanta istog zida, pa iznad praga grupni alat i dalje cita cijeli katalog (jedan prolaz kroz
// stranice, ne N pojedinacnih poziva).
export const PRAG_IDS_BEZ_KATALOGA = 60;

// Bira nacin citanja stanja oglasa za grupne alate: "po_id" pozove getListing za svaki zadani id
// (bez citanja kataloga), "katalog" prelistava cijeli katalog kao do sada. Nema ids ili prazan
// niz nema od cega birati po ID-u, pa ide na katalog; iznad praga cijena N poziva postaje veca od
// cijene jednog prolaza kroz katalog, pa i tu ide na katalog.
export function odaberiStrategiju(
  ids: number[] | undefined,
  prag: number = PRAG_IDS_BEZ_KATALOGA,
): { nacin: "po_id" | "katalog"; broj: number } {
  const broj = ids?.length ?? 0;
  if (broj === 0) return { nacin: "katalog", broj };
  return { nacin: broj <= prag ? "po_id" : "katalog", broj };
}

// Gradi tekst uz odbijanje nepotpunog kataloga. Odvojeno od odaberiStrategiju jer je ovo cist
// tekst bez logike o citanju, testira se samo sadrzaj poruke.
//
// "Suzi na category_id" NIJE ovdje dozvoljen savjet: katalog se cita PRIJE filtriranja po
// category_id, pa filter ne smanjuje broj procitanih stranica i savjet ne bi popravio nista,
// samo bi naveo pozivaoca da ponovi istu neuspjelu radnju.
export function uputaZaNepotpun(
  razlog: string | undefined,
  sta: string,
  procitano: number,
  ukupno: number | null,
): string {
  const obimTekst = `${procitano} od ${ukupno ?? "nepoznato"} oglasa`;
  if (razlog === "budzet" || razlog === "osigurac") {
    return (
      `Katalog nije procitan u cijelosti (${obimTekst}, razlog: ${razlog}). ` +
      `${sta} nad nepotpunom listom bi preskocilo oglase koje niko nije vidio, pa je radnja zaustavljena. ` +
      `Dva puta koja stvarno rade: navedi tacan spisak ids (tada se katalog uopste ne cita), ili pokreni radnju iz CLI-ja gdje nema vremenskog budzeta.`
    );
  }
  if (razlog === "katalog_se_mijenjao") {
    return (
      `Katalog se mijenjao tokom citanja (${obimTekst}) jer je neko u medjuvremenu objavio ili obnovio oglas. ` +
      `${sta} je vec pokusano ponovo i drugi pokusaj nije pomogao. Pokusaj ponovo za koju minutu.`
    );
  }
  return (
    `Katalog nije procitan u cijelosti (${obimTekst}, razlog: ${razlog ?? "nepoznat"}). ` +
    `${sta} nad nepotpunom listom bi preskocilo oglase koje niko nije vidio, pa je radnja zaustavljena. Pokusaj ponovo.`
  );
}

// Prost rez za odgovore grupnih alata (olx_bulk_price, olx_bulk_sklanjanje, olx_refresh_bulk).
// Razlicito od podijeliUKomade: ovdje nema parametra "koji komad", samo se odsijece rep spiska i
// PRIJAVI koliko je stvarno bilo, da tihi rez nikad ne prodje kao potpun odgovor. Radnja koja se
// stvarno izvrsava (izmjena cijene, obnova, sklanjanje) uvijek ide nad punim, neodsjecenim
// spiskom; ova funkcija dira samo ono sto se stavlja u JSON odgovor.
export interface Odsjecak<T> {
  stavke: T[];
  ukupno: number;
  odsjeceno: boolean;
}

export function odsijeciSpisak<T>(spisak: T[], prag: number): Odsjecak<T> {
  const sigurniPrag = prag < 1 ? 1 : prag;
  const odsjeceno = spisak.length > sigurniPrag;
  return {
    stavke: odsjeceno ? spisak.slice(0, sigurniPrag) : spisak,
    ukupno: spisak.length,
    odsjeceno,
  };
}

export function podijeliUKomade<T>(spisak: T[], prag: number, komad: number): Komad<T> {
  const sigurniPrag = prag < 1 ? 1 : prag;
  const komadaUkupno = Math.max(1, Math.ceil(spisak.length / sigurniPrag));
  if (komad < 1 || komad > komadaUkupno) {
    return {
      stavke: [],
      komad,
      komada_ukupno: komadaUkupno,
      ukupno: spisak.length,
      ima_jos: false,
      van_opsega: true,
    };
  }
  const pocetak = (komad - 1) * sigurniPrag;
  const stavke = spisak.slice(pocetak, pocetak + sigurniPrag);
  return {
    stavke,
    komad,
    komada_ukupno: komadaUkupno,
    ukupno: spisak.length,
    ima_jos: komad < komadaUkupno,
    van_opsega: false,
  };
}
