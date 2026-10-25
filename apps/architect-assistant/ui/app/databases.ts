import { httpClient } from "@dynatrace-sdk/http-client";
import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { DB_MATCH, type DbTech } from "./queries";
import { DOC } from "./deepTech";
import { errorMessage, type DocLink, type ManualAction, type ManualVariant, type SubmitResult } from "./remediation";
import type { CheckStatus } from "./deepMonitoring";

// ---------------------------------------------------------------------------
// Databases tab model: which database extension covers which technology, the documented setup steps per extension,
// the rows of the database queries (queries.ts), and creating a monitoring configuration with the Extensions API
// (/platform/extensions/v2). Steps, grants and requirements come from the extension pages in DOC (deepTech.ts),
// fetched on 2026-10-24. Configuration payloads are built from the extension's own schema at runtime and mirror the
// configurations on the demo tenant (SQL Server 4.1.6, PostgreSQL 3.2.8, MySQL 3.1.2, Oracle 4.3.0, SAP HANA 3.1.2).
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? [str(v)] : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// --- Catalogue -------------------------------------------------------------------------------------------------------
export type DbTechInfo = {
  tech: DbTech;
  label: string;
  /** Dynatrace extension (extensionName in the Extensions API). */
  extension: string;
  /** Name of the extension in Dynatrace Hub and the Databases app. */
  hubName: string;
  /** Where the extension runs: an ActiveGate group (remote), the OneAgent on the database host (local), or either. */
  runs: "remote" | "local" | "both";
  defaultPort: number;
  /** Listen ports to prefer for the endpoint (SAP HANA: 3<instance>15 / 3<instance>13). */
  portHint?: RegExp;
  /** Remote SQL data source: this app can create the monitoring configuration (checked against the schema at runtime). */
  api: boolean;
  /** Prefilled database name (PostgreSQL connects to one database). */
  databaseName?: string;
  docs: DocLink[];
  /** Requirements besides the monitoring user. */
  notes: string[];
  /** Monitoring user (SQL / shell), one variant per hosting type. */
  user: ManualVariant[];
};

const REMOTE_NOTE = "Runs on an ActiveGate group: every ActiveGate in the group must be able to connect to the database.";
const ext = (tech: DbTech) => DB_MATCH.find((m) => m.tech === tech)!.extension;

const MSSQL_DB_STATE = "-- Query Store (per monitored database):\n-- USE <database>; CREATE USER dynatrace FOR LOGIN dynatrace; GRANT VIEW DATABASE STATE TO dynatrace;";

export const DB_TECHS: Record<DbTech, DbTechInfo> = {
  MSSQL: {
    tech: "MSSQL",
    label: "Microsoft SQL Server",
    extension: ext("MSSQL"),
    hubName: "Microsoft SQL Server",
    runs: "remote",
    defaultPort: 1433,
    api: true,
    docs: [DOC.mssql, DOC.mssqlDataSource, DOC.mssqlLocal, DOC.databases],
    notes: [
      REMOTE_NOTE,
      "Authentication: basic, NTLM or Kerberos (NTLM and Kerberos only for self-hosted, domain-joined servers), entered directly or from the credential vault.",
      "Any SQL Server version with active Microsoft extended support; top longest queries and Always On need 2016 or later. SQL Server on Linux and AWS RDS work but are not officially supported.",
      "SSL: publicly verifiable certificates need no truststore; otherwise add a PKCS12 truststore named sqlds_truststore to the ActiveGate userdata directory.",
      "Windows hosts with OneAgent can also use the Microsoft SQL Server (local) extension (WMI). It does not integrate with the Databases app; the remote extension also collects backups, jobs and Always On.",
    ],
    user: [
      {
        label: "Self-hosted, SQL Server 2022 and later",
        language: "sql",
        code: `-- Permissions the extension's views need (extension page). Add DB instance in the Databases app
-- generates the full script for your hosting type.
USE master;
CREATE LOGIN dynatrace WITH PASSWORD = '<password>';
GRANT VIEW SERVER PERFORMANCE STATE TO dynatrace;
GRANT VIEW SERVER SECURITY STATE TO dynatrace;  -- sys.dm_server_services
GRANT VIEW ANY DEFINITION TO dynatrace;         -- sys.master_files, availability groups
GRANT VIEW ANY DATABASE TO dynatrace;           -- sys.availability_databases_cluster
${MSSQL_DB_STATE}`,
      },
      {
        label: "Self-hosted, SQL Server 2019 and earlier / Azure SQL Managed Instance",
        language: "sql",
        code: `USE master;
CREATE LOGIN dynatrace WITH PASSWORD = '<password>';
GRANT VIEW SERVER STATE TO dynatrace;
GRANT VIEW ANY DEFINITION TO dynatrace;
GRANT VIEW ANY DATABASE TO dynatrace;
${MSSQL_DB_STATE}`,
      },
      {
        label: "Azure SQL Database",
        language: "sql",
        code: `-- In master:
CREATE LOGIN dynatrace WITH PASSWORD = '<password>';
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER dynatrace;
-- In the monitored database:
CREATE USER dynatrace FOR LOGIN dynatrace;
GRANT VIEW DATABASE STATE TO dynatrace;`,
      },
    ],
  },
  POSTGRES: {
    tech: "POSTGRES",
    label: "PostgreSQL",
    extension: ext("POSTGRES"),
    hubName: "PostgreSQL",
    runs: "remote",
    defaultPort: 5432,
    api: true,
    databaseName: "postgres",
    docs: [DOC.postgres, DOC.databases],
    notes: [
      `${REMOTE_NOTE} Connect to the host directly, not through a load balancer, proxy or connection pooler.`,
      "All currently maintained PostgreSQL versions. Database discovery, schema collection, execution plans and table / index monitoring need Dynatrace 1.338+ and extension major version 3.",
      "Cloud-managed PostgreSQL: set track_activity_query_size = 4096 (required) in the provider's parameter settings, and enable pg_stat_statements there.",
      "AWS RDS and Aurora can authenticate with IAM (the ActiveGate host's IAM role) instead of a password.",
      "Execution plans need the helper function dynatrace.dynatrace_execution_plan: copy it from the extension page, then run its validation script.",
      "Metrics appear in Databases 2–3 minutes after the configuration is saved.",
    ],
    user: [
      {
        label: "Self-hosted (password)",
        language: "sql",
        code: `CREATE USER dynatrace WITH PASSWORD '<password>' INHERIT;
GRANT pg_monitor TO dynatrace;
-- postgresql.conf, then restart the server:
--   shared_preload_libraries = 'pg_stat_statements'
-- In every monitored database:
CREATE SCHEMA IF NOT EXISTS dynatrace;
GRANT USAGE ON SCHEMA dynatrace TO dynatrace;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public;
ALTER USER dynatrace SET search_path to dynatrace, public;`,
      },
      {
        label: "AWS RDS / Aurora (IAM authentication)",
        language: "sql",
        code: `CREATE USER dynatrace WITH LOGIN;
GRANT rds_iam TO dynatrace;
GRANT pg_monitor TO dynatrace;
-- In every monitored database:
CREATE SCHEMA IF NOT EXISTS dynatrace;
GRANT USAGE ON SCHEMA dynatrace TO dynatrace;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public;
ALTER USER dynatrace SET search_path to dynatrace, public;`,
      },
    ],
  },
  MYSQL: {
    tech: "MYSQL",
    label: "MySQL",
    extension: ext("MYSQL"),
    hubName: "MySQL",
    runs: "remote",
    defaultPort: 3306,
    api: true,
    docs: [DOC.mysql, DOC.databases],
    notes: [
      REMOTE_NOTE,
      "MySQL 8.0 or later (8.0 is end of life: no execution plan visualization). MariaDB is not officially supported by this extension; use the MariaDB extension.",
      "MySQL 8.4+ users with caching_sha2_password need SSL for the monitoring connection (SSL port, server certificate in the ActiveGate truststore).",
      "Database size needs SELECT on each database to be sized. Optional performance_schema settings (CPU, memory, waits, top queries, execution plans) are on the extension page.",
      "Leave the database name empty to monitor all databases.",
    ],
    user: [
      {
        label: "MySQL 8.4 and later",
        language: "sql",
        code: `CREATE USER 'dynatrace'@'%' IDENTIFIED WITH caching_sha2_password BY '<password>';  -- needs SSL
GRANT SELECT ON performance_schema.* TO 'dynatrace'@'%';
GRANT PROCESS ON *.* TO 'dynatrace'@'%';
GRANT SHOW DATABASES ON *.* TO 'dynatrace'@'%';
GRANT SHOW VIEW ON *.* TO 'dynatrace'@'%';
GRANT REFERENCES ON *.* TO 'dynatrace'@'%';
GRANT SELECT ON mysql.slow_log TO 'dynatrace'@'%';
GRANT SELECT ON sys.x$memory_global_by_current_bytes TO 'dynatrace'@'%';
FLUSH PRIVILEGES;`,
      },
      {
        label: "MySQL 8.0 to 8.3",
        language: "sql",
        code: `CREATE USER 'dynatrace'@'%' IDENTIFIED WITH mysql_native_password BY '<password>';
GRANT SELECT ON performance_schema.* TO 'dynatrace'@'%';
GRANT PROCESS ON *.* TO 'dynatrace'@'%';
GRANT SHOW DATABASES ON *.* TO 'dynatrace'@'%';
GRANT SHOW VIEW ON *.* TO 'dynatrace'@'%';
GRANT REFERENCES ON *.* TO 'dynatrace'@'%';
GRANT SELECT ON mysql.slow_log TO 'dynatrace'@'%';
GRANT SELECT ON sys.x$memory_global_by_current_bytes TO 'dynatrace'@'%';
FLUSH PRIVILEGES;`,
      },
      {
        label: "AWS RDS (IAM authentication)",
        language: "sql",
        code: `-- After enabling IAM database authentication on the instance:
CREATE USER 'dynatrace'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
-- then the same GRANT statements as above.`,
      },
    ],
  },
  MARIADB: {
    tech: "MARIADB",
    label: "MariaDB",
    extension: ext("MARIADB"),
    hubName: "MariaDB",
    runs: "remote",
    defaultPort: 3306,
    api: false,
    docs: [DOC.mariadb, DOC.databases],
    notes: [
      `${REMOTE_NOTE} ActiveGate 1.295 or later.`,
      "Copy the platform-independent MariaDB JDBC connector (Java 8+) to the libs directory of every ActiveGate in the group (Linux /var/lib/dynatrace/remotepluginmodule/agent/conf/userdata/libs, Windows C:\\ProgramData\\dynatrace\\remotepluginmodule\\agent\\conf\\userdata\\libs); dtuserag needs read access.",
      "Set custom_code_jdbc_allowed=true in extensionsuser.conf, then restart the EEC service.",
      "Enable the performance schema on every monitored instance. global_status feature sets need MariaDB 10.5.2+, replicas 11.6+.",
      "The user must use a native password, or the connection fails with “RSA public key is not available client side”.",
    ],
    user: [
      {
        label: "MariaDB",
        language: "sql",
        code: `CREATE USER 'dynatrace'@'%' IDENTIFIED BY '<password>';
GRANT SELECT ON performance_schema.* TO 'dynatrace'@'%';
GRANT PROCESS ON *.* TO 'dynatrace'@'%';
GRANT SHOW DATABASES ON *.* TO 'dynatrace'@'%';
GRANT SELECT ON sys.x$memory_global_by_current_bytes TO 'dynatrace'@'%';
GRANT SLAVE MONITOR ON *.* TO 'dynatrace'@'%';
-- Database size: also GRANT SELECT on each database to be sized.`,
      },
    ],
  },
  ORACLE: {
    tech: "ORACLE",
    label: "Oracle Database",
    extension: ext("ORACLE"),
    hubName: "Oracle Database",
    runs: "remote",
    defaultPort: 1521,
    api: true,
    docs: [DOC.oracle, DOC.databases],
    notes: [
      REMOTE_NOTE,
      "Oracle Database 12.2+: standalone, Multitenant (CDB/PDB), RAC or AWS RDS. The configuration must accept the Oracle JDBC driver license (Dynatrace redistribution license).",
      "Connect with the service name (or the SID).",
      "On VMs and bare metal, OneAgent on the database host adds the system metrics.",
      "RAC (extension 3.9.2+): grant the resolve privilege with DBMS_NETWORK_ACL_ADMIN as on the extension page. The TopN feature set can expose sensitive data in query text.",
    ],
    user: [
      {
        label: "Non-CDB or PDB",
        language: "sql",
        code: `CREATE USER dynatrace IDENTIFIED BY "<password>";
GRANT CREATE SESSION TO dynatrace;
GRANT SELECT_CATALOG_ROLE TO dynatrace;  -- or SELECT on the V$ / GV$ / CDB_ views listed on the extension page
-- Execution plans: SELECT on V$SQL_PLAN, V$SESSION, V$SQL_PLAN_STATISTICS_ALL and V$SQL, and access to DBMS_XPLAN.`,
      },
      {
        label: "Multitenant (common user in the CDB root)",
        language: "sql",
        code: `-- Common users need the C## prefix.
CREATE USER C##DYNATRACE IDENTIFIED BY "<password>" CONTAINER=ALL;
GRANT CREATE SESSION TO C##DYNATRACE CONTAINER=ALL;
GRANT SELECT_CATALOG_ROLE TO C##DYNATRACE CONTAINER=ALL;
alter user C##DYNATRACE set container_data=all container = current;`,
      },
    ],
  },
  DB2: {
    tech: "DB2",
    label: "IBM Db2",
    extension: ext("DB2"),
    hubName: "IBM DB2",
    runs: "remote",
    defaultPort: 50000,
    api: true,
    docs: [DOC.db2, DOC.databases],
    notes: [
      REMOTE_NOTE,
      "Each endpoint needs host, port and database name.",
      "SSL needs ActiveGate 1.269 or later; point the endpoint at the SSL port.",
      "If the database uses the RESTRICTIVE option, the user also needs USAGE on an enabled workload.",
    ],
    user: [
      {
        label: "SQLADM authority",
        language: "sql",
        code: `-- Db2 authenticates operating-system users: create the OS user (for example dynatrace) first.
GRANT SQLADM ON DATABASE TO USER DYNATRACE;  -- or DATAACCESS / DBADM
GRANT SELECT ON SYSIBM.SYSDUMMY1 TO USER DYNATRACE;`,
      },
      {
        label: "Individual privileges",
        language: "sql",
        code: `GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_DATABASE TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_INSTANCE TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_TRANSACTION_LOG TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_TABLESPACE TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_CONNECTION TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_HADR TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.MON_GET_BUFFERPOOL TO USER DYNATRACE;
GRANT EXECUTE ON FUNCTION SYSPROC.ENV_GET_SYSTEM_RESOURCES TO USER DYNATRACE;
GRANT SELECT ON SYSIBMADM.ENV_INST_INFO TO USER DYNATRACE;
GRANT SELECT ON SYSIBMADM.MON_CURRENT_SQL TO USER DYNATRACE;
GRANT SELECT ON SYSIBM.SYSDUMMY1 TO USER DYNATRACE;`,
      },
    ],
  },
  HANA: {
    tech: "HANA",
    label: "SAP HANA",
    extension: ext("HANA"),
    hubName: "SAP HANA",
    runs: "remote",
    defaultPort: 30015,
    portHint: /^3\d\d1[35]$/,
    api: true,
    docs: [DOC.hana, DOC.databases],
    notes: [
      REMOTE_NOTE,
      "Put the SAP HANA JDBC driver (ngdbc.jar, for example ngdbc-2.14.7.jar from Maven or the SAP HANA Client) on every ActiveGate in the group: Linux /var/lib/dynatrace/remotepluginmodule/agent/conf/userdata/libs/, Windows C:\\ProgramData\\dynatrace\\remotepluginmodule\\agent\\conf\\userdata\\libs.",
      "The user needs the PUBLIC and MONITORING roles; the Audit Logs feature set also needs AUDIT READ.",
    ],
    user: [
      {
        label: "SAP HANA",
        language: "sql",
        code: `CREATE USER DYNATRACE PASSWORD "<Password1>" NO FORCE_FIRST_PASSWORD_CHANGE;
GRANT MONITORING TO DYNATRACE;  -- PUBLIC is granted to every user
GRANT AUDIT READ TO DYNATRACE;  -- only for the Audit Logs feature set`,
      },
    ],
  },
  MONGODB: {
    tech: "MONGODB",
    label: "MongoDB",
    extension: ext("MONGODB"),
    hubName: "MongoDB",
    runs: "both",
    defaultPort: 27017,
    api: false,
    docs: [DOC.mongodb],
    notes: [
      "Local: the OneAgent on the MongoDB server runs it. Remote: an ActiveGate group with network access to the server.",
      "Authentication: SCRAM-SHA-1 (MongoDB 3.6) or SCRAM-SHA-1 / SCRAM-SHA-256 (4.0+); set the authentication database (authSource) when the user is not in admin.",
      "CA and client certificate files must exist on every ActiveGate in the group (remote) or on the OneAgent host (local).",
      "Each connected process or port produces 17 + 5 × <number of databases> metric data points per minute.",
    ],
    user: [
      {
        label: "mongosh",
        language: "javascript",
        code: `use admin
db.createUser({ user: "dynatrace", pwd: "<password>", roles: [{ role: "clusterMonitor", db: "admin" }] })`,
      },
    ],
  },
  REDIS: {
    tech: "REDIS",
    label: "Redis",
    extension: ext("REDIS"),
    hubName: "Redis",
    runs: "local",
    defaultPort: 6379,
    api: false,
    docs: [DOC.redis],
    notes: [
      "Runs on the OneAgent of the Redis host and discovers every Redis instance on it. Redis Server 2.8+ on Linux; Docker images 5.0.0+.",
      "Redis must listen on localhost.",
      "Dockerized Redis: the extension user (dtuser by default) needs read and write access to /var/run/docker.sock (for example through the docker group).",
      "Give the password (and the config file location if commands are renamed) in the monitoring configuration; per-instance overrides are matched by listening port.",
      "Valkey servers (the Redis fork) are counted as Redis on this tab; the Redis extension page does not list Valkey, so check it before relying on the extension for them.",
    ],
    user: [],
  },
};

/** Catalogue entry for a technology key from the queries (unknown DB_INSTANCE suffixes get a generic entry). */
export function dbTechInfo(tech: string): DbTechInfo {
  const hit = DB_TECHS[tech as DbTech];
  if (hit) return hit;
  const label = tech.charAt(0) + tech.slice(1).toLowerCase();
  return { tech: tech as DbTech, label, extension: "", hubName: label, runs: "remote", defaultPort: 0, api: false, docs: [DOC.databases], notes: [], user: [] };
}

// --- Query rows -------------------------------------------------------------------------------------------------------
export type Category = "BOTH" | "EXTENSION_ONLY" | "ONEAGENT_ONLY";
export const CATEGORIES: { id: Category; label: string; slot: number; detail: string }[] = [
  { id: "BOTH", label: "Extension + OneAgent", slot: 1, detail: "A database extension monitors it and OneAgent sees its server process." },
  { id: "EXTENSION_ONLY", label: "Extension only", slot: 3, detail: "A database extension monitors it; OneAgent sees no server process (remote or managed database, or a host without OneAgent)." },
  { id: "ONEAGENT_ONLY", label: "OneAgent only", slot: 2, detail: "OneAgent sees the server process (CPU, memory, network), but no extension collects database insights (statements, waits, locks, sessions)." },
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[2];

export type Coverage = "EXTENSION" | "LOCAL_EXTENSION" | "ONEAGENT_ONLY";
export const COVERAGE_LABEL: Record<Coverage, string> = { EXTENSION: "Extension (DB instance)", LOCAL_EXTENSION: "Local extension on the host", ONEAGENT_ONLY: "OneAgent only" };

export type DbProcess = {
  id: string;
  sid: string;
  name: string;
  tech: string;
  coverage: Coverage;
  instanceIds: string[];
  instances: string[];
  matchedOn: string[];
  localExtension: string;
  pg: string;
  host: string;
  hostName: string;
  ipAddress: string[];
  monitoringMode: string;
  hostGroup: string;
  osType: string;
  listenPorts: string[];
  pod: string;
  namespace: string;
  workload: string;
  container: string;
  k8sClusterId: string;
  exe: string;
};

export function toDbProcess(r: Row): DbProcess {
  const coverage = str(r.coverage) as Coverage;
  return {
    id: str(r.id),
    sid: str(r.sid),
    name: str(r.name),
    tech: str(r.dbTech),
    coverage: COVERAGE_LABEL[coverage] ? coverage : "ONEAGENT_ONLY",
    instanceIds: strings(r.instanceIds),
    instances: strings(r.instances),
    matchedOn: strings(r.matchedOn),
    localExtension: str(r.localExtension),
    pg: str(r.pg),
    host: str(r.host),
    hostName: str(r.hostName),
    ipAddress: strings(r.ipAddress),
    monitoringMode: str(r.monitoringMode),
    hostGroup: str(r.hostGroup),
    osType: str(r.osType),
    listenPorts: strings(r.listenPorts),
    pod: str(r.pod),
    namespace: str(r.namespace),
    workload: str(r.workload),
    container: str(r.container),
    k8sClusterId: str(r.k8sClusterId),
    exe: str(r.exe),
  };
}

export type DbInstance = {
  id: string;
  name: string;
  tech: string;
  category: Category;
  version: string;
  endpointHost: string;
  endpointIp: string;
  port: string;
  serverName: string;
  k8sCluster: string;
  processIds: string[];
  processes: string[];
  matchedOn: string[];
  lastSeen: string;
};

export const toDbInstance = (r: Row): DbInstance => ({
  id: str(r.id),
  name: str(r.name),
  tech: str(r.dbTech),
  category: str(r.coverage) === "BOTH" ? "BOTH" : "EXTENSION_ONLY",
  version: str(r.version),
  endpointHost: str(r.endpointHost),
  endpointIp: str(r.endpointIp),
  port: str(r.port),
  serverName: str(r.serverName),
  k8sCluster: str(r.k8sCluster),
  processIds: strings(r.processIds),
  processes: strings(r.processes),
  matchedOn: strings(r.matchedOn),
  lastSeen: str(r.lastSeen),
});

/** Databases per technology and category (summary query). */
export type TechCounts = { tech: string; label: string; counts: Record<Category, number>; total: number };

export function toTechCounts(rows: Row[]): TechCounts[] {
  const by = new Map<string, TechCounts>();
  for (const r of rows) {
    const tech = str(r.dbTech);
    const cat = categoryOf(str(r.category)).id;
    const n = Number(r.databases) || 0;
    const t = by.get(tech) ?? { tech, label: dbTechInfo(tech).label, counts: { BOTH: 0, EXTENSION_ONLY: 0, ONEAGENT_ONLY: 0 }, total: 0 };
    t.counts[cat] += n;
    t.total += n;
    by.set(tech, t);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Latest status of a database extension's monitoring configurations (dbExtensionStatusQuery). */
export type ExtStatus = { extension: string; configs: number; ok: number; statuses: string[]; groups: string[]; hosts: number };
export const toExtStatus = (r: Row): ExtStatus => ({
  extension: str(r.extension),
  configs: Number(r.configs) || 0,
  ok: Number(r.ok) || 0,
  statuses: strings(r.statuses),
  groups: strings(r.groups),
  hosts: Number(r.hosts) || 0,
});

export type AgGroup = { group: string; activeGates: number; online: number };
export const toAgGroup = (r: Row): AgGroup => ({ group: str(r.group), activeGates: Number(r.activeGates) || 0, online: Number(r.online) || 0 });

// --- Endpoint of a OneAgent database process --------------------------------------------------------------------------
export type EndpointOption = { host: string; label: string };

/** Host names / addresses an ActiveGate could use for the process, most specific first. */
export function endpointOptions(p: DbProcess): EndpointOption[] {
  const out: EndpointOption[] = [];
  const k8s = !!p.namespace;
  if (k8s && p.workload) out.push({ host: `${p.workload}.${p.namespace}.svc.cluster.local`, label: "Kubernetes service DNS (a service named like the workload; reachable from an ActiveGate in the cluster)" });
  if (!k8s && p.hostName) out.push({ host: p.hostName, label: p.hostName.includes(".") ? "Host name (FQDN)" : "Host name" });
  // Loopback and link-local addresses are not reachable from an ActiveGate.
  for (const ip of p.ipAddress.filter((a) => !/^(127\.|169\.254\.|::1$|fe80:)/i.test(a))) out.push({ host: ip, label: k8s ? "Node IP (only with a NodePort or hostNetwork)" : "Host IP" });
  return out.filter((o, i) => /^[a-zA-Z0-9.\-:_]+$/.test(o.host) && out.findIndex((x) => x.host === o.host) === i);
}

/** Port the database most likely serves on: the technology's default when the process listens on it, else a hinted or the first listen port. */
export function endpointPort(p: DbProcess, info: DbTechInfo): number {
  const ports = p.listenPorts.map(Number).filter((n) => n > 0 && n < 65536);
  if (ports.includes(info.defaultPort)) return info.defaultPort;
  const hinted = info.portHint ? ports.find((n) => info.portHint!.test(String(n))) : undefined;
  return hinted ?? ports[0] ?? info.defaultPort;
}

// --- Extensions API (/platform/extensions/v2) -------------------------------------------------------------------------
const EXT_API = "/platform/extensions/v2/extensions";

const httpStatus = (e: unknown): number | undefined => (e as any)?.response?.status ?? (e as any)?.status;

/** Readable message for a failed Extensions API call; 403 names the scope to add. */
export function extError(e: unknown, scope: string): string {
  const status = httpStatus(e);
  if (status === 403) return `Access denied (HTTP 403): the app needs the scope ${scope} and you need the matching permission.`;
  return errorMessage(e);
}

async function extJson<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await httpClient.send({
    url: `${EXT_API}${path}`,
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { requestBodyType: "json" as const, body: init.body, headers: { "Content-Type": "application/json; charset=utf-8" } } : {}),
  });
  return (await res.body("json")) as T;
}

/** The extension in this environment: active version, installed but not active, or not installed (404 on both calls). */
export type ExtEnv = { state: "active"; version: string } | { state: "inactive"; versions: string[] } | { state: "missing" };

export async function readExtensionEnv(name: string): Promise<ExtEnv> {
  try {
    const r = await extJson<{ version?: string }>(`/${encodeURIComponent(name)}/environment-configuration`);
    if (r?.version) return { state: "active", version: str(r.version) };
  } catch (e) {
    if (httpStatus(e) !== 404) throw e;
  }
  try {
    const r = await extJson<{ items?: { version?: string }[] }>(`/${encodeURIComponent(name)}?page-size=100`);
    const versions = (r?.items ?? []).map((i) => str(i.version)).filter(Boolean);
    return versions.length ? { state: "inactive", versions } : { state: "missing" };
  } catch (e) {
    if (httpStatus(e) === 404) return { state: "missing" };
    throw e;
  }
}

/** Monitoring configuration schema of one extension version (properties, types, enums). */
export const readConfigSchema = (name: string, version: string) => extJson<Row>(`/${encodeURIComponent(name)}/${encodeURIComponent(version)}/schema`);

/** Every Extensions 2.0 in the environment (pages of 100): name and version. */
export async function listExtensions(): Promise<{ name: string; version: string }[]> {
  const out: { name: string; version: string }[] = [];
  let key: string | undefined;
  do {
    const r: any = await extJson(key ? `?page-key=${encodeURIComponent(key)}` : "?page-size=100");
    for (const it of r?.items ?? []) out.push({ name: str(it.extensionName), version: str(it.version) });
    key = r?.nextPageKey ?? undefined;
  } while (key);
  return out;
}

export type ExistingConfig = {
  objectId: string;
  scope: string;
  description: string;
  enabled: boolean;
  endpoints: { host: string; port: string }[];
  status?: string;
  /** LOCAL, REMOTE, CONTAINER or DATA_ACQUISITION; missing on configurations of older extension versions. */
  activationContext?: string;
  version?: string;
};

/**
 * Every monitoring configuration of the extension (pages of 500) with its endpoints and, unless `withStatus` is false,
 * its latest status (one more call). Secrets come back masked.
 */
export async function readMonitoringConfigs(name: string, withStatus = true): Promise<ExistingConfig[]> {
  const out: ExistingConfig[] = [];
  let key: string | undefined;
  do {
    const r: any = await extJson(`/${encodeURIComponent(name)}/monitoring-configurations${key ? `?page-key=${encodeURIComponent(key)}` : "?page-size=500"}`);
    for (const it of r?.items ?? []) {
      const v = it?.value ?? {};
      // Endpoints live under the data source key (sqlServerRemote, sqlPostgresContainer, pythonLocal.redis_instances, …).
      const endpoints = Object.entries(v)
        .filter(([k, x]) => /(Remote|Container|Local)$/.test(k) && x && typeof x === "object")
        .flatMap(([, x]: [string, any]) => [...(x.endpoints ?? []), ...(x.redis_instances ?? [])])
        .map((ep: any) => ({ host: str(ep?.host).toLowerCase(), port: str(ep?.port) }));
      out.push({
        objectId: str(it.objectId),
        scope: str(it.scope),
        description: str(v.description),
        enabled: v.enabled !== false,
        endpoints,
        activationContext: v.activationContext ? str(v.activationContext) : undefined,
        version: v.version ? str(v.version) : undefined,
      });
    }
    key = r?.nextPageKey ?? undefined;
  } while (key);
  if (!withStatus) return out;
  try {
    const s: any = await extJson(`/${encodeURIComponent(name)}/monitoring-configurations/statuses`);
    const status = new Map<string, string>((s?.items ?? []).map((x: any) => [str(x.configurationId), str(x.status)]));
    for (const c of out) c.status = status.get(c.objectId);
  } catch {
    // Statuses are informational.
  }
  return out;
}

/** Configurations with an endpoint on one of the hosts (and on the port, when both sides have one). */
export function configsFor(configs: ExistingConfig[], hosts: string[], port?: number): ExistingConfig[] {
  const names = new Set(hosts.map((h) => h.toLowerCase()).filter(Boolean));
  return configs.filter((c) => c.endpoints.some((ep) => names.has(ep.host) && (!port || !ep.port || ep.port === String(port))));
}

/** Names and addresses that identify the process in an endpoint (pod, workload / service, host, host IPs). */
export const processNames = (p: DbProcess) =>
  [p.pod, p.workload, p.workload && p.namespace ? `${p.workload}.${p.namespace}` : "", p.hostName, p.hostName.split(".")[0], ...p.ipAddress, ...endpointOptions(p).map((o) => o.host)].filter(Boolean);

export type VaultCredential = { id: string; name: string; ownerOnly: boolean };

/** User-and-password credentials an extension can use (scope Extension authentication or Extension). */
export async function readExtensionCredentials(): Promise<VaultCredential[]> {
  const out: VaultCredential[] = [];
  let key: string | undefined;
  do {
    const r: any = await credentialVaultClient.listCredentials(key ? { nextPageKey: key } : { type: "USERNAME_PASSWORD" });
    for (const c of r?.credentials ?? []) {
      const scopes: string[] = [...(c.scopes ?? []), c.scope].map(str);
      if (!scopes.some((s) => s === "EXTENSION_AUTHENTICATION" || s === "EXTENSION")) continue;
      out.push({ id: str(c.id), name: str(c.name), ownerOnly: c.ownerAccessOnly === true });
    }
    key = r?.nextPageKey ?? undefined;
  } while (key);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Monitoring configuration from the schema ---------------------------------------------------------------------------
/** What the remote SQL data source of one extension version accepts, read from its schema. */
export type ConfigShape = {
  version: string;
  remoteKey: string;
  endpointProps: Set<string>;
  hostPattern?: RegExp;
  vault: boolean;
  license: boolean;
  activationContext: boolean;
  featureSets: string[];
  vars?: Record<string, string>;
  lists: string[];
  endpointLists: string[];
  sslDefault: boolean;
};

const refName = (p: any) => str(p?.type?.$ref ?? p?.items?.type?.$ref).split("/").pop() ?? "";
const enumValues = (schema: Row, p: any) => ((schema.enums?.[refName(p)]?.items ?? []) as any[]).map((i) => str(i.value));
const unconditionalLists = (props: Row) => Object.entries(props).filter(([, p]: [string, any]) => p?.type === "list" && !p.precondition).map(([k]) => k);

/** The remote (ActiveGate) SQL data source of the schema, or why this app cannot create a configuration for it. */
export function shapeFromSchema(schema: Row): ConfigShape | string {
  const props: Row = schema?.properties ?? {};
  const types: Row = schema?.types ?? {};
  const remoteKey = Object.keys(props).find((k) => /Remote$/.test(k));
  if (!remoteKey) return "this extension has no remote (ActiveGate) configuration";
  const remote = types[refName(props[remoteKey])];
  const endpoint = types[refName(remote?.properties?.endpoints)];
  const ep: Row = endpoint?.properties ?? {};
  if (!ep.host || !ep.port || !ep.authentication) return "its endpoints have an unexpected format";
  const auth: Row = types[refName(ep.authentication)]?.properties ?? {};
  if (!enumValues(schema, auth.scheme).includes("basic")) return "it does not support user and password authentication";
  const pattern = (ep.host.constraints ?? []).find((c: any) => c?.type === "PATTERN")?.pattern;
  const varsType: Row = types[refName(props.vars)]?.properties;
  const vars = varsType
    ? Object.fromEntries(Object.entries(varsType).flatMap(([k, p]: [string, any]) => (typeof p?.default === "string" && !p.nullable ? [[k, p.default]] : [])))
    : undefined;
  return {
    version: str(props.version?.default),
    remoteKey,
    endpointProps: new Set(Object.keys(ep)),
    hostPattern: pattern ? new RegExp(pattern) : undefined,
    vault: !!auth.useCredentialVault,
    license: !!remote?.properties?.licenseAccepted,
    activationContext: enumValues(schema, props.activationContext).includes("REMOTE"),
    featureSets: enumValues(schema, props.featureSets),
    vars,
    lists: unconditionalLists(props),
    endpointLists: unconditionalLists(ep),
    sslDefault: ep.ssl?.default === true,
  };
}

export type ConfigInput = {
  group: string;
  host: string;
  port: number;
  databaseName: string;
  instanceName: string;
  /** Oracle: connect by service name or SID. */
  oracleBy: "serviceName" | "sid";
  oracleName: string;
  auth: { kind: "vault"; id: string } | { kind: "basic"; username: string; password: string };
  ssl: boolean;
  featureSets: string[];
  description: string;
  licenseAccepted: boolean;
};

export const agScopeOf = (group: string) => `ag_group-${group}`;

/** POST body ({scope, value}) for one endpoint, shaped like the configurations the extension's own UI creates. */
export function buildMonitoringConfig(s: ConfigShape, i: ConfigInput, maskSecrets = false) {
  const ep: Row = { host: i.host.trim(), port: i.port };
  const has = (k: string) => s.endpointProps.has(k);
  if (has("databaseName") && i.databaseName.trim()) ep.databaseName = i.databaseName.trim();
  if (has("instanceName") && i.instanceName.trim()) ep.instanceName = i.instanceName.trim();
  if (has("databaseIdentifier")) {
    ep.databaseIdentifier = i.oracleBy;
    ep[i.oracleBy === "sid" ? "SID" : "serviceName"] = i.oracleName.trim();
  }
  if (has("useConnectionString")) ep.useConnectionString = false;
  if (has("ssl")) ep.ssl = i.ssl;
  ep.authentication =
    i.auth.kind === "vault"
      ? { scheme: "basic", useCredentialVault: true, credentialVaultId: i.auth.id }
      : { scheme: "basic", username: i.auth.username.trim(), password: maskSecrets ? "********" : i.auth.password, ...(s.vault ? { useCredentialVault: false } : {}) };
  for (const l of s.endpointLists) ep[l] = [];
  const value: Row = {
    enabled: true,
    description: i.description.trim(),
    version: s.version,
    ...(s.activationContext ? { activationContext: "REMOTE" } : {}),
    featureSets: i.featureSets,
    ...Object.fromEntries(s.lists.map((l) => [l, []])),
    ...(s.vars ? { vars: s.vars } : {}),
    [s.remoteKey]: { endpoints: [ep], ...(s.license ? { licenseAccepted: i.licenseAccepted } : {}) },
  };
  return { scope: agScopeOf(i.group), value };
}

/** Local checks of the form against the schema; null when the input can be sent. */
export function checkConfigInput(s: ConfigShape, info: DbTechInfo, i: ConfigInput): string | null {
  if (!i.group) return "Select an ActiveGate group.";
  if (!i.host.trim()) return "Enter the database host.";
  if (s.hostPattern && !s.hostPattern.test(i.host.trim())) return "The host may contain only letters, digits, dots, hyphens, colons and underscores.";
  if (!Number.isInteger(i.port) || i.port < 1 || i.port > 65535) return "Enter a port between 1 and 65535.";
  if (s.endpointProps.has("databaseIdentifier") && !i.oracleName.trim()) return `Enter the ${i.oracleBy === "sid" ? "SID" : "service name"}.`;
  if (info.tech === "DB2" && !i.databaseName.trim()) return "Enter the database name (each Db2 endpoint needs one).";
  if (i.auth.kind === "vault" && !/^CREDENTIALS_VAULT-.+$/.test(i.auth.id)) return "Select a credential from the credential vault.";
  if (i.auth.kind === "basic" && (!i.auth.username.trim() || !i.auth.password)) return "Enter the user name and password of the monitoring user.";
  if (i.featureSets.length === 0) return "Select at least one feature set.";
  if (s.license && !i.licenseAccepted) return "Accept the Oracle JDBC driver license to monitor Oracle.";
  if (!i.description.trim() || i.description.length > 500) return "Enter a description (up to 500 characters).";
  return null;
}

/** Validate (local checks, extension active in this version, group has an ActiveGate with the Extensions module, endpoint not configured yet) and create. */
export async function createMonitoringConfig(
  info: DbTechInfo,
  s: ConfigShape,
  i: ConfigInput,
  groups: AgGroup[],
  validateOnly: boolean,
): Promise<SubmitResult> {
  const problem = checkConfigInput(s, info, i);
  if (problem) return { ok: false, message: problem };
  const group = groups.find((g) => g.group === i.group);
  if (!group || group.online === 0) return { ok: false, message: `ActiveGate group ${i.group} has no online ActiveGate with the Extensions module.` };
  try {
    const env = await readExtensionEnv(info.extension);
    if (env.state !== "active") return { ok: false, message: `${info.hubName} is not active in this environment: add it from Dynatrace Hub first.` };
    if (env.version !== s.version) return { ok: false, message: `The active ${info.hubName} version changed to ${env.version}; reload this form.` };
    const existing = configsFor(await readMonitoringConfigs(info.extension), [i.host], i.port);
    if (existing.length) {
      const c = existing[0];
      return { ok: false, message: `${i.host}:${i.port} is already in a monitoring configuration (“${c.description || c.objectId}”, ${c.scope}${c.status ? `, status ${c.status}` : ""}). Fix that configuration in the Extensions app instead.` };
    }
  } catch (e) {
    return { ok: false, message: extError(e, "extensions:configurations:read and extensions:definitions:read") };
  }
  if (validateOnly) {
    return {
      ok: true,
      message: `Valid: ${info.hubName} ${s.version} is active, ${i.group} has ${plural(group.online, "online ActiveGate")} with the Extensions module, and no configuration targets ${i.host}:${i.port} yet. The Extensions API has no dry run, so the server checks the values when you create it.`,
    };
  }
  try {
    const r = await extJson<{ objectId?: string }>(`/${encodeURIComponent(info.extension)}/monitoring-configurations`, { method: "POST", body: buildMonitoringConfig(s, i) });
    return { ok: true, message: `Monitoring configuration created on ${i.group}. The DB instance appears in Databases within a few minutes; use Re-check to update this tab.`, objectId: r?.objectId ? str(r.objectId) : undefined };
  } catch (e) {
    return { ok: false, message: extError(e, "extensions:configurations:write") };
  }
}

// --- Diagnosis of a selected process ----------------------------------------------------------------------------------
export type DbCheck = { id: string; status: CheckStatus; title: string; detail: string };
export type Loaded<T> = { status: "loading" } | { status: "ok"; value: T } | { status: "error"; message: string };

export type DbDiagnosisInput = {
  p: DbProcess;
  info: DbTechInfo;
  env: Loaded<ExtEnv>;
  groups: AgGroup[];
  configs: Loaded<ExistingConfig[]>;
  credentials: Loaded<VaultCredential[]>;
};

const MODE_TEXT: Record<string, string> = { FULL_STACK: "Full-Stack", INFRASTRUCTURE: "Infrastructure", DISCOVERY: "Discovery" };

export function diagnoseDbProcess(d: DbDiagnosisInput): DbCheck[] {
  const { p, info } = d;
  const out: DbCheck[] = [];
  if (p.coverage === "EXTENSION") {
    out.push({ id: "coverage", status: "pass", title: `Monitored by ${info.hubName}`, detail: `DB instance ${p.instances.join(", ")} (matched on ${p.matchedOn.join(", ")}).` });
  } else if (p.coverage === "LOCAL_EXTENSION") {
    out.push({ id: "coverage", status: "pass", title: "A local extension runs on the host", detail: `${p.localExtension} reports from ${p.hostName || p.host}.` });
  } else {
    out.push({ id: "coverage", status: "warn", title: "OneAgent only", detail: categoryOf("ONEAGENT_ONLY").detail });
  }
  if (!info.extension) return out;

  if (d.env.status === "ok") {
    const e = d.env.value;
    if (e.state === "active") out.push({ id: "extension", status: "pass", title: `${info.hubName} ${e.version} is active`, detail: `${info.extension} is in the environment; add a monitoring configuration for this database.` });
    else if (e.state === "inactive") out.push({ id: "extension", status: "fail", title: `${info.hubName} is installed but not active`, detail: `Versions ${e.versions.join(", ")} are uploaded; activate one in the Extensions app.` });
    else out.push({ id: "extension", status: "fail", title: `${info.hubName} is not in the environment`, detail: `Add the ${info.hubName} extension from Dynatrace Hub (needs the Change monitoring settings permission).` });
  } else if (d.env.status === "error") {
    out.push({ id: "extension", status: "info", title: "Extension not checked", detail: d.env.message });
  }

  if (info.runs !== "local") {
    const online = d.groups.filter((g) => g.online > 0);
    out.push(
      online.length
        ? { id: "group", status: "pass", title: `${plural(online.length, "ActiveGate group")} can run it`, detail: `${online.map((g) => `${g.group} (${g.online}/${g.activeGates})`).join(", ")}: online ActiveGates with the Extensions module. Every ActiveGate in the chosen group must reach the database.` }
        : { id: "group", status: info.runs === "both" ? "warn" : "fail", title: "No ActiveGate group with the Extensions module", detail: "Remote extensions run on an ActiveGate group; none has an online ActiveGate with the Extensions module." },
    );
  }
  if (info.runs !== "remote") {
    out.push({
      id: "oneagent",
      status: p.monitoringMode ? "pass" : "info",
      title: "OneAgent on the database host",
      detail: `${p.hostName || p.host} runs OneAgent${p.monitoringMode ? ` in ${MODE_TEXT[p.monitoringMode] ?? p.monitoringMode} mode` : ""}, so a local configuration (host scope) can run there.`,
    });
  }

  if (d.configs.status === "ok") {
    const port = endpointPort(p, info);
    const found = configsFor(d.configs.value, processNames(p), port);
    out.push(
      found.length
        ? {
            id: "configs",
            status: "warn",
            title: "A configuration already targets this database",
            detail: `${found.map((c) => `“${c.description || c.objectId}” (${c.scope}${c.status ? `, status ${c.status}` : ""}${c.enabled ? "" : ", disabled"})`).join("; ")}: it produces no DB instance for this process, so fix it (endpoint, credentials, ActiveGate reach) instead of adding another.`,
          }
        : { id: "configs", status: "pass", title: "No configuration targets this database yet", detail: `None of the ${plural(d.configs.value.length, "configuration")} of ${info.hubName} has an endpoint on this pod, workload, host or IP.` },
    );
  } else if (d.configs.status === "error") {
    out.push({ id: "configs", status: "info", title: "Existing configurations not checked", detail: d.configs.message });
  }

  if (p.namespace && info.runs !== "local") {
    out.push({
      id: "k8s",
      status: "info",
      title: "Runs in Kubernetes",
      detail: `Pod ${p.pod || p.workload} in namespace ${p.namespace}. Cluster DNS names resolve only for an ActiveGate in the cluster; from outside, expose the database (LoadBalancer or NodePort) and use that address.`,
    });
  }
  if (d.credentials.status === "ok" && info.runs !== "local") {
    const n = d.credentials.value.length;
    out.push({
      id: "vault",
      status: "info",
      title: n ? `${plural(n, "credential")} for extensions in the credential vault` : "No extension credential in the credential vault",
      detail: n ? "Pick the monitoring user's credential in the form, or enter user and password directly." : "Store the monitoring user as a User and password credential with the Extension authentication scope, or enter it directly in the form.",
    });
  }
  return out;
}

// --- Manual steps -----------------------------------------------------------------------------------------------------
export function agGroupAction(): ManualAction {
  return {
    id: "ag-group",
    title: "Prepare an ActiveGate group for remote extensions",
    steps: [
      "Use an environment ActiveGate with the Extensions module (the ActiveGates tab shows the modules).",
      "Put it in an ActiveGate group whose members can all reach the database host and port. Every new ActiveGate starts in the group default; a dedicated group keeps a configuration on one ActiveGate.",
      "Restart the ActiveGate after changing the group with agctl or custom.properties.",
    ],
    variants: [
      { label: "agctl (ActiveGate 1.333+)", language: "bash", code: "agctl group set <group>\n# then restart the ActiveGate" },
      { label: "custom.properties", language: "ini", code: "[collector]\ngroup = <group>\n# then restart the ActiveGate" },
      { label: "Installer", language: "bash", code: "--set-group=<group>   # at installation only, not during an update" },
    ],
    notes: ["Group names: letters, digits, hyphens, underscores and dots, not starting with a dot, up to 256 characters.", "An ActiveGate belongs to one group only."],
    docs: [DOC.agGroup, DOC.agCapabilities],
  };
}

export function userAction(info: DbTechInfo): ManualAction {
  return {
    id: "user",
    title: `Create the ${info.label} monitoring user`,
    steps: [
      `Create a dedicated, read-only monitoring user in ${info.label} with the grants below (pick the hosting type).`,
      "Store it in the credential vault (User and password, scope Extension authentication), or keep it for the monitoring configuration.",
      ...(info.tech === "POSTGRES" ? ["For execution plans, also create dynatrace.dynatrace_execution_plan from the extension page and run its validation script."] : []),
    ],
    variants: info.user,
    notes: info.notes,
    docs: info.docs,
  };
}

export function credentialAction(): ManualAction {
  return {
    id: "vault",
    title: "Store the monitoring user in the credential vault",
    steps: [
      "Open Credential Vault and select Add new credential.",
      "Credential type: User and password. Credential scope: Extension authentication.",
      "Name it, enter the monitoring user's name and password, and save. Owner only (the default) lets only you use it in configurations.",
      "Use the credential (CREDENTIALS_VAULT-…) in the monitoring configuration instead of a password.",
    ],
    variants: [],
    notes: ["A saved credential can be overwritten but not viewed."],
    docs: [DOC.credentialVault, DOC.mssqlDataSource],
  };
}

export function configureAction(info: DbTechInfo, p?: DbProcess): ManualAction {
  const host = p ? (endpointOptions(p)[0]?.host ?? "<host>") : "<host>";
  const port = p ? endpointPort(p, info) : info.defaultPort || "<port>";
  if (info.runs === "local") {
    return {
      id: "configure",
      title: `Add a ${info.hubName} monitoring configuration for the host`,
      steps: [
        `Add the ${info.hubName} extension from Dynatrace Hub if it is not in the environment yet.`,
        `In Extensions, open ${info.hubName} and add a monitoring configuration for host ${p?.hostName || "<host>"} (or its host group).`,
        "Enter the password (and the config file location if commands are renamed); override per instance by port if needed.",
        "Save, wait a few minutes, then use Re-check on this tab.",
      ],
      variants: [],
      notes: info.notes,
      docs: info.docs,
    };
  }
  return {
    id: "configure",
    title: `Add the database in Databases (${info.hubName} extension)`,
    steps: [
      `Add the ${info.hubName} extension from Dynatrace Hub if it is not in the environment yet (needs Change monitoring settings).`,
      `In Databases, select Add DB Instance, then ${info.hubName}, and pick the hosting type (it decides the setup script).`,
      "Select the ActiveGate group that will run the extension.",
      `Name the connection and enter host ${host}, port ${port}${info.tech === "ORACLE" ? " and the service name (or SID)" : info.databaseName ? ` and database ${info.databaseName}` : ""}.`,
      "Enter the monitoring user's credentials, or select them from the credential vault; optionally enable SSL.",
      `${info.tech === "ORACLE" ? "Accept the Oracle JDBC driver license, add" : "Add"} any manual configuration, then select Create DB instance monitoring. Use Re-check on this tab afterwards.`,
    ],
    variants: [],
    notes: ["The Extensions app (Add configuration on the extension) is the alternative path; it adds monitoring intervals and feature sets.", ...info.notes],
    docs: [...info.docs, DOC.dbGetStarted],
  };
}

export function kubernetesDbAction(p?: DbProcess): ManualAction {
  const ns = p?.namespace || "<namespace>";
  return {
    id: "k8s",
    title: "Reach a database that runs in Kubernetes",
    steps: [
      "The ActiveGate group's ActiveGates connect to the endpoint themselves, so it must resolve and reach it from where they run.",
      "From an ActiveGate in the cluster, use the database's service DNS name (<service>.<namespace>.svc.cluster.local) and its service port.",
      "From an ActiveGate outside the cluster, expose the database (LoadBalancer or NodePort) and use that address and port.",
    ],
    variants: [
      { label: "Find the database's service", language: "bash", code: `kubectl get svc,endpoints -n ${ns} -o wide${p?.pod ? `\nkubectl get pod ${p.pod} -n ${ns} -o wide   # pod IP behind the endpoints` : ""}` },
    ],
    notes: ["PostgreSQL: connect to the database directly, not through a load balancer, proxy or connection pooler (extension page)."],
    docs: [DOC.agGroup, DOC.agCapabilities],
  };
}

/** Steps shown before a process is selected. */
export const genericDbActions = (): ManualAction[] => [
  {
    id: "overview",
    title: "Monitor a database with its extension",
    steps: [
      "OneAgent sees a database server as a process (CPU, memory, network) but does not deep monitor it; the database extension adds statements, waits, locks, sessions and the Databases app.",
      "Pick a database in OneAgent database processes above and select Configure for steps filled in for it.",
      "Most database extensions run remotely on an ActiveGate group; Redis runs on the host's OneAgent, MongoDB either way.",
    ],
    variants: [],
    docs: [DOC.databases, DOC.dbGetStarted],
  },
  agGroupAction(),
  credentialAction(),
];
