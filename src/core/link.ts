// Javni link na oglas.
//
// Zasto postoji: API NE vraca URL oglasa, pa je bot u praksi (30.07.2026.) na "daj link" morao
// odgovoriti da link ne moze dati i uputiti korisnika da sam pretrazi svoj shop. Link se ipak
// moze sastaviti od `id`, a oglas nosi i `slug`. Provjereno zivim pozivom: oba oblika vracaju
// HTTP 200, i sa slugom i bez njega.
//
// Domen je namjerno u env varijabli: platforma je u rebrandu olx.ba -> pik.ba (isti razlog zbog
// kojeg je `OLX_BASE_URL` u .env), pa kad se promijeni, mijenja se konfiguracija a ne kod.

const PODRAZUMIJEVANI_DOMEN = "https://olx.ba";

/**
 * Javni link na oglas. Sa slugom je citljiviji covjeku, bez sluga radi isto.
 * Vraca null kad id nije upotrebljiv, da se nikad ne posalje link tipa `/artikal/undefined`.
 */
export function linkOglasa(id: unknown, slug?: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const broj = Number(id);
  if (!Number.isFinite(broj) || broj <= 0) return null;
  const domen = (env.OLX_PUBLIC_URL || PODRAZUMIJEVANI_DOMEN).replace(/\/+$/, "");
  const cist = typeof slug === "string" ? slug.trim().replace(/^\/+|\/+$/g, "") : "";
  return cist ? `${domen}/artikal/${broj}/${cist}` : `${domen}/artikal/${broj}`;
}
