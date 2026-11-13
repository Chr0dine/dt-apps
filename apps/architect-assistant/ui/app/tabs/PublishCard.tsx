import React, { useEffect, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { useCredentials } from "../appCredentials";
import { ACCOUNT_MANAGEMENT_URL } from "../iamCatalog";
import { hasComments, publishToAccount, type PublishKind, type PublishResult } from "../iamPublish";
import { DocLink, code, hint } from "./IamShared";

// ---------------------------------------------------------------------------
// "Create in Account Management": sends the policy or boundary in the editor to the Account Management API (iam-publish
// function). Admins only. The text is validated by the API first; an existing object with the same name is only
// replaced after the user confirms.
// ---------------------------------------------------------------------------

const envId = () => {
  try {
    return getEnvironmentId();
  } catch {
    return "";
  }
};

export function PublishCard({ kind, name, text, errors }: { kind: PublishKind; name: string; text: string; errors: number }) {
  const { state } = useCredentials();
  const [level, setLevel] = useState<"environment" | "account">("environment");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  // A stale "exists" or success message must not apply to a different text or name.
  useEffect(() => setResult(null), [text, name, level]);

  const status = state && "status" in state ? state : null;
  // iam-publish reads only the app settings object, not the credential vault entry of earlier versions.
  const configured = status?.account.source === "app-settings";
  const vaultOnly = status?.account.source === "credential-vault";
  const noun = kind === "policy" ? "policy" : "boundary";
  const env = envId();
  const blocked = !name.trim() ? `Give the ${noun} a name first (Name and options).` : errors ? `Fix the ${errors === 1 ? "error" : `${errors} errors`} in the editor first.` : !text.trim() ? `The ${noun} is empty.` : null;

  const send = (replace?: string) => {
    setBusy(true);
    void publishToAccount({ kind, levelType: kind === "policy" ? level : undefined, name, description, text, replace }).then((r) => {
      setBusy(false);
      setResult(r);
    });
  };

  return (
    <div style={{ marginTop: Spacings.Size16, paddingTop: Spacings.Size12, borderTop: "1px solid rgba(128,128,128,0.25)" }}>
      <Heading level={5}>Create in Account Management</Heading>
      {state === null ? (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>Checking the app&apos;s credentials…</Text>
      ) : vaultOnly ? (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>
          The account OAuth client is still read from the credential vault of an earlier version. Save it once under Account Management access (Permissions Test tab) so it is stored in the
          app settings, then create {noun === "policy" ? "policies" : "boundaries"} from here.
        </Text>
      ) : !status || !configured ? (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>
          Needs the account OAuth client (Account Management access, on the Permissions Test tab) with{" "}
          <span style={code}>{kind === "policy" ? "iam:policies:write" : "iam:boundaries:write"}</span> or <span style={code}>iam-policies-management</span>.
        </Text>
      ) : !status.canManage ? (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>
          Only the app&apos;s admins (permission to change this app&apos;s settings) can create {noun === "policy" ? "policies" : "boundaries"} from here. Copy the text and create it in{" "}
          <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink> instead.
        </Text>
      ) : (
        <Flex flexDirection="column" gap={8} style={{ marginTop: 6 }}>
          <Text style={{ ...hint, display: "block" }}>
            {kind === "policy"
              ? "Validates the text with the Account Management API, then creates the policy. It applies to nobody until you bind it to a group."
              : "Validates the text with the Account Management API, then creates the boundary on the account. It narrows nothing until you select it when binding a policy to a group."}
            {hasComments(text) ? " Comment lines (// …) are not sent." : ""}
          </Text>
          {kind === "policy" && (
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              <ToggleButtonGroup value={level} onChange={(v: string) => v && setLevel(v as "environment" | "account")} name="publish-level">
                <ToggleButtonGroup.Item value="environment">{env ? `This environment (${env})` : "This environment"}</ToggleButtonGroup.Item>
                <ToggleButtonGroup.Item value="account">Account (all environments)</ToggleButtonGroup.Item>
              </ToggleButtonGroup>
            </Flex>
          )}
          {kind === "policy" && (
            <TextInput value={description} onChange={(v: string) => setDescription(v)} placeholder="Description (optional; default: Created with Architect Assistant)" aria-label="Policy description" />
          )}
          <Flex gap={8} alignItems="center" flexWrap="wrap">
            <Button variant="emphasized" disabled={busy || !!blocked} onClick={() => send()}>
              {busy ? "Sending…" : `Create ${noun}`}
            </Button>
            {blocked && <Text style={hint}>{blocked}</Text>}
          </Flex>
        </Flex>
      )}
      {result && <ResultMessage kind={kind} result={result} busy={busy} onReplace={(uuid) => send(uuid)} onCancel={() => setResult(null)} />}
    </div>
  );
}

function ResultMessage({ kind, result: r, busy, onReplace, onCancel }: { kind: PublishKind; result: PublishResult; busy: boolean; onReplace: (uuid: string) => void; onCancel: () => void }) {
  const noun = kind === "policy" ? "policy" : "boundary";
  const where = (levelType: string, levelId: string) => (levelType === "account" ? `the account (${levelId})` : `environment ${levelId}`);
  const box = { marginTop: Spacings.Size8 };
  if (r.status === "created" || r.status === "updated")
    return (
      <div style={box}>
        <MessageContainer variant="success">
          <MessageContainer.Description>
            <span>
              {kind === "policy" ? "Policy" : "Boundary"} <strong>{r.name}</strong> {r.status} on {where(r.levelType, r.levelId)}
              {r.uuid ? (
                <>
                  {" "}
                  (<span style={code}>{r.uuid}</span>)
                </>
              ) : null}
              .{" "}
              {kind === "policy"
                ? "Bind it to a group in Account Management > Identity & access management > Group management to grant it."
                : "Select it when binding a policy to a group in Account Management > Group management."}{" "}
              <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink>
            </span>
          </MessageContainer.Description>
        </MessageContainer>
      </div>
    );
  if (r.status === "exists")
    return (
      <div style={box}>
        <MessageContainer variant="warning">
          <MessageContainer.Title>A {noun} named &quot;{r.name}&quot; already exists</MessageContainer.Title>
          <MessageContainer.Description>
            <span>
              It is on {where(r.levelType, r.levelId)} (<span style={code}>{r.uuid}</span>). Replacing it changes the access of every group it is bound to. Rename this {noun} to create a new
              one instead.
            </span>
          </MessageContainer.Description>
        </MessageContainer>
        <Flex gap={8} style={{ marginTop: 8 }}>
          <Button color="critical" variant="emphasized" disabled={busy} onClick={() => onReplace(r.uuid)}>
            {busy ? "Replacing…" : `Replace the existing ${noun}`}
          </Button>
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </Flex>
      </div>
    );
  return (
    <div style={box}>
      <MessageContainer variant="critical">
        <MessageContainer.Title>
          {r.status === "invalid"
            ? `The Account Management API rejected the ${noun}`
            : r.status === "forbidden"
              ? "Only the app's admins can do this"
              : r.status === "blocked"
                ? "The app function cannot reach the Account Management API"
                : r.status === "unauthorized"
                  ? "The Account Management API refused the request"
                  : r.status === "no-credential"
                    ? "No OAuth client stored"
                    : `Creating the ${noun} failed`}
        </MessageContainer.Title>
        <MessageContainer.Description>
          <span>
            {"message" in r ? r.message : ""}
            {r.status === "invalid" && "details" in r && r.details?.length ? (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {r.details.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </span>
        </MessageContainer.Description>
      </MessageContainer>
    </div>
  );
}
