# 🤖 K8s SRE Assistant - Freelens Extension

A Freelens extension that adds an AI-powered **Kubernetes SRE (Site Reliability Engineer)** assistant tab to your cluster view. Chat with an Ollama-powered AI model that can see your cluster's resources and help you troubleshoot, optimize, and manage your Kubernetes infrastructure.

![K8s SRE Assistant](https://img.shields.io/badge/Freelens-Extension-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- **🧠 AI Chat Interface** — Conversational AI assistant integrated directly into Freelens
- **👁️ Cluster Awareness** — The AI sees your pods, deployments, services, nodes, and events in real-time
- **🔄 Live Context Refresh** — Automatically gathers cluster state before each conversation
- **📡 Ollama Integration** — Uses local Ollama for privacy-first AI (no data leaves your machine)
- **💬 Streaming Responses** — Real-time streaming of AI responses
- **🎨 Beautiful UI** — Modern chat interface with Markdown rendering, code blocks, and tables
- **⚡ Suggested Queries** — Quick-start prompts for common SRE tasks
- **🛑 Cancelable** — Stop AI generation at any time
- **⚙️ Preferences Panel** — Dedicated settings page in Freelens preferences to configure endpoint, model, and behavior
- **🔌 Connection Testing** — One-click test with detailed debug log and automatic `fetch` / `XHR` fallback
- **📦 Model Browser** — Discover and select from all models available on your Ollama instance (with size info)
- **💾 Persistent Settings** — Endpoint, model, and options are saved to `localStorage` and synced across Freelens windows

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

### Preferences Panel

Open **Freelens → Preferences → K8s SRE Assistant** to access the dedicated settings page.

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Endpoint | `http://localhost:11434` | URL of your Ollama instance. Supports local and remote setups. |
| AI Model | `llama3.2` | Select from discovered models or type a name manually. |
| Auto-refresh context | `true` | Gather cluster state (pods, deployments, services, nodes, events) before each message. |

#### Connection Testing

Click **Test Connection** to verify the Ollama endpoint. The panel shows:

- A **status indicator** (✓ Connected / ✕ Error) with a detailed debug log.
- Automatic fallback from `fetch` to `XHR` if the first method fails (useful in Electron/restrictive environments).
- Troubleshooting hints when the connection cannot be established (e.g. `OLLAMA_ORIGINS`, `OLLAMA_HOST`).

#### Model Browser

Once connected, the model dropdown lists every model available on the Ollama instance together with its size. If no connection is available you can still type a model name manually.

> **Tip for remote Ollama:** set `OLLAMA_ORIGINS=*` and `OLLAMA_HOST=0.0.0.0:11434` on the Ollama host to allow connections from Freelens.

### In-Chat Settings

Click the **⚙️ Settings** button in the chat header to toggle inline settings without leaving the conversation.

## 🏗️ Architecture

```
src/
├── main/
│   └── index.ts                    # Main process entry (Freelens lifecycle)
├── renderer/
│   ├── index.tsx                   # Renderer entry (registers pages, menus & preferences)
│   ├── components/
│   │   ├── sre-chat.tsx            # Main chat UI component
│   │   ├── markdown-renderer.tsx   # Markdown to HTML renderer
│   │   └── SreAssistant.module.scss # Scoped styles
│   ├── icons/
│   │   └── sre-icon.tsx            # Sidebar icon
│   ├── pages/
│   │   └── sre-assistant-page.tsx  # Freelens cluster page wrapper
│   ├── preferences/
│   │   └── sre-preferences.tsx     # Freelens App Preferences panel
│   ├── services/
│   │   ├── ollama-service.ts       # Ollama API client (streaming)
│   │   └── k8s-context-service.ts  # Kubernetes context gatherer
│   └── stores/
│       └── chat-store.ts           # MobX state management (persisted settings)
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

## 🗺️ Roadmap

- [ ] **kubectl execution** — Execute kubectl commands directly from chat suggestions
- [ ] **Multiple providers** — Support for OpenAI, Anthropic, Azure OpenAI
- [ ] **Log analysis** — Stream and analyze pod logs
- [ ] **YAML generation** — Generate and apply Kubernetes manifests
- [ ] **Incident history** — Keep track of troubleshooting sessions
- [ ] **Custom system prompts** — Customize the AI personality and focus
- [ ] **Resource monitoring** — Real-time metrics integration

## 📄 License

Copyright (c) 2026 Freelens K8s SRE Assistant Authors.

[MIT License](https://opensource.org/licenses/MIT)
