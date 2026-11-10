import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { TextInput } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import { useAIInsights } from "../AIInsights";
import { analyzeIamOverview, type IamOverviewInsightInput } from "../analyses";
import { ACCOUNT_MANAGEMENT_URL } from "../iamCatalog";
import { readOverview, readSetupStatus, type Failure, type Overview, type SetupStatus } from "../iamAccessApi";
import {
  GROUP_TYPES,
  GROUP_TYPE_COLOR,
  GROUP_TYPE_LABEL,
  USER_MIXES,
  USER_MIX_COLOR,
  USER_MIX_LABEL,
  buildOverview,
  groupType,
  type GroupType,
  type OverviewModel,
} from "../iamOverview";
import { Donut, type Slice } from "./Donut";
import { DocLink, card, hint, plural } from "./IamShared";
import { SetupCard } from "./IamAccessTab";

// ---------------------------------------------------------------------------
// Overview (default tab): SAML vs local groups configured in the account and the users under each, as custom donuts
// (same Donut as Architect Assistant), plus every group with its member count. Data comes from the Account Management
// API through the iam-access function (no DQL: groups and members are not in Grail), so there is no DQL action here.
// ---------------------------------------------------------------------------

const DONUT_SIZE = 170;

type Load = { status: "loading" } | { status: "ok"; data: Overview } | { status: "failed"; failure: Failure };
type Row = { uuid: string; name: string; type: GroupType; members: number | null; description: string };

export function OverviewTab() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(() => {
    setLoad({ status: "loading" });
    setSetup(null);
    void readSetupStatus().then(setSetup);
    void readOverview().then((r) => setLoad("groups" in r ? { status: "ok", data: r } : { status: "failed", failure: r }));
  }, []);
  useEffect(refresh, [refresh]);

  const model = useMemo<OverviewModel | null>(() => (load.status === "ok" ? buildOverview(load.data) : null), [load]);

  const insight = useMemo<IamOverviewInsightInput>(
    () => ({
      state:
        load.status === "loading"
          ? "loading"
          : load.status === "ok"
            ? "ok"
            : (["no-credential", "forbidden", "unauthorized", "blocked"] as const).find((s) => s === load.failure.status) ?? "failed",
      failure: load.status === "failed" ? load.failure.message : null,
      model,
    }),
    [load, model],
  );
  const { panel } = useAIInsights(useCallback(() => analyzeIamOverview(insight), [insight]));

  const needsSetup = load.status === "failed" && (load.failure.status === "no-credential" || load.failure.status === "unauthorized" || load.failure.status === "blocked");

  return (
    <Flex flexDirection="column" gap={16}>
      {panel}
      <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={8}>
        <div style={{ flex: "1 1 480px", minWidth: 0 }}>
          <Heading level={3}>Overview</Heading>
          <Text as="p">
            Groups configured in the account, split by how their members are managed: SAML groups are filled from the identity provider at each sign-in, local groups are
            managed by hand in <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink>. Read through the Account Management API.
          </Text>
        </div>
        <Button onClick={refresh} disabled={load.status === "loading"}>
          {load.status === "loading" ? "Reading…" : "Refresh"}
        </Button>
      </Flex>

      {(needsSetup || setup?.state === "missing") && <SetupCard setup={setup} onSaved={refresh} needsIam={false} />}

      {load.status === "loading" && (
        <Flex gap={8} alignItems="center">
          <ProgressCircle size="small" aria-label="Reading the account's groups" />
          <Text>Reading the account&apos;s groups and their members…</Text>
        </Flex>
      )}

      {load.status === "failed" && !needsSetup && (
        <MessageContainer variant="critical">
          <MessageContainer.Title>{load.failure.status === "forbidden" ? "Only the app's admins can see the account overview" : "Reading the account's groups failed"}</MessageContainer.Title>
          <MessageContainer.Description>{load.failure.message}</MessageContainer.Description>
        </MessageContainer>
      )}

      {load.status === "ok" && model && (
        <>
          <SummaryTiles m={model} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
            <GroupsDonut m={model} selected={typeFilter} onSelect={setTypeFilter} />
            <UsersDonut m={model} />
          </div>
          <MembersByType m={model} />
          <GroupsTable data={load.data} typeFilter={typeFilter} onClearType={() => setTypeFilter(null)} search={search} onSearch={setSearch} />
          {load.data.warnings.length > 0 && (
            <MessageContainer variant="warning">
              <MessageContainer.Title>Some data could not be read</MessageContainer.Title>
              <MessageContainer.Description>
                <span>
                  {load.data.warnings.slice(0, 5).join(" ")}
                  {load.data.warnings.length > 5 ? ` …and ${load.data.warnings.length - 5} more.` : ""}
                </span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
          <Text style={hint}>
            Account <span style={{ fontFamily: "monospace" }}>{load.data.accountUuid}</span> · read {new Date(load.data.checkedAt).toLocaleString()}. SAML memberships reflect each
            user&apos;s last sign-in.
          </Text>
          {setup && setup.state !== "missing" && !needsSetup && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Account Management access</summary>
              <div style={{ marginTop: Spacings.Size8 }}>
                <SetupCard setup={setup} onSaved={refresh} needsIam={false} />
              </div>
            </details>
          )}
        </>
      )}
    </Flex>
  );
}

// --- Summary tiles -----------------------------------------------------------------------------------------------------
function Tile({ title, value, detail, color }: { title: string; value: number; detail?: string; color?: string }) {
  return (
    <div style={{ ...card, flex: "1 1 170px", minWidth: 0, borderLeft: color ? `4px solid ${color}` : undefined }}>
      <Text style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{title}</Text>
      <Heading level={2}>{value.toLocaleString()}</Heading>
      {detail && <Text style={{ ...hint, display: "block" }}>{detail}</Text>}
    </div>
  );
}

function SummaryTiles({ m }: { m: OverviewModel }) {
  return (
    <Flex gap={12} flexWrap="wrap">
      <Tile title="SAML groups" value={m.groups.SAML} detail={`${plural(m.usersIn.SAML, "user")} in them`} color={GROUP_TYPE_COLOR.SAML} />
      <Tile title="Local groups" value={m.groups.LOCAL} detail={`${plural(m.usersIn.LOCAL, "user")} in them`} color={GROUP_TYPE_COLOR.LOCAL} />
      {m.groups.SCIM > 0 && <Tile title="SCIM groups" value={m.groups.SCIM} detail={`${plural(m.usersIn.SCIM, "user")} in them`} color={GROUP_TYPE_COLOR.SCIM} />}
      <Tile title="Account users" value={m.totalUsers} detail={m.mix.none ? `${plural(m.mix.none, "user")} in no group` : "every user is in a group"} />
    </Flex>
  );
}

// --- Donuts ------------------------------------------------------------------------------------------------------------
function DonutCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <Heading level={4} style={{ marginBottom: Spacings.Size8 }}>
        {title}
      </Heading>
      {children}
      {note && <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>{note}</Text>}
    </div>
  );
}

function GroupsDonut({ m, selected, onSelect }: { m: OverviewModel; selected: string | null; onSelect: (t: string | null) => void }) {
  const slices = useMemo<Slice[]>(
    () => GROUP_TYPES.map((t) => ({ id: t, label: GROUP_TYPE_LABEL[t], value: m.groups[t], color: GROUP_TYPE_COLOR[t] })).filter((s) => s.value > 0),
    [m],
  );
  return (
    <DonutCard title="Groups: SAML vs local" note="Click a slice to filter the group list below.">
      {slices.length ? (
        <Donut slices={slices} size={DONUT_SIZE} centerLabel="groups" ariaLabel="Groups by type" selectedId={selected} onSelect={onSelect} />
      ) : (
        <Text>No groups in this account.</Text>
      )}
    </DonutCard>
  );
}

function UsersDonut({ m }: { m: OverviewModel }) {
  const slices = useMemo<Slice[]>(
    () => USER_MIXES.map((k) => ({ id: k, label: USER_MIX_LABEL[k], value: m.mix[k], color: USER_MIX_COLOR[k] })).filter((s) => s.value > 0),
    [m],
  );
  return (
    <DonutCard title="Users by group type" note="Each account user once, by the types of groups they are in (the built-in all-users group is ignored).">
      {slices.length ? <Donut slices={slices} size={DONUT_SIZE} centerLabel="users" ariaLabel="Users by the type of groups they are in" /> : <Text>No users in this account.</Text>}
    </DonutCard>
  );
}

// --- Users per type (custom bars) ---------------------------------------------------------------------------------------
function MembersByType({ m }: { m: OverviewModel }) {
  const types = GROUP_TYPES.filter((t) => t !== "ALL_USERS" && m.groups[t] > 0);
  const max = Math.max(1, ...types.map((t) => m.memberships[t]));
  if (!types.length) return null;
  return (
    <div style={card}>
      <Heading level={4} style={{ marginBottom: Spacings.Size8 }}>
        Users under each group type
      </Heading>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, auto) 1fr auto", alignItems: "center", columnGap: 12, rowGap: 10 }}>
        {types.map((t) => (
          <React.Fragment key={t}>
            <Flex alignItems="center" gap={8}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: GROUP_TYPE_COLOR[t], flex: "none" }} />
              <Text style={{ fontWeight: 600 }}>{GROUP_TYPE_LABEL[t]}</Text>
            </Flex>
            <div style={{ height: 14, borderRadius: 3, background: "rgba(128,128,128,0.12)", overflow: "hidden" }} title={`${m.memberships[t].toLocaleString()} memberships`}>
              <div style={{ width: `${(m.memberships[t] / max) * 100}%`, height: "100%", background: GROUP_TYPE_COLOR[t], borderRadius: 3, transition: "width 200ms ease" }} />
            </div>
            <Text style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              <strong>{m.usersIn[t].toLocaleString()}</strong> distinct users · {plural(m.memberships[t], "membership")} in {plural(m.groups[t], "group")}
            </Text>
          </React.Fragment>
        ))}
      </div>
      <Text style={{ ...hint, display: "block", marginTop: Spacings.Size8 }}>Bars: memberships (a user in two groups counts twice). Distinct users counts each user once per type.</Text>
    </div>
  );
}

// --- Group list ---------------------------------------------------------------------------------------------------------
function TypeChip({ type }: { type: GroupType }) {
  const c = GROUP_TYPE_COLOR[type];
  return (
    <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: `${c}26`, border: `1px solid ${c}80` }}>{GROUP_TYPE_LABEL[type]}</span>
  );
}

function GroupsTable({
  data,
  typeFilter,
  onClearType,
  search,
  onSearch,
}: {
  data: Overview;
  typeFilter: string | null;
  onClearType: () => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  const max = useMemo(() => Math.max(1, ...data.groups.map((g) => (groupType(g) === "ALL_USERS" ? 0 : (g.members ?? 0)))), [data]);
  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return data.groups
      .map((g) => ({ uuid: g.uuid, name: g.name, type: groupType(g), members: g.members, description: g.description ?? "" }))
      .filter((r) => (!typeFilter || r.type === typeFilter) && (!q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
      // The built-in all-users group last: its "members" are implicit, not a group size to compare.
      .sort((a, b) => Number(a.type === "ALL_USERS") - Number(b.type === "ALL_USERS") || (b.members ?? -1) - (a.members ?? -1) || a.name.localeCompare(b.name));
  }, [data, typeFilter, search]);
  const columns = useMemo<DataTableColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Group", accessor: "name", width: { type: "auto", minWidth: 220 } },
      { id: "type", header: "Type", accessor: "type", width: 170, cell: ({ rowData }: { rowData: Row }) => <TypeChip type={rowData.type} /> },
      {
        id: "members",
        header: "Members",
        accessor: "members",
        width: 220,
        cell: ({ rowData }: { rowData: Row }) =>
          rowData.members === null ? (
            <Text style={hint}>not readable</Text>
          ) : rowData.type === "ALL_USERS" ? (
            <Text style={hint}>every user ({rowData.members.toLocaleString()}), implicit</Text>
          ) : (
            <Flex alignItems="center" gap={8} style={{ width: "100%" }}>
              <div style={{ flex: "1 1 auto", height: 8, borderRadius: 2, background: "rgba(128,128,128,0.12)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (rowData.members / max) * 100)}%`, height: "100%", background: GROUP_TYPE_COLOR[rowData.type] }} />
              </div>
              <Text style={{ fontSize: 12, fontWeight: 700, minWidth: 36, textAlign: "right" }}>{rowData.members.toLocaleString()}</Text>
            </Flex>
          ),
      },
      { id: "description", header: "Description", accessor: "description", width: { type: "auto", minWidth: 200 } },
    ],
    [max],
  );
  return (
    <div style={card}>
      <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={8} style={{ marginBottom: Spacings.Size8 }}>
        <Heading level={4}>
          Groups{typeFilter ? `: ${GROUP_TYPE_LABEL[typeFilter as GroupType]}` : ""} ({rows.length.toLocaleString()})
        </Heading>
        <Flex gap={8} alignItems="center">
          {typeFilter && (
            <Button size="condensed" onClick={onClearType}>
              Show all types
            </Button>
          )}
          <div style={{ width: 240 }}>
            <TextInput value={search} onChange={(v: string) => onSearch(v)} placeholder="Filter by name or description" aria-label="Filter groups" />
          </div>
        </Flex>
      </Flex>
      <DataTable data={rows} columns={columns} sortable fullWidth variant={{ rowDensity: "condensed" }}>
        <DataTable.EmptyState>No group matches.</DataTable.EmptyState>
      </DataTable>
    </div>
  );
}
