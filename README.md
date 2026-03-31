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

Click the **⚙️ Settings** button in the extension header to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Endpoint | `http://localhost:11434` | Ollama API endpoint |
| Model | `llama3.2` | AI model to use |
| Auto-refresh | `true` | Refresh cluster context before each message |

## 🏗️ Architecture

```
src/
├── main/
│   └── index.ts                    # Main process entry (Freelens lifecycle)
├── renderer/
│   ├── index.tsx                   # Renderer entry (registers pages & menus)
│   ├── components/
│   │   ├── sre-chat.tsx            # Main chat UI component
│   │   ├── markdown-renderer.tsx   # Markdown to HTML renderer
│   │   └── SreAssistant.module.scss # Scoped styles
│   ├── icons/
│   │   └── sre-icon.tsx            # Sidebar icon
│   ├── pages/
│   │   └── sre-assistant-page.tsx  # Freelens cluster page wrapper
│   ├── services/
│   │   ├── ollama-service.ts       # Ollama API client (streaming)
│   │   └── k8s-context-service.ts  # Kubernetes context gatherer
│   └── stores/
│       └── chat-store.ts           # MobX state management
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
