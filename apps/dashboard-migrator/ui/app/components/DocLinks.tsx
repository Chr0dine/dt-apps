import React from "react";
import { ExternalLink, Text } from "@dynatrace/strato-components/typography";
import { DOCS_BASE_URL, TAB_DOCS, TAB_REFS, TRANSLATION_REFERENCE_URL } from "../links";

type TabName = keyof typeof TAB_DOCS;

/** Link to the tab's documentation on GitHub, right-aligned above the tab content (as in the other apps). */
export function TabDocsLink({ tab }: { tab: TabName }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, margin: "8px 20px 0" }}>
      {tab === "Translate" && (
        <Text textStyle="small">
          <ExternalLink href={TRANSLATION_REFERENCE_URL}>Translation reference</ExternalLink>
        </Text>
      )}
      <Text textStyle="small">
        <ExternalLink href={DOCS_BASE_URL + TAB_DOCS[tab]}>{tab} documentation</ExternalLink>
      </Text>
    </div>
  );
}

/** Dynatrace documentation for what the tab does, at the bottom of the tab. */
export function TabRefLinks({ tab }: { tab: TabName }) {
  return (
    <div style={{ margin: "16px 20px 24px", paddingTop: 12, borderTop: "1px solid rgba(128,128,128,0.2)" }}>
      <Text textStyle="small" style={{ display: "block", fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>
        Learn more
      </Text>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
        {TAB_REFS[tab].map((l) => (
          <Text key={l.url} textStyle="small">
            <ExternalLink href={l.url}>{l.title}</ExternalLink>
          </Text>
        ))}
      </div>
    </div>
  );
}
