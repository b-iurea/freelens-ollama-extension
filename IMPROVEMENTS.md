# Improvements Backlog

## 1. Richer Pod Data at Low Token Cost

### Currently sent per anomalous pod (~15 tokens)
```
api-server-7d9f4b-xkz2p  CrashLoopBackOff  ready=0/1
  ↳ api-server (main)  terminated · restarts=14 · exit=1
```

### Missing fields that matter for diagnosis

| Field | Why it matters | Token cost |
|---|---|---|
| Image tag | `myapp:1.2.2` vs `myapp:1.2.3` explains rollout crashes | ~5 |
| CPU/memory limits | `lim:512Mi` is why you get OOMKilled | ~8 |
| CPU/memory requests | Scheduling failures, throttling | ~8 |
| Probe type + path | `readinessProbe: http /healthz` failing is the #1 misdiagnosis | ~10 |
| Previous container log tail | The actual crash reason, e.g. `panic: nil pointer at main.go:42` | ~100 |
| Node the pod is on | Correlates with node-level failures | ~3 |
| Image pull policy | `Always` + private registry = intermittent pull failures | ~3 |

All of this data **already exists** in the raw pod object from `KubeApi.list()` — it is stripped in
`k8s-context-service.ts`. Fix: extend `K8sResourceSummary` and `extractContainerSummaries()` for
anomalous pods only.

### Target format (~30 tokens vs current ~15)
```
api-server-7d9f4b-xkz2p  CrashLoopBackOff  node=node-2  image=myapp:1.2.3
  ↳ api-server (main)  terminated · restarts=14 · exit=1 · OOMKilled
  ↳ resources: req=cpu:100m,mem:128Mi  lim=cpu:500m,mem:512Mi
  ↳ probes: liveness=httpGet:/healthz:8080  readiness=httpGet:/ready:8080
```

Double the tokens, ~5x the diagnostic value.

### Missing resource types
Currently only pods/deployments/services/nodes/events are collected. The model is blind to:

- **HPA** — `api-server HPA: 3/10 replicas (CPU: 95%)` directly relevant to scaling crashes
- **StatefulSets / DaemonSets** — not tracked at all
- **PVCs in Pending/Failed** — a pod stuck on volume mount looks like a pod problem but isn't
- **CronJobs with failed runs** — often the source of warning event noise
- **ConfigMaps / Secrets** (metadata only, no values) — referenced-but-missing = crash reason

---

## 2. Container Logs

The biggest gap. A pod with `exit=1` tells the model nothing. The last 20 log lines tell it everything.

Logs are also the **most sensitive data** in the cluster — they can contain connection strings,
internal hostnames, tokens, IP addresses, and user data. They must never be sent to a model
(especially a cloud one) without explicit user consent.

### Strategy — Human-in-the-loop tool approval

The model analyzes the relationship graph (Phase 3) first. When it determines that logs are needed
to complete the diagnosis, it **explains its reasoning in chat** and the UI presents an
approve/deny button before the tool executes. The model never sees the logs until the user approves.

```
1. User:  "perché il pod api-server crasha?"
2. Model: analyzes owner, resources, volumes, missing refs — no logs yet
3. Model: "Ho analizzato il pod api-server-7d9f4b. Il deployment ha 0/2 replicas
           ready. Il Secret/db-creds risulta MISSING nelle variabili d'ambiente.
           Per confermare il crash reason ho bisogno dei log dell'ultimo container
           terminato. Posso procedere?"
           [ ✓ Approva: get_pod_logs api-server ] [ ✗ Nega ]
4a. Approve → tool executes, model sees logs, completes analysis
4b. Deny   → model gives best-effort diagnosis without logs
```

**Why this is better than auto-inject:**

| | Auto-inject | Human-in-the-loop |
|---|---|---|
| Privacy | Logs always sent to model | Only with explicit consent |
| Token budget | Always consumed | Zero by default |
| Transparency | Model reads logs silently | Model explains why it needs them |
| Cloud Ollama | Privacy risk | GDPR-safe — explicit consent |
| UX | Invisible | User understands model's reasoning |
| Forced reasoning | None | Model must justify the request → often already diagnostic |

The fact that the model is **forced to explain before seeing logs** is itself diagnostic value:
if its explanation is already correct, the user can deny and already has the answer.

### Kubernetes API call
```
GET /api/v1/namespaces/{ns}/pods/{pod}/log
  ?container={name}
  &tailLines=30
  &previous=true
```

Freelens exposes this via `podsApi`. Add to `k8s-context-service.ts`:

```typescript
async function fetchPodLogs(
  podsApi: any,
  name: string,
  namespace: string,
  container: string,
): Promise<string | null> {
  try {
    const logText = await podsApi.getLogs({ name, namespace }, {
      container,
      tailLines: 30,
      previous: true,
    });
    return compressLogs(logText);
  } catch { return null; }
}
```

### `compressLogs()` logic
1. Deduplicate repeated lines (common with Java stack traces)
2. Strip timestamps
3. Keep only lines with: `ERROR`, `FATAL`, `panic`, `exception`, `WARN`, `failed`, stack frames
4. Hard-cap at 25 lines / ~200 tokens

### Implementation

| File | Change |
|---|---|
| `types.ts` | Add `ToolApprovalState` interface: `toolName`, `args`, `modelRationale` |
| `chat-store.ts` | Add `@observable pendingToolApproval: ToolApprovalState \| null`. When a `tool_call` for `get_pod_logs` arrives in the stream, pause execution and set `pendingToolApproval` instead of running it. On approve: execute tool, append result, resume. On deny: send synthetic `"User declined to share pod logs."` message and let model conclude. |
| `sre-chat.tsx` | Render approval block when `pendingToolApproval !== null`: show model rationale + approve/deny buttons |
| `k8s-tools.ts` | Add `get_pod_logs` tool definition |
| `k8s-context-service.ts` | Add `fetchPodLogs()` + `compressLogs()` (called only on approve) |
| `ollama-service.ts` | Add to system prompt: *"You have access to `get_pod_logs`. You MUST explain your reasoning before calling it. Design your analysis to be useful even if the user denies."* |

**All other tools** (`get_pod_detail`, `get_resource_chain`, etc.) execute automatically — only
`get_pod_logs` requires approval, because it is the only tool that fetches sensitive runtime data.

---

## 3. Privacy — Sending Data to Cloud Models

### Why true encryption doesn't work
An LLM must **understand** data to reason about it. AES-encrypting `"api-server is CrashLooping"`
produces `"A3f9...K2p"` — the model cannot help. Homomorphic encryption exists but is incompatible
with transformer inference (it only supports fixed algebraic operations, not softmax/attention).

### Option A — Pseudonymization (most practical)

Replace sensitive identifiers with opaque tokens locally, send tokens to the model, de-tokenize
responses before display.

```
prod-api               → ns-1
api-server-7d9f4b-xkz2 → pod-1
myregistry.com         → reg-1
192.168.1.55           → ip-1
```

Model sees: *"pod-1 in ns-1 is CrashLooping, image from reg-1"*
User sees: *"api-server-7d9f4b-xkz2 in prod-api is CrashLooping, image from myregistry.com"*

**Works for:** structural/causal reasoning  
**Breaks for:** name-semantic queries ("show me everything in the payments namespace")  
**Token cost:** zero — same data, different labels  

This is a standard GDPR-compliant analytics pattern.

### Option B — Selective field redaction

| Field | Action |
|---|---|
| Pod/deployment names | Keep (structural) or pseudonymize |
| Namespace names | Keep or pseudonymize |
| Registry URLs | Redact to `registry-[domain-hash]` |
| IP addresses | Always redact → `10.x.x.x` |
| Env variable **values** | Always redact (may contain secrets/tokens) |
| Env variable **names** | Keep — they tell the model what is configured |
| Event messages | Partial — keep error codes, redact hostnames |

---

## 4. Resource Relationship Graph (Cause/Effect Layer)

K8s failures are chains, not isolated facts. The model currently receives a flat list of resources
with no edges between them. It sees 5 separate anomalies where there is actually one root cause
with a blast radius.

### The missing chain

```
HPA (CPU 95%)
  → scales up Deployment/api-server (0/2 replicas ⚠)
      → Pod fails because Secret/db-creds is MISSING
          → Pod logs: "FATAL: env DB_PASSWORD not set"
              → Service/api-service has 0 endpoints
                  → Ingress returning 503
```

### Target prompt section (per anomalous pod)

```
ANOMALOUS POD: [prod-api] api-server-7d9f4b  CrashLoopBackOff  restarts=14
  → owner:     Deployment/api-server  replicas=0/2 ⚠  strategy=RollingUpdate
  → image:     myregistry.com/api-server:1.2.3
  → node:      node-2 [Ready]
  → resources: req=cpu:100m,mem:128Mi  lim=cpu:500m,mem:512Mi
  → probes:    readiness=httpGet:/ready:8080
  → volumes:   pvc/api-data [Bound ✓]  configmap/api-config [Present ✓]
               secret/db-creds [MISSING ⚠]
  → hpa:       api-server  min=2 max=10  current=3 (CPU: 95% ⚠)
  → service:   api-service → 0 endpoints ⚠ (selector matches 0 ready pods)
  → logs:
      ERROR: env DB_PASSWORD not set
      FATAL: failed to connect to database, aborting
```

This is the first answer the user cannot get faster from the Freelens UI.

### Relationships to resolve per anomalous pod

Exact traversal paths derived from `freelens-resource-map-extension` source code.

| Edge | Raw K8s field | What to check |
|---|---|---|
| Pod → owner controller | `pod.metadata.ownerReferences[0]` (kind+name) for StatefulSet/DaemonSet; for Deployments: match `deployment.spec.selector.matchLabels` against `pod.metadata.labels` (ownerRef points to ReplicaSet, not Deployment) | Controller degraded? Rollout strategy? Replicas? |
| Pod → Secret (env) | `container.env[].valueFrom.secretKeyRef.name` | Secret exists? **MISSING ⚠ if not** |
| Pod → Secret (envFrom) | `container.envFrom[].secretRef.name` | Secret exists? **MISSING ⚠ if not** |
| Pod → ConfigMap (envFrom) | `container.envFrom[].configMapRef.name` | ConfigMap exists? **MISSING ⚠ if not** |
| Pod → PVC (volumes) | `pod.spec.volumes[].persistentVolumeClaim.claimName` | PVC status = Bound/Pending/Lost? |
| Pod → ConfigMap (volumes) | `pod.spec.volumes[].configMap.name` | ConfigMap exists? **MISSING ⚠ if not** |
| Pod → Secret (imagePullSecrets) | `pod.spec.imagePullSecrets[].name` | Secret exists? **MISSING ⚠ → direct cause of ImagePullBackOff** |
| Service → Pod | `service.spec.selector` all key/values must match `pod.metadata.labels`, same namespace | 0 matches = 0 endpoints ⚠ |
| Ingress → Service | `ingress.spec.rules[].http.paths[].backend.service.name` (networking.k8s.io/v1) OR `ingress.spec.rules[].http.paths[].backend.serviceName` (extensions/v1beta1) | Service exists? |
| Ingress → Secret (TLS) | `ingress.spec.tls[].secretName` | TLS secret exists? **MISSING ⚠** |
| Controller → HelmRelease | `labels.heritage=Helm` + `labels.release` (Helm 2) OR `labels["app.kubernetes.io/managed-by"]="Helm"` + `annotations["meta.helm.sh/release-name"]` (Helm 3) | Part of a Helm release? Version? |
| HPA → Controller | `hpa.spec.scaleTargetRef.name` | Current/desired replicas, CPU/memory % |
| ResourceQuota | namespace-scoped | Namespace at capacity, blocking scheduling? |

**Critical insight:** The visual resource map only draws edges to resources that *exist*. For SRE diagnosis, **missing edges** (a pod referencing a secret or configmap that does not exist) are the most valuable signal. Flag them as `MISSING ⚠` rather than silently omitting them.

### Implementation plan

| File | Change |
|---|---|
| `k8s-context-service.ts` | Fetch HPAs, PVCs, Secret names (metadata only), ConfigMap names (metadata only), Ingresses, ResourceQuotas once per context refresh. Add `resolveRelations(rawPod, allResources)` |
| `types.ts` | Add `PodRelations` interface: `ownerRef`, `pvcs[]`, `missingRefs[]` (with `kind`/`name`/`refType`), `hpa?`, `serviceEndpoints?`, `ingressChain?`, `helmRelease?` |
| `k8s-compressor.ts` | Add `extractPodRelations()` — only for anomalous pods, zero cost for healthy ones |
| `ollama-service.ts` | Replace flat `ANOMALOUS PODS` section with cause-chain block in `buildSystemPrompt()` |
| `k8s-tools.ts` | Add `get_resource_chain` tool for on-demand drill-down on any resource |

**Key constraint:** graph resolution is pure lookups on already-fetched data — the only extra API
calls are fetching HPAs, PVCs, Secret/ConfigMap names, Ingresses, and ResourceQuotas once per
context refresh. No per-pod API calls. Secret/ConfigMap **values** are never fetched — only names,
to detect missing references without leaking sensitive data.

### Phased delivery

| Phase | Scope | Value unlock |
|---|---|---|
| 1 | Richer anomaly fields (image, node, resources, probes) | Removes "I can only tell you it's crashing" |
| 2 | Container log fetch (`previous=true`, tail 30 lines) | Turns `exit=1` into an actual root cause |
| 3 | Resource relationship graph (owner, volumes, missing refs, HPA, service endpoints) | First answers the user cannot get faster from the Freelens UI |
| 4 | Missing resource types (HPA, PVC, StatefulSet, DaemonSet, ResourceQuota) | Completes the graph; removes blind spots |

---

## Token Budget Impact

`MAX_CONTEXT_WORDS = 2800` (≈ 3,500 tokens for K8s data; special chars/paths tokenize at ~1.5× word rate).

### Baseline (current, per anomalous pod)
```
api-server-7d9f4b  CrashLoopBackOff  ready=0/1          → ~8 tokens
  ↳ api-server (main)  terminated · restarts=14 · exit=1  → ~10 tokens
```
**~18 tokens/pod × 3 pods = ~55 tokens total for ANOMALOUS PODS section**

---

### Phase 1 — Richer pod fields (per pod)

| Addition | Example rendered text | Tokens |
|---|---|---|
| image | `→ image: myregistry.com/api-server:1.2.3` | ~10 |
| node | `→ node: node-2 [Ready]` | ~6 |
| resources | `→ resources: req=cpu:100m,mem:128Mi lim=cpu:500m,mem:512Mi` | ~15 |
| probes | `→ probes: readiness=httpGet:/ready:8080` | ~10 |
| imagePullPolicy | `pullPolicy=Always` (appended to image line) | ~4 |
| **Subtotal per pod** | | **~45 tokens** |
| **3 anomalous pods** | | **+135 tokens** |

Budget impact: **+4%** (135 / 3500). Negligible.

---

### Phase 2 — Container logs (human-in-the-loop tool call)

Logs are **not** injected into the system prompt. They are fetched on-demand via `get_pod_logs`
only after explicit user approval. The token cost is therefore **zero by default**.

| Scenario | Tokens |
|---|---|
| Default (no approval) | **0** |
| User approves for 1 pod (25 filtered lines × ~8 tokens/line) | ~200 tokens |
| User approves for 3 pods | ~600 tokens — still within budget |

Budget impact: **0% by default**. When approved: ~+6% per pod (200 / 3500).

No mitigation caps needed — the user controls the budget by choosing whether to approve each call.

---

### Phase 3 — Relationship graph (per pod)

| Line | Example | Tokens |
|---|---|---|
| owner | `→ owner: Deployment/api-server replicas=0/2 ⚠ strategy=RollingUpdate` | ~12 |
| volumes (3 refs) | `→ volumes: pvc/api-data [Bound ✓] configmap/api-config [Present ✓] secret/db-creds [MISSING ⚠]` | ~20 |
| hpa | `→ hpa: api-server min=2 max=10 current=3 (CPU: 95% ⚠)` | ~15 |
| service | `→ service: api-service → 0 endpoints ⚠` | ~8 |
| ingress | `→ ingress: api-ingress → api-service` | ~7 |
| helm | `→ helm: my-app v1.2.3` | ~6 |
| **Subtotal per pod** | | **~70 tokens** |
| **3 anomalous pods** | | **+210 tokens** |

Budget impact: **+6%**. Negligible.

---

### Phase 4 — New resource types (cluster-level, not per-pod)

| Resource type | Example | Tokens each | Typical count | Total |
|---|---|---|---|---|
| HPA | `api-server HPA: 3/10 (CPU:95% ⚠)` | ~10 | 3 | ~30 |
| PVC (non-Bound) | `api-data [Pending] 10Gi` | ~8 | 2 | ~16 |
| StatefulSet | `mysql/statefulset ready=1/3 ⚠` | ~10 | 2 | ~20 |
| DaemonSet | `fluentd/daemonset ready=4/5 ⚠` | ~10 | 1 | ~10 |
| ResourceQuota | `prod-api: cpu 95/100 mem 7/8Gi ⚠` | ~12 | 2 | ~24 |
| **Phase 4 total** | | | | **~100 tokens** |

Budget impact: **+3%**. Negligible.

---

### Cumulative budget projection (3 anomalous pods, `investigate` intent)

| Component | Current | After all phases |
|---|---|---|
| System prompt static text | ~300 | ~300 |
| Cluster summary (healthy pods, nodes, services) | ~400 | ~500 (+Phase 4) |
| ANOMALOUS PODS — base fields | ~55 | ~55 |
| ANOMALOUS PODS — richer fields (Phase 1) | 0 | +135 |
| ANOMALOUS PODS — relationship graph (Phase 3) | 0 | +210 |
| ANOMALOUS PODS — logs (Phase 2, 3 pods × 15 lines) | 0 | +300 |
| BM25 retrieved chunks | ~600 | ~600 |
| Conversation history / summary | ~400 | ~400 |
| **Total** | **~1,755** | **~2,500** |
| Budget remaining | ~1,745 | ~1,000 |

All four phases fit within the 3,500-token budget. The `compressLogs()` cap and the 3-pod log limit
are the critical safety valves — without them, 5 uncapped pods at 30 lines each would push the
prompt to ~4,500 tokens and begin truncating BM25 context.

---

## Priority

| Change | Value | Effort | Token cost |
|---|---|---|---|
| Add image + resource limits to anomalous pods | High | Low — data already in raw object | +15/pod |
| Add probe config + node + imagePullPolicy | High | Low | +20/pod |
| `get_pod_logs` tool + human-in-the-loop approval UI | Very high | Medium | 0 default; +~200/pod if approved |
| Relationship graph (owner, volumes, missing refs) | Very high | Medium | +70/pod |
| Add HPA + PVC non-Bound to context | Medium | Medium | +46 total |
| Add StatefulSet / DaemonSet tracking | Medium | Medium | +30 total |
| ResourceQuota per namespace | Medium | Low | +24 total |
| Pseudonymization layer | Medium (privacy) | High | 0 (same tokens, different labels) |
