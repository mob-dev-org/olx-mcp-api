// Tipovi za OLX/PIK API modele. Pokrivaju polja koja API vraca prema zvanicnoj dokumentaciji.
// Gdje API vraca i polja koja ovdje nisu navedena, koristi se index potpis radi tolerancije.

export interface OlxUser {
  id: number;
  type?: string;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

export interface LoginResponse {
  token: string;
  user: OlxUser;
}

// Javni profil korisnika ili shopa (GET /users/:username). Sadrzi samo ono sto je javno
// vidljivo: paket, poslovne podatke, ocjene i vrijeme odgovora. Osnova za analizu konkurencije.
// Potvrdjeno zivim pozivom 26.07.2026. na javnom Platinum shopu: ends_at je unix timestamp u sekundama
// (ne datum kao tekst), registered je boolean, a business_name i business_vat su popunjeni i
// kod shopova koji nisu "registered".
export interface OlxPublicProfileShop {
  package?: string;
  business_name?: string;
  business_type?: string | null;
  business_vat?: string;
  active?: boolean;
  availability?: boolean;
  ends_at?: number;
  web?: string | null;
  description?: string;
  working_hours?: unknown;
  registered?: boolean;
  [key: string]: unknown;
}

export interface OlxPublicProfile {
  type?: string;
  id: number;
  username?: string;
  medals?: { type?: string; text?: string; value?: number; url?: string }[];
  feedbacks?: { positive?: number; negative?: number };
  shop?: OlxPublicProfileShop;
  location?: unknown;
  // Unix timestamp u sekundama.
  created_at?: number;
  // Prosjecno vrijeme odgovora; na provjerenom nalogu vraceno kao broj (npr. 14).
  avg_response_time?: number;
  [key: string]: unknown;
}

export interface ListingLocation {
  lat: number;
  lon: number;
}

export interface Listing {
  id: number;
  type?: string;
  title: string;
  slug?: string;
  short_description?: string;
  additional?: { description?: string };
  price?: number;
  display_price?: string;
  listing_type?: ListingType;
  price_by_agreement?: boolean;
  visible?: boolean;
  quantity?: number;
  location?: ListingLocation;
  status?: string;
  available?: boolean;
  state?: ListingState;
  [key: string]: unknown;
}

export type ListingType = "sell" | "buy" | "rent";
export type ListingState = "new" | "used";

export interface ListingAttribute {
  id: number;
  value: string;
}

export interface CreateListingInput {
  title: string;
  category_id?: number | string;
  short_description?: string;
  description?: string;
  country_id?: number | string;
  city_id?: number | string;
  price?: number;
  available?: boolean;
  listing_type?: ListingType;
  state?: ListingState;
  brand_id?: number | string;
  model_id?: number | string;
  sku_number?: string;
  attributes?: ListingAttribute[];
}

export type UpdateListingInput = Partial<CreateListingInput>;

export interface RefreshLimits {
  free_limit: number;
  free_count: number;
  paid_count: number;
  listing_count: number;
}

export interface ListingSummary {
  id: number;
  category_id?: number;
  title: string;
  price?: number;
  display_price?: string;
  // Unix timestamp ZADNJE OBNOVE, ne datuma objave: obnova pomjera datum koji oglas nosi u
  // pretrazi. Kod oglasa koji jos nije obnavljan jednak je datumu objave, pa se "nikad obnovljen"
  // ne razlikuje od "obnovljen tada" bez poredjenja sa created_at. Detalji u API-INVENTAR.md.
  date?: number;
  sponsored?: number;
  available?: boolean;
  visible?: boolean;
  status?: string;
  refresh_available?: boolean;
  [key: string]: unknown;
}

// Stanja liste oglasa koja API razlikuje po putanji (/listings, /listings/finished...).
export type ListingStateFilter = "active" | "finished" | "inactive" | "expired" | "hidden";

export interface PaginationMeta {
  total: number;
  last_page: number;
  current_page: number;
  per_page: number;
  selected_category?: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SviOglasi {
  oglasi: ListingSummary[];
  // false znaci da lista NIJE cijeli katalog. Pozivalac je duzan da to obradi: ili odbije
  // radnju, ili je izricito oznaci u odgovoru. Tiho koristenje nepotpune liste je bug.
  potpuno: boolean;
  ukupno: number | null;
  procitanoStranica: number;
  stranicaUkupno: number | null;
  razlog?: "budzet" | "osigurac" | "katalog_se_mijenjao";
}

// Koliki dio kataloga stoji iza jednog izvjestaja. `potpuno` i `razlog` namjerno nose ISTA
// imena kao u SviOglasi: podatak o nepotpunosti se ne smije preimenovati dok putuje kroz
// slojeve, jer se tako najlakse izgubi.
export interface Obuhvat {
  potpuno: boolean;
  ukupno: number | null;
  procitano: number;
  razlog?: "budzet" | "osigurac" | "katalog_se_mijenjao";
}

export interface Category {
  id: number;
  name: string;
  name_singular?: string;
  slug?: string;
  parent_id?: number | null;
  brand_required?: boolean;
  model_required?: boolean;
  has_models?: boolean;
  show_map?: boolean;
  show_condition?: boolean;
  listing_fee?: number;
  base_listing_price?: number;
  [key: string]: unknown;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface CategoryAttribute {
  id: number;
  type?: string;
  name: string;
  input_type?: string;
  display_name?: string;
  options?: string[];
  required?: boolean;
  [key: string]: unknown;
}

export interface BrandOrModel {
  id: number;
  name: string;
  slug?: string;
}

export interface CategorySuggestion {
  id: number;
  count?: number;
  name: string;
  parent_categories?: string[];
}

export interface CategoryFindResult {
  id: number;
  name: string;
  path: string;
}

export interface City {
  id: number;
  name: string;
  zip_code?: number;
  lat?: string;
  lon?: string;
  country_id?: number;
  canton_id?: number;
  state_id?: number;
  [key: string]: unknown;
}

export interface Country {
  id: number;
  name: string;
  code: string;
}

export interface RegionEntity {
  id: number;
  name: string;
  code: string;
  cantons?: unknown[];
}

export interface LocationSnapshot {
  countries: Country[];
  entities: RegionEntity[];
  states: RegionEntity[];
  cities: City[];
}

export type SponsorType = 0 | 1 | 2;
export type SponsorDays = 1 | 2 | 3 | 5 | 7 | 14 | 21 | 30;
export type RefreshEvery = 0 | 3 | 6 | 8 | 24;

export interface SponsorOptions {
  type: SponsorType;
  days: SponsorDays;
  refresh_every?: RefreshEvery;
  locations?: string[];
}

export interface SponsorPrice {
  search: number;
  refresh: number;
  locations: number;
  extras: number;
  total: number;
  total_without_discount?: number;
  discount?: number;
  discount_percentage?: number;
  [key: string]: unknown;
}

export interface DiscountInput {
  price: number;
  days: 3 | 7 | 30;
}

export interface UploadedImage {
  id: number;
  name: string;
  main: boolean;
  order: number;
  sizes?: Record<string, string>;
  created_at?: string;
}
