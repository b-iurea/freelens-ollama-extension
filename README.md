# K8s SRE Assistant — Freelens Extension

An AI-powered **Kubernetes SRE (Site Reliability Engineer)** assistant embedded directly in Freelens. Chat with a local Ollama model that sees your live cluster state and adapts its response format to what you're actually asking.

![Freelens Extension](https://img.shields.io/badge/Freelens-Extension-blue)
![Version](https://img.shields.io/badge/version-0.2.0-orange)
![License](https://img.shields.io/badge/license-MIT-green)

---
NB. There are some issue relative to how models manage the answers and how it's forced to answer general contexts.
At the moment large cluster context are distruptive and small LLM maybe cannot handle the quantity of data proposed.
---

## Features

### Core

- **AI Chat Interface** — Conversational assistant integrated directly into the Freelens cluster view
- **Live Cluster Awareness** — The model sees pods, deployments, services, nodes, and events via direct `KubeApi.list()` calls
- **Ollama Integration** — Local or remote Ollama; no data leaves your network
- **Streaming Responses** — Block-level Markdown renderer safe for incomplete streamed output
- **Cancelable** — Interrupt generation at any time

---

### Smart Context Management

Designed to work well on small (3–9B) models against large production clusters(wip).

- **Context Pipeline** — ChunkManager → BM25 Retriever → SummaryManager → ContextBuilder prevents "lost-in-the-middle" on long conversations
- **K8s-Aware BM25 Retrieval** — Pure TypeScript BM25 that preserves compound terms (`kube-system`, `apps/v1`, pod names, IPs) as searchable tokens. Runs only on non-summarised messages to avoid duplicating the compressed history
- **Non-Blocking Summarisation** — After 20 exchange pairs, old turns are compressed into a two-part summary (**Facts & Decisions** + **Rolling Context**) via a background Ollama call delivered *after* the response — zero added latency
- **Anomaly-First Sorting** — CrashLoopBackOff/OOMKilled pods, replica-mismatch deployments, and NotReady nodes are sorted to the top before any truncation
- **Clean Data** — `managedFields`, long annotations, `pod-template-hash`, and other noisy metadata stripped before passing to the model
- **Token Budget** — Conversation history capped at ~2800 words; cluster context capped at ~1000 tokens

---

### Cluster Memory (v0.2.0)

Eliminates the "full cluster dump on every message" problem for large clusters.

- **Persistent Snapshot** — Cluster state saved to `localStorage` after every refresh. Freelens restart warm-starts instantly — no waiting for a K8s API scan
- **Namespace Health Rollup** — Every prompt includes a compact per-namespace overview at ~10 tokens/namespace:
  ```
  NAMESPACE OVERVIEW (5):
    prod-api:    43 Running · 2 CrashLoopBackOff   12 deps (1 degraded)   3 warnings
    staging:     28 Running · 2 Pending             10 deps (1 degraded)
    prod-db:      8 Running                          3 deps
    monitoring:  11 Running · 1 Pending              5 deps
    kube-system: 22 Running                          8 deps
  ```
- **Query-Relevant Filtering** — Each message injects only the 15 most BM25-relevant pods/deployments/services for the current query, plus all anomalous resources. The prompt shows `(15 shown of 180, most relevant + all anomalies)` so the model knows it is working with a subset
- **Health Aggregates** — Cluster-wide status counts (`170 Running · 7 Pending · 3 CrashLoopBackOff`) and deployment health (`105 healthy · 15 degraded`) computed once at snapshot time
- **Snapshot Age** — Shown in the Sources panel; stale snapshots (> 30 min) are flagged but still used as a fallback

**Token impact on a 180-pod cluster:**

| | v0.1.0 | v0.2.0 |
|--|--|--|
| System prompt cluster section | ~6,500 tokens | ~1,000 tokens |
| Reduction | — | ~85% |

---

### SRE-Native Agent Workflow (v0.2.0)

The assistant adapts its response format to the intent of the query — no more Evidence/Correlation/Hypotheses sections for a simple YAML request.

**Intent Detection** — every query is classified automatically:

| Intent | Triggered by | Response format |
|--------|-------------|-----------------|
| `write` | "write a deployment", "give me a YAML", "create a…" | Direct manifest + one-line RISK rating + verification step |
| `investigate` | "why is…", "debug…", "crashloop", "not working" | Evidence → Correlation → Hypotheses → Checks → Actions |
| `explain` | "what is…", "how does…", "explain…" | Clean prose explanation |
| `general` | Everything else | Concise direct answer |

**SRE Mode Presets** — six UI modes override intent detection:

| Mode | Behaviour |
|------|-----------|
| Auto | Intent detected from query text |
| Troubleshoot | Always full investigation format |
| Security | RBAC, PodSecurity, NetworkPolicy, image and secret risks |
| Cost | Waste reduction, right-sizing, autoscaling |
| Capacity | Saturation signals, scheduling pressure, scaling strategy |
| YAML | Always direct manifest output, no analysis preamble |

**Token-Aware Signals** — the Correlated Signals block (warning events, CrashLoop pods, replica mismatches) is injected only for `investigate` queries; skipped entirely for write/explain/general.

**Exports** — export the current investigation as a structured Markdown runbook, or export the full session as Markdown.

---

### UI & Developer Experience

- **In-Chat Model Selector** — Switch Ollama models from the chat header; takes effect immediately
- **SRE Mode Selector** — Select mode from the context bar: Auto / Troubleshoot / Security / Cost / Capacity / YAML
- **Suggested Actions** — Context-aware follow-up chips shown after each response to accelerate investigation loops
- **Sources Panel** — Shows what data the model used: snapshot age, filtered resource counts, warning event count
- **Performance Stats** — After each response: tokens/sec, prompt tokens, generation time, model load time
- **In-Chat Model Parameters** — Tune temperature, top_p, top_k, repeat penalty, and max tokens
- **In-Chat Connection Panel** — Configure Ollama endpoint and test via Node.js HTTP (no mixed-content issues)
- **Session Persistence** — Chat history persisted per `cluster + namespace`, restored on Freelens restart
- **Object-Aware Prompt Entry** — URL params (`kind/name/namespace/reason`) prefill a targeted investigation prompt
- **Persistent Settings** — All settings saved to `localStorage` and synced across Freelens contexts
- **Back Navigation** — One-click return to the cluster dashboard

---

### Network & Compatibility

- **No Mixed-Content Issues** — All Ollama API calls use Node.js `http`/`https` modules; plain HTTP remote Ollama works reliably from the Electron renderer
- **Remote Ollama** — Full support for remote instances (`OLLAMA_ORIGINS=*`, `OLLAMA_HOST=0.0.0.0:11434`)
- **Cloud Ollama** — `num_predict: -1` and other unsupported params are automatically stripped before sending

---

## Requirements

- **Freelens** >= 1.4.0
- **Ollama** running locally or on the network
- At least one model pulled (recommended below)

---

## Quick Start

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh
ollama serve
```

### 2. Pull a Model

```bash
# All work well with the v0.2.0 context pipeline on large clusters
ollama pull llama3.2        # 3B   — fast, good general purpose
ollama pull phi4-mini        # 3.8B — very fast on CPU, good for quick queries
ollama pull qwen2.5:7b      # 7B   — strong at YAML and structured data
ollama pull mistral          # 7B   — solid all-rounder
ollama pull gemma3:9b        # 9B   — strong reasoning, handles large clusters well
```

### 3. Install the Extension

```bash
git clone https://github.com/biurea/freelens-k8s-sre-assistant.git
cd freelens-k8s-sre-assistant
pnpm install
pnpm build
pnpm pack
```

In Freelens: **Extensions** → **Add Local Extension** → select the `.tgz` file.

---

## What Can It Do?

| Category | Example queries |
|----------|----------------|
| **Cluster health** | "What's the overall health of my cluster?" · "Are there any pods in CrashLoopBackOff?" |
| **Troubleshooting** | "Why is my deployment not rolling out?" · "Help me debug this crashing pod" |
| **YAML authoring** | "Write a simple nginx deployment" · "Add a liveness probe to this deployment" |
| **Optimization** | "Are there pods without resource limits?" · "Suggest HPA configs for my deployments" |
| **Security** | "Check for pods running as root" · "Review my RBAC configuration" |
| **Operations** | "How do I scale this deployment?" · "Generate a NetworkPolicy for namespace isolation" |

---

## Configuration

### Context Bar

Shows cluster name · namespace selector · pod/deployment counts · warning count · SRE mode selector · Refresh button.

Click **Refresh** to force a new K8s API scan and update the cluster memory snapshot.

### Sources Panel

Shows what data was used for the last response:

| Row | Description |
|-----|-------------|
| Cluster Memory | Snapshot age; flagged as stale if > 30 min |
| Pods | `N shown of M total` when query-filtered |
| Deployments | Filtered count + degraded count |
| Warning Events | Number of active warning events |

### Connection Panel (Ollama badge)

Click the **Ollama** / **Disconnected** badge:

- **Endpoint** — set the Ollama URL (e.g. `http://192.168.1.71:11434`)
- **Test Connection** — uses Node.js HTTP, bypasses browser mixed-content
- **Debug log** — detailed diagnostics with troubleshooting hints

### Namespace Selector

Scopes the AI's view to a single namespace. Nodes and the namespace list remain global. Changing namespace triggers an automatic context refresh.

### Performance Stats

After each response a button shows generation speed. Click to expand:

| Metric | Description |
|--------|-------------|
| Tokens/sec | Generation speed (green >= 20, yellow >= 8, red < 8) |
| Total time | End-to-end response time |
| Prompt tokens | Total tokens sent to the model |
| Prompt eval | Time to process the prompt |
| Generated tokens | Tokens in the response |
| Generation time | Time spent generating |
| Model load | Time to load the model |

### Model Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Temperature | 0 – 2 | Creativity vs determinism |
| Top P | 0 – 1 | Nucleus sampling threshold |
| Top K | 0 – 200 | Token vocabulary limit |
| Repeat Penalty | 1 – 2 | Penalize repeated tokens |
| Max Tokens | -1 – 8192 | Response length (-1 = model default) |

### Preferences Panel

**Freelens → Preferences → K8s SRE Assistant**

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Endpoint | `http://localhost:11434` | URL of your Ollama instance |
| Auto-refresh context | `true` | Gather cluster state before each message |

---

## Architecture

```
src/
├── main/
│   └── index.ts                    # Main process entry (Freelens lifecycle)
├── renderer/
│   ├── index.tsx                   # Renderer entry (registers pages, menus, preferences)
│   ├── components/
│   │   ├── sre-chat.tsx            # Chat UI + all panels (Connection, Params, Stats, Sources)
│   │   └── markdown-renderer.tsx   # Streaming-safe block-level Markdown renderer
│   ├── icons/sre-icon.tsx
│   ├── pages/sre-assistant-page.tsx
│   ├── preferences/sre-preferences.tsx
│   ├── services/
│   │   ├── ollama-service.ts       # Ollama API: Node.js HTTP, streaming, stats, system prompt
│   │   ├── k8s-context-service.ts  # K8s context via KubeApi.list() + namespace filtering
│   │   └── context/
│   │       ├── index.ts            # Barrel export
│   │       ├── chunk-manager.ts    # Sliding-window chunker (~300 words, 50 overlap)
│   │       ├── bm25-retriever.ts   # Pure-TS BM25 (k1=1.5, b=0.75), K8s-aware tokenizer
│   │       ├── summary-manager.ts  # Background Ollama-based conversation compression
│   │       ├── context-builder.ts  # Assembles: system -> summary -> BM25 chunks -> recent -> query
│   │       └── cluster-memory.ts   # Persistent snapshot, namespace rollup, BM25 query filter
│   └── stores/
│       └── chat-store.ts           # MobX state, pipeline orchestration, intent detection
└── common/
    └── types.ts                    # Shared TypeScript types
```

### Context Pipeline (per message)

```
 1. inferQueryIntent(query)
        -> write | investigate | explain | general

 2. buildFocusedContext(query)         [ClusterMemoryService]
        -> top-15 BM25-relevant pods/deps/svcs + all anomalous resources
        -> namespace health rollup (~10 tokens/namespace)
        -> cluster-wide status aggregates

 3. buildSystemPrompt(focusedCtx)      [OllamaService]
        -> SRE persona + NAMESPACE OVERVIEW + filtered resources

 4. [investigate only] buildCorrelatedSignalsBlock()
        -> warning events, crash pods, replica mismatches

 5. buildSreWorkflowInstruction(intent)
        -> format contract (skipped entirely for write/explain/general)

 6. ChunkManager.buildChunks()
        -> non-summarised history split into ~300-word overlapping chunks

 7. BM25Retriever.retrieve(query, 5)
        -> top-5 keyword-relevant conversation chunks

 8. ContextBuilder.assemble()
        -> system + summary + BM25 chunks + recent turns + query
        -> Jaccard deduplication removes chunks redundant with recent messages

 9. OllamaService.streamChatAssembled()
        -> streaming response + performance stats capture

10. [post-response] SummaryManager.maybeCompress()
        -> background compression when history > 20 pairs
        -> FACTS & DECISIONS (stable) + ROLLING CONTEXT (query-focused)

11. ClusterMemoryService.save(ctx)
        -> persist fresh snapshot after every K8s API refresh
```

**Key properties:**
- Zero npm dependencies for the pipeline — pure TypeScript
- Summarisation runs after the response, never blocking it
- BM25 retrieves only from non-summarised messages (no duplicate context)
- Anomalous resources always survive filtering regardless of query
- Namespace health rollup gives global cluster visibility at negligible token cost
- Intent detection skips all analysis overhead for YAML/explain/general queries

---

## Roadmap

### Completed

- [x] Preset SRE modes (Auto / Troubleshoot / Security / Cost / Capacity / YAML)
- [x] Suggested follow-up actions
- [x] Object-aware entry points (URL param prefill)
- [x] Sources / data visibility panel
- [x] Session persistence per cluster + namespace
- [x] Incident summary and runbook export
- [x] Internal SRE roles (Investigator / Explainer / YAML Author / Change Planner)
- [x] Read-first / write-later response contract
- [x] Correlated signal block (warnings + anomaly cues)
- [x] Cluster memory with warm-start and namespace health rollup
- [x] BM25 query-relevant filtering (~85-90% token reduction on large clusters)
- [x] Intent detection with format-per-intent responses

### Planned

- [ ] **Event and log correlation** — log correlation alongside warning event correlation
- [ ] **Cluster diff awareness** — compare snapshots across refreshes to explain what changed
- [ ] **Safe action queue** — queue kubectl commands/manifests for review before execution
- [ ] **Model/provider profiles** — ready-made profiles (Fast local / Balanced / Cloud deep analysis)
- [ ] **MCP support** — integrations with GitHub issues, runbook repos, incident systems, observability tools
- [ ] **Incident timeline UI** — visual timeline of warnings, restarts, rollout events, and assistant conclusions
- [ ] **Policy and config review** — deep RBAC / NetworkPolicy / PodSecurity / probes analysis

---

## Development

```bash
pnpm install       # Install dependencies
pnpm type:check    # TypeScript type check
pnpm build         # Production build
pnpm build:force   # Force rebuild
pnpm pack          # Pack .tgz for local Freelens installation
```

---

## Changelog

### v0.2.0

- **Cluster Memory** — persistent `localStorage` snapshot with warm-start on Freelens restart
- **Namespace Health Rollup** — per-namespace pod/deployment/event summary in every prompt (~10 tokens/namespace)
- **Query-Relevant Filtering** — BM25 selects top-15 relevant resources per message; anomalous resources always included
- **Health Aggregates** — cluster-wide and per-namespace status counts computed at snapshot time
- **Intent Detection** — queries classified as `write / investigate / explain / general`; response format adapts accordingly
- **Format-per-Intent** — YAML requests get a direct manifest; debugging gets full investigation structure; explanations get clean prose
- **SRE Mode Presets** — six UI-selectable modes override intent detection
- **Token Savings** — Correlated Signals block skipped for non-investigate queries; ~85-90% reduction in cluster context tokens on large clusters
- **Sources Panel** — snapshot age, filtered resource counts, warning event count
- **Suggested Actions** — contextual follow-up chips after each response
- **Session Persistence** — chat history persists per cluster + namespace
- **Runbook & Session Export** — export investigations as Markdown runbooks or full session logs
- **Popup Anchor Fix** — all panels anchor correctly to their trigger buttons

### v0.1.0

- Initial release: AI chat, live cluster awareness, streaming responses, BM25 context pipeline, non-blocking summarisation, anomaly-first sorting, K8s-aware tokenizer

---

## License

Copyright (c) 2026 biurea. [MIT License](https://opensource.org/licenses/MIT)
