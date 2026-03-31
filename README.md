# 🤖 K8s SRE Assistant - Freelens Extension

A Freelens extension that adds an AI-powered **Kubernetes SRE (Site Reliability Engineer)** assistant tab to your cluster view. Chat with an Ollama-powered AI model that can see your cluster's resources and help you troubleshoot, optimize, and manage your Kubernetes infrastructure.

![K8s SRE Assistant](https://img.shields.io/badge/Freelens-Extension-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **🧠 AI Chat Interface** — Conversational AI assistant integrated directly into Freelens
- **👁️ Cluster Awareness** — The AI sees your pods, deployments, services, nodes, and events in real-time
- **🔄 Live Context Refresh** — Automatically gathers cluster state before each conversation
- **📡 Ollama Integration** — Uses local Ollama for privacy-first AI (no data leaves your machine)
- **💬 Streaming Responses** — Real-time streaming with a block-level Markdown renderer safe for incomplete output
- **🎨 Beautiful UI** — Modern chat bubbles with Markdown rendering, syntax-highlighted code blocks, and tables
- **⚡ Suggested Queries** — Quick-start prompts for common SRE tasks
- **🛑 Cancelable** — Stop AI generation at any time
- **🧠 In-Chat Model Selector** — Switch Ollama models directly from the chat header without leaving the conversation
- **📡 Context Bar** — Shows the active cluster name and health status (warning count or ✓ Healthy)
- **⬅️ Back Navigation** — One-click return to the cluster dashboard
- **🖥️ Freelens-Native Layout** — Coexists with the Freelens sidebar (Workloads, Network, Storage…) and native bottom bar (Terminal, Create Resource)
- **🔌 In-Chat Connection Panel** — Click the Ollama badge to configure endpoint, test the connection, and see a full debug log — all without leaving the chat
- **⚙️ In-Chat Model Parameters** — Tune temperature, top_p, top_k, repeat penalty, and max tokens from a popover panel in the chat header
- **📦 Model Browser** — Discover and select from all models available on your Ollama instance (with size info)
- **💾 Persistent Settings** — Endpoint, model, parameters, and options are saved to `localStorage` and synced across Freelens contexts
- **🛠️ Minimal Preferences** — Endpoint and auto-refresh are also available in Freelens Preferences for initial setup

## 📋 Requirements

- **FreelensAPIExtension** >= 1.4.0
- **Ollama** running locally (or accessible via network)
- At least one Ollama model pulled (e.g., `llama3.2`, `mistral`, `codellama`)

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
# Recommended models for SRE tasks
ollama pull llama3.2        # General purpose, good balance
ollama pull mistral          # Fast and capable
ollama pull codellama        # Great for YAML/config analysis
ollama pull deepseek-coder   # Excellent for debugging
```

### 3. Install the Extension

#### From source:
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

All primary configuration lives directly in the chat UI — no need to leave the conversation.

#### 🔌 Connection Panel (Ollama badge)

Click the **Ollama** / **Disconnected** badge in the header to open the connection overlay:

- **Endpoint input** — set the Ollama URL (e.g. `http://localhost:11434`).
- **Test Connection** — one-click test with automatic `fetch` → `XHR` fallback.
- **Debug log** — detailed diagnostics with troubleshooting hints on failure.
- **Status indicator** — ✓ Connected (with model count) / ✕ Connection failed.

> **Tip for remote Ollama:** set `OLLAMA_ORIGINS=*` and `OLLAMA_HOST=0.0.0.0:11434` on the Ollama host.

#### 🧠 Model Selector

The header dropdown lists all available Ollama models. Switching model takes effect immediately.

#### ⚙️ Model Parameters (⚙️ button)

Click the **⚙️** button to open the parameters popover:

| Parameter | Range | Description |
|-----------|-------|-------------|
| Temperature | 0 – 2 | Creativity vs determinism |
| Top P | 0 – 1 | Nucleus sampling threshold |
| Top K | 0 – 200 | Token vocabulary limit |
| Repeat Penalty | 1 – 2 | Penalize repeated tokens |
| Max Tokens | -1 – 8192 | Response length (-1 = unlimited) |

All parameters are saved to `localStorage` and applied to every request.

### Preferences Panel (minimal)

Open **Freelens → Preferences → K8s SRE Assistant** for basic setup:

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Endpoint | `http://localhost:11434` | URL of your Ollama instance. |
| Auto-refresh context | `true` | Gather cluster state before each message. |

Model selection, parameters, and connection testing are all in the chat header.

### Freelens Integration

The extension is designed to **coexist with native Freelens features**:

- The **sidebar** (Workloads, Network, Storage, Helm, etc.) stays visible alongside the chat.
- The **native bottom bar** (Terminal, Create Resource) remains accessible below the chat input.
- Click **← Back** in the chat header to return to the cluster dashboard.

## 🏗️ Architecture

```
src/
├── main/
│   └── index.ts                    # Main process entry (Freelens lifecycle)
├── renderer/
│   ├── index.tsx                   # Renderer entry (registers pages, menus & preferences)
│   ├── components/
│   │   ├── sre-chat.tsx            # Main chat UI + ConnectionPanel + ModelParamsPanel overlays
│   │   └── markdown-renderer.tsx   # Streaming-safe block-level Markdown → HTML renderer
│   ├── icons/
│   │   └── sre-icon.tsx            # Sidebar icon
│   ├── pages/
│   │   └── sre-assistant-page.tsx  # Freelens cluster page wrapper (sidebar-friendly layout)
│   ├── preferences/
│   │   └── sre-preferences.tsx     # Minimal Freelens Preferences (endpoint + auto-refresh)
│   ├── services/
│   │   ├── ollama-service.ts       # Ollama API client (streaming, fetch + XHR fallback)
│   │   └── k8s-context-service.ts  # Kubernetes context gatherer
│   └── stores/
│       └── chat-store.ts           # MobX state management (cross-context settings sync)
└── common/
    └── types.ts                    # Shared TypeScript types
```

## 🔧 Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm type:check

# Build (development - preserved modules for debugging)
pnpm build

# Build (production - single bundle)
pnpm build:production

# Pack for local testing
pnpm pack:dev
```

## 📄 License

Copyright (c) 2026 biurea.

[MIT License](https://opensource.org/licenses/MIT)
