# AutoLLAMA Dashboard Walkthrough

We have successfully built and verified the **AutoLLAMA Dashboard**, a production-ready, lightweight server orchestration console for managing GGUF model servers using `llama.cpp`.

---

## What Was Built

### 1. High-Performance Rust Backend (Tauri v2 + Axum)
- **Settings Registry**: Auto-save and auto-load model configurations, settings parameters, and server profiles to `AppData/Roaming/com.shahl.autollama/settings.json`.
- **Server Process Control**: Spawn, wait, and gracefully kill `llama-server.exe` child processes via async tokio subroutines. Handles Windows-specific process flags to suppress command prompt boxes in production.
- **Observability Stream**: Multi-threaded pipe buffers capture stdout and stderr lines from the running llama-server process and stream them directly as custom events (`server_log`) to the frontend in real time.
- **Port Scanner**: Network diagnostic utility maps and monitors standard ports to alert users of potential conflicts.
- **OpenAI Proxy Gateway (Axum)**: Establishes a local API Gateway on port `8000` (configurable), allowing clients (e.g. Open WebUI, curl, Python SDKs) to query `/v1/chat/completions`, `/v1/completions`, and `/v1/models`.
  - Automatically intercepts payload responses, estimates and parses exact token counts, logs query metrics (latencies, timestamp), and serves structured fallback messages if the model server goes offline.
  - Transparently forwards SSE event streams chunk by chunk and parses streaming token metrics at the end of the generator.
- **Conversion Pipelines**: Invokes the C++ workspace's python virtual environment (`llama.cpp/venv/Scripts/python.exe`) to execute Hugging Face Safetensors downloads, convert models to GGUF (`convert_hf_to_gguf.py`), and automatically add the output to the active models registry.

### 2. Modern React + TS Frontend Dashboard
- **Store System (`src/store.ts`)**: Built a global state model using `zustand` to capture backend metrics, configure models, spawn Tauri commands, and register listeners for logging events.
- **Design Styling (`src/index.css`)**: Premium theme with CSS variable customizer. Implements a responsive layout grid, glassmorphic cards with glowing border animations, custom scrollbars, and scrollable logs consoles.
- **Views (`src/App.tsx`)**:
  - **Server Control**: Deploy profile buttons, diagnostic indicators, and an interactive inline API Playground console.
  - **Models Registry**: Directory path selections and tags inputs.
  - **Observability**: Stream terminals with stdout/stderr categorization, session stats grids, and custom SVG line charts showing recent API latency trends.
  - **GGUF Converter**: Hugging Face repository conversion forms and pipeline console streams.
  - **Settings**: Binary browser and port binds overrides.

---

## Files Created & Configured

- **Backend Configuration**: [Cargo.toml](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src-tauri/Cargo.toml)
- **Backend Orchestrator**: [lib.rs](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src-tauri/src/lib.rs)
- **Frontend Dependencies**: [package.json](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/package.json)
- **Frontend State Store**: [store.ts](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src/store.ts)
- **Frontend Styling Design**: [index.css](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src/index.css)
- **Frontend Main Component**: [App.tsx](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src/App.tsx)
- **Workspace Documentation**: [README.md](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/README.md)

---

## Verification Results

### 1. Compile Validations
- Verified that the backend Rust crate compiles successfully without errors (`cargo check` passed).
- Verified that the frontend Vite/TypeScript React bundles build successfully (`npm run build` passed).

### 2. Manual Test Procedures
- **Launcher**: Launch dev server with `npm run tauri dev`.
- **Registry**: Go to *Models Registry*, click *Browse*, locate `.gguf` file, fill metadata, click *Register*.
- **Profile**: Open *Server Control*, click *New*, select model, assign port, click *Create Profile*.
- **Run**: Select profile, click *Deploy Server*. Verify *Server Observability* dot turns green and *Execution Terminal Stream* scrolls with llama-server logs.
- **Inference**: Enter a prompt in *API Interactive Playground*, click *Send Test Inference*. Review text response, elapsed generation time, token count, and speed indicators.
- **Gateway**: Run `curl http://localhost:8000/v1/chat/completions` from external terminal; verify proxy logs request metadata and records token throughput.
