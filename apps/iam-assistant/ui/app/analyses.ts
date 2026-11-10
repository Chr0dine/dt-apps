import type { AIInsightsData, InsightItem, RecommendationItem } from "./AIInsights";
import type { OverviewModel } from "./iamOverview";

// Per-tab analysis functions for AI Assist. Pure functions of the data already on
// screen, so the explanation always matches what the user is looking at.
// IAM sections copied from Architect Assistant (apps/architect-assistant/ui/app/analyses.ts).
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
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
  recommendations.push({ impact: "low", text: "Copy the text into Account Management > Identity & access management > Policy management > Create policy; it is validated again on save." });
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
  recommendations.push({ impact: "low", text: "Create it in Account Management > Identity & access management > Policy management > Boundaries, then select it when assigning policies to a group." });
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
};

export function analyzeIamAccess(d: IamAccessInsightInput): AIInsightsData {
  if (!d.subject) {
    const insights: InsightItem[] = [];
    const recommendations: RecommendationItem[] = [];
    if (d.mode !== "draft" && d.setup === "missing")
      insights.push({ severity: "info", icon: "🔑", text: "No OAuth client is stored yet. Users and groups can be found, but their policies are only readable through the Account Management API." });
    if (d.failure) insights.push({ severity: "warning", icon: "⚠️", text: d.failure });
    if (d.mode !== "draft" && d.setup !== "ok")
      recommendations.push({ impact: "high", text: "Create a read-only OAuth client (account-idm-read, iam:bindings:read, iam:policies:read, iam:boundaries:read) and save it in Account Management access; leave “Every user of this app” off unless every app user may see the account's IAM setup." });
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


export type IamOverviewInsightInput = {
  /** "ok" with a model, or why there is none. */
  state: "loading" | "ok" | "no-credential" | "forbidden" | "failed";
  failure: string | null;
  model: OverviewModel | null;
};

export function analyzeIamOverview(d: IamOverviewInsightInput): AIInsightsData {
  const m = d.model;
  if (!m) {
    const setup = d.state === "no-credential";
    return {
      summary:
        d.state === "loading"
          ? "Reading the account's groups and members…"
          : setup
            ? "No account OAuth client is stored yet, so the account's groups and their members cannot be read."
            : `The account's groups could not be read${d.failure ? `: ${d.failure}` : "."}`,
      insights: [
        { severity: "info", icon: "ℹ️", text: "Groups, their type (SAML, local, SCIM) and their members are only exposed by the account-level Account Management API, which this app reads through its iam-access function." },
      ],
      recommendations: setup || d.state === "failed"
        ? [{ impact: "high", text: "Create a read-only OAuth client (account-idm-read, iam:bindings:read, iam:policies:read, iam:boundaries:read) in Account Management and save it under Account Management access on this page." }]
        : d.state === "forbidden"
          ? [{ impact: "medium", text: "Ask an admin of this app to allow the Overview and Permissions Test for every user, or to grant you app-settings:objects:write for this app." }]
          : [],
    };
  }
  const summary = `${count(m.totalGroups, "group")} in the account: ${count(m.groups.SAML, "SAML group")} and ${count(m.groups.LOCAL, "local group")}${m.groups.SCIM ? `, ${count(m.groups.SCIM, "SCIM group")}` : ""}. ${count(m.usersIn.SAML, "user")} ${m.usersIn.SAML === 1 ? "is" : "are"} in SAML groups and ${count(m.usersIn.LOCAL, "user")} in local groups, out of ${count(m.totalUsers, "account user")}.`;
  const insights: InsightItem[] = [];
  const real = m.groups.SAML + m.groups.LOCAL + m.groups.SCIM;
  if (m.groups.SAML && !m.groups.LOCAL) insights.push({ severity: "good", icon: "🔐", text: "Every group is federated: access is driven by the identity provider, so joiners, movers and leavers are handled there." });
  else if (m.groups.SAML && m.groups.LOCAL) {
    const share = Math.round((m.groups.LOCAL / real) * 100);
    insights.push({ severity: share > 50 ? "warning" : "info", icon: "⚖️", text: `${share}% of the groups are local. Local memberships are managed by hand in Account Management and do not follow changes in the identity provider.` });
  } else if (!m.groups.SAML && !m.groups.SCIM) insights.push({ severity: "warning", icon: "👤", text: "No SAML or SCIM group: every membership is managed by hand in Account Management." });
  if (m.mix.both) insights.push({ severity: "info", icon: "🔀", text: `${count(m.mix.both, "user")} ${m.mix.both === 1 ? "is" : "are"} in both SAML and local groups: their access is the union of both, so removing them in the identity provider may not remove all their access.` });
  if (m.mix.local) insights.push({ severity: m.groups.SAML ? "warning" : "info", icon: "📝", text: `${count(m.mix.local, "user")} ${m.mix.local === 1 ? "gets" : "get"} access only through local groups.` });
  if (m.mix.none) insights.push({ severity: "info", icon: "🫥", text: `${count(m.mix.none, "user")} ${m.mix.none === 1 ? "is" : "are"} in no group (other than the built-in all-users group), so only policies bound to all users apply to them.` });
  if (m.emptyGroups.length) insights.push({ severity: "info", icon: "🗂️", text: `${count(m.emptyGroups.length, "group")} without members, e.g. ${m.emptyGroups.slice(0, 3).map((g) => g.name).join(", ")}.${m.emptyGroups.some((g) => g.type === "SAML") ? " SAML groups fill at sign-in, so an empty SAML group may only mean nobody with that attribute has signed in yet." : ""}` });
  if (m.largest.length) insights.push({ severity: "info", icon: "📊", text: `Largest groups: ${m.largest.map((g) => `${g.name} (${g.members.toLocaleString()})`).join(", ")}.` });
  if (m.unreadable) insights.push({ severity: "warning", icon: "⚠️", text: `Members of ${count(m.unreadable, "group")} could not be read; the user counts leave them out.` });

  const recommendations: RecommendationItem[] = [];
  if (m.groups.LOCAL && m.groups.SAML) recommendations.push({ impact: "medium", text: "Move local groups that mirror teams in your identity provider to SAML (federated) groups, so access follows the directory." });
  if (!m.groups.SAML && !m.groups.SCIM) recommendations.push({ impact: "high", text: "Set up SAML federation (or SCIM provisioning) and map identity provider groups to Dynatrace groups." });
  if (m.mix.both) recommendations.push({ impact: "medium", text: "Review users in both SAML and local groups; keep local groups for break-glass or service accounts only." });
  if (m.emptyGroups.length) recommendations.push({ impact: "low", text: "Remove local groups without members, or the policies bound to them, to keep the IAM setup readable." });
  recommendations.push({ impact: "low", text: "Use the Permissions Test tab to see what a user or group can open and read in this environment." });
  return { summary, insights, recommendations };
}
