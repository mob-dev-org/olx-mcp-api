import { readFileSync } from "node:fs";
// Centralizovano citanje konfiguracije iz okruzenja.
//
// Jedan klon repozitorija radi za JEDAN nalog: jedan `OLX_TOKEN` (ili jedan par
// `OLX_USERNAME`/`OLX_PASSWORD`). Za drugog klijenta se klonira repo i u njemu postavi njegov
// token. Zato ovdje nema profila ni prebacivanja naloga: radnja ne moze zavrsiti na pogresnom
// klijentu jer u procesu postoji samo jedan nalog.

// Koliko alata MCP server izlaze. `admin` je puna lista za rad na repou; `klijent` je suzena
// lista za bota kojim se sluzi musterija preko Telegrama. Default je `admin`, da postojeci
// klonovi ne promijene ponasanje bez izmjene .env fajla.
export type McpProfil = "admin" | "klijent";

export interface OlxConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  deviceName: string;
  clientId?: string;
  clientToken?: string;
  minRequestIntervalMs: number;
  maxRetries: number;
  timeoutMs: number;
  // Putanja audit loga (upisi i troskovi). Van gita, po klonu.
  auditFile: string;
  // Da li se u audit log pisu i citanja (GET). Default ne, da log ostane pregledan.
  auditReads: boolean;
  // Koje alate MCP server registruje.
  mcpProfil: McpProfil;
  // Tvrdi dnevni plafon potrosnje u kreditima. 0 znaci bez plafona.
  maxSpendPerDay: number;
  // Podrazumijevana lokacija za objavu, da model ne mora pretrazivati gradove.
  defaultCountryId?: number;
  defaultCityId?: number;
  /**
   * Dan u mjesecu kad se obnavlja kvota besplatnih obnova, 1 do 31. Rezerva za nalog bez shopa:
   * inace se dan cita iz `shop.ends_at` i ovo ostaje prazno. Postavljena vrijednost ima prednost
   * nad izmjerenim danom iz kvota dnevnika, isto kao ciklus (olx://pravila-brojeva).
   */
  danCiklusaKvote?: number;
  /**
   * OSIGURAC, ne podesavanje brzine: jedini zadatak mu je da pokvaren `last_page` sa API-ja ne
   * vrti prelistavanje beskonacno. 5000 stranica je 100 000 oglasa, iznad svakog realnog
   * kataloga, pa se u normalnom radu nikad ne pali.
   */
  maxStranicaListe: number;
  // Budzet vremena za prelistavanje u alatima koje covjek zove u razgovoru i ceka odgovor.
  // Budzet vremena a ne broj stranica: broj stranica je los posrednik za trajanje, jer ne zna
  // za retry, ne zna da je throttle podesen i ne zna da je API te veceri spor.
  // Racunica: 1 stranica je 20 oglasa i oko 0,57 s (350 ms throttle plus oko 220 ms mreze), pa
  // 75 s budzeta znaci oko 131 stranicu odnosno oko 2620 oglasa. Krov prekoracaja je jedna
  // stranica u letu (20 s timeout puta 5 pokusaja plus backoff), oko 107 s, sto ostaje ispod
  // MCP zida od 300 s (polje `timeout` u .mcp.json).
  budzetListeMs: number;
  // Budzet vremena za grupne radnje koje se rade uz izricitu potvrdu, gdje je potpunost liste
  // preduslov ispravnosti.
  budzetListeGrupniMs: number;
  // Budzet vremena za obilazak TUDJEG shopa (konkurenta) u serijskom prolazu kroz cijeli Excel
  // spisak kandidata. Vlastiti kljuc namjerno, odvojen od `budzetListeMs`: red kandidata ceka
  // svaki konkurent redom, pa dizanje razgovornog budzeta ne smije usporiti citav obilazak.
  budzetListeKonkurentMs: number;
  /**
   * Budzet vremena PO POKRETANJU za `stats snapshot` (CLI, cron): koliko dugo smije obilaziti
   * oglase (jedan `getListing` po oglasu) prije nego uredno stane i ostavi nastavak za sljedece
   * pokretanje, upisan u radni fajl (`snapshoti.ts`). Odvojen od `budzetListeMs` jer taj budzet
   * vrijedi za PRELISTAVANJE (paginaciju), a ovaj za sam OBILAZAK vec procitanog spiska ID-eva;
   * MCP zid od 300 s ovdje ne vrijedi, jer `stats snapshot` nije MCP alat nego cron posao bez
   * ikoga da ceka odgovor, pa budzet moze biti izdasniji. Racunica: throttle 350 ms plus mreza
   * daje oko 0,57 s po oglasu, pa 15 minuta (900 000 ms) znaci oko 1580 oglasa po pokretanju.
   */
  budzetSnapshotMs: number;
  /**
   * Tvrda granica (ms) koliko NAJDUZE smije trajati jedan PROLAZ `stats snapshot` kroz cijeli
   * katalog, mjereno od pocetka prolaza upisanog u radni fajl (ne od pocetka jednog pokretanja).
   * Prolaz obuhvata spisak ID-eva zamrznut na pocetku (da snapshot ostane koherentan snimak
   * jednog trenutka), pa predug prolaz unosi gresku ogranicenu upravo ovom granicom. Kad je
   * granica premasena, radni fajl se ODBACUJE (ne dovrsava se) i prolaz krece iznova.
   * Konzervativna vrijednost, ZNATNO ispod 14 dana: `mrtviOglasi` (stats.ts) i CLI `stats alarmi`
   * prijavljuju mrtve oglase tek nad periodom od najmanje 14 dana, pa razmazan prolaz do 48 sati
   * ostaje mali dio tog prozora i ne kvari racun vidljivo.
   */
  maxTrajanjeSnapshotProlazaMs: number;
  /**
   * Najveci broj oglasa koji `olx_list_listings` u grani `all` smije staviti u JEDAN odgovor.
   * Iznad toga se katalog isporucuje u komadima (parametar `komad`), umjesto da se tiho sijece
   * ili da se odgovor odbije (deepseek-nalazi.md, tabela oko linije 110). Izmjereno: 120 oglasa u
   * kompaktnom obliku je 6.135 tokena, a CSV je oko 60% jeftiniji, dakle otprilike 20 tokena po
   * oglasu. 500 oglasa je time oko 10.000 tokena, cetvrtina do trecina cijelog prefiksa jedne
   * sesije (danas oko 34.000 do 40.000 tokena) za JEDAN odgovor jednog alata.
   */
  maxOglasaUOdgovoru: number;
  /**
   * Prag reza za spiskove u odgovoru grupnih alata (olx_bulk_price, olx_bulk_sklanjanje,
   * olx_refresh_bulk): koliko stavki kandidata/gresaka/neaktivnih smije stati u JEDAN odgovor.
   * Odvojen od `maxOglasaUOdgovoru`, jer taj prag nosi racunicu za PUN oglas u kompaktnom CSV
   * obliku (olx_list_listings), a ovdje su stavke laksi objekti ({id, title} ili {id, greska}).
   * Nije izlozen kao parametar seme alata (za razliku od operativnih `limit` polja koja biraju
   * KOLIKO oglasa se stvarno mijenja): ovo je tehnicki osigurac protiv velikog JSON odgovora, ne
   * poslovna odluka koju poziva bira po pozivu, pa ostaje plafon u okruzenju. Rez je uvijek
   * vidljiv: uz odsjecenu listu ide broj koliko je stvarno bilo (src/core/obuhvat.ts).
   */
  maxStavkiUOdgovoru: number;
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function opcioniBroj(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Dan u mjesecu: van opsega 1 do 31 se odbacuje umjesto da se steze, jer bi stezanje pogresno
// upisan dan (0, 45) tiho pretvorilo u rok koji se onda TVRDI korisniku.
function danUMjesecu(value: string | undefined): number | undefined {
  const parsed = opcioniBroj(value);
  if (parsed === undefined) return undefined;
  const cio = Math.floor(parsed);
  return cio >= 1 && cio <= 31 ? cio : undefined;
}

// Nepoznata vrijednost pada na `admin`, ne na `klijent`: pogresno napisan profil ne smije tiho
// sakriti alate i ostaviti dojam da toolkit nesto ne moze.
function profil(value: string | undefined): McpProfil {
  return value?.trim().toLowerCase() === "klijent" ? "klijent" : "admin";
}

// Svaki proces se OLX-u predstavlja svojim imenom uredjaja. Kad bi MCP sesija i nocni cron
// dijelili device_name, login jednog bi na strani OLX-a mogao ponistiti token drugog, pa bi
// ziva sesija osvanula sa 401 usred noci. Sufiks se izvodi iz pokrenute skripte.
function deviceIme(env: NodeJS.ProcessEnv): string {
  const osnova = env.OLX_DEVICE_NAME || "olx_pik_toolkit";
  if (env.OLX_DEVICE_NAME) return osnova; // izricito zadan naziv se ne dira
  const skripta = process.argv[1] ?? "";
  const vrsta = skripta.includes("mcp") ? "mcp" : skripta.includes("cli") ? "cli" : "proc";
  return `${osnova}_${vrsta}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OlxConfig {
  return {
    // Trim pa `||`, ne `??`: prazan ili razmacima popunjen `OLX_BASE_URL=` u .env je cesta greska
    // pri postavci klona. Adresa od samih razmaka ne moze biti ispravna ni u jednom citanju, a
    // otkazala bi isto kao prazna: svi API pozivi pucaju bez ocitog razloga. Zato oboje znaci
    // "nije zadano", isto kao izostanak varijable, kao i kod ostalih polja.
    baseUrl: (env.OLX_BASE_URL?.trim() || "https://api.olx.ba").replace(/\/+$/, ""),
    token: env.OLX_TOKEN || undefined,
    username: env.OLX_USERNAME || undefined,
    password: env.OLX_PASSWORD || undefined,
    deviceName: deviceIme(env),
    clientId: env.OLX_CLIENT_ID || undefined,
    clientToken: env.OLX_CLIENT_TOKEN || undefined,
    minRequestIntervalMs: num(env.OLX_MIN_REQUEST_INTERVAL_MS, 350),
    maxRetries: num(env.OLX_MAX_RETRIES, 4),
    timeoutMs: num(env.OLX_TIMEOUT_MS, 20000),
    auditFile: env.OLX_AUDIT_FILE || ".olx-pik/audit.jsonl",
    auditReads: bool(env.OLX_AUDIT_READS, false),
    mcpProfil: profil(env.OLX_MCP_PROFILE),
    maxSpendPerDay: num(env.OLX_MAX_SPEND_PER_DAY, 0),
    defaultCountryId: opcioniBroj(env.OLX_DEFAULT_COUNTRY_ID),
    defaultCityId: opcioniBroj(env.OLX_DEFAULT_CITY_ID),
    danCiklusaKvote: danUMjesecu(env.OLX_DAN_CIKLUSA_KVOTE),
    maxStranicaListe: num(env.OLX_MAX_STRANICA_LISTE, 5000),
    budzetListeMs: num(env.OLX_BUDZET_LISTE_MS, 75000),
    budzetListeGrupniMs: num(env.OLX_BUDZET_LISTE_GRUPNI_MS, 120000),
    budzetListeKonkurentMs: num(env.OLX_BUDZET_LISTE_KONKURENT_MS, 20000),
    budzetSnapshotMs: num(env.OLX_BUDZET_SNAPSHOT_MS, 900000),
    maxTrajanjeSnapshotProlazaMs: num(env.OLX_MAX_TRAJANJE_SNAPSHOT_PROLAZA_MS, 172800000),
    maxOglasaUOdgovoru: num(env.OLX_MAX_OGLASA_U_ODGOVORU, 500),
    maxStavkiUOdgovoru: num(env.OLX_MAX_STAVKI_U_ODGOVORU, 200),
  };
}

/**
 * Procita JEDNU vrijednost iz `.env` fajla, bez diranja `process.env`.
 *
 * Zasto ovako a ne `process.loadEnvFile`: on NE gazi vec postavljen env (na to se oslanja cuvar
 * sesija, vidi .claude/rules/core-kod.md), pa se ponovnim pozivom nov token nikad ne bi vidio.
 * Ovdje treba upravo obrnuto: procitati sto je NA DISKU sada.
 *
 * Zasto uopste treba: token upisan u `.env` dok sesija radi (onboarding, rotacija) procesu koji
 * je vec startovao ostaje nevidljiv, jer se `.env` cita jednom pri startu. Poziv na 401 ovim
 * saznaje da je token u medjuvremenu zamijenjen i izbjegne restart cijele sesije.
 *
 * Parsiranje je namjerno minimalno: `KLJUC=vrijednost`, komentari i prazni redovi se preskacu,
 * obicni i dvostruki navodnici se skidaju. Nema interpolacije i nema visereda.
 */
export function procitajIzEnvFajla(kljuc: string, putanja = ".env"): string | undefined {
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch {
    return undefined; // nema fajla: nema sta da se procita, pozivalac ostaje na starom
  }
  for (const red of sadrzaj.split("\n")) {
    const t = red.trim();
    if (!t || t.startsWith("#")) continue;
    const znak = t.indexOf("=");
    if (znak < 1) continue;
    if (t.slice(0, znak).trim() !== kljuc) continue;
    const sirovo = t.slice(znak + 1).trim();
    const bezNavodnika = /^(".*"|'.*')$/.test(sirovo) ? sirovo.slice(1, -1) : sirovo;
    return bezNavodnika || undefined;
  }
  return undefined;
}
