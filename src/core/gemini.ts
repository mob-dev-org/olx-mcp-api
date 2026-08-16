// Zajednicki sloj za Google Gemini: koriste ga i opis slike (vid.ts) i generisanje slike
// (slika.ts). Isti endpoint, razlika je samo u tome sta se trazi na izlazu.
//
// Sirovi fetch, bez SDK-a, isti obrazac kao src/core/telegram.ts: jedan endpoint, jedan oblik
// zahtjeva, nema potrebe za zavisnoscu.
//
// Endpoint je klasicni `models/{model}:generateContent`. Google od 2026. nudi i noviji
// `/v1beta/interactions`, a generateContent je u dokumentaciji naveden kao i dalje u punoj
// podrsci; drzimo se njega jer mu je oblik zahtjeva i odgovora stabilan.

const PODRAZUMIJEVANA_BAZA = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiDioZahtjeva {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiDioOdgovora {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiOdgovor {
  candidates?: { content?: { parts?: GeminiDioOdgovora[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

export interface GeminiRezultat {
  /** Sav tekst iz odgovora, spojen. Prazan string kad model nije vratio tekst. */
  tekst: string;
  /** Prva slika iz odgovora, kad je trazena. */
  slika: { mime: string; podaci: string } | null;
  ulazTokena: number;
  izlazTokena: number;
}

export interface GeminiZahtjev {
  kljuc: string;
  model: string;
  dijelovi: GeminiDioZahtjeva[];
  /** Postavi kad se trazi slika na izlazu; za opis slike se izostavlja. */
  slikaNaIzlazu?: { odnos: string };
  baseUrl?: string;
}

/**
 * Da li je model dozvoljen za pozivanje. "Pro" varijante su iskljucene BEZ izuzetka i bez
 * allowliste: red velicine su skuplje, a u praksi se pro model zna izabrati i nenamjerno kroz
 * env ili mapiranje imena (izmjereno 04.08.2026: 1.68 USD u jednom danu). Poredi se SEGMENT
 * imena, ne podniz, da hipoteticko ime sa "pro" unutar rijeci (professional) ne padne.
 */
export function modelDozvoljen(model: string): { ok: true } | { ok: false; razlog: string } {
  if (model.toLowerCase().split(/[-._/]/).includes("pro")) {
    return {
      ok: false,
      razlog: `model "${model}" je odbijen: pro modeli su iskljuceni zbog troska; koristi flash varijantu (OLX_SLIKA_MODEL / OLX_VID_MODEL)`,
    };
  }
  return { ok: true };
}

/**
 * Posalje jedan zahtjev Geminiju i vrati tekst i sliku iz odgovora.
 * Baca jasnu gresku sa objasnjenjem koje je Google vratio, jer je to jedini koristan trag.
 */
export async function pozoviGemini(z: GeminiZahtjev): Promise<GeminiRezultat> {
  // Mreza sigurnosti za svakog pozivaoca (slika, vid, buduci): pro model ne prolazi nikad.
  const dozvola = modelDozvoljen(z.model);
  if (!dozvola.ok) throw new Error(dozvola.razlog);
  const baza = z.baseUrl || process.env.OLX_GEMINI_BASE_URL || PODRAZUMIJEVANA_BAZA;
  const odgovor = await fetch(`${baza}/models/${encodeURIComponent(z.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": z.kljuc, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: z.dijelovi }],
      ...(z.slikaNaIzlazu
        ? {
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { aspectRatio: z.slikaNaIzlazu.odnos },
            },
          }
        : {}),
    }),
  });

  const tijelo = (await odgovor.json().catch(() => ({}))) as GeminiOdgovor;
  if (!odgovor.ok) {
    throw new Error(`Gemini je odbio zahtjev (${odgovor.status}): ${tijelo.error?.message ?? "bez objasnjenja"}`);
  }
  if (tijelo.promptFeedback?.blockReason) {
    throw new Error(`Gemini je blokirao zahtjev: ${tijelo.promptFeedback.blockReason}`);
  }

  const tekstovi: string[] = [];
  let slika: GeminiRezultat["slika"] = null;
  for (const kandidat of tijelo.candidates ?? []) {
    for (const dio of kandidat.content?.parts ?? []) {
      if (dio.text) tekstovi.push(dio.text);
      const inline = dio.inlineData ?? dio.inline_data;
      if (!slika && inline?.data) {
        slika = { mime: dio.inlineData?.mimeType ?? dio.inline_data?.mime_type ?? "image/png", podaci: inline.data };
      }
    }
  }

  return {
    tekst: tekstovi.join("\n").trim(),
    slika,
    ulazTokena: tijelo.usageMetadata?.promptTokenCount ?? 0,
    izlazTokena: tijelo.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
