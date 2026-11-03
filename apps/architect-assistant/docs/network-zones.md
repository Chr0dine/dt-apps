# Network Zones

The Network Zones tab shows how network zones route OneAgent traffic through ActiveGates. It maps every zone with its ActiveGates and OneAgents and animates where each zone's OneAgents send their traffic. You can simulate ActiveGate and zone outages and other fallback modes on the map without saving anything. A searchable list shows every zone; expand a zone to see its ActiveGates, its OneAgents and the hosts measured using it. A connection view shows which OneAgents are routed to which ActiveGate, next to the load each ActiveGate actually carries. Forms at the bottom change zones through the API.

| | |
| --- | --- |
| Area | Visibility (see [index](README.md)) |
| Tab id | `networkzones` |
| Counts toward Entity Overview readiness / Top findings | no |
| Main source files | [NetworkZonesTab.tsx](../ui/app/tabs/NetworkZonesTab.tsx), [NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx), [ConnectionFlow.tsx](../ui/app/tabs/ConnectionFlow.tsx), [networkZones.ts](../ui/app/networkZones.ts), [activeGates.ts](../ui/app/activeGates.ts) (`zoneRows`, `routingPlan`), [queries.ts](../ui/app/queries.ts), [analyses.ts](../ui/app/analyses.ts) (`analyzeNetworkZones`) |

## Contents

- [What this page answers](#what-this-page-answers)
- [Before you start](#before-you-start)
- [How routing is computed](#how-routing-is-computed)
- [Page walkthrough](#page-walkthrough)
  - [Notices](#notices)
  - [Summary](#summary)
  - [Network zone map](#network-zone-map)
  - [Network zones (searchable list)](#network-zones-searchable-list)
  - [OneAgent connections](#oneagent-connections)
  - [Change network zones](#change-network-zones)
- [Queries](#queries)
- [API calls](#api-calls)
- [AI Assist on this page](#ai-assist-on-this-page)
- [Limitations and edge cases](#limitations-and-edge-cases)
- [Related pages](#related-pages)
- [Source files](#source-files)

## What this page answers

- Which network zones exist, which ActiveGates are in each, and how many OneAgents use each zone?
- Where does each zone's OneAgent traffic go now, and where would it go if ActiveGates or a whole zone failed?
- Which zones lose their OneAgents' traffic when their own ActiveGates go down (fallback None, no alternative zone)?
- Which OneAgents are routed to a given ActiveGate, and does the load the ActiveGate actually carries match that routing?
- Which hosts use a zone as an alternative or as failover (measured, while network zones are on)?

## Before you start

### App scopes used by this page

| Scope | Used for |
| --- | --- |
| `storage:smartscape:read` | Smartscape `ACTIVEGATE`, `SYNTHETIC_ENGINE`, `ZREMOTE`, `K8S_CLUSTER`, `ONEAGENT` and `HOST` nodes. |
| `storage:metrics:read` | Connected OneAgent modules per ActiveGate (`dt.sfm.active_gate.communication.agent_modules.connected`). |
| `settings:objects:read` | `builtin:networkzones.zones` (fallback, alternative zones) and `builtin:networkzones` (network zones on or off). |
| `settings:objects:write` | Set a zone's fallback and alternative zones; turn network zones on. |
| `fleet-management:activegates:write` | The remote configuration job that sets the network zone of ActiveGates. |
| `fleet-management:network-zones:read` | Hosts connected to a zone as alternative or failover (`GET /api/v2/networkZones/{id}/hostStats`). |

### User permissions

Writes need the matching platform permissions (Settings write, and `deployment:activegates.network-zones:write` for the remote configuration job). A read the user is not allowed to make drops only the part that needs it; the rest of the page still works.

## How routing is computed

The routing follows the [OneAgent connectivity in network zones](https://docs.dynatrace.com/docs/manage/network-zones/oneagent-connectivity) docs and is implemented once, in `routingPlan` ([activeGates.ts](../ui/app/activeGates.ts)); the map, the list, the summary and the connection view all use it.

For a zone, the ActiveGates are split into four priority groups. An ActiveGate belongs only to the first group that matches:

1. the same zone;
2. the zone's alternative zones;
3. the `default` zone (for the default zone itself this is group 1 again, shown as "same as group 1");
4. every other ActiveGate.

An ActiveGate is **available** when it is connected (seen in Smartscape in the last 20 minutes), has the OneAgent routing module (`AGENT_ROUTING`, `[collector] MSGrouter`) and, on the map, is not down in the simulation. The zone's fallback mode limits the groups: **Any ActiveGate** 1-4 (the schema default), **Only default zone** 1-3, **None (drop traffic)** 1-2. The zone's OneAgents use the first allowed group with an available ActiveGate and are load-balanced over its ActiveGates. When no allowed group has one, their traffic is **dropped**.

**Which ActiveGate a single OneAgent is connected to is not reported by Dynatrace**: Grail has no OneAgent-to-ActiveGate edge or dimension, and no API lists it. The page therefore shows, for every OneAgent, the ActiveGates its zone routes it to, and for every ActiveGate the measured number of connected OneAgent modules. Where the two disagree, actual connections differ from the zone routing (for example OneAgents that cannot reach their zone's ActiveGates through a firewall, or network zones being off).

The zone list itself (which zones exist, their status and finding) is computed by `zoneRows`; its rules are described on the ActiveGates page under [Zone list](activegates.md#zone-list-client-side-zonerows). On this tab the OneAgent count per zone comes from [Q3](#q3-oneagents-with-their-zone-and-host-networkzoneoneagentsquery).

## Page walkthrough

From top to bottom: AI Assist panel (when open), heading and introduction (with a link to the ActiveGates tab), notices, summary, network zone map, network zones list, OneAgent connections, change network zones. Everything below the notices waits for [Q1](#q1-activegates-activegatesquery); the summary and the map also wait for [Q3](#q3-oneagents-with-their-zone-and-host-networkzoneoneagentsquery).

### Notices

- "Network zone settings not readable: \<error\>" (red) when the settings read fails.
- **Network zones are turned off** (amber) when `builtin:networkzones` `enabled` is false: zone assignments and fallback modes do not route traffic yet; the map and the connections show how traffic would be routed once they are on.

### Summary

| Item | Value |
| --- | --- |
| OneAgents with an ActiveGate (gauge) | OneAgents whose zone has a target group, of all OneAgents |
| OneAgents served in their own zone (gauge) | OneAgents whose target group is 1 (for the default zone also 3), of all OneAgents |
| Zones that survive losing their ActiveGates (gauge) | zones with OneAgents that still have a target when every ActiveGate of the zone itself is down (`zoneOutagePlan`), of zones with OneAgents |
| Network zones (tile) | number of zones; "N with OneAgents, M with ActiveGates" |
| Routing ActiveGates (tile) | connected ActiveGates with OneAgent routing, "of" all ActiveGates |

### Network zone map

A custom SVG topology (`NetworkZoneMap` in [NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx)), inside the Q3 loading and error state. **Nothing on the map is saved.**

**Zones** are rounded containers laid out in reading order on a 1120-unit-wide canvas: `default` first, then zones in use (with ActiveGates or OneAgents), with the most ActiveGates first, then by name.

- The header shows the zone name, then "fallback \<mode\>". The suffix is " (what-if)" when you picked another mode in the simulation, or " (default)" when the zone has no settings object. Then "· alt \<alternative zones\>". The fallback text is amber for None.
- Unused zones are compact, dashed, and say "no ActiveGate or OneAgent".
- Click a zone to focus it; click again to unfocus.

**OneAgents** appear as one grey circle per zone, with the count from Q3 and the label "OneAgents". A focused zone without OneAgents shows a dashed "what-if" circle. When the zone's traffic is dropped, the circle pulses red and shows "✕ traffic dropped".

**ActiveGates** are nodes laid out in a grid of up to 5 columns. Nodes with OneAgent routing come first.

- The glyph is E (host-based), K (containerized), S (synthetic) or Z (zRemote).
- Fill colour:
  - routes OneAgent traffic (has `AGENT_ROUTING`): priority-group-1 blue;
  - no OneAgent routing: grey at 55 % opacity;
  - not connected: grey with a red ring;
  - down in the simulation: dark grey with ✕.
- A badge shows the connected OneAgent modules ([Q2](#q2-connected-oneagent-modules-per-activegate-activegateagentsquery), peak) when it is above 0.
- Nodes that receive traffic have a faint outer ring.
- Hover a node for name, type, group, zone, version, state, and connected OneAgent modules.
- Clicking a node depends on the mode toggle:
  - **Click: show connections** (default): selects the ActiveGate in [OneAgent connections](#oneagent-connections) and scrolls there.
  - **Click: simulate outage**: takes it down, or brings it back.

**Routing**: see [How routing is computed](#how-routing-is-computed). Every zone that has OneAgents (and the focused zone) gets four priority groups:

1. same zone;
2. its alternative zones;
3. the `default` zone ("same as group 1" for the default zone itself);
4. every other ActiveGate.

An ActiveGate belongs only to the first group that matches. An ActiveGate is *available* when it is connected, has `AGENT_ROUTING`, and is not down in the simulation. The fallback mode (or the what-if override) allows groups 1-4, 1-3 or 1-2. Traffic goes to the first allowed group with at least one available ActiveGate and is load-balanced inside it. When no allowed group has one, the traffic is **dropped**.

**Traffic** is drawn as lines from the zone's OneAgents to each ActiveGate in the target group.

- Colour per group: palette slots 1, 3, 7 and 2.
- Group 1 is solid; groups 2 to 4 are dashed.
- Inside a zone, lines are routed orthogonally; across zones they are curved.
- Moving dots (SVG `animateMotion`): 1 + floor(load / 15) per line, at most 4, where load = the target's connected OneAgent modules. One cycle takes 1.8 s for group 1 and 2.6 s otherwise. There are no dots when the OS asks for reduced motion.
- Hovering an ActiveGate or a zone dims the other traffic.

**Controls**: Zoom out (−) and Zoom in (+) by a factor of 1.2, from 0.5× to 2.5×; **Fit**; drag the background to pan; **Reset simulation** clears the outages, what-if modes and playback (disabled when nothing is simulated). When zones are off, a notice says the map shows how traffic would be routed once they are on.

**Legend**: Groups 1 to 4, Routes OneAgent traffic, No OneAgent routing, Not connected, Down (simulation), Traffic dropped, and "E host-based · K Kubernetes · S synthetic · Z zRemote · badge = connected OneAgent modules".

**Side panel.**

- With no zone focused, **Fallback chains** lists every zone: "N OneAgents → group G (n ActiveGates)", "traffic dropped" (red), or "No OneAgents · fallback …". It also shows "N ActiveGates down in the simulation". Click a zone to focus it.
- With a zone focused:
  - the zone name, its OneAgents and connected ActiveGates, and "all zones" to unfocus;
  - a **Fallback mode** select: the configured mode ("… (configured)" or "(default)"), or "What-if: \<mode\>" for the other two modes;
  - the mode's explanation;
  - the four groups, each with its zones and "available of total · reason". The reasons are: not allowed by the fallback (crossed out), same as group 1, no ActiveGate, none available, traffic goes here, standby. The target group lists up to 6 ActiveGate names;
  - a status line: "Traffic: group G, load-balanced over N ActiveGates." or "Traffic dropped: no group the fallback allows has an available ActiveGate.";
  - **▶ Play fallback** (disabled when the traffic is already dropped). Every 2.6 s it takes the current target group's ActiveGates down, so you can watch traffic move to the next group. Captions read "Normal: traffic goes to group 1." and then "\<group\> unavailable → traffic moves to group G (…)" or "… no allowed group left: traffic dropped". **Stop playback** ends it;
  - **Take the zone's ActiveGates down** marks every ActiveGate of the zone as down. It is disabled when the zone has none.

**Routing per zone as a table** (collapsed) is the accessible alternative to the map. Columns: Zone, OneAgents, Fallback, Traffic goes to ("Group G: label", "Dropped" in red, or "— (no OneAgents)"), ActiveGates used.

### Network zones (searchable list)

A Strato `DataTable` (sortable, resizable, line wrap, condensed) of every zone from the zone list, findings first. The search box (top right) keeps zones whose name, one of whose ActiveGates (name or ID), or one of whose OneAgents (host name or host group) contains the text, case-insensitive.

| Column | Meaning |
| --- | --- |
| Status | Blocking / Check / Info / OK ([zone rules](activegates.md#zone-list-client-side-zonerows)) |
| Network zone | name |
| Fallback | Any ActiveGate / Only default zone / None (drop traffic) (bold amber), or "not read"; second line "configured" or "not configured (default)"; hover for the explanation |
| Alternative zones | comma list or "none" |
| ActiveGates | "connected of total connected"; second line "N route OneAgents" |
| OneAgents | count from Q3 |
| Traffic now | "Group G: \<label\> (N ActiveGates)", or **Dropped** (red when the zone has OneAgents) |
| If its ActiveGates fail | the same for `zoneOutagePlan` (every ActiveGate of the zone down); "(no OneAgents)" when the zone has none |
| Finding | the zone's note |

**Expand a row** (the chevron) to see:

- **ActiveGates in \<zone\>**: name, purpose (and containerized), state (Not connected in red), OneAgent routing (Yes / No (module off)), connected OneAgent modules (Q2), routed OneAgents (how many OneAgents have this ActiveGate among their targets, "shared with N others"), version, group. "No ActiveGate is in this zone." when empty.
- **OneAgents in \<zone\>**: count, number of host groups and the first six, the current routing and the routing if the zone's own ActiveGates fail (red when dropped), the fallback explanation, and **Show the connections of these OneAgents**, which selects the zone's first host group in [OneAgent connections](#oneagent-connections) and scrolls there.
- **Hosts connected to the zone (measured)**: read when the row is expanded ([hostStats](#host-statistics)). Four lines: hosts that use the zone as an alternative; as failover with higher-priority ActiveGates available; as failover without one (red when not empty); and hosts configured for the zone but connected elsewhere. Host IDs are shown as host names when the host is in Q3; at most 20 per line. While network zones are off the API answers 404, shown as "not available (the API answers 404, as it does while network zones are off)"; a 403 says the scope is missing.

QueryActions below the table: [Q1](#q1-activegates-activegatesquery) ("Network zones: ActiveGates (inventory)") and [Q3](#q3-oneagents-with-their-zone-and-host-networkzoneoneagentsquery) ("Network zones: OneAgents with their zone and host").

### OneAgent connections

A custom SVG Sankey-style diagram (`ConnectionFlow` in [ConnectionFlow.tsx](../ui/app/tabs/ConnectionFlow.tsx); `connectionFlow` in [networkZones.ts](../ui/app/networkZones.ts)), then a table of OneAgents.

**Left: OneAgents**, grouped by zone and host group. Per zone at most 6 host groups, by size; the rest are merged into "N more host groups". Each node is labelled with the host group ("no host group" when empty), its OneAgent count, and "zone \<zone\>". When the zone's traffic is dropped the node is outlined red and labelled "✕ dropped · zone \<zone\>"; it has no ribbon. A group with a OneAgent matching the search is outlined in blue.

**Right: ActiveGates**: every ActiveGate with OneAgent routing, every ActiveGate with connected OneAgent modules (a zRemote reports z/OS agent modules, for example), and every ActiveGate that receives a ribbon; sorted by zone, then routed share. A node is blue when it routes OneAgents, grey otherwise, faded with a red outline when not connected. Next to each node:

- its name (and "(not connected)");
- **routed N %** (blue bar): its share of all OneAgents by the routing, where a OneAgent load-balanced over K ActiveGates counts 1/K for each of them;
- **measured N % (count)** (grey bar): its share of all connected OneAgent modules ([Q2](#q2-connected-oneagent-modules-per-activegate-activegateagentsquery)).

Both bars use the same scale. A big difference between them means the actual connections do not follow the zone routing. A OneAgent has one or more modules (OS module and code modules), so the measured share is a share of modules, not of OneAgents.

**Ribbons** go from a host group to each ActiveGate it is load-balanced over. Width = the group's OneAgents divided by the number of those ActiveGates (one scale on both sides), colour = the priority group (slots 1, 3, 7 and 2 as on the map). A dotted line moves along every visible ribbon (CSS animation; hidden when the OS asks for reduced motion).

**Interaction**: hover a ribbon or node for details. Click a host group to select it, an ActiveGate (node or ribbon) to select that ActiveGate; the other ribbons fade. On the map, clicking an ActiveGate in *show connections* mode selects it here and scrolls to this section. **Clear selection** clears it. **Find a OneAgent host** highlights the host groups with a matching host and filters the table.

**Legend**: the four priority groups, routed share, measured share.

**Table**: titled "All OneAgents", "OneAgents routed to \<ActiveGate\>" or "OneAgents of \<host group\> in zone \<zone\>", plus "matching "\<text\>"" and the count. Paged (25, 50 or 100 per page). Columns: OneAgent (host), zone, host group, mode, version, and **Routed to (load-balanced over)**: "group G · " and the ActiveGate names ("\<selected\> and N others" when an ActiveGate is selected), or "Dropped: no ActiveGate its zone's fallback allows" in red. "Showing the first 5,000 OneAgents." appears when Q3 hits its limit.

QueryActions: [Q2](#q2-connected-oneagent-modules-per-activegate-activegateagentsquery) ("Network zones: connected OneAgent modules per ActiveGate").

### Change network zones

Writes to the tenant, each with a Validate step and a confirmation; the simulation never writes anything. The forms are the same as on the ActiveGates tab:

- **Set the network zone of ActiveGates (API)**: [remote configuration](activegates.md#set-the-activegate-group-or-network-zone-remote-configuration) with *Network zone* preselected (host-based ActiveGates only).
- **Set the fallback and alternative zones of a network zone (API)**: shown when the zone settings were read. See [Zone fallback](activegates.md#set-a-network-zones-fallback-and-alternative-zones).
- **Turn on network zones (API)**: shown when zones are off and the settings were read. See [Turn on network zones](activegates.md#turn-on-network-zones).

After a fallback change or turning zones on, the zone settings are read again.

## Queries

| # | Query | Runs | Feeds |
| --- | --- | --- | --- |
| Q1 | ActiveGates (`activeGatesQuery`) | page load, timeframe change | every section |
| Q2 | Connected OneAgent modules per ActiveGate (`activeGateAgentsQuery`) | page load, timeframe change | map badges and particles, expanded rows, measured bars |
| Q3 | OneAgents with their zone and host (`networkZoneOneAgentsQuery`) | page load, timeframe change | zone OneAgent counts, summary, map, list, search, connections |

### Q1 ActiveGates (`activeGatesQuery`)

The ActiveGates tab's inventory query, unchanged: see [ActiveGates Q1](activegates.md#q1-inventory-activegatesquery). It gives each ActiveGate's zone, modules (for `AGENT_ROUTING`), connection state, type, version and group.

### Q2 Connected OneAgent modules per ActiveGate (`activeGateAgentsQuery`)

```dql
timeseries agents = max(dt.sfm.active_gate.communication.agent_modules.connected, scalar:true), by:{dt.active_gate.id}, filter:{isFalseOrNull(dt.active_gate.working_mode == "embedded")}, from:now()-24h
| fields agId = dt.active_gate.id, agents
```

**How it works:** the peak number of OneAgent modules connected to each environment ActiveGate in the timeframe (ActiveGate self-monitoring). OneAgent-embedded ActiveGates are left out; `isFalseOrNull` keeps series without a working mode.

**Output:** a map from ActiveGate ID to count: the map badges, particle density, expanded-row column and the measured bars.

### Q3 OneAgents with their zone and host (`networkZoneOneAgentsQuery`)

```dql
smartscapeNodes "ONEAGENT", from:now()-24h
| traverse edgeTypes:{monitors}, targetTypes:{HOST}, fieldsKeep:{id, name, dt.network_zone.id, dt.agent.module.version, dt.agent.monitoring_mode}
| fieldsAdd agent = dt.traverse.history[0]
| fields agentId = agent[id], zone = agent[`dt.network_zone.id`], version = agent[`dt.agent.module.version`], mode = agent[`dt.agent.monitoring_mode`],
    hostId = id, hostName = name, hostGroup = dt.host_group.id, cluster = k8s.cluster.name
| sort zone asc, hostName asc
| limit 5000
```

**How it works:** every OneAgent node follows its `monitors` edge to its host. `fieldsKeep` keeps the OneAgent's ID, zone, version and mode in `dt.traverse.history`; the host gives name, host group and Kubernetes cluster. One query, no lookup.

**Output:** one row per OneAgent (zone lowercase; null → `default`). The OneAgent count per zone is computed from these rows.

## API calls

### Network zone settings

`readNetworkZones` ([activeGates.ts](../ui/app/activeGates.ts)): one paged `getSettingsObjects` for `builtin:networkzones.zones` and `builtin:networkzones`, as on the [ActiveGates page](activegates.md#network-zone-settings).

### Host statistics

`readZoneHostStats(zone)` ([networkZones.ts](../ui/app/networkZones.ts)): `networkZonesClient.getHostStats({ id })`, `GET /api/v2/networkZones/{id}/hostStats`, scope `fleet-management:network-zones:read`. Called when a zone row is expanded (once per expansion). It returns host IDs in four lists: configured but not connected, connected as alternative, connected as failover, connected as failover without own ActiveGates. On the demo tenant it answers 404 while network zones are off.

## AI Assist on this page

`analyzeNetworkZones` ([analyses.ts](../ui/app/analyses.ts)) gets the zones (OneAgents, ActiveGates, routing ActiveGates, fallback, whether traffic is dropped now and after a zone outage), up to three ActiveGates whose measured and routed shares differ by 15 points or more, the selection, and whether network zones are on.

- **Summary**: zones, zones with OneAgents and their total, and how many zones lose their OneAgents' traffic when their own ActiveGates go down.
- **Insights**: zones off (info); zones whose traffic is dropped (critical); zones that would drop it on an outage (warning); zones without a routing ActiveGate of their own (info, with the group they use); measured vs routed differences (info); the selection.
- **Recommendations**: second routing ActiveGate, alternative zone or wider fallback for fragile zones (high); ActiveGates in zones that always fall back (medium); plan and turn on zones (low); a note that single OneAgent connections are not reported (low).

## Limitations and edge cases

- Which ActiveGate a single OneAgent uses is not reported; the connections show routing targets (load-balanced) and the measured load per ActiveGate.
- Measured load counts OneAgent modules, not OneAgents, and is a peak over the timeframe.
- The routing does not model ActiveGate types inside a group (Environment before Cluster before Embedded); this page only knows environment ActiveGates.
- Q3 stops at 5,000 OneAgents; larger tenants show the first 5,000 (sorted by zone, then host).
- Host statistics are only available while network zones are on.
- The simulation (outages, what-if fallback, playback) lives only in the page and is reset when you leave the tab.

## Related pages

- [ActiveGates](activegates.md): every ActiveGate, its modules, health, versions, groups, zone rules and the remediation forms used here.
- [OneAgents](oneagents.md): OneAgent versions and monitoring modes.
- [Index](README.md): areas, timeframe, shared components.

## Source files

| File | Role on this page |
| --- | --- |
| [ui/app/tabs/NetworkZonesTab.tsx](../ui/app/tabs/NetworkZonesTab.tsx) | Tab layout, data hook, summary, zone list with expandable rows, connections section, forms |
| [ui/app/tabs/NetworkZoneMap.tsx](../ui/app/tabs/NetworkZoneMap.tsx) | Network zone map, simulation, side panel, routing table |
| [ui/app/tabs/ConnectionFlow.tsx](../ui/app/tabs/ConnectionFlow.tsx) | OneAgent → ActiveGate connection diagram |
| [ui/app/networkZones.ts](../ui/app/networkZones.ts) | OneAgent rows, current and outage plans, search, connection model, host statistics |
| [ui/app/activeGates.ts](../ui/app/activeGates.ts) | `zoneRows`, `routingPlan`, `readNetworkZones`, zone writes |
| [ui/app/tabs/ActiveGatesTab.tsx](../ui/app/tabs/ActiveGatesTab.tsx) | Shared forms (`AssignForm`, `FallbackForm`, `EnableZonesForm`), `StatusCell`, `useApi` |
| [ui/app/queries.ts](../ui/app/queries.ts) | Q1–Q3 |
| [ui/app/analyses.ts](../ui/app/analyses.ts) | `analyzeNetworkZones` |
