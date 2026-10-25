import type { DocLink } from "./remediation";
import type { Instance } from "./deepMonitoring";

// ---------------------------------------------------------------------------
// Deep monitoring technology catalogue. Supported versions, blockers and links
// come from the Dynatrace technology-support pages and vendor support policies
// in DOC below; every page was fetched on 2026-10-23. Re-check the ranges when
// OneAgent support changes (End-of-support news).
// ---------------------------------------------------------------------------

const d = (title: string, url: string): DocLink => ({ title, url });
const DT = "https://docs.dynatrace.com/docs";
const SCHEMA = `${DT}/dynatrace-api/environment-api/settings/schemas`;
const TECH = `${DT}/ingest-from/technology-support`;
const SDV2 = `${DT}/observe/application-observability/services/service-detection/service-detection-v2`;

/**
 * Docs sections watched for pages that are not cited yet (new how-to pages of fast-moving features). The docs-freshness
 * function and `npm run check-docs` list every sitemap page under these prefixes; pages missing from the snapshot are
 * reported as new.
 */
export const DOC_SECTIONS: { title: string; prefix: string }[] = [{ title: "Service Detection v2", prefix: SDV2 }];

export const DOC = {
  techSupport: d("Technology support", TECH),
  endOfSupport: d("End-of-support news", `${DT}/whats-new/technology/end-of-support-news`),
  deepMonitoring: d("Process deep monitoring", `${DT}/observe/infrastructure-observability/process-groups/configuration/pg-monitoring`),
  troubleshoot: d("Troubleshoot deep-monitoring issues", `${DT}/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-deep-monitoring-issues`),
  installTroubleshoot: d("Troubleshoot OneAgent installation", `${DT}/ingest-from/dynatrace-oneagent/oneagent-troubleshooting/troubleshoot-oneagent-installation`),
  health: d("OneAgent health", `${DT}/ingest-from/dynatrace-oneagent-classic/oneagent-health`),
  features: d("OneAgent features", `${DT}/ingest-from/dynatrace-oneagent/oneagent-features`),
  modes: d("OneAgent monitoring modes", `${DT}/platform/oneagent/monitoring-modes/monitoring-modes`),
  pgStateSchema: d("Schema: process group monitoring", `${SCHEMA}/builtin-process-group-monitoring-state`),
  hostPgStateSchema: d("Schema: process group monitoring on a host", `${SCHEMA}/builtin-host-process-groups-monitoring-state`),
  autoSchema: d("Schema: automatic deep monitoring", `${SCHEMA}/builtin-process-process-monitoring`),
  customRuleSchema: d("Schema: custom process monitoring rules", `${SCHEMA}/builtin-process-custom-process-monitoring-rule`),
  builtinRuleSchema: d("Schema: built-in process monitoring rules", `${SCHEMA}/builtin-process-built-in-process-monitoring-rule`),
  containerTechSchema: d("Schema: container monitoring", `${SCHEMA}/builtin-container-technology`),
  containerRuleSchema: d("Schema: container monitoring rules", `${SCHEMA}/builtin-container-monitoring-rule`),
  k8sAnnotate: d("Configure monitoring for namespaces and pods", `${DT}/ingest-from/setup-on-k8s/guides/deployment-and-configuration/monitoring-and-instrumentation/annotate`),
  k8sMutation: d("Pod mutations", `${DT}/ingest-from/setup-on-k8s/reference/workload-mutation`),
  k8sFullStack: d("Kubernetes full-stack observability", `${DT}/ingest-from/setup-on-k8s/how-it-works/cloud-native-fullstack`),
  k8sAppMon: d("Kubernetes application observability", `${DT}/ingest-from/setup-on-k8s/how-it-works/application-monitoring`),
  k8sTroubleshoot: d("Kubernetes troubleshooting", `${DT}/ingest-from/setup-on-k8s/deployment/troubleshooting`),
  // ActiveGates tab; fetched on 2026-10-24.
  agSfm: d("ActiveGate self-monitoring metrics", `${DT}/ingest-from/dynatrace-activegate/activegate-sfm-metrics`),
  agDiagnostics: d("ActiveGate diagnostics", `${DT}/ingest-from/dynatrace-activegate/activegate-diagnostics`),
  agctl: d("agctl - Command-line interface for ActiveGate", `${DT}/ingest-from/dynatrace-activegate/agctl-command-line-interface`),
  agDirectories: d("ActiveGate directories", `${DT}/ingest-from/dynatrace-activegate/configuration/where-can-i-find-activegate-files`),
  agConfig: d("Configuration properties and parameters of ActiveGate", `${DT}/ingest-from/dynatrace-activegate/configuration/configure-activegate`),
  agContainerConfig: d("Containerized ActiveGate configuration", `${DT}/ingest-from/dynatrace-activegate/activegate-in-container/configuration`),
  agCapabilities: d("ActiveGate purposes and functionality", `${DT}/ingest-from/dynatrace-activegate/capabilities`),
  agRestart: d("Stop or restart ActiveGate", `${DT}/ingest-from/dynatrace-activegate/operation/stop-restart-activegate`),
  agUpdate: d("Update ActiveGate", `${DT}/ingest-from/dynatrace-activegate/operation/update-activegate`),
  agSecurity: d("ActiveGate security (tokens)", `${DT}/ingest-from/dynatrace-activegate/activegate-security`),
  fleetManagement: d("Fleet Management", `${DT}/ingest-from/fleet-management`),
  agHealth: d("ActiveGate health overview", `${DT}/ingest-from/fleet-management/activegate-health-overview`),
  k8sComponentUpdates: d("Auto-update for Dynatrace Operator managed components", `${DT}/ingest-from/setup-on-k8s/guides/deployment-and-configuration/updates-and-maintenance/auto-update-components`),
  k8sAgSizing: d("Size Dynatrace ActiveGates in Kubernetes", `${DT}/ingest-from/setup-on-k8s/guides/deployment-and-configuration/resource-management/ag-resource-limits`),
  extConcepts: d("About Extensions", `${DT}/ingest-from/extensions/concepts`),
  extManage: d("Manage extensions", `${DT}/ingest-from/extensions/manage-extensions`),
  extHealth: d("Extensions health", `${DT}/observe/infrastructure-observability/extensions/extensions-health`),
  extStatusField: d("Semantic dictionary: dt.extension.status", `${DT}/semantic-dictionary/fields`),
  // Extensions tab; fetched on 2026-10-24 (fastcheck: the first check before any data is collected).
  extSnmpTroubleshoot: d("SNMP extensions troubleshooting (fastcheck)", `${DT}/ingest-from/extensions/develop-your-extensions/data-sources/snmp-extensions/troubleshooting`),
  snmpAutodiscovery: d("SNMP Autodiscovery extension", `${DT}/observe/infrastructure-observability/extensions/snmp-autodiscovery`),
  snmpGeneric: d("Generic network device extension", `${DT}/observe/infrastructure-observability/extensions/snmp-generic`),
  awsCloudWatch: d("Monitor AWS with CloudWatch metrics", `${DT}/ingest-from/amazon-web-services-classic/integrate-with-aws/cloudwatch-metrics`),
  awsLimitTags: d("Limit API calls to AWS using tags", `${DT}/ingest-from/amazon-web-services-classic/integrate-with-aws/cloudwatch-metrics/limit-api-calls-to-aws-using-tags`),
  bulkConfig: d("Remote configuration management (ActiveGate group, network zone)", `${DT}/ingest-from/bulk-configuration`),
  networkZones: d("Get started with network zones", `${DT}/manage/network-zones/network-zones-basic-info`),
  networkZoneConnectivity: d("OneAgent connectivity in network zones", `${DT}/manage/network-zones/oneagent-connectivity`),
  // Dynatrace Operator (Kubernetes tab); fetched on 2026-10-24.
  k8sMonitoringTroubleshoot: d("Kubernetes monitoring issues", `${DT}/ingest-from/setup-on-k8s/deployment/troubleshooting/monitoring-troubleshooting`),
  k8sDeployment: d("Kubernetes deployment options", `${DT}/ingest-from/setup-on-k8s/deployment`),
  k8sInstallFullStack: d("Install the Operator: full-stack observability", `${DT}/ingest-from/setup-on-k8s/deployment/full-stack-observability`),
  k8sInstallAppObs: d("Install the Operator: application observability", `${DT}/ingest-from/setup-on-k8s/deployment/application-observability`),
  k8sOperatorUpdate: d("Update or uninstall Dynatrace Operator", `${DT}/ingest-from/setup-on-k8s/guides/deployment-and-configuration/updates-and-maintenance/update-uninstall-operator`),
  k8sClassic: d("Classic full-stack monitoring", `${DT}/ingest-from/setup-on-k8s/how-it-works/other-deployment-modes/classic-fullstack`),
  k8sHostMonitoring: d("Kubernetes host monitoring", `${DT}/ingest-from/setup-on-k8s/how-it-works/other-deployment-modes/host-monitoring`),
  k8sMigration: d("Kubernetes migration guides", `${DT}/ingest-from/setup-on-k8s/guides/migration`),
  k8sClassicToCloudNative: d("Migrate classic full-stack to cloud-native full-stack", `${DT}/ingest-from/setup-on-k8s/guides/migration/classic-to-cloud-native`),
  dynakubeParams: d("DynaKube parameters", `${DT}/ingest-from/setup-on-k8s/reference/dynakube-parameters`),
  dynakubeFlags: d("DynaKube feature flags", `${DT}/ingest-from/setup-on-k8s/reference/dynakube-feature-flags`),
  k8sTelemetryIngest: d("Telemetry ingest endpoints (Dynatrace Collector)", `${DT}/ingest-from/setup-on-k8s/extend-observability-k8s/telemetry-ingest`),
  k8sOtlpAutoConfig: d("Automatic OTLP exporter configuration", `${DT}/ingest-from/setup-on-k8s/extend-observability-k8s/otlp-auto-config`),
  oneagentOtel: d("Use OneAgent with OpenTelemetry data", `${DT}/ingest-from/dynatrace-oneagent/oneagent-and-opentelemetry/oneagent-otel`),
  capabilityMatrix: d("OneAgent platform and capability support matrix", `${TECH}/oneagent-platform-and-capability-support-matrix`),
  otel: d("OpenTelemetry", `${DT}/ingest-from/opentelemetry`),
  otlp: d("OTLP API endpoints", `${DT}/ingest-from/opentelemetry/otlp-api`),
  java: d("Java", `${TECH}/application-software/java`),
  jvms: d("Support for JVMs", `${TECH}/application-software/java/support-for-jvms`),
  dotnet: d(".NET", `${TECH}/application-software/dotnet`),
  nodejs: d("Node.js", `${TECH}/application-software/nodejs`),
  go: d("Go", `${TECH}/application-software/go`),
  goLimits: d("Go known limitations", `${TECH}/application-software/go/support/go-known-limitations`),
  goVersions: d("Supported Go versions", `${TECH}/application-software/go/support/supported-go-versions`),
  goEnable: d("Enable Go monitoring", `${TECH}/application-software/go/configuration-and-analysis/enable-go-monitoring`),
  php: d("PHP", `${TECH}/application-software/php`),
  phpVersions: d("PHP supported versions", `${TECH}/application-software/php/php-supported-versions`),
  phpFullStack: d("Full-stack PHP monitoring", `${TECH}/application-software/php/full-stack-monitoring`),
  python: d("Python", `${TECH}/application-software/python`),
  nginx: d("NGINX", `${TECH}/application-software/nginx`),
  nginxRuntime: d("NGINX runtime instrumentation", `${TECH}/application-software/nginx/manual-runtime-instrumentation`),
  ruby: d("Ruby", `${TECH}/application-software/ruby`),
  erlang: d("Erlang/Elixir", `${TECH}/application-software/erlang-elixir`),
  rubyOtel: d("Ruby with OpenTelemetry", `${DT}/ingest-from/opentelemetry/walkthroughs/ruby`),
  erlangOtel: d("Erlang with OpenTelemetry", `${DT}/ingest-from/opentelemetry/walkthroughs/erlang`),
  envoyOtel: d("Envoy OpenTelemetry tracing", `${DT}/ingest-from/opentelemetry/integrations/envoy`),
  mainframe: d("Mainframe technology support", `${TECH}/mainframe-technology-support`),
  cics: d("Install the CICS module", `${DT}/ingest-from/dynatrace-oneagent/installation-and-operation/zos/installation/install-cics`),
  databases: d("Databases", `${DT}/observe/infrastructure-observability/databases`),
  mssql: d("SQL Server extension", `${DT}/observe/infrastructure-observability/databases/extensions/microsoft-sql-server-2`),
  postgres: d("PostgreSQL extension", `${DT}/observe/infrastructure-observability/databases/extensions/postgresdb-remote-monitoring`),
  mysql: d("MySQL extension", `${DT}/observe/infrastructure-observability/databases/extensions/mysql-remote-monitoring-v2`),
  mongodb: d("MongoDB extension", `${DT}/observe/infrastructure-observability/databases/extensions/mongodb-local-or-remote-monitoring`),
  redis: d("Redis extension", `${DT}/observe/infrastructure-observability/extensions/redis-20`),
  haproxy: d("HAProxy extension", `${DT}/observe/infrastructure-observability/extensions/haproxy-1`),
  // Databases tab (database extensions); fetched on 2026-10-24, together with databases, mssql, postgres, mysql, mongodb, redis above.
  dbGetStarted: d("Get started with Databases", `${DT}/observe/infrastructure-observability/databases/get-started`),
  mssqlDataSource: d("Microsoft SQL Server data source (endpoints, authentication, SSL)", `${DT}/ingest-from/extensions/develop-your-extensions/data-sources/sql/microsoft-sql-monitoring`),
  mssqlLocal: d("Microsoft SQL Server (local) extension", `${DT}/observe/infrastructure-observability/databases/extensions/microsoft-sql-server-local`),
  oracle: d("Oracle Database extension", `${DT}/observe/infrastructure-observability/databases/extensions/oracle-database`),
  hana: d("SAP HANA Database (remote monitoring) extension", `${DT}/observe/infrastructure-observability/databases/extensions/sap-hana-database-remote-monitoring`),
  db2: d("IBM DB2 for LUW (remote monitoring) extension", `${DT}/observe/infrastructure-observability/databases/extensions/ibm-db2-for-luw-remote-monitoring`),
  mariadb: d("MariaDB extension", `${DT}/observe/infrastructure-observability/databases/extensions/mariadb-1`),
  agGroup: d("ActiveGate group", `${DT}/ingest-from/dynatrace-activegate/activegate-group`),
  credentialVault: d("Credential vault", `${DT}/manage/credential-vault`),
  haproxyProm: d("HAProxy (Prometheus) extension", `${DT}/observe/infrastructure-observability/extensions/haproxy-prometheus`),
  mtJava: d("Schema: monitor Java", `${SCHEMA}/builtin-monitored-technologies-java`),
  mtGo: d("Schema: monitor Go", `${SCHEMA}/builtin-monitored-technologies-go`),
  mtPython: d("Schema: monitor Python", `${SCHEMA}/builtin-monitored-technologies-python`),
  mtNode: d("Schema: monitor Node.js", `${SCHEMA}/builtin-monitored-technologies-nodejs`),
  mtPhp: d("Schema: monitor PHP", `${SCHEMA}/builtin-monitored-technologies-php`),
  mtDotnet: d("Schema: monitor .NET", `${SCHEMA}/builtin-monitored-technologies-dotnet`),
  mtIis: d("Schema: monitor IIS", `${SCHEMA}/builtin-monitored-technologies-iis`),
  mtApache: d("Schema: monitor Apache", `${SCHEMA}/builtin-monitored-technologies-apache`),
  mtNginx: d("Schema: monitor NGINX", `${SCHEMA}/builtin-monitored-technologies-nginx`),
  // Service Detection v2 tab (sdv2.ts); every page fetched on 2026-10-24. SDv2 changes often, so its docs section is
  // also watched for new pages (DOC_SECTIONS).
  serviceDetection: d("Service detection", `${DT}/observe/application-observability/services/service-detection`),
  sdv2: d("Service Detection v2", SDV2),
  sdv2Rules: d("Customize service detection in SDv2", `${SDV2}/service-detection-v2`),
  sdv2OneAgent: d("Configure service detection for OneAgent in SDv2", `${SDV2}/configure-sdv2-for-oneagent`),
  sdv2Endpoints: d("Customize endpoint detection in SDv2", `${SDV2}/endpoint-detection-v2`),
  sdv2Failures: d("Customize failure detection in SDv2", `${SDV2}/failure-detection-v2`),
  sdv2Splitting: d("Customize service splitting in SDv2", `${SDV2}/service-splitting-v2`),
  sdv2UrlPatterns: d("Configure URL path pattern matching in SDv2", `${SDV2}/url-pattern-matching-v2`),
  serviceNaming: d("Service naming", `${DT}/observe/application-observability/services/service-naming`),
  namingUpgrade: d("Upgrade from service naming rules to service naming", `${DT}/platform/upgrade/preserve-metrics-and-service-visibility/upgrade-guide-service-naming`),
  sdv2Schema: d("Schema: Service Detection v2 for OneAgent", `${SCHEMA}/builtin-service-detection-v2-for-oneagent`),
  sdRulesSchema: d("Schema: Service detection", `${SCHEMA}/builtin-service-detection-rules`),
  splittingSchema: d("Schema: Service splitting", `${SCHEMA}/builtin-service-splitting-rules`),
  // Vendor support policies.
  vTemurin: d("Eclipse Temurin support", "https://adoptium.net/support/"),
  vDotnet: d(".NET support policy (Microsoft)", "https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core"),
  vNode: d("Node.js releases", "https://nodejs.org/en/about/previous-releases"),
  vGo: d("Go release policy", "https://go.dev/doc/devel/release"),
  vPhp: d("PHP supported versions (php.net)", "https://www.php.net/supported-versions.php"),
  vPython: d("Python versions (python.org)", "https://devguide.python.org/versions/"),
} satisfies Record<string, DocLink>;

/** Docs for the mechanism behind each fix. */
export const DEEP_DOCS = {
  deepMonitoring: DOC.deepMonitoring,
  troubleshoot: DOC.troubleshoot,
  restart: DOC.troubleshoot,
  pgMonitoring: DOC.pgStateSchema,
  hostPgMonitoring: DOC.hostPgStateSchema,
  processMonitoring: DOC.autoSchema,
  customRules: DOC.customRuleSchema,
  builtinRules: DOC.builtinRuleSchema,
  containers: DOC.containerTechSchema,
  containerRules: DOC.containerRuleSchema,
  monitoringModes: DOC.modes,
  health: DOC.health,
  features: DOC.features,
  techSupport: DOC.techSupport,
  endOfSupport: DOC.endOfSupport,
  installTroubleshoot: DOC.installTroubleshoot,
  goEnable: DOC.goEnable,
  k8sAnnotate: DOC.k8sAnnotate,
  k8sMutation: DOC.k8sMutation,
  k8sFullStack: DOC.k8sFullStack,
  k8sAppMon: DOC.k8sAppMon,
  k8sTroubleshoot: DOC.k8sTroubleshoot,
  otel: DOC.otel,
  otlp: DOC.otlp,
} satisfies Record<string, DocLink>;

// --- Versions ------------------------------------------------------------------

/** Numeric segments of a version: "11.0.5" -> [11, 0, 5], "go1.22.5" -> [1, 22, 5], "CTS 56" -> [5, 6]. */
export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const cts = /^CTS\s*(\d)(\d)$/i.exec(v.trim());
  if (cts) return [Number(cts[1]), Number(cts[2])];
  const m = v.match(/\d+(?:[._]\d+)*/);
  if (!m) return null;
  return m[0].split(/[._]/).map(Number);
}

/** Compares dotted versions ("1.347.64.20261021-162634" style included). Missing segments count as 0. */
export function compareVersions(a: string | number[], b: string | number[]): number {
  const x = typeof a === "string" ? (parseVersion(a) ?? []) : a;
  const y = typeof b === "string" ? (parseVersion(b) ?? []) : b;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Inclusive range check on the leading segments ([8] matches 8.x, [1, 24] matches 1.24.x). */
const within = (v: number[], from: number[], to: number[]) =>
  compareVersions(v.slice(0, from.length), from) >= 0 && compareVersions(v.slice(0, to.length), to) <= 0;

export type SupportState = "supported" | "ending" | "limited" | "unsupported" | "unknown";
export type SupportStatus = { state: SupportState; text: string; minAgent?: string };
type SupportCtx = { version: number[] | null; raw: string | null; edition?: string | null; musl: boolean; os?: string };
const status = (state: SupportState, text: string, minAgent?: string): SupportStatus => ({ state, text, minAgent });

// --- Catalogue -----------------------------------------------------------------

export type TechKind = "deep" | "none" | "dynatrace";
/** Monitored technologies switch (Settings > Monitoring > Monitored technologies), scope HOST / environment. */
export type MonitoredSwitch = { schema: string; prop: string; label: string; defaults: Record<string, boolean>; doc: DocLink };
export type AlternativeKind = "otel" | "extension" | "system";
export type TechInfo = {
  key: string;
  label: string;
  kind: TechKind;
  /** softwareTechnologies types to read the runtime version from, in order. */
  versionTypes: string[];
  /** Fallback version field when no softwareTechnologies entry has one. */
  fallback: "jvm" | "app" | null;
  monitored?: MonitoredSwitch;
  /** Set when the technology is only deep monitored if a rule (or the process group setting) includes it. */
  needsRule?: string;
  support?: (c: SupportCtx) => SupportStatus;
  docs: DocLink[];
  external: DocLink[];
  /** Known blockers, shown with the upgrade and restart steps. */
  notes?: string[];
  /** Kind "none": what to use instead. */
  alternative?: string;
  alternativeKind?: AlternativeKind;
  /** CICS is instrumented by the CICS module, not by automatic injection. */
  cics?: boolean;
};

const sw = (tech: string, prop: string, label: string, defaults: Record<string, boolean>, doc: DocLink): MonitoredSwitch => ({
  schema: `builtin:monitored-technologies.${tech}`,
  prop,
  label,
  defaults,
  doc,
});
// Property names and defaults read from the tenant with `dtctl get settings-schema builtin:monitored-technologies.<tech>`.
const SW = {
  java: sw("java", "enabled", "Monitor Java", { enabled: true }, DOC.mtJava),
  go: sw("go", "enabled", "Monitor Go", { enabled: true, enabledGoStaticMonitoring: false }, DOC.mtGo),
  python: sw("python", "enabled", "Monitor Python", { enabled: false }, DOC.mtPython),
  nodejs: sw("nodejs", "enabled", "Monitor Node.js", { enabled: true }, DOC.mtNode),
  php: sw("php", "enabled", "Monitor PHP", { enabled: true, enabledFastCGI: false, enablePhpCliServerInstrumentation: false }, DOC.mtPhp),
  dotnet: sw("dotnet", "enabled", "Monitor .NET", { enabled: true, enabledDotNetCore: true }, DOC.mtDotnet),
  iis: sw("iis", "enabled", "Monitor IIS", { enabled: true }, DOC.mtIis),
  apache: sw("apache", "enabled", "Monitor Apache HTTP Server", { enabled: true }, DOC.mtApache),
  nginx: sw("nginx", "enabled", "Monitor Nginx", { enabled: true }, DOC.mtNginx),
};
/** "Enable Go static application monitoring" on the Go switch (off by default). */
export const GO_STATIC: MonitoredSwitch = { ...SW.go, prop: "enabledGoStaticMonitoring", label: "Enable Go static application monitoring", doc: DOC.goEnable };
/** "Enable .NET Core" on the .NET switch. */
export const DOTNET_CORE: MonitoredSwitch = { ...SW.dotnet, prop: "enabledDotNetCore", label: "Enable .NET Core" };
export const MONITORED_SCHEMAS = [...new Set(Object.values(SW).map((s) => s.schema))];

const JAVA_TEXT =
  "OneAgent supports Java 6–8, 11, 17, 21 and 24–27 (Oracle HotSpot / OpenJDK; Temurin, Corretto and Liberica from 8). Java 9, 10, 12–16, 18–20, 22 and 23 are not supported; Java 22 was dropped with OneAgent 1.335.";
function javaSupport(c: SupportCtx): SupportStatus {
  if (!c.version) return status("unknown", `Java version not reported. ${JAVA_TEXT}`);
  const major = c.version[0] === 1 && c.version.length > 1 ? c.version[1] : c.version[0]; // 1.8.0_292 -> 8
  if (major === 26 && c.musl) return status("unsupported", "Java 26 on Alpine (musl) is not supported by OneAgent.");
  if (/jrockit|hitachi|fujitsu|huawei/i.test(c.edition ?? "")) return status("unsupported", `${c.edition} JVMs reached end of OneAgent support on 2026-09-30.`);
  if ([6, 7, 8, 11, 17, 21, 24, 25, 27].includes(major)) return status("supported", `Java ${major} is supported.`);
  if (major === 26) return status("supported", "Java 26 is supported; it reached vendor end of availability in September 2026 (Temurin), so plan the move to Java 25 (LTS) or 27.");
  if (major > 27) return status("unknown", `Java ${major} is newer than the supported list. ${JAVA_TEXT}`);
  return status("unsupported", `Java ${major} is not supported. ${JAVA_TEXT}`);
}

function dotnetSupport(c: SupportCtx): SupportStatus {
  const v = c.version;
  if (!v) return status("unknown", ".NET version not reported. Supported: .NET 8–10, .NET Framework 3.5 SP1 and 4.6.2–4.8.");
  if (/framework/i.test(c.edition ?? "")) {
    if (v[0] === 3 && v[1] === 5) return status("supported", ".NET Framework 3.5 SP1 is supported (Windows only).");
    if (within(v, [4, 6, 2], [4, 8])) return status("supported", `.NET Framework ${v.slice(0, 2).join(".")} is supported (Windows only).`);
    if (within(v, [4, 5, 2], [4, 6, 1])) return status("unsupported", ".NET Framework 4.5.2–4.6.1 reached end of OneAgent support on 2026-07-31 (last OneAgent 1.343). Move to 4.8.");
    if (v[0] === 4) return status("limited", ".NET Framework 4, 4.5 and 4.5.1 have limited support. Move to 4.8.");
    return status("unsupported", `.NET Framework ${v.join(".")} is not supported.`);
  }
  const major = v[0];
  if (major === 1) return status("unsupported", ".NET Core 1.x is not supported.");
  if (major === 2 || (major === 3 && v[1] === 0)) return status("unsupported", ".NET Core 2.1, 2.2 and 3.0 reached end of OneAgent support on 2026-07-31 (last OneAgent 1.343). Move to .NET 10 (LTS).");
  if ((major === 3 && v[1] === 1) || (major >= 5 && major <= 7)) {
    return status("ending", `OneAgent support for .NET ${major === 3 ? "Core 3.1" : major} ends 2026-12-31 (last OneAgent 1.353), and Microsoft no longer supports it. Move to .NET 10 (LTS).`);
  }
  if (major === 8 || major === 9) {
    const min = major === 8 ? "1.277" : "1.305";
    return status("supported", `.NET ${major} is supported (OneAgent ${min}+). Microsoft support ends 2026-11-10, so plan the move to .NET 10 (LTS).`, min);
  }
  if (major === 10) return status("supported", ".NET 10 (LTS) is supported with OneAgent 1.325+. Single-file apps on Linux need 10.0.9 or later.", "1.325");
  return status("unknown", `.NET ${major} is newer than the supported list (.NET 5–10).`);
}

type Range = { from: number[]; to: number[]; text?: string; minAgent?: string };
function rangeSupport(name: string, ranges: Range[], summary: string) {
  return (c: SupportCtx): SupportStatus => {
    if (!c.version) return status("unknown", `${name} version not reported. ${summary}`);
    for (const r of ranges) if (within(c.version, r.from, r.to)) return status("supported", r.text ?? `${name} ${c.raw} is supported.`, r.minAgent);
    const top = ranges.reduce((m, r) => (compareVersions(r.to, m) > 0 ? r.to : m), [0]);
    if (compareVersions(c.version.slice(0, top.length), top) > 0) return status("unknown", `${name} ${c.raw} is newer than the supported list. ${summary}`);
    return status("unsupported", `${name} ${c.raw} is not supported. ${summary}`);
  };
}

const NODE_TEXT = "Supported: Node.js 20, 22, 24, 25 and 26 (official builds); limited: 12, 14, 16 and 18; 8–11 and odd releases below 25 are not supported.";
function nodeSupport(c: SupportCtx): SupportStatus {
  if (!c.version) return status("unknown", `Node.js version not reported. ${NODE_TEXT}`);
  const m = c.version[0];
  if (m === 25) return status("ending", "OneAgent supports Node.js 25 until 2026-12-31, and it is already end-of-life upstream. Move to Node.js 24 (LTS).");
  if (m === 20) return status("ending", "OneAgent supports Node.js 20 until 2027-04-30, and it is end-of-life upstream. Move to Node.js 24 (LTS).");
  if ([22, 24, 26].includes(m)) return status("supported", `Node.js ${m} is supported.`);
  if ([12, 14, 16, 18].includes(m)) return status("limited", `Node.js ${m} has limited support. Move to Node.js 24 (LTS).`);
  if (m > 26) return status("unknown", `Node.js ${m} is newer than the supported list. ${NODE_TEXT}`);
  return status("unsupported", `Node.js ${m} is not supported. ${NODE_TEXT}`);
}

const SYSTEM = "System process group: Dynatrace collects OS processes here without a code module. No action is needed.";
const OTEL = "OneAgent has no code module for it; instrument it with OpenTelemetry and send OTLP to Dynatrace.";
const EXTENSION =
  "OneAgent does not deep monitor database or proxy servers. Calls to them are traced from the deep-monitored applications; monitor the server itself with its Dynatrace extension.";

const JAVA: Omit<TechInfo, "key" | "label"> = {
  kind: "deep",
  versionTypes: ["JAVA"],
  fallback: "jvm",
  monitored: SW.java,
  support: javaSupport,
  docs: [DOC.java, DOC.jvms],
  external: [DOC.vTemurin],
  notes: [
    "SAP Introscope and OneAgent on the same JVM are not supported.",
    "Tomcat 10 and 11 need the OneAgent feature “Java Servlet 5.0” (then restart).",
    "Supported app servers: Tomcat 6–11, WebSphere 8.5–9.0 and Liberty, JBoss EAP 7–8, WildFly 8–41, WebLogic 11g–15.1.1.",
  ],
};
const DOTNET: Omit<TechInfo, "key" | "label"> = {
  kind: "deep",
  versionTypes: ["DOTNET"],
  fallback: null,
  monitored: SW.dotnet,
  needsRule:
    ".NET processes are only deep monitored automatically in containers, IIS (w3wp.exe) and ASP.NET Core; standalone .NET services and console apps need a Monitor rule or the process group set to Monitor.",
  support: dotnetSupport,
  docs: [DOC.dotnet],
  external: [DOC.vDotnet],
  notes: [
    "Trimmed self-contained apps need OneAgent 1.337+ and the Dynatrace.OneAgent.Trimming NuGet package.",
    "Single-file apps need OneAgent 1.343+ and the “Instrument .NET Single-File Self-Contained applications” and “Advanced .NET Instrumentation Mode” features.",
  ],
};

const none = (label: string, alternative: string, alternativeKind: AlternativeKind, docs: DocLink[], versionTypes: string[] = []): Omit<TechInfo, "key"> => ({
  label,
  kind: "none",
  versionTypes,
  fallback: null,
  docs,
  external: [],
  alternative,
  alternativeKind,
});

const CATALOGUE: Record<string, Omit<TechInfo, "key">> = {
  JAVA: { label: "Java", ...JAVA },
  TOMCAT: { label: "Tomcat", ...JAVA },
  JBOSS: { label: "JBoss / WildFly", ...JAVA },
  WEBLOGIC: { label: "WebLogic", ...JAVA },
  WEBSPHERE: { label: "WebSphere", ...JAVA },
  GLASSFISH: { label: "GlassFish", ...JAVA },
  DOTNET: { label: ".NET", ...DOTNET },
  IIS_APP_POOL: { label: "IIS app pool (.NET)", ...DOTNET, needsRule: undefined },
  IIS: {
    label: "IIS",
    kind: "deep",
    versionTypes: ["IIS", "IIS_APP_POOL"],
    fallback: "app",
    monitored: SW.iis,
    support: rangeSupport("IIS", [{ from: [7, 5], to: [7, 5] }, { from: [8], to: [8, 5] }, { from: [10], to: [10, 0] }], "Supported: IIS 7.5, 8.0, 8.5 and 10.0 (Windows x86-64); IIS 7.0 is no longer supported."),
    docs: [DOC.techSupport],
    external: [],
  },
  // Split out by the queries (TECH_EXPR): processType IIS on svchost.exe / inetinfo.exe.
  IIS_SERVICE_HOST: none(
    "IIS service hosts",
    "These are svchost.exe / inetinfo.exe processes that host the IIS services (for example WAS and the IIS Admin service); they serve no requests. OneAgent instruments IIS in the w3wp.exe worker processes (built-in rule -4), which appear as IIS app pool process groups: check those instead. No action is needed here.",
    "system",
    [DOC.techSupport, DOC.builtinRuleSchema],
  ),
  NODE_JS: {
    label: "Node.js",
    kind: "deep",
    versionTypes: ["NODE_JS"],
    fallback: "app",
    monitored: SW.nodejs,
    support: nodeSupport,
    docs: [DOC.nodejs],
    external: [DOC.vNode],
    notes: [
      "webpack-bundled modules cannot be instrumented (externalize them); an ESM main script needs OneAgent 1.219+ with agent preloading.",
      "Tool processes (npm, yarn, pm2, corepack, node-gyp, gulp) are skipped by built-in rules on purpose.",
    ],
  },
  GO: {
    label: "Go",
    kind: "deep",
    versionTypes: ["GO"],
    fallback: null,
    monitored: SW.go,
    needsRule:
      "Go processes are only deep monitored automatically in containers (Kubernetes, Docker, Cloud Foundry) and for a few known binaries; other Go applications need a Monitor rule or the process group set to Monitor.",
    support: rangeSupport("Go", [{ from: [1, 24], to: [1, 27] }], "Supported: the official Go toolchain 1.24–1.27 (the last two major releases plus at least 6 months), 64-bit only."),
    docs: [DOC.go, DOC.goVersions, DOC.goLimits, DOC.goEnable],
    external: [DOC.vGo],
    notes: [
      "Statically linked binaries (CGO_ENABLED=0) are skipped by built-in rule -47 unless “Enable Go static application monitoring” is on and a Monitor rule covers the binary.",
      "Not supported: gccgo, -linkshared, -race, -buildmode=plugin and vendored packages; avoid strip, -ldflags=-s and go run.",
      "-buildmode=pie with CGO_ENABLED=0: drop pie or add -linkmode=external. musl binaries need -linkmode=external; scratch images need a base image with a C library.",
    ],
  },
  PHP: {
    label: "PHP",
    kind: "deep",
    versionTypes: ["PHP"],
    fallback: "app",
    monitored: SW.php,
    support: rangeSupport(
      "PHP",
      [{ from: [7, 1], to: [8, 4] }, { from: [8, 5], to: [8, 5], minAgent: "1.329", text: "PHP 8.5 is supported with OneAgent 1.329+." }],
      "Supported: PHP 7.1–8.5 (Linux mod_php, FastCGI and FPM; Windows mod_php and CGI). php.net only supports 8.2–8.5.",
    ),
    docs: [DOC.php, DOC.phpVersions, DOC.phpFullStack],
    external: [DOC.vPhp],
    notes: [
      "PHP CLI scripts are skipped by built-in rule -1 (and php-cgi by -2): monitor a CLI script with a custom Monitor rule (PHP script or working directory), then restart. CLI monitoring does not support threading or forking.",
      "mod_php needs a full Apache stop and start.",
    ],
  },
  PYTHON: {
    label: "Python",
    kind: "deep",
    versionTypes: ["PYTHON"],
    fallback: "app",
    monitored: SW.python,
    needsRule: "Python is not deep monitored by default: turn on “Monitor Python” and add a Monitor rule (or set the process group to Monitor).",
    support: (c) => {
      if (c.raw && /\dt$/i.test(c.raw.trim())) return status("unsupported", "Free-threaded (“t”) Python builds are not supported.");
      return rangeSupport(
        "Python",
        [{ from: [3, 8], to: [3, 13] }, { from: [3, 14], to: [3, 14], minAgent: "1.329", text: "Python 3.14 is supported with OneAgent 1.329+." }],
        "Supported: CPython 3.8–3.14 on Linux and Alpine (x86-64 / ARM64); 3.15 (released 2026-10-09) is not listed yet.",
      )(c);
    },
    docs: [DOC.python],
    external: [DOC.vPython],
    notes: [
      "Only CPython started as python, python3 or python3.x; embedded interpreters and gevent below 20.9.0 are not supported.",
      "Tool processes (pip, conda, jupyter, ansible, the aws / az / gcloud CLIs, supervisord) are skipped by built-in rules.",
    ],
  },
  APACHE_HTTPD: {
    label: "Apache HTTP Server",
    kind: "deep",
    versionTypes: ["APACHE_HTTP_SERVER"],
    fallback: "app",
    monitored: SW.apache,
    support: rangeSupport("Apache HTTP Server", [{ from: [2, 0], to: [2, 0] }, { from: [2, 2], to: [2, 2] }, { from: [2, 4], to: [2, 4] }], "Supported: Apache HTTP Server 2.0, 2.2 and 2.4 (also IBM HTTP Server 7–9)."),
    docs: [DOC.techSupport, DOC.installTroubleshoot],
    external: [],
    notes: ["apachectl restart / graceful is not enough: stop Apache completely, then start it.", "With SELinux: setsebool -P httpd_can_network_connect on, then restart."],
  },
  NGINX: {
    label: "NGINX",
    kind: "deep",
    versionTypes: ["NGINX"],
    fallback: "app",
    monitored: SW.nginx,
    support: (c) =>
      c.os?.toUpperCase() === "WINDOWS"
        ? status("unsupported", "NGINX on Windows is not supported.")
        : rangeSupport("NGINX", [{ from: [1, 11, 5], to: [1, 31] }], "Supported: NGINX 1.11.5–1.31.x, NGINX Plus R11–R36, OpenResty, Tengine and Kong. Custom builds need debug info or runtime instrumentation.")(c),
    docs: [DOC.nginx, DOC.nginxRuntime],
    external: [],
    notes: ["Patched builds (for example Kong): set DT_NGINX_FORCE_RUNTIME_INSTRUMENTATION=on and restart (10 s+ startup delay, more memory)."],
  },
  IBM_CICS_REGION: {
    label: "IBM CICS",
    kind: "deep",
    versionTypes: ["IBM_CICS_REGION"],
    fallback: null,
    support: rangeSupport("CICS TS", [{ from: [5, 1], to: [5, 6] }, { from: [6, 1], to: [6, 3] }], "Supported: CICS TS 5.1–5.6 and 6.1–6.3 on z/OS 2.3–3.2."),
    docs: [DOC.mainframe, DOC.cics],
    external: [],
    cics: true,
  },
  APMNG: { label: "Dynatrace components", kind: "dynatrace", versionTypes: [], fallback: null, docs: [], external: [] },
  LINUX_SYSTEM: none("Linux system", SYSTEM, "system", [DOC.techSupport]),
  WINDOWS_SYSTEM: none("Windows system", SYSTEM, "system", [DOC.techSupport]),
  RUBY: none("Ruby", `Ruby: ${OTEL}`, "otel", [DOC.ruby, DOC.rubyOtel, DOC.otlp], ["RUBY"]),
  ERLANG: none("Erlang / Elixir", `Erlang / Elixir: ${OTEL}`, "otel", [DOC.erlang, DOC.erlangOtel, DOC.otlp], ["ERLANG"]),
  ENVOY: none(
    "Envoy",
    "OneAgent support for Envoy 1.29 and earlier ended on 2026-02-28. Trace Envoy 1.30+ with its OpenTelemetry tracer (disable the OneAgent Envoy module first).",
    "otel",
    [DOC.envoyOtel, DOC.otlp],
    ["ENVOY"],
  ),
  MSSQL: none("SQL Server", EXTENSION, "extension", [DOC.databases, DOC.mssql]),
  MYSQL: none("MySQL", EXTENSION, "extension", [DOC.databases, DOC.mysql]),
  POSTGRES: none("PostgreSQL", EXTENSION, "extension", [DOC.databases, DOC.postgres]),
  MONGODB: none("MongoDB", EXTENSION, "extension", [DOC.databases, DOC.mongodb]),
  REDIS: none("Redis", EXTENSION, "extension", [DOC.redis]),
  HAPROXY: none("HAProxy", EXTENSION, "extension", [DOC.haproxy, DOC.haproxyProm]),
  OTHER: none(
    "Other / unclassified",
    "OneAgent did not classify a technology for these processes (for example browsers, CLI tools or unsupported runtimes), so there is no code module to inject. Instrument important ones with OpenTelemetry.",
    "otel",
    [DOC.techSupport, DOC.otel, DOC.otlp],
  ),
};

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Catalogue entry for a classic processType (null = unclassified). Unknown types are scored, with unknown support. */
export function techInfo(processType: string | null): TechInfo {
  const key = processType ?? "OTHER";
  const hit = CATALOGUE[key];
  if (hit) return { key, ...hit };
  return { key, label: titleCase(key), kind: "deep", versionTypes: [key], fallback: "app", docs: [DOC.techSupport], external: [] };
}

export function supportStatus(i: Pick<Instance, "processType" | "version" | "edition" | "musl" | "osType">): SupportStatus {
  const info = techInfo(i.processType);
  if (!info.support) return status("unknown", "See the technology support page for supported versions.");
  return info.support({ version: parseVersion(i.version), raw: i.version, edition: i.edition, musl: i.musl, os: i.osType });
}

// --- Built-in process monitoring rules ---------------------------------------
// Generated from the tenant's builtin:process.built-in-process-monitoring-rule schema (rule id = property key, all on
// by default; order = evaluation order). Items use process metadata key names, so the custom-rule matcher evaluates them.
export type BuiltinRule = [id: number, mode: "ON" | "OFF", item: string, operator: string, value: string];
export const BUILTIN_RULES: BuiltinRule[] = [
  [-1, "OFF", "PHP_SCRIPT_PATH", "EXISTS", ""],
  [-2, "OFF", "EXE_NAME", "EQUALS", "php-cgi"],
  [-3, "ON", "ASP_NET_CORE_APPLICATION_PATH", "EXISTS", ""],
  [-4, "ON", "EXE_NAME", "EQUALS", "w3wp.exe"],
  [-5, "ON", "EXE_NAME", "EQUALS", "caddy"],
  [-6, "ON", "EXE_NAME", "EQUALS", "influxd"],
  [-7, "ON", "EXE_NAME", "EQUALS", "adapter"],
  [-8, "ON", "EXE_NAME", "EQUALS", "auctioneer"],
  [-9, "ON", "EXE_NAME", "EQUALS", "bbs"],
  [-10, "ON", "EXE_NAME", "EQUALS", "cc-uploader"],
  [-11, "ON", "EXE_NAME", "EQUALS", "doppler"],
  [-12, "ON", "EXE_NAME", "EQUALS", "gorouter"],
  [-13, "ON", "EXE_NAME", "EQUALS", "locket"],
  [-14, "ON", "EXE_NAME", "EQUALS", "metron"],
  [-16, "ON", "EXE_NAME", "EQUALS", "rep"],
  [-17, "ON", "EXE_NAME", "EQUALS", "route-emitter"],
  [-18, "ON", "EXE_NAME", "EQUALS", "route-registrar"],
  [-19, "ON", "EXE_NAME", "EQUALS", "routing-api"],
  [-20, "ON", "EXE_NAME", "EQUALS", "scheduler"],
  [-21, "ON", "EXE_NAME", "EQUALS", "silk-daemon"],
  [-22, "ON", "EXE_NAME", "EQUALS", "switchboard"],
  [-23, "ON", "EXE_NAME", "EQUALS", "syslog_drain_binder"],
  [-24, "ON", "EXE_NAME", "EQUALS", "tps-watcher"],
  [-25, "ON", "EXE_NAME", "EQUALS", "trafficcontroller"],
  [-26, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/prebuild-install"],
  [-27, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/npm"],
  [-28, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/grunt"],
  [-29, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/typescript"],
  [-32, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/node-pre-gyp"],
  [-33, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/node-gyp"],
  [-34, "OFF", "NODE_JS_APP_BASE_DIRECTORY", "ENDS", "/node_modules/gulp-cli"],
  [-35, "OFF", "NODE_JS_SCRIPT_NAME", "EQUALS", "bin/pm2"],
  [-36, "OFF", "CLOUD_FOUNDRY_APP_NAME", "STARTS", "apps-manager-js"],
  [-37, "ON", "CLOUD_FOUNDRY_APP_NAME", "EXISTS", ""],
  [-38, "OFF", "KUBERNETES_CONTAINER_NAME", "EQUALS", "POD"],
  [-39, "OFF", "CONTAINER_IMAGE_NAME", "CONTAINS", "pause-amd64"],
  [-40, "ON", "KUBERNETES_NAMESPACE", "EXISTS", ""],
  [-41, "ON", "CONTAINER_NAME", "EXISTS", ""],
  [-43, "OFF", "EXE_PATH", "STARTS", "/tmp/buildpacks/"],
  [-44, "OFF", "EXE_NAME", "EQUALS", "oc"],
  [-45, "OFF", "NODE_JS_APP_NAME", "EQUALS", "yarn"],
  [-46, "OFF", "EXE_PATH", "EQUALS", "/opt/cni/bin/host-local"],
  [-47, "OFF", "GO_BINARY_LINKAGE", "EQUALS", "static"],
  [-48, "OFF", "EXE_NAME", "STARTS", "mqsi"],
  [-49, "OFF", "EXE_NAME", "EQUALS", "filebeat"],
  [-50, "OFF", "EXE_NAME", "EQUALS", "metricbeat"],
  [-51, "OFF", "EXE_NAME", "EQUALS", "packetbeat"],
  [-52, "OFF", "EXE_NAME", "EQUALS", "auditbeat"],
  [-53, "OFF", "EXE_NAME", "EQUALS", "heartbeat"],
  [-54, "OFF", "EXE_NAME", "EQUALS", "functionbeat"],
  [-55, "OFF", "EXE_NAME", "EQUALS", "grootfs"],
  [-56, "OFF", "EXE_NAME", "EQUALS", "tardis"],
  [-57, "OFF", "JAVA_JAR_FILE", "STARTS", "org.eclipse.equinox.launcher"],
  [-58, "OFF", "EXE_NAME", "EQUALS", "calico-node"],
  [-59, "OFF", "EXE_NAME", "EQUALS", "casclient.exe"],
  [-60, "OFF", "JAVA_JAR_FILE", "EQUALS", "dynatrace_ibm_mq_connector.jar"],
  [-61, "OFF", "EXE_NAME", "CONTAINS", "Agent.Worker"],
  [-62, "OFF", "DOTNET_COMMAND", "CONTAINS", "Agent.Worker"],
  [-63, "OFF", "EXE_NAME", "CONTAINS", "Agent.Listener"],
  [-64, "OFF", "DOTNET_COMMAND", "CONTAINS", "Agent.Listener"],
  [-65, "OFF", "EXE_NAME", "EQUALS", "FlexNetJobExecutorService"],
  [-66, "OFF", "EXE_NAME", "EQUALS", "FlexNetMaintenanceRemotingService"],
  [-67, "OFF", "EXE_PATH", "EQUALS", "/usr/bin/piper"],
  [-68, "OFF", "NODE_JS_APP_NAME", "EQUALS", "corepack"],
  [-69, "OFF", "KUBERNETES_CONTAINER_NAME", "EQUALS", "cassandra-operator"],
  [-70, "OFF", "EXE_NAME", "CONTAINS", "UiPath"],
  [-71, "OFF", "EXE_NAME", "EQUALS", "openhandlecollector.exe"],
  [-72, "OFF", "EXE_NAME", "EQUALS", "yq"],
  [-73, "OFF", "PYTHON_SCRIPT", "EQUALS", "pip"],
  [-74, "OFF", "PYTHON_SCRIPT", "EQUALS", "hatch"],
  [-75, "OFF", "PYTHON_SCRIPT", "EQUALS", "wheel"],
  [-76, "OFF", "PYTHON_SCRIPT", "EQUALS", "yum"],
  [-77, "OFF", "PYTHON_SCRIPT", "EQUALS", "jupyter"],
  [-78, "OFF", "PYTHON_SCRIPT", "EQUALS", "conda"],
  [-79, "OFF", "PYTHON_SCRIPT", "EQUALS", "ansible"],
  [-80, "OFF", "PYTHON_SCRIPT", "EQUALS", "openstack"],
  [-81, "OFF", "PYTHON_SCRIPT", "EQUALS", "aws"],
  [-82, "OFF", "PYTHON_SCRIPT", "EQUALS", "az"],
  [-83, "OFF", "PYTHON_SCRIPT", "EQUALS", "gcloud"],
  [-84, "OFF", "COMMAND_LINE_ARGS", "CONTAINS", "forever/bin/monitor"],
  [-85, "OFF", "JAVA_MAIN_CLASS", "CONTAINS", "ActiveGateCommandLineTool"],
  [-86, "OFF", "PYTHON_SCRIPT", "CONTAINS", "supervisord"],
];
