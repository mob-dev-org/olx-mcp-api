import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadConfig, type OlxConfig } from "./config.js";
import { auditSinkFromPath, currentAuditContext, type AuditSink } from "./audit.js";
import {
  alarmiNaloga,
  konkurentIzvjestaj,
  oglasIzvjestaj,
  profilStatistika,
  type AlarmiNaloga,
  type AlarmiPragovi,
  type KonkurentIzvjestaj,
  type OglasIzvjestaj,
  type OglasPregledi,
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
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface OlxClientOptions {
  // Gdje ide trag radnji. Injektovan namjerno: testovi podmetnu kolektor u memoriji umjesto fajla.
  audit?: AuditSink;
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

  constructor(
    private readonly config: OlxConfig = loadConfig(),
    options: OlxClientOptions = {},
  ) {
    this.token = config.token;
    this.audit = options.audit ?? auditSinkFromPath(config.auditFile);
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
    const { method = "GET", query, body, auth = true, retryOnServerError = true } = options;

    // Kod multipart uploada (FormData) Content-Type postavlja fetch sam (sa boundary).
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const url = this.buildUrl(path, query);
    const startedAt = Date.now();
    let attempt = 0;
    let reloginTried = false;

    // Jedan zapis po logickom pozivu, ne po HTTP pokusaju, da backoff ne pravi spam u logu.
    // Tijelo i query nikad ne ulaze u zapis (login nosi lozinku).
    const zapisi = (status: number, ok: boolean, error?: string): void => {
      if (method === "GET" && !this.config.auditReads) return;
      const ctx = currentAuditContext();
      this.audit({
        ts: new Date().toISOString(),
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
                : "Token ne vrijedi ili je istekao (401). Postavi novi OLX_TOKEN, ili dodaj OLX_USERNAME i OLX_PASSWORD pa ce se token obnavljati sam."
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
  async createListing(input: CreateListingInput): Promise<Listing> {
    return this.unwrap(
      await this.request<Listing | { data: Listing }>("/listings", {
        method: "POST",
        body: input,
        retryOnServerError: false,
      }),
    );
  }

  async updateListing(id: number | string, input: UpdateListingInput): Promise<Listing> {
    return this.unwrap(
      await this.request<Listing | { data: Listing }>(`/listings/${id}`, { method: "PUT", body: input }),
    );
  }

  publishListing(id: number | string): Promise<{ message: string; status: string }> {
    return this.request(`/listings/${id}/publish`, { method: "POST" });
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
  async sponsorListing(
    id: number | string,
    options: SponsorOptions,
    confirm: boolean,
  ): Promise<unknown> {
    if (!confirm) {
      const price = await this.sponsorPrice(id, options);
      this.zapisiOdbijeno("POST", `/listings/${id}/sponsore`, `izdvajanje za ${price.total} kredita`);
      throw new OlxSpendError(
        `Izdvajanje bi koštalo ${price.total} kredita. Potvrdi (confirm) da bi se naplatilo.`,
        price,
      );
    }
    // Bez retry-a na 5xx: naplata je mogla proci prije nego je server pao na odgovoru.
    return this.request(`/listings/${id}/sponsore`, {
      method: "POST",
      body: { ...options, refresh_every: options.refresh_every ?? 0 },
      retryOnServerError: false,
    });
  }

  async setDiscount(id: number | string, input: DiscountInput, confirm: boolean): Promise<unknown> {
    if (!confirm) {
      this.zapisiOdbijeno("POST", `/listings/${id}/discount`, `akcijska cijena ${input.price} na ${input.days} dana`);
      throw new OlxSpendError(
        `Akcijska cijena je premium opcija i troši kredite. Potvrdi (confirm) za izvršenje.`,
      );
    }
    // Bez retry-a na 5xx: isti razlog kao kod izdvajanja (dupla naplata).
    return this.request(`/listings/${id}/discount`, { method: "POST", body: input, retryOnServerError: false });
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
      sadaTs: Math.floor(Date.now() / 1000),
    });
    return { statistika, broj_poziva: pozivi, trajanje_ms: Date.now() - start };
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

  // Izvjestaj o jednom oglasu (nasem ili tudjem), 1 poziv.
  async statsOglas(id: number | string): Promise<OglasIzvjestaj> {
    return oglasIzvjestaj(await this.getListing(id), Math.floor(Date.now() / 1000));
  }

  // Alarmi naloga, 3 poziva.
  async statsAlarmi(pragovi: AlarmiPragovi = {}): Promise<AlarmiNaloga & { broj_poziva: number }> {
    const me = await this.me();
    const username = await this.resolveUsername();
    const [limits, istekli] = await Promise.all([this.refreshLimits(), this.listExpired(username, 1)]);
    const rezultat = alarmiNaloga(me, limits, istekli.meta.total, Math.floor(Date.now() / 1000), pragovi);
    return { ...rezultat, broj_poziva: 3 };
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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
