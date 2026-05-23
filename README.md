# AutoLLAMA: Local GGUF LLM Server Manager Dashboard

AutoLLAMA is an enterprise-grade, lightweight desktop application designed for Windows, macOS, and Linux to manage, observe, and test local GGUF Large Language Model (LLM) servers running via `llama.cpp`.

It provides a high-performance **Rust backend** (using **Tauri v2** and **Axum**) that manages `llama-server.exe` processes, and exposes an **OpenAI-compatible API Gateway** with active token usage tracking and performance metrics. The **React + TypeScript frontend** features a gorgeous, dark-themed glassmorphism interface.

---

## Features

- **Models Registry**: Browse and register local `.gguf` model files. Tag, search, and manage model descriptions.
- **Server Orchestration**: Configure server ports, context lengths, GPU offloading layers, and CPU threads. Safe port conflict scanning prevents startup failures.
- **OpenAI Proxy Gateway**: Run a stable API Gateway (default port `8000`) that routes chat and text completions to your active models, monitors token counts, and collects latency metrics.
- **Interactive Playground**: Send test inputs directly in the dashboard to review inferences, tokens per second, and latencies.
- **GGUF Converter Pipeline**: Remotely download or select local Safetensors models from Hugging Face and convert them directly to GGUF using the built-in python virtual environment.
- **observability Stream**: Real-time terminal log stream with log severity level filters.

---

## Directory Architecture

```
AUTOLLAMA/
├── llama.cpp/               # The C++ llama.cpp library and tools
│   ├── convert_hf_to_gguf.py # Conversion script
│   └── venv/                # Configured Python Virtual Environment
└── autollama/               # Tauri Desktop Application
    ├── src-tauri/           # Rust Desktop Backend & API Gateway
    │   ├── Cargo.toml       # Backend dependencies
    │   └── src/lib.rs       # Main Rust commands & Axum proxy
    └── src/                 # React + TypeScript Frontend
        ├── store.ts         # Zustand global state, Tauri listeners
        ├── index.css        # Premium Glassmorphism styling variables
        └── App.tsx          # Main tab layout components
```

---

## Prerequisites

1. **Rust & Cargo**: Version 1.75+ is required. [Install Rust](https://www.rust-lang.org/tools/install).
2. **Node.js & npm**: [Install Node.js](https://nodejs.org/).
3. **llama-server.exe**: You must compile or download a version of `llama-server` suitable for your hardware.
   - For CUDA (NVIDIA) builds: ensure CUDA Toolkit is installed.
   - For CPU-only builds: download the AVX2/AVX512 releases.
   - Set the path to `llama-server.exe` in the **Settings** section of the AutoLLAMA app.

---

## Installation & Launch

1. Clone or enter the workspace directory:
   ```bash
   cd c:\Users\shahl\workspace\python\AUTOLLAMA\autollama
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Launch the desktop application in development mode:
   ```bash
   npm run tauri dev
   ```

4. Build the standalone production release installer:
   ```bash
   npm run tauri build
   ```

---

## How to Use the OpenAI-Compatible API

AutoLLAMA starts a proxy server on port `8000` (configurable in settings) which maps OpenAI-style payloads to your active `llama.cpp` server.

### 1. Retrieve Registered Models
```bash
curl http://localhost:8000/v1/models
```

### 2. Chat Completions (Blocking)
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Define gravity in one sentence."}
    ],
    "temperature": 0.7,
    "max_tokens": 150,
    "stream": false
  }'
```

### 3. Chat Completions (Streaming)
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Count to 5."}
    ],
    "stream": true
  }'
```

---

## GGUF Model Conversion Pipeline

The conversion dashboard leverages `llama.cpp`'s native python scripts and uses the environment located in `llama.cpp/venv/`.

1. Go to the **GGUF Converter** tab.
2. Enter a Hugging Face Repository ID (e.g., `HuggingFaceTB/SmolLM2-135M-Instruct`).
3. Select your Quantization type (e.g., `q8_0` for 8-bit, or `f16`).
4. Select the destination directory (defaults to `llama.cpp/models`).
5. Click **Execute Conversion Pipeline**. AutoLLAMA will automatically run the Safetensors download, convert to GGUF, register the model in your dashboard registry, and display logs inside the inline terminal.
