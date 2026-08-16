// Cisti dijelovi Telegram mosta (scripts/telegram-most.mjs) izdvojeni ovdje da bi bili testabilni
// bez mreze i bez pokretanja zive sesije. Kontrola pristupa (`dozvoljena`) je posebno vazna: ona
// odlucuje ko smije pisati botu, pa mora imati testove kao svaka druga brana.

export const ZABRANJENI_ALATI = ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent", "Grep", "Glob", "Skill"];
export const DOZVOLJENI_ALATI = ["mcp__olx-pik"];

// Admin par (dozvoljeni/zabranjeni) je preslikan iz runtime/settings.admin-bot.json: allow ima
// Read, Task, Agent, mcp__olx-pik, deny ima Bash, Write, Edit, NotebookEdit, WebFetch, WebSearch.
// Grep, Glob i Skill NISU ni u allow ni u deny tog fajla (u interaktivnoj sesiji su bezopasni bez
// izricite dozvole), ali u headless -p rezimu bi bili neupotrebljivi svakako: bez dozvole ne mogu
// da se pozovu, a bez potvrde ne mogu da traze. Zabrana ih cini eksplicitnim umjesto tihim.
export const ZABRANJENI_ALATI_ADMIN = ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Grep", "Glob", "Skill"];
export const DOZVOLJENI_ALATI_ADMIN = ["mcp__olx-pik", "Read", "Task", "Agent"];

/**
 * Sve sto se izmedju uloga mosta razlikuje, na jednom mjestu. Klijentske vrijednosti su TACNO
 * one koje most koristio i prije uvodjenja admin uloge (isti fajlovi stanja, isti argv, isti
 * tip u telemetriji), da postojeci klonovi ne izgube stanje pri prelasku na ovu funkciju.
 */
export function ulogaMosta(tip) {
  if (tip === "klijent") {
    return {
      tip,
      jeAdmin: false,
      stanjeFajl: ".olx-pik/most-stanje.json",
      pidFajl: "most.pid",
      odbijenAlarm: "most-odbijen.alarm",
      sesijaPid: "sesija-most.pid",
      restartZahtjev: "restart-sesije",
      telemetrijaTip: "most",
      dozvoljeniAlati: DOZVOLJENI_ALATI,
      zabranjeniAlati: ZABRANJENI_ALATI,
    };
  }
  if (tip === "admin-bot") {
    return {
      tip,
      jeAdmin: true,
      stanjeFajl: ".olx-pik/most-admin-stanje.json",
      pidFajl: "most-admin.pid",
      odbijenAlarm: "most-admin-odbijen.alarm",
      sesijaPid: "sesija-most-admin.pid",
      restartZahtjev: "restart-admin-bota",
      telemetrijaTip: "most-admin",
      dozvoljeniAlati: DOZVOLJENI_ALATI_ADMIN,
      zabranjeniAlati: ZABRANJENI_ALATI_ADMIN,
    };
  }
  throw new Error(`Nepoznata uloga mosta "${tip}". Ocekivano "klijent" ili "admin-bot".`);
}

/** true kad poruka smije u sesiju. Sve ostalo se tiho ispusta, kao i kod kanala. */
export function dozvoljena(poruka, pristup, botIme) {
  const posiljalac = String(poruka.from?.id ?? "");
  if (!posiljalac) return false;
  const tip = poruka.chat?.type;

  if (tip === "private") {
    return pristup.dmPolicy !== "disabled" && pristup.allowFrom.includes(posiljalac);
  }
  if (tip === "group" || tip === "supergroup") {
    const politika = pristup.groups[String(poruka.chat.id)];
    if (!politika) return false;
    const dozvoljeni = (politika.allowFrom ?? []).map(String);
    if (dozvoljeni.length > 0 && !dozvoljeni.includes(posiljalac)) return false;
    if (politika.requireMention ?? true) {
      const tekst = poruka.text ?? poruka.caption ?? "";
      if (!botIme || !tekst.includes(`@${botIme}`)) return false;
    }
    return true;
  }
  return false;
}

/**
 * Bira izvor slike iz poruke. Redoslijed je namjeran: `document` ide PRIJE `photo`.
 *
 * Telegram za `photo` uvijek rekompresuje u JPEG i skalira (u praksi oko 1280 px duza strana),
 * pa je najveca velicina iz tog niza i dalje kopija sa gubitkom. Ista poruka poslana kao fajl
 * ("posalji bez kompresije") stize kao `document` sa netaknutim originalom. Kad su prisutna oba,
 * Telegram salje samo jedno, ali provjera stoji ovim redom da original nikad ne izgubi.
 *
 * Ranije se `document` uopste nije citao, pa je fotografija poslana kao fajl tiho nestajala.
 */
export function izvorSlike(poruka) {
  const dok = poruka.document;
  // Bez mime provjere bi ovdje prosao PDF, ZIP i sve ostalo sto covjek prevuce u razgovor.
  if (dok?.file_id && typeof dok.mime_type === "string" && dok.mime_type.startsWith("image/")) {
    return { fileId: dok.file_id, kljuc: dok.file_unique_id, velicina: dok.file_size };
  }
  const velicine = poruka.photo;
  if (!Array.isArray(velicine) || velicine.length === 0) return null;
  const najveca = velicine[velicine.length - 1]; // Telegram salje rastuce, zadnja je najveca
  return { fileId: najveca.file_id, kljuc: najveca.file_unique_id, velicina: najveca.file_size };
}

export function tekstStavke(stavka) {
  const dijelovi = [stavka.tekst || "(bez teksta)"];
  if (stavka.slike?.length) {
    const opis = stavka.slike.length === 1 ? "Poslana je fotografija" : `Poslano je ${stavka.slike.length} fotografija`;
    dijelovi.push(`\n[${opis}, na disku: ${stavka.slike.join(", ")}]`);
  }
  return dijelovi.join("");
}

// Argv za `claude` u -p (headless) rezimu koji most koristi. Parametrizovano nad
// { id, nastavak, promptPutanja } jer poziv sada dolazi izvana: `id` racuna pozivalac
// (stanje.sesija ?? randomUUID()), pa modul nista ne cita iz modul-level stanja.
export function argviSesije({ id, nastavak, promptPutanja, dozvoljeniAlati = DOZVOLJENI_ALATI, zabranjeniAlati = ZABRANJENI_ALATI }) {
  return [
    "-p",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    // Telegram MCP plugin ovdje NE treba: poruke saljemo sami, pa strict izolacija smije.
    "--strict-mcp-config",
    "--mcp-config",
    ".mcp.json",
    "--append-system-prompt-file",
    promptPutanja,
    "--setting-sources",
    "user,project",
    "--permission-mode",
    "acceptEdits",
    // Headless sesija nema koga da klikne potvrdu: bez ovoga bi visjela.
    "--allowedTools",
    ...dozvoljeniAlati,
    "--disallowedTools",
    ...zabranjeniAlati,
    nastavak ? "--resume" : "--session-id",
    id,
  ];
}

/**
 * Rok mirovanja u milisekundama, ili null kad je gasenje iskljuceno.
 * `0` (i sve sto nije pozitivan broj) znaci iskljuceno: sesija tada ostaje ziva dok god most zivi,
 * kako je bilo prije uvodjenja ovog roka.
 */
export function idleRokMs(idleMin) {
  const n = Number(idleMin);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 60000);
}

/**
 * true kad je sesija mirovala dovoljno dugo da se smije ugasiti. Provjera se radi i kad tajmer
 * opali, jer `setTimeout` ne garantuje da u medjuvremenu nije stigla poruka: bez ovoga bi se
 * sesija mogla ugasiti tacno u trenutku dolaska poruke i platiti nepotreban `--resume`.
 */
export function trebaLiUgasiti(zadnjaAktivnost, sad, idleMin) {
  const rok = idleRokMs(idleMin);
  if (rok === null) return false;
  return sad - zadnjaAktivnost >= rok;
}

/** Datum u LOKALNOM vremenu kao "YYYY-MM-DD", isto kao cuvar-sesije.mjs. */
export function lokalniDatum(d) {
  const godina = d.getFullYear();
  const mjesec = String(d.getMonth() + 1).padStart(2, "0");
  const dan = String(d.getDate()).padStart(2, "0");
  return `${godina}-${mjesec}-${dan}`;
}

/**
 * true tacno jednom po danu, u satu koji je odredjen kao rok za nocni rez konteksta.
 * `restartSat` van opsega 0 do 23 (ukljucujuci NaN i undefined) znaci iskljuceno: pogresna
 * vrijednost ne smije nasumicno rezati kontekst u nekom satu, pa vraca false umjesto da
 * nagadja koji sat je bio mislen.
 */
export function trebaLiNocniRez({ sad, restartSat, zadnjiNocni, zauzet }) {
  if (!Number.isFinite(restartSat) || restartSat < 0 || restartSat > 23) return false;
  if (sad.getHours() !== restartSat) return false;
  if (zadnjiNocni === lokalniDatum(sad)) return false;
  if (zauzet === true) return false;
  return true;
}

/**
 * true kad je trenutna minuta prava za uzimanje uzorka telemetrije. Pomak razmjesta uzorke
 * razlicitih klonova unutar istog intervala umjesto da svi udare na istu minutu.
 * `intervalMin` koji nije konacan pozitivan broj gasi uzorkovanje u potpunosti.
 */
export function trebaLiUzorkovati({ minutaOdEpoha, intervalMin, pomak, zadnjaUzorkovanaMinuta }) {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return false;
  if (minutaOdEpoha % intervalMin !== pomak % intervalMin) return false;
  if (minutaOdEpoha === zadnjaUzorkovanaMinuta) return false;
  return true;
}
