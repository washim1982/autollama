# AutoLLAMA Deployment & Installation Guide

This guide details instructions to compile, install, and run **AutoLLAMA** on any PC (Windows, macOS, or Linux).

---

## System Requirements & Prerequisites

Ensure the target machine has the following tools installed:

### 1. Developer Toolchains
- **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **Rust Toolchain**: Stable compiler and Cargo package manager via [rustup.rs](https://rustup.rs/)
- **C++ Compiler**:
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Select "Desktop development with C++" workload)
  - **macOS**: Install Xcode command line tools via terminal: `xcode-select --install`
  - **Linux**: Install Build Essentials (e.g., `sudo apt install build-essential cmake` on Ubuntu/Debian)
- **CMake**: v3.20 or higher (needed for compiling llama.cpp)
- **Git**: For cloning repositories and submodules

### 2. GPU Prerequisites (Optional, for GPU Acceleration)
- **Nvidia GPU**:
  - Install the latest [Nvidia Drivers](https://www.nvidia.com/Download/index.aspx).
  - Install the [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) (v12.x recommended) to match compiler bindings.

---

## Step-by-Step Installation

### Step 1: Clone the Repository
Clone the repository recursively to ensure the `llama.cpp` submodule is downloaded:
```bash
git clone --recursive <repository-url> autollama-workspace
cd autollama-workspace
```
*If cloned without submodules, run:*
```bash
git submodule update --init --recursive
```

---

### Step 2: Compile `llama.cpp` (Model Server)
We need to build the `llama-server` binary which AutoLLAMA starts as a background service.

#### Option A: CPU Only Build (Any PC)
```bash
cd llama.cpp
cmake -B build
cmake --build build --config Release -j
```

#### Option B: NVIDIA CUDA Build (Nvidia GPU Acceleration)
Ensure CUDA Toolkit is installed and mapped in your environmental path variables, then compile:
```bash
cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j
```

*This compiles the executable `llama-server` (or `llama-server.exe` on Windows) inside `llama.cpp/build/bin/Release/`.*

---

### Step 3: Setup GGUF Python Converter (Optional)
To convert Safetensors/PyTorch weights from Hugging Face to local GGUF formats:
```bash
cd llama.cpp
python -m venv venv

# Activate Virtual Env:
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies:
pip install -r requirements.txt
```

---

### Step 4: Install and Launch AutoLLAMA (Frontend App)

Navigate into the Tauri client application directory and install Node packages:
```bash
cd ../autollama
npm install
```

#### Run in Developer Mode
To start the application locally with hot reloading:
```bash
npm run tauri dev
```

#### Compile Production Release Installer
To build a standalone production installer (e.g., `.msi` or `.exe` on Windows, `.dmg` on macOS, `.deb` on Linux):
```bash
npm run tauri build
```
The compiled installer will be saved in `autollama/src-tauri/target/release/bundle/`.

---

## Post-Install Application Setup

Once the AutoLLAMA application interface launches:

1. **Locate `llama-server.exe`**:
   - Go to the **Settings** tab.
   - Click **Locate Binary** under the `llama-server.exe Executable Path` section.
   - Select the file compiled in Step 2: `<project-root>/llama.cpp/build/bin/Release/llama-server.exe` (or `llama-server` on Unix).
2. **Register a Model**:
   - Go to **Models Registry** tab.
   - Click **Browse** under `Local GGUF File Path` and select your `.gguf` model file.
   - Enter a display name and register the model.
3. **Deploy & Chat**:
   - Go to the **Server Control** tab.
   - Create a deployment profile selecting your model and click **Deploy Server**.
   - Navigate to the **Inference Chat** tab to interact with your local LLM in real-time!

---

## Troubleshooting Guide

### 1. Port Conflict Error (e.g. `Port 8082 already in use`)
- If the server crashes with a port conflict, click the **Reset Server Control (Kill Lingering)** button inside the error card or the Settings page. This force terminates any detached `llama-server` instances locking ports.
- Alternatively, toggle **Auto-assign if busy** in your deployment profile to automatically bind the server to the next available socket port.

### 2. Missing C++ Compiler Linkage on Windows
- If Rust or CMake fails to build, verify that the **Desktop development with C++** workload is enabled inside the Visual Studio Installer, and restart your command prompt/terminal.

### 3. GPU Offloading is Not Working
- Ensure you compiled `llama.cpp` using `-DGGML_CUDA=ON` (Step 2, Option B).
- Check that your GPU offload layers configuration (GPU Layers) in the server profile is greater than `0` (e.g. `30` or `-1` for full offloading).
