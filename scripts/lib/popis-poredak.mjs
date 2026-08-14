/**
 * Poredjenje stringova po kodnim tackama, bez jezickih pravila.
 *
 * Zasto ne `localeCompare`: on zavisi od jezickih postavki masine i od toga kako je Node preveden
 * (ICU). Isti popis bi se onda na dvije masine slozio razlicitim redom, a provjera svjezine poredi
 * generisani fajl znak po znak i vrti se i na klijentskim klonovima. Red mora biti isti svuda,
 * pa vazi jedino sto ne zavisi ni od cega spolja.
 */
export function poredi(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sortira niz objekata po jednom polju, istim stabilnim poretkom. */
export function poPolju(polje) {
  return (x, y) => poredi(String(x[polje]), String(y[polje]));
}
