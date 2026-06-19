import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadConfig, type OlxConfig } from "./config.js";
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
  LocationSnapshot,
  ListingSummary,
  LoginResponse,
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
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OlxClient {
  private token?: string;
  private lastRequestAt = 0;

  constructor(private readonly config: OlxConfig = loadConfig()) {
    this.token = config.token;
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

  // Centralni request wrapper sa retry/backoff na 429 i 5xx.
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query, body, auth = true } = options;

    // Kod multipart uploada (FormData) Content-Type postavlja fetch sam (sa boundary).
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
    if (auth) Object.assign(headers, this.authHeaders());

    const url = this.buildUrl(path, query);
    let attempt = 0;

    while (true) {
      attempt++;
      await this.throttle();

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

        if (res.ok) return parsed as T;

        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt <= this.config.maxRetries) {
          const backoff = Math.min(8000, 2 ** attempt * 250) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          throw new OlxAuthError(
            `Pristup odbijen (${res.status}). Provjeri token i da li je shop odobren za API.`,
          );
        }
        throw new OlxApiError(`Zahtjev nije uspio (${res.status}) ${method} ${path}`, res.status, parsed);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof OlxApiError || err instanceof OlxAuthError) throw err;
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (attempt <= this.config.maxRetries) {
          const backoff = Math.min(8000, 2 ** attempt * 250) + Math.random() * 200;
          await sleep(backoff);
          continue;
        }
        throw new OlxApiError(
          isAbort ? `Timeout nakon ${this.config.timeoutMs}ms na ${path}` : `Mrezna greska na ${path}: ${String(err)}`,
          0,
          undefined,
        );
      }
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

  async me(): Promise<OlxUser> {
    return this.request<OlxUser>("/me");
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

  createListing(input: CreateListingInput): Promise<Listing> {
    return this.request<Listing>("/listings", { method: "POST", body: input });
  }

  updateListing(id: number | string, input: UpdateListingInput): Promise<Listing> {
    return this.request<Listing>(`/listings/${id}`, { method: "PUT", body: input });
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

  // Upload preko URL-a: dokumentacija navodi images array sa image_url atributom.
  uploadImagesByUrl(id: number | string, imageUrls: string[]): Promise<UploadedImage[]> {
    return this.request<UploadedImage[]>(`/listings/${id}/image-upload`, {
      method: "POST",
      body: { images: imageUrls.map((image_url) => ({ image_url })) },
    });
  }

  // Upload lokalnih fajlova preko multipart/form-data.
  // NEPOTVRDJENO: tacan naziv polja ("images[]") nije zvanicno dokumentovan; po potrebi promijeni fieldName.
  async uploadImageFiles(
    id: number | string,
    filePaths: string[],
    fieldName = "images[]",
  ): Promise<UploadedImage[]> {
    const form = new FormData();
    for (const path of filePaths) {
      const buffer = await readFile(path);
      form.append(fieldName, new Blob([buffer]), basename(path));
    }
    return this.request<UploadedImage[]>(`/listings/${id}/image-upload`, {
      method: "POST",
      body: form,
    });
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

  listActive(username: string, page = 1): Promise<Paginated<ListingSummary>> {
    return this.request<Paginated<ListingSummary>>(`/users/${username}/listings`, { query: { page } });
  }

  listFinished(userId: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    return this.request<Paginated<ListingSummary>>(`/users/${userId}/listings/finished`, { query: { page } });
  }

  listInactive(userId: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    return this.request<Paginated<ListingSummary>>(`/users/${userId}/listings/inactive`, { query: { page } });
  }

  listExpired(userId: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    return this.request<Paginated<ListingSummary>>(`/users/${userId}/listings/expired`, { query: { page } });
  }

  listHidden(userId: number | string, page = 1): Promise<Paginated<ListingSummary>> {
    return this.request<Paginated<ListingSummary>>(`/users/${userId}/listings/hidden`, { query: { page } });
  }

  // Prelistava sve stranice aktivnih oglasa i vraca spojeni niz.
  async listAllActive(username: string, maxPages = 50): Promise<ListingSummary[]> {
    const first = await this.listActive(username, 1);
    const all: ListingSummary[] = [...first.data];
    const lastPage = Math.min(first.meta.last_page ?? 1, maxPages);
    for (let page = 2; page <= lastPage; page++) {
      const next = await this.listActive(username, page);
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
  sponsorPrice(id: number | string, options: SponsorOptions): Promise<SponsorPrice> {
    return this.request<SponsorPrice>(`/listings/${id}/sponsore/price`, {
      query: {
        type: options.type,
        days: options.days,
        refresh_every: options.refresh_every,
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
      throw new OlxSpendError(
        `Izdvajanje bi koštalo ${price.total} kredita. Potvrdi (confirm) da bi se naplatilo.`,
        price,
      );
    }
    return this.request(`/listings/${id}/sponsore`, { method: "POST", body: options });
  }

  async setDiscount(id: number | string, input: DiscountInput, confirm: boolean): Promise<unknown> {
    if (!confirm) {
      throw new OlxSpendError(
        `Akcijska cijena je premium opcija i troši kredite. Potvrdi (confirm) za izvršenje.`,
      );
    }
    return this.request(`/listings/${id}/discount`, { method: "POST", body: input });
  }

  finishDiscount(id: number | string): Promise<unknown> {
    return this.request(`/listings/${id}/discount/finish`, { method: "POST" });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
