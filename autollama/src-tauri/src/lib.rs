// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use axum::{Json, http::StatusCode};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child as TokioChild, Command as TokioCommand};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

// --- Data Models ---

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub description: String,
    pub tags: Vec<String>,
    pub last_used: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub model_id: String,
    pub port: u16,
    #[serde(default)]
    pub auto_port: bool,
    pub ctx_size: u32,
    pub batch_size: u32,
    pub threads: u32,
    pub gpu_layers: i32, // -1 for auto, 0 for CPU only, >0 for layers to offload
    pub additional_args: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppPreferences {
    pub llama_server_path: String,
    pub api_port: u16,
    pub default_profile_id: Option<String>,
    pub expose_externally: bool,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            llama_server_path: String::new(),
            api_port: 8000,
            default_profile_id: None,
            expose_externally: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub models: Vec<ModelEntry>,
    pub profiles: Vec<ServerProfile>,
    pub preferences: AppPreferences,
}

#[derive(Serialize, Clone, Debug)]
pub struct ServerStatus {
    pub running: bool,
    pub profile_id: Option<String>,
    pub model_path: Option<String>,
    pub port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApiMetric {
    pub id: String,
    pub timestamp: String,
    pub endpoint: String,
    pub latency_ms: u64,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub error: Option<String>,
}

// --- App State ---

pub struct ActiveServer {
    pub profile_id: String,
    pub model_path: String,
    pub port: u16,
    pub child: Arc<TokioMutex<Option<TokioChild>>>,
}

pub struct AppStateInner {
    pub settings: Settings,
    pub active_server: Option<ActiveServer>,
    pub logs: Vec<String>,
    pub metrics: Vec<ApiMetric>,
    pub server_status_msg: Option<String>,
}

pub struct AppState {
    pub inner: Arc<TokioMutex<AppStateInner>>,
    pub gateway_shutdown_tx: Arc<TokioMutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

// --- Helper Functions ---

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.join("settings.json"))
}

fn load_settings_internal(config_path: &Path) -> Settings {
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(config_path) {
            if let Ok(settings) = serde_json::from_str::<Settings>(&content) {
                return settings;
            }
        }
    }
    
    // Default setting templates if none exists
    Settings::default()
}

// --- Tauri Commands ---

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let inner = state.inner.lock().await;
    Ok(inner.settings.clone())
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    inner.settings = settings.clone();
    
    let config_path = get_config_path(&app)?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(config_path, content).map_err(|e| e.to_string())?;
    
    // If api port changed, trigger gateway restart
    let old_port = inner.settings.preferences.api_port;
    if old_port != settings.preferences.api_port {
        drop(inner);
        let _ = restart_gateway_service(app, state).await;
    }
    
    Ok(())
}

#[tauri::command]
async fn scan_ports() -> Result<HashMap<u16, bool>, String> {
    let ports = vec![8000, 8080, 8001, 8081, 9000, 5000];
    let mut result = HashMap::new();
    for port in ports {
        let available = std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();
        result.insert(port, available);
    }
    Ok(result)
}

#[tauri::command]
async fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatus, String> {
    let inner = state.inner.lock().await;
    if let Some(ref server) = inner.active_server {
        let mut child_guard = server.child.lock().await;
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(None) => {
                    // Still running
                    return Ok(ServerStatus {
                        running: true,
                        profile_id: Some(server.profile_id.clone()),
                        model_path: Some(server.model_path.clone()),
                        port: Some(server.port),
                        error: None,
                    });
                }
                Ok(Some(status)) => {
                    // Stopped/Exited
                    let exit_code_str = format!("exited with code: {}", status);
                    return Ok(ServerStatus {
                        running: false,
                        profile_id: None,
                        model_path: None,
                        port: None,
                        error: Some(exit_code_str),
                    });
                }
                Err(e) => {
                    return Ok(ServerStatus {
                        running: false,
                        profile_id: None,
                        model_path: None,
                        port: None,
                        error: Some(e.to_string()),
                    });
                }
            }
        }
    }
    
    Ok(ServerStatus {
        running: false,
        profile_id: None,
        model_path: None,
        port: None,
        error: inner.server_status_msg.clone(),
    })
}

#[tauri::command]
async fn start_server(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    // 1. Stop active server if running
    let _ = stop_server_internal(&state).await;
    
    let mut inner = state.inner.lock().await;
    inner.server_status_msg = None;
    
    // 2. Find profile
    let profile = inner
        .settings
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?
        .clone();
        
    // 3. Find model
    let model = inner
        .settings
        .models
        .iter()
        .find(|m| m.id == profile.model_id)
        .ok_or_else(|| "Model registered in profile was not found".to_string())?
        .clone();
        
    // 4. Check if llama-server.exe path is configured
    let llama_path_str = inner.settings.preferences.llama_server_path.clone();
    if llama_path_str.trim().is_empty() {
        return Err("Path to llama-server.exe is not configured. Please set it in Settings.".to_string());
    }
    
    let llama_path = PathBuf::from(&llama_path_str);
    if !llama_path.exists() {
        return Err(format!("llama-server.exe not found at configured path: {}", llama_path_str));
    }
    
    let model_path = PathBuf::from(&model.path);
    if !model_path.exists() {
        return Err(format!("GGUF model file not found at: {}", model.path));
    }
    
    // 5. Port check
    let mut server_port = profile.port;
    let mut auto_port_assigned = false;
    
    if std::net::TcpListener::bind(("127.0.0.1", server_port)).is_err() {
        if profile.auto_port || server_port == 0 {
            let mut port = if server_port == 0 { 8080 } else { server_port };
            let mut found = false;
            while port < 65535 {
                if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                    server_port = port;
                    found = true;
                    auto_port_assigned = true;
                    break;
                }
                port += 1;
            }
            if !found {
                return Err(format!("Failed to find any free port to bind."));
            }
        } else {
            return Err(format!("Port {} is already in use. Please select a different port or check if another model server is running.", profile.port));
        }
    }

    // 6. Build process arguments
    let mut args = vec![
        "-m".to_string(),
        model.path.clone(),
        "--port".to_string(),
        server_port.to_string(),
        "-c".to_string(),
        profile.ctx_size.to_string(),
        "-b".to_string(),
        profile.batch_size.to_string(),
    ];
    
    if profile.threads > 0 {
        args.push("-t".to_string());
        args.push(profile.threads.to_string());
    }
    
    if profile.gpu_layers >= 0 {
        args.push("-ngl".to_string());
        args.push(profile.gpu_layers.to_string());
    }
    
    // Split additional custom args
    if !profile.additional_args.trim().is_empty() {
        for arg in profile.additional_args.split_whitespace() {
            args.push(arg.to_string());
        }
    }
    
    // 7. Spawn process
    let mut cmd = TokioCommand::new(&llama_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        
    // Prevents cmd window popup on Windows in release
    #[cfg(target_os = "windows")]
    {
        // 0x08000000 is CREATE_NO_WINDOW
        cmd.creation_flags(0x08000000);
    }
    
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn llama-server: {}", e))?;
    
    let stdout = child.stdout.take().ok_or_else(|| "Failed to pipe stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to pipe stderr".to_string())?;
    
    let active = ActiveServer {
        profile_id: profile.id.clone(),
        model_path: model.path.clone(),
        port: server_port,
        child: Arc::new(TokioMutex::new(Some(child))),
    };
    
    inner.active_server = Some(active);
    
    // Clear logs buffer
    inner.logs.clear();
    if auto_port_assigned {
        // Update profile port in settings so it's persisted and visible in UI
        if let Some(pos) = inner.settings.profiles.iter().position(|p| p.id == profile.id) {
            inner.settings.profiles[pos].port = server_port;
        }
        inner.logs.push(format!("[AutoLLAMA] Port {} was in use. Automatically assigned unused port {}.", profile.port, server_port));
    }
    inner.logs.push(format!("[AutoLLAMA] Starting llama-server on port {}...", server_port));
    inner.logs.push(format!("[AutoLLAMA] Cmd: {} {}", llama_path_str, args.join(" ")));
    
    // 8. Stream stdout/stderr in background threads
    let state_clone = state.inner.clone();
    let app_clone = app.clone();
    
    // Monitor stdout
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let log_msg = format!("[stdout] {}", line);
            let mut guard = state_clone.lock().await;
            guard.logs.push(log_msg.clone());
            if guard.logs.len() > 1000 {
                guard.logs.remove(0);
            }
            drop(guard);
            let _ = app_clone.emit("server_log", log_msg);
        }
    });
    
    let state_clone2 = state.inner.clone();
    let app_clone2 = app.clone();
    // Monitor stderr
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let log_msg = format!("[stderr] {}", line);
            let mut guard = state_clone2.lock().await;
            guard.logs.push(log_msg.clone());
            if guard.logs.len() > 1000 {
                guard.logs.remove(0);
            }
            drop(guard);
            let _ = app_clone2.emit("server_log", log_msg);
        }
    });
    
    let mut settings_changed = auto_port_assigned;
    // Update last used timestamp
    if let Some(pos) = inner.settings.models.iter().position(|m| m.id == model.id) {
        let local_time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        inner.settings.models[pos].last_used = Some(local_time);
        settings_changed = true;
    }
    
    if settings_changed {
        // Persist settings changes
        let config_path = get_config_path(&app)?;
        let content = serde_json::to_string_pretty(&inner.settings).map_err(|e| e.to_string())?;
        let _ = fs::write(config_path, content);
    }
    
    // Emit status change event
    let _ = app.emit("server_status_changed", ());
    
    Ok(())
}

#[tauri::command]
async fn stop_server(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    stop_server_internal(&state).await?;
    let _ = app.emit("server_status_changed", ());
    Ok(())
}

#[tauri::command]
async fn reset_server_control(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    // 1. Force stop any running server known to the app
    let _ = stop_server_internal(&state).await;
    
    // 2. Kill all llama-server processes on the system
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(&["/F", "/IM", "llama-server.exe"]);
        cmd.creation_flags(0x08000000);
        let _ = cmd.output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .arg("-f")
            .arg("llama-server")
            .output();
    }
    
    // 3. Clear any server error in the inner state
    let mut inner = state.inner.lock().await;
    inner.server_status_msg = None;
    inner.logs.push("[AutoLLAMA] System control reset executed: force-killed all llama-server processes and reset state.".to_string());
    
    // 4. Emit status change so UI refreshes
    drop(inner);
    let _ = app.emit("server_status_changed", ());
    Ok(())
}

async fn stop_server_internal(state: &State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    if let Some(server) = inner.active_server.take() {
        let mut child_guard = server.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            inner.logs.push("[AutoLLAMA] Stopping llama-server process...".to_string());
            let _ = child.kill().await;
            inner.logs.push("[AutoLLAMA] Process terminated successfully.".to_string());
        }
    }
    inner.server_status_msg = Some("Stopped".to_string());
    Ok(())
}

#[tauri::command]
async fn run_conversion(
    app: AppHandle,
    state: State<'_, AppState>,
    hf_model: String,
    quantization: String,
    output_dir: String,
    output_name: String,
) -> Result<String, String> {
    // The workspace is at C:\Users\shahl\workspace\python\AUTOLLAMA.
    // Let's resolve the exact path to Python and script.
    let base_dir = PathBuf::from("C:\\Users\\shahl\\workspace\\python\\AUTOLLAMA");
    let python_path = base_dir.join("llama.cpp").join("venv").join("Scripts").join("python.exe");
    let script_path = base_dir.join("llama.cpp").join("convert_hf_to_gguf.py");
    
    if !python_path.exists() {
        return Err(format!("Python virtual environment not found at: {}", python_path.display()));
    }
    if !script_path.exists() {
        return Err(format!("Conversion script not found at: {}", script_path.display()));
    }
    
    // Check output directory
    let output_dir_path = PathBuf::from(&output_dir);
    if !output_dir_path.exists() {
        fs::create_dir_all(&output_dir_path).map_err(|e| format!("Failed to create output directory: {}", e))?;
    }
    
    let mut out_file_name = output_name.clone();
    if !out_file_name.ends_ok() && !out_file_name.ends_with(".gguf") {
        out_file_name = format!("{}.gguf", out_file_name);
    }
    let output_file_path = output_dir_path.join(&out_file_name);
    let output_file_path_str = output_file_path.to_string_lossy().to_string();
    let output_file_path_clone = output_file_path.clone();
    
    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        hf_model.clone(),
        "--outfile".to_string(),
        output_file_path_str.clone(),
        "--outtype".to_string(),
        quantization.clone(),
    ];
    
    // If it's a remote Hugging Face model repository, append the --remote flag
    if hf_model.contains('/') && !Path::new(&hf_model).exists() {
        args.push("--remote".to_string());
    }
    
    let mut cmd = TokioCommand::new(&python_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    
    let app_clone = app.clone();
    let _ = app.emit("conversion_log", format!("[AutoLLAMA] Starting HF GGUF Conversion pipeline..."));
    let _ = app.emit("conversion_log", format!("[AutoLLAMA] Command: {} {}", python_path.display(), args.join(" ")));
    
    let mut child = cmd.spawn().map_err(|e| format!("Failed to start conversion: {}", e))?;
    
    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture conversion stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture conversion stderr".to_string())?;
    
    // Monitor stdout
    let app_stdout = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stdout.emit("conversion_log", line);
        }
    });
    
    // Monitor stderr
    let app_stderr = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stderr.emit("conversion_log", format!("[Warning/Log] {}", line));
        }
    });
    
    // Wait for completion in background task
    let state_clone = state.inner.clone();
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => {
                if status.success() {
                    let _ = app_clone.emit("conversion_log", format!("[AutoLLAMA] Conversion completed successfully!"));
                    let _ = app_clone.emit("conversion_status", true);
                    
                    // Auto-register model
                    let mut guard = state_clone.lock().await;
                    let file_size = match fs::metadata(&output_file_path_clone) {
                        Ok(meta) => meta.len(),
                        Err(_) => 0,
                    };
                    
                    let new_model = ModelEntry {
                        id: Uuid::new_v4().to_string(),
                        name: output_name.clone(),
                        path: output_file_path_clone.to_string_lossy().to_string(),
                        size: file_size,
                        description: format!("Quantized {} model generated from Hugging Face ID: {}", quantization, hf_model),
                        tags: vec!["converted".to_string(), quantization.clone()],
                        last_used: None,
                    };
                    
                    guard.settings.models.push(new_model);
                    // Persist
                    let config_path = get_config_path(&app_clone);
                    if let Ok(path) = config_path {
                        let content = serde_json::to_string_pretty(&guard.settings);
                        if let Ok(c) = content {
                            let _ = fs::write(path, c);
                        }
                    }
                    drop(guard);
                    let _ = app_clone.emit("models_updated", ());
                } else {
                    let _ = app_clone.emit("conversion_log", format!("[Error] Script failed with exit code: {:?}", status.code()));
                    let _ = app_clone.emit("conversion_status", false);
                }
            }
            Err(e) => {
                let _ = app_clone.emit("conversion_log", format!("[Error] Process execution error: {}", e));
                let _ = app_clone.emit("conversion_status", false);
            }
        }
    });
    
    Ok(output_file_path_str)
}

#[tauri::command]
async fn get_metrics(state: State<'_, AppState>) -> Result<Vec<ApiMetric>, String> {
    let inner = state.inner.lock().await;
    Ok(inner.metrics.clone())
}

#[tauri::command]
async fn clear_metrics(state: State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    inner.metrics.clear();
    Ok(())
}

#[tauri::command]
async fn get_logs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let inner = state.inner.lock().await;
    Ok(inner.logs.clone())
}

#[tauri::command]
async fn clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    inner.logs.clear();
    Ok(())
}

// --- Native OS Dialog Wrappers ---

#[tauri::command]
async fn browse_file(app: AppHandle, title: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .add_filter("GGUF Models (*.gguf)", &["gguf"])
        .pick_file(move |file_path: Option<tauri_plugin_dialog::FilePath>| {
            let path_str = file_path.map(|p| p.to_string());
            let _ = tx.send(path_str);
        });
    rx.recv().map_err(|e: std::sync::mpsc::RecvError| e.to_string())
}

#[tauri::command]
async fn browse_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |dir_path: Option<tauri_plugin_dialog::FilePath>| {
            let path_str = dir_path.map(|p| p.to_string());
            let _ = tx.send(path_str);
        });
    rx.recv().map_err(|e: std::sync::mpsc::RecvError| e.to_string())
}

#[tauri::command]
async fn browse_executable(app: AppHandle, title: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .add_filter("Executables (*.exe)", &["exe"])
        .pick_file(move |file_path: Option<tauri_plugin_dialog::FilePath>| {
            let path_str = file_path.map(|p| p.to_string());
            let _ = tx.send(path_str);
        });
    rx.recv().map_err(|e: std::sync::mpsc::RecvError| e.to_string())
}

// Helper trait implementation for GGUF name parsing
trait EndsOk {
    fn ends_ok(&self) -> bool;
}
impl EndsOk for String {
    fn ends_ok(&self) -> bool {
        self.ends_with(".gguf")
    }
}

// --- OpenAI-Compatible Gateway HTTP Server (Axum) ---

async fn start_gateway_service(app: AppHandle, port: u16, state_inner: Arc<TokioMutex<AppStateInner>>) -> tokio::sync::oneshot::Sender<()> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    
    let app_state = state_inner.clone();
    
    // Create standard routing
    let router = axum::Router::new()
        .route("/v1/chat/completions", axum::routing::post(handle_openai_chat_completions))
        .route("/v1/completions", axum::routing::post(handle_openai_completions))
        .route("/v1/models", axum::routing::get(handle_openai_models))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(app_state);
        
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    
    tokio::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                let log_err = format!("[Gateway] Failed to bind proxy port {}: {}", port, e);
                let mut guard = state_inner.lock().await;
                guard.logs.push(log_err.clone());
                let _ = app.emit("server_log", log_err);
                return;
            }
        };
        
        let log_msg = format!("[Gateway] OpenAI Proxy API server listening on http://127.0.0.1:{}", port);
        let mut guard = state_inner.lock().await;
        guard.logs.push(log_msg.clone());
        let _ = app.emit("server_log", log_msg);
        drop(guard);
        
        let server = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            
        if let Err(e) = server.await {
            let log_err = format!("[Gateway] Server error: {}", e);
            let mut guard = state_inner.lock().await;
            guard.logs.push(log_err.clone());
            let _ = app.emit("server_log", log_err);
        }
    });
    
    shutdown_tx
}

async fn restart_gateway_service(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut tx_guard = state.gateway_shutdown_tx.lock().await;
    if let Some(tx) = tx_guard.take() {
        let _ = tx.send(()); // Trigger shutdown
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }
    
    let inner = state.inner.lock().await;
    let new_port = inner.settings.preferences.api_port;
    let state_inner_clone = state.inner.clone();
    drop(inner);
    
    let new_tx = start_gateway_service(app, new_port, state_inner_clone).await;
    *tx_guard = Some(new_tx);
    
    Ok(())
}

// Proxy handlers for OpenAI endpoints
async fn handle_openai_models(
    axum::extract::State(state): axum::extract::State<Arc<TokioMutex<AppStateInner>>>,
) -> impl axum::response::IntoResponse {
    let guard = state.lock().await;
    
    let mut model_list = Vec::new();
    for m in &guard.settings.models {
        model_list.push(serde_json::json!({
            "id": m.name,
            "object": "model",
            "created": 1677610602,
            "owned_by": "autollama"
        }));
    }
    
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "object": "list",
            "data": model_list
        }))
    )
}

async fn handle_openai_chat_completions(
    axum::extract::State(state): axum::extract::State<Arc<TokioMutex<AppStateInner>>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> impl axum::response::IntoResponse {
    proxy_to_llama_server(state, "chat/completions", headers, payload).await
}

async fn handle_openai_completions(
    axum::extract::State(state): axum::extract::State<Arc<TokioMutex<AppStateInner>>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> impl axum::response::IntoResponse {
    proxy_to_llama_server(state, "completions", headers, payload).await
}

async fn proxy_to_llama_server(
    state: Arc<TokioMutex<AppStateInner>>,
    endpoint: &str,
    _headers: axum::http::HeaderMap,
    payload: serde_json::Value,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let start_time = Instant::now();
    
    // 1. Get active server port
    let (port, model_name) = {
        let guard = state.lock().await;
        if let Some(ref server) = guard.active_server {
            (server.port, server.model_path.clone())
        } else {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "message": "No active llama-server running. Please start a model server in the AutoLLAMA dashboard.",
                        "type": "server_error",
                        "param": null,
                        "code": "no_active_server"
                    }
                }))
            ));
        }
    };
    
    let is_streaming = payload.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let target_url = format!("http://127.0.0.1:{}/v1/{}", port, endpoint);
    
    let client = reqwest::Client::new();
    
    if is_streaming {
        // Forward as streaming response
        let res = client
            .post(&target_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": {
                            "message": format!("Proxy connection to llama-server failed: {}", e),
                            "type": "api_error",
                            "param": null,
                            "code": "llama_server_unreachable"
                        }
                    }))
                )
            })?;
            
        let res_status = res.status();
        let mut headers_map = axum::http::HeaderMap::new();
        headers_map.insert(
            axum::http::header::CONTENT_TYPE,
            axum::http::header::HeaderValue::from_static("text/event-stream"),
        );
        headers_map.insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::header::HeaderValue::from_static("no-cache"),
        );
        
        let client_stream = res.bytes_stream();
        
        // Wrap stream in a parser that logs token usage at the end
        let state_clone = state.clone();
        let endpoint_str = endpoint.to_string();
        
        // Scan stream chunks in a helper task
        use futures_util::StreamExt;
        let mapped_stream = client_stream.map(move |chunk_result| {
            if let Ok(ref bytes) = chunk_result {
                let chunk_text = String::from_utf8_lossy(&bytes[..]);
                // Scan for usage in SSE stream
                // Usage block looks like: "usage":{"prompt_tokens":12,"completion_tokens":25,"total_tokens":37}
                if chunk_text.contains("\"usage\"") {
                    let state_capture = state_clone.clone();
                    let ep = endpoint_str.clone();
                    let _model_ref = model_name.clone();
                    let elapsed = start_time.elapsed().as_millis() as u64;
                    let text = chunk_text.to_string();
                    
                    tokio::spawn(async move {
                        let mut pt = 0;
                        let mut ct = 0;
                        let mut tt = 0;
                        
                        // Crude JSON-substring parser for usage metrics to keep it ultra lightweight
                        if let Some(pos) = text.find("\"prompt_tokens\"") {
                            let sub = &text[pos..];
                            if let Some(colon) = sub.find(':') {
                                if let Some(comma) = sub[colon..].find(',') {
                                    if let Ok(num) = sub[colon+1..colon+comma].trim().parse::<u32>() {
                                        pt = num;
                                    }
                                }
                            }
                        }
                        if let Some(pos) = text.find("\"completion_tokens\"") {
                            let sub = &text[pos..];
                            if let Some(colon) = sub.find(':') {
                                if let Some(comma) = sub[colon..].find(',') {
                                    if let Ok(num) = sub[colon+1..colon+comma].trim().parse::<u32>() {
                                        ct = num;
                                    }
                                } else if let Some(brace) = sub[colon..].find('}') {
                                    if let Ok(num) = sub[colon+1..colon+brace].trim().parse::<u32>() {
                                        ct = num;
                                    }
                                }
                            }
                        }
                        if let Some(pos) = text.find("\"total_tokens\"") {
                            let sub = &text[pos..];
                            if let Some(colon) = sub.find(':') {
                                if let Some(brace) = sub[colon..].find('}') {
                                    if let Ok(num) = sub[colon+1..colon+brace].trim().parse::<u32>() {
                                        tt = num;
                                    }
                                }
                            }
                        }
                        
                        if tt == 0 {
                            tt = pt + ct;
                        }
                        
                        let metric = ApiMetric {
                            id: Uuid::new_v4().to_string(),
                            timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                            endpoint: ep,
                            latency_ms: elapsed,
                            prompt_tokens: pt,
                            completion_tokens: ct,
                            total_tokens: tt,
                            error: None,
                        };
                        let mut guard = state_capture.lock().await;
                        guard.metrics.push(metric);
                        if guard.metrics.len() > 500 {
                            guard.metrics.remove(0);
                        }
                    });
                }
            }
            chunk_result
        });
        
        let response = axum::response::Response::builder()
            .status(res_status)
            .header(axum::http::header::CONTENT_TYPE, "text/event-stream")
            .body(axum::body::Body::from_stream(mapped_stream))
            .unwrap();
            
        Ok(response)
    } else {
        // Standard blocking request
        let res = client
            .post(&target_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": {
                            "message": format!("Proxy connection to llama-server failed: {}", e),
                            "type": "api_error",
                            "param": null,
                            "code": "llama_server_unreachable"
                        }
                    }))
                )
            })?;
            
        let res_status = res.status();
        let res_json_res = res.json::<serde_json::Value>().await;
        let res_json: serde_json::Value = res_json_res.map_err(|e: reqwest::Error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": {
                        "message": format!("Invalid JSON response from llama-server: {}", e),
                        "type": "api_error",
                        "param": null,
                        "code": "bad_json"
                    }
                }))
            )
        })?;
        
        let latency = start_time.elapsed().as_millis() as u64;
        
        // Extract token usage
        let mut pt = 0;
        let mut ct = 0;
        let mut tt = 0;
        if let Some(usage) = res_json.get("usage").and_then(|u| u.as_object()) {
            pt = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            ct = usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            tt = usage.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        }
        
        // Record metrics
        let mut guard = state.lock().await;
        let metric = ApiMetric {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            endpoint: endpoint.to_string(),
            latency_ms: latency,
            prompt_tokens: pt,
            completion_tokens: ct,
            total_tokens: tt,
            error: None,
        };
        guard.metrics.push(metric);
        if guard.metrics.len() > 500 {
            guard.metrics.remove(0);
        }
        drop(guard);
        
        let response = axum::response::Response::builder()
            .status(res_status)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(serde_json::to_string(&res_json).unwrap()))
            .unwrap();
            
        Ok(response)
    }
}

// --- App Entrypoint ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_internal(&Path::new("C:\\Users\\shahl\\AppData\\Roaming\\com.shahl.autollama\\settings.json"));
    let api_port = settings.preferences.api_port;
    
    let inner_state = Arc::new(TokioMutex::new(AppStateInner {
        settings,
        active_server: None,
        logs: vec!["[AutoLLAMA] Welcome to AutoLLAMA Dashboard!".to_string()],
        metrics: Vec::new(),
        server_status_msg: None,
    }));
    
    let app_state = AppState {
        inner: inner_state.clone(),
        gateway_shutdown_tx: Arc::new(TokioMutex::new(None)),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(move |app| {
            let state = app.state::<AppState>();
            let app_handle = app.handle().clone();
            let inner_clone = state.inner.clone();
            
            // Start OpenAI proxy server
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let tx = start_gateway_service(app_handle, api_port, inner_clone).await;
                let state_handle = app_handle_clone.state::<AppState>();
                let mut tx_guard = state_handle.gateway_shutdown_tx.lock().await;
                *tx_guard = Some(tx);
            });
            
            let config_path = get_config_path(&app.handle())?;
            let loaded = load_settings_internal(&config_path);
            let mut guard = state.inner.blocking_lock();
            guard.settings = loaded;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            scan_ports,
            get_server_status,
            start_server,
            stop_server,
            reset_server_control,
            run_conversion,
            get_metrics,
            clear_metrics,
            get_logs,
            clear_logs,
            browse_file,
            browse_folder,
            browse_executable
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
