// Offline checks for the translator (ui/app/translate). Bundles it with esbuild, then:
//  1. translates the sample classic dashboard and prints every tile (or writes JSON with --out <file>),
//  2. runs selector / USQL cases with expected DQL fragments and exits 1 on a mismatch.
// Validate the printed DQL against a tenant with: dtctl query '<dql>' (see README).
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(tmpdir(), `dm-translate-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export * from "./ui/app/translate/tiles"; export * from "./ui/app/translate/metricSelector"; export * from "./ui/app/translate/usql"; export { SAMPLE_CLASSIC_DASHBOARD } from "./ui/app/translate/sample";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "error",
});
const T = await import(pathToFileURL(outfile).href);

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const result = T.translateDashboard(T.parseClassicDashboard(JSON.stringify(T.SAMPLE_CLASSIC_DASHBOARD)));
if (outIdx >= 0) {
  writeFileSync(args[outIdx + 1], JSON.stringify({ result, dashboard: T.buildGen3Dashboard(result, result.tiles, { addMigrationNotes: true }) }, null, 2));
} else if (!args.includes("--quiet")) {
  for (const t of result.tiles) {
    console.log(`\n### [${t.key}] ${t.classicType} "${t.title}" -> ${t.kind} ${t.visualization ?? ""} (${t.confidence}) @${JSON.stringify(t.layout)}`);
    if (t.source) console.log(`  source: ${t.source.split("\n").join("\n          ")}`);
    if (t.dql) console.log(`  ${t.dql.split("\n").join("\n  ")}`);
    if (t.markdown && t.kind === "markdown") console.log(`  md: ${t.markdown.slice(0, 120).replace(/\n/g, " ")}`);
    for (const n of t.notes) console.log(`  - ${n}`);
  }
  console.log("\nDashboard notes:", result.dashboardNotes);
}

// ---------------------------------------------------------------------------------------------------------------------
const ctx = () => ({ notes: [], confidence: "exact", metricKeys: new Set(), guessedKeys: new Set(), mz: null });
const cases = [
  ['builtin:host.cpu.usage:splitBy("dt.entity.host"):avg:sort(value(avg,descending)):limit(10)', "none", ["timeseries cpu_usage = avg(dt.host.cpu.usage), by: {dt.entity.host}", "| sort arrayAvg(cpu_usage) desc", "| limit 10", "entityName(dt.entity.host)"]],
  ['builtin:host.cpu.usage:filter(and(in("dt.entity.host",entitySelector("type(HOST),tag(~"env:prod~")")),ne("dt.entity.host","HOST-1"))):splitBy():max', "single", ['filter: (in(dt.entity.host, classicEntitySelector("type(HOST),tag(\\"env:prod\\")")) and dt.entity.host != "HOST-1")', "max(dt.host.cpu.usage)", "| fields cpu_usage"]],
  ["builtin:service.errors.total.rate:splitBy():avg", "single", ["failures = sum(dt.service.request.failure_count)", "requests = sum(dt.service.request.count)", "error_rate = (failures[] / requests[] * 100)"]],
  ['(builtin:service.errors.total.count:splitBy("dt.entity.service"):sum / builtin:service.requestCount.total:splitBy("dt.entity.service"):sum * 100):sort(value(avg,descending)):limit(5)', "perRow", ["value = request_failure_count[] / request_count[] * 100", "| fieldsAdd value = arrayAvg(value)", "| sort value desc", "| limit 5"]],
  ["builtin:service.response.time:splitBy():percentile(90):toUnit(MicroSecond,MilliSecond)", "none", ["percentile(dt.service.request.response_time, 90)", "* 0.001"]],
  ['builtin:host.disk.usedPct:filter(series(max,gt(80))):splitBy("dt.entity.host","dt.entity.disk"):max', "perRow", ["| filter arrayMax(disk_used_percent) > 80", "by: {dt.entity.host, dt.entity.disk}"]],
  ["builtin:service.requestCount.total:splitBy():sum:rate(1m):default(0):timeshift(-1d)", "none", ["sum(dt.service.request.count, rate: 1m, default: 0)", "shift: -1d"]],
];
let failed = 0;
for (const [sel, fold, expect] of cases) {
  let dql = "";
  try {
    dql = T.translateSelector(ctx(), sel, fold).dql;
  } catch (e) {
    dql = `ERROR ${e.message}`;
  }
  const miss = expect.filter((x) => !dql.includes(x));
  if (miss.length) {
    failed++;
    console.log(`\nFAIL selector ${sel}\n${dql}\n  missing: ${miss.join(" | ")}`);
  }
}
const usql = [
  ["SELECT country, COUNT(*) FROM usersession GROUP BY country", "TABLE", ["fetch user.sessions", "summarize {count = count()}, by: {geo.country.name}"]],
  ["SELECT AVG(duration) FROM usersession WHERE userType = 'REAL_USER' AND duration > 5000", "SINGLE_VALUE", ['dt.rum.user_type == "real_user"', "duration > 5000ms", "avg_duration = avg(duration)"]],
  ["SELECT name, COUNT(*) AS n FROM useraction WHERE application = 'shop' GROUP BY name ORDER BY n DESC LIMIT 5", "TABLE", ["fetch user.events", 'frontend.name == "shop"', "| sort n desc", "| limit 5"]],
  ["SELECT DATETIME(startTime, 'HH:mm', '5m'), COUNT(*) FROM usersession GROUP BY DATETIME(startTime, 'HH:mm', '5m')", "LINE_CHART", ["makeTimeseries {count = count()}, time: start_time, interval: 5m"]],
  ["SELECT COUNT(DISTINCT internalUserId) FROM usersession WHERE browserFamily IN ('Chrome', 'Firefox') AND city IS NOT NULL", "SINGLE_VALUE", ["countDistinct(dt.rum.instance.id)", 'in(browser.name, array("Chrome", "Firefox"))', "isNotNull(geo.city.name)"]],
  ["SELECT TOP(osFamily, 5), COUNT(*) FROM usersession GROUP BY osFamily", "PIE_CHART", ["by: {os.name}", "| sort count desc", "| limit 5"]],
];
for (const [q, type, expect] of usql) {
  const r = T.translateUsql(q, type);
  const miss = expect.filter((x) => !r.dql.includes(x));
  if (miss.length) {
    failed++;
    console.log(`\nFAIL usql ${q}\n${r.dql}\n  missing: ${miss.join(" | ")}`);
  }
}
const lq = T.translateLogQuery('status="ERROR" AND "connection refused"').dql;
if (!lq.includes('status == "ERROR" and matchesPhrase(content, "connection refused")')) {
  failed++;
  console.log(`\nFAIL log query\n${lq}`);
}
console.log(failed ? `\n${failed} case(s) failed` : `\nAll ${cases.length + usql.length + 1} translator cases passed`);
process.exit(failed ? 1 : 0);
