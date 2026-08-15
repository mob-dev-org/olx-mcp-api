// Ko je vlasnik oglasa, kao cista odluka bez ijednog poziva.
//
// Alati koji rade po ID-u oglasa (`olx_get_listing`, `olx_listing_report`) ne mogu se zatvoriti
// isto kao alati koji primaju `user`: ID tudjeg oglasa stize najobicnijim putem, linkom koji covjek
// nalijepi u poruku, a endpoint `/listings/:id` ne provjerava vlasnistvo. Odluka je zato ovdje, kao
// funkcija nad vec procitanim odgovorom: server je zove sa oglasom u ruci, pa provjera ne kosta
// nijedan dodatni poziv za sam oglas.
//
// Vlasnik se cita iz SIROVOG odgovora. Kompaktan oblik (`kompaktListing`) polje `user` namjerno
// izbacuje, pa provjera mora stajati prije kompaktiranja.

import type { Listing } from "./types.js";

/**
 * `moj` i `tudji` su ocekivani ishodi; `nepoznat` znaci da odgovor nema citljivog vlasnika.
 *
 * Ta treca vrijednost postoji da se ne bi mijesala sa `tudji`: nula i "ne znam" nisu isto (isto
 * pravilo kao za nepoznatu cijenu u `granice.md`). Pozivalac oba slucaja odbija, ali ih razlicito
 * prijavljuje, jer `nepoznat` znaci promjenu na API-ju a ne pogresan oglas.
 */
export type Vlasnistvo = "moj" | "tudji" | "nepoznat";

/**
 * Cije je oglas, po `user.username` iz odgovora.
 *
 * Poredi se bez razlike u velicini slova i uz odsijecanje razmaka, jer je username na platformi
 * jedinstven bez obzira na to kako je otkucan.
 */
export function vlasnistvoOglasa(oglas: Listing, mojUsername: string): Vlasnistvo {
  const polje = (oglas.user as { username?: unknown } | undefined)?.username;
  const vlasnik = typeof polje === "string" ? polje.trim() : "";
  const moj = mojUsername.trim();
  if (!vlasnik || !moj) return "nepoznat";
  return vlasnik.toLowerCase() === moj.toLowerCase() ? "moj" : "tudji";
}
