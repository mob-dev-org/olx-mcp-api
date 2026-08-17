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
 * Kojoj ulozi mosta pripada poruka, u jednobotnom rezimu (jedan bot token, rutiranje po poruci).
 *
 * Vraca "admin-bot" ili "klijent", tacno vrijednosti koje `ulogaMosta` i `stazeSesije` vec
 * razumiju: nema treceg vokabulara tipa "admin", da se rezultat ove funkcije moze direktno
 * predati dalje bez prevodjenja.
 *
 * Prazan/nedostajuci `adminTgId` znaci da jednobotni rezim za tog klijenta ne postoji, pa se
 * SVE tretira kao "klijent" - isti duh kao "nepoznata cijena se tretira kao naplatna" iz
 * olx-dokumentacija/granice.md: nepoznato se tretira kao NE-admin, nikad obrnuto.
 *
 * Pogresno upisan grupni (negativan) ID u `adminTgId` je inertan: private chat uvijek ima
 * pozitivan `from.id`, pa poredjenje s negativnim brojem nikad ne pogadja i poruka ostaje
 * klijentska, bez obzira sta je administrator upisao u env.
 */
export function efektivnaUloga(poruka, adminTgId) {
  const admin = String(adminTgId ?? "").trim();
  if (!admin) return "klijent";
  if (poruka.chat?.type !== "private") return "klijent";
  if (String(poruka.from?.id ?? "") !== admin) return "klijent";
  return "admin-bot";
}

/**
 * Jedna tacka koja spaja pristupnu kontrolu i rutiranje, da redoslijed provjera bude
 * testabilan a ne samo dogovor u komentaru.
 *
 * `dozvoljena()` ide PRVA i `efektivnaUloga()` se racuna SAMO na poruci koja je vec prosla
 * pristupnu kontrolu. Uvodjenje rutiranja po ulozi ne smije oslabiti pristupnu kontrolu: admin
 * ID koji nije u `pristup.allowFrom` (ili u dozvoljenoj grupi) mora biti odbijen kao i svaki
 * drugi posiljalac, PRIJE nego se uopste pita da li je admin.
 */
export function odlukaPoruke(poruka, pristup, botIme, adminTgId) {
  if (!dozvoljena(poruka, pristup, botIme)) return { prihvacena: false, uloga: null };
  return { prihvacena: true, uloga: efektivnaUloga(poruka, adminTgId) };
}

/** Sirovi env.OLX_MOST_ADMIN_TG_ID kao trimovan string. Prazno kad varijabla ne postoji. */
export function adminTgIdIzEnva(env) {
  return String(env.OLX_MOST_ADMIN_TG_ID ?? "").trim();
}

/**
 * true samo za pozitivan cio broj upisan kao decimalni string ("7061697037"). Prazan string,
 * negativan broj (izgleda kao ID grupe), decimalna tacka, slova i "sve nule" su false.
 */
export function validanAdminTgId(v) {
  if (!/^\d+$/.test(v)) return false;
  return !/^0+$/.test(v);
}

/**
 * true kad je jednobotni rezim ukljucen za ovaj klon (jedan bot token, dvije zive sesije u
 * istom procesu).
 *
 * NAMJERNO ne trazi da je vrijednost validna: prazan `OLX_MOST_ADMIN_TG_ID` znaci da vlasnik
 * rezim nije ni pokusao ukljuciti (isto "nepoznato je NE" pravilo kao `efektivnaUloga`), ali
 * NEPRAZNA i NEVALIDNA vrijednost (npr. negativan grupni ID, slova) znaci da JE pokusao, samo je
 * pogrijesio unos. To mora biti glasna greska u pozivaocu (telegram-most.mjs), ne tiho vracanje
 * na dvobotni rezim: tiho gasenje admin grane bi vlasnika ostavilo da ceka odgovor koji nikad ne
 * dolazi na "bot koji sad valja i za admina", a tiho otvaranje admin grane na pogresnoj/praznoj
 * vrijednosti bi bilo gore. Zato ova funkcija samo javlja DA JE rezim trazen; da li je zahtjev
 * ispravan provjerava `validanAdminTgId` posebno, pa pozivalac pravi gresku od razlike.
 */
export function jednobotniRezim(env) {
  return adminTgIdIzEnva(env) !== "";
}

/**
 * Lijeno pravi (ako ne postoji) i vraca unos stanja za jednu ulogu mosta unutar zajednicke
 * mape. Faza B ovim zamjenjuje modul-level singletone (`sesija`, `idleTajmer`, ...): jedan
 * proces tada drzi DVIJE odvojene zive sesije (klijent i admin-bot) cije se stanje nikad ne
 * mijesa, jer svaka uloga ima svoj objekat u mapi.
 *
 * Isti tip pozvan dva puta vraca ISTI objekat (identitet, ne kopiju): pozivalac mora smjeti da
 * mutira polja preko reference i da se ta izmjena vidi na sljedecem pozivu, inace bi stanje
 * tiho nestajalo pri svakom novom citanju.
 *
 * Nevalidan tip baca gresku - baca je `ulogaMosta`, ova funkcija ne dodaje vlastitu provjeru.
 *
 * `zadnjaAktivnost: 0` a ne `Date.now()`: funkcija ostaje cista i testabilna bez laznog sata.
 * Pozivalac (koji zna pravo vrijeme) postavlja stvarnu vrijednost kad je potrebno.
 */
export function stanjeUloge(mapa, tip) {
  let unos = mapa.get(tip);
  if (!unos) {
    unos = {
      tip,
      uloga: ulogaMosta(tip),
      stanje: null,
      sesija: null,
      idleTajmer: null,
      zadnjaAktivnost: 0,
      zadnjiNocni: "",
      cpuStanje: null,
    };
    mapa.set(tip, unos);
  }
  return unos;
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
