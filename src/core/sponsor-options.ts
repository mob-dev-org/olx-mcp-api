// Dozvoljene vrijednosti izdvajanja na jednom mjestu.
//
// API odbija sve izvan ovih vrijednosti sa 422 (provjereno: 15 dana i razmak od 12 sati nisu
// validni). Prije je ista lista zivjela u tri kopije (zod seme u MCP-u, nizovi u CLI-u, tipovi),
// pa je dodavanje nove vrijednosti znacilo tri izmjene i priliku da se jedna zaboravi.

import type { RefreshEvery, SponsorDays, SponsorOptions, SponsorType } from "./types.js";

export const SPONSOR_TYPES = [0, 1, 2] as const;
export const SPONSOR_DAYS = [1, 2, 3, 5, 7, 14, 21, 30] as const;
// 0 znaci bez autoobnove. Parametar je na API-ju obavezan, pa se 0 uvijek posalje.
export const REFRESH_EVERY = [0, 3, 6, 8, 24] as const;

export function isSponsorType(value: number): value is SponsorType {
  return (SPONSOR_TYPES as readonly number[]).includes(value);
}

export function isSponsorDays(value: number): value is SponsorDays {
  return (SPONSOR_DAYS as readonly number[]).includes(value);
}

export function isRefreshEvery(value: number): value is RefreshEvery {
  return (REFRESH_EVERY as readonly number[]).includes(value);
}

export interface SponsorOptionsInput {
  type: number;
  days: number;
  refreshEvery?: number;
  homepage?: boolean;
}

// Provjerava ulaz i sklapa opcije za API. Baca gresku sa dozvoljenim vrijednostima, da korisnik
// ne mora pogadjati sta je proslo a sta nije.
export function parseSponsorOptions(input: SponsorOptionsInput): SponsorOptions {
  if (!isSponsorType(input.type)) {
    throw new Error(`Tip izdvajanja mora biti ${SPONSOR_TYPES.join(", ")} (0 bez, 1 klasicno, 2 premium).`);
  }
  if (!isSponsorDays(input.days)) {
    throw new Error(`Broj dana mora biti jedan od: ${SPONSOR_DAYS.join(", ")}.`);
  }
  const refreshEvery = input.refreshEvery ?? 0;
  if (!isRefreshEvery(refreshEvery)) {
    throw new Error(`Razmak autoobnove mora biti jedan od: ${REFRESH_EVERY.join(", ")} (sati; 0 je bez obnove).`);
  }
  return {
    type: input.type,
    days: input.days,
    refresh_every: refreshEvery,
    locations: input.homepage ? ["homepage"] : undefined,
  };
}
