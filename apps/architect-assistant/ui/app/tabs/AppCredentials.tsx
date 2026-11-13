import React, { useEffect, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, PasswordInput, Select, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { CheckmarkIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import {
  ACCOUNT_SCOPES,
  CREDENTIAL_DOCS,
  PLATFORM_TOKEN_SCOPES,
  TOKEN_MANAGE_SCOPE,
  clearCredential,
  generateReadConfigToken,
  generateWorkflowsToken,
  listServiceUsers,
  saveAccount,
  saveToken,
  useCredentials,
  type ActionResult,
  type CredentialStatus,
  type CredentialUse,
  type ServiceUser,
} from "../appCredentials";
import { settingsLink } from "../deepMonitoring";
import { OUTBOUND_SCHEMA } from "../deepDocs";
import { ACCOUNT_MANAGEMENT_URL } from "../iamCatalog";
import { accountHosts } from "../iamAccessApi";
import { DocLink, DocLinks, code, hint } from "./IamShared";

// ---------------------------------------------------------------------------
// One card per credential the app needs (account OAuth client for the Permissions Test, platform token for the Problem
// notifications workflows, ReadConfig API token for Frontends user tags). Everything is stored in the app settings
// (secret fields only the app's functions can read), so an admin sets it up once and the app's users never see or need
// a token. Admins (app-settings:objects:write for this app) get the forms; everyone else sees the status only.
// ---------------------------------------------------------------------------

const TITLE: Record<CredentialUse, string> = {
  account: "Account Management access",
  workflows: "Platform token for creating workflows",
  readconfig: "ReadConfig API token for user tags",
};
const PURPOSE: Record<CredentialUse, string> = {
  account:
    "Group membership, policies and boundaries are only exposed by the account-level Account Management API, which needs an OAuth client of the account. The same client can generate the platform token the Problem notifications tab needs.",
  workflows:
    "Apps not provided by Dynatrace cannot hold automation:workflows:write, so the app's workflows function creates the migration workflows with a platform token. Workflows belong to the token's user: generate it for a service user.",
  readconfig: "User tag rules are only exposed by the classic Config API, which needs an API token with the ReadConfig scope.",
};
const DAYS = [30, 90, 180, 365];
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
          {use === "account" ? <AccountForm status={status} onDone={done} /> : use === "workflows" ? <WorkflowsForm status={status} onDone={done} /> : <ReadConfigForm onDone={done} />}
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
  if (use === "account") {
    const a = status.account;
    return ok(
      <>
        Stored in the app settings: account <span style={code}>{a.accountUuid}</span>, OAuth client <span style={code}>{a.clientId}</span>.{" "}
        {a.permissionsTestForAllUsers ? "Every user of this app can run the Permissions Test." : "Only the app's admins can run the Permissions Test."}
      </>,
    );
  }
  const t = status[use as "workflows" | "readconfig"];
  return ok(
    <>
      Stored in the app settings{t.token ? <>: <span style={code}>{t.token}</span></> : ""}. {t.info}
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
          (Permissions Test) and {scopeList([TOKEN_MANAGE_SCOPE])}(generating platform tokens). The page also shows the account UUID.
        </li>
        <li>
          Allow {scopeList(accountHosts())}in the {outbound ? <DocLink href={outbound}>allowed outbound connections</DocLink> : "allowed outbound connections"} if that
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
          <span>Every user of this app may run the Permissions Test. Off: only the app&apos;s admins (it shows the account&apos;s groups, policies and boundaries).</span>
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

function DaysSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <Select value={String(value)} onChange={(v: string | null) => v && onChange(Number(v))} aria-label="Valid for">
      <Select.Trigger width="full" />
      <Select.Content>
        {DAYS.map((d) => (
          <Select.Option key={d} value={String(d)}>
            {d} days
          </Select.Option>
        ))}
      </Select.Content>
    </Select>
  );
}

function PasteToken({ kind, placeholder, label, onDone }: { kind: "workflows" | "readconfig"; placeholder: string; label: string; onDone: (r: ActionResult) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
      <div style={{ flex: "1 1 320px" }}>
        <Field label={label}>
          <PasswordInput value={token} onChange={(v: string) => setToken(v)} placeholder={placeholder} aria-label={label} />
        </Field>
      </div>
      <Button
        variant="emphasized"
        disabled={busy || !token.trim()}
        onClick={() => {
          setBusy(true);
          void saveToken(kind, token).then((r) => {
            setBusy(false);
            if (r.ok) setToken("");
            onDone(r);
          });
        }}
      >
        {busy ? "Saving…" : "Save to the app settings"}
      </Button>
    </Flex>
  );
}

function WorkflowsForm({ status, onDone }: { status: CredentialStatus; onDone: (r: ActionResult) => void }) {
  const canGenerate = status.account.source === "app-settings";
  const [mode, setMode] = useState<"generate" | "paste">(canGenerate ? "generate" : "paste");
  const [users, setUsers] = useState<ServiceUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [user, setUser] = useState("me");
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (mode !== "generate" || users) return;
    listServiceUsers()
      .then(setUsers)
      .catch((e) => {
        setUsers([]);
        setUsersError((e as Error)?.message ?? String(e));
      });
  }, [mode, users]);
  const picked = users?.find((u) => u.uid === user);
  return (
    <>
      <ToggleButtonGroup value={mode} onChange={(v: string) => v && setMode(v as "generate" | "paste")} name="workflows-token-mode">
        <ToggleButtonGroup.Item value="generate">Generate in this environment</ToggleButtonGroup.Item>
        <ToggleButtonGroup.Item value="paste">Paste a token</ToggleButtonGroup.Item>
      </ToggleButtonGroup>
      <div style={{ marginTop: 8 }}>
        {mode === "generate" ? (
          canGenerate ? (
            <>
              <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
                Creates a platform token for this environment with {scopeList(PLATFORM_TOKEN_SCOPES)}through the account&apos;s OAuth client (it needs{" "}
                {scopeList([TOKEN_MANAGE_SCOPE])}), then stores it. The token only works within its user&apos;s permissions, and the workflows belong to that user.
              </Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                <Field label="Generate for">
                  <Select value={user} onChange={(v: string | null) => v && setUser(v)} aria-label="Generate for">
                    <Select.Trigger width="full" />
                    <Select.Content>
                      <Select.Option value="me">Me</Select.Option>
                      {(users ?? []).map((u) => (
                        <Select.Option key={u.uid} value={u.uid}>
                          {`Service user: ${u.name}`}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </Field>
                <Field label="Valid for">
                  <DaysSelect value={days} onChange={setDays} />
                </Field>
              </div>
              <Text style={{ ...hint, display: "block", marginTop: 4 }}>
                {users === null ? "Reading service users…" : usersError ? `Service users could not be listed (${usersError}); generating for yourself still works.` : users.length ? "" : "No service user available to you; the token is generated for you."}
              </Text>
              <Flex gap={8} style={{ marginTop: 8 }}>
                <Button
                  variant="emphasized"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void generateWorkflowsToken({ userUuid: picked?.uid, userLabel: picked ? `service user ${picked.name}` : undefined, days }).then((r) => {
                      setBusy(false);
                      onDone(r);
                    });
                  }}
                >
                  {busy ? "Generating…" : "Generate platform token"}
                </Button>
              </Flex>
            </>
          ) : (
            <Text style={{ ...hint, display: "block" }}>
              Generating needs the account OAuth client (Account Management access, on the Permissions Test tab) with {scopeList([TOKEN_MANAGE_SCOPE])}. Or paste a token you created in
              Account Management.
            </Text>
          )
        ) : (
          <>
            <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
              Create it in <DocLink href="https://myaccount.dynatrace.com/platformTokens">My platform tokens</DocLink> for this environment with {scopeList(PLATFORM_TOKEN_SCOPES)}, ideally for a
              service user.
            </Text>
            <PasteToken kind="workflows" label="Platform token" placeholder="dt0s16.ABCD1234.…" onDone={onDone} />
          </>
        )}
      </div>
    </>
  );
}

function ReadConfigForm({ onDone }: { onDone: (r: ActionResult) => void }) {
  const [mode, setMode] = useState<"generate" | "paste">("generate");
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <ToggleButtonGroup value={mode} onChange={(v: string) => v && setMode(v as "generate" | "paste")} name="readconfig-token-mode">
        <ToggleButtonGroup.Item value="generate">Create in this environment</ToggleButtonGroup.Item>
        <ToggleButtonGroup.Item value="paste">Paste a token</ToggleButtonGroup.Item>
      </ToggleButtonGroup>
      <div style={{ marginTop: 8 }}>
        {mode === "generate" ? (
          <>
            <Text style={{ ...hint, display: "block", marginBottom: 8 }}>
              Creates an API token with only the ReadConfig scope (with your permission to create API tokens) and stores it; the value is never shown.
            </Text>
            <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
              <div style={{ width: 200 }}>
                <Field label="Valid for">
                  <DaysSelect value={days} onChange={setDays} />
                </Field>
              </div>
              <Button
                variant="emphasized"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void generateReadConfigToken(days).then((r) => {
                    setBusy(false);
                    onDone(r);
                  });
                }}
              >
                {busy ? "Creating…" : "Create ReadConfig token"}
              </Button>
            </Flex>
          </>
        ) : (
          <PasteToken kind="readconfig" label="API token (ReadConfig scope)" placeholder="dt0c01.XXXXXXXX.YYYYYYYY" onDone={onDone} />
        )}
      </div>
    </>
  );
}
