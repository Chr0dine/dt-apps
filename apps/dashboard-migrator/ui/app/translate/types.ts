// Shapes of the classic dashboard JSON (Config API v1 /api/config/v1/dashboards/{id}, or the classic UI's
// "Edit JSON" / export) and of the translation result. Only the fields the translator reads are typed.

export type ClassicBounds = { top: number; left: number; width: number; height: number };
export type ClassicMz = { id?: string; name?: string } | null;

export type ClassicDEQuery = {
  id?: string;
  metric?: string;
  spaceAggregation?: string;
  timeAggregation?: string;
  splitBy?: string[];
  sortBy?: string;
  sortByDimension?: string;
  limit?: number;
  filterBy?: ClassicFilterBy;
  rate?: string;
  enabled?: boolean;
  metricSelector?: string;
  foldTransformation?: string;
  generatedMetricSelector?: string;
};
export type ClassicFilterBy = {
  filterOperator?: string; // AND | OR
  nestedFilters?: ClassicFilterBy[];
  criteria?: { value: string; evaluator: string }[];
  filter?: string; // dimension key
  filterType?: string; // DIMENSION | ID | NAME | TAG | ENTITY_ATTRIBUTE
  entityAttribute?: string;
  relationship?: unknown;
};

export type ClassicSeries = {
  metric: string;
  aggregation?: string; // AVG | SUM | MIN | MAX | COUNT | PERCENTILE | NONE
  percentile?: number | null;
  type?: string; // LINE | AREA | BAR
  entityType?: string;
  dimensions?: { id?: string; name?: string; values?: string[]; entityDimension?: boolean }[];
  sortAscending?: boolean;
  sortColumn?: boolean;
  aggregationRate?: string;
};

export type ClassicTile = {
  name?: string;
  tileType: string;
  configured?: boolean;
  bounds?: ClassicBounds;
  tileFilter?: { timeframe?: string | null; managementZone?: ClassicMz };
  customName?: string;
  // MARKDOWN
  markdown?: string;
  // DATA_EXPLORER
  queries?: ClassicDEQuery[];
  visualConfig?: { type?: string; global?: unknown; rules?: unknown[] };
  metricExpressions?: string[];
  // DTAQL (USQL)
  query?: string;
  type?: string; // TABLE | COLUMN_CHART | PIE_CHART | SINGLE_VALUE | LINE_CHART | FUNNEL
  // CUSTOM_CHARTING
  filterConfig?: {
    type?: string;
    customName?: string;
    defaultName?: string;
    chartConfig?: { type?: string; series?: ClassicSeries[]; legendShown?: boolean; resultMetadata?: unknown };
    filtersPerEntityType?: Record<string, Record<string, string[]>>;
  };
  // SLO / entity tiles
  assignedEntities?: string[];
  // IMAGE
  image?: string;
  [k: string]: unknown;
};

export type ClassicDashboard = {
  id?: string;
  dashboardMetadata: {
    name: string;
    owner?: string;
    shared?: boolean;
    tags?: string[];
    dashboardFilter?: { timeframe?: string | null; managementZone?: ClassicMz } | null;
  };
  tiles: ClassicTile[];
};

/** exact: same semantics; approximate: runs, but semantics may differ (see notes); manual: placeholder only. */
export type Confidence = "exact" | "approximate" | "manual";
export type SourceLanguage = "metric selector" | "custom chart" | "USQL" | "log query" | "markdown" | "built-in tile" | "none";

export type Layout = { x: number; y: number; w: number; h: number };

export type TranslatedTile = {
  /** Stable key (index in the classic tiles array). */
  key: string;
  title: string;
  classicType: string;
  sourceLanguage: SourceLanguage;
  /** The classic query text the translation is based on (metric selector, USQL, log query, ...). */
  source: string;
  kind: "data" | "markdown";
  dql?: string;
  markdown?: string;
  /** Gen3 visualization id (lineChart, table, singleValue, ...). */
  visualization?: string;
  confidence: Confidence;
  notes: string[];
  layout: Layout;
  /** Grail metric keys the DQL reads (checked against the tenant's metrics). */
  metricKeys: string[];
  /** Classic metric keys that were mapped heuristically (not in the known table). */
  guessedKeys: string[];
  /** Per-tile timeframe override, as DQL-ish relative expression (e.g. "now()-7d"). */
  timeframe?: { from: string; to: string };
};

export type MigrationResult = {
  name: string;
  classicId?: string;
  tiles: TranslatedTile[];
  dashboardNotes: string[];
  defaultTimeframe?: { from: string; to: string };
};
