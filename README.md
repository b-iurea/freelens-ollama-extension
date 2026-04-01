# 🤖 K8s SRE Assistant - Freelens Extension

A Freelens extension that adds an AI-powered **Kubernetes SRE (Site Reliability Engineer)** assistant tab to your cluster view. Chat with an Ollama-powered AI model that can see your cluster's resources and help you troubleshoot, optimize, and manage your Kubernetes infrastructure.

![K8s SRE Assistant](https://img.shields.io/badge/Freelens-Extension-blue)
![License](https://img.shields.io/badge/license-MIT-green)

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
- **📊 BM25 Retrieval** — Keyword-based retrieval (pure TypeScript, ~80 lines) scores conversation chunks against the current query to surface the most relevant earlier context
- **📝 On-Demand Summarisation** — When conversation exceeds 20 turns, old turns are compressed into a summary via a second Ollama call (only when needed, not every turn)
- **� Token Budget** — Cluster context and conversation history are capped and cleaned (noisy labels stripped, event messages truncated, per-resource limits) to stay within small model context windows
- **🧹 Clean Data** — `managedFields`, long annotations, `pod-template-hash`, and other noisy K8s metadata are stripped before passing to the model

### UI & Developer Experience
- **🧠 In-Chat Model Selector** — Switch Ollama models directly from the chat header
- **⚡ Performance Stats** — After each response, see tokens/sec, prompt tokens, generation time, and model load time in a stats panel — compare models instantly
- **📡 Context Bar** — Shows cluster name, selected namespace, pod/deployment counts, and warning count
- **⚙️ In-Chat Model Parameters** — Tune temperature, top_p, top_k, repeat penalty, and max tokens
- **🔌 In-Chat Connection Panel** — Configure endpoint, test connection via Node.js HTTP (no mixed-content issues)
- **💾 Persistent Settings** — All settings saved to `localStorage` and synced across Freelens contexts
- **⬅️ Back Navigation** — One-click return to the cluster dashboard

### Network & Compatibility
- **🔒 No Mixed-Content Issues** — All Ollama API calls use Node.js `http`/`https` modules instead of browser fetch/XHR, so connecting to plain HTTP Ollama instances from the Electron renderer works reliably
- **🌐 Remote Ollama** — Full support for remote Ollama instances (set `OLLAMA_ORIGINS=*` and `OLLAMA_HOST=0.0.0.0:11434` on the host)

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
# Recommended for SRE tasks
ollama pull llama3.2        # General purpose, good balance (3B)
ollama pull qwen3            # Fast, great for structured data (4B)
ollama pull mistral          # Capable all-rounder (7B)
ollama pull deepseek-coder   # Excellent for YAML/config (6.7B)
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

#### 🔌 Connection Panel (Ollama badge)

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
│   │   ├── sre-chat.tsx                  # Chat UI + ConnectionPanel + ModelParamsPanel + StatsPanel
│   │   └── markdown-renderer.tsx         # Streaming-safe block-level Markdown → HTML renderer
│   ├── icons/
│   │   └── sre-icon.tsx                  # Sidebar icon
│   ├── pages/
│   │   └── sre-assistant-page.tsx        # Freelens cluster page wrapper
│   ├── preferences/
│   │   └── sre-preferences.tsx           # Freelens Preferences panel
│   ├── services/
│   │   ├── ollama-service.ts             # Ollama API (Node.js HTTP, streaming, stats capture)
│   │   ├── k8s-context-service.ts        # K8s context via KubeApi.list() + namespace filtering
│   │   └── context/                      # 🧩 Context management pipeline
│   │       ├── index.ts                  #    Barrel export
│   │       ├── chunk-manager.ts          #    Sliding-window chunker (~300 words, 50 overlap)
│   │       ├── bm25-retriever.ts         #    Pure-TS BM25 (k1=1.5, b=0.75) keyword retrieval
│   │       ├── summary-manager.ts        #    On-demand Ollama-based conversation compression
│   │       └── context-builder.ts        #    Assembles: system → summary → BM25 chunks → recent → query
│   └── stores/
│       └── chat-store.ts                 # MobX state + context pipeline orchestration
└── common/
    └── types.ts                          # Shared TypeScript types
```

### Context Pipeline Flow

On every user message:

```
1. Build system prompt (SRE persona + live K8s cluster data)
2. SummaryManager.maybeCompress()     → if >20 turns, call Ollama to compress old turns
3. ChunkManager.buildChunks()         → split full history into ~300-word overlapping chunks
4. BM25Retriever.retrieve(query, 5)   → top-5 keyword-relevant chunks from history
5. ContextBuilder.assemble()           → ordered: system + summary + chunks + recent 5 turns + query
6. OllamaService.streamChatAssembled() → stream response, capture performance stats
```

This prevents the "lost-in-the-middle" problem where small models forget information buried in long contexts.

**Key properties:**
- Zero npm dependencies for the pipeline — pure TypeScript
- Ollama called twice only when summarisation is needed (not every turn)
- BM25 index is rebuilt per-message (fast: pure synchronous string operations)
- Token budget capped at ~2800 words to fit 4k-context models

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

## 📄 License

Copyright (c) 2026 biurea.

[MIT License](https://opensource.org/licenses/MIT)
