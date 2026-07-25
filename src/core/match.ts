// Spajanje PIK/OLX oglasa sa Shopify proizvodima, da se odluka o izdvajanju veze na stvarnu zalihu.
//
// Ovdje nema I/O: sve su ciste funkcije nad podacima koje pozivalac dobavi. Tako se moze testirati
// bez mreze i bez kredencijala.
//
// Kaskada, prva pogodba pobjedjuje:
//   1. rucna mapa (override)     - najvisi prioritet, rjesava i slucajeve bez pandana (ignore)
//   2. SKU                       - deterministicki, ali na PIK strani cesto prazan
//   3. slicnost naslova          - IDF ponderisani Jaccard + trigramski Dice
//
// Zasto ne Levenshtein na cijelom naslovu: kaznio bi permutaciju rijeci jednako kao stvarnu razliku,
// a upravo permutacija je tipicna izmedju dva kataloga ("radne zastitne cipele" / "radne cipele zastitna").

export interface PikItem {
  id: number | string;
  title: string;
  sku?: string | null;
  categoryId?: number | null;
  price?: number | null;
}

export interface ShopifyItem {
  handle: string;
  title: string;
  skus?: string[];
  totalInventory?: number | null;
  price?: number | null;
}

export type MatchMethod = "override" | "sku" | "title" | "none";
export type MatchDecision = "matched" | "review" | "no_match" | "ignored";

export interface MatchCandidate {
  handle: string;
  title: string;
  score: number;
  totalInventory?: number | null;
}

export interface MatchResult {
  pikId: number | string;
  pikTitle: string;
  pikSku?: string | null;
  shopifyHandle?: string;
  shopifyTitle?: string;
  totalInventory?: number | null;
  score: number;
  method: MatchMethod;
  decision: MatchDecision;
  candidates: MatchCandidate[];
  note?: string;
}

export interface OverrideEntry {
  shopify_handle?: string;
  ignore?: boolean;
  note?: string;
}

export interface MatchOptions {
  // Iznad ovog skora par se prihvata automatski.
  autoThreshold?: number;
  // Ispod ovog skora par se odbacuje.
  reviewThreshold?: number;
  // Ako su prvi i drugi kandidat blizu, salje se na rucnu provjeru bez obzira na visinu skora.
  ambiguityMargin?: number;
  overrides?: Record<string, OverrideEntry>;
}

const DEFAULTS = { autoThreshold: 0.72, reviewThreshold: 0.5, ambiguityMargin: 0.05 };

// Dijakritike mapiramo eksplicitno PRIJE NFD normalizacije, jer dj/dz u nekim izvorima nisu
// dekomponovani pa bi ih generican postupak propustio.
const DIACRITICS: Array<[RegExp, string]> = [
  [/dž/g, "dz"],
  [/Dž/g, "dz"],
  [/đ/g, "d"],
  [/ć/g, "c"],
  [/č/g, "c"],
  [/š/g, "s"],
  [/ž/g, "z"],
];

// Izbacujemo samo prave pomocne rijeci. Rijeci kao "radne" ili "cipele" nose znacenje i ostaju,
// a njihovu cestotu rjesava IDF ponderisanje.
const STOPWORDS = new Set(["za", "i", "sa", "na", "po", "od", "the", "u", "iz"]);

export function normalizeTitle(input: string): string {
  let text = (input ?? "").toLowerCase();
  for (const [pattern, replacement] of DIACRITICS) text = text.replace(pattern, replacement);
  text = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return text.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function tokenize(input: string): string[] {
  return normalizeTitle(input)
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

// Kod modela je najjaci signal u naslovu (npr. b0714, h6401, s3), pa ga vadimo odvojeno.
export function modelTokens(input: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(input)) {
    if (/^[a-z]{1,3}\d{1,4}$/.test(token) || /^\d{3,4}$/.test(token)) tokens.add(token);
  }
  return tokens;
}

// PIK cuva SKU u tri oblika (h6412, b0714, ca-b0537-bwa), a Shopify dodaje i velicinu na kraju.
// Sve svodimo na kod modela da poredjenje bude moguce.
export function skuModelCode(sku?: string | null): string | undefined {
  if (!sku) return undefined;
  const normalized = sku.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/([BH]\d{3,4})/);
  return match ? match[1] : normalized || undefined;
}

export function buildIdf(corpus: string[]): Map<string, number> {
  const documentCount = Math.max(1, corpus.length);
  const seenIn = new Map<string, number>();
  for (const text of corpus) {
    for (const token of new Set(tokenize(text))) {
      seenIn.set(token, (seenIn.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of seenIn) {
    idf.set(token, Math.log(1 + documentCount / count));
  }
  return idf;
}

function weight(token: string, idf?: Map<string, number>): number {
  if (!idf) return 1;
  return idf.get(token) ?? Math.log(1 + 1 / 1);
}

// Jaccard, ali svaki token nosi svoju IDF tezinu. Time rijetki tokeni (bull, b0714) odlucuju,
// a ucestali (radne, cipele, mix) skoro ne uticu.
export function idfJaccard(a: string, b: string, idf?: Map<string, number>): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  let union = 0;
  for (const token of new Set([...setA, ...setB])) {
    const w = weight(token, idf);
    union += w;
    if (setA.has(token) && setB.has(token)) intersection += w;
  }
  return union === 0 ? 0 : intersection / union;
}

function trigrams(text: string): Set<string> {
  const padded = ` ${normalizeTitle(text)} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

// Hvata razlike unutar rijeci koje tokenizacija propusti (zastitna prema zastitne).
export function trigramDice(a: string, b: string): number {
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let shared = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) shared++;
  return (2 * shared) / (gramsA.size + gramsB.size);
}

export function scorePair(a: string, b: string, idf?: Map<string, number>): number {
  const base = 0.6 * idfJaccard(a, b, idf) + 0.4 * trigramDice(a, b);
  const modelsA = modelTokens(a);
  const modelsB = modelTokens(b);
  let bonus = 0;
  for (const token of modelsA) {
    if (modelsB.has(token)) {
      bonus = 0.05;
      break;
    }
  }
  return Math.min(1, base + bonus);
}

export function matchCatalog(
  pikItems: PikItem[],
  shopifyItems: ShopifyItem[],
  options: MatchOptions = {},
): MatchResult[] {
  const autoThreshold = options.autoThreshold ?? DEFAULTS.autoThreshold;
  const reviewThreshold = options.reviewThreshold ?? DEFAULTS.reviewThreshold;
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULTS.ambiguityMargin;
  const overrides = options.overrides ?? {};

  const idf = buildIdf([...pikItems.map((i) => i.title), ...shopifyItems.map((i) => i.title)]);
  const byHandle = new Map(shopifyItems.map((item) => [item.handle, item]));

  // Indeks po kodu modela: iz varijantnih SKU i iz handlea, jer handle cesto sadrzi kod (base-bull-b0714).
  const bySkuCode = new Map<string, ShopifyItem>();
  for (const item of shopifyItems) {
    const codes = new Set<string>();
    for (const sku of item.skus ?? []) {
      const code = skuModelCode(sku);
      if (code) codes.add(code);
    }
    const fromHandle = skuModelCode(item.handle);
    if (fromHandle) codes.add(fromHandle);
    for (const code of codes) if (!bySkuCode.has(code)) bySkuCode.set(code, item);
  }

  return pikItems.map((pik) => {
    const base = {
      pikId: pik.id,
      pikTitle: pik.title,
      pikSku: pik.sku ?? null,
      candidates: [] as MatchCandidate[],
    };

    const override = overrides[String(pik.id)];
    if (override?.ignore) {
      return { ...base, score: 0, method: "override" as const, decision: "ignored" as const, note: override.note };
    }
    if (override?.shopify_handle) {
      const hit = byHandle.get(override.shopify_handle);
      return {
        ...base,
        shopifyHandle: override.shopify_handle,
        shopifyTitle: hit?.title,
        totalInventory: hit?.totalInventory ?? null,
        score: 1,
        method: "override" as const,
        decision: "matched" as const,
        note: hit ? override.note : "override pokazuje na handle koji ne postoji u Shopify katalogu",
      };
    }

    const skuCode = skuModelCode(pik.sku);
    if (skuCode) {
      const hit = bySkuCode.get(skuCode);
      if (hit) {
        return {
          ...base,
          shopifyHandle: hit.handle,
          shopifyTitle: hit.title,
          totalInventory: hit.totalInventory ?? null,
          score: 1,
          method: "sku" as const,
          decision: "matched" as const,
        };
      }
    }

    const ranked = shopifyItems
      .map((item) => ({
        handle: item.handle,
        title: item.title,
        totalInventory: item.totalInventory ?? null,
        score: scorePair(pik.title, item.title, idf),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const best = ranked[0];
    if (!best || best.score < reviewThreshold) {
      return { ...base, candidates: ranked, score: best?.score ?? 0, method: "none" as const, decision: "no_match" as const };
    }

    const second = ranked[1];
    const ambiguous = second !== undefined && best.score - second.score < ambiguityMargin;
    const decision: MatchDecision = best.score >= autoThreshold && !ambiguous ? "matched" : "review";

    return {
      ...base,
      candidates: ranked,
      shopifyHandle: best.handle,
      shopifyTitle: best.title,
      totalInventory: best.totalInventory,
      score: Number(best.score.toFixed(4)),
      method: "title" as const,
      decision,
      note: ambiguous ? "prva dva kandidata su preblizu, treba rucna provjera" : undefined,
    };
  });
}

export function summarizeMatches(results: MatchResult[]): Record<MatchDecision, number> {
  const summary: Record<MatchDecision, number> = { matched: 0, review: 0, no_match: 0, ignored: 0 };
  for (const result of results) summary[result.decision]++;
  return summary;
}
