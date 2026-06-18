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
  date?: number;
  sponsored?: number;
  available?: boolean;
  visible?: boolean;
  status?: string;
  refresh_available?: boolean;
  [key: string]: unknown;
}

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
