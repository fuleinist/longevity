export type Category = 'phone' | 'laptop' | 'washer';

export const CATEGORIES: readonly Category[] = ['phone', 'laptop', 'washer'];

export const CATEGORY_LABEL: Record<Category, string> = {
  phone: 'Phone',
  laptop: 'Laptop',
  washer: 'Washing machine',
};

export const CATEGORY_BASE_YEARS: Record<Category, number> = {
  phone: 5,
  laptop: 7,
  washer: 12,
};

export interface Money {
  /** Amount in AUD. */
  amount: number;
  currency: 'AUD';
}

export interface PriceInfo extends Money {
  /** Street price or recommended retail price. */
  kind: 'street' | 'rrp';
  /** ISO date of the price check. */
  checkedOn: string;
  /** Public page used for the price. */
  sourceUrl: string;
  /** True when the amount is an estimate for the series or model. */
  estimate: boolean;
}

export interface IfixitInfo {
  wikiid: number;
  title: string;
  url: string;
  /** Published repairability score, 0 to 10. Null when iFixit has none. */
  score: number | null;
  guideCount: number;
  toolCount: number;
  imageUrl?: string;
  /** ISO timestamp of the last fetch. */
  fetchedAt: string;
}

export interface AuditAnswer {
  /** Question id from the audit question set. */
  id: string;
  answer: boolean;
}

export interface Audit {
  answers: AuditAnswer[];
  /** ISO date of the self-assessment. */
  checkedOn: string;
  note?: string;
}

export interface EnergyInfo {
  /** Yearly energy use in kWh. */
  annualKwh: number;
  /** Where the value comes from. */
  sourceUrl: string;
  note?: string;
}

export interface Product {
  id: string;
  brand: string;
  /** Model or series name. Market codes can differ. */
  model: string;
  name: string;
  category: Category;
  /** EAN, UPC or GTIN values. Can be empty. */
  barcodes: string[];
  price: PriceInfo;
  /** Typical independent repair cost in AUD. */
  repairCost: number;
  /** Repair scenario value. One event is one repair. */
  repairEvents: number;
  /** Note about the repair cost. */
  repairNote?: string;
  energy?: EnergyInfo;
  /** Public spare-parts page. */
  partsUrl?: string;
  /** Public guide or manual page. */
  manualUrl?: string;
  /** Free-text service note shown in the UI. */
  serviceNote?: string;
  ifixit?: IfixitInfo;
  audit?: Audit;
  /** Public pages used for this entry. */
  sources: string[];
  /** ISO date of the last data review. */
  updatedAt: string;
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  tariffAud: number;
  products: Product[];
}

export interface CatalogFile {
  version: 1;
  tariffAud: number;
  products: Product[];
}

export interface ScorePart {
  id: 'repair' | 'support' | 'parts' | 'running';
  label: string;
  weight: number;
  /** 0 to 100. Null when the data is missing. */
  value: number | null;
  detail: string;
}

export interface ScoreResult {
  /** 0 to 100, rounded. Null when no part has data. */
  score: number | null;
  parts: ScorePart[];
  /** Share of the total weight that had data, 0 to 100. */
  coverage: number;
  band: ScoreBand | null;
}

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor';

export interface LifeCostInput {
  price: number;
  repairCost: number;
  repairEvents: number;
  yearlyEnergyCost: number;
  category: Category;
  repairScore10: number | null;
}

export interface LifeCostResult {
  lifeYears: number;
  total: number;
  perYear: number;
  purchase: number;
  repairs: number;
  energy: number;
}

export type Verdict = 'repair' | 'consider' | 'replace';

export interface Decision {
  verdict: Verdict;
  ratio: number;
  repairPerYear: number;
  replacePerYear: number;
  remainingYears: number;
}

export interface Repairer {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  address?: string;
  distanceM: number;
  tags: Record<string, string>;
}