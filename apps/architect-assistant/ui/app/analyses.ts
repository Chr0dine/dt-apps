import type { AIInsightsData, InsightItem, InsightSeverity, RecommendationItem } from "./AIInsights";

// Per-tab analysis functions for AI Assist. Pure functions of the data already on
// screen, so the explanation always matches what the user is looking at.
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const sevFor = (p: number): InsightSeverity => (p >= 90 ? "good" : p >= 50 ? "warning" : "critical");

export type CheckRow = { type: string; label: string; part: number; total: number; pct: number };

/** `frontends`: mean readiness of all web frontends, counted as one extra check in the overall score (null = none found). */
export function analyzeOverview(rows: CheckRow[], frontends: { pct: number; count: number } | null = null): AIInsightsData {
  if (rows.length === 0) {
    return {
      summary: "No entities were returned for this timeframe, so no best-practice checks could be scored.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No Smartscape entities found. Widen the timeframe or confirm OneAgent / cloud integrations are reporting." }],
      recommendations: [{ impact: "high", text: "Confirm OneAgent deployment and cloud connectors, then re-run the checks." }],
    };
  }
  const checkCount = rows.length + (frontends ? 1 : 0);
  const overall = Math.round((rows.reduce((s, r) => s + r.pct, 0) + (frontends?.pct ?? 0)) / checkCount);
  const failing = rows.filter((r) => r.pct < 50);
  const passing = rows.filter((r) => r.pct >= 90);
  const sorted = rows.slice().sort((a, b) => a.pct - b.pct);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const status = overall >= 90 ? "well configured" : overall >= 60 ? "partially configured" : "largely unconfigured";
  const summary = `Across ${checkCount} checks (entity type × best practice${frontends ? ", plus frontend readiness" : ""}) the tenant averages ${overall}% coverage — ${status}. ${passing.length} ${plural(passing.length, "check")} ${plural(passing.length, "is", "are")} at or above 90% and ${failing.length} ${plural(failing.length, "check")} ${plural(failing.length, "is", "are")} below 50%.`;

  const insights: InsightItem[] = [];
  if (failing.length > 0) insights.push({ severity: "critical", icon: "🚨", text: `${failing.length} ${plural(failing.length, "check")} below 50%: ${failing.slice(0, 4).map((r) => `${r.type} ${r.label.toLowerCase()} (${r.pct}%)`).join(", ")}${failing.length > 4 ? ", …" : ""}.` });
  insights.push({ severity: sevFor(worst.pct), icon: "⚠️", text: `Weakest check: ${worst.label} on ${worst.type} — ${worst.part} of ${worst.total} in place (${worst.pct}%).` });
  if (best !== worst) insights.push({ severity: "good", icon: "✅", text: `Strongest check: ${best.label} on ${best.type} at ${best.pct}% (${best.part}/${best.total}).` });
  if (frontends) insights.push({ severity: sevFor(frontends.pct), icon: "🌐", text: `Frontend readiness is ${frontends.pct}% across ${frontends.count} ${plural(frontends.count, "frontend")} (RUM, Session Replay, synthetic monitors, user tagging, health alerts, ownership); it counts as one check in the overall score.` });
  const noSecurity = rows.filter((r) => r.label === "Security context" && r.part === 0 && r.total > 0);
  if (noSecurity.length > 0) insights.push({ severity: "critical", icon: "🔐", text: `Security context is not set on any ${noSecurity.map((r) => r.type).join(", ")} entity — data cannot be scoped by security context.` });

  const recommendations: RecommendationItem[] = [];
  if (noSecurity.length > 0) recommendations.push({ impact: "high", text: "Define dt.security_context (for example via OneAgent host properties or OpenPipeline rules) so IAM policy boundaries can scope data access." });
  if (failing.length > 0) recommendations.push({ impact: "high", text: "Open the Primary tags tab, pick the weakest entity type and field, and list the entities that are missing it." });
  recommendations.push({ impact: "medium", text: "Set cost center and cost product at the source (host/Kubernetes metadata) so consumption is attributed to an owner." });
  if (frontends && frontends.pct < 70) recommendations.push({ impact: "medium", text: "Open the Frontends tab and use Actions to enable RUM v2 / Session Replay, assign synthetic monitors, create health alerts and set owners." });
  recommendations.push({ impact: "low", text: "Re-run with a 7 or 30 day timeframe to confirm gaps are not just newly onboarded entities." });
  return { summary, insights, recommendations };
}

export function analyzeFieldCoverage(title: string, rows: CheckRow[]): AIInsightsData {
  if (rows.length === 0) {
    return {
      summary: `No coverage data is available for ${title.toLowerCase()} in this timeframe.`,
      insights: [{ severity: "info", icon: "ℹ️", text: "No entities returned. Widen the timeframe or check the data source." }],
      recommendations: [{ impact: "medium", text: "Confirm entities are being monitored, then re-check." }],
    };
  }
  const totalEntities = rows.reduce((s, r) => s + r.total, 0);
  const totalPart = rows.reduce((s, r) => s + r.part, 0);
  const overall = totalEntities > 0 ? Math.round((totalPart / totalEntities) * 100) : 0;
  const empty = rows.filter((r) => r.part === 0 && r.total > 0);
  const full = rows.filter((r) => r.part === r.total && r.total > 0);
  const worst = rows.filter((r) => r.part < r.total).sort((a, b) => b.total - b.part - (a.total - a.part))[0];
  const summary = `${title}: ${totalPart.toLocaleString()} of ${totalEntities.toLocaleString()} entity checks are in place (${overall}%). ${full.length} ${plural(full.length, "combination")} fully covered, ${empty.length} with no coverage at all.`;

  const insights: InsightItem[] = [];
  if (full.length > 0) insights.push({ severity: "good", icon: "✅", text: `Fully covered: ${full.slice(0, 5).map((r) => `${r.type} ${r.label.toLowerCase()}`).join(", ")}.` });
  if (empty.length > 0) insights.push({ severity: "critical", icon: "🚨", text: `No coverage: ${empty.slice(0, 5).map((r) => `${r.type} ${r.label.toLowerCase()} (0/${r.total})`).join(", ")}.` });
  if (worst) insights.push({ severity: sevFor(worst.pct), icon: "📉", text: `Largest gap: ${worst.total - worst.part} ${worst.type} ${plural(worst.total - worst.part, "entity", "entities")} missing ${worst.label.toLowerCase()}.` });
  insights.push({ severity: sevFor(overall), icon: "📊", text: `Combined coverage for this view is ${overall}%.` });

  const recommendations: RecommendationItem[] = [];
  if (empty.length > 0) recommendations.push({ impact: "high", text: "Start with the zero-coverage combinations — a single rule or host property usually fixes the whole group." });
  if (worst) recommendations.push({ impact: "medium", text: `Use “Find entities missing a field” for ${worst.type} / ${worst.label} to see exactly which entities to fix.` });
  recommendations.push({ impact: "low", text: "Use Open in Notebook on a query to share or extend the check with your customer." });
  return { summary, insights, recommendations };
}

export function analyzeHostGroups(groups: Array<{ name: string; hosts: number; none: boolean }>): AIInsightsData {
  const total = groups.reduce((s, g) => s + g.hosts, 0);
  if (total === 0) {
    return {
      summary: "No hosts were found for this timeframe.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No host entities returned." }],
      recommendations: [{ impact: "medium", text: "Confirm OneAgent is installed on hosts." }],
    };
  }
  const without = groups.filter((g) => g.none).reduce((s, g) => s + g.hosts, 0);
  const named = groups.filter((g) => !g.none);
  const pct = Math.round(((total - without) / total) * 100);
  const biggest = named.slice().sort((a, b) => b.hosts - a.hosts)[0];
  const summary = `${total} hosts are spread across ${named.length} host ${plural(named.length, "group")}; ${without} ${plural(without, "host")} (${100 - pct}%) ${plural(without, "has", "have")} no host group.`;
  const insights: InsightItem[] = [
    { severity: sevFor(pct), icon: without === 0 ? "✅" : "⚠️", text: `${pct}% of hosts belong to a host group.` },
  ];
  if (biggest) insights.push({ severity: "info", icon: "🏷️", text: `Largest host group: ${biggest.name} with ${biggest.hosts} ${plural(biggest.hosts, "host")}.` });
  const singles = named.filter((g) => g.hosts === 1).length;
  if (singles > 2) insights.push({ severity: "info", icon: "🔎", text: `${singles} host groups contain a single host — check for naming drift or over-segmentation.` });
  const recommendations: RecommendationItem[] = [];
  if (without > 0) recommendations.push({ impact: "high", text: "Assign a host group at install time (--set-host-group) so settings and ownership can be applied per deployment unit." });
  recommendations.push({ impact: "low", text: "Keep a naming convention (environment-purpose) for host groups to avoid near-duplicates." });
  return { summary, insights, recommendations };
}

export function analyzeOneAgent(rows: Array<{ mode: string; version: string; agents: number; behind: number }>): AIInsightsData {
  const total = rows.reduce((s, r) => s + r.agents, 0);
  if (total === 0) {
    return {
      summary: "No OneAgent data is available for this timeframe.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No OneAgent entities returned." }],
      recommendations: [{ impact: "medium", text: "Confirm OneAgents are connected to this tenant." }],
    };
  }
  const current = rows.filter((r) => r.behind <= 2).reduce((s, r) => s + r.agents, 0);
  const old = rows.filter((r) => r.behind > 10).reduce((s, r) => s + r.agents, 0);
  const notFull = rows.filter((r) => r.mode !== "FULL_STACK").reduce((s, r) => s + r.agents, 0);
  const versions = new Set(rows.map((r) => r.version)).size;
  const currentPct = Math.round((current / total) * 100);
  const summary = `${total} OneAgents report ${versions} distinct ${plural(versions, "version")}. ${currentPct}% are within 2 releases of the newest seen in this tenant and ${total - notFull} run in full-stack mode.`;
  const insights: InsightItem[] = [{ severity: sevFor(currentPct), icon: "🔄", text: `${current} of ${total} agents are on a current version.` }];
  if (old > 0) insights.push({ severity: "critical", icon: "🕰️", text: `${old} ${plural(old, "agent")} ${plural(old, "is", "are")} more than 10 releases behind — likely missing fixes and features.` });
  if (notFull > 0) insights.push({ severity: "warning", icon: "🧩", text: `${notFull} ${plural(notFull, "agent")} ${plural(notFull, "is", "are")} not in full-stack mode (infrastructure/discovery) — deep code-level data is not collected.` });
  if (versions > 5) insights.push({ severity: "warning", icon: "🧱", text: `${versions} different versions in use suggests no automated update policy.` });
  const recommendations: RecommendationItem[] = [];
  if (old > 0 || versions > 5) recommendations.push({ impact: "high", text: "Enable automatic OneAgent updates (or a defined maintenance window) to converge on a small set of versions." });
  if (notFull > 0) recommendations.push({ impact: "medium", text: "Review hosts in discovery/infrastructure mode and switch them to full-stack where deep monitoring is intended." });
  recommendations.push({ impact: "low", text: "“Releases behind” compares against the newest version in this tenant, not the latest Dynatrace release." });
  return { summary, insights, recommendations };
}

export type KubernetesInsightInput = {
  /** One row per cluster: its DynaKube modes (empty = no DynaKube); `cloud` names the managed cluster from a cloud integration, `cloudOnly` = seen only through that integration. */
  clusters: Array<{ name: string; modes: string[]; k8sMonitoring: boolean; containers: number; cloud?: string; cloudOnly: boolean }>;
  dynakubes: Array<{ name: string; cluster: string; mode: string; phase: string; failing: string[]; operatorVersions: string[] }>;
  /** Pods per injection status (STATUSES keys in kubernetes.ts). */
  podStatuses: Record<string, number>;
  namespaces: { eligible: number; all: number; partial: number };
  selection: { name: string; failing: string[] } | null;
};

const MODE_NAMES: Record<string, string> = {
  CLOUD_NATIVE_FULL_STACK: "cloud-native full-stack",
  APPLICATION_MONITORING: "application monitoring",
  CLASSIC_FULL_STACK: "classic full-stack",
  HOST_MONITORING: "host monitoring",
  KUBERNETES_ONLY: "no OneAgent",
};

export function analyzeKubernetes(d: KubernetesInsightInput): AIInsightsData {
  if (d.clusters.length === 0) {
    return {
      summary: "No Kubernetes clusters were found for this timeframe, so there is nothing to check for the Dynatrace Operator.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No Kubernetes cluster, DynaKube, managed cloud cluster (EKS, AKS, GKE) or containerized workload in a Kubernetes namespace was returned." }],
      recommendations: [{ impact: "medium", text: "Install the Dynatrace Operator with a cloud-native full-stack DynaKube on each Kubernetes cluster." }],
    };
  }
  const s = (k: string) => d.podStatuses[k] ?? 0;
  const total = Object.values(d.podStatuses).reduce((a, b) => a + b, 0);
  const eligible = total - s("SYSTEM") - s("DYNATRACE");
  const oneAgent = s("ONEAGENT") + s("CLASSIC") + s("ONEAGENT_OTEL");
  const p = eligible > 0 ? Math.round((oneAgent / eligible) * 100) : 0;
  const noDk = d.clusters.filter((c) => c.modes.length === 0);
  const notFull = d.dynakubes.filter((k) => !["CLOUD_NATIVE_FULL_STACK", "CLASSIC_FULL_STACK"].includes(k.mode));
  const classic = d.dynakubes.filter((k) => k.mode === "CLASSIC_FULL_STACK");
  const unhealthy = d.dynakubes.filter((k) => (k.phase && k.phase !== "Running") || k.failing.length > 0);
  const versions = [...new Set(d.dynakubes.flatMap((k) => k.operatorVersions))];
  const cloud = d.clusters.filter((c) => c.cloud);
  const cloudOnly = d.clusters.filter((c) => c.cloudOnly);
  const summary = `${d.clusters.length} Kubernetes ${plural(d.clusters.length, "cluster")}${cloud.length ? ` (${cloud.length} managed by a cloud provider)` : ""}, ${d.dynakubes.length} ${plural(d.dynakubes.length, "DynaKube")}${noDk.length ? `; ${noDk.length} ${plural(noDk.length, "cluster has", "clusters have")} none` : ""}. ${oneAgent.toLocaleString()} of ${eligible.toLocaleString()} application pods (${p}%) have OneAgent; system namespaces and Dynatrace's own pods are left out.`;

  const insights: InsightItem[] = [{ severity: sevFor(p), icon: "☸️", text: `${p}% of application pods are injected with OneAgent.` }];
  if (cloudOnly.length) insights.push({ severity: "critical", icon: "☁️", text: `Seen only through a cloud integration, no Operator: ${cloudOnly.map((c) => c.cloud ?? c.name).join(", ")}. Dynatrace sees the cluster resource but no nodes, workloads or pods.` });
  const otherNoDk = noDk.filter((c) => !c.cloudOnly);
  if (otherNoDk.length) insights.push({ severity: "critical", icon: "🚫", text: `No DynaKube: ${otherNoDk.map((c) => `${c.name}${!c.k8sMonitoring && c.containers ? ` (${c.containers.toLocaleString()} running containers seen only by a host OneAgent)` : ""}`).join(", ")}.` });
  if (cloud.length) insights.push({ severity: sevFor(Math.round(((cloud.length - cloud.filter((c) => c.modes.length === 0).length) / cloud.length) * 100)), icon: "🌐", text: `${cloud.length - cloud.filter((c) => c.modes.length === 0).length} of ${cloud.length} managed cloud ${plural(cloud.length, "cluster has", "clusters have")} the Operator.` });
  if (notFull.length) insights.push({ severity: "warning", icon: "🧩", text: `Not full-stack: ${notFull.map((k) => `${k.name} (${MODE_NAMES[k.mode] ?? k.mode})`).join(", ")}.` });
  if (classic.length) insights.push({ severity: "warning", icon: "🕰️", text: `Classic full-stack is legacy: ${classic.map((k) => k.name).join(", ")}.` });
  if (unhealthy.length) insights.push({ severity: "critical", icon: "🩺", text: `DynaKubes not healthy: ${unhealthy.map((k) => `${k.name} (${k.phase || "unknown phase"}${k.failing.length ? `; ${k.failing.join(", ")}` : ""})`).join(", ")}.` });
  if (versions.length > 1) insights.push({ severity: "info", icon: "🔢", text: `Operator versions in use: ${versions.join(", ")}.` });
  if (s("ONEAGENT_OTEL")) insights.push({ severity: "warning", icon: "🔁", text: `${s("ONEAGENT_OTEL")} ${plural(s("ONEAGENT_OTEL"), "pod has", "pods have")} both OneAgent and OpenTelemetry: risk of duplicate spans and overhead.` });
  if (s("OTEL")) insights.push({ severity: "info", icon: "🔭", text: `${s("OTEL")} ${plural(s("OTEL"), "pod uses", "pods use")} OpenTelemetry instead of OneAgent.` });
  if (s("RESTART_REQUIRED") || s("OPT_IN_REQUIRED")) insights.push({ severity: "warning", icon: "🔄", text: `${s("RESTART_REQUIRED") + s("OPT_IN_REQUIRED")} ${plural(s("RESTART_REQUIRED") + s("OPT_IN_REQUIRED"), "pod")} could be injected but ${plural(s("RESTART_REQUIRED") + s("OPT_IN_REQUIRED"), "is", "are")} not: roll out (or opt in) to inject them.` });
  if (s("POD_BLOCK")) insights.push({ severity: "warning", icon: "⛔", text: `${s("POD_BLOCK")} ${plural(s("POD_BLOCK"), "pod opts", "pods opt")} out with an annotation (pod block).` });
  if (s("NAMESPACE_BLOCK") || s("METADATA_ONLY")) insights.push({ severity: "warning", icon: "🏷️", text: `${s("NAMESPACE_BLOCK") + s("METADATA_ONLY")} ${plural(s("NAMESPACE_BLOCK") + s("METADATA_ONLY"), "pod")} in namespaces no OneAgent namespaceSelector matches (namespace block).` });
  if (d.namespaces.eligible) insights.push({ severity: sevFor(Math.round((d.namespaces.all / d.namespaces.eligible) * 100)), icon: "📦", text: `${d.namespaces.all} of ${d.namespaces.eligible} application namespaces have OneAgent on every pod; ${d.namespaces.partial} only on some.` });
  if (d.selection) {
    insights.push(
      d.selection.failing.length
        ? { severity: "critical", icon: "🔎", text: `${d.selection.name}: ${d.selection.failing.join("; ")}.` }
        : { severity: "good", icon: "✅", text: `${d.selection.name}: nothing blocks full-stack monitoring.` },
    );
  }

  const recommendations: RecommendationItem[] = [];
  if (noDk.length) recommendations.push({ impact: "high", text: "Install the Dynatrace Operator with a cloud-native full-stack DynaKube on the clusters without one: Diagnose on their row in the clusters table gives the steps, including the kubectl context for EKS, AKS and GKE." });
  if (notFull.length || classic.length) recommendations.push({ impact: "high", text: "Switch application-monitoring, host-monitoring and classic DynaKubes to cloud-native full-stack, then roll out the workloads." });
  if (unhealthy.length) recommendations.push({ impact: "high", text: "Run dynatrace-operator troubleshoot on the unhealthy DynaKubes before changing anything else." });
  if (s("RESTART_REQUIRED")) recommendations.push({ impact: "medium", text: "Click Roll out required in a donut to list the workloads, then restart them in a maintenance window." });
  if (s("NAMESPACE_BLOCK") || s("POD_BLOCK")) recommendations.push({ impact: "medium", text: "Use Diagnose on a blocked workload: the remediation section shows the namespace selector or annotation to change." });
  if (s("ONEAGENT_OTEL")) recommendations.push({ impact: "medium", text: "Pick one tracer per workload (OneAgent or OpenTelemetry) to avoid duplicate spans; keep OpenTelemetry for technologies without a code module." });
  recommendations.push({ impact: "low", text: "Pods and containers are counted as running now, so finished jobs and replaced replicas do not count; re-check a few minutes after a rollout." });
  return { summary, insights, recommendations };
}

export type ActiveGateInsightInput = {
  total: number;
  offline: string[];
  /** ActiveGates more than five releases behind the target version. */
  behind: Array<{ name: string; releases: number }>;
  target: string;
  /** Host-based ActiveGates and those with automatic updates off (null = settings not read). */
  hostBased: number;
  manual: string[] | null;
  rejected: Array<{ name: string; n: number }>;
  dropped: Array<{ name: string; n: number }>;
  tokens: Array<{ name: string; days: number }>;
  idleModules: Array<{ module: string; ags: number }>;
  moduleIssues: Array<{ name: string; module: string }>;
  extensions: { total: number; problems: number; unassigned: number };
  awsUnassigned: string[];
  /** null = network zone settings not read. */
  zonesEnabled: boolean | null;
  zoneProblems: Array<{ zone: string; note: string; blocking: boolean }>;
  groupProblems: Array<{ group: string; note: string }>;
  selection: { name: string; failing: string[] } | null;
};

export function analyzeActiveGates(d: ActiveGateInsightInput): AIInsightsData {
  if (d.total === 0) {
    return {
      summary: "No environment ActiveGate was found for this timeframe.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No ACTIVEGATE, SYNTHETIC_ENGINE or ZREMOTE Smartscape node was returned." }],
      recommendations: [{ impact: "medium", text: "Deploy an Environment ActiveGate if you route OneAgent traffic, monitor clouds or run extensions." }],
    };
  }
  const online = d.total - d.offline.length;
  const onlinePct = Math.round((online / d.total) * 100);
  const summary = `${d.total} ${plural(d.total, "ActiveGate")}, ${online} connected. ${d.behind.length ? `${d.behind.length} ${plural(d.behind.length, "is", "are")} more than five releases behind ${d.target || "the target version"}` : "None is more than five releases behind the target version"}; ${d.extensions.total} extension ${plural(d.extensions.total, "configuration")} run on ActiveGate groups, ${d.extensions.problems} not OK.`;
  const insights: InsightItem[] = [{ severity: sevFor(onlinePct), icon: "🔌", text: `${online} of ${d.total} ActiveGates are connected${d.offline.length ? `; offline: ${d.offline.join(", ")}` : ""}.` }];
  if (d.rejected.length) insights.push({ severity: "critical", icon: "⛔", text: `Messages rejected (authorization, data loss): ${d.rejected.map((r) => `${r.name} (${r.n.toLocaleString()})`).join(", ")}.` });
  if (d.dropped.length) insights.push({ severity: "warning", icon: "📉", text: `Messages dropped (timeouts): ${d.dropped.map((r) => `${r.name} (${r.n.toLocaleString()})`).join(", ")}.` });
  if (d.behind.length) insights.push({ severity: "warning", icon: "🕰️", text: `More than five releases behind: ${d.behind.map((b) => `${b.name} (${b.releases})`).join(", ")}.` });
  if (d.manual && d.manual.length) insights.push({ severity: "warning", icon: "🔄", text: `${d.manual.length} of ${d.hostBased} host-based ActiveGates have automatic updates off.` });
  if (d.tokens.length) insights.push({ severity: "warning", icon: "🔑", text: `Tokens expiring or expired: ${d.tokens.map((t) => `${t.name} (${t.days < 0 ? "expired" : `${t.days} days`})`).join(", ")}.` });
  if (d.moduleIssues.length) insights.push({ severity: "warning", icon: "🧩", text: `Module problems: ${d.moduleIssues.map((m) => `${m.module} on ${m.name}`).join(", ")}.` });
  if (d.extensions.unassigned) insights.push({ severity: "critical", icon: "📦", text: `${d.extensions.unassigned} extension ${plural(d.extensions.unassigned, "configuration")} assigned to an ActiveGate group ${plural(d.extensions.unassigned, "is", "are")} not picked up by any ActiveGate.` });
  if (d.awsUnassigned.length) insights.push({ severity: "warning", icon: "☁️", text: `AWS connections no ActiveGate runs: ${d.awsUnassigned.join(", ")}.` });
  if (d.groupProblems.length) insights.push({ severity: "critical", icon: "🗂️", text: `ActiveGate groups: ${d.groupProblems.map((g) => `${g.group}: ${g.note}`).join(" ")}` });
  if (d.zonesEnabled === false) insights.push({ severity: "info", icon: "🗺️", text: "Network zones are turned off for the environment, so zone assignments and fallback modes do not route OneAgent traffic." });
  for (const z of d.zoneProblems) insights.push({ severity: z.blocking ? "critical" : "warning", icon: "🗺️", text: `Network zone ${z.zone}: ${z.note}` });
  if (d.idleModules.length) insights.push({ severity: "info", icon: "💤", text: `Enabled but not in use: ${d.idleModules.map((m) => `${m.module} (${m.ags})`).join(", ")}.` });
  if (d.selection) {
    insights.push(
      d.selection.failing.length
        ? { severity: "critical", icon: "🔎", text: `${d.selection.name}: ${d.selection.failing.join("; ")}.` }
        : { severity: "good", icon: "✅", text: `${d.selection.name}: no blocking problem.` },
    );
  }

  const recommendations: RecommendationItem[] = [];
  if (d.offline.length) recommendations.push({ impact: "high", text: "Restore the offline ActiveGates (service, endpoint, proxy, token); collect a support archive with agctl if they do not reconnect." });
  if (d.rejected.length) recommendations.push({ impact: "high", text: "Rejected messages are data loss: check the ActiveGate tokens and the tokens of what sends through them." });
  if (d.extensions.unassigned) recommendations.push({ impact: "high", text: "Fix the unassigned extension configurations: an ActiveGate in the group needs the Extensions module and must reach the monitored endpoint." });
  if (d.manual && d.manual.length) recommendations.push({ impact: "medium", text: "Turn on automatic updates (Remediation actions › Set the update mode) so ActiveGates stay in the supported range." });
  if (d.behind.length) recommendations.push({ impact: "medium", text: "Update the ActiveGates that are far behind (Update now for host-based ones, the Operator image for Kubernetes)." });
  if (d.tokens.length) recommendations.push({ impact: "medium", text: "Rotate ActiveGate tokens before they expire; with token enforcement an expired token disconnects the ActiveGate." });
  if (d.zoneProblems.some((z) => z.blocking)) recommendations.push({ impact: "high", text: "Give zones with fallback None an ActiveGate (or an alternative zone with one), or change their fallback: their OneAgents' traffic is dropped." });
  if (d.zonesEnabled === false) recommendations.push({ impact: "low", text: "If you route traffic by network zone, plan the zones and turn network zones on (Remediation actions › Turn on network zones)." });
  recommendations.push({ impact: "low", text: "Enabled-but-idle modules are a review item, not an error: some wait for configuration (an AWS connection, a cluster), others are not needed on that ActiveGate." });
  return { summary, insights, recommendations };
}

/** One item (tag or field) on one entity type; `name` is the display label of the item. */
export type TagCoverage = { type: string; name: string; part: number; total: number; pct: number };

type NamedKind = "tag" | "field";

function analyzeNamed(kind: NamedKind, labels: string[], rows: TagCoverage[]): AIInsightsData {
  const noun = kind === "tag" ? "primary tag" : "primary field";
  if (labels.length === 0) {
    return {
      summary: `No ${noun}s are listed yet, so nothing can be scored on this tab.`,
      insights: [
        {
          severity: "info",
          icon: "ℹ️",
          text:
            kind === "tag"
              ? "Customer-defined primary tags use the primary_tags.<name> prefix (for example team, app or stage). Add the names you expect to see coverage."
              : "Add a field name such as k8s.cluster.name, or field=value (for example cloud.provider=aws) to see how many entities of each type carry it.",
        },
      ],
      recommendations: [
        {
          impact: "medium",
          text:
            kind === "tag"
              ? "Agree a small set of tag names with the customer (owner, application, stage), add them here, then create central enrichment rules for each."
              : "Start with the fields the customer relies on for segments and IAM boundaries, then check each across entity types.",
        },
      ],
    };
  }
  const byItem = labels.map((name) => {
    const items = rows.filter((r) => r.name === name);
    const part = items.reduce((s, r) => s + r.part, 0);
    const total = items.reduce((s, r) => s + r.total, 0);
    return { name, part, total, pct: total > 0 ? Math.round((part / total) * 100) : 0 };
  });
  const unused = byItem.filter((t) => t.part === 0);
  const best = byItem.slice().sort((a, b) => b.pct - a.pct)[0];
  const typeCount = new Set(rows.map((r) => r.type)).size;
  const summary = `${labels.length} ${plural(labels.length, noun)} checked across ${typeCount} entity types. ${unused.length} ${plural(unused.length, "item")} ${plural(unused.length, "is", "are")} not present on any entity.`;
  const insights: InsightItem[] = [];
  if (unused.length > 0) insights.push({ severity: "critical", icon: "🏷️", text: `Not present anywhere: ${unused.map((t) => t.name).join(", ")}.` });
  if (best && best.part > 0) insights.push({ severity: sevFor(best.pct), icon: "📊", text: `Best covered: ${best.name} at ${best.pct}% of all entities.` });
  const worst = rows.filter((r) => r.pct < 50).sort((a, b) => b.total - b.part - (a.total - a.part))[0];
  if (worst) insights.push({ severity: "warning", icon: "📉", text: `Largest gap: ${worst.total - worst.part} ${worst.type} entities lack ${worst.name}.` });
  const recommendations: RecommendationItem[] = [];
  if (kind === "tag") {
    if (unused.length > 0) recommendations.push({ impact: "high", text: "Create a central enrichment rule for each unused tag (source: Kubernetes label, cloud tag or a fixed value) so it is applied without touching hosts." });
    recommendations.push({ impact: "low", text: "Keep the tag set small (up to 20 primary tags per host or process are supported; extras are dropped)." });
  } else {
    recommendations.push({ impact: "medium", text: "Low coverage on a built-in field usually means the entity type does not carry it (for example Kubernetes fields on hosts); judge it against the types it should apply to." });
    if (unused.length > 0) recommendations.push({ impact: "low", text: "Check the spelling of fields reported as not present anywhere." });
  }
  return { summary, insights, recommendations };
}

export const analyzeTags = (labels: string[], rows: TagCoverage[]) => analyzeNamed("tag", labels, rows);

export function analyzeSegments(zones: Array<{ name: string; hasSegment: boolean; managed: boolean; dimensionRules: number; rules: number }>): AIInsightsData {
  if (zones.length === 0) {
    return {
      summary: "No management zones are defined in this environment, so there is nothing to convert to segments.",
      insights: [{ severity: "good", icon: "✅", text: "Data filtering can be built on segments and primary Grail fields from the start." }],
      recommendations: [{ impact: "low", text: "Define segments on primary fields (host group, Kubernetes namespace, primary tags) instead of creating management zones." }],
    };
  }
  const converted = zones.filter((z) => z.hasSegment);
  const missing = zones.filter((z) => !z.hasSegment);
  const managed = zones.filter((z) => z.managed).length;
  const dimension = zones.filter((z) => z.dimensionRules > 0);
  const empty = zones.filter((z) => z.rules === 0);
  const p = Math.round((converted.length / zones.length) * 100);
  const summary = `${converted.length} of ${zones.length} management ${plural(zones.length, "zone")} (${p}%) ${plural(converted.length, "has", "have")} a segment with the same name; ${managed} of those ${plural(managed, "was", "were")} created by this app and can be refreshed here.`;
  const insights: InsightItem[] = [{ severity: sevFor(p), icon: "🧭", text: `${p}% of management zones have a matching segment.` }];
  if (missing.length > 0) insights.push({ severity: "warning", icon: "📋", text: `Not converted yet: ${missing.slice(0, 5).map((z) => z.name).join(", ")}${missing.length > 5 ? ", …" : ""}.` });
  if (dimension.length > 0) insights.push({ severity: "warning", icon: "📐", text: `${dimension.length} ${plural(dimension.length, "zone uses", "zones use")} dimension rules (metric/log dimensions), which an entity-based conversion cannot carry over: ${dimension.slice(0, 3).map((z) => z.name).join(", ")}.` });
  if (empty.length > 0) insights.push({ severity: "info", icon: "🗑️", text: `${empty.length} ${plural(empty.length, "zone has", "zones have")} no enabled rules; consider deleting instead of converting.` });
  insights.push({ severity: "info", icon: "🔐", text: "Segments filter data but do not restrict access; management zone permissions need equivalent IAM policies." });
  const recommendations: RecommendationItem[] = [];
  if (missing.length > 0) recommendations.push({ impact: "high", text: "Use the remediation section to convert the remaining zones; preview shows every entity type found and the exact segment definition." });
  if (managed > 0) recommendations.push({ impact: "medium", text: "Converted segments are entity snapshots. Refresh them after topology changes, or rebuild them on primary fields so they stay current." });
  if (dimension.length > 0) recommendations.push({ impact: "medium", text: "Recreate dimension rules as segment filters on the metric or log fields they matched." });
  recommendations.push({ impact: "low", text: "Replace management zone permissions with IAM policies (for example on dt.security_context) before retiring the zones." });
  return { summary, insights, recommendations };
}

export function analyzeSlos(slos: Array<{ name: string; upgraded: boolean; managed: boolean; convertible: boolean; enabled: boolean }>, newTotal: number): AIInsightsData {
  if (slos.length === 0) {
    return {
      summary: `No classic SLOs are defined in this environment${newTotal ? `; ${newTotal} ${plural(newTotal, "SLO")} already use the Grail-based Service-Level Objectives app` : ""}.`,
      insights: [{ severity: "good", icon: "✅", text: "Nothing to upgrade: new SLOs can be defined directly in DQL." }],
      recommendations: [{ impact: "low", text: "Start from the SLO templates (service availability, performance, host and Kubernetes efficiency) when you add SLOs." }],
    };
  }
  const upgraded = slos.filter((s) => s.upgraded);
  const missing = slos.filter((s) => !s.upgraded);
  const managed = slos.filter((s) => s.managed).length;
  const auto = missing.filter((s) => s.convertible);
  const manual = missing.filter((s) => !s.convertible);
  const disabled = missing.filter((s) => !s.enabled);
  const p = Math.round((upgraded.length / slos.length) * 100);
  const summary = `${upgraded.length} of ${slos.length} classic ${plural(slos.length, "SLO")} (${p}%) ${plural(upgraded.length, "has", "have")} an SLO with the same name; ${managed} of those ${plural(managed, "was", "were")} created by this app.`;
  const insights: InsightItem[] = [{ severity: sevFor(p), icon: "🎯", text: `${p}% of classic SLOs are upgraded to Grail-based SLOs.` }];
  if (auto.length > 0) insights.push({ severity: "info", icon: "⚙️", text: `${auto.length} of the ${missing.length} remaining ${plural(auto.length, "SLO uses", "SLOs use")} a metric expression this app converts automatically (service availability and performance, synthetic availability, host and Kubernetes efficiency).` });
  if (manual.length > 0) insights.push({ severity: "warning", icon: "✍️", text: `${manual.length} ${plural(manual.length, "needs", "need")} a manual upgrade (calculated or custom metrics, inline filters, Apdex): ${manual.slice(0, 3).map((s) => s.name).join(", ")}${manual.length > 3 ? ", …" : ""}.` });
  if (disabled.length > 0) insights.push({ severity: "info", icon: "💤", text: `${disabled.length} remaining classic ${plural(disabled.length, "SLO is", "SLOs are")} disabled; consider deleting instead of upgrading.` });
  const recommendations: RecommendationItem[] = [];
  if (auto.length > 0) recommendations.push({ impact: "high", text: "Use Upgrade classic SLOs: Validate runs each generated SLI query and shows the classic value next to it before anything is created." });
  if (manual.length > 0) recommendations.push({ impact: "medium", text: "For the rest, use Data Explorer's Open with > Notebook converter, rename the result to sli and keep the classic name so the gauge counts it." });
  recommendations.push({ impact: "medium", text: "Run classic and new SLOs side by side for one evaluation period and compare before retiring the classic ones." });
  if (managed > 0) recommendations.push({ impact: "low", text: "Upgraded SLOs keep the classic entity selector via classicEntitySelector(); replace it with segments or Smartscape filters over time." });
  return { summary, insights, recommendations };
}

export type NotificationInsightRow = { name: string; type: string; enabled: boolean; migrated: boolean; managed: boolean; convertible: boolean; problems: number | null; gen2: string[]; translatable: boolean };

export function analyzeProblemNotifications(rows: NotificationInsightRow[]): AIInsightsData {
  if (rows.length === 0) {
    return {
      summary: "No classic problem notifications are defined in this environment, so there is nothing to migrate to workflows.",
      insights: [{ severity: "good", icon: "✅", text: "Problem alerting can be built on simple workflows with a Davis problem trigger from the start." }],
      recommendations: [{ impact: "low", text: "Filter the workflow trigger on problem fields (tags, affected entities) rather than on alerting profiles." }],
    };
  }
  const enabled = rows.filter((r) => r.enabled);
  const migrated = enabled.filter((r) => r.migrated);
  const missing = enabled.filter((r) => !r.migrated);
  const auto = missing.filter((r) => r.convertible);
  const manual = missing.filter((r) => !r.convertible);
  const managed = rows.filter((r) => r.managed).length;
  const disabled = rows.length - enabled.length;
  const quiet = missing.filter((r) => r.problems === 0);
  const p = enabled.length ? Math.round((migrated.length / enabled.length) * 100) : 100;
  const list = (xs: NotificationInsightRow[]) => `${xs.slice(0, 3).map((r) => r.name).join(", ")}${xs.length > 3 ? ", …" : ""}`;
  const types = Array.from(new Set(manual.map((r) => r.type)));
  const summary = `${migrated.length} of ${enabled.length} enabled classic problem ${plural(enabled.length, "notification")} (${p}%) ${plural(migrated.length, "has", "have")} a workflow with the same name; ${managed} ${plural(managed, "workflow was", "workflows were")} created by the migration. ${disabled} ${plural(disabled, "notification is", "notifications are")} disabled.`;
  const insights: InsightItem[] = [{ severity: sevFor(p), icon: "🔔", text: `${p}% of enabled problem notifications are migrated to simple workflows.` }];
  if (auto.length > 0) insights.push({ severity: "info", icon: "⚙️", text: `${auto.length} of the ${missing.length} remaining can be converted automatically (email, Slack, ServiceNow incident, webhook): ${list(auto)}.` });
  if (manual.length > 0) insights.push({ severity: "warning", icon: "✍️", text: `${manual.length} ${plural(manual.length, "needs", "need")} a manual upgrade (${types.join(", ")}): ${list(manual)}.` });
  if (quiet.length > 0) insights.push({ severity: "info", icon: "💤", text: `${quiet.length} remaining ${plural(quiet.length, "notification's alerting profile", "notifications' alerting profiles")} matched no problem in the last 7 days: ${list(quiet)}.` });
  const gen2 = enabled.filter((r) => r.gen2.length > 0);
  const labelOnly = enabled.filter((r) => !r.translatable);
  if (gen2.length > 0) insights.push({ severity: "warning", icon: "🧓", text: `${gen2.length} enabled ${plural(gen2.length, "notification uses an alerting profile", "notifications use alerting profiles")} with Gen 2 concepts (${Array.from(new Set(gen2.flatMap((r) => r.gen2))).join(", ")}): ${list(gen2)}.` });
  if (labelOnly.length > 0) insights.push({ severity: "info", icon: "🏷️", text: `${labelOnly.length} ${plural(labelOnly.length, "profile cannot", "profiles cannot")} be translated to DQL (management zone, regular expression or missing profile), so ${plural(labelOnly.length, "its workflow filters", "their workflows filter")} on the deprecated labels.alerting_profile: ${list(labelOnly)}.` });
  const recommendations: RecommendationItem[] = [];
  if (auto.length > 0) recommendations.push({ impact: "high", text: "Use Convert to simple workflows: Validate counts the problems each trigger would have fired for before anything is created." });
  if (managed > 0 || auto.length > 0) recommendations.push({ impact: "high", text: "Open each Slack and ServiceNow workflow and select a connection; until then their runs fail." });
  if (gen2.length > 0) recommendations.push({ impact: "medium", text: "Replace classic tags, management zones and classic event types in the alerting profiles with primary tags and primary fields, then translate again: entity_tags is deprecated." });
  if (manual.length > 0) recommendations.push({ impact: "medium", text: "Upgrade the rest manually with the matching connector (Jira, PagerDuty, Microsoft Teams, Red Hat Ansible) or an HTTP Request." });
  if (disabled > 0 || quiet.length > 0) recommendations.push({ impact: "medium", text: "Delete disabled and stale notifications instead of migrating them." });
  recommendations.push({ impact: "low", text: "Run workflows and classic notifications side by side, compare what both send, then disable the classic ones." });
  return { summary, insights, recommendations };
}

export type DimensionalInsightRow ={ title: string; total: number; props: { label: string; pct: number }[] };

export function analyzeDimensional(rows: DimensionalInsightRow[]): AIInsightsData {
  const withData = rows.filter((r) => r.total > 0);
  if (withData.length === 0) {
    return {
      summary: "No metrics, logs or events were returned for this timeframe, so dimensional data could not be scored.",
      insights: [{ severity: "info", icon: "ℹ️", text: "Dimensional data results are empty or still loading." }],
      recommendations: [],
    };
  }
  const empty = withData.flatMap((r) => r.props.filter((p) => p.pct === 0).map((p) => ({ data: r.title, prop: p.label })));
  const lowest = withData.flatMap((r) => r.props.map((p) => ({ data: r.title, prop: p.label, pct: p.pct }))).sort((a, b) => a.pct - b.pct)[0];
  const avg = Math.round(withData.flatMap((r) => r.props).reduce((s, p) => s + p.pct, 0) / withData.flatMap((r) => r.props).length);
  const summary = `Dimensional data (${withData.map((r) => r.title.toLowerCase()).join(", ")}) averages ${avg}% coverage of security context and cost tags; results for logs, events and business events are scan-limited estimates.`;
  const insights: InsightItem[] = [];
  if (empty.length > 0) insights.push({ severity: "critical", icon: "🚨", text: `Not present on any sampled record: ${empty.map((e) => `${e.prop} on ${e.data.toLowerCase()}`).join(", ")}.` });
  if (lowest && lowest.pct > 0) insights.push({ severity: sevFor(lowest.pct), icon: "📉", text: `Weakest: ${lowest.prop} on ${lowest.data.toLowerCase()} at ${lowest.pct}%.` });
  const recommendations: RecommendationItem[] = [
    { impact: "high", text: "Set security context and cost tags at ingest with OpenPipeline processing so logs, events and metrics carry them regardless of entity enrichment." },
  ];
  return { summary, insights, recommendations };
}


export type FrontendInsightRow = {
  name: string;
  rumClassic: boolean;
  rumV2: boolean;
  replayClassic: boolean;
  replayGrail: boolean;
  monitors: number;
  healthAlerts: number;
  userTagRules: number | null;
  owner: string | null;
  score: number;
};

export function analyzeFrontends(apps: FrontendInsightRow[], userTagsMeasured: boolean): AIInsightsData {
  if (apps.length === 0) {
    return {
      summary: "No web frontends were returned for this timeframe, so no frontend checks could be scored.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No dt.entity.application entities found. Widen the timeframe or confirm RUM is injecting into your frontends." }],
      recommendations: [{ impact: "medium", text: "Set up RUM for at least one web frontend, then re-check." }],
    };
  }
  const n = apps.length;
  const avg = Math.round(apps.reduce((s, a) => s + a.score, 0) / n);
  const v2 = apps.filter((a) => a.rumV2);
  const classicOnly = apps.filter((a) => a.rumClassic && !a.rumV2);
  const noRum = apps.filter((a) => !a.rumClassic);
  const replayGrail = apps.filter((a) => a.replayGrail);
  const noReplay = apps.filter((a) => !a.replayClassic);
  const noSynth = apps.filter((a) => a.monitors === 0);
  const noAlerts = apps.filter((a) => a.healthAlerts === 0);
  const noTags = apps.filter((a) => a.userTagRules === 0);
  const noOwner = apps.filter((a) => !a.owner);
  const list = (xs: FrontendInsightRow[]) => `${xs.slice(0, 4).map((a) => a.name).join(", ")}${xs.length > 4 ? ", …" : ""}`;
  const summary = `${n} web ${plural(n, "frontend")} average ${avg}% across the frontend checks. ${v2.length} ${plural(v2.length, "has", "have")} RUM v2 enabled, ${replayGrail.length} ${plural(replayGrail.length, "records", "record")} Session Replay on Grail, ${n - noSynth.length} ${plural(n - noSynth.length, "has", "have")} synthetic monitors and ${n - noAlerts.length} ${plural(n - noAlerts.length, "has", "have")} health alerts.`;

  const insights: InsightItem[] = [{ severity: sevFor(Math.round((v2.length / n) * 100)), icon: "🌐", text: `${v2.length} of ${n} frontends send RUM data to Grail (RUM v2).` }];
  if (classicOnly.length > 0) insights.push({ severity: "warning", icon: "🕰️", text: `RUM classic only (scored 50%): ${list(classicOnly)}.` });
  if (noRum.length > 0) insights.push({ severity: "critical", icon: "🚫", text: `RUM disabled: ${list(noRum)}.` });
  if (noReplay.length > 0) insights.push({ severity: "warning", icon: "🎬", text: `Session Replay off: ${list(noReplay)}.` });
  if (noSynth.length > 0) insights.push({ severity: noSynth.length === n ? "critical" : "warning", icon: "🤖", text: `No synthetic monitor assigned: ${list(noSynth)}.` });
  if (noAlerts.length > 0) insights.push({ severity: noAlerts.length === n ? "critical" : "warning", icon: "🔔", text: `No enabled health alert: ${list(noAlerts)}.` });
  if (!userTagsMeasured) insights.push({ severity: "info", icon: "🔑", text: "User tagging is not measured yet: the ReadConfig token is missing from the credential vault, so it is left out of the averages." });
  else if (noTags.length > 0) insights.push({ severity: "warning", icon: "🏷️", text: `No user tag rule: ${list(noTags)}.` });
  if (noOwner.length > 0) insights.push({ severity: noOwner.length === n ? "critical" : "warning", icon: "👥", text: `No owning team (dt.owner / owner / team tag): ${list(noOwner)}.` });

  const recommendations: RecommendationItem[] = [];
  if (classicOnly.length > 0 || noRum.length > 0) recommendations.push({ impact: "high", text: "Use Actions › Enable RUM v2 to switch every remaining frontend to the New RUM Experience in one request." });
  if (noAlerts.length > 0) recommendations.push({ impact: "high", text: "Use Actions › Create health alerts to add the recommended Web Vitals, user action duration and error alerts to every frontend without one." });
  if (noSynth.length > 0) recommendations.push({ impact: "medium", text: "Assign at least one browser or HTTP monitor to each important frontend (Actions › Assign an existing synthetic monitor, or create one in Synthetic)." });
  if (apps.length - replayGrail.length > 0) recommendations.push({ impact: "medium", text: "Enable Session Replay on Grail where you need visual reproduction of user issues; validate first, as it depends on license and storage." });
  if (!userTagsMeasured) recommendations.push({ impact: "medium", text: "Use Actions › Set up the user tagging token (the app can create the ReadConfig token for you) to score user tagging." });
  else if (noTags.length > 0) recommendations.push({ impact: "medium", text: "Configure a user tag rule (or call dtrum.identifyUser) so sessions can be traced back to a user." });
  if (noOwner.length > 0) recommendations.push({ impact: "medium", text: "Use Actions › Assign owning team to tag frontends with dt.owner:<team> so problems and alerts route to the right team." });
  return { summary, insights, recommendations };
}

export type DeepTechRow = { label: string; total: number; deep: number; pct: number };
export type DeepSelection = { name: string; failing: string[]; deep: boolean };

export function analyzeDeepMonitoring(rows: DeepTechRow[], notScored: { label: string; total: number }[], selection: DeepSelection | null): AIInsightsData {
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (total === 0) {
    return {
      summary: "No processes of a technology OneAgent can deep monitor were found for this timeframe.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No process group instances returned. Widen the timeframe or confirm OneAgent is installed in Full-Stack mode." }],
      recommendations: [{ impact: "medium", text: "Install OneAgent in Full-Stack mode on application hosts, restart the applications, then re-check." }],
    };
  }
  const deep = rows.reduce((s, r) => s + r.deep, 0);
  const overall = Math.round((deep / total) * 100);
  const sorted = rows.slice().sort((a, b) => b.total - b.deep - (a.total - a.deep));
  const biggest = sorted[0];
  const none = rows.filter((r) => r.deep === 0 && r.total > 0);
  const full = rows.filter((r) => r.deep === r.total);
  const summary = `${deep.toLocaleString()} of ${total.toLocaleString()} processes of deep-monitorable technologies (${overall}%) have a OneAgent code module across ${rows.length} ${plural(rows.length, "technology", "technologies")}. ${full.length} ${plural(full.length, "technology is", "technologies are")} fully covered.`;

  const insights: InsightItem[] = [{ severity: sevFor(overall), icon: "🔬", text: `Overall deep monitoring coverage is ${overall}%.` }];
  if (biggest && biggest.total > biggest.deep) insights.push({ severity: sevFor(biggest.pct), icon: "📉", text: `Largest gap: ${(biggest.total - biggest.deep).toLocaleString()} ${biggest.label} processes without a code module (${biggest.pct}% covered).` });
  if (none.length) insights.push({ severity: "critical", icon: "🚨", text: `No code module at all: ${none.slice(0, 5).map((r) => `${r.label} (${r.total})`).join(", ")}.` });
  if (notScored.length) insights.push({ severity: "info", icon: "🧩", text: `Not scored (no OneAgent code module): ${notScored.slice(0, 5).map((r) => `${r.label} (${r.total})`).join(", ")}${notScored.length > 5 ? ", …" : ""}.` });
  if (selection) {
    insights.push(
      selection.deep
        ? { severity: "good", icon: "✅", text: `${selection.name} is deep monitored.` }
        : { severity: selection.failing.length ? "critical" : "warning", icon: "🩺", text: `${selection.name}: ${selection.failing.length ? `blocked by ${selection.failing.join(", ").toLowerCase()}` : "nothing in the settings blocks injection; restart the process"}.` },
    );
  }

  const recommendations: RecommendationItem[] = [];
  if (biggest && biggest.total > biggest.deep) recommendations.push({ impact: "high", text: `Search for ${biggest.label} processes that are not deep monitored and run Diagnose on the biggest process group; the remediation section shows the setting that blocks it.` });
  recommendations.push({ impact: "medium", text: "Most gaps without a blocking setting are processes started before OneAgent was installed: restart them (or roll out the pods) to inject the code module." });
  if (notScored.length) recommendations.push({ impact: "low", text: "Cover technologies without a code module with OpenTelemetry or an extension instead." });
  return { summary, insights, recommendations };
}

export type DatabaseTechRow = { label: string; both: number; extensionOnly: number; oneAgentOnly: number; extensionActive: boolean | null };
export type DatabaseSelection = { name: string; tech: string; covered: boolean; blocking: string[] };

export function analyzeDatabases(rows: DatabaseTechRow[], failingExtensions: { label: string; problems: number }[], selection: DatabaseSelection | null): AIInsightsData {
  const both = rows.reduce((s, r) => s + r.both, 0);
  const extOnly = rows.reduce((s, r) => s + r.extensionOnly, 0);
  const oaOnly = rows.reduce((s, r) => s + r.oneAgentOnly, 0);
  const total = both + extOnly + oaOnly;
  if (total === 0) {
    return {
      summary: "No database instances or database server processes were found for this timeframe.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No DB instance from a database extension and no database server process seen by OneAgent. Widen the timeframe, or add a database extension from Dynatrace Hub." }],
      recommendations: [{ impact: "medium", text: "Add the extension for your database technology from Dynatrace Hub and add the database in the Databases app." }],
    };
  }
  const covered = both + extOnly;
  const pct = Math.round((covered / total) * 100);
  const seen = both + oaOnly;
  const seenPct = seen ? Math.round((both / seen) * 100) : 100;
  const gaps = rows.filter((r) => r.oneAgentOnly > 0).sort((a, b) => b.oneAgentOnly - a.oneAgentOnly);
  const noExtension = gaps.filter((r) => r.extensionActive === false);
  const summary = `${covered.toLocaleString()} of ${total.toLocaleString()} databases (${pct}%) are monitored by a database extension across ${rows.length} ${plural(rows.length, "technology", "technologies")}. ${oaOnly.toLocaleString()} ${plural(oaOnly, "database server is", "database servers are")} seen only by OneAgent, as processes without database insights.`;

  const insights: InsightItem[] = [
    { severity: sevFor(pct), icon: "🗄️", text: `Extension coverage is ${pct}% of all databases.` },
    { severity: sevFor(seenPct), icon: "🔗", text: `${both.toLocaleString()} of ${seen.toLocaleString()} database servers OneAgent sees (${seenPct}%) also have an extension.` },
  ];
  if (gaps.length) insights.push({ severity: "warning", icon: "📉", text: `OneAgent only: ${gaps.slice(0, 5).map((r) => `${r.label} (${r.oneAgentOnly})`).join(", ")}${gaps.length > 5 ? ", …" : ""}.` });
  if (noExtension.length) insights.push({ severity: "critical", icon: "🧩", text: `No active extension in the environment for ${noExtension.map((r) => r.label).join(", ")}.` });
  if (extOnly) insights.push({ severity: "info", icon: "☁️", text: `${extOnly.toLocaleString()} ${plural(extOnly, "database is", "databases are")} monitored only by an extension (remote or managed databases, or hosts without OneAgent).` });
  if (failingExtensions.length) insights.push({ severity: "critical", icon: "🚨", text: `Configurations not running: ${failingExtensions.map((f) => `${f.label} (${f.problems})`).join(", ")}.` });
  if (selection) {
    insights.push(
      selection.covered
        ? { severity: "good", icon: "✅", text: `${selection.name} is already monitored by its extension.` }
        : { severity: selection.blocking.length ? "critical" : "warning", icon: "🩺", text: `${selection.name} (${selection.tech}): ${selection.blocking.length ? `blocked by ${selection.blocking.join(", ").toLowerCase()}` : "ready for a monitoring configuration"}.` },
    );
  }

  const recommendations: RecommendationItem[] = [];
  if (gaps.length) recommendations.push({ impact: "high", text: `Select Configure on a OneAgent-only ${gaps[0].label} database: the remediation section checks the extension, the ActiveGate group and existing configurations, then creates the monitoring configuration.` });
  if (noExtension.length) recommendations.push({ impact: "high", text: `Add the ${noExtension[0].label} extension from Dynatrace Hub before configuring those databases.` });
  if (failingExtensions.length) recommendations.push({ impact: "medium", text: "Open the failing configurations in the Extensions app (ActiveGates tab, extension messages, shows the reason)." });
  recommendations.push({ impact: "low", text: "Store monitoring users in the credential vault (scope Extension authentication) instead of passwords in configurations." });
  return { summary, insights, recommendations };
}

export type ExtensionsInsightInput = {
  /** Enabled configurations with a status that can be judged, and how many of them are broken. */
  judged: number;
  broken: number;
  kinds: { label: string; total: number; broken: number }[];
  statuses: { status: string; n: number }[];
  fastcheckFailed: string[];
  staleScopes: string[];
  noData: string[];
  disabled: number;
  apiError: string | null;
  recs: { label: string; hubName: string; hosts: number; uncoveredHosts: number; installed: boolean | null; configs: number }[];
  /** SNMP Autodiscovery and SNMP device extensions: none, installed (no configuration), broken, in-use, unknown. */
  snmp: { label: string; hubName: string; state: string }[];
  selection: { name: string; failing: string[] } | null;
};

export function analyzeExtensions(d: ExtensionsInsightInput): AIInsightsData {
  const ok = d.judged - d.broken;
  const pct = d.judged ? Math.round((ok / d.judged) * 100) : 100;
  const gaps = d.recs.filter((r) => r.uncoveredHosts > 0);
  const kindText = d.kinds.filter((k) => k.total).map((k) => `${k.total} ${k.label.toLowerCase()}`).join(", ");
  const summary = d.judged
    ? `${ok} of ${d.judged} enabled extension monitoring ${plural(d.judged, "configuration")} (${pct}%) run without errors${kindText ? ` (${kindText})` : ""}. ${gaps.length ? `${gaps.length} ${plural(gaps.length, "technology", "technologies")} OneAgent sees on processes ${plural(gaps.length, "has", "have")} a Hub extension that does not report from all their hosts.` : "Every technology with a recommended extension is covered."}`
    : "No extension monitoring configuration reports a status in this timeframe.";

  const insights: InsightItem[] = [];
  if (d.apiError) insights.push({ severity: "warning", icon: "🔒", text: `The Extensions API was not readable (${d.apiError}): scopes and configurations that never ran are missing, statuses come from DQL only.` });
  if (d.judged) insights.push({ severity: sevFor(pct), icon: "🧩", text: `${pct}% of configurations are OK or idle.` });
  for (const k of d.kinds.filter((x) => x.broken)) insights.push({ severity: "critical", icon: "🚨", text: `${k.label}: ${k.broken} of ${k.total} not running as configured.` });
  if (d.statuses.length) insights.push({ severity: "warning", icon: "📋", text: `Broken by status: ${d.statuses.map((s) => `${s.status} (${s.n})`).join(", ")}.` });
  if (d.fastcheckFailed.length) insights.push({ severity: "critical", icon: "⛔", text: `Fastcheck failed for ${d.fastcheckFailed.slice(0, 5).join(", ")}${d.fastcheckFailed.length > 5 ? ", …" : ""}: the framework does not assign them to an ActiveGate.` });
  if (d.staleScopes.length) insights.push({ severity: "critical", icon: "👻", text: `${d.staleScopes.length} ${plural(d.staleScopes.length, "configuration targets a host", "configurations target hosts")} not seen in 30 days: ${d.staleScopes.slice(0, 4).join(", ")}${d.staleScopes.length > 4 ? ", …" : ""}.` });
  if (d.noData.length) insights.push({ severity: "warning", icon: "🕳️", text: `Enabled but silent (no status, no framework error): ${d.noData.slice(0, 5).join(", ")}${d.noData.length > 5 ? ", …" : ""}.` });
  if (d.disabled) insights.push({ severity: "info", icon: "⏸️", text: `${d.disabled} ${plural(d.disabled, "configuration is", "configurations are")} disabled.` });
  if (gaps.length) insights.push({ severity: "warning", icon: "💡", text: `Not covered by an extension: ${gaps.slice(0, 5).map((r) => `${r.label} (${r.uncoveredHosts} ${plural(r.uncoveredHosts, "host")})`).join(", ")}${gaps.length > 5 ? ", …" : ""}.` });
  const snmpOff = d.snmp.filter((s) => s.state === "none" || s.state === "installed");
  if (snmpOff.length) insights.push({ severity: "warning", icon: "📡", text: `Network devices: ${snmpOff.map((s) => `${s.label} ${s.state === "none" ? "not in use" : "installed but not configured"}`).join(", ")}. Routers, switches and firewalls run no OneAgent; SNMP is how Dynatrace sees them.` });
  else if (d.snmp.length && d.snmp.every((s) => s.state === "in-use")) insights.push({ severity: "good", icon: "📡", text: "SNMP Autodiscovery and SNMP device extensions are in use for network devices." });
  if (d.selection) insights.push({ severity: d.selection.failing.length ? "critical" : "good", icon: "🩺", text: d.selection.failing.length ? `${d.selection.name}: ${d.selection.failing.join(", ").toLowerCase()}.` : `${d.selection.name}: no blocking check.` });

  const recommendations: RecommendationItem[] = [];
  if (d.fastcheckFailed.length) recommendations.push({ impact: "high", text: "Fix the endpoint, credentials or network path named in the fastcheck log; until the check passes the configuration collects nothing." });
  if (d.staleScopes.length) recommendations.push({ impact: "high", text: "Delete configurations scoped to hosts that are gone, or scope them to a host group so replacement hosts get them." });
  if (d.broken) recommendations.push({ impact: "medium", text: "Select Fix on a broken configuration for its checks (scope, ActiveGate group, fastcheck, latest error) and the documented steps." });
  const auto = snmpOff.find((s) => s.hubName === "SNMP Autodiscovery");
  if (auto) recommendations.push({ impact: "medium", text: `${auto.state === "none" ? "Add SNMP Autodiscovery from Dynatrace Hub and configure" : "Configure"} it with your subnets: it inventories SNMP-enabled devices and points each one to the extension that monitors it.` });
  const devices = snmpOff.find((s) => s.hubName !== "SNMP Autodiscovery");
  if (devices) recommendations.push({ impact: "medium", text: `Monitor network devices with ${devices.hubName} (or the vendor SNMP extension: Cisco, Juniper, F5 BIG-IP, Palo Alto) for interface, traffic and SNMP health metrics.` });
  const top = gaps.find((r) => r.installed === false) ?? gaps[0];
  if (top) recommendations.push({ impact: "medium", text: top.installed === false ? `Add ${top.hubName} from Dynatrace Hub for ${top.label} (${top.uncoveredHosts} ${plural(top.uncoveredHosts, "host")}).` : `Add or widen a ${top.hubName} monitoring configuration for ${top.label} (${top.uncoveredHosts} ${plural(top.uncoveredHosts, "host")}).` });
  recommendations.push({ impact: "low", text: "Prefer host group or environment scopes for local extensions: host-scoped configurations break silently when hosts are replaced." });
  return { summary, insights, recommendations };
}

export type Sdv2InsightInput = {
  total: number;
  sdv2: number;
  verdicts: Record<"SDV2" | "ENABLE" | "PILOT" | "REVIEW" | "KEEP", number>;
  /** Scopes with SDv1 services and their verdict (namespaces, host groups, Lambda). */
  scopes: Array<{ label: string; verdict: string; sdv1: number; after: number; dependents: number }>;
  /** Built-in rules that differ from the docs' recommendation. */
  ruleGaps: string[];
  enabledScopes: number;
  /** null = the settings could not be read. */
  settingsRead: boolean;
  docsChanged: number;
  docsNew: number;
};

export function analyzeSdv2(d: Sdv2InsightInput): AIInsightsData {
  if (d.total === 0) {
    return {
      summary: "No services were returned for this timeframe, so Service Detection v2 adoption cannot be assessed.",
      insights: [{ severity: "info", icon: "ℹ️", text: "Smartscape has no SERVICE nodes in the window. Widen the timeframe or check that traces are ingested." }],
      recommendations: [{ impact: "low", text: "Re-check once OneAgent or OpenTelemetry services report requests." }],
    };
  }
  const v = d.verdicts;
  const p = Math.round((d.sdv2 / d.total) * 100);
  const sdv1 = d.total - d.sdv2;
  const summary = `${d.sdv2} of ${d.total} ${plural(d.total, "service")} (${p}%) ${plural(d.sdv2, "is", "are")} detected by Service Detection v2. Of the ${sdv1} SDv1 ${plural(sdv1, "service")}, ${v.ENABLE} can move now (Kubernetes / AWS Lambda, generally available), ${v.PILOT + v.REVIEW} ${plural(v.PILOT + v.REVIEW, "fits", "fit")} the Early Access for generic workloads and ${v.KEEP} should stay on SDv1 for now.`;
  const insights: InsightItem[] = [{ severity: sevFor(p), icon: "🧭", text: `${p}% of services use SDv2. SDv2 names services from resource attributes (k8s.workload.name, service.name) and makes one service per process.` }];
  const enable = d.scopes.filter((s) => s.verdict === "ENABLE");
  if (enable.length) {
    const top = enable.slice().sort((a, b) => b.sdv1 - a.sdv1).slice(0, 3);
    insights.push({ severity: "warning", icon: "☸️", text: `${enable.length} Kubernetes / Lambda ${plural(enable.length, "scope")} still on SDv1, largest: ${top.map((s) => `${s.label} (${s.sdv1} SDv1 → ~${s.after} SDv2)`).join(", ")}.` });
  }
  const fragmented = d.scopes.filter((s) => s.sdv1 > s.after * 2 && s.after > 0);
  if (fragmented.length) insights.push({ severity: "info", icon: "🧩", text: `${fragmented.length} ${plural(fragmented.length, "scope")} split one workload into several SDv1 services; SDv2 would consolidate them (for example ${fragmented[0].label}: ${fragmented[0].sdv1} → ~${fragmented[0].after}).` });
  if (v.KEEP) insights.push({ severity: "info", icon: "🛑", text: `${v.KEEP} SDv1 ${plural(v.KEEP, "service")} should stay on SDv1 for now: application servers or multi-application processes, background work without inbound requests, mainframe, or no OneAgent context.` });
  if (v.REVIEW) insights.push({ severity: "warning", icon: "🔎", text: `${v.REVIEW} custom ${plural(v.REVIEW, "service")} would be absorbed into their process's SDv2 service: check that nothing relies on them as separate services.` });
  const pinned = d.scopes.reduce((s, x) => s + (x.verdict !== "KEEP" && x.verdict !== "DONE" ? x.dependents : 0), 0);
  if (pinned) insights.push({ severity: "warning", icon: "🔗", text: `${pinned} frontend / HTTP-monitor ${plural(pinned, "reference")} point at SDv1 services in scopes that can switch; SDv2 assigns new service IDs.` });
  if (!d.settingsRead) insights.push({ severity: "warning", icon: "⚠️", text: "The SDv2 settings could not be read, so the current switches and rule recommendations are unknown." });
  else if (d.ruleGaps.length) insights.push({ severity: "warning", icon: "⚙️", text: `${d.ruleGaps.length} built-in ${plural(d.ruleGaps.length, "rule differs", "rules differ")} from the docs' recommendation: ${d.ruleGaps.slice(0, 3).join("; ")}${d.ruleGaps.length > 3 ? "; …" : ""}.` });
  if (d.settingsRead && d.enabledScopes === 0) insights.push({ severity: "info", icon: "🔌", text: "SDv2 for OneAgent is not switched on at any scope yet (environment, host group, cluster or namespace)." });
  if (d.docsChanged || d.docsNew) insights.push({ severity: "warning", icon: "📚", text: `The SDv2 docs changed since this guidance was reviewed: ${d.docsChanged} updated, ${d.docsNew} new ${plural(d.docsNew, "page")}. Read them before acting.` });

  const recommendations: RecommendationItem[] = [];
  if (d.settingsRead && d.ruleGaps.length) recommendations.push({ impact: "high", text: "Fix the built-in rules first (Remediation actions > Apply recommended built-in rules), so services get their final IDs once." });
  if (enable.length) recommendations.push({ impact: "high", text: "Enable SDv2 for Kubernetes namespace by namespace, starting in lower environments; use the matching condition to limit it further (for example by dt.agent.module.type)." });
  if (v.ENABLE && d.scopes.some((s) => s.label === "AWS Lambda functions" && s.verdict === "ENABLE")) recommendations.push({ impact: "medium", text: "Enable SDv2 for FaaS at the environment with the default condition (AWS region and account present)." });
  if (v.PILOT) recommendations.push({ impact: "medium", text: "Pilot SDv2 for generic workloads (Early Access) on one host group of web servers or single-service apps; add URL path pattern rules where endpoints show GET /*." });
  if (pinned || enable.length) recommendations.push({ impact: "medium", text: "Before each switch, list dashboards, alerts and SLOs that reference the SDv1 services and update them to the new SDv2 IDs afterwards." });
  recommendations.push({ impact: "low", text: "Keep names clean: add context with primary Grail fields and tags, and set OTEL_SERVICE_NAME where a service needs a specific name." });
  return { summary, insights, recommendations };
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${plural(n, one, many)}`;

export type IamPolicyInsightInput = {
  statements: number;
  errors: number;
  warnings: number;
  permissions: number;
  services: number;
  /** ALLOW statements granting a Grail table permission without a condition. */
  unconditionalGrail: string[];
  bucketsMissing: boolean;
  denyConditionalGrail: string[];
  denyUnconditional: number;
  appsMode: "off" | "all" | "selected";
  apps: number;
  /** Selected apps whose required Grail data the policy does not grant (step 2 not done). */
  appsNeedingData: string[];
  /** Step 2 grants data permissions without any dimensional data. */
  dataUnscoped: boolean;
  dims: string[];
  dimMode: "all" | "any";
  /** Security context restricted with =, IN or startsWith (lists on a record only match with MATCH). */
  securityContextWithoutMatch: boolean;
  bindParams: number;
  unknownPermissions: string[];
  manual: boolean;
  liveDocs: boolean;
  docChanges: number;
};

export function analyzeIamPolicy(d: IamPolicyInsightInput): AIInsightsData {
  if (d.statements === 0) {
    return {
      summary: "The policy is empty. Pick apps, dimensional data and permissions on the left, or paste an existing policy into the editor and load it into the builder.",
      insights: [
        {
          severity: "info",
          icon: "ℹ️",
          text: d.liveDocs
            ? "The permission list is read live from the IAM policy reference, so new permissions show up without an app update."
            : "The permission list comes from the bundled snapshot because the live IAM policy reference could not be read.",
        },
      ],
      recommendations: [
        { impact: "medium", text: "Start from the data: choose the security context, buckets or Kubernetes namespaces a team may read, then add the table permissions (storage:logs:read, storage:spans:read, …) and storage:buckets:read." },
        { impact: "low", text: "Use Start from to load a policy pattern from the docs and narrow it." },
      ],
    };
  }
  const summary = `${count(d.statements, "statement")} (of 100 allowed) granting ${count(d.permissions, "permission")} across ${count(d.services, "service")}; the editor reports ${count(d.errors, "error")} and ${count(d.warnings, "warning")}.${d.manual ? " The text was edited by hand, so this reads the editor, not the selections." : ""}`;
  const insights: InsightItem[] = [];
  if (d.errors) insights.push({ severity: "critical", icon: "🚨", text: `${count(d.errors, "error")} in the policy text: unsupported conditions or operators, or syntax the policy language does not accept. Hover the underlined text for details.` });
  if (d.unconditionalGrail.length) {
    const list = `${d.unconditionalGrail.slice(0, 4).join(", ")}${d.unconditionalGrail.length > 4 ? ", …" : ""}`;
    const one = d.unconditionalGrail.length === 1;
    insights.push({ severity: "warning", icon: "🔓", text: `${list} ${one ? "is" : "are"} granted without conditions: every record in ${one ? "that table" : "those tables"}, and record-level conditions in the user's other policies stop mattering.` });
  }
  if (d.bucketsMissing) insights.push({ severity: "warning", icon: "🪣", text: "Grail table permissions are granted but storage:buckets:read is not, so queries return nothing from the buckets that hold the data." });
  if (d.denyConditionalGrail.length) insights.push({ severity: "warning", icon: "⛔", text: `Conditional DENY on ${d.denyConditionalGrail.join(", ")} runs as an unconditional DENY (only storage:buckets:read supports conditional DENY).` });
  if (d.denyUnconditional) insights.push({ severity: "warning", icon: "⛔", text: `${count(d.denyUnconditional, "unconditional DENY statement")} block${d.denyUnconditional === 1 ? "s" : ""} those permissions for everyone the policy is bound to, whatever other policies grant. Boundaries never soften a DENY.` });
  if (d.appsMode === "all") insights.push({ severity: "info", icon: "🧩", text: "app-engine:apps:run is granted without a condition: every installed app, including apps installed later." });
  else if (d.appsMode === "selected") insights.push({ severity: "good", icon: "🧩", text: `App access is limited to ${count(d.apps, "app")}, each on its own app-engine:apps:run line with shared:app-id.` });
  if (d.appsNeedingData.length)
    insights.push({ severity: "warning", icon: "📭", text: `${d.appsNeedingData.join(", ")} ${d.appsNeedingData.length === 1 ? "shows" : "show"} Grail data the policy does not grant yet, so ${d.appsNeedingData.length === 1 ? "it opens" : "they open"} empty.` });
  if (d.dataUnscoped) insights.push({ severity: "warning", icon: "🌐", text: "Data access from step 2 is not limited by any dimensional data: the group reads every record of those tables." });
  if (d.dims.length)
    insights.push({ severity: "good", icon: "🎯", text: `Record access is limited by ${d.dims.join(", ")} (${d.dimMode === "all" ? "records must match every dimension a permission supports" : "one statement per dimension: a record matching any of them is visible"}).` });
  if (d.securityContextWithoutMatch) insights.push({ severity: "info", icon: "🏷️", text: "dt.security_context is matched with =, IN or startsWith. Records that carry a list of security contexts only match with MATCH." });
  if (d.unknownPermissions.length)
    insights.push({ severity: "warning", icon: "❓", text: `Not in the IAM policy reference: ${d.unknownPermissions.slice(0, 4).join(", ")}${d.unknownPermissions.length > 4 ? ", …" : ""}. Check the spelling, or whether the permission was renamed.` });
  if (d.statements > 80) insights.push({ severity: "warning", icon: "📏", text: `${d.statements} statements is close to the limit of 100 per policy. Combine permissions that share conditions, or split the policy.` });
  if (d.bindParams) insights.push({ severity: "info", icon: "🧷", text: `${count(d.bindParams, "binding parameter")} (\${bindParam:…}): their values are set when the policy is bound to a group, through the Account Management API only.` });
  if (!d.liveDocs) insights.push({ severity: "warning", icon: "📚", text: "The live IAM policy reference could not be read; checks use the bundled snapshot, which may miss recent permission changes." });
  else if (d.docChanges) insights.push({ severity: "info", icon: "📚", text: `The live IAM policy reference has ${count(d.docChanges, "change")} since the bundled snapshot; the pickers and checks already use the live version.` });

  const recommendations: RecommendationItem[] = [];
  if (d.errors) recommendations.push({ impact: "high", text: "Fix the errors listed under the editor first; each one names the line and the conditions or operators the permission supports." });
  if (d.appsNeedingData.length) recommendations.push({ impact: "high", text: "Open step 2 (Data access), choose Add data access and limit the records with dimensional data such as security context or Grail bucket." });
  if (d.dataUnscoped) recommendations.push({ impact: "medium", text: "In step 2, set at least one dimension (security context, bucket, host group or Kubernetes namespace) so the group only reads its own data." });
  if (d.unconditionalGrail.length) recommendations.push({ impact: "high", text: "Add a data scope (Dimensional data) to the table permissions, or keep them unconditional here and bind the policy with one boundary per team (IAM Boundary Creator)." });
  if (d.bucketsMissing) recommendations.push({ impact: "high", text: "Add storage:buckets:read, limited with storage:bucket-name or storage:table-name to the buckets the team may read." });
  if (d.securityContextWithoutMatch) recommendations.push({ impact: "medium", text: 'Use MATCH for dt.security_context (e.g. MATCH ("TeamA")) if any data source sets several security contexts on a record.' });
  if (d.denyConditionalGrail.length || d.denyUnconditional) recommendations.push({ impact: "medium", text: "Replace DENY statements with narrower ALLOW statements where possible; DENY overrules every ALLOW and is hard to reason about across policies." });
  if (d.dims.length && !d.bindParams) recommendations.push({ impact: "low", text: "If several teams need the same permissions for different data, write the permissions once and move the data scope into one boundary per team, or use ${bindParam:…} templating." });
  recommendations.push({ impact: "low", text: d.errors ? "Once the errors are fixed, an admin of this app can send the policy with Create in Account Management below the editor (the API validates it first), or copy it into Account Management > Identity & access management > Policy management. Then bind it to a group." : "An admin of this app can send the policy with Create in Account Management below the editor (the API validates it first; choose this environment or the whole account), or copy it into Account Management > Identity & access management > Policy management. It grants nothing until it is bound to a group." });
  return { summary, insights, recommendations };
}

export type IamBoundaryInsightInput = {
  conditions: number;
  errors: number;
  warnings: number;
  services: string[];
  repeated: string[];
  globals: string[];
  /** null = no policy to preview against. */
  preview: { statements: number; effective: number; notNarrowed: string[]; deny: number } | null;
  liveDocs: boolean;
};

export function analyzeIamBoundary(d: IamBoundaryInsightInput): AIInsightsData {
  if (d.conditions === 0) {
    return {
      summary: "The boundary is empty. Pick apps, dimensional data or other conditions on the left; each becomes one line of the boundary.",
      insights: [{ severity: "info", icon: "ℹ️", text: "A boundary restricts nothing on its own: it is selected when a policy is assigned to a group, and only narrows the permissions that support its conditions." }],
      recommendations: [{ impact: "medium", text: "Pair a boundary with a broad policy (for example a default policy such as Read Logs) so one policy serves many teams with different data scopes." }],
    };
  }
  const summary = `${count(d.conditions, "condition")} (of 10 allowed) for ${d.services.join(", ") || "no service"}; the editor reports ${count(d.errors, "error")} and ${count(d.warnings, "warning")}.`;
  const insights: InsightItem[] = [];
  if (d.errors) insights.push({ severity: "critical", icon: "🚨", text: `${count(d.errors, "error")}: boundaries take one condition per line, no AND, at most 10 conditions, and only conditions from the IAM policy reference.` });
  if (d.repeated.length) insights.push({ severity: "info", icon: "✖️", text: `Repeated: ${d.repeated.join(", ")}. Each statement those conditions apply to is multiplied, one copy per line, so matching any of the lines grants access.` });
  if (d.globals.length) insights.push({ severity: "info", icon: "🌐", text: `Global conditions (${d.globals.join(", ")}) apply to every permission of the bound policy.` });
  if (d.preview) {
    const n = d.preview.notNarrowed;
    if (n.length)
      insights.push({ severity: "critical", icon: "🔓", text: `Not narrowed by this boundary: ${n.slice(0, 5).join(", ")}${n.length > 5 ? ", …" : ""}. None of its conditions applies to ${n.length === 1 ? "that permission" : "those permissions"}, so they keep the policy's access (unconditional if the policy sets no condition).` });
    else insights.push({ severity: "good", icon: "✅", text: `Every ALLOW statement of the previewed policy is narrowed: ${count(d.preview.statements, "statement")} become ${count(d.preview.effective, "effective statement")}.` });
    if (d.preview.deny) insights.push({ severity: "info", icon: "⛔", text: `${count(d.preview.deny, "DENY statement")} in the policy ${d.preview.deny === 1 ? "stays" : "stay"} unchanged: boundaries do not apply to DENY.` });
  }
  if (!d.liveDocs) insights.push({ severity: "warning", icon: "📚", text: "The live IAM policy reference could not be read; the checks use the bundled snapshot." });

  const recommendations: RecommendationItem[] = [];
  if (d.errors) recommendations.push({ impact: "high", text: "Fix the errors under the editor; split conditions joined with AND into separate lines (or separate boundaries)." });
  if (d.preview?.notNarrowed.length) recommendations.push({ impact: "high", text: "Add a condition those permissions support (for entities, storage:dt.security_context or storage:entity.type), or leave them out of the policy bound with this boundary." });
  if (d.conditions >= 9) recommendations.push({ impact: "medium", text: "Close to 10 conditions: assign several boundaries to the same policy instead; each boundary is evaluated separately." });
  recommendations.push({ impact: "low", text: "An admin of this app can send the boundary with Create in Account Management below the editor (the API validates it first), or create it in Account Management > Identity & access management > Policy management > Boundaries. It narrows nothing until it is selected when binding a policy to a group." });
  return { summary, insights, recommendations };
}

export type IamAccessInsightInput = {
  mode: "user" | "group" | "draft";
  subject: { kind: "user" | "group" | "draft"; name: string; groups: number } | null;
  /** Account Management OAuth client: n/a for the draft mode. */
  setup: "ok" | "missing" | "failing" | "unknown" | "n/a";
  failure: string | null;
  policies: number;
  boundaries: number;
  statements: number;
  appsLoaded: boolean;
  apps: { total: number; access: number; conditional: number; none: number };
  /** First conditional apps with their reason. */
  conditionalApps: string[];
  /** Apps whose app-engine:apps:run depends on time, the user or an unbound parameter. */
  timeLimited: number;
  /** An unconditional app-engine:apps:run (every app, including apps installed later). */
  allApps: boolean;
  data: { unrestricted: string[]; limited: string[]; conditional: string[]; none: string[]; denied: string[] };
  dimensions: string[];
  unboundParams: number;
  /** The stored client works but its token lacks iam:bindings:read / iam:policies:read / iam:boundaries:read and iam-policies-management. */
  iamScopesMissing: boolean;
};

const IAM_SCOPES_REC: RecommendationItem = { impact: "high", text: "Add iam:bindings:read, iam:policies:read and iam:boundaries:read (or iam-policies-management) to the OAuth client in Account Management; account-idm-read alone only covers the user and group search." };

export function analyzeIamAccess(d: IamAccessInsightInput): AIInsightsData {
  if (!d.subject) {
    const insights: InsightItem[] = [];
    const recommendations: RecommendationItem[] = [];
    if (d.mode !== "draft" && d.setup === "missing")
      insights.push({ severity: "info", icon: "🔑", text: "No OAuth client is stored yet. Users and groups can be found, but their policies are only readable through the Account Management API." });
    if (d.failure) insights.push({ severity: "warning", icon: "⚠️", text: d.failure });
    if (d.mode !== "draft" && d.iamScopesMissing) {
      insights.push({ severity: "warning", icon: "🔐", text: "The stored OAuth client only reads users and groups: testing a user or group also needs the IAM read scopes." });
      recommendations.push(IAM_SCOPES_REC);
    }
    if (d.mode !== "draft" && d.setup !== "ok")
      recommendations.push({ impact: "high", text: "Create a read-only OAuth client (account-idm-read, iam:bindings:read, iam:policies:read, iam:boundaries:read) and save it in Account Management access; leave “Every user of this app” off unless every app user may see the account's IAM setup. On a sprint or dev environment, create it in that stack's Account Management." });
    recommendations.push({ impact: "medium", text: "Use Policy Creator draft to check a new policy (and boundary) before you bind it to a group." });
    return {
      summary: d.mode === "draft" ? "Build a policy in the IAM Policy Creator tab to test it here." : "Search for a user (name or email) or a group (name contains) and click a result to test it.",
      insights,
      recommendations,
    };
  }
  const who = d.subject.kind === "draft" ? "The draft policy" : d.subject.name;
  const summary = `${who}: ${d.apps.access} of ${d.apps.total} apps with access, ${d.apps.conditional} conditional, ${d.apps.none} without access; ${count(d.data.unrestricted.length, "Grail table")} fully readable and ${d.data.limited.length} limited by dimensional data (${count(d.policies, "policy", "policies")}, ${count(d.statements, "effective statement")}).`;
  const insights: InsightItem[] = [];
  if (!d.policies) insights.push({ severity: "critical", icon: "🚫", text: `No policy is bound${d.subject.kind === "user" ? ` to any of the ${count(d.subject.groups, "group")} this user is in` : ""} on the account or this environment: nothing is granted.` });
  if (d.allApps) insights.push({ severity: "info", icon: "🧩", text: "An unconditional app-engine:apps:run lets the subject open every app, including apps installed later." });
  if (d.apps.conditional) insights.push({ severity: "warning", icon: "⚠️", text: `${count(d.apps.conditional, "app")} with conditional access, e.g. ${d.conditionalApps.slice(0, 3).join("; ")}.` });
  if (d.timeLimited) insights.push({ severity: "info", icon: "🕘", text: `${count(d.timeLimited, "app")} can only be opened under conditions that depend on the date or time, the user or an unbound parameter.` });
  if (d.data.unrestricted.length) insights.push({ severity: "info", icon: "🔓", text: `Every record of ${d.data.unrestricted.join(", ")} is readable (no dimension limits).` });
  if (d.data.limited.length) insights.push({ severity: "good", icon: "🎯", text: `${d.data.limited.join(", ")} ${d.data.limited.length === 1 ? "is" : "are"} limited by ${d.dimensions.join(", ") || "conditions"}.` });
  if (d.data.denied.length) insights.push({ severity: "warning", icon: "⛔", text: `Denied: ${d.data.denied.join(", ")}. A DENY on a Grail table permission applies regardless of its conditions.` });
  if (d.data.conditional.length) insights.push({ severity: "warning", icon: "❔", text: `Reading ${d.data.conditional.join(", ")} depends on time, the user or an unbound parameter.` });
  if (d.unboundParams) insights.push({ severity: "warning", icon: "🧷", text: `${count(d.unboundParams, "binding")} use \${bindParam:…} without a bound value; those statements are shown as conditional.` });

  const recommendations: RecommendationItem[] = [];
  if (d.apps.conditional && d.data.none.length) recommendations.push({ impact: "high", text: `Apps that show ${d.data.none.slice(0, 3).join(", ")} open without data: add the table permission (and storage:buckets:read) to a policy bound to the group, limited with a boundary if needed.` });
  if (d.data.unrestricted.length && !d.data.limited.length && d.subject.kind !== "draft") recommendations.push({ impact: "medium", text: "All data is readable without limits. If this group should only see its own data, bind the data policies with a boundary on security context or another dimension." });
  if (d.allApps) recommendations.push({ impact: "low", text: "If the group should only use some apps, replace the unconditional app-engine:apps:run with one shared:app-id statement per app (IAM Policy Creator, step 1)." });
  if (d.unboundParams) recommendations.push({ impact: "medium", text: "Set the missing binding parameters when binding the policy (Account Management API; the UI does not set parameters)." });
  recommendations.push({ impact: "low", text: "Open a limited table's Records query in a Notebook to see the records behind the limits (it runs with your own permissions)." });
  return { summary, insights, recommendations };
}

export type NetworkZoneInsightInput = {
  /** null = the network zone settings were not read. */
  zonesEnabled: boolean | null;
  zones: Array<{ zone: string; oneAgents: number; ags: number; routing: number; fallback: string; dropped: boolean; outage: "survives" | "dropped" | "n/a"; outageGroup: number | null }>;
  /** ActiveGates whose measured share of connected OneAgent modules differs most from the share routing gives them. */
  imbalance: Array<{ name: string; expectedPct: number; measuredPct: number }>;
  selection: string | null;
};

export function analyzeNetworkZones(d: NetworkZoneInsightInput): AIInsightsData {
  const used = d.zones.filter((z) => z.oneAgents > 0);
  const oneAgents = used.reduce((n, z) => n + z.oneAgents, 0);
  if (d.zones.length === 0) {
    return { summary: "No network zone, ActiveGate or OneAgent was found for this timeframe.", insights: [], recommendations: [{ impact: "low", text: "Deploy ActiveGates and OneAgents first; zones only matter once traffic is routed through ActiveGates." }] };
  }
  const fragile = used.filter((z) => z.outage === "dropped");
  const noOwn = used.filter((z) => z.routing === 0);
  const summary = `${d.zones.length} network ${plural(d.zones.length, "zone")}, ${used.length} with OneAgents (${oneAgents.toLocaleString()} in total). ${fragile.length ? `${fragile.length} ${plural(fragile.length, "zone loses", "zones lose")} its OneAgents' traffic if ${plural(fragile.length, "its", "their")} own ActiveGates go down.` : "Every zone with OneAgents keeps sending traffic when its own ActiveGates go down."}`;
  const insights: InsightItem[] = [];
  if (d.zonesEnabled === false) insights.push({ severity: "info", icon: "🗺️", text: "Network zones are turned off for the environment: zone assignments and fallback modes do not route OneAgent traffic yet." });
  for (const z of used.filter((x) => x.dropped)) insights.push({ severity: "critical", icon: "⛔", text: `Zone ${z.zone}: ${z.oneAgents} OneAgents have no ActiveGate they may use (fallback ${z.fallback}); their traffic is dropped.` });
  for (const z of fragile.filter((x) => !x.dropped)) insights.push({ severity: "warning", icon: "🧯", text: `Zone ${z.zone}: if its ${z.routing} routing ActiveGates fail, the fallback (${z.fallback}) leaves its ${z.oneAgents} OneAgents without an ActiveGate.` });
  for (const z of noOwn.filter((x) => !x.dropped)) insights.push({ severity: "info", icon: "↪️", text: `Zone ${z.zone} has no routing ActiveGate of its own: its ${z.oneAgents} OneAgents use group ${z.outageGroup ?? "?"} ActiveGates.` });
  for (const i of d.imbalance) insights.push({ severity: "info", icon: "⚖️", text: `${i.name}: ${i.measuredPct}% of the connected OneAgent modules, while zone routing gives it ${i.expectedPct}% of the OneAgents.` });
  if (d.selection) insights.push({ severity: "info", icon: "🔎", text: d.selection });
  const recommendations: RecommendationItem[] = [];
  if (fragile.length) recommendations.push({ impact: "high", text: "Give fragile zones a second routing ActiveGate, an alternative zone, or a fallback that reaches the default zone." });
  if (noOwn.length) recommendations.push({ impact: "medium", text: "Zones whose OneAgents always fall back to other zones send traffic across network boundaries: add an ActiveGate in the zone or make the target an alternative zone on purpose." });
  if (d.zonesEnabled === false) recommendations.push({ impact: "low", text: "Plan zones and their names, then turn network zones on; until then the map shows how traffic would be routed." });
  recommendations.push({ impact: "low", text: "Which ActiveGate a single OneAgent uses is not reported by Dynatrace: the connection view shows the ActiveGates it is load-balanced over by its zone, next to the measured load per ActiveGate." });
  return { summary, insights, recommendations };
}
