import React, { useCallback, useMemo, useState } from "react";
import { documentsClient } from "@dynatrace-sdk/client-document";
import { getDocumentLink, openDocument } from "@dynatrace-sdk/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, TextInput } from "@dynatrace/strato-components/forms";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { SectionCard, CONFIDENCE_COLOR, Chip } from "../components/layout";
import { actionBtn } from "../components/QueryActions";
import { useAIInsights } from "../components/AIInsights";
import { useMigration } from "../MigrationContext";
import { useSettings } from "../SettingsContext";
import { analyzeExport } from "../analyses";
import { buildGen3Dashboard } from "../translate/tiles";

const safeLink = (id: string) => {
  try {
    return getDocumentLink(id);
  } catch {
    return undefined;
  }
};

export const ExportTab: React.FC<{ onGoImport: () => void }> = ({ onGoImport }) => {
  const { result, source, tiles, included, verification, created, addCreated } = useMigration();
  const { settings, update } = useSettings();
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const name = nameEdit ?? (result ? `${result.name}${settings.nameSuffix}` : "");
  const kept = useMemo(() => tiles.filter((t) => included(t) && (settings.includeManualTiles || t.confidence !== "manual")), [tiles, included, settings.includeManualTiles]);
  const content = useMemo(() => (result ? buildGen3Dashboard(result, kept, { addMigrationNotes: settings.addMigrationNotes, sourceLabel: source?.label }) : null), [result, kept, settings.addMigrationNotes, source]);
  const json = useMemo(() => (content ? JSON.stringify({ name, type: "dashboard", content }, null, 2) : ""), [content, name]);

  const analysis = useCallback(() => analyzeExport(kept, () => true, verification, created.length), [kept, verification, created.length]);
  const { panel } = useAIInsights(analysis);

  const create = async () => {
    if (!content) return;
    setBusy(true);
    setMsg(null);
    try {
      const meta = await documentsClient.createDocument({
        body: {
          name: name.trim() || "Migrated dashboard",
          type: "dashboard",
          description: `Migrated from classic dashboard ${result?.classicId ?? ""} by Dashboard Migrator`.slice(0, 256),
          content: new Blob([JSON.stringify(content)], { type: "application/json" }),
        },
      });
      setMsg({ ok: true, text: `Created "${meta.name}". It is private to you until you share it.`, id: meta.id });
      addCreated({ id: meta.id, name: meta.name, at: new Date().toLocaleString(), tiles: kept.length });
    } catch (e) {
      const body = (e as { body?: { error?: { message?: string } } })?.body?.error?.message;
      setMsg({ ok: false, text: `Creating the dashboard failed: ${body ?? (e as Error)?.message ?? String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  if (!result || !content) {
    return (
      <div>
        {panel}
        <SectionCard title="Nothing to export yet">
          <Flex flexDirection="column" gap={8} alignItems="flex-start">
            <Text>Load and translate a classic dashboard first.</Text>
            <Button variant="emphasized" onClick={onGoImport}>
              Go to Import
            </Button>
          </Flex>
        </SectionCard>
      </div>
    );
  }

  const layouts = content.layouts as Record<string, { x: number; y: number; w: number; h: number }>;
  const tileDefs = content.tiles as Record<string, { type: string; title?: string; content?: string }>;
  const rows = Math.max(1, ...Object.values(layouts).map((l) => l.y + l.h));
  // One grid row; tall enough that 1-row header tiles still show their label.
  const ROW = 22;
  // Map export tile ids back to translated tiles for coloring (the optional summary tile is id 0).
  const offset = settings.addMigrationNotes ? 1 : 0;

  return (
    <div>
      {panel}
      <SectionCard title="New dashboard" subtitle="Created in the Dashboards app as a document owned by you.">
        <Flex flexDirection="column" gap={12}>
          <Flex gap={8} alignItems="center" flexWrap="wrap">
            <div style={{ minWidth: 320, flex: "1 1 320px", maxWidth: 560 }}>
              <TextInput value={name} onChange={(v: string) => setNameEdit(v)} aria-label="Name of the new dashboard" />
            </div>
            <Button variant="emphasized" color="primary" loading={busy} disabled={!kept.length || !name.trim()} onClick={() => void create()}>
              Create dashboard
            </Button>
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
              download={`${name.replace(/[^\w.-]+/g, "_") || "dashboard"}.json`}
              style={{ ...actionBtn, textDecoration: "none", display: "inline-block" }}
            >
              Download JSON
            </a>
            <button
              type="button"
              style={actionBtn}
              onClick={() =>
                void navigator.clipboard?.writeText(json).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </Flex>
          <Flex gap={20} flexWrap="wrap">
            <Checkbox name="notes" value={settings.addMigrationNotes} onChange={(v: boolean) => update({ addMigrationNotes: v })}>
              <span>Add a migration summary tile at the top</span>
            </Checkbox>
            <Checkbox name="manual" value={settings.includeManualTiles} onChange={(v: boolean) => update({ includeManualTiles: v })}>
              <span>Include placeholders for tiles that need manual work</span>
            </Checkbox>
          </Flex>
          {msg && (
            <MessageContainer variant={msg.ok ? "success" : "critical"}>
              <MessageContainer.Description>
                <span>
                  {msg.text}{" "}
                  {msg.id && (
                    <button type="button" style={actionBtn} onClick={() => openDocument(msg.id!)}>
                      ↗ Open dashboard
                    </button>
                  )}
                </span>
              </MessageContainer.Description>
            </MessageContainer>
          )}
        </Flex>
      </SectionCard>

      <SectionCard title="Layout preview" subtitle={`${kept.length} tiles on the 24-column grid, colored by translation confidence. Positions are scaled from the classic 38 px grid.`}>
        <div style={{ position: "relative", height: rows * ROW, border: "1px dashed rgba(128,128,128,0.3)", borderRadius: 6 }}>
          {Object.entries(layouts).map(([id, l]) => {
            const t = kept[Number(id) - offset];
            const color = t ? CONFIDENCE_COLOR[t.confidence] : "#4589FF";
            const def = tileDefs[id];
            const label = def?.title || (def?.content ?? "").replace(/[#*`>]/g, "").trim().split("\n")[0] || def?.type;
            return (
              <div
                key={id}
                title={label}
                style={{
                  position: "absolute",
                  left: `calc(${(l.x / 24) * 100}% + 2px)`,
                  width: `calc(${(l.w / 24) * 100}% - 4px)`,
                  top: l.y * ROW + 2,
                  height: l.h * ROW - 4,
                  borderRadius: 4,
                  background: `${color}22`,
                  border: `1px solid ${color}88`,
                  padding: "0 6px",
                  fontSize: 11,
                  lineHeight: `${ROW - 6}px`,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  boxSizing: "border-box",
                }}
              >
                {label}
              </div>
            );
          })}
        </div>
        <Flex gap={16} style={{ marginTop: 8 }}>
          {(["exact", "approximate", "manual"] as const).map((c) => (
            <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: `${CONFIDENCE_COLOR[c]}55`, border: `1px solid ${CONFIDENCE_COLOR[c]}` }} />
              {c}
            </span>
          ))}
          {settings.addMigrationNotes && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4589FF55", border: "1px solid #4589FF" }} />
              migration summary
            </span>
          )}
        </Flex>
      </SectionCard>

      {created.length > 0 && (
        <SectionCard title="Created in this session">
          <Flex flexDirection="column" gap={6}>
            {created.map((c) => (
              <Flex key={c.id} gap={12} alignItems="center">
                <Strong style={{ fontSize: 13 }}>{c.name}</Strong>
                <Chip>{c.tiles} tiles</Chip>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>{c.at}</Text>
                <button type="button" style={actionBtn} onClick={() => openDocument(c.id)}>
                  ↗ Open
                </button>
                {safeLink(c.id) && (
                  <a href={safeLink(c.id)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    link
                  </a>
                )}
              </Flex>
            ))}
          </Flex>
        </SectionCard>
      )}
    </div>
  );
};
