import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { TextArea, TextInput, PasswordInput } from "@dynatrace/strato-components/forms";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { SectionCard, Chip } from "../components/layout";
import { actionBtn } from "../components/QueryActions";
import { useAIInsights } from "../components/AIInsights";
import { useMigration } from "../MigrationContext";
import { analyzeImport } from "../analyses";
import { parseClassicDashboard } from "../translate/tiles";
import { SAMPLE_CLASSIC_DASHBOARD } from "../translate/sample";
import { callClassic, type ClassicDashboardStub, type FnResult } from "../classicApi";

type Status = Extract<FnResult, { status: "ok-status" }>;

export const ImportTab: React.FC<{ onLoaded: () => void }> = ({ onLoaded }) => {
  const { source, load } = useMigration();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- environment (classic Config API through the app function) ---
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [list, setList] = useState<ClassicDashboardStub[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshStatus = useCallback(async () => {
    const r = await callClassic({ action: "status" });
    if (r.status === "ok-status") {
      setStatus(r);
      setStatusError(r.settingsError ?? null);
    } else setStatusError("message" in r ? r.message : "Could not read the app settings.");
  }, []);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const translate = (raw: string, label: string) => {
    setError(null);
    try {
      const d = parseClassicDashboard(raw);
      load({ dashboard: d, label });
      onLoaded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    void f.text().then((t) => {
      setText(t);
      translate(t, `file ${f.name}`);
    });
  };

  const listDashboards = async () => {
    setListBusy(true);
    setListError(null);
    const r = await callClassic({ action: "list" });
    setListBusy(false);
    if (r.status === "ok-list") setList(r.dashboards);
    else setListError("message" in r ? r.message : "Listing failed.");
  };
  const loadFromEnv = async (d: ClassicDashboardStub) => {
    setLoadingId(d.id);
    setListError(null);
    const r = await callClassic({ action: "get", id: d.id });
    setLoadingId(null);
    if (r.status === "ok-get") {
      const raw = JSON.stringify(r.dashboard, null, 2);
      setText(raw);
      translate(raw, `environment (${d.id})`);
    } else setListError("message" in r ? r.message : "Loading failed.");
  };
  const saveToken = async (clear = false) => {
    setTokenBusy(true);
    setTokenMsg(null);
    const r = await callClassic(clear ? { action: "clear-token" } : { action: "save-token", token });
    setTokenBusy(false);
    const ok = r.status === "ok";
    setTokenMsg({ ok, text: "message" in r ? r.message : ok ? "Saved." : "Failed." });
    if (ok) {
      setToken("");
      setList(null);
      void refreshStatus();
    }
  };

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (list ?? []).filter((d) => !f || d.name.toLowerCase().includes(f) || (d.owner ?? "").toLowerCase().includes(f) || d.id.includes(f));
  }, [list, filter]);

  const analysis = useCallback(() => analyzeImport(source, status ? status.tokenSet : null), [source, status]);
  const { panel } = useAIInsights(analysis);

  return (
    <div>
      {panel}
      <SectionCard
        title="Paste or upload a classic dashboard"
        subtitle="The classic dashboard JSON: dashboard menu > Settings > Advanced settings > Dashboard JSON, or GET /api/config/v1/dashboards/{id}. Nothing is sent anywhere until you create the new dashboard."
      >
        <Flex flexDirection="column" gap={8}>
          <TextArea value={text} onChange={(v: string) => setText(v)} aria-label="Classic dashboard JSON" placeholder='{ "dashboardMetadata": { "name": "..." }, "tiles": [ ... ] }' rows={9} resize="vertical" style={{ fontFamily: "monospace", fontSize: 12 }} />
          <Flex gap={8} flexWrap="wrap" alignItems="center">
            <Button variant="emphasized" color="primary" disabled={!text.trim()} onClick={() => translate(text, "pasted JSON")}>
              Translate
            </Button>
            <Button onClick={() => fileRef.current?.click()}>Upload JSON file</Button>
            <Button
              onClick={() => {
                const raw = JSON.stringify(SAMPLE_CLASSIC_DASHBOARD, null, 2);
                setText(raw);
                translate(raw, "sample");
              }}
            >
              Load sample
            </Button>
            {text && <Button onClick={() => setText("")}>Clear</Button>}
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          </Flex>
          {error && (
            <MessageContainer variant="critical">
              <MessageContainer.Description>
                <span>{error}</span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        title="From this environment"
        subtitle={`Lists classic dashboards through the classic Config API${status ? ` (${status.classicUrl})` : ""} with a ReadConfig API token an admin stores in the app settings. Users never see the token.`}
        actions={
          status?.tokenSet ? (
            <Button onClick={() => void listDashboards()} loading={listBusy}>
              {list ? "Refresh list" : "List classic dashboards"}
            </Button>
          ) : undefined
        }
      >
        <Flex flexDirection="column" gap={12}>
          {!status && !statusError && <Text style={{ fontSize: 12, opacity: 0.7 }}>Checking the app settings…</Text>}
          {statusError && (
            <MessageContainer variant="warning">
              <MessageContainer.Description>
                <span>{statusError}</span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
          {status && (
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              <Text style={{ fontSize: 12 }}>ReadConfig token:</Text>
              {status.tokenSet ? <Chip color="#2AB06F" mono>{status.tokenPrefix}</Chip> : <Chip color="#F5A623">not set</Chip>}
              {status.info && <Text style={{ fontSize: 12, opacity: 0.7 }}>{status.info}</Text>}
            </Flex>
          )}
          {status && !status.tokenSet && !status.canManage && (
            <Text style={{ fontSize: 12, opacity: 0.75 }}>An admin of this app (app-settings:objects:write) has to store a ReadConfig API token first. Until then, paste the dashboard JSON above.</Text>
          )}
          {status?.canManage && (
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              <div style={{ minWidth: 320, flex: "1 1 320px", maxWidth: 520 }}>
                <PasswordInput value={token} onChange={(v: string) => setToken(v)} aria-label="ReadConfig API token" placeholder={status.tokenSet ? "Replace the stored token (dt0c01.…)" : "API token with the ReadConfig scope (dt0c01.…)"} />
              </div>
              <Button variant="emphasized" disabled={!token.trim()} loading={tokenBusy} onClick={() => void saveToken()}>
                Check and store
              </Button>
              {status.tokenSet && (
                <Button color="critical" disabled={tokenBusy} onClick={() => void saveToken(true)}>
                  Remove token
                </Button>
              )}
            </Flex>
          )}
          {tokenMsg && (
            <MessageContainer variant={tokenMsg.ok ? "success" : "critical"}>
              <MessageContainer.Description>
                <span>{tokenMsg.text}</span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
          {listError && (
            <MessageContainer variant="critical">
              <MessageContainer.Description>
                <span>{listError}</span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
          {list && (
            <Flex flexDirection="column" gap={6}>
              <Flex gap={8} alignItems="center">
                <div style={{ width: 320 }}>
                  <TextInput value={filter} onChange={(v: string) => setFilter(v)} placeholder="Filter by name, owner or ID" aria-label="Filter classic dashboards" />
                </div>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>
                  {filtered.length} of {list.length} classic dashboards
                </Text>
              </Flex>
              <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid rgba(128,128,128,0.2)", borderRadius: 8 }}>
                {filtered.slice(0, 300).map((d) => (
                  <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr minmax(120px, 28%) auto", gap: 12, alignItems: "center", padding: "6px 12px", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
                    <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.id}>
                      {d.name}
                    </span>
                    <span style={{ fontSize: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.owner ?? ""}</span>
                    <button type="button" style={actionBtn} disabled={loadingId !== null} onClick={() => void loadFromEnv(d)}>
                      {loadingId === d.id ? "Loading…" : "Load and translate"}
                    </button>
                  </div>
                ))}
                {!filtered.length && <div style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>No classic dashboards match.</div>}
              </div>
            </Flex>
          )}
        </Flex>
      </SectionCard>

      {source && (
        <SectionCard title="Loaded" subtitle={`From ${source.label}`}>
          <Flex gap={8} alignItems="center" flexWrap="wrap">
            <Strong>{source.dashboard.dashboardMetadata.name}</Strong>
            <Chip>{source.dashboard.tiles.length} tiles</Chip>
            {source.dashboard.dashboardMetadata.owner && <Chip>owner {source.dashboard.dashboardMetadata.owner}</Chip>}
            <Button variant="emphasized" color="primary" onClick={onLoaded}>
              Review translation
            </Button>
          </Flex>
        </SectionCard>
      )}
    </div>
  );
};
