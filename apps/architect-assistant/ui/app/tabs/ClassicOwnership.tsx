import React, { useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { useDql } from "../useDql";
import {
  CLASSIC_OWNER_TYPES,
  classicOwnerEntitiesQuery,
  classicOwnershipQuery,
  classicUnownedQuery,
  refreshMarker,
  type ClassicOwnerType,
  type Timeframe,
} from "../queries";
import { DrillDownTable, PctGauge, QueryActions, QueryState, ShowEntitiesButton, num, pct } from "../components";
import { classicEntityLink } from "../links";
import { OwnerTagForm, type OwnerTarget } from "./OwnerTagForm";

const card: React.CSSProperties = {
  padding: Spacings.Size16,
  borderRadius: Borders.Radius.Container.Default,
  background: Colors.Background.Container.Neutral.Default,
};

const titleOf = (type: string) => CLASSIC_OWNER_TYPES.find((t) => t.type === type)?.title ?? type;

/**
 * Ownership tab: frontends and synthetic monitors. They are classic entities without a Smartscape label/property map,
 * so ownership is a classic tag (dt.owner / owner / team : team identifier), scored separately from the entity gauges.
 */
export function ClassicOwnershipSection({ tf }: { tf: Timeframe }) {
  const query = classicOwnershipQuery(tf);
  const state = useDql(query);
  const [showUnowned, setShowUnowned] = useState(false);
  const rows = useMemo(() => {
    const byType = new Map((state.data?.records ?? []).map((r) => [String(r.type), r]));
    return CLASSIC_OWNER_TYPES.map((t) => {
      const r = byType.get(t.type);
      return { ...t, total: num(r?.total), owned: num(r?.owned) };
    }).filter((r) => r.total > 0);
  }, [state.data]);
  const unownedQuery = classicUnownedQuery(tf);
  return (
    <div style={card}>
      <Heading level={4}>Frontends and synthetic monitors</Heading>
      <Text style={{ opacity: 0.7 }}>
        Classic entities carry ownership as a tag such as dt.owner:team-checkout. Shown separately because they have no label or property map like the entities
        above.
      </Text>
      <QueryState state={state}>
        {rows.length === 0 ? (
          <Text style={{ marginTop: Spacings.Size8 }}>No frontends or synthetic monitors found in this timeframe.</Text>
        ) : (
          <Flex gap={16} flexWrap="wrap" style={{ marginTop: Spacings.Size8 }}>
            {rows.map((r) => (
              <PctGauge key={r.type} pct={pct(r.owned, r.total)} caption={r.title} detail={`${r.owned.toLocaleString()} of ${r.total.toLocaleString()} have an owner`} />
            ))}
          </Flex>
        )}
      </QueryState>
      <Flex flexDirection="column" gap={8} style={{ marginTop: Spacings.Size8 }}>
        <QueryActions title="Ownership of frontends and synthetic monitors" query={query} />
        {!showUnowned ? (
          <Flex>
            <ShowEntitiesButton onClick={() => setShowUnowned(true)}>Show frontends and monitors without an owner</ShowEntitiesButton>
          </Flex>
        ) : (
          <DrillDownTable
            title="Frontends and synthetic monitors without an owner"
            query={unownedQuery}
            emptyText="Every frontend and synthetic monitor has an owner."
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (r) => {
                  const href = classicEntityLink(String(r.id));
                  return href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {String(r.name ?? r.id)}
                    </a>
                  ) : (
                    String(r.name ?? r.id)
                  );
                },
              },
              { id: "type", header: "Type", cell: (r) => titleOf(String(r.type)) },
              { id: "id", header: "ID" },
            ]}
          />
        )}
      </Flex>
    </div>
  );
}

/** Ownership remediation: loads every frontend and synthetic monitor with its owner, then the shared owner-tag form. */
export function ClassicOwnerTagLoader({ tf }: { tf: Timeframe }) {
  const [version, setVersion] = useState(0);
  const query = classicOwnerEntitiesQuery(tf);
  const state = useDql(query + refreshMarker(version));
  const last = useRef<OwnerTarget[] | null>(null);
  const computed = useMemo<OwnerTarget[] | null>(
    () =>
      state.data?.records.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? r.id),
        typeLabel: titleOf(String(r.type as ClassicOwnerType)),
        owner: r.owner ? String(r.owner) : null,
      })) ?? null,
    [state.data],
  );
  if (computed) last.current = computed;
  if (state.error) return <Text style={{ color: "#C21930" }}>{state.error}</Text>;
  // Keep the previous rows while a refresh runs so the form (and its result) stays mounted.
  if (!last.current) return <Text>Loading frontends and synthetic monitors…</Text>;
  const targets = last.current;
  return (
    <Flex flexDirection="column" gap={12}>
      <OwnerTagForm targets={targets} onDone={() => setVersion((v) => v + 1)} />
      <QueryActions title="Frontends and synthetic monitors with owner" query={query} />
    </Flex>
  );
}
