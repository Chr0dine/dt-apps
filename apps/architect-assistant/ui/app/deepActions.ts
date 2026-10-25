import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import type { ManualAction, ManualVariant } from "./remediation";
import { meta, type Instance } from "./deepMonitoring";
import { DEEP_DOCS, DOC, type SupportStatus, type TechInfo } from "./deepTech";

// ---------------------------------------------------------------------------
// Manual deep-monitoring remediations. Commands are filled from the selected
// process's metadata where known; steps and notes follow the docs in deepTech.ts.
// ---------------------------------------------------------------------------

/** Workload name from the Kubernetes base pod name ("checkout-*" -> "checkout"). */
const workload = (i?: Instance) => (i ? meta(i, "KUBERNETES_BASE_POD_NAME")?.replace(/-\*$/, "") : undefined) ?? "<workload>";
const namespace = (i?: Instance) => (i ? meta(i, "KUBERNETES_NAMESPACE") : undefined) ?? "<namespace>";
const pod = (i?: Instance) => (i ? meta(i, "KUBERNETES_FULL_POD_NAME") : undefined) ?? "<pod>";

function restartVariants(info: TechInfo, i: Instance): ManualVariant[] {
  const windows = (i.osType ?? "").toUpperCase() === "WINDOWS";
  const v: ManualVariant[] = [];
  if (i.kubernetes) {
    v.push({ label: "Kubernetes (roll out)", language: "bash", code: `kubectl rollout restart deployment/${workload(i)} -n ${namespace(i)}\n# StatefulSet / DaemonSet: kubectl rollout restart statefulset/<name> -n ${namespace(i)}` });
  } else if (i.container) {
    const name = meta(i, "CONTAINER_NAME") ?? "<container>";
    v.push({ label: i.container === "podman" ? "Podman" : "Docker", language: "bash", code: `${i.container === "podman" ? "podman" : "docker"} restart ${name}` });
  }
  switch (info.key) {
    case "APACHE_HTTPD":
      v.push(
        { label: "Apache (Linux)", language: "bash", code: "sudo apachectl stop\nsudo apachectl start   # a full stop/start; apachectl restart or graceful is not enough" },
        { label: "Apache (Windows)", language: "powershell", code: 'httpd.exe -k stop -n "Apache2.4"\nhttpd.exe -k start -n "Apache2.4"' },
      );
      break;
    case "IIS":
    case "IIS_APP_POOL": {
      const pool = meta(i, "IIS_APP_POOL") ?? "<app pool>";
      v.push({ label: "IIS app pool", language: "powershell", code: `Import-Module WebAdministration\nRestart-WebAppPool -Name "${pool}"` }, { label: "IIS (all sites)", language: "powershell", code: "iisreset /restart" });
      break;
    }
    case "NGINX":
      v.push({ label: "NGINX (systemd)", language: "bash", code: "sudo systemctl restart nginx   # nginx -s reload keeps the master process, so it is not enough" });
      break;
    default:
      v.push(
        windows
          ? { label: "Windows service", language: "powershell", code: 'Restart-Service -Name "<service name>"' }
          : { label: "Linux (systemd)", language: "bash", code: "sudo systemctl restart <service name>" },
      );
  }
  return v;
}

/** Restart steps for the selected process's technology, OS and platform. */
export function restartAction(info: TechInfo, i: Instance): ManualAction {
  if (info.cics) return cicsAction;
  return {
    id: "restart",
    title: `Restart the ${info.label} process`,
    steps: [
      "Restart the process (stop and start; a reload is not enough): the code module is loaded at process start.",
      "Wait about a minute, then use Diagnose again: the instance should now report a code module.",
      "If it still has none, check OneAgent health on the host (Process restart needed / incompatible module).",
    ],
    variants: restartVariants(info, i),
    notes: [
      "Processes running when OneAgent was installed only report CPU and memory until they are restarted.",
      "Stopping or disabling OneAgent does not unload an injected code module; it stays until the process restarts.",
      ...(info.notes ?? []),
    ],
    docs: [DEEP_DOCS.troubleshoot, DEEP_DOCS.deepMonitoring, DEEP_DOCS.health, ...(info.key === "APACHE_HTTPD" ? [DEEP_DOCS.installTroubleshoot] : [])],
  };
}

const cicsAction: ManualAction = {
  id: "cics",
  title: "Check the CICS module installation",
  steps: [
    "Make sure ZDTPLT is in the PLTPI list (or enable it with the DTAX transaction: DTAX ENABLE).",
    "Add the SZDTLOAD library to DFHRPL and the Dynatrace CSD group to the group list.",
    "Check the zDC is running (message ZDTP004W means it is unavailable): start it, then run DTAX ENABLE.",
    "Keep the CICS module version at or below the zRemote version.",
  ],
  variants: [{ label: "CICS transaction", language: "text", code: "DTAX ENABLE" }],
  notes: ["CICS TS 6.2: DFHBPZDT must be present at startup.", "Add ZDTSOAPH to SOAP / JSON pipelines that should be traced.", "Xpediter storage protection can block the module."],
  docs: [DOC.cics, DOC.mainframe],
};

/** Kubernetes injection through the Dynatrace Operator; filled with the selected pod's namespace and workload when known. */
export function kubernetesAction(i?: Instance): ManualAction {
  const ns = namespace(i);
  return {
    id: "kubernetes",
    title: "Kubernetes: Operator injection",
    steps: [
      "Check the pod's injection annotations: oneagent.dynatrace.com/injected and, when false, oneagent.dynatrace.com/reason.",
      "Make sure the DynaKube injects into the namespace: cloudNativeFullStack or applicationMonitoring with a namespaceSelector that matches it (kube-*, openshift-* and the Operator's namespace are excluded by default).",
      'Remove oneagent.dynatrace.com/inject: "false" (or dynatrace.com/inject: "false") from the pod template; in opt-in mode add oneagent.dynatrace.com/inject: "true".',
      "Roll out the workload: the webhook only injects when a pod is created.",
    ],
    variants: [
      {
        label: "Check injection status",
        language: "bash",
        code: `kubectl get pod ${pod(i)} -n ${ns} -o jsonpath='{.metadata.annotations.oneagent\\.dynatrace\\.com/injected}{" "}{.metadata.annotations.oneagent\\.dynatrace\\.com/reason}{"\\n"}'`,
      },
      { label: "Select the namespace (label)", language: "bash", code: `kubectl label namespace ${ns} dt-monitoring=true --overwrite` },
      { label: "DynaKube namespaceSelector", language: "yaml", code: 'spec:\n  oneAgent:\n    cloudNativeFullStack:   # or applicationMonitoring\n      namespaceSelector:\n        matchLabels:\n          dt-monitoring: "true"' },
      { label: "Pod template annotation", language: "yaml", code: 'spec:\n  template:\n    metadata:\n      annotations:\n        oneagent.dynatrace.com/inject: "true"   # remove any "false" value' },
      { label: "Roll out", language: "bash", code: `kubectl rollout restart deployment/${workload(i)} -n ${ns}` },
      { label: "Operator troubleshoot", language: "bash", code: "kubectl exec deploy/dynatrace-operator -n dynatrace -- dynatrace-operator troubleshoot" },
    ],
    notes: [
      "Reasons on oneagent.dynatrace.com/reason: NoBootstrapperConfig, NoMutationNeeded, OwnerLookupFailed, MissingTenantUUID, DynaKubeStatusNotReady.",
      "Container monitoring rules are not supported with cloud-native full-stack; use the DynaKube namespace selector instead.",
      "The Operator appends its library to LD_PRELOAD: set LD_PRELOAD in the manifest, not in the image. Go static monitoring is only partially supported in these modes.",
    ],
    docs: [DEEP_DOCS.k8sAnnotate, DEEP_DOCS.k8sMutation, DEEP_DOCS.k8sFullStack, DEEP_DOCS.k8sAppMon, DEEP_DOCS.k8sTroubleshoot],
  };
}

/** Move the runtime to a supported version. */
export function upgradeAction(info: TechInfo, i: Instance, support: SupportStatus): ManualAction {
  return {
    id: "upgrade",
    title: `Upgrade ${info.label}${i.version ? ` ${i.version}` : ""}`,
    steps: [support.text, `Move the application to a supported ${info.label} version (see the technology support page and the vendor's support policy below).`, "Restart the process on the new runtime, then use Diagnose again."],
    variants: [],
    notes: info.notes,
    docs: [...info.docs, DEEP_DOCS.endOfSupport, ...info.external],
  };
}

/** OTLP endpoint of this environment (SaaS: <id>.live.dynatrace.com; the .apps. host does not accept OTLP). */
function otlpEndpoint(): string {
  try {
    return `https://${getEnvironmentId()}.live.dynatrace.com/api/v2/otlp`;
  } catch {
    return "https://<environment-id>.live.dynatrace.com/api/v2/otlp";
  }
}

export const otelAction = (label = "the application"): ManualAction => ({
  id: "otel",
  title: "Instrument with OpenTelemetry",
  steps: [
    `Add the OpenTelemetry SDK (or zero-code instrumentation) for ${label}.`,
    "Create a platform token with openpipeline:traces:ingest (plus metrics / logs ingest if you send them).",
    "Point the OTLP exporter at Dynatrace over HTTP/protobuf (gRPC and JSON are not accepted), or send through an OpenTelemetry Collector.",
  ],
  variants: [
    {
      label: "Exporter environment variables",
      language: "bash",
      code: `OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint()}\nOTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\nOTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <platform token>"`,
    },
  ],
  notes: ["Through an ActiveGate: https://<activegate>:9999/e/<environment-id>/api/v2/otlp.", "OpenTelemetry and OneAgent can be mixed per service. Ruby and Erlang need the OneAgent feature “Send W3C Trace Context HTTP headers” for end-to-end traces."],
  docs: [DOC.otel, DOC.otlp],
});

const extensionAction = (info: TechInfo): ManualAction => ({
  id: "extension",
  title: `Monitor ${info.label} with its extension`,
  steps: [
    `${info.label} itself is not deep monitored; requests to it already appear as calls from the deep-monitored applications.`,
    "Activate the Dynatrace extension for it (Hub) and run it from an ActiveGate (remote) or the OneAgent on its host (local), as the extension page describes.",
    "Use the Databases app to analyze database servers and their top statements.",
    "For databases, the Databases tab of this app checks the extension, the ActiveGate group and existing configurations, and can create the monitoring configuration.",
  ],
  variants: [],
  docs: info.docs,
});

/** What to use instead for technologies without a OneAgent code module. */
export function alternativeAction(info: TechInfo): ManualAction {
  if (info.alternativeKind === "extension") return extensionAction(info);
  if (info.key === "ENVOY") {
    return {
      ...otelAction("Envoy"),
      title: "Trace Envoy with OpenTelemetry",
      steps: [
        "Disable the OneAgent Envoy module first (Monitored technologies > Monitor Envoy off).",
        "Configure Envoy's OpenTelemetry tracer to export to the Dynatrace OTLP traces endpoint.",
        "Use a token with openpipeline:traces:ingest and adaptive-traffic-management:sampling-configuration:read.",
      ],
      notes: ["Envoy 1.30+ (Linux x86-64). This integration is outside the Dynatrace support policy."],
      docs: [DOC.envoyOtel, DOC.otlp],
    };
  }
  return { ...otelAction(info.label), docs: [...info.docs, DOC.otel, DOC.otlp].filter((d, n, all) => all.findIndex((x) => x.url === d.url) === n) };
}

/** Actions shown before a process is selected. */
export const GENERIC_ACTIONS: ManualAction[] = [
  {
    id: "restart-generic",
    title: "Restart processes after installing OneAgent",
    steps: [
      "Processes that were running when OneAgent was installed have no code module until they restart.",
      "Find them with the search above (Deep monitoring: Not deep monitored), restart them in a maintenance window, then check again.",
      "On Kubernetes, roll out the workloads; on IIS, recycle the app pools; for Apache, stop and start (restart is not enough).",
    ],
    variants: [
      { label: "Linux (systemd)", language: "bash", code: "sudo systemctl restart <service name>" },
      { label: "Windows service", language: "powershell", code: 'Restart-Service -Name "<service name>"' },
      { label: "Kubernetes", language: "bash", code: "kubectl rollout restart deployment/<workload> -n <namespace>" },
    ],
    docs: [DEEP_DOCS.troubleshoot, DEEP_DOCS.deepMonitoring],
  },
  kubernetesAction(),
  otelAction(),
];
