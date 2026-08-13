import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadConfig, procitajIzEnvFajla, type OlxConfig } from "./config.js";
import { auditSinkFromPath, currentAuditContext, potrosenoNaDan, type AuditSink } from "./audit.js";
import { objasniPogotke, provjeriRobu, type PogodakRobe } from "./zabranjena-roba.js";
import { VERZIJA } from "./verzija.js";
import { izvuciTelefon } from "./telefon-ekstrakcija.js";
import { izmjereniDanReseta, ucitajKvotuDnevnik } from "./kvota-dnevnik.js";
import {
  alarmiNaloga,
  konkurentIzvjestaj,
  oglasIzvjestaj,
  onboardingIzvjestaj,
  profilStatistika,
  type AlarmiNaloga,
  type AlarmiPragovi,
  type KonkurentIzvjestaj,
  type OglasIzvjestaj,
  type OglasPregledi,
  type OnboardingDetalj,
  type OnboardingIzvjestaj,
  type ProfilStatistika,
} from "./stats.js";
import type {
  BrandOrModel,
  Category,
  CategoryAttribute,
  CategoryFindResult,
  CategoryNode,
  CategorySuggestion,
  City,
  Country,
  CreateListingInput,
  DiscountInput,
  Listing,
  ListingStateFilter,
  LocationSnapshot,
  ListingSummary,
  LoginResponse,
  OlxPublicProfile,
  OlxUser,
  Paginated,
  RefreshLimits,
  RegionEntity,
  SponsorOptions,
  SponsorPrice,
  UpdateListingInput,
  UploadedImage,
} from "./types.js";

// Greske su tipizovane da CLI i MCP mogu razlikovati uzrok.
export class OlxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "OlxApiError";
  }
}

export class OlxAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OlxAuthError";
  }
}

// Baca se kad operacija trosi kredite a poziv nije eksplicitno potvrdjen.
export class OlxSpendError extends Error {
  constructor(
    message: string,
    readonly price?: SponsorPrice,
  ) {
    super(message);
    this.name = "OlxSpendError";
  }
}

/**
 * Oglas spominje robu koju platforma ne dozvoljava (clan 8 Uslova koristenja). Nije blokada nego
 * zaustavljanje do potvrde: lista je uska ali nikad nece biti tacna, pa odluku donosi covjek.
 * Isti oblik brane kao OlxSpendError, samo drugi razlog.
 */
export class OlxPravilaError extends Error {
  constructor(
    message: string,
    readonly pogoci: PogodakRobe[],
  ) {
    super(message);
    this.name = "OlxPravilaError";
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: Method;
  query?: Query;
  body?: unknown;
  auth?: boolean;
  // Iskljucuje ponavljanje na 5xx. Koristi se za pozive koji nisu idempotentni: izdvajanje i
  // akcijska cijena (naplata bi mogla proci dva puta) i kreiranje oglasa (duplikat oglasa,
  // a u kategorijama sa listing_fee i dupli trosak). Mreznu gresku i timeout takodjer ne
  // ponavljamo za te pozive, jer se ne zna da li je zahtjev stigao do servera.
  retryOnServerError?: boolean;
  // Trosak radnje u kreditima. Ulazi u audit zapis samo kad poziv uspije, pa se dnevna
  // potrosnja moze sabrati iz loga.
  krediti?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface OlxClientOptions {
  // Gdje ide trag radnji. Injektovan namjerno: testovi podmetnu kolektor u memoriji umjesto fajla.
  audit?: AuditSink;
  /**
   * Odakle se na 401 cita eventualno nov token. Kad NIJE zadan, jezgro disk ne dira uopste.
   *
   * Namjerno bez podrazumijevanog `.env`: sa njim su testovi citali pravi `.env` repoa, dakle i
   * pravi token klijenta, i mijenjali ponasanje 401 testova (izmjereno 31.07.2026). Prave
   * putanje ga postavljaju eksplicitno (`src/mcp/server.ts`, `src/cli/index.ts`).
   */
  envFajl?: string;
}

// Koliko se ceka prije novog pokusaja logina nakon neuspjelog. Bez ovoga bi pogresna lozinka
// znacila jedan poziv na /auth/login po svakoj radnji.
const RELOGIN_COOLDOWN_MS = 30_000;

export class OlxClient {
  private token?: string;
  private lastRequestAt = 0;
  private cachedUsername?: string;
  private readonly audit: AuditSink;
  // Jedan login u letu za sve pozive koji su istovremeno dobili 401.
  private reloginPromise?: Promise<void>;
  private reloginFailedAt?: number;
  private readonly envFajl?: string;

  constructor(
    private readonly config: OlxConfig = loadConfig(),
    options: OlxClientOptions = {},
  ) {
    this.token = config.token;
    this.audit = options.audit ?? auditSinkFromPath(config.auditFile);
    this.envFajl = options.envFajl;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  setToken(token: string): void {
    this.token = token;
  }

  // Jednostavan throttle: ceka minRequestIntervalMs izmedju dva zahtjeva.
  private async throttle(): Promise<void> {
    const wait = this.config.minRequestIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(this.config.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(`${key}[]`, String(v));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private authHeaders(): Record<string, string> {
    if (this.token) return { Authorization: `Bearer ${this.token}` };
    if (this.config.clientId && this.config.clientToken) {
      return {
        "OLX-CLIENT-ID": this.config.clientId,
        "OLX-CLIENT-TOKEN": this.config.clientToken,
      };
    }
    throw new OlxAuthError(
      "Nema tokena. Postavi OLX_TOKEN, ili OLX_USERNAME/OLX_PASSWORD pa pozovi login(), ili OLX_CLIENT_ID/OLX_CLIENT_TOKEN.",
    );
  }

  // Centralni request wrapper: throttle, retry/backoff na 429 i 5xx, relogin na 401 i audit zapis.
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query, body, auth = true, retryOnServerError = true, krediti } = options;

    // Kod multipart uploada (FormData) Content-Type postavlja fetch sam (sa boundary).
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const url = this.buildUrl(path, query);
    const startedAt = Date.now();
    let attempt = 0;
    let reloginTried = false;
    let tokenOsvjezen = false;

    // Jedan zapis po logickom pozivu, ne po HTTP pokusaju, da backoff ne pravi spam u logu.
    // Tijelo i query nikad ne ulaze u zapis (login nosi lozinku).
    const zapisi = (status: number, ok: boolean, error?: string): void => {
      if (method === "GET" && !this.config.auditReads) return;
      const ctx = currentAuditContext();
      this.audit({
        ts: new Date().toISOString(),
        version: VERZIJA,
        operation: ctx.operation,
        source: ctx.source,
        method,
        path,
        status,
        ok,
        duration_ms: Date.now() - startedAt,
        attempts: attempt,
        ...(this.cachedUsername ? { account: this.cachedUsername } : {}),
        ...(error ? { error } : {}),
        // Trosak se biljezi samo na uspjesnom pozivu: neuspjeh nije naplacen, a kad bi usao u
        // log, dnevni plafon bi se trosio na radnje koje se nikad nisu desile.
        ...(ok && typeof krediti === "number" ? { krediti } : {}),
      });
    };

    while (true) {
      attempt++;
      await this.throttle();

      // Headeri se grade u svakom pokusaju, jer relogin u medjuvremenu mijenja token.
      const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
      if (auth) Object.assign(headers, this.authHeaders());

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        const parsed: unknown = text ? safeJson(text) : undefined;

        if (res.ok) {
          zapisi(res.status, true);
          return parsed as T;
        }

        // 429 se ponavlja uvijek (zahtjev nije izvrsen). 5xx se ne ponavlja za pozive koji troše
        // kredite ili kreiraju oglas, jer je server mogao izvrsiti radnju pa pasti pri odgovoru.
        const retriable = res.status === 429 || (res.status >= 500 && retryOnServerError);
        if (retriable && attempt <= this.config.maxRetries) {
          const backoff = Math.min(8000, 2 ** attempt * 250) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }

        // 401 znaci da token ne vrijedi. Ako imamo kredencijale, obnovimo ga jednom.
        // 403 se NE lijeci loginom: tamo je autentikacija prosla a nalog nema dozvolu
        // (npr. shop nije odobren za API), pa bi login bio uzaludan poziv.
        // Prije relogina: mozda je token u medjuvremenu ZAMIJENJEN u `.env` (onboarding upisao
        // nov, ili je rotiran rukom). Proces ga ne vidi, jer se `.env` cita jednom pri startu, pa
        // bi inace trebao restart cijele sesije. Jedan pokusaj po zahtjevu.
        if (res.status === 401 && auth && !tokenOsvjezen && this.envFajl) {
          tokenOsvjezen = true;
          const sDiska = procitajIzEnvFajla("OLX_TOKEN", this.envFajl);
          if (sDiska && sDiska !== this.token) {
            this.token = sDiska;
            zapisi(res.status, false, "token je u .env zamijenjen, ponavljam sa novim");
            continue;
          }
        }

        if (res.status === 401 && auth && !reloginTried && this.canRelogin()) {
          reloginTried = true;
          const obnovljen = await this.tryRelogin();
          if (obnovljen && retryOnServerError) continue;
          if (obnovljen) {
            // Poziv koji trosi kredite ili kreira oglas se NE ponavlja tiho: ne zna se da li je
            // server odbio zahtjev prije ili poslije izvrsenja radnje.
            zapisi(res.status, false, "token obnovljen, radnja nije ponovljena automatski");
            throw new OlxAuthError(
              "Token je bio istekao pa je obnovljen, ali ova radnja (trosak kredita ili kreiranje oglasa) nije ponovljena automatski, da se ne bi naplatila dva puta. Provjeri stanje i pokreni je ponovo.",
            );
          }
        }

        if (res.status === 401 || res.status === 403) {
          const poruka =
            res.status === 401
              ? this.canRelogin()
                ? "Sesija je istekla (401) i obnova tokena nije uspjela. Provjeri OLX_USERNAME i OLX_PASSWORD."
                : "Token ne vrijedi ili je istekao (401). Upisi novi OLX_TOKEN u .env i pokusaj ponovo (preuzima se bez restarta sesije), ili dodaj OLX_USERNAME i OLX_PASSWORD pa ce se obnavljati sam."
              : "Pristup odbijen (403). Autentikacija je prosla, ali nalog nema dozvolu: najcesce shop nije odobren za API pristup.";
          zapisi(res.status, false, poruka);
          throw new OlxAuthError(poruka);
        }
        zapisi(res.status, false, `Zahtjev nije uspio (${res.status})`);
        throw new OlxApiError(`Zahtjev nije uspio (${res.status}) ${method} ${path}`, res.status, parsed);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof OlxApiError || err instanceof OlxAuthError) throw err;
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (retryOnServerError && attempt <= this.config.maxRetries) {
          const backoff = Math.min(8000, 2 ** attempt * 250) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }
        const poruka = isAbort
          ? `Timeout nakon ${this.config.timeoutMs}ms na ${path}`
          : `Mrezna greska na ${path}: ${String(err)}`;
        zapisi(0, false, poruka);
        throw new OlxApiError(poruka, 0, undefined);
      }
    }
  }

  // Zapis radnje koja je zaustavljena prije mreze (spend-guard). Vrijedi zabiljeziti: pokazuje
  // da je trosak bio predlozen i da nije potvrdjen, pa se kasnije ne pita "je li bot pitao".
  private zapisiOdbijeno(method: Method, path: string, razlog: string): void {
    const ctx = currentAuditContext();
    this.audit({
      ts: new Date().toISOString(),
      version: VERZIJA,
      operation: ctx.operation,
      source: ctx.source,
      method,
      path,
      status: 0,
      ok: false,
      duration_ms: 0,
      attempts: 0,
      ...(this.cachedUsername ? { account: this.cachedUsername } : {}),
      error: `odbijeno bez potvrde, zahtjev nije poslan: ${razlog}`,
    });
  }

  /**
   * Zaustavi radnju kad tekst oglasa spominje robu iz clana 8, dok covjek to ne potvrdi.
   *
   * Zasto potvrda a ne blokada: lista pojmova nad domacim tekstom nikad nece biti tacna, a
   * blokirana legitimna prodaja je za klijenta koji placa uslugu veca steta od rijetkog spornog
   * oglasa. Zaustavljanje uz zapis daje oboje: nista ne prolazi tiho, a odluku donosi covjek.
   *
   * Potvrda je NAMJERNO odvojena od `confirm`. Da dijele jednu zastavicu, oglas sa spornom rijeci
   * u naplatnoj kategoriji bi prosao ovako: prvo padne na robi, covjek potvrdi robu, i sa
   * `confirm: true` prodje i cijena, a da je niko nije izgovorio. Dvije brane, dvije potvrde.
   */
  private provjeriPravilaRobe(
    naslov: string | undefined,
    opis: string | undefined,
    potvrdjeno: boolean | undefined,
    method: Method,
    path: string,
  ): void {
    const pogoci = provjeriRobu(naslov ?? "", opis ?? "");
    if (pogoci.length === 0 || potvrdjeno) return;
    const razlog = `sporna roba: ${pogoci.map((p) => p.pojam).join(", ")}`;
    this.zapisiOdbijeno(method, path, razlog);
    throw new OlxPravilaError(objasniPogotke(pogoci), pogoci);
  }

  // Relogin je moguc samo kad postoje lozinka i korisnicko ime. Client-id rezim se ne obnavlja
  // loginom, a nakon neuspjelog logina se ceka, da se ne bombarduje /auth/login.
  private canRelogin(): boolean {
    if (!this.config.username || !this.config.password) return false;
    if (this.reloginFailedAt && Date.now() - this.reloginFailedAt < RELOGIN_COOLDOWN_MS) return false;
    return true;
  }

  // Svi pozivi koji su istovremeno dobili 401 dijele jedan login, ne pokrecu svoj.
  private async tryRelogin(): Promise<boolean> {
    if (!this.reloginPromise) {
      this.reloginPromise = this.login()
        .then(() => {
          this.reloginFailedAt = undefined;
        })
        .catch((e: unknown) => {
          this.reloginFailedAt = Date.now();
          throw e;
        })
        .finally(() => {
          this.reloginPromise = undefined;
        });
    }
    try {
      await this.reloginPromise;
      return true;
    } catch {
      return false;
    }
  }

  // ---- Auth ----

  async login(): Promise<LoginResponse> {
    if (!this.config.username || !this.config.password) {
      throw new OlxAuthError("Za login su potrebni OLX_USERNAME i OLX_PASSWORD.");
    }
    const res = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: {
        username: this.config.username,
        password: this.config.password,
        device_name: this.config.deviceName,
      },
    });
    this.token = res.token;
    return res;
  }

  // Dio odgovora dolazi u envelope obliku { data: {...} } (npr. /me, PUT i POST /listings),
  // a dio plosnato (GET /listings/:id). Odvijamo samo kad je envelope, da polja ne budu undefined.
  private unwrap<T>(res: T | { data: T }): T {
    if (res && typeof res === "object" && "data" in (res as object)) {
      return (res as { data: T }).data;
    }
    return res as T;
  }

  async me(): Promise<OlxUser> {
    return this.unwrap(await this.request<OlxUser | { data: OlxUser }>("/me"));
  }

  // Username je jedini identifikator koji svi katalog endpointi prihvataju
  // (/users/:id/listings vraca 404, /users/:username/listings radi), pa nikad ne vracamo id.
  async resolveUsername(): Promise<string> {
    if (this.cachedUsername) return this.cachedUsername;
    const user = await this.me();
    const username = typeof user?.username === "string" ? user.username.trim() : "";
    if (!username) {
      throw new OlxAuthError("Ne mogu odrediti korisnika iz tokena. Zadaj korisnika eksplicitno.");
    }
    this.cachedUsername = username;
    return username;
  }

  // Javni profil korisnika ili shopa. Radi SAMO sa username (numericki id vraca 404);
  // ista putanja postoji i kao /shops/:username. Odgovor je envelope { data: ... }.
  // Ne trazi da profil bude nas: koristi se za analizu konkurencije i kandidata.
  async userProfile(username: string): Promise<OlxPublicProfile> {
    const user = this.assertUser(username);
    return this.unwrap(await this.request<OlxPublicProfile | { data: OlxPublicProfile }>(`/users/${user}`));
  }

  // Osigurava da postoji token: koristi postojeci ili radi login ako ima kredencijale.
  async ensureAuth(): Promise<void> {
    if (this.token || (this.config.clientId && this.config.clientToken)) return;
    await this.login();
  }

  // ---- Listings ----

  getListing(id: number | string): Promise<Listing> {
    return this.request<Listing>(`/listings/${id}`);
  }

  // Bez retry-a na 5xx: ponovljen POST bi napravio duplikat oglasa (i dupli listing_fee).
  /**
   * Kreira oglas kao nacrt.
   *
   * Objava nije besplatna u svim kategorijama: `listing_fee` je 0 za vecinu robe, ali Automobili
   * kostaju 70, Stanovi 190, Poslovi 100, IPTV 600 kredita. Zato ovdje vazi isti spend-guard kao
   * za izdvajanje: bez `confirm` se u naplatnoj kategoriji ne salje zahtjev, nego se javi cijena.
   * U kategorijama bez naknade se nista ne mijenja i confirm nije potreban.
   *
   * Cijena se cita sa kategorije, ne pretpostavlja. Kad kategorija nije citljiva, radnja se
   * propusta uz upozorenje na stderr: blokirati objavu zbog neuspjelog pomocnog poziva bi bilo
   * gore od rizika, jer je velika vecina kategorija besplatna.
   */
  async createListing(
    input: CreateListingInput,
    opcije: { confirm?: boolean; potvrdiRobu?: boolean } = {},
  ): Promise<Listing> {
    // Pravila robe idu PRIJE citanja kategorije: sporan oglas ne treba ni jedan mrezni poziv.
    this.provjeriPravilaRobe(input.title, input.description, opcije.potvrdiRobu, "POST", "/listings");
    let naknada = 0;
    let naknadaNepoznata = false;
    if (input.category_id !== undefined && input.category_id !== null) {
      try {
        // category() vraca omotac { data }, pa se listing_fee cita iz data, ne sa vrha.
        const kat = await this.category(input.category_id);
        naknada = naknadaKategorije(kat);
      } catch (e) {
        // Ne blokiramo objavu zbog neuspjelog pomocnog poziva, ali NE propustamo je ni tiho:
        // nepoznata cijena nije isto sto i nula. Bez potvrde bi se u naplatnoj kategoriji
        // (Automobili su 70 kredita) naplatilo bez rijeci. Zato nepoznato trazi confirm.
        naknadaNepoznata = true;
        console.error(`Naknada kategorije nije procitana, objava trazi potvrdu: ${String(e)}`);
      }
    }

    if (naknadaNepoznata && !opcije.confirm) {
      this.zapisiOdbijeno("POST", "/listings", "naknada kategorije nije citljiva");
      throw new OlxSpendError(
        "Cijena objave u ovoj kategoriji se trenutno ne moze procitati sa platforme. " +
          "Vecina kategorija je besplatna, ali neke (vozila, nekretnine, poslovi, usluge) nisu. " +
          "Potvrdi (confirm) da bi se objavilo i eventualno naplatilo.",
      );
    }

    if (naknada > 0) {
      if (!opcije.confirm) {
        this.zapisiOdbijeno("POST", "/listings", `objava u naplatnoj kategoriji, ${naknada} kredita`);
        throw new OlxSpendError(
          `Objava u ovoj kategoriji košta ${naknada} kredita. Potvrdi (confirm) da bi se naplatilo.`,
        );
      }
      this.provjeriDnevniPlafon(naknada, "POST", "/listings");
    }

    return this.unwrap(
      await this.request<Listing | { data: Listing }>("/listings", {
        method: "POST",
        body: input,
        retryOnServerError: false,
        ...(naknada > 0 ? { krediti: naknada } : {}),
      }),
    );
  }

  /**
   * Izmjena oglasa. Kad izmjena nosi `category_id`, prolazi kroz istu branu troska: nacrt iz
   * besplatne kategorije bi se inace mogao prebaciti u naplatnu pa objaviti, i tako obici branu
   * na kreiranju. Na objavljenom oglasu API tiho ignorise `category_id` (izmjereno 29.07.2026.),
   * ali za nacrt to nije izmjereno, pa se brana ne preskace.
   */
  async updateListing(
    id: number | string,
    input: UpdateListingInput,
    opcije: { confirm?: boolean; potvrdiRobu?: boolean } = {},
  ): Promise<Listing> {
    // Izmjena je drugi put do istog ishoda: bezopasan oglas se prepise u sporan pa ostane objavljen.
    this.provjeriPravilaRobe(input.title, input.description, opcije.potvrdiRobu, "PUT", `/listings/${id}`);
    const nova = (input as { category_id?: number | null }).category_id;
    if (nova !== undefined && nova !== null) {
      let naknada = 0;
      let nepoznata = false;
      try {
        naknada = naknadaKategorije(await this.category(nova));
      } catch (e) {
        nepoznata = true;
        console.error(`Naknada nove kategorije nije procitana, izmjena trazi potvrdu: ${String(e)}`);
      }
      if ((naknada > 0 || nepoznata) && !opcije.confirm) {
        this.zapisiOdbijeno("PUT", `/listings/${id}`, naknada > 0 ? `prebacivanje u naplatnu kategoriju, ${naknada} kredita` : "naknada nove kategorije nije citljiva");
        throw new OlxSpendError(
          naknada > 0
            ? `Prebacivanje u ovu kategoriju moze kostati ${naknada} kredita pri objavi. Potvrdi (confirm) da bi se nastavilo.`
            : "Cijena objave u novoj kategoriji se ne moze procitati. Potvrdi (confirm) da bi se nastavilo.",
        );
      }
    }
    return this.unwrap(
      await this.request<Listing | { data: Listing }>(`/listings/${id}`, { method: "PUT", body: input }),
    );
  }

  /**
   * Objavljuje nacrt. Nosi ISTU branu troska kao createListing, jer nacrt u naplatnoj kategoriji
   * moze doci i mimo nas (web, CLI, kreiran ranije uz potvrdu pa nikad objavljen) i onda bi se
   * objavio bez ijedne rijeci o cijeni. Izmjereno stanje: ne zna se da li platforma naplacuje na
   * kreiranju ili na objavi (API-INVENTAR.md), pa brana stoji na oba poziva.
   *
   * Svjesna posljedica: u toku kreiraj pa objavi isti oglas se dva puta racuna u dnevni plafon.
   * To je konzervativan smjer (moze odbiti malo prerano) i nikad ne uzrokuje nezeljenu naplatu,
   * dok bi izostavljanje provjere ostavilo rupu za nacrt koji nije nas.
   */
  async publishListing(
    id: number | string,
    opcije: { confirm?: boolean; potvrdiRobu?: boolean } = {},
  ): Promise<{ message: string; status: string }> {
    let naknada = 0;
    let naknadaNepoznata = false;
    // Nacrt je mogao nastati i mimo bota (web, CLI, ranije kreiran), pa se tekst provjerava i
    // ovdje, ne samo na kreiranju. Oglas se ionako cita zbog naknade, pa ovo ne kosta poziv vise.
    let oglasZaPravila: Listing | null = null;
    try {
      const oglas = await this.getListing(id);
      oglasZaPravila = oglas;
      // Listing ima index potpis, pa polja dolaze kao unknown: kategorija se konvertuje izricito.
      const sirovo = oglas.category_id ?? (oglas.category as { id?: unknown } | null)?.id;
      const kategorija = Number(sirovo);
      if (!Number.isFinite(kategorija) || kategorija <= 0) throw new Error("oglas ne nosi citljivu kategoriju");
      naknada = naknadaKategorije(await this.category(kategorija));
    } catch (e) {
      naknadaNepoznata = true;
      console.error(`Naknada kategorije nije procitana, objava trazi potvrdu: ${String(e)}`);
    }

    if (oglasZaPravila) {
      this.provjeriPravilaRobe(
        typeof oglasZaPravila.title === "string" ? oglasZaPravila.title : "",
        typeof oglasZaPravila.description === "string" ? oglasZaPravila.description : "",
        opcije.potvrdiRobu,
        "POST",
        `/listings/${id}/publish`,
      );
    }

    if ((naknada > 0 || naknadaNepoznata) && !opcije.confirm) {
      const zasto = naknada > 0 ? `objava u naplatnoj kategoriji, ${naknada} kredita` : "naknada kategorije nije citljiva";
      this.zapisiOdbijeno("POST", `/listings/${id}/publish`, zasto);
      throw new OlxSpendError(
        naknada > 0
          ? `Objava ovog oglasa košta ${naknada} kredita. Potvrdi (confirm) da bi se naplatilo.`
          : "Cijena objave ovog oglasa se trenutno ne moze procitati sa platforme. Potvrdi (confirm) da bi se objavilo i eventualno naplatilo.",
      );
    }
    if (naknada > 0) this.provjeriDnevniPlafon(naknada, "POST", `/listings/${id}/publish`);

    return this.request(`/listings/${id}/publish`, {
      method: "POST",
      ...(naknada > 0 ? { krediti: naknada } : {}),
    });
  }

  deleteListing(id: number | string): Promise<{ message: string }> {
    return this.request(`/listings/${id}`, { method: "DELETE" });
  }

  refreshLimits(): Promise<RefreshLimits> {
    return this.request<RefreshLimits>("/listing/refresh/limits");
  }

  listingLimits(): Promise<unknown> {
    return this.request("/listing-limits");
  }

  refreshListing(id: number | string): Promise<{ message: string }> {
    return this.request(`/listings/${id}/refresh`, { method: "PUT" });
  }

  // Potvrdjeno uzivo: API NE prihvata image_url, nego stvarne fajlove kao multipart pod poljem images[].
  // Zvanicna dokumentacija (api-documentation.olx.ba, provjereno 27.07.2026.) i dalje navodi
  // atribut image_url, ali uzivo je odbijen; vazi zivo ponasanje.
  // Zato i URL upload preuzme sliku i posalje je kao fajl.
  private uploadImageBlobs(
    id: number | string,
    entries: { data: Uint8Array; filename: string }[],
  ): Promise<UploadedImage[]> {
    const form = new FormData();
    for (const entry of entries) form.append("images[]", new Blob([entry.data]), entry.filename);
    return this.request<UploadedImage[]>(`/listings/${id}/image-upload`, { method: "POST", body: form });
  }

  // Upload lokalnih fajlova.
  async uploadImageFiles(id: number | string, filePaths: string[]): Promise<UploadedImage[]> {
    const entries: { data: Uint8Array; filename: string }[] = [];
    for (const path of filePaths) entries.push({ data: await readFile(path), filename: basename(path) });
    return this.uploadImageBlobs(id, entries);
  }

  // Upload preko URL-a: preuzme svaku sliku pa je posalje kao multipart fajl (API ne prihvata image_url).
  async uploadImagesByUrl(id: number | string, imageUrls: string[]): Promise<UploadedImage[]> {
    const entries: { data: Uint8Array; filename: string }[] = [];
    for (const url of imageUrls) {
      const res = await fetch(url);
      if (!res.ok) throw new OlxApiError(`Ne mogu preuzeti sliku: ${url} (${res.status})`, res.status, undefined);
      const data = new Uint8Array(await res.arrayBuffer());
      const filename = url.split("?")[0]?.split("/").pop() || "image.jpg";
      entries.push({ data, filename });
    }
    return this.uploadImageBlobs(id, entries);
  }

  deleteImage(id: number | string, imageId: number): Promise<{ success: boolean }> {
    return this.request(`/listings/${id}/image-delete`, { method: "POST", body: { imageId } });
  }

  setMainImage(id: number | string, imageId: number): Promise<{ success: boolean }> {
    return this.request(`/listings/${id}/image-main`, { method: "POST", body: { imageId } });
  }

  finishListing(id: number | string): Promise<unknown> {
    return this.request(`/listings/${id}/finish`, { method: "POST" });
  }

  hideListing(id: number | string): Promise<unknown> {
    return this.request(`/listings/${id}/hide`, { method: "POST" });
  }

  unhideListing(id: number | string): Promise<unknown> {
    return this.request(`/listings/${id}/unhide`, { method: "POST" });
  }

  // ---- Users (enumeracija kataloga) ----

  // Cuva od tihe greske: prazan ili literal "undefined" korisnik je davao 404 ili praznu listu.
  private assertUser(user: number | string): string {
    const value = String(user).trim();
    if (!value || value === "undefined" || value === "null") {
      throw new OlxAuthError("Nedostaje korisnik za listanje oglasa (dobijeno: " + JSON.stringify(user) + ").");
    }
    return value;
  }

  listActive(username: string, page = 1): Promise<Paginated<ListingSummary>> {
    const user = this.assertUser(username);
    return this.request<Paginated<ListingSummary>>(`/users/${user}/listings`, { query: { page } });
  }

  listFinished(user: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    const id = this.assertUser(user);
    return this.request<Paginated<ListingSummary>>(`/users/${id}/listings/finished`, { query: { page } });
  }

  listInactive(user: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    const id = this.assertUser(user);
    return this.request<Paginated<ListingSummary>>(`/users/${id}/listings/inactive`, { query: { page } });
  }

  listExpired(user: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    const id = this.assertUser(user);
    return this.request<Paginated<ListingSummary>>(`/users/${id}/listings/expired`, { query: { page } });
  }

  listHidden(user: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    const id = this.assertUser(user);
    return this.request<Paginated<ListingSummary>>(`/users/${id}/listings/hidden`, { query: { page } });
  }

  // Prelistava sve stranice aktivnih oglasa i vraca spojeni niz.
  listAllActive(username: string, maxPages = 50): Promise<ListingSummary[]> {
    return this.listAllByState("active", username, maxPages);
  }

  // Genericki paginator za bilo koje stanje: spaja sve stranice u jedan niz.
  async listAllByState(state: ListingStateFilter, user: number | string, maxPages = 50): Promise<ListingSummary[]> {
    const fetchPage = (page: number): Promise<Paginated<ListingSummary>> => {
      switch (state) {
        case "active":
          return this.listActive(String(user), page);
        case "finished":
          return this.listFinished(user, page);
        case "inactive":
          return this.listInactive(user, page);
        case "expired":
          return this.listExpired(user, page);
        case "hidden":
          return this.listHidden(user, page);
      }
    };
    const first = await fetchPage(1);
    const all: ListingSummary[] = [...first.data];
    const lastPage = Math.min(first.meta.last_page ?? 1, maxPages);
    for (let page = 2; page <= lastPage; page++) {
      const next = await fetchPage(page);
      all.push(...next.data);
    }
    return all;
  }

  // ---- Categories ----

  categories(): Promise<{ data: Category[] }> {
    return this.request<{ data: Category[] }>("/categories");
  }

  childrenCategories(id: number | string): Promise<{ data: Category[] }> {
    return this.request<{ data: Category[] }>(`/categories/${id}`);
  }

  category(id: number | string): Promise<{ data: Category }> {
    return this.request<{ data: Category }>(`/category/${id}`);
  }

  categoryAttributes(id: number | string): Promise<{ data: CategoryAttribute[] }> {
    return this.request<{ data: CategoryAttribute[] }>(`/categories/${id}/attributes`);
  }

  categoryBrands(id: number | string): Promise<{ data: BrandOrModel[] }> {
    return this.request<{ data: BrandOrModel[] }>(`/categories/${id}/brands`);
  }

  categoryModels(id: number | string, brandId: number | string): Promise<{ data: BrandOrModel[] }> {
    return this.request<{ data: BrandOrModel[] }>(`/categories/${id}/brands/${brandId}/models`);
  }

  suggestCategory(keyword: string): Promise<{ data: CategorySuggestion[] }> {
    return this.request<{ data: CategorySuggestion[] }>("/categories/suggest", { query: { keyword } });
  }

  findCategory(name: string): Promise<CategoryFindResult[]> {
    return this.request<CategoryFindResult[]>("/categories/find", { query: { name } });
  }

  // Rekurzivno prelistava cijelo stablo kategorija (top-level + djeca). Throttle je u request().
  // Namijenjeno za jednokratni snapshot u olx-dokumentacija/categories.json (kategorije se rijetko mijenjaju).
  async categoryTree(maxDepth = 6): Promise<CategoryNode[]> {
    const build = async (cat: Category, depth: number): Promise<CategoryNode> => {
      if (depth >= maxDepth) return { ...cat, children: [] };
      // Za list-kategoriju API vraca {data: <objekat kategorije>} umjesto niza djece; tad nema podkategorija.
      const raw = (await this.childrenCategories(cat.id)).data as unknown;
      const kids = Array.isArray(raw) ? (raw as Category[]) : [];
      const children: CategoryNode[] = [];
      for (const kid of kids) children.push(await build(kid, depth + 1));
      return { ...cat, children };
    };
    const top = (await this.categories()).data;
    const tree: CategoryNode[] = [];
    for (const cat of top) tree.push(await build(cat, 1));
    return tree;
  }

  // ---- Locations ----

  cities(): Promise<{ data: RegionEntity[] }> {
    return this.request<{ data: RegionEntity[] }>("/cities");
  }

  countries(): Promise<{ data: Country[] }> {
    return this.request<{ data: Country[] }>("/countries");
  }

  city(id: number | string): Promise<City> {
    return this.request<City>(`/cities/${id}`);
  }

  countryStates(): Promise<{ data: RegionEntity[] }> {
    return this.request<{ data: RegionEntity[] }>("/country-states");
  }

  cantonCities(id: number | string): Promise<{ data: City[] }> {
    return this.request<{ data: City[] }>(`/cantons/${id}/cities`);
  }

  // Jednokratni snapshot lokacija (drzave, entiteti, kantoni -> gradovi) za olx-dokumentacija/locations.json.
  // Gradovi se sklapaju obilaskom kantona; ako struktura entiteta ne sadrzi kantone, lista ostaje prazna
  // (flat liste se svejedno snime). Tacnu strukturu potvrditi uzivo kad token proradi.
  async locationSnapshot(includeCities = true): Promise<LocationSnapshot> {
    const countries = (await this.countries()).data;
    const entities = (await this.cities()).data;
    const states = (await this.countryStates()).data;
    const cities: City[] = [];

    if (includeCities) {
      const cantonIds = new Set<number>();
      for (const source of [...entities, ...states]) {
        const cantons = (source as { cantons?: unknown[] }).cantons;
        if (!Array.isArray(cantons)) continue;
        for (const canton of cantons) {
          const id = (canton as { id?: unknown }).id;
          if (typeof id === "number") cantonIds.add(id);
        }
      }
      for (const id of cantonIds) {
        try {
          cities.push(...(await this.cantonCities(id)).data);
        } catch {
          // preskoci kanton koji ne vraca gradove
        }
      }
    }

    return { countries, entities, states, cities };
  }

  // ---- Sponsored (trosak kredita) ----

  // Dohvata cijenu izdvajanja. GET ne smije imati body, pa se parametri salju kao query.
  // refresh_every je na API-ju obavezan (bez njega 422), pa nedostatak tretiramo kao 0 (bez autoobnove).
  sponsorPrice(id: number | string, options: SponsorOptions): Promise<SponsorPrice> {
    return this.request<SponsorPrice>(`/listings/${id}/sponsore/price`, {
      query: {
        type: options.type,
        days: options.days,
        refresh_every: options.refresh_every ?? 0,
        locations: options.locations,
      },
    });
  }

  // Spend-guard: bez confirm === true ne trosi kredite, nego dohvata cijenu i baca OlxSpendError.
  //
  // Kad je confirm postavljen, cijena se svejedno dohvata: treba za dnevni plafon i za zapis u
  // audit log. To je jedan dodatan GET po naplati, sto je jeftino naspram toga da se ne zna
  // koliko je potroseno.
  async sponsorListing(
    id: number | string,
    options: SponsorOptions,
    confirm: boolean,
  ): Promise<unknown> {
    const price = await this.sponsorPrice(id, options);
    if (!confirm) {
      this.zapisiOdbijeno("POST", `/listings/${id}/sponsore`, `izdvajanje za ${price.total} kredita`);
      throw new OlxSpendError(
        `Izdvajanje bi koštalo ${price.total} kredita. Potvrdi (confirm) da bi se naplatilo.`,
        price,
      );
    }
    this.provjeriDnevniPlafon(price.total, "POST", `/listings/${id}/sponsore`);
    // Bez retry-a na 5xx: naplata je mogla proci prije nego je server pao na odgovoru.
    return this.request(`/listings/${id}/sponsore`, {
      method: "POST",
      body: { ...options, refresh_every: options.refresh_every ?? 0 },
      retryOnServerError: false,
      krediti: price.total,
    });
  }

  // Akcijska cijena nema endpoint za cijenu, pa se tacan trosak ne moze unaprijed saznati.
  // U plafon i audit ulazi kao NAJMANJE 1 kredit: donja granica, ne procjena cijene. Bez toga
  // bi neogranicen broj akcijskih cijena prolazio kroz vec potrosen plafon (svaka kosta, a
  // brojac bi ostao na nuli).
  async setDiscount(id: number | string, input: DiscountInput, confirm: boolean): Promise<unknown> {
    if (!confirm) {
      this.zapisiOdbijeno("POST", `/listings/${id}/discount`, `akcijska cijena ${input.price} na ${input.days} dana`);
      throw new OlxSpendError(
        `Akcijska cijena je premium opcija i troši kredite. Potvrdi (confirm) za izvršenje.`,
      );
    }
    this.provjeriDnevniPlafon(1, "POST", `/listings/${id}/discount`);
    // Bez retry-a na 5xx: isti razlog kao kod izdvajanja (dupla naplata).
    return this.request(`/listings/${id}/discount`, { method: "POST", body: input, retryOnServerError: false, krediti: 1 });
  }

  /**
   * Tvrdi dnevni plafon potrosnje. Zadnja brana kad je model ubijedjen da je dobio potvrdu.
   *
   * Cita se iz audit loga, ne iz memorije procesa, jer klijentska sesija i cron poslovi rade u
   * odvojenim procesima nad istim nalogom. Kad log postoji a NE MOZE se procitati, radnja se
   * ODBIJA (fails closed): plafon koji se tiho iskljuci na pokvaren fajl nije plafon nego
   * ukras. Legitimna radnja koja zbog toga stane je manja steta od neogranicenog trosenja.
   */
  private provjeriDnevniPlafon(trosak: number, method: Method, path: string): void {
    const plafon = this.config.maxSpendPerDay;
    if (!plafon || plafon <= 0) return;
    const danas = new Date().toISOString().slice(0, 10);
    let vecPotroseno: number;
    try {
      vecPotroseno = potrosenoNaDan(readFileSync(this.config.auditFile, "utf8"), danas);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const razlog = `dnevni plafon je ukljucen a audit log nije citljiv (${String(e)})`;
        this.zapisiOdbijeno(method, path, razlog);
        throw new OlxSpendError(`Radnja je zaustavljena: ${razlog}. Javi administratoru.`);
      }
      vecPotroseno = 0; // log jos ne postoji, dakle danas nista nije potroseno
    }
    if (vecPotroseno + trosak <= plafon) return;
    const razlog = `dnevni plafon ${plafon} kredita; danas potroseno ${vecPotroseno}, ova radnja trazi ${trosak}`;
    this.zapisiOdbijeno(method, path, razlog);
    throw new OlxSpendError(`Radnja je zaustavljena: ${razlog}. Javi administratoru.`);
  }

  finishDiscount(id: number | string): Promise<unknown> {
    return this.request(`/listings/${id}/discount/finish`, { method: "POST" });
  }

  // ---- Stats agregati ----
  // Tanki orkestratori: dohvate podatke pa pozovu ciste funkcije iz stats.ts. Svaki izlaz
  // nosi broj_poziva i trajanje_ms, jer read pozivi po defaultu ne idu u audit log.

  // Statistika vlastitog profila. viewsMode "sample" radi getListing na uzorku aktivnih
  // oglasa (najsvjeziji, najstariji po obnovi i sponzorisani); "none" ne trosi dodatne pozive.
  // Kroz `pregledi` se mogu ubaciti podaci iz snapshota sa diska (0 dodatnih poziva).
  async statsProfil(
    options: { viewsMode?: "none" | "sample"; pregledi?: OglasPregledi[]; sampleVelicina?: number } = {},
  ): Promise<{ statistika: ProfilStatistika; broj_poziva: number; trajanje_ms: number }> {
    const start = Date.now();
    let pozivi = 0;
    const me = await this.me();
    pozivi += 1;
    const username = await this.resolveUsername();
    const limits = await this.refreshLimits();
    pozivi += 1;
    // Limit oglasa po paketu nije dokumentovan i na nekim nalozima vraca gresku, pa ne smije
    // oboriti cijelu statistiku.
    let listingLimits: unknown;
    try {
      listingLimits = await this.listingLimits();
      pozivi += 1;
    } catch {
      listingLimits = undefined;
    }
    const aktivni = await this.listAllByState("active", username);
    pozivi += Math.max(1, Math.ceil(aktivni.length / 20));
    const [istekli, skriveni, neaktivni, zavrseni] = await Promise.all([
      this.listExpired(username, 1),
      this.listHidden(username, 1),
      this.listInactive(username, 1),
      this.listFinished(username, 1),
    ]);
    pozivi += 4;

    let pregledi = options.pregledi;
    if (!pregledi && options.viewsMode === "sample") {
      const uzorak = uzorakZaPreglede(aktivni, options.sampleVelicina ?? 15);
      pregledi = [];
      for (const o of uzorak) {
        const full = await this.getListing(o.id);
        pozivi += 1;
        const views = typeof full.views === "number" ? full.views : 0;
        pregledi.push({
          id: full.id,
          title: full.title,
          views,
          questions: typeof full.questions === "number" ? full.questions : undefined,
          created_at: typeof full.created_at === "number" ? full.created_at : undefined,
        });
      }
    }

    const statistika = profilStatistika({
      me,
      refreshLimits: limits,
      aktivni,
      ukupno: {
        istekli: istekli.meta.total,
        skriveni: skriveni.meta.total,
        neaktivni: neaktivni.meta.total,
        zavrseni: zavrseni.meta.total,
      },
      pregledi,
      listingLimits,
      sadaTs: Math.floor(Date.now() / 1000),
    });
    return { statistika, broj_poziva: pozivi, trajanje_ms: Date.now() - start };
  }

  // Onboarding izvjestaj: prva analiza koja se pokazuje klijentu.
  //
  // Detalji o oglasima (slike, podnaslov, opis, atributi, pregledi) dolaze iz dnevnog snapshota
  // i ne kostaju nijedan poziv. Kad snapshota nema, izvjestaj se svejedno pravi, samo bez
  // sekcije ucinka i bez higijene koja trazi puni oglas. Svjez prolaz kroz sve oglase se ovdje
  // namjerno ne radi: na shopu od par stotina oglasa to su minute, a za to postoji
  // `stats snapshot` koji ionako radi nocu.
  async statsOnboarding(
    detalji?: { oglasi: OnboardingDetalj[]; ts: number },
  ): Promise<{ izvjestaj: OnboardingIzvjestaj; broj_poziva: number; trajanje_ms: number }> {
    const start = Date.now();
    let pozivi = 0;
    const me = await this.me();
    pozivi += 1;
    const username = await this.resolveUsername();
    const limits = await this.refreshLimits();
    pozivi += 1;
    // Limit oglasa po paketu nije dokumentovan i na nekim nalozima vraca gresku, pa ne smije
    // oboriti cijeli izvjestaj.
    let listingLimits: unknown;
    try {
      listingLimits = await this.listingLimits();
      pozivi += 1;
    } catch {
      listingLimits = undefined;
    }
    const aktivni = await this.listAllByState("active", username);
    pozivi += Math.max(1, Math.ceil(aktivni.length / 20));
    const [istekli, skriveni, neaktivni, zavrseni] = await Promise.all([
      this.listExpired(username, 1),
      this.listHidden(username, 1),
      this.listInactive(username, 1),
      this.listFinished(username, 1),
    ]);
    pozivi += 4;

    const izvjestaj = onboardingIzvjestaj({
      me,
      refreshLimits: limits,
      aktivni,
      ukupno: {
        istekli: istekli.meta.total,
        skriveni: skriveni.meta.total,
        neaktivni: neaktivni.meta.total,
        zavrseni: zavrseni.meta.total,
      },
      listingLimits,
      detalji: detalji?.oglasi,
      detaljiTs: detalji?.ts,
      sadaTs: Math.floor(Date.now() / 1000),
      // Izmjereni dan vazi kad ciklusa nema; dnevnik na klonu bez mjerenja vrati prazno i sve
      // ostaje po starom. Rezerva iz .env vazi samo za nalog bez shopa.
      izmjereniDanReseta: izmjereniDanReseta(ucitajKvotuDnevnik()),
      danCiklusaRezerva: this.config.danCiklusaKvote,
    });
    return { izvjestaj, broj_poziva: pozivi, trajanje_ms: Date.now() - start };
  }

  // Izvjestaj o tudjem (ili svom) nalogu iz javnih podataka. topViews > 0 dodatno povlaci
  // pojedinacne oglase (najskorije obnovljene) radi pregleda po oglasu.
  async statsKonkurent(
    username: string,
    topViews = 0,
  ): Promise<{ izvjestaj: KonkurentIzvjestaj; top_oglasi: OglasIzvjestaj[]; broj_poziva: number; trajanje_ms: number }> {
    const start = Date.now();
    let pozivi = 0;
    const profil = await this.userProfile(username);
    pozivi += 1;
    const aktivni = await this.listAllByState("active", username);
    pozivi += Math.max(1, Math.ceil(aktivni.length / 20));
    let zavrseni: number | null = null;
    try {
      zavrseni = (await this.listFinished(username, 1)).meta.total;
      pozivi += 1;
    } catch {
      // Zavrseni tudji oglasi mogu biti nedostupni; izvjestaj i bez njih vrijedi.
    }
    const sadaTs = Math.floor(Date.now() / 1000);
    const izvjestaj = konkurentIzvjestaj(profil, aktivni, zavrseni, sadaTs);

    const topOglasi: OglasIzvjestaj[] = [];
    if (topViews > 0) {
      const kandidati = [...aktivni].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, topViews);
      for (const o of kandidati) {
        topOglasi.push(oglasIzvjestaj(await this.getListing(o.id), sadaTs));
        pozivi += 1;
      }
    }
    return { izvjestaj, top_oglasi: topOglasi, broj_poziva: pozivi, trajanje_ms: Date.now() - start };
  }

  // Telefon kandidata iz javnog teksta: API ga ne vraca kao polje ni za jedan tudji nalog
  // (privatni podaci se ne vracaju za tudje naloge), pa se cita iz opisa shopa i prvih
  // brojOglasa najskorijih aktivnih oglasa. Ekstrakcija (regex pa Haiku) je u telefon-ekstrakcija.ts.
  //
  // Namjerno cita SAMO prvu stranicu aktivnih oglasa (ne listAllByState): za shop sa stotinama
  // oglasa bi prelistavanje svih stranica samo da se izabere top N bilo desetine poziva i
  // sekundi po kandidatu, neprihvatljivo kad se prolazi kroz citav Excel spisak. Prva stranica
  // je dovoljna, jer trazimo bilo koji tekst gdje je prodavac upisao broj, ne bas najnoviji oglas.
  async statsKonkurentTelefon(
    username: string,
    brojOglasa = 5,
  ): Promise<{ username: string; telefon: string | null; izvor: "regex" | "haiku" | null; provjereno_oglasa: number; broj_poziva: number; trajanje_ms: number }> {
    const start = Date.now();
    let pozivi = 0;
    const profil = await this.userProfile(username);
    pozivi += 1;
    const prvaStranica = await this.listActive(username, 1);
    pozivi += 1;

    const kandidati = [...prvaStranica.data].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, brojOglasa);
    const dijeloviTeksta: string[] = [];
    if (profil.shop?.description) dijeloviTeksta.push(profil.shop.description);
    for (const o of kandidati) {
      const detalji = await this.getListing(o.id);
      pozivi += 1;
      if (detalji.short_description) dijeloviTeksta.push(detalji.short_description);
      if (detalji.additional?.description) dijeloviTeksta.push(detalji.additional.description);
    }

    const rezultat = await izvuciTelefon(dijeloviTeksta.join("\n"));
    return {
      username,
      telefon: rezultat.telefon,
      izvor: rezultat.izvor,
      provjereno_oglasa: kandidati.length,
      broj_poziva: pozivi,
      trajanje_ms: Date.now() - start,
    };
  }

  // Izvjestaj o jednom oglasu (nasem ili tudjem), 1 poziv.
  async statsOglas(id: number | string): Promise<OglasIzvjestaj> {
    return oglasIzvjestaj(await this.getListing(id), Math.floor(Date.now() / 1000));
  }

  // Alarmi naloga, 4 poziva (me, refreshLimits, listExpired, listingLimits).
  async statsAlarmi(pragovi: AlarmiPragovi = {}): Promise<AlarmiNaloga & { broj_poziva: number }> {
    const me = await this.me();
    const username = await this.resolveUsername();
    const [limits, istekli, listingLimits] = await Promise.all([
      this.refreshLimits(),
      this.listExpired(username, 1),
      // Limit oglasa po paketu nije dokumentovan i na nekim nalozima vraca gresku, pa ne smije
      // oboriti cijele alarme.
      this.listingLimits().catch(() => undefined),
    ]);
    const rezultat = alarmiNaloga(
      me,
      limits,
      istekli.meta.total,
      Math.floor(Date.now() / 1000),
      { danCiklusaRezerva: this.config.danCiklusaKvote, ...pragovi },
      izmjereniDanReseta(ucitajKvotuDnevnik()),
      listingLimits,
    );
    return { ...rezultat, broj_poziva: 4 };
  }
}

// Uzorak za preglede: najsvjezije i najstarije po zadnjoj obnovi plus sponzorisani, bez duplikata.
function uzorakZaPreglede(aktivni: ListingSummary[], velicina: number): ListingSummary[] {
  const trecina = Math.max(1, Math.floor(velicina / 3));
  const poDatumu = [...aktivni].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  const odabrani = new Map<number, ListingSummary>();
  for (const o of poDatumu.slice(0, trecina)) odabrani.set(o.id, o);
  for (const o of poDatumu.slice(-trecina)) odabrani.set(o.id, o);
  for (const o of aktivni.filter((x) => (x.sponsored ?? 0) > 0).slice(0, trecina)) odabrani.set(o.id, o);
  for (const o of poDatumu) {
    if (odabrani.size >= Math.min(velicina, aktivni.length)) break;
    odabrani.set(o.id, o);
  }
  return [...odabrani.values()];
}

/**
 * Naknada za objavu u kategoriji, u kreditima. 0 kad je nema ili se ne moze procitati.
 *
 * Tolerantno na oblik odgovora: `GET /category/:id` vraca omotac `{ data: {...} }`, ali se
 * ista provjera koristi i tamo gdje je kategorija vec raspakovana. Bez ovoga bi se citalo
 * `listing_fee` sa omotaca, uvijek dobijalo undefined, i spend-guard na objavi nikad ne bi
 * opalio (provjereno na kategoriji Automobili, gdje je naknada 70 kredita).
 */
export function naknadaKategorije(odgovor: unknown): number {
  const o = odgovor as { listing_fee?: unknown; data?: { listing_fee?: unknown } } | null;
  const sirovo = o?.data?.listing_fee ?? o?.listing_fee;
  const n = Number(sirovo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
