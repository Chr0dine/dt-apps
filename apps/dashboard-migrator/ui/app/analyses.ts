// AI Assist analyses per tab (rule-based, local; same contract as the golden app's analyze* functions).
import type { AIInsightsData, InsightItem, RecommendationItem } from "./components/AIInsights";
import type { SourceInfo, Verification } from "./MigrationContext";
import type { TranslatedTile } from "./translate/types";

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

export function analyzeImport(source: SourceInfo | null, tokenSet: boolean | null): AIInsightsData {
  if (!source) {
    const recommendations: RecommendationItem[] = [
      { impact: "high", text: "Open the classic dashboard, select Edit, open the Settings tab, select Configure more > Dashboard JSON (or call GET /api/config/v1/dashboards/{id}), copy or download the JSON and paste it here." },
      { impact: "medium", text: "Use Load sample to see how each classic tile type is translated before migrating your own dashboards." },
    ];
    if (tokenSet === false) recommendations.push({ impact: "low", text: "Ask an admin to store a ReadConfig API token so classic dashboards can be listed and loaded straight from this environment." });
    return {
      summary: "No classic dashboard loaded yet. Paste its JSON, upload an exported file, or pick one from this environment to start the migration.",
      insights: [{ severity: "info", icon: "ℹ️", text: "Classic dashboards are only exposed by the classic Config API, so loading them from the environment needs a ReadConfig API token; pasting JSON needs nothing." }],
      recommendations,
    };
  }
  const tiles = source.dashboard.tiles ?? [];
  const byType = new Map<string, number>();
  tiles.forEach((t) => byType.set(t.tileType, (byType.get(t.tileType) ?? 0) + 1));
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const queryTiles = tiles.filter((t) => ["DATA_EXPLORER", "CUSTOM_CHARTING", "DTAQL", "LOG_ANALYTICS"].includes(t.tileType)).length;
  const insights: InsightItem[] = [
    { severity: "info", icon: "📋", text: `${plural(tiles.length, "tile")} across ${plural(byType.size, "tile type")}: ${top.slice(0, 4).map(([k, v]) => `${v} ${k}`).join(", ")}.` },
    { severity: queryTiles ? "good" : "warning", icon: queryTiles ? "✅" : "⚠️", text: `${plural(queryTiles, "tile")} carry classic queries (metric selector, custom chart, USQL or log) that translate to DQL.` },
  ];
  const usql = byType.get("DTAQL") ?? 0;
  if (usql) insights.push({ severity: "warning", icon: "🧭", text: `${plural(usql, "USQL tile")} will read new RUM data (user.sessions / user.events); they only show data for frontends monitored with new RUM.` });
  const mz = source.dashboard.dashboardMetadata.dashboardFilter?.managementZone;
  if (mz?.name || mz?.id) insights.push({ severity: "warning", icon: "🗂️", text: `The dashboard is scoped to management zone "${mz.name ?? mz.id}"; it is carried over with classicEntitySelector(mzName(...)) until you replace it with a segment.` });
  return {
    summary: `"${source.dashboard.dashboardMetadata.name}" (${source.label}) is loaded with ${plural(tiles.length, "tile")}. Open the Translate tab to review each tile's DQL.`,
    insights,
    recommendations: [
      { impact: "high", text: "Review the Translate tab: run Verify all to check every query and metric key against this environment." },
      { impact: "medium", text: "Tiles marked Manual (SLO, calculated metrics, unsupported tile types) become placeholders; plan how to rebuild them." },
    ],
  };
}

export function analyzeTranslate(tiles: TranslatedTile[], verification: Record<string, Verification>, included: (t: TranslatedTile) => boolean): AIInsightsData {
  if (!tiles.length) {
    return { summary: "Nothing to translate yet. Load a classic dashboard in the Import tab.", insights: [], recommendations: [{ impact: "high", text: "Load a classic dashboard (or the sample) in the Import tab." }] };
  }
  const c = { exact: 0, approximate: 0, manual: 0 };
  tiles.forEach((t) => c[t.confidence]++);
  const data = tiles.filter((t) => t.kind === "data");
  const verified = data.filter((t) => verification[t.key]?.state === "done");
  const invalid = data.filter((t) => {
    const v = verification[t.key];
    return (v?.state === "done" && !v.valid) || v?.state === "error";
  });
  const missing = data.filter((t) => {
    const v = verification[t.key];
    return v?.state === "done" && v.missingKeys.length > 0;
  });
  const guessed = [...new Set(tiles.flatMap((t) => t.guessedKeys))];
  const excluded = tiles.filter((t) => !included(t)).length;

  const insights: InsightItem[] = [
    { severity: c.manual ? "warning" : "good", icon: "📊", text: `${c.exact} exact, ${c.approximate} approximate and ${c.manual} manual tiles out of ${tiles.length}.` },
  ];
  if (verified.length < data.length) insights.push({ severity: "info", icon: "🔎", text: `${data.length - verified.length} of ${plural(data.length, "query")} have not been verified against this environment yet.` });
  if (invalid.length) insights.push({ severity: "critical", icon: "🚨", text: `${plural(invalid.length, "query")} failed verification: ${invalid.slice(0, 3).map((t) => `"${t.title}"`).join(", ")}${invalid.length > 3 ? "…" : ""}.` });
  if (missing.length) insights.push({ severity: "warning", icon: "🧩", text: `${plural(missing.length, "tile")} read metric keys this environment does not have (no data, or a different key): ${[...new Set(missing.flatMap((t) => (verification[t.key] as { missingKeys: string[] }).missingKeys))].slice(0, 4).join(", ")}.` });
  if (guessed.length) insights.push({ severity: "warning", icon: "🧪", text: `${plural(guessed.length, "classic metric key")} were mapped heuristically (${guessed.slice(0, 3).join(", ")}${guessed.length > 3 ? "…" : ""}).` });
  if (verified.length === data.length && data.length && !invalid.length && !missing.length) insights.push({ severity: "good", icon: "✅", text: "Every query is valid DQL and every metric key exists in this environment." });
  if (excluded) insights.push({ severity: "info", icon: "🙈", text: `${plural(excluded, "tile")} are excluded from the new dashboard.` });

  const recommendations: RecommendationItem[] = [];
  if (verified.length < data.length) recommendations.push({ impact: "high", text: "Run Verify all before exporting, so broken queries are fixed here rather than on the new dashboard." });
  if (invalid.length) recommendations.push({ impact: "high", text: "Open the failing tiles, read the verification message and edit the DQL in place; edits are kept for the export." });
  if (missing.length || guessed.length) recommendations.push({ impact: "medium", text: "For missing or guessed metric keys, search the right key with metrics | filter contains(metric.key, \"...\") in a notebook and edit the tile." });
  if (c.approximate) recommendations.push({ impact: "medium", text: "Approximate tiles run, but read their notes: management zones, USQL field mappings and folded values can differ from classic." });
  if (c.manual) recommendations.push({ impact: "low", text: "Manual tiles become markdown placeholders; untick them if you would rather leave them out." });
  return {
    summary: `${plural(tiles.length, "tile")} translated: ${c.exact} exact, ${c.approximate} approximate, ${c.manual} need manual work. ${verified.length}/${data.length} queries verified${invalid.length ? `, ${invalid.length} invalid` : ""}${missing.length ? `, ${missing.length} reading unknown metrics` : ""}.`,
    insights,
    recommendations,
  };
}

export function analyzeExport(tiles: TranslatedTile[], included: (t: TranslatedTile) => boolean, verification: Record<string, Verification>, createdCount: number): AIInsightsData {
  const kept = tiles.filter(included);
  if (!kept.length) return { summary: "No tiles selected for export yet.", insights: [], recommendations: [{ impact: "high", text: "Load a classic dashboard and keep at least one tile in the Translate tab." }] };
  const data = kept.filter((t) => t.kind === "data");
  const failing = data.filter((t) => {
    const v = verification[t.key];
    return (v?.state === "done" && !v.valid) || v?.state === "error";
  });
  const unverified = data.filter((t) => verification[t.key]?.state !== "done");
  const manual = kept.filter((t) => t.confidence === "manual").length;
  const insights: InsightItem[] = [{ severity: "info", icon: "🧱", text: `${plural(kept.length, "tile")} will be created: ${data.length} query tiles and ${kept.length - data.length} markdown tiles.` }];
  if (failing.length) insights.push({ severity: "critical", icon: "🚨", text: `${plural(failing.length, "tile")} still fail verification and will show an error on the new dashboard.` });
  if (unverified.length) insights.push({ severity: "warning", icon: "🔎", text: `${plural(unverified.length, "query tile")} are not verified.` });
  if (manual) insights.push({ severity: "warning", icon: "✍️", text: `${plural(manual, "placeholder tile")} need manual rebuilding after the export.` });
  if (!failing.length && !unverified.length) insights.push({ severity: "good", icon: "✅", text: "All query tiles are verified." });
  if (createdCount) insights.push({ severity: "good", icon: "🎉", text: `${plural(createdCount, "dashboard")} created in this session.` });
  return {
    summary: `Ready to create a dashboard with ${plural(kept.length, "tile")}${failing.length ? `, but ${failing.length} still fail verification` : ""}. The new dashboard is private to you until you share it.`,
    insights,
    recommendations: [
      ...(failing.length || unverified.length ? [{ impact: "high" as const, text: "Go back to Translate and run Verify all; fix failing tiles before creating the dashboard." }] : []),
      { impact: "medium", text: "After creating it, open the dashboard and set its default timeframe and any segments that replace management zones." },
      { impact: "low", text: "Keep the classic dashboard until the new one has been reviewed by its owners, then retire it." },
    ],
  };
}
