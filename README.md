# 🤖 K8s SRE Assistant - Freelens Extension

A Freelens extension that adds an AI-powered **Kubernetes SRE (Site Reliability Engineer)** assistant tab to your cluster view. Chat with an Ollama-powered AI model that can see your cluster's resources and help you troubleshoot, optimize, and manage your Kubernetes infrastructure.

![K8s SRE Assistant](https://img.shields.io/badge/Freelens-Extension-blue)
![Version](https://img.shields.io/badge/version-0.2.0-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## 📸 Screenshots

<!-- TODO: Add screenshots -->
| Screenshot | Description |
|:----------:|-------------|
![Chat UI](docs/screenshots/chat-ui.png) | **Chat interface** — Ask questions about your cluster, get streaming Markdown responses |
![Context Bar](docs/screenshots/context-bar.png) | **Context bar** — Cluster name, namespace selector, resource counts, health badge |
![Connection Panel](docs/screenshots/connection-panel.png) | **Connection panel** — Configure Ollama endpoint, test connectivity |
![Model Params](docs/screenshots/model-params.png) | **Model parameters** — Tune temperature, top_p, top_k, repeat penalty |
![Performance Stats](docs/screenshots/perf-stats.png) | **Performance stats** — Tokens/sec, prompt eval, generation time |
![Friendly welcome](docs/screenshots/friendly-welcome.png) | **Friendly cluster overview**

## ✨ Features

### Core
- **🧠 AI Chat Interface** — Conversational AI assistant integrated directly into Freelens
- **👁️ Cluster Awareness** — The AI sees your pods, deployments, services, nodes, and events in real-time via direct K8s API calls (`KubeApi.list()`)
- **📡 Ollama Integration** — Uses local or remote Ollama for privacy-first AI (no data leaves your network)
- **💬 Streaming Responses** — Real-time streaming with a block-level Markdown renderer safe for incomplete output
- **🛑 Cancelable** — Stop AI generation at any time

### Smart Context Management (for small models)
- **📦 Namespace Selector** — Filter context to a specific namespace in the UI; cluster-scoped resources (nodes) remain visible regardless
- **🧩 Context Pipeline** — In-process ChunkManager → BM25 Retriever → SummaryManager → ContextBuilder pipeline prevents "lost-in-the-middle" with small (2-4B) models
- **📊 BM25 Retrieval** — K8s-aware keyword retrieval (pure TypeScript) preserves compound terms like `kube-system`, `apps/v1`, pod names, and IPs as searchable tokens. Retrieval runs only on non-summarised messages to avoid duplicating the summary
- **📝 Non-Blocking Summarisation** — When conversation exceeds 20 exchange pairs, old turns are compressed into a two-section summary (stable **Facts & Decisions** + query-focused **Rolling Context**) via a background Ollama call *after* the response is delivered — zero added latency
- **🔢 Token Budget** — Cluster context and conversation history are capped and cleaned (noisy labels stripped, event messages truncated, per-resource limits) to stay within small model context windows
- **🚨 Anomaly-First Sorting** — Pods in CrashLoopBackOff/Error/OOMKilled, deployments with replica mismatch, and NotReady nodes are sorted to the top *before* truncation, so the AI always sees the most actionable resources
- **🧹 Clean Data** — `managedFields`, long annotations, `pod-template-hash`, and other noisy K8s metadata are stripped before passing to the model

### Cluster Memory (v0.2.0)
- **💾 Persistent Cluster Snapshot** — Cluster state is saved to `localStorage` after every refresh. On Freelens restart the assistant warm-starts instantly — no waiting for a K8s API scan
- **🗺️ Namespace Health Rollup** — Every prompt includes a compact per-namespace overview (`prod-api: 43 Running · 2 CrashLoop  12 deps (1 degraded ⚠)  3 warnings ⚠`) so the model has global cluster visibility at near-zero token cost (~10 tokens/namespace)
- **🔍 Query-Relevant Filtering** — Instead of dumping all resources, each message injects only the pods/deployments/services most relevant to the current query (via BM25) plus all anomalous resources. The prompt shows `(15 shown of 180, most relevant + all anomalies)` so the model knows it's working with a subset
- **📈 Health Aggregates** — System prompt includes cluster-wide and per-namespace status counts (`170 Running · 7 Pending · 3 CrashLoopBackOff`, `105 healthy · 15 degraded deployments`) computed at snapshot time — zero extra tokens per message
- **🕐 Snapshot Age** — UI shows snapshot age in the Sources panel; stale snapshots (>30 min) are flagged. The snapshot is always used as a fallback even when stale

### SRE-Native Agent Workflow (v0.2.0)
- **🧭 Intent Detection** — Every query is automatically classified into one of four intents: `write` · `investigate` · `explain` · `general`
- **📋 Format-per-Intent** — Response format adapts to the query: YAML requests get a direct manifest with a one-line RISK rating; debugging gets full Evidence → Correlation → Hypotheses → Checks → Actions; conceptual questions get clean prose
- **🎭 SRE Mode Presets** — Six UI-selectable modes override intent detection: Auto · Troubleshoot · Security · Cost · Capacity · YAML
- **⚡ Token-Aware Signals** — The Correlated Signals block (Warning events, CrashLoop pods, replica mismatches) is only injected for `investigate` queries — skipped entirely for write/explain/general to save tokens
- **📖 Runbook Export** — Export the current investigation as a structured Markdown runbook
- **📤 Session Export** — Export full chat session as Markdown

### UI & Developer Experience
- **🧠 In-Chat Model Selector** — Switch Ollama models directly from the chat header
- **🎛️ Preset SRE Modes** — `Auto`, `Troubleshoot`, `Security`, `Cost`, `Capacity`, and `YAML` modes tune assistant behavior without changing model settings
- **🧭 Suggested Actions** — Context-aware clickable follow-ups are shown above the input to accelerate investigation loops
- **🧰 SRE Data Sources Panel** — Source visibility panel reports `ready/partial/missing` for cluster and memory signals
- **💾 Scoped Session Persistence** — Chat history is persisted per `cluster + namespace` and restored automatically
- **📄 Incident Summary Export** — Export full investigation history and findings as markdown
- **📚 Runbook Export** — Generate and export a reusable operational runbook from the active session
- **🎯 Object-Aware Prompt Entry** — Resource URL params (`kind/name/namespace/reason`) prefill a targeted investigation prompt
- **⚡ Performance Stats** — After each response, see tokens/sec, prompt tokens, generation time, and model load time in a stats panel — compare models instantly
- **📡 Context Bar** — Shows cluster name, selected namespace, pod/deployment counts, warning count, and SRE mode selector
- **⚙️ In-Chat Model Parameters** — Tune temperature, top_p, top_k, repeat penalty, and max tokens
- **🔌 In-Chat Connection Panel** — Configure endpoint, test connection via Node.js HTTP (no mixed-content issues)
- **📚 Sources Panel** — Shows what data was used: cluster snapshot age, pod/deployment relevance counts, warning events
- **💡 Suggested Actions** — After each response, contextual follow-up suggestions are shown as quick-action chips
- **💾 Session Persistence** — Chat history persists per cluster+namespace across Freelens restarts
- **📌 Persistent Settings** — All settings saved to `localStorage` and synced across Freelens contexts
- **⬅️ Back Navigation** — One-click return to the cluster dashboard

### SRE-Native Agent Workflow
- **🧩 Internal Specialist Roles** — The prompt orchestration now applies internal roles: `Investigator`, `Explainer`, `YAML Author`, and `Change Planner`
- **🛡️ Read-First / Write-Later Contract** — Responses are structured as evidence-first analysis; mutation-oriented commands/manifests are gated until explicitly requested
- **🔗 Correlated Signal Block** — Prompt includes correlation hints across warnings, CrashLoop patterns, and replica mismatches to improve RCA quality
- **📝 Structured Response Contract** — Assistant is guided to produce consistent sections: Evidence, Correlation, Hypotheses, Immediate checks, and Safest next actions

### Network & Compatibility
- **🔒 No Mixed-Content Issues** — All Ollama API calls use Node.js `http`/`https` modules instead of browser fetch/XHR, so connecting to plain HTTP Ollama instances from the Electron renderer works reliably
- **🌐 Remote Ollama** — Full support for remote Ollama instances (set `OLLAMA_ORIGINS=*` and `OLLAMA_HOST=0.0.0.0:11434` on the host)
- **☁️ Cloud Ollama** — Automatic sanitisation of model parameters (e.g. `num_predict: -1` is stripped) so cloud-hosted Ollama instances don't reject requests

## 📋 Requirements

- **Freelens** >= 1.4.0
- **Ollama** running locally or on the network
- At least one Ollama model pulled (e.g., `llama3.2`, `qwen3`, `mistral`)

## 🚀 Quick Start

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama
ollama serve
```

### 2. Pull a Model

```bash
# Recommended for SRE tasks — all work well with the v0.2.0 context pipeline
ollama pull llama3.2        # General purpose, good balance (3B)
ollama pull qwen2.5:7b      # Fast, great for structured data and YAML (7B)
ollama pull mistral          # Capable all-rounder (7B)
ollama pull gemma3:9b        # Strong reasoning, good on large clusters (9B)
ollama pull phi4-mini        # Ultra-fast on CPU, good for quick queries (3.8B)
```

### 3. Install the Extension

```bash
git clone https://github.com/biurea/freelens-k8s-sre-assistant.git
cd freelens-k8s-sre-assistant
pnpm install
pnpm build
pnpm pack
```

Then in Freelens: **Extensions** → **Add Local Extension** → select the `.tgz` file.

## 🎯 What Can It Do?

### Cluster Health
- "What's the health status of my cluster?"
- "Are there any pods in CrashLoopBackOff?"
- "Show me recent warning events"
- "List all namespaces"

### Troubleshooting
- "Why is my deployment not rolling out?"
- "Help me debug this pod that keeps crashing"
- "What's causing high memory usage on node X?"

### Optimization
- "Analyze resource usage and suggest optimizations"
- "Are there any pods without resource limits?"
- "Suggest HPA configurations for my deployments"

### Security
- "Check for any security concerns in my cluster"
- "Are there pods running as root?"
- "Review my RBAC configuration"

### Operations
- "How do I scale this deployment?"
- "Generate a network policy for namespace isolation"
- "Help me write a pod disruption budget"

## ⚙️ Configuration

### Chat Header Controls

All primary configuration lives directly in the chat UI.

#### � Context Bar

The context bar shows cluster name, selected namespace, pod/deployment counts, warning count, and the SRE mode selector. Click **Refresh** to force a new K8s API scan and update the cluster memory snapshot.

#### 📚 Sources Panel (Sources button)

Shows what data the assistant used for the last response:

| Row | Description |
|-----|-------------|
| Cluster Memory | Snapshot age; flagged as stale if >30 min |
| Pods | `N shown of M total` when query-filtered |
| Deployments | Filtered count + degraded count |
| Warning Events | Number of active warning events |

#### 🎭 SRE Mode Selector

Six presets control the assistant's response strategy:

| Mode | Behaviour |
|------|-----------|
| Auto | Intent auto-detected from query text |
| Troubleshoot | Full investigation format (Evidence → Correlation → Hypotheses → Checks → Actions) |
| Security | Focuses on RBAC, PodSecurity, NetworkPolicy, image and secret risks |
| Cost | Focuses on waste reduction, right-sizing, autoscaling |
| Capacity | Focuses on saturation signals, scheduling pressure, scaling strategy |
| YAML | Direct manifest output, no analysis preamble |

In **Auto** mode, the intent is detected from the query:
- *"write a nginx deployment"* → YAML format
- *"why is my pod crashing?"* → Investigation format
- *"what is a PodDisruptionBudget?"* → Explanation format
- *"how many pods are running?"* → Direct answer

#### �🔌 Connection Panel (Ollama badge)

Click the **Ollama** / **Disconnected** badge to open the connection overlay:

- **Endpoint input** — set the Ollama URL (e.g. `http://localhost:11434`)
- **Test Connection** — one-click test using Node.js HTTP (bypasses mixed-content)
- **Debug log** — detailed diagnostics with troubleshooting hints

#### 📦 Namespace Selector (context bar)

The dropdown in the context bar lets you scope the AI's view to a single namespace:

- **All Namespaces** — model sees pods/deployments/services/events from all namespaces (with limits)
- **Specific namespace** — only namespaced resources from that namespace are included; nodes and the namespace list remain global

Changing namespace triggers an automatic context refresh.

#### ⚡ Performance Stats (⚡ t/s button)

After each response, a green button shows generation speed. Click to see:

| Metric | Description |
|--------|-------------|
| Tokens/sec | Generation speed (🟢 ≥20, 🟡 ≥8, 🔴 <8) |
| Total time | End-to-end response time |
| Prompt tokens | Tokens in the full context sent to the model |
| Prompt eval | Time to process the prompt |
| Generated tokens | Tokens in the AI's response |
| Generation time | Time spent generating |
| Model load | Time to load the model into memory |

Use this to compare models and find the best speed/quality tradeoff.

#### 🧠 Model Selector

The header dropdown lists all available Ollama models. Switching takes effect immediately.

#### ⚙️ Model Parameters (⚙️ button)

| Parameter | Range | Description |
|-----------|-------|-------------|
| Temperature | 0 – 2 | Creativity vs determinism |
| Top P | 0 – 1 | Nucleus sampling threshold |
| Top K | 0 – 200 | Token vocabulary limit |
| Repeat Penalty | 1 – 2 | Penalize repeated tokens |
| Max Tokens | -1 – 8192 | Response length (-1 = unlimited) |

### Preferences Panel

Open **Freelens → Preferences → K8s SRE Assistant** for basic setup:

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Endpoint | `http://localhost:11434` | URL of your Ollama instance |
| Auto-refresh context | `true` | Gather cluster state before each message |

## 🏗️ Architecture

```
src/
├── main/
│   └── index.ts                          # Main process entry (Freelens lifecycle)
├── renderer/
│   ├── index.tsx                         # Renderer entry (registers pages, menus, preferences)
│   ├── components/
│   │   ├── sre-chat.tsx                  # Chat UI + ConnectionPanel + ModelParamsPanel + StatsPanel + SourcesPanel
│   │   └── markdown-renderer.tsx         # Streaming-safe block-level Markdown → HTML renderer
│   ├── icons/
│   │   └── sre-icon.tsx                  # Sidebar icon
│   ├── pages/
│   │   └── sre-assistant-page.tsx        # Freelens cluster page wrapper
│   ├── preferences/
│   │   └── sre-preferences.tsx           # Freelens Preferences panel
│   ├── services/
│   │   ├── ollama-service.ts             # Ollama API (Node.js HTTP, streaming, stats capture, system prompt builder)
│   │   ├── k8s-context-service.ts        # K8s context via KubeApi.list() + namespace filtering
│   │   └── context/                      # 🧩 Context management pipeline
│   │       ├── index.ts                  #    Barrel export
│   │       ├── chunk-manager.ts          #    Sliding-window chunker (~300 words, 50 overlap)
│   │       ├── bm25-retriever.ts         #    Pure-TS BM25 (k1=1.5, b=0.75) K8s-aware keyword retrieval
│   │       ├── summary-manager.ts        #    On-demand Ollama-based conversation compression
│   │       ├── context-builder.ts        #    Assembles: system → summary → BM25 chunks → recent → query
│   │       └── cluster-memory.ts         #    Persistent snapshot + namespace rollup + BM25 query filtering
│   └── stores/
│       └── chat-store.ts                 # MobX state + context pipeline orchestration + intent detection
└── common/
    └── types.ts                          # Shared TypeScript types
```

### Context Pipeline Flow

On every user message:

```
1. inferQueryIntent(query)               → write | investigate | explain | general
2. buildFocusedContext(query)            → ClusterMemoryService.queryRelevant()
   └─ BM25 selects top-15 relevant pods/deps/svcs + all anomalous resources
   └─ Namespace health rollup always included (~10 tokens/namespace)
   └─ Cluster-wide status aggregates always included ("170 Running · 3 CrashLoop")
3. buildSystemPrompt(focusedCtx)         → SRE persona + NAMESPACE OVERVIEW + filtered resources
4. [investigate only] buildCorrelatedSignalsBlock() → warning events, crash pods, replica mismatches
5. buildSreWorkflowInstruction(intent)   → format contract injected (skipped for write/explain/general)
6. Use existing summary from previous cycle (non-blocking)
7. ChunkManager.buildChunks()           → split NON-SUMMARISED history into ~300-word overlapping chunks
8. BM25Retriever.retrieve(query, 5)     → top-5 keyword-relevant conversation chunks
9. ContextBuilder.assemble()             → ordered: system + summary + chunks + recent turns + query
   └─ Jaccard deduplication removes chunks redundant with recent messages
10. OllamaService.streamChatAssembled() → stream response, capture performance stats
11. (post-response) SummaryManager.maybeCompress() → background: compress old turns if >20 pairs
    └─ Two-section output: FACTS & DECISIONS (persistent) + ROLLING CONTEXT (query-focused)
12. ClusterMemoryService.save(ctx)      → persist fresh snapshot after every K8s API refresh
```

**Key properties:**
- Zero npm dependencies for the pipeline — pure TypeScript
- Summarisation runs *after* the response (no added latency)
- BM25 retrieves only from non-summarised messages (no duplicate context)
- K8s-aware tokenizer preserves compound terms (`kube-system`, `apps/v1`, IPs)
- Anomalous resources (CrashLoopBackOff, replica mismatch, NotReady) always survive filtering
- Namespace health rollup gives global visibility at ~10 tokens/namespace
- Intent detection adapts response format — YAML queries skip all analysis overhead
- Token budget capped at ~2800 words conversation history + ~1000 tokens filtered cluster context

## 🗺️ Roadmap

Inspired by ideas visible in the local [freelens-ai-extension](freelens-ai-extension/README.md) repo, but adapted to this extension's SRE-first identity.

### Near-term improvements (completed)

- ✅ **Preset SRE modes** — Implemented with dedicated `Auto/Troubleshoot/Security/Cost/Capacity/YAML` behavior instructions
- ✅ **Suggested actions, not just answers** — Implemented as clickable context-aware follow-up actions in chat
- ✅ **Object-aware entry points** — Implemented via URL param prefill (`kind/name/namespace/reason`)
- ✅ **Tool visibility panel** — Implemented as the **SRE Data Sources** panel with health/status indicators
- ✅ **Session persistence** — Implemented per `cluster + namespace` scope
- ✅ **Export incident summary** — Implemented markdown export flow directly from chat

### SRE-native agent workflow

- ✅ **Specialized internal agents** — Implemented as internal prompt roles: **Investigator**, **Explainer**, **YAML Author**, **Change Planner**
- ✅ **Read-first, write-later workflow** — Implemented response contract that prioritizes analysis before mutation guidance
- ✅ **Runbook generation** — Implemented runbook markdown export from active investigation sessions
- 🟡 **Event and log correlation** — Event correlation is implemented (warnings + anomaly cues); log correlation remains a planned next step

### Integrations and power features

- **MCP support for SRE workflows** — Borrow the MCP idea, but use it for clearly scoped integrations like GitHub issues, runbook repositories, incident systems, or external observability tools
- **Prompt packs / response templates** — Add reusable output templates for postmortems, incident updates, security findings, migration plans, and RFC-style recommendations
- **Model/provider profiles** — Offer ready-made profiles such as **Fast local triage**, **Balanced local**, and **Cloud deep analysis** instead of exposing only raw model parameters
- **Cluster diff awareness** — Compare “before vs after” snapshots across refreshes to explain what changed during an investigation
- **Safe action queue** — Queue generated kubectl commands or manifests for review before execution, with explicit risk labels and dry-run defaults

### Longer-term product direction

- **Namespace and workload memory** — Build compact per-namespace or per-workload memory so the assistant remembers recurring issues without bloating each prompt
- **Incident timeline UI** — Visual timeline of warnings, restarts, rollout events, and assistant conclusions during a troubleshooting session
- **Policy and config review** — Deep analysis for RBAC, NetworkPolicies, PodSecurity, probes, resources, and disruption budgets with explainable reasoning
- **SRE cockpit experience** — Evolve from a chat tab into a guided operational workspace inside Freelens: investigate, explain, propose, review, export

## 🔧 Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm type:check

# Build
pnpm build

# Pack for local testing
pnpm pack
```

## � Changelog

### v0.2.0
- **Cluster Memory** — persistent `localStorage` snapshot with warm-start on Freelens restart
- **Namespace Health Rollup** — per-namespace pod/deployment/event summary in every prompt at ~10 tokens/namespace
- **Query-Relevant Filtering** — BM25-based selection of top-15 relevant resources + all anomalous resources per prompt
- **Health Aggregates** — cluster-wide and per-namespace status counts (`170 Running · 3 CrashLoop`) computed at snapshot time
- **Intent Detection** — queries classified as `write / investigate / explain / general` with format-per-intent responses
- **SRE Mode Presets** — six UI-selectable modes (Auto · Troubleshoot · Security · Cost · Capacity · YAML)
- **Token Savings** — Correlated Signals block skipped for non-investigate queries; ~85-90% reduction in cluster context tokens on large clusters
- **Sources Panel** — snapshot age, filtered resource counts, warning events
- **Suggested Actions** — contextual follow-up chips after each response
- **Session Persistence** — chat history persists per cluster+namespace
- **Runbook & Session Export** — export incidents as Markdown runbooks or full session logs
- **Popup Anchor Fix** — all panels (Connection, Params, Stats, Sources) anchor correctly to their buttons

### v0.1.0
- Initial release: AI chat, cluster awareness, streaming responses, BM25 context pipeline, summarisation, anomaly-first sorting

## �📄 License

Copyright (c) 2026 biurea.

[MIT License](https://opensource.org/licenses/MIT)
