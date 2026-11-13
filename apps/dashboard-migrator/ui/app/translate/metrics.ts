// Classic (builtin:) metric keys -> Grail metric keys. Keys marked in the table were checked against a demo tenant's
// metric catalog (`metrics | filter in(metric.key, ...)`); anything else is mapped heuristically and flagged, and the
// Translate tab checks every resulting key against the tenant before it is trusted.

export type Agg = "avg" | "sum" | "min" | "max" | "count" | "percentile";

export type MetricMapping = {
  key: string;
  /** Default space aggregation when the selector says :auto or nothing. */
  agg: Agg;
  /** Main entity dimension of the metric (for management-zone filters and entity names). */
  entity?: string;
  note?: string;
  /** Derived metrics: DQL expression over named series, e.g. error rate = failures / requests. */
  derived?: { series: Record<string, { key: string; agg: Agg }>; expr: string };
};

const host = (key: string, agg: Agg = "avg"): MetricMapping => ({ key, agg, entity: "dt.entity.host" });
const svc = (key: string, agg: Agg, note?: string): MetricMapping => ({ key, agg, entity: "dt.entity.service", note });
const proc = (key: string, agg: Agg = "avg"): MetricMapping => ({ key, agg, entity: "dt.entity.process_group_instance" });
const K8S_NOTE = "Kubernetes metrics in Grail are split by k8s.* fields (k8s.cluster.name, k8s.namespace.name, k8s.workload.name) instead of classic dt.entity.cloud_application* dimensions.";

export const METRIC_MAP: Record<string, MetricMapping> = {
  "builtin:host.cpu.usage": host("dt.host.cpu.usage"),
  "builtin:host.cpu.user": host("dt.host.cpu.user"),
  "builtin:host.cpu.system": host("dt.host.cpu.system"),
  "builtin:host.cpu.idle": host("dt.host.cpu.idle"),
  "builtin:host.cpu.iowait": host("dt.host.cpu.iowait"),
  "builtin:host.cpu.steal": host("dt.host.cpu.steal"),
  "builtin:host.cpu.load": host("dt.host.cpu.load"),
  "builtin:host.cpu.load5m": host("dt.host.cpu.load5m"),
  "builtin:host.cpu.load15m": host("dt.host.cpu.load15m"),
  "builtin:host.mem.usage": host("dt.host.memory.usage"),
  "builtin:host.mem.avail.bytes": host("dt.host.memory.avail.bytes"),
  "builtin:host.mem.avail.pct": host("dt.host.memory.avail.percent"),
  "builtin:host.mem.used": host("dt.host.memory.used"),
  "builtin:host.disk.usedPct": host("dt.host.disk.used.percent"),
  "builtin:host.disk.avail": host("dt.host.disk.avail"),
  "builtin:host.disk.free": host("dt.host.disk.free"),
  "builtin:host.disk.used": host("dt.host.disk.used"),
  "builtin:host.disk.readTime": host("dt.host.disk.read_time"),
  "builtin:host.disk.writeTime": host("dt.host.disk.write_time"),
  "builtin:host.disk.bytesRead": host("dt.host.disk.bytes_read"),
  "builtin:host.disk.bytesWritten": host("dt.host.disk.bytes_written"),
  "builtin:host.disk.queueLength": host("dt.host.disk.queue_length"),
  "builtin:host.net.nic.bytesRx": host("dt.host.net.nic.bytes_rx"),
  "builtin:host.net.nic.bytesTx": host("dt.host.net.nic.bytes_tx"),
  "builtin:host.net.nic.packets.rx": host("dt.host.net.nic.packets.rx"),
  "builtin:host.availability": host("dt.host.availability"),

  "builtin:service.response.time": svc("dt.service.request.response_time", "avg"),
  "builtin:service.response.server": svc("dt.service.request.response_time", "avg", "Grail has one response time metric; classic server-side response time maps to dt.service.request.response_time."),
  "builtin:service.requestCount.total": svc("dt.service.request.count", "sum"),
  "builtin:service.requestCount.server": svc("dt.service.request.count", "sum", "Classic server-side request count maps to the total request count in Grail."),
  "builtin:service.errors.total.count": svc("dt.service.request.failure_count", "sum"),
  "builtin:service.errors.server.count": svc("dt.service.request.failure_count", "sum", "Classic server-side error count maps to dt.service.request.failure_count (all failures)."),
  "builtin:service.errors.fivexx.count": svc("dt.service.request.failure_count", "sum", "No 5xx-only metric: filter spans on http.response.status_code >= 500 for an exact count."),
  "builtin:service.errors.total.rate": {
    key: "dt.service.request.failure_count",
    agg: "avg",
    entity: "dt.entity.service",
    derived: { series: { failures: { key: "dt.service.request.failure_count", agg: "sum" }, requests: { key: "dt.service.request.count", agg: "sum" } }, expr: "failures[] / requests[] * 100" },
  },
  "builtin:service.errors.server.rate": {
    key: "dt.service.request.failure_count",
    agg: "avg",
    entity: "dt.entity.service",
    note: "Classic server-side failure rate maps to all failures / all requests.",
    derived: { series: { failures: { key: "dt.service.request.failure_count", agg: "sum" }, requests: { key: "dt.service.request.count", agg: "sum" } }, expr: "failures[] / requests[] * 100" },
  },

  "builtin:tech.generic.cpu.usage": proc("dt.process.cpu.usage"),
  "builtin:tech.generic.mem.workingSetSize": proc("dt.process.memory.working_set_size"),
  "builtin:tech.generic.mem.usage": proc("dt.process.memory.usage"),
  "builtin:tech.jvm.memory.gc.suspensionTime": proc("dt.runtime.jvm.gc.suspension_time"),

  "builtin:kubernetes.workload.pods": { key: "dt.kubernetes.pods", agg: "sum", note: K8S_NOTE },
  "builtin:kubernetes.pods": { key: "dt.kubernetes.pods", agg: "sum", note: K8S_NOTE },
  "builtin:kubernetes.container.restarts": { key: "dt.kubernetes.container.restarts", agg: "sum", note: K8S_NOTE },
  "builtin:kubernetes.node.cpu_allocatable": { key: "dt.kubernetes.node.cpu_allocatable", agg: "sum", note: K8S_NOTE },
  "builtin:kubernetes.workload.cpu_usage": { key: "dt.kubernetes.container.cpu_usage", agg: "sum", note: K8S_NOTE },
  "builtin:kubernetes.workload.memory_working_set": { key: "dt.kubernetes.container.memory_working_set", agg: "sum", note: K8S_NOTE },

  "builtin:synthetic.browser.availability": { key: "dt.synthetic.browser.availability", agg: "avg" },
  "builtin:synthetic.browser.availability.location.total": { key: "dt.synthetic.browser.availability", agg: "avg" },
  "builtin:synthetic.http.availability": { key: "dt.synthetic.http.availability", agg: "avg" },
  "builtin:synthetic.http.availability.location.total": { key: "dt.synthetic.http.availability", agg: "avg" },

  "builtin:apps.web.activeSessions": { key: "dt.frontend.session.active.estimated_count", agg: "sum", note: "Classic RUM web application metrics map to new RUM frontend metrics; split by frontend.name or dt.rum.application.entity." },
};

const camelToSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Maps a classic metric key; `guessed` when the key is not in METRIC_MAP. `unsupported` for metrics with no Grail form. */
export function mapMetricKey(classic: string): { mapping: MetricMapping; guessed: boolean; unsupported?: string } {
  const known = METRIC_MAP[classic];
  if (known) return { mapping: known, guessed: false };

  if (classic.startsWith("calc:")) {
    return {
      mapping: { key: classic, agg: "avg" },
      guessed: true,
      unsupported: `${classic} is a calculated service metric; these are not stored in Grail. Rebuild it from spans (fetch spans | makeTimeseries ...) or as an OpenPipeline metric extraction.`,
    };
  }
  if (classic.startsWith("func:")) {
    return { mapping: { key: classic, agg: "avg" }, guessed: true, unsupported: `${classic} is a classic function metric (e.g. SLO); there is no Grail metric for it. Use an SLO tile for SLOs.` };
  }
  if (classic.startsWith("ext:")) return { mapping: { key: classic.slice(4), agg: "avg" }, guessed: true };
  if (!classic.startsWith("builtin:")) return { mapping: { key: classic, agg: "avg" }, guessed: false }; // custom / ingested / log metrics keep their key

  const rest = classic.slice("builtin:".length);
  const [ns, ...tail] = rest.split(".");
  const snake = tail.map(camelToSnake).join(".");
  let key: string;
  let entity: string | undefined;
  if (ns === "host") {
    key = `dt.host.${snake.replace(/^mem\./, "memory.")}`;
    entity = "dt.entity.host";
  } else if (ns === "service") {
    key = `dt.service.${snake}`;
    entity = "dt.entity.service";
  } else if (ns === "tech" && tail[0] === "generic") {
    key = `dt.process.${tail.slice(1).map(camelToSnake).join(".")}`;
    entity = "dt.entity.process_group_instance";
  } else if (ns === "tech") {
    key = `dt.runtime.${snake}`;
    entity = "dt.entity.process_group_instance";
  } else if (ns === "kubernetes" || ns === "containers") {
    key = `dt.kubernetes.${snake}`;
  } else {
    key = `dt.${camelToSnake(ns)}${snake ? `.${snake}` : ""}`;
  }
  const isCount = /count|requests|errors|bytes|restarts/i.test(classic);
  return { mapping: { key, agg: isCount ? "sum" : "avg", entity }, guessed: true };
}

/** dt.entity.process_group_instance -> PROCESS_GROUP_INSTANCE (classic entity selector type). */
export const entityTypeOfDim = (dim: string): string | null => (dim.startsWith("dt.entity.") ? dim.slice("dt.entity.".length).toUpperCase() : null);
