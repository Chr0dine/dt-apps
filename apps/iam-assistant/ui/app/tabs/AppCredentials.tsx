import React, { useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, PasswordInput, TextInput } from "@dynatrace/strato-components/forms";
import { CheckmarkIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { ACCOUNT_SCOPES, CREDENTIAL_DOCS, clearCredential, saveAccount, useCredentials, type ActionResult, type CredentialStatus, type CredentialUse } from "../appCredentials";
import { OUTBOUND_SCHEMA, settingsLink } from "../platform";
import { ACCOUNT_MANAGEMENT_URL } from "../iamCatalog";
import { DocLink, DocLinks, code, hint } from "./IamShared";

// ---------------------------------------------------------------------------
// The account OAuth client the Overview and Permissions Test tabs need. It is stored in the app settings (secret fields
// only the app's functions can read), so an admin sets it up once and the app's users never see or need it. Admins
// (app-settings:objects:write for this app) get the form; everyone else sees the status only.
// ---------------------------------------------------------------------------

const TITLE: Record<CredentialUse, string> = {
  account: "Account Management access",
};
const PURPOSE: Record<CredentialUse, string> = {
  account:
    "Groups, group membership, policies and boundaries are only exposed by the account-level Account Management API, which needs an OAuth client of the account.",
};
const panel: React.CSSProperties = { padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.3)" };

export function AppCredentialsCard({ use, onChanged }: { use: CredentialUse; onChanged?: () => void }) {
  const { state } = useCredentials();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const done = (r: ActionResult) => {
    setResult(r);
    if (r.ok) {
      setOpen(false);
      onChanged?.();
    }
  };
  const status = state && "status" in state ? state : null;
  const entry = status?.[use];
  const configured = !!entry?.source;
  return (
    <div style={panel}>
      <Flex justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={8}>
        <Text style={{ fontWeight: 600 }}>{TITLE[use]}</Text>
        {status?.canManage && (configured || open) && (
          <Button size="condensed" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Change"}
          </Button>
        )}
      </Flex>
      {state === null ? (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>Checking the app&apos;s credentials…</Text>
      ) : !status ? (
        <Text style={{ display: "block", fontSize: 12, marginTop: 4, color: Colors.Text.Critical.Default }}>Could not read the app&apos;s credentials: {(state as ActionResult).message}</Text>
      ) : (
        <StatusLine use={use} status={status} />
      )}
      {status && !status.canManage && !configured && (
        <Text style={{ ...hint, display: "block", marginTop: 4 }}>
          {PURPOSE[use]} An admin of this app (permission to change its settings) sets this up once, here or in the app&apos;s settings; you never need access to the token.
        </Text>
      )}
      {status?.canManage && (open || !configured) && (
        <div style={{ marginTop: 8 }}>
          <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
            {PURPOSE[use]} It is stored in this app&apos;s settings as a secret: only the app&apos;s functions can read it, so the app&apos;s users never see it.
          </Text>
          <AccountForm status={status} onDone={done} />
          {configured && entry?.source === "app-settings" && (
            <div style={{ marginTop: 8 }}>
              <Button size="condensed" variant="default" onClick={() => void clearCredential(use).then(done)}>
                Remove from the app settings
              </Button>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <DocLinks title="Documentation" docs={CREDENTIAL_DOCS[use]} />
          </div>
        </div>
      )}
      {result && <Text style={{ display: "block", marginTop: 6, fontSize: 12, color: result.ok ? Colors.Text.Success.Default : Colors.Text.Critical.Default }}>{result.message}</Text>}
    </div>
  );
}

function StatusLine({ use, status }: { use: CredentialUse; status: CredentialStatus }) {
  const e = status[use];
  const ok = (children: React.ReactNode) => (
    <Text style={{ display: "block", fontSize: 13, marginTop: 4 }}>
      <CheckmarkIcon style={{ width: 14, height: 14, verticalAlign: "-2px", color: Colors.Text.Success.Default }} /> {children}
    </Text>
  );
  if (e.source === "credential-vault")
    return (
      <Text style={{ display: "block", fontSize: 13, marginTop: 4, color: Colors.Text.Warning.Default }}>
        <WarningIcon style={{ width: 14, height: 14, verticalAlign: "-2px" }} /> Using the credential vault entry of an earlier version of this app.
        {status.canManage ? " Store it in the app settings below so it no longer depends on the vault entry's owner." : " An admin can move it to the app settings."}
      </Text>
    );
  if (!e.source) return <Text style={{ ...hint, display: "block", marginTop: 4 }}>Not set up yet.</Text>;
  const a = status.account;
  return ok(
    <>
      Stored in the app settings: account <span style={code}>{a.accountUuid}</span>, OAuth client <span style={code}>{a.clientId}</span>.{" "}
      {a.permissionsTestForAllUsers ? "Every user of this app can see the Overview and run the Permissions Test." : "Only the app's admins can see the Overview and run the Permissions Test."}
    </>,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <Text style={{ ...hint, display: "block", marginBottom: 4 }}>{label}</Text>
      {children}
    </label>
  );
}
const scopeList = (scopes: string[]) =>
  scopes.map((s) => (
    <span key={s} style={{ ...code, marginRight: 4 }}>
      {s}
    </span>
  ));

function AccountForm({ status, onDone }: { status: CredentialStatus; onDone: (r: ActionResult) => void }) {
  const a = status.account;
  const [accountUuid, setAccountUuid] = useState(a.accountUuid);
  const [clientId, setClientId] = useState(a.clientId);
  const [secret, setSecret] = useState("");
  const [forAll, setForAll] = useState(a.permissionsTestForAllUsers);
  const [busy, setBusy] = useState(false);
  const outbound = settingsLink(OUTBOUND_SCHEMA);
  const keepSecret = a.secret && a.source === "app-settings";
  return (
    <>
      <ol style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, lineHeight: "18px" }}>
        <li>
          In <DocLink href={ACCOUNT_MANAGEMENT_URL}>Account Management</DocLink> &gt; Identity &amp; access management &gt; OAuth clients, create a client with {scopeList(ACCOUNT_SCOPES)}
          (read-only; account-idm-read alone is enough for the Overview, the iam:* scopes are for the Permissions Test). The page also shows the account UUID.
        </li>
        <li>
          Allow {scopeList(["sso.dynatrace.com", "api.dynatrace.com"])}in the {outbound ? <DocLink href={outbound}>allowed outbound connections</DocLink> : "allowed outbound connections"} if that
          allowlist is enforced.
        </li>
      </ol>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        <Field label="Account UUID">
          <TextInput value={accountUuid} onChange={(v: string) => setAccountUuid(v)} placeholder="01234567-89ab-cdef-0123-456789abcdef" aria-label="Account UUID" />
        </Field>
        <Field label="Client ID">
          <TextInput value={clientId} onChange={(v: string) => setClientId(v)} placeholder="dt0s02.ABCD1234" aria-label="OAuth client ID" />
        </Field>
        <Field label={keepSecret ? "Client secret (empty = keep the stored one)" : "Client secret"}>
          <PasswordInput value={secret} onChange={(v: string) => setSecret(v)} placeholder="dt0s02.ABCD1234.…" aria-label="OAuth client secret" />
        </Field>
      </div>
      <div style={{ marginTop: 8 }}>
        <Checkbox value={forAll} onChange={(v: boolean) => setForAll(v)}>
          <span>Every user of this app may see the Overview and run the Permissions Test. Off: only the app&apos;s admins (they show the account&apos;s groups, members, policies and boundaries).</span>
        </Checkbox>
      </div>
      <Flex gap={8} style={{ marginTop: 8 }}>
        <Button
          variant="emphasized"
          disabled={busy || !accountUuid.trim() || !clientId.trim() || (!keepSecret && !secret.trim())}
          onClick={() => {
            setBusy(true);
            void saveAccount({ accountUuid, clientId, clientSecret: secret, permissionsTestForAllUsers: forAll }).then((r) => {
              setBusy(false);
              if (r.ok) setSecret("");
              onDone(r);
            });
          }}
        >
          {busy ? "Saving…" : "Save to the app settings"}
        </Button>
      </Flex>
    </>
  );
}
