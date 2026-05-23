import { useEffect, useState, useRef } from 'react';
import { useStore } from './store';
import './index.css';
import {
  Server,
  Database,
  Activity,
  Cpu,
  Settings as SettingsIcon,
  Play,
  Square,
  FolderOpen,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Copy,
  Terminal,
  RefreshCw,
  Tag,
  Flame,
  Check,
  MessageSquare,
  Bot,
  Send,
} from 'lucide-react';

// --- Markdown Code Block Parser Helpers ---
interface TextSegment {
  type: 'text';
  content: string;
}

interface CodeSegment {
  type: 'code';
  language: string;
  content: string;
}

type MessageSegment = TextSegment | CodeSegment;

function parseMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9+#-]*)\n([\s\S]*?)(?:```|$)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore });
    }
    
    segments.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2].trimEnd()
    });
    
    lastIndex = codeBlockRegex.lastIndex;
  }
  
  const textAfter = text.slice(lastIndex);
  if (textAfter) {
    segments.push({ type: 'text', content: textAfter });
  }
  
  return segments;
}

const CodeBlock = ({ language, content }: { language: string; content: string }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div style={{ 
      margin: '12px 0', 
      borderRadius: '6px', 
      overflow: 'hidden', 
      border: '1px solid var(--border-color)',
      background: '#0d1117',
      fontFamily: 'var(--font-mono)'
    }}>
      {/* Header bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '6px 12px', 
        background: 'rgba(0,0,0,0.5)', 
        borderBottom: '1px solid var(--border-color)',
        fontSize: '0.75rem',
        color: 'var(--text-secondary)'
      }}>
        <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{language.toUpperCase()}</span>
        <button 
          type="button" 
          onClick={handleCopy}
          style={{ 
            background: 'none', 
            border: 'none', 
            color: copied ? 'var(--color-success)' : 'var(--text-secondary)', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.75rem',
            padding: '2px 6px',
            borderRadius: '4px'
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      
      {/* Code body */}
      <pre style={{ 
        margin: 0, 
        padding: '12px', 
        overflowX: 'auto', 
        fontSize: '0.85rem', 
        lineHeight: 1.45,
        color: '#e6edf3',
        background: 'transparent',
        whiteSpace: 'pre',
        textAlign: 'left'
      }}>
        <code>{content}</code>
      </pre>
    </div>
  );
};

function App() {
  const {
    settings,
    activeTab,
    serverStatus,
    logs,
    metrics,
    portsStatus,
    isConverting,
    conversionLogs,
    conversionSuccess,
    setTab,
    loadSettings,
    saveSettings,
    addModel,
    deleteModel,
    addProfile,
    deleteProfile,
    updateProfile,
    checkServerStatus,
    startServer,
    stopServer,
    resetServerControl,
    scanPorts,
    runConversion,
    clearConversionLogs,
    loadLogs,
    clearLogs,
    loadMetrics,
    browseGguf,
    browseFolder,
    browseExecutable,
    initListeners,
  } = useStore();

  // --- UI Local State ---
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Model input fields
  const [modelPath, setModelPath] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelDesc, setModelDesc] = useState('');
  const [modelTags, setModelTags] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  // Profile fields (creation/edit)
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfilePort, setNewProfilePort] = useState(8080);
  const [newProfileCtx, setNewProfileCtx] = useState(2048);
  const [newProfileBatch, setNewProfileBatch] = useState(512);
  const [newProfileThreads, setNewProfileThreads] = useState(4);
  const [newProfileGpu, setNewProfileGpu] = useState(-1);
  const [newProfileArgs, setNewProfileArgs] = useState('');
  const [newProfileModelId, setNewProfileModelId] = useState('');
  const [newProfileAutoPort, setNewProfileAutoPort] = useState(false);

  // Tester state
  const [testPrompt, setTestPrompt] = useState('Write a haiku about artificial intelligence.');
  const [testTemp, setTestTemp] = useState(0.7);
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testMetrics, setTestMetrics] = useState<{
    latency: number;
    promptTokens: number;
    compTokens: number;
    speed: number;
  } | null>(null);

  // Conversion state
  const [convHfId, setConvHfId] = useState('HuggingFaceTB/SmolLM2-135M-Instruct');
  const [convQuant, setConvQuant] = useState('q8_0');
  const [convOutputDir, setConvOutputDir] = useState('');
  const [convOutputName, setConvOutputName] = useState('smollm2-135m-q8_0');

  // Logs severity state
  const [logFilter, setLogFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all');
  
  // Copy feedback state
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Refs
  const logEndRef = useRef<HTMLDivElement>(null);
  const convLogEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Inference Page State
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSystemPrompt, setChatSystemPrompt] = useState('You are a helpful, respectful, and honest assistant.');
  const [chatTemp, setChatTemp] = useState(0.7);
  const [chatMaxTokens, setChatMaxTokens] = useState(2048);
  const [chatTopP, setChatTopP] = useState(0.9);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    async function init() {
      await loadSettings();
      await checkServerStatus();
      await scanPorts();
      await loadLogs();
      await loadMetrics();
      
      const cleanListeners = await initListeners();
      
      setIsInitializing(false);
      
      return () => {
        cleanListeners();
      };
    }
    init();
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    convLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversionLogs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Set default profile selection on settings load
  useEffect(() => {
    if (settings.profiles.length > 0 && !selectedProfileId) {
      const defaultId = settings.preferences.default_profile_id;
      if (defaultId && settings.profiles.some(p => p.id === defaultId)) {
        setSelectedProfileId(defaultId);
      } else {
        setSelectedProfileId(settings.profiles[0].id);
      }
    }
  }, [settings.profiles]);

  // Set default output directory for conversion if empty
  useEffect(() => {
    if (!convOutputDir && settings.preferences.llama_server_path) {
      const parts = settings.preferences.llama_server_path.split('\\');
      parts.pop(); // remove llama-server.exe
      parts.pop(); // remove build/bin/etc. if needed
      setConvOutputDir(parts.join('\\') + '\\models');
    }
  }, [settings.preferences.llama_server_path]);

  // --- Copy Helper ---
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // --- Model Actions ---
  const handleRegisterModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelPath || !modelName) return;
    
    // Simple file size extraction (can fall back)
    await addModel({
      name: modelName,
      path: modelPath,
      size: 0, // Rust side will extract size if zero, or we can just leave it
      description: modelDesc,
      tags: modelTags.split(',').map((t) => t.trim()).filter(Boolean),
    });

    setModelPath('');
    setModelName('');
    setModelDesc('');
    setModelTags('');
  };

  const handleBrowseGguf = async () => {
    const path = await browseGguf();
    if (path) {
      setModelPath(path);
      const filename = path.split('\\').pop() || path.split('/').pop() || '';
      setModelName(filename.replace('.gguf', ''));
    }
  };

  // --- Profile Actions ---
  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName || !newProfileModelId) return;

    await addProfile({
      name: newProfileName,
      model_id: newProfileModelId,
      port: newProfilePort,
      auto_port: newProfileAutoPort,
      ctx_size: newProfileCtx,
      batch_size: newProfileBatch,
      threads: newProfileThreads,
      gpu_layers: newProfileGpu,
      additional_args: newProfileArgs,
    });

    setNewProfileName('');
    setNewProfileModelId('');
    setNewProfilePort(8080);
    setNewProfileAutoPort(false);
    setNewProfileCtx(2048);
    setNewProfileBatch(512);
    setNewProfileThreads(4);
    setNewProfileGpu(-1);
    setNewProfileArgs('');
    setShowNewProfileModal(false);
  };

  // --- API Tester ---
  const handleSendTestRequest = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestResult('');
    setTestMetrics(null);

    const apiPort = settings.preferences.api_port;
    const url = `http://127.0.0.1:${apiPort}/v1/chat/completions`;
    const payload = {
      model: serverStatus.model_path?.split('\\').pop() || 'local-model',
      messages: [{ role: 'user', content: testPrompt }],
      temperature: testTemp,
      max_tokens: 100,
    };

    const startTime = performance.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      if (data.choices && data.choices.length > 0) {
        setTestResult(data.choices[0].message.content);
        const pt = data.usage?.prompt_tokens || 0;
        const ct = data.usage?.completion_tokens || 0;
        const speed = ct > 0 ? Math.round((ct / (latency / 1000)) * 10) / 10 : 0;
        
        setTestMetrics({
          latency,
          promptTokens: pt,
          compTokens: ct,
          speed,
        });
      } else if (data.error) {
        setTestResult(`Error: ${data.error.message}`);
      } else {
        setTestResult(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setTestResult(`Request Failed: Ensure the server dashboard proxy port (${apiPort}) is running, and llama-server has successfully initialized.\nDetails: ${e}`);
    } finally {
      setIsTesting(false);
      loadMetrics(); // Refresh dashboard metrics
    }
  };

  // --- Inference Chat Actions ---
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating || !chatInput.trim()) return;

    const userMsgId = Math.random().toString(36).substring(2, 9);
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: chatInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setIsGenerating(true);
    const nextMessages = [...chatMessages, userMsg];
    setChatMessages(nextMessages);
    setChatInput('');

    const assistantMsgId = Math.random().toString(36).substring(2, 9);
    const assistantMsgPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatMessages(prev => [...prev, assistantMsgPlaceholder]);

    const apiMessages = [];
    if (chatSystemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: chatSystemPrompt });
    }
    apiMessages.push(...nextMessages.map(m => ({ role: m.role, content: m.content })));

    const stopSequences = [
      "<|im_end|>",
      "<|im_start|>",
      "<|eot_id|>",
      "<|start_header_id|>",
      "Assistant:",
      "User:",
      "assistant:",
      "user:",
      "\nuser",
      "\nassistant",
      "\n<|"
    ];

    const cleanText = (text: string) => {
      let cleaned = text;
      let shouldStop = false;
      for (const seq of stopSequences) {
        const idx = cleaned.indexOf(seq);
        if (idx !== -1) {
          cleaned = cleaned.slice(0, idx);
          shouldStop = true;
        }
      }
      return { text: cleaned, shouldStop };
    };

    try {
      const apiPort = settings.preferences.api_port;
      const res = await fetch(`http://127.0.0.1:${apiPort}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-model',
          messages: apiMessages,
          stream: true,
          temperature: chatTemp,
          max_tokens: chatMaxTokens,
          top_p: chatTopP,
          stop: stopSequences
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No body reader available.");
      }

      const decoder = new TextDecoder("utf-8");
      let accumulatedText = "";

      let stopEarly = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done || stopEarly) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const dataJson = JSON.parse(trimmed.slice(6));
              const contentToken = dataJson.choices?.[0]?.delta?.content;
              if (contentToken) {
                accumulatedText += contentToken;
                
                const cleaned = cleanText(accumulatedText);
                
                setChatMessages(prev =>
                  prev.map(m => m.id === assistantMsgId ? { ...m, content: cleaned.text } : m)
                );

                if (cleaned.shouldStop) {
                  stopEarly = true;
                  try {
                    await reader.cancel();
                  } catch (err) {
                    // Ignore cancel errors
                  }
                  break;
                }
              }
            } catch (e) {
              // Ignore parsing errors of incomplete JSON frames
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat request failed", error);
      setChatMessages(prev =>
        prev.map(m => m.id === assistantMsgId ? { ...m, content: `Error: Chat execution failed. Make sure the server dashboard is online and the model is fully loaded.\nDetails: ${error}` } : m)
      );
    } finally {
      setIsGenerating(false);
      loadMetrics(); // Refresh metrics tab
    }
  };

  const handleClearChat = () => {
    setChatMessages([]);
  };

  // --- Rendering Helpers ---
  const activeProfile = settings.profiles.find((p) => p.id === selectedProfileId);
  const activeModel = activeProfile ? settings.models.find((m) => m.id === activeProfile.model_id) : null;

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (logFilter === 'all') return true;
    if (logFilter === 'stdout') return log.startsWith('[stdout]');
    if (logFilter === 'stderr') return log.startsWith('[stderr]');
    if (logFilter === 'system') return log.startsWith('[AutoLLAMA]') || log.startsWith('[Gateway]');
    return true;
  });

  if (isInitializing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', background: '#070913', gap: '20px' }}>
        <div className="logo-icon" style={{ width: '60px', height: '60px', fontSize: '1.8rem' }}>λ</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f3f4f6' }}>Initializing AutoLLAMA...</div>
        <div style={{ width: '200px', height: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: '50%', height: '100%', background: 'var(--color-primary)', animation: 'pulse 1s infinite' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 1. Sidebar Navigation */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">λ</div>
          <div className="logo-text">AutoLLAMA</div>
        </div>
        
        <div className="sidebar-nav">
          <div className={`nav-item ${activeTab === 'server' ? 'active' : ''}`} onClick={() => setTab('server')}>
            <Server className="nav-item-icon" />
            <span>Server Control</span>
          </div>
          <div className={`nav-item ${activeTab === 'inference' ? 'active' : ''}`} onClick={() => setTab('inference')}>
            <MessageSquare className="nav-item-icon" />
            <span>Inference Chat</span>
          </div>
          <div className={`nav-item ${activeTab === 'models' ? 'active' : ''}`} onClick={() => setTab('models')}>
            <Database className="nav-item-icon" />
            <span>Models Registry</span>
          </div>
          <div className={`nav-item ${activeTab === 'monitor' ? 'active' : ''}`} onClick={() => setTab('monitor')}>
            <Activity className="nav-item-icon" />
            <span>Observability</span>
          </div>
          <div className={`nav-item ${activeTab === 'convert' ? 'active' : ''}`} onClick={() => setTab('convert')}>
            <Cpu className="nav-item-icon" />
            <span>GGUF Converter</span>
          </div>
          <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            <SettingsIcon className="nav-item-icon" />
            <span>Settings</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="server-status-widget">
            <div className={`status-dot ${serverStatus.running ? 'active' : serverStatus.error?.includes('Starting') ? 'starting' : serverStatus.error ? 'error' : ''}`}></div>
            <div className="server-status-info">
              <span className="server-status-label">
                {serverStatus.running ? 'Running' : serverStatus.error?.includes('Starting') ? 'Starting...' : 'Stopped'}
              </span>
              <span className="server-status-desc">
                {serverStatus.running ? `Port ${serverStatus.port}` : 'Inference Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Main Work Panel */}
      <div className="main-content">
        <div className="header">
          <div className="header-title-container">
            <h1 className="header-title">
              {activeTab === 'server' && 'Server Control Center'}
              {activeTab === 'inference' && 'Inference Chat Playground'}
              {activeTab === 'models' && 'Models Registry'}
              {activeTab === 'monitor' && 'Observability & Metrics'}
              {activeTab === 'convert' && 'GGUF Conversion Pipeline'}
              {activeTab === 'settings' && 'Global Configurations'}
            </h1>
            <p className="header-subtitle">
              {activeTab === 'server' && 'Deploy server profiles and test local inferences'}
              {activeTab === 'inference' && 'Chat in real-time with the active model and tune parameters'}
              {activeTab === 'models' && 'Register, scan, and manage your local GGUF models'}
              {activeTab === 'monitor' && 'Monitor token usage, logs, and server throughput'}
              {activeTab === 'convert' && 'Quantize and download remote Hugging Face repos to local GGUF'}
              {activeTab === 'settings' && 'Configure search paths, proxy server ports, and default parameters'}
            </p>
          </div>
          
          <div className="header-actions">
            {serverStatus.running && (
              <button className="btn btn-danger" onClick={stopServer}>
                <Square size={16} /> Stop Server
              </button>
            )}
            {!serverStatus.running && activeProfile && (
              <button className="btn btn-primary" onClick={() => startServer(activeProfile.id)}>
                <Play size={16} /> Deploy Server
              </button>
            )}
          </div>
        </div>

        <div className="view-container">
          
          {/* ==================== INFERENCE VIEW ==================== */}
          {activeTab === 'inference' && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', height: 'calc(100vh - 180px)', minHeight: '500px' }}>
              <style>{`
                @keyframes blink {
                  0% { opacity: 0.2; }
                  20% { opacity: 1; }
                  100% { opacity: 0.2; }
                }
                .pulse-dot {
                  width: 6px;
                  height: 6px;
                  background-color: var(--color-primary);
                  border-radius: 50%;
                  display: inline-block;
                  animation: blink 1.4s infinite both;
                }
              `}</style>
              
              {/* Left Column: Parameter Configuration */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto' }}>
                <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <SettingsIcon size={18} /> Chat Parameters
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    System Prompt
                  </label>
                  <textarea 
                    className="input-field" 
                    rows={4}
                    style={{ fontSize: '0.85rem', resize: 'none' }}
                    value={chatSystemPrompt}
                    onChange={(e) => setChatSystemPrompt(e.target.value)}
                    placeholder="Enter instructions for the model behavior..."
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Temperature</span>
                    <strong style={{ color: 'var(--color-primary)' }}>{chatTemp}</strong>
                  </label>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.5" 
                    step="0.1" 
                    value={chatTemp}
                    onChange={(e) => setChatTemp(parseFloat(e.target.value))}
                    style={{ accentColor: 'var(--color-primary)', width: '100%' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Higher values mean more creative but less predictable generation.</span>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Max Tokens</span>
                    <strong style={{ color: 'var(--color-primary)' }}>{chatMaxTokens}</strong>
                  </label>
                  <input 
                    type="range" 
                    min="64" 
                    max="4096" 
                    step="64" 
                    value={chatMaxTokens}
                    onChange={(e) => setChatMaxTokens(parseInt(e.target.value))}
                    style={{ accentColor: 'var(--color-primary)', width: '100%' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>The maximum length of tokens to generate.</span>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Top P</span>
                    <strong style={{ color: 'var(--color-primary)' }}>{chatTopP}</strong>
                  </label>
                  <input 
                    type="range" 
                    min="0.0" 
                    max="1.0" 
                    step="0.05" 
                    value={chatTopP}
                    onChange={(e) => setChatTopP(parseFloat(e.target.value))}
                    style={{ accentColor: 'var(--color-primary)', width: '100%' }}
                  />
                </div>

                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', marginTop: 'auto', display: 'flex', justifyContent: 'center', gap: '8px' }}
                  onClick={handleClearChat}
                >
                  <Trash2 size={16} /> Clear Chat History
                </button>
              </div>

              {/* Right Column: Chat Screen */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', height: '100%', border: '1px solid var(--border-color)' }}>
                {/* Chat Panel Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className={`status-dot ${serverStatus.running ? 'active' : ''}`} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                        {serverStatus.running 
                          ? (serverStatus.model_path?.split('\\').pop()?.split('/').pop() || 'Active Model')
                          : 'Inference Offline'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {serverStatus.running ? `Listening on API Port ${settings.preferences.api_port}` : 'Please start a model server in Server Control'}
                      </span>
                    </div>
                  </div>
                  {chatMessages.length > 0 && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {chatMessages.filter(m => m.role !== 'system').length} Messages
                    </span>
                  )}
                </div>

                {/* Messages Bubble Area */}
                <div style={{ flexGrow: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {chatMessages.length === 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
                      <Bot size={48} style={{ opacity: 0.3 }} />
                      <div style={{ fontSize: '1rem', fontWeight: 600 }}>Start a new conversation</div>
                      <div style={{ fontSize: '0.8rem', textAlign: 'center', maxWidth: '300px' }}>
                        {serverStatus.running 
                          ? 'Send a message below to start interacting with the local model.'
                          : 'Please deploy a server first in the Server Control view to activate the chatbot.'}
                      </div>
                    </div>
                  )}
                  
                  {chatMessages.map((msg) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div 
                        key={msg.id} 
                        style={{ 
                          display: 'flex', 
                          gap: '12px', 
                          flexDirection: isUser ? 'row-reverse' : 'row',
                          alignItems: 'flex-start',
                          alignSelf: isUser ? 'flex-end' : 'flex-start',
                          maxWidth: '75%'
                        }}
                      >
                        {/* Avatar */}
                        <div style={{ 
                          width: '32px', 
                          height: '32px', 
                          borderRadius: '50%', 
                          background: isUser ? 'var(--color-primary)' : 'rgba(99, 102, 241, 0.15)',
                          border: isUser ? 'none' : '1px solid rgba(99, 102, 241, 0.3)',
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {isUser ? 'U' : <Bot size={16} style={{ color: 'var(--color-primary)' }} />}
                        </div>

                        {/* Content & Bubble */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                          <div style={{ 
                            background: isUser ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid ' + (isUser ? 'rgba(99, 102, 241, 0.3)' : 'var(--border-color)'),
                            padding: '12px 16px',
                            borderRadius: '12px',
                            borderTopRightRadius: isUser ? '2px' : '12px',
                            borderTopLeftRadius: isUser ? '12px' : '2px',
                            color: '#f3f4f6',
                            fontSize: '0.9rem',
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}>
                            {msg.content ? (
                              parseMessageSegments(msg.content).map((segment, idx) => {
                                if (segment.type === 'code') {
                                  return (
                                    <CodeBlock 
                                      key={idx} 
                                      language={segment.language} 
                                      content={segment.content} 
                                    />
                                  );
                                }
                                return <span key={idx}>{segment.content}</span>;
                              })
                            ) : (
                              isGenerating && msg.role === 'assistant' && (
                                <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                  <span className="pulse-dot" style={{ animationDelay: '0s' }} />
                                  <span className="pulse-dot" style={{ animationDelay: '0.2s' }} />
                                  <span className="pulse-dot" style={{ animationDelay: '0.4s' }} />
                                </span>
                              )
                            )}
                          </div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{msg.timestamp}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Text Box Bar */}
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                  style={{ 
                    padding: '20px', 
                    borderTop: '1px solid var(--border-color)', 
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                  }}
                >
                  <input 
                    type="text"
                    className="input-field"
                    style={{ flexGrow: 1, padding: '12px 16px', borderRadius: '8px' }}
                    placeholder={serverStatus.running ? "Type message and press Enter..." : "Server is offline. Start server to chat..."}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={!serverStatus.running || isGenerating}
                  />
                  <button 
                    type="submit" 
                    className={`btn btn-primary ${(!serverStatus.running || isGenerating || !chatInput.trim()) ? 'btn-disabled' : ''}`}
                    style={{ padding: '12px 20px', display: 'flex', gap: '8px', alignItems: 'center' }}
                    disabled={!serverStatus.running || isGenerating || !chatInput.trim()}
                  >
                    {isGenerating ? <RefreshCw size={16} style={{ animation: 'spin 1s infinite linear' }} /> : <Send size={16} />}
                    Send
                  </button>
                </form>
              </div>

            </div>
          )}

          {/* ==================== SERVER VIEW ==================== */}
          {activeTab === 'server' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {serverStatus.error && (
                <div className="card" style={{ borderLeft: '4px solid var(--color-danger)', background: 'rgba(239, 68, 68, 0.05)' }}>
                  <div className="card-title" style={{ color: '#f87171' }}>
                    <AlertTriangle size={18} /> Server Process Error
                  </div>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{serverStatus.error}</p>
                  
                  {activeProfile && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                      <button 
                        className="btn btn-secondary" 
                        onClick={resetServerControl}
                        style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                      >
                        Reset Server Control (Kill Lingering)
                      </button>
                      
                      {serverStatus.error.toLowerCase().includes('port') && (
                        <button 
                          className="btn btn-primary"
                          onClick={async () => {
                            try {
                              await updateProfile(activeProfile.id, { auto_port: true });
                              await startServer(activeProfile.id);
                            } catch (e) {
                              console.error(e);
                            }
                          }}
                        >
                          Auto-Assign Port & Deploy
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                {/* Deployment Config Card */}
                <div className="card">
                  <div className="card-title"><Server size={18} /> Deploy Configuration</div>
                  
                  <div className="form-group">
                    <label className="form-label">Server Profile</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <select 
                        className="input-field select-field" 
                        style={{ flexGrow: 1 }}
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                        disabled={serverStatus.running}
                      >
                        {settings.profiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                        {settings.profiles.length === 0 && (
                          <option value="">No profiles configured</option>
                        )}
                      </select>
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => setShowNewProfileModal(true)}
                        disabled={serverStatus.running}
                      >
                        <Plus size={16} /> New
                      </button>
                    </div>
                  </div>

                  {activeProfile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                        <div><strong>Active Model:</strong> {activeModel ? activeModel.name : 'Unknown Model'}</div>
                        <div><strong>Port:</strong> {activeProfile.port}</div>
                        <div><strong>Context Length:</strong> {activeProfile.ctx_size}</div>
                        <div><strong>Batch Size:</strong> {activeProfile.batch_size}</div>
                        <div><strong>GPU Offload:</strong> {activeProfile.gpu_layers === -1 ? 'Auto (All)' : `${activeProfile.gpu_layers} layers`}</div>
                        <div><strong>CPU Threads:</strong> {activeProfile.threads || 'Auto'}</div>
                      </div>
                      
                      {!serverStatus.running && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                          <button className="btn btn-primary" style={{ flexGrow: 1 }} onClick={() => startServer(activeProfile.id)}>
                            <Play size={16} /> Deploy Server Profile
                          </button>
                          <button className="btn btn-danger" onClick={() => deleteProfile(activeProfile.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                      {serverStatus.running && serverStatus.profile_id === activeProfile.id && (
                        <button className="btn btn-danger" style={{ width: '100%', marginTop: '8px' }} onClick={stopServer}>
                          <Square size={16} /> Terminate Server
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '20px', fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center' }}>
                      Please create a server profile to get started.
                    </div>
                  )}
                </div>

                {/* Connection details panel */}
                <div className="card">
                  <div className="card-title"><CheckCircle size={18} /> Gateway Connection Panel</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">API Gateway URL</label>
                      <div className="file-input-wrapper">
                        <input 
                          type="text" 
                          readOnly 
                          className="input-field file-input-path" 
                          value={`http://localhost:${settings.preferences.api_port}/v1`}
                        />
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => copyToClipboard(`http://localhost:${settings.preferences.api_port}/v1`, 'gate')}
                        >
                          {copiedText === 'gate' ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div><strong>OpenAI compatible endpoint paths:</strong></div>
                      <div style={{ fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                        POST /v1/chat/completions<br/>
                        POST /v1/completions<br/>
                        GET /v1/models
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Quick Client Integration Test (curl)</label>
                      <div className="file-input-wrapper">
                        <textarea 
                          readOnly 
                          rows={3}
                          className="input-field file-input-path" 
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', resize: 'none' }}
                          value={`curl http://localhost:${settings.preferences.api_port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "Hello"}], "stream": false}'`}
                        />
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => copyToClipboard(`curl http://localhost:${settings.preferences.api_port}/v1/chat/completions -H "Content-Type: application/json" -d '{"messages": [{"role": "user", "content": "Hello"}], "stream": false}'`, 'curl')}
                        >
                          {copiedText === 'curl' ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* API Playground */}
              <div className="card">
                <div className="card-title"><Flame size={18} /> API Interactive Playground</div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Test Prompt</label>
                      <textarea 
                        className="input-field" 
                        rows={3} 
                        value={testPrompt}
                        onChange={(e) => setTestPrompt(e.target.value)}
                        placeholder="Write a prompt to test your LLM server..."
                        disabled={!serverStatus.running}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Temperature: {testTemp}</label>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1.5" 
                        step="0.1" 
                        value={testTemp}
                        onChange={(e) => setTestTemp(parseFloat(e.target.value))}
                        disabled={!serverStatus.running}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                    </div>
                    
                    <button 
                      className={`btn btn-primary ${(!serverStatus.running || isTesting) ? 'btn-disabled' : ''}`}
                      onClick={handleSendTestRequest}
                    >
                      {isTesting ? <RefreshCw size={16} style={{ animation: 'spin 1s infinite linear' }} /> : <Play size={16} />} 
                      {isTesting ? 'Generating Response...' : 'Send Test Inference'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-label">Play Playground Response</div>
                    <div className="playpen-output">
                      {testResult || (serverStatus.running ? 'Ready. Send a prompt to test model inference output.' : 'dashboard server is offline. Select profile and Deploy Server above to activate playground.')}
                    </div>

                    {testMetrics && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Latency</span>
                          <strong style={{ fontSize: '0.9rem' }}>{testMetrics.latency}ms</strong>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Prompt Tokens</span>
                          <strong style={{ fontSize: '0.9rem' }}>{testMetrics.promptTokens}</strong>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Comp Tokens</span>
                          <strong style={{ fontSize: '0.9rem' }}>{testMetrics.compTokens}</strong>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Speed</span>
                          <strong style={{ color: 'var(--color-secondary)', fontSize: '0.9rem' }}>{testMetrics.speed} t/s</strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== MODELS VIEW ==================== */}
          {activeTab === 'models' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Register Model Form */}
              <div className="card">
                <div className="card-title"><Database size={18} /> Register GGUF Model</div>
                <form onSubmit={handleRegisterModel} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Local GGUF File Path</label>
                    <div className="file-input-wrapper">
                      <input 
                        type="text" 
                        required 
                        className="input-field file-input-path"
                        placeholder="C:\path\to\model.gguf"
                        value={modelPath}
                        onChange={(e) => setModelPath(e.target.value)}
                      />
                      <button type="button" className="btn btn-secondary" onClick={handleBrowseGguf}>
                        <FolderOpen size={16} /> Browse
                      </button>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Display Name</label>
                      <input 
                        type="text" 
                        required 
                        className="input-field" 
                        placeholder="e.g. Llama-3-8B-Instruct"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tags (comma separated)</label>
                      <input 
                        type="text" 
                        className="input-field" 
                        placeholder="chat, code, instructions"
                        value={modelTags}
                        onChange={(e) => setModelTags(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="Add model description/details..."
                      value={modelDesc}
                      onChange={(e) => setModelDesc(e.target.value)}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                    <Plus size={16} /> Register Model
                  </button>
                </form>
              </div>

              {/* Models List */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="card-title"><Database size={18} /> Registered Models ({settings.models.length})</div>
                  <div className="file-input-wrapper" style={{ width: '250px' }}>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="Search models..."
                      style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="model-list">
                  {settings.models
                    .filter((m) => m.name.toLowerCase().includes(modelSearch.toLowerCase()))
                    .map((m) => (
                      <div className="model-item" key={m.id}>
                        <div className="model-info">
                          <div className="model-title-row">
                            <span className="model-name">{m.name}</span>
                            {m.tags.map((t) => (
                              <span key={t} className="badge badge-info"><Tag size={10} style={{ marginRight: '4px', verticalAlign: 'middle' }} />{t}</span>
                            ))}
                          </div>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{m.description || 'No description provided'}</span>
                          <div className="model-meta">
                            <span className="model-path">{m.path}</span>
                            {m.last_used && <span><strong>Last Used:</strong> {m.last_used}</span>}
                          </div>
                        </div>
                        <div className="model-actions">
                          <button className="btn btn-danger" style={{ padding: '8px' }} onClick={() => deleteModel(m.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  {settings.models.length === 0 && (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No models registered yet. Use the form above to register your GGUF model files.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== MONITORING / OBSERVABILITY ==================== */}
          {activeTab === 'monitor' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Aggregated Metrics Cards */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <span className="metric-label">Uptime</span>
                  <span className="metric-value" style={{ color: 'var(--color-success)' }}>
                    {serverStatus.running ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Prompt Tokens</span>
                  <span className="metric-value">
                    {metrics.reduce((acc, m) => acc + m.prompt_tokens, 0)}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Completion Tokens</span>
                  <span className="metric-value">
                    {metrics.reduce((acc, m) => acc + m.completion_tokens, 0)}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Average Latency</span>
                  <span className="metric-value" style={{ color: 'var(--color-secondary)' }}>
                    {metrics.length > 0
                      ? `${Math.round(metrics.reduce((acc, m) => acc + m.latency_ms, 0) / metrics.length)}ms`
                      : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Sleek SVG Chart of Recent Latencies */}
              {metrics.length > 1 && (
                <div className="card">
                  <div className="card-title"><Activity size={18} /> API Request Latency Trend (Last {metrics.length} requests)</div>
                  <div style={{ height: '150px', position: 'relative', marginTop: '10px' }}>
                    <svg viewBox="0 0 500 100" width="100%" height="100%" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {/* Latency line */}
                      {(() => {
                        const maxVal = Math.max(...metrics.map(m => m.latency_ms), 500);
                        const points = metrics.map((m, idx) => {
                          const x = (idx / (metrics.length - 1)) * 500;
                          const y = 90 - (m.latency_ms / maxVal) * 80;
                          return `${x},${y}`;
                        }).join(' ');
                        
                        const fillPoints = `0,90 ${points} 500,90`;
                        
                        return (
                          <>
                            <polyline points={points} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" />
                            <polygon points={fillPoints} fill="url(#chartGrad)" />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                </div>
              )}

              {/* Logs Dashboard Terminal */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="card-title"><Terminal size={18} /> llama-server Execution Terminal Stream</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select 
                      className="input-field" 
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value as any)}
                    >
                      <option value="all">All Logs</option>
                      <option value="stdout">Stdout Channel</option>
                      <option value="stderr">Stderr Channel</option>
                      <option value="system">AutoLLAMA System</option>
                    </select>
                    <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={clearLogs}>
                      Clear
                    </button>
                  </div>
                </div>

                <div className="terminal">
                  <div className="terminal-header">
                    <span>Active stream logs</span>
                    <span>Buffer: {filteredLogs.length} / 1000 lines</span>
                  </div>
                  {filteredLogs.map((log, index) => {
                    let logClass = 'stdout';
                    if (log.startsWith('[stderr]')) logClass = 'stderr';
                    if (log.startsWith('[AutoLLAMA]')) logClass = 'info';
                    if (log.startsWith('[Gateway]')) logClass = 'info';
                    if (log.includes('warning') || log.includes('WARN')) logClass = 'warn';
                    if (log.includes('error') || log.includes('ERR') || log.includes('FAIL')) logClass = 'error';

                    return (
                      <div key={index} className={`terminal-line ${logClass}`}>
                        {log}
                      </div>
                    );
                  })}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* ==================== GGUF CONVERSION VIEW ==================== */}
          {activeTab === 'convert' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Conversion Config Form */}
              <div className="card">
                <div className="card-title"><Cpu size={18} /> Hugging Face Remote GGUF Conversion Pipeline</div>
                
                <div className="form-group">
                  <label className="form-label">Hugging Face Model ID or Local Safetensors Folder</label>
                  <input 
                    type="text" 
                    required 
                    className="input-field" 
                    placeholder="e.g. HuggingFaceTB/SmolLM2-135M-Instruct"
                    value={convHfId}
                    onChange={(e) => {
                      setConvHfId(e.target.value);
                      const name = e.target.value.split('/').pop() || '';
                      setConvOutputName(`${name.toLowerCase()}-${convQuant}`);
                    }}
                    disabled={isConverting}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Quantization / Output Format</label>
                    <select 
                      className="input-field select-field" 
                      value={convQuant}
                      onChange={(e) => {
                        setConvQuant(e.target.value);
                        const name = convHfId.split('/').pop() || '';
                        setConvOutputName(`${name.toLowerCase()}-${e.target.value}`);
                      }}
                      disabled={isConverting}
                    >
                      <option value="q8_0">Q8_0 (8-bit Quantized - Recommended)</option>
                      <option value="f16">F16 (Float16 - High Precision)</option>
                      <option value="bf16">BF16 (Bfloat16 - Ampere/CUDA Optimized)</option>
                      <option value="f32">F32 (Float32 - Unquantized)</option>
                      <option value="auto">Auto (Match original HF type)</option>
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">Output GGUF File Name</label>
                    <input 
                      type="text" 
                      required 
                      className="input-field" 
                      placeholder="smollm2-135m-q8_0"
                      value={convOutputName}
                      onChange={(e) => setConvOutputName(e.target.value)}
                      disabled={isConverting}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Local Destination Directory</label>
                  <div className="file-input-wrapper">
                    <input 
                      type="text" 
                      required 
                      className="input-field file-input-path"
                      placeholder="C:\Users\...\workspace\python\AUTOLLAMA\llama.cpp\models"
                      value={convOutputDir}
                      onChange={(e) => setConvOutputDir(e.target.value)}
                      disabled={isConverting}
                    />
                    <button type="button" className="btn btn-secondary" onClick={async () => {
                      const dir = await browseFolder('Select GGUF output directory');
                      if (dir) setConvOutputDir(dir);
                    }} disabled={isConverting}>
                      <FolderOpen size={16} /> Browse
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    className={`btn btn-primary ${isConverting ? 'btn-disabled' : ''}`}
                    onClick={() => runConversion(convHfId, convQuant, convOutputDir, convOutputName)}
                    disabled={isConverting}
                  >
                    {isConverting ? <RefreshCw size={16} style={{ animation: 'spin 1s infinite linear' }} /> : <Cpu size={16} />}
                    {isConverting ? 'Running Conversion scripts...' : 'Execute Conversion Pipeline'}
                  </button>
                  {conversionLogs.length > 0 && (
                    <button className="btn btn-secondary" onClick={clearConversionLogs} disabled={isConverting}>
                      Clear Logs
                    </button>
                  )}
                </div>
              </div>

              {/* Conversion Logs Terminal */}
              {(conversionLogs.length > 0 || isConverting) && (
                <div className="card">
                  <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>Pipeline Terminal Console</span>
                    {conversionSuccess === true && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem', marginLeft: 'auto' }}>SUCCESS - GGUF Registered!</span>}
                    {conversionSuccess === false && <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginLeft: 'auto' }}>FAILED - Check script logs</span>}
                  </div>
                  
                  <div className="terminal" style={{ height: '300px', borderLeftColor: 'var(--color-secondary)' }}>
                    {conversionLogs.map((log, index) => (
                      <div key={index} className="terminal-line" style={{ color: log.startsWith('[Error]') ? '#f87171' : log.startsWith('[Warning') ? '#fde68a' : '#22d3ee' }}>
                        {log}
                      </div>
                    ))}
                    <div ref={convLogEndRef} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== SETTINGS VIEW ==================== */}
          {activeTab === 'settings' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="card">
                <div className="card-title"><SettingsIcon size={18} /> Global App Preferences</div>
                
                <div className="form-group">
                  <label className="form-label">llama-server.exe Executable Path</label>
                  <div className="file-input-wrapper">
                    <input 
                      type="text" 
                      className="input-field file-input-path"
                      placeholder="C:\path\to\llama-server.exe"
                      value={settings.preferences.llama_server_path}
                      onChange={(e) => {
                        const copy = { ...settings };
                        copy.preferences.llama_server_path = e.target.value;
                        saveSettings(copy);
                      }}
                    />
                    <button type="button" className="btn btn-secondary" onClick={async () => {
                      const path = await browseExecutable('Locate llama-server.exe');
                      if (path) {
                        const copy = { ...settings };
                        copy.preferences.llama_server_path = path;
                        saveSettings(copy);
                      }
                    }}>
                      <FolderOpen size={16} /> Locate Binary
                    </button>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Select the compiled binary matching your system (e.g. CPU or CUDA builds).
                  </span>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">OpenAI Proxy Gateway Port</label>
                    <input 
                      type="number" 
                      className="input-field"
                      min={1024}
                      max={65535}
                      value={settings.preferences.api_port}
                      onChange={(e) => {
                        const copy = { ...settings };
                        copy.preferences.api_port = parseInt(e.target.value) || 8000;
                        saveSettings(copy);
                      }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Host Binding</label>
                    <select 
                      className="input-field select-field"
                      value={settings.preferences.expose_externally ? 'external' : 'local'}
                      onChange={(e) => {
                        const copy = { ...settings };
                        copy.preferences.expose_externally = e.target.value === 'external';
                        saveSettings(copy);
                      }}
                    >
                      <option value="local">Local Host (127.0.0.1 - Secure)</option>
                      <option value="external">Expose to Local Network (0.0.0.0 - Warnings)</option>
                    </select>
                  </div>
                </div>

                {settings.preferences.expose_externally && (
                  <div className="card" style={{ borderLeft: '3px solid var(--color-warning)', background: 'rgba(245, 158, 11, 0.03)', padding: '12px', fontSize: '0.85rem' }}>
                    <div style={{ color: '#fbbf24', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertTriangle size={16} /> Security Warning
                    </div>
                    Exposing your server allows any machine on your Local Area Network to connect and execute prompts on your GPU. Ensure you trust your network.
                  </div>
                )}
              </div>

              {/* Troubleshooting Card */}
              <div className="card" style={{ borderLeft: '4px solid var(--color-warning)' }}>
                <div className="card-title" style={{ color: '#fbbf24' }}>
                  <AlertTriangle size={18} /> Troubleshooting & System Control Reset
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  If you encounter port conflicts (e.g. port already in use) or llama-server process issues, use the reset action below. This will force-kill any running llama-server processes on your system and reset the dashboard state.
                </p>
                <button 
                  className="btn btn-danger" 
                  style={{ alignSelf: 'flex-start', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                  onClick={async () => {
                    if (confirm("Are you sure you want to force terminate all llama-server processes on the system?")) {
                      await resetServerControl();
                    }
                  }}
                >
                  <RefreshCw size={16} /> Reset Server Control
                </button>
              </div>

              {/* Port Scanning Utilities */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <div className="card-title"><AlertTriangle size={18} /> Network Diagnostics & Port Availability</div>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', marginLeft: 'auto' }} onClick={scanPorts}>
                    <RefreshCw size={12} /> Scan Ports
                  </button>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
                  {[8000, 8080, 8001, 8081, 9000, 5000].map((port) => {
                    const isAvailable = portsStatus[port] !== false;
                    return (
                      <div 
                        key={port} 
                        style={{ 
                          padding: '10px', 
                          borderRadius: '8px', 
                          border: '1px solid var(--border-color)', 
                          background: 'rgba(255,255,255,0.01)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          alignItems: 'center'
                        }}
                      >
                        <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>Port {port}</span>
                        <span className={`badge ${isAvailable ? 'badge-success' : 'badge-warning'}`}>
                          {isAvailable ? 'Available' : 'In Use'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ==================== CREATE PROFILE MODAL ==================== */}
      {showNewProfileModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card glow-border" style={{ width: '500px', background: '#0a0d1a', border: '1px solid rgba(99,102,241,0.2)' }}>
            <div className="card-title">Create Deployment Profile</div>
            
            <form onSubmit={handleCreateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Profile Name</label>
                <input 
                  type="text" 
                  required 
                  className="input-field"
                  placeholder="e.g. Chat - 4K Context"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Select Model</label>
                <select 
                  className="input-field select-field"
                  required
                  value={newProfileModelId}
                  onChange={(e) => setNewProfileModelId(e.target.value)}
                >
                  <option value="">Select GGUF model...</option>
                  {settings.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label">Server Port</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input 
                        type="checkbox"
                        checked={newProfileAutoPort}
                        onChange={(e) => setNewProfileAutoPort(e.target.checked)}
                        style={{ accentColor: 'var(--color-primary)' }}
                      />
                      Auto-assign if busy
                    </label>
                  </div>
                  <input 
                    type="number" 
                    required={!newProfileAutoPort}
                    disabled={newProfileAutoPort}
                    className="input-field"
                    placeholder={newProfileAutoPort ? "Auto-allocated" : "e.g. 8080"}
                    value={newProfileAutoPort ? '' : newProfilePort}
                    onChange={(e) => setNewProfilePort(parseInt(e.target.value) || 8080)}
                  />
                </div>
                
                <div className="form-group">
                  <label className="form-label">Context Size</label>
                  <input 
                    type="number" 
                    required 
                    className="input-field"
                    value={newProfileCtx}
                    onChange={(e) => setNewProfileCtx(parseInt(e.target.value) || 2048)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">GPU Layers offload</label>
                  <input 
                    type="number" 
                    required 
                    className="input-field"
                    value={newProfileGpu}
                    onChange={(e) => setNewProfileGpu(parseInt(e.target.value) || 0)}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>-1 for all (GPU only), 0 for CPU.</span>
                </div>
                
                <div className="form-group">
                  <label className="form-label">CPU Thread count</label>
                  <input 
                    type="number" 
                    required 
                    className="input-field"
                    value={newProfileThreads}
                    onChange={(e) => setNewProfileThreads(parseInt(e.target.value) || 4)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Additional llama-server arguments</label>
                <input 
                  type="text" 
                  className="input-field"
                  placeholder="e.g. --embedding --temp 0.8"
                  value={newProfileArgs}
                  onChange={(e) => setNewProfileArgs(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewProfileModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
