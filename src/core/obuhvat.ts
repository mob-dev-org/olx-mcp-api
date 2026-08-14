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
