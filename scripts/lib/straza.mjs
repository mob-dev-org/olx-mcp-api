// Strazar rezim za cuvara sesije: kad je sesija dugo mirovala, cuvar je ugasi i umjesto nje
// drzi jeftinu strazu nad botovim tokenom kroz Telegram getUpdates long poll. Straza NIKAD ne
// potvrdjuje offset, dakle poruku samo VIDI, ne pojede: na prvi update digne sesiju, a Telegram
// plugin unutar zive sesije istu poruku povuce ponovo i normalno obradi (getUpdates bez offseta
// vraca isti update dok ga niko ne potvrdi).
//
// Modul ne dira process.env i ne cita globalno stanje: sve dolazi kao argument, isti princip kao
// scripts/lib/sesija.mjs i scripts/lib/envfajl.mjs. Token se nikad ne loguje, ne vraca u poruci
// greske, ne pojavljuje se nigdje osim u URL-u fetch poziva.

import { join } from "node:path";
import { procitajEnv } from "./envfajl.mjs";

export const POLL_TIMEOUT_S = 50;
export const ZAHTJEV_KROV_MS = 70_000;
export const BACKOFF_POCETNI_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;
export const TIHO_ALARM_MS = 30 * 60_000;
// Cekanje je normalno na Telegram strani (long poll), pa petlja sama ne pauzira. Ako runda ipak
// vrati prazno gotovo odmah (proxy koji ne postuje timeout, kesiran odgovor), bez ove brane bi
// straza kucala hiljade zahtjeva u minuti dok je Telegram ne zauzda sa 429.
export const MIN_RUNDA_MS = 1_000;

// Da nam ne trazi tu vrijednost na svakom mjestu.
const BACKOFF_KORAK = 2;

/**
 * Da li je strazar rezim ukljucen za ovaj tip sesije. Cita `OLX_SESIJA_STRAZAR` iz env objekta
 * (pozivalac ga daje eksplicitno, modul sam ne dira process.env).
 *
 * Trim i toLowerCase PRIJE poredjenja je namjeran: `OLX_KLIJENT_AI` je vec jednom tiho pao jer je
 * citanje bilo bez toLowerCase (vidi komentar na vrhu sesija.mjs), ista greska se ovdje ne
 * ponavlja.
 */
export function strazarUkljucen(env, jeAdmin) {
  const sirovo = env?.OLX_SESIJA_STRAZAR;
  if (sirovo === undefined || sirovo === null || sirovo.trim() === "") {
    return { ukljucen: false };
  }
  const v = sirovo.trim().toLowerCase();
  if (["1", "true", "da", "yes"].includes(v)) return { ukljucen: true };
  if (v === "admin") return { ukljucen: jeAdmin === true };
  if (v === "klijent") return { ukljucen: jeAdmin === false };
  if (["0", "false", "ne", "no"].includes(v)) return { ukljucen: false };
  return {
    ukljucen: false,
    upozorenje: `OLX_SESIJA_STRAZAR ima nepoznatu vrijednost "${sirovo}". Dozvoljeno: 1, true, da, yes, admin, klijent, 0, false, ne, no (ili prazno/izostavljeno).`,
  };
}

/**
 * Default idle praga (u satima) prije restarta sesije, po tipu sesije i po tome da li je
 * strazar rezim ukljucen. Sa strazarom istek praga sesiju GASI i memorija se stvarno oslobodi,
 * pa se isplati kraci prag (admin 0.5, klijent 1). Bez strazara istek praga sesiju samo
 * RESTARTUJE (kontekst se brise, proces ostaje dignut, memorija se ne oslobadja), pa kraci prag
 * tu ne stedi nista i samo kosta kontinuitet razgovora, zato vraca stariju, duzu vrijednost
 * (admin 1, klijent 2). Pozivalac ovo koristi kao fallback; izricito zadan
 * `OLX_SESIJA_IDLE_SATI` uvijek ima prednost.
 */
export function idlePragSati(jeAdmin, strazarUkljucen) {
  if (strazarUkljucen) return jeAdmin ? 0.5 : 1;
  return jeAdmin ? 1 : 2;
}

/**
 * Jedini dozvoljeni izvor bot tokena za strazu. Telegram plugin unutar sesije cita SVOJ token
 * bas odavde: `$TELEGRAM_STATE_DIR/.env`, dakle `<runtime>/channels/telegram/.env` (pisu ga
 * scripts/pripremi-runtime.mjs i scripts/pripremi-admin-runtime.mjs). Fallback na
 * TELEGRAM_BOT_TOKEN iz .env klona je ZABRANJEN: to je klijentski bot, pa bi admin strazar tako
 * pollovao klijentskog bota, krao mu poruke i pravio 409 protiv zive klijentske sesije.
 */
export function procitajBotToken(telegramDir) {
  const mapa = procitajEnv(join(telegramDir, ".env"));
  const token = (mapa.TELEGRAM_BOT_TOKEN ?? "").trim();
  return token === "" ? undefined : token;
}

// Eksponencijalni backoff sa plafonom. pokusaj <= 0 se ponasa kao prvi pokusaj (5000), jer
// pozivalac koji jos nije ni pokusao nema razloga cekati manje od minimuma.
export function backoffMs(pokusaj) {
  const p = pokusaj > 1 ? pokusaj : 1;
  return Math.min(BACKOFF_POCETNI_MS * BACKOFF_KORAK ** (p - 1), BACKOFF_MAX_MS);
}

// Chat id iz update-a, ovim redom polja (prvo koje postoji pobjedjuje). Nepoznat tip update-a
// (npr. poll, chat_join_request) daje undefined i typing se tad samo preskace, nikad ne baca.
export function chatIzUpdatea(update) {
  const izvori = [
    update?.message,
    update?.edited_message,
    update?.channel_post,
    update?.edited_channel_post,
    update?.callback_query?.message,
    update?.my_chat_member,
  ];
  for (const izvor of izvori) {
    const id = izvor?.chat?.id;
    if (id !== undefined && id !== null) return String(id);
  }
  return undefined;
}

/**
 * "Kucam, evo me" signal dok sesija jos nije ustala: sendChatAction typing. Best effort po
 * dizajnu, straza postoji da bude jeftina i ne smije pasti zbog ovoga, zato svaka greska vraca
 * false umjesto da probije poziv.
 */
export async function posaljiTyping({ token, chatId, fetchImpl = fetch }) {
  if (!chatId) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
    const j = await res.json().catch(() => ({}));
    return j?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Glavna petlja straze: long poll getUpdates dok cuvar ne digne sesiju ili ne prekine signal.
 *
 * Ugovor sa Telegram pluginom (ne dirati bez ponovnog citanja pogon.md):
 * - tijelo NIKAD ne sadrzi offset: offset je potvrda, straza samo gleda, offset salje plugin kad
 *   sesija ustane. Sa offsetom bi straza pojela poruku i klijent bi ostao bez odgovora.
 * - tijelo NIKAD ne sadrzi allowed_updates: Telegram pamti zadnju poslanu vrijednost (izostavljen
 *   parametar = "koristi prethodnu"), pa bi straza koja ga posalje suzila set tipova i sebi i
 *   pluginu do sljedeceg starta plugina.
 * - poslije odluke o budjenju NEMA novog getUpdates zahtjeva, da se straza i plugin poller ne
 *   preklope na istom tokenu (dvostruki poller nad istim tokenom pravi 409).
 * - straza zove SAMO getUpdates i sendChatAction, nikad deleteWebhook/setWebhook/setMyCommands/getMe.
 */
export async function strazi({
  token,
  signal,
  fetchImpl = fetch,
  cekaj = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  alarm = () => {},
  timeoutS = POLL_TIMEOUT_S,
  sada = Date.now,
}) {
  let pokusaj = 0;
  let zadnjiUspjeh = sada();
  let alarmPoslan = false;

  while (true) {
    if (signal.aborted) return { prekinuto: true };

    // Krov na svaki pojedinacni zahtjev: long poll traje timeoutS sekundi, krov hvata zaglavljen
    // socket koji ni ne pokusa da odgovori u tom roku. Vanjski signal mora prekinuti i zahtjev
    // koji je u toku, zato se vezuje na isti kontroler; listener i timer se OBAVEZNO ciste na
    // izlazu iz ove iteracije da petlja koja radi satima ne gomila ni jedno ni drugo.
    const kontroler = new AbortController();
    const naAbort = () => kontroler.abort();
    signal.addEventListener("abort", naAbort);
    const krov = setTimeout(() => kontroler.abort(), ZAHTJEV_KROV_MS);

    const pocetakRunde = sada();
    let odgovor;
    let greska;
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: timeoutS, limit: 1 }),
        signal: kontroler.signal,
      });
      odgovor = await res.json().catch(() => ({}));
      if (odgovor?.ok !== true) {
        greska = `Telegram getUpdates: ${odgovor?.description ?? res.status}`;
      }
    } catch (e) {
      greska = `Telegram getUpdates ne odgovara: ${e.message}`;
    } finally {
      clearTimeout(krov);
      signal.removeEventListener("abort", naAbort);
    }

    if (signal.aborted) return { prekinuto: true };

    if (!greska) {
      const rezultat = odgovor.result ?? [];
      if (rezultat.length > 0) {
        const prvi = rezultat[0];
        return { probudi: true, chatId: chatIzUpdatea(prvi), updateId: prvi.update_id };
      }
      // Prazan rezultat: uspjesan poll bez poruke. Reset brojaca i tisine, nova runda odmah
      // (long poll je vec sam odradio cekanje na Telegram strani).
      pokusaj = 0;
      zadnjiUspjeh = sada();
      alarmPoslan = false;
      const trajala = zadnjiUspjeh - pocetakRunde;
      if (trajala < MIN_RUNDA_MS) await cekaj(MIN_RUNDA_MS - trajala);
      continue;
    }

    pokusaj += 1;
    log(greska);

    if (!alarmPoslan && sada() - zadnjiUspjeh >= TIHO_ALARM_MS) {
      const minuta = Math.floor((sada() - zadnjiUspjeh) / 60_000);
      alarm(
        `Straza ${minuta} min ne moze do Telegrama. Najcesci uzrok je zaostali poller koji drzi token (409).`,
      );
      alarmPoslan = true;
    }

    if (signal.aborted) return { prekinuto: true };
    await cekaj(backoffMs(pokusaj));
  }
}
