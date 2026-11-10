import React, { useState } from "react";
import { createPortal } from "react-dom";
import { DOCS_BASE_URL, DOCS_INDEX_URL, REF, TAB_DOCS, TRANSLATION_REFERENCE_URL } from "../links";

interface HelpSection {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

const SECTION_STYLE: React.CSSProperties = { marginBottom: 28 };

const H3: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#7ab4ff", marginBottom: 8, marginTop: 0,
};

const P: React.CSSProperties = {
  fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.7, margin: "0 0 8px",
};

const UL: React.CSSProperties = {
  margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.7,
};

const CODE: React.CSSProperties = {
  background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.2)",
  borderRadius: 3, padding: "1px 5px", fontSize: 11.5, fontFamily: "monospace", color: "#a8d1ff",
};

const A: React.CSSProperties = { color: "#7ab4ff", textDecoration: "none" };

const S = ({ children }: { children: React.ReactNode }) => <strong style={{ color: "#fff" }}>{children}</strong>;
const C = ({ children }: { children: React.ReactNode }) => <code style={CODE}>{children}</code>;

const SECTIONS: HelpSection[] = [
  {
    id: "overview",
    icon: "🧭",
    title: "What is Dashboard Migrator?",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          Dashboard Migrator takes a <S>classic dashboard</S> (Data explorer, custom chart, USQL and log tiles) and rebuilds it as a <S>new Dashboards app dashboard</S> whose tiles run <S>DQL</S> on Grail.
        </p>
        <p style={P}>Work left to right through the tabs:</p>
        <ul style={UL}>
          <li><S>Import</S>: paste or upload the classic dashboard JSON, or load it from this environment.</li>
          <li><S>Translate</S>: review every tile side by side (classic query vs. DQL), verify the DQL against this environment, preview the result and edit the query if needed.</li>
          <li><S>Export</S>: choose the tiles to keep and create the new dashboard (or download its JSON).</li>
        </ul>
        <p style={P}>The classic dashboard is never changed.</p>
      </div>
    ),
  },
  {
    id: "import",
    icon: "📥",
    title: "Import",
    content: (
      <div style={SECTION_STYLE}>
        <p style={H3}>Paste or upload</p>
        <p style={P}>
          Copy the classic dashboard JSON (open the dashboard, select <S>Edit</S>, switch to the <S>Settings</S> tab, select <S>Configure more</S> (dashboard menu &gt; Settings &gt; Advanced settings &gt; Dashboard JSON)gt; <S>Dashboard JSON</S>, then copy or download it) or the response of <C>GET /api/config/v1/dashboards/&#123;id&#125;</C>, paste it and select <S>Translate</S>. <S>Load sample</S> loads a dashboard that covers every supported tile type.
        </p>
        <p style={H3}>From this environment</p>
        <p style={P}>
          Classic dashboards are only available through the classic Config API, which needs an API token with the <C>ReadConfig</C> scope. An admin of the app (<C>app-settings:objects:write</C>) stores the token once; it is saved as a secret in the app settings, checked against the Config API first, and only the app's function can read it. Users then list and load classic dashboards without seeing the token.
        </p>
        <p style={P}>If listing fails with "host not in allowlist", add the classic host (<C>&lt;env&gt;.live.dynatrace.com</C>) under Settings &gt; Preferences &gt; Limit outbound connections.</p>
      </div>
    ),
  },
  {
    id: "translate",
    icon: "🔁",
    title: "Translate",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>Each tile gets a confidence:</p>
        <ul style={UL}>
          <li><S>Exact</S>: same data and semantics.</li>
          <li><S>Approximate</S>: runs, but something differs. The notes under the tile say what (heuristic metric key, management zone, USQL field mapping, folded values, dropped transformations).</li>
          <li><S>Manual</S>: no automatic form (SLO tiles, calculated service metrics, unsupported tile types). These become markdown placeholders.</li>
        </ul>
        <p style={H3}>Verify</p>
        <p style={P}>
          <S>Verify all</S> sends every query to the DQL verifier of this environment and checks that every metric key it reads exists (<C>metrics</C> command). Editing a query clears its result; verify it again.
        </p>
        <p style={H3}>Preview and DQL actions</p>
        <p style={P}>
          <S>Preview result</S> runs the query for the last 2 hours (or the classic tile's own timeframe) and draws it. Under the preview, <S>Show DQL</S>, <S>Copy DQL</S>, <S>Open in Notebook</S> and <S>Add to Dashboard</S> hand the query to other apps.
        </p>
      </div>
    ),
  },
  {
    id: "mapping",
    icon: "🗺️",
    title: "How queries are translated",
    content: (
      <div style={SECTION_STYLE}>
        <p style={H3}>Metric selectors (Data explorer, custom charts)</p>
        <ul style={UL}>
          <li>Classic keys map to Grail keys, e.g. <C>builtin:host.cpu.usage</C> → <C>dt.host.cpu.usage</C>, <C>builtin:service.response.time</C> → <C>dt.service.request.response_time</C>. Error rates become <C>failures[] / requests[] * 100</C>.</li>
          <li><C>:splitBy</C> → <C>by:</C>, <C>:filter</C> → <C>filter:</C> (entity selectors keep working through <C>classicEntitySelector()</C>), <C>:sort</C>/<C>:limit</C> → <C>sort</C>/<C>limit</C>, <C>:rate</C>, <C>:default</C>, <C>:timeshift</C> → aggregation parameters.</li>
          <li>Entity names are always added with <C>entityName()</C>; arithmetic between selectors becomes one <C>timeseries</C> with an element-wise expression.</li>
          <li>Tables, top lists, pies, honeycombs and single values fold each series to one value (sum for counters, average otherwise).</li>
        </ul>
        <p style={H3}>USQL</p>
        <p style={P}>
          <C>usersession</C> → <C>fetch user.sessions</C>, <C>useraction</C> → <C>fetch user.events</C>. Fields map to new RUM names (<C>country</C> → <C>geo.country.name</C>, <C>browserFamily</C> → <C>browser.name</C>, …); durations compared with numbers get <C>ms</C>; <C>DATETIME()</C> groups become <C>makeTimeseries</C>. New RUM data only exists for frontends monitored with new RUM.
        </p>
        <p style={H3}>Other tiles</p>
        <p style={P}>Markdown and headers are copied; open problems, hosts, services, applications, synthetic and database tiles are rebuilt from standard queries; log tiles become <C>fetch logs | filter …</C>.</p>
      </div>
    ),
  },
  {
    id: "export",
    icon: "📤",
    title: "Export",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          <S>Create dashboard</S> stores a new dashboard document owned by you (private until you share it). Positions are scaled from the classic 38 px grid to the 24-column grid. Optional: a summary tile with the migration notes, and placeholders for manual tiles.
        </p>
        <p style={P}>
          <S>Download JSON</S> / <S>Copy JSON</S> give the same document to import elsewhere (Dashboards app &gt; Upload, or <C>dtctl apply dashboard -f</C>).
        </p>
        <p style={P}>Afterwards: set the dashboard's default timeframe (classic default is noted in the summary tile) and replace management-zone filters with segments.</p>
      </div>
    ),
  },
  {
    id: "ai",
    icon: "✨",
    title: "AI Assist",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          <S>AI Assist</S> in the header opens a panel on the current tab with a summary, insights and recommendations: what the classic dashboard contains, which tiles fail verification or use unknown metrics, and what to fix before exporting. It is computed in the app from the translation results.
        </p>
      </div>
    ),
  },
  {
    id: "docs",
    icon: "📚",
    title: "Documentation and references",
    content: (
      <div style={SECTION_STYLE}>
        <p style={H3}>This app</p>
        <ul style={UL}>
          <li><a style={A} href={DOCS_INDEX_URL} target="_blank" rel="noreferrer">Dashboard Migrator documentation</a> (overview, setup, scopes)</li>
          {(Object.keys(TAB_DOCS) as (keyof typeof TAB_DOCS)[]).map((t) => (
            <li key={t}><a style={A} href={DOCS_BASE_URL + TAB_DOCS[t]} target="_blank" rel="noreferrer">{t} tab</a></li>
          ))}
          <li><a style={A} href={TRANSLATION_REFERENCE_URL} target="_blank" rel="noreferrer">Translation reference</a> (every metric key, USQL field and tile type mapping)</li>
        </ul>
        <p style={H3}>Dynatrace documentation</p>
        <ul style={UL}>
          {Object.values(REF).map((l) => (
            <li key={l.url}><a style={A} href={l.url} target="_blank" rel="noreferrer">{l.title}</a></li>
          ))}
        </ul>
      </div>
    ),
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState("overview");
  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#0f1422", border: "1px solid rgba(69,137,255,0.25)", borderRadius: 14, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.85)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 28px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff" }}>🧭 Dashboard Migrator — Help</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Translate classic dashboards and their queries into DQL and new dashboards</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={DOCS_INDEX_URL}
              target="_blank"
              rel="noreferrer"
              title="Open the Dashboard Migrator documentation on GitHub"
              style={{ background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.3)", borderRadius: 8, color: "#7ab4ff", fontSize: 13, padding: "8px 14px", cursor: "pointer", textDecoration: "none", fontWeight: 600 }}
            >
              📄 Documentation
            </a>
            <button onClick={onClose} style={{ background: "rgba(128,128,128,0.15)", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 13, padding: "8px 16px", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Nav */}
          <div style={{ width: 210, borderRight: "1px solid rgba(255,255,255,0.06)", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, overflowY: "auto" }}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 6, border: "none",
                  background: activeSection === s.id ? "rgba(69,137,255,0.15)" : "transparent",
                  color: activeSection === s.id ? "#fff" : "rgba(255,255,255,0.55)",
                  fontSize: 12, fontWeight: activeSection === s.id ? 600 : 400,
                  cursor: "pointer", textAlign: "left", width: "100%",
                  outline: activeSection === s.id ? "1px solid rgba(69,137,255,0.3)" : "none",
                }}
              >
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ lineHeight: 1.3 }}>{s.title}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: 22 }}>{section.icon}</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>{section.title}</h3>
            </div>
            {section.content}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
