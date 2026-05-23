import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// --- Type Definitions ---

export interface ModelEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  description: string;
  tags: string[];
  last_used?: string | null;
}

export interface ServerProfile {
  id: string;
  name: string;
  model_id: string;
  port: number;
  auto_port: boolean;
  ctx_size: number;
  batch_size: number;
  threads: number;
  gpu_layers: number;
  additional_args: string;
}

export interface AppPreferences {
  llama_server_path: string;
  api_port: number;
  default_profile_id?: string | null;
  expose_externally: boolean;
}

export interface Settings {
  models: ModelEntry[];
  profiles: ServerProfile[];
  preferences: AppPreferences;
}

export interface ServerStatus {
  running: boolean;
  profile_id?: string | null;
  model_path?: string | null;
  port?: number | null;
  error?: string | null;
}

export interface ApiMetric {
  id: string;
  timestamp: string;
  endpoint: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  error?: string | null;
}

interface DashboardState {
  // Config state
  settings: Settings;
  activeTab: 'models' | 'server' | 'monitor' | 'convert' | 'settings' | 'inference';
  
  // Server state
  serverStatus: ServerStatus;
  logs: string[];
  metrics: ApiMetric[];
  
  // Port scanner state
  portsStatus: Record<number, boolean>;
  
  // GGUF Conversion state
  isConverting: boolean;
  conversionLogs: string[];
  conversionSuccess: boolean | null;

  // Actions
  setTab: (tab: DashboardState['activeTab']) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  
  // Model Management
  addModel: (model: Omit<ModelEntry, 'id'>) => Promise<void>;
  updateModel: (id: string, model: Partial<ModelEntry>) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  
  // Profile Management
  addProfile: (profile: Omit<ServerProfile, 'id'>) => Promise<void>;
  updateProfile: (id: string, profile: Partial<ServerProfile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  
  // Process Lifecycle
  checkServerStatus: () => Promise<ServerStatus>;
  startServer: (profileId: string) => Promise<void>;
  stopServer: () => Promise<void>;
  resetServerControl: () => Promise<void>;
  scanPorts: () => Promise<Record<number, boolean>>;
  
  // GGUF Conversion Actions
  runConversion: (hfModel: string, quantization: string, outputDir: string, outputName: string) => Promise<void>;
  clearConversionLogs: () => void;
  
  // Logging & Metrics Actions
  loadLogs: () => Promise<void>;
  clearLogs: () => Promise<void>;
  loadMetrics: () => Promise<void>;
  clearMetrics: () => Promise<void>;

  // Dialog Wrappers
  browseGguf: () => Promise<string | null>;
  browseFolder: (title: string) => Promise<string | null>;
  browseExecutable: (title: string) => Promise<string | null>;
  
  // Initializer
  initListeners: () => Promise<() => void>;
}

// Helper to generate Uuid
const generateId = () => Math.random().toString(36).substring(2, 9);

export const useStore = create<DashboardState>((set, get) => ({
  // --- Initial State ---
  settings: {
    models: [],
    profiles: [],
    preferences: {
      llama_server_path: '',
      api_port: 8000,
      expose_externally: false,
    },
  },
  activeTab: 'server',
  serverStatus: { running: false },
  logs: [],
  metrics: [],
  portsStatus: {},
  isConverting: false,
  conversionLogs: [],
  conversionSuccess: null,

  // --- Tab Action ---
  setTab: (tab) => set({ activeTab: tab }),

  // --- Configuration ---
  loadSettings: async () => {
    try {
      const settings = await invoke<Settings>('get_settings');
      set({ settings });
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  },

  saveSettings: async (settings) => {
    try {
      await invoke('save_settings', { settings });
      set({ settings });
    } catch (e) {
      console.error('Failed to save settings', e);
      throw e;
    }
  },

  // --- Models ---
  addModel: async (modelData) => {
    const { settings } = get();
    const newModel: ModelEntry = {
      ...modelData,
      id: generateId(),
    };
    const updatedSettings = {
      ...settings,
      models: [...settings.models, newModel],
    };
    await get().saveSettings(updatedSettings);
  },

  updateModel: async (id, modelData) => {
    const { settings } = get();
    const updatedSettings = {
      ...settings,
      models: settings.models.map((m) => (m.id === id ? { ...m, ...modelData } : m)),
    };
    await get().saveSettings(updatedSettings);
  },

  deleteModel: async (id) => {
    const { settings } = get();
    const updatedSettings = {
      ...settings,
      models: settings.models.filter((m) => m.id !== id),
      // Clean profiles that reference this model
      profiles: settings.profiles.map((p) => {
        if (p.model_id === id) {
          return { ...p, model_id: '' };
        }
        return p;
      }),
    };
    await get().saveSettings(updatedSettings);
  },

  // --- Profiles ---
  addProfile: async (profileData) => {
    const { settings } = get();
    const newProfile: ServerProfile = {
      ...profileData,
      id: generateId(),
    };
    const updatedSettings = {
      ...settings,
      profiles: [...settings.profiles, newProfile],
    };
    await get().saveSettings(updatedSettings);
  },

  updateProfile: async (id, profileData) => {
    const { settings } = get();
    const updatedSettings = {
      ...settings,
      profiles: settings.profiles.map((p) => (p.id === id ? { ...p, ...profileData } : p)),
    };
    await get().saveSettings(updatedSettings);
  },

  deleteProfile: async (id) => {
    const { settings } = get();
    const updatedSettings = {
      ...settings,
      profiles: settings.profiles.filter((p) => p.id !== id),
    };
    await get().saveSettings(updatedSettings);
  },

  // --- Server Lifecycle ---
  checkServerStatus: async () => {
    try {
      const serverStatus = await invoke<ServerStatus>('get_server_status');
      set({ serverStatus });
      return serverStatus;
    } catch (e) {
      console.error('Failed to get server status', e);
      return { running: false, error: String(e) };
    }
  },

  startServer: async (profileId) => {
    try {
      set({ serverStatus: { ...get().serverStatus, running: false, error: 'Starting...' } });
      await invoke('start_server', { profileId });
      await get().checkServerStatus();
      await get().loadLogs();
      await get().loadSettings();
    } catch (e) {
      set({ serverStatus: { running: false, error: String(e) } });
      throw e;
    }
  },

  stopServer: async () => {
    try {
      await invoke('stop_server');
      await get().checkServerStatus();
    } catch (e) {
      console.error('Failed to stop server', e);
      throw e;
    }
  },

  resetServerControl: async () => {
    try {
      set({ serverStatus: { ...get().serverStatus, error: 'Resetting...' } });
      await invoke('reset_server_control');
      await get().checkServerStatus();
      await get().loadLogs();
      await get().scanPorts();
    } catch (e) {
      console.error('Failed to reset server control', e);
      set({ serverStatus: { ...get().serverStatus, error: String(e) } });
      throw e;
    }
  },

  scanPorts: async () => {
    try {
      const portsStatus = await invoke<Record<number, boolean>>('scan_ports');
      set({ portsStatus });
      return portsStatus;
    } catch (e) {
      console.error('Failed to scan ports', e);
      return {};
    }
  },

  // --- Conversion Action ---
  runConversion: async (hfModel, quantization, outputDir, outputName) => {
    set({ isConverting: true, conversionLogs: [], conversionSuccess: null });
    try {
      await invoke('run_conversion', { hfModel, quantization, outputDir, outputName });
    } catch (e) {
      set({ 
        isConverting: false, 
        conversionSuccess: false, 
        conversionLogs: [...get().conversionLogs, `[Error] ${e}`] 
      });
      throw e;
    }
  },

  clearConversionLogs: () => set({ conversionLogs: [], conversionSuccess: null }),

  // --- Logs and Metrics ---
  loadLogs: async () => {
    try {
      const logs = await invoke<string[]>('get_logs');
      set({ logs });
    } catch (e) {
      console.error('Failed to load logs', e);
    }
  },

  clearLogs: async () => {
    try {
      await invoke('clear_logs');
      set({ logs: [] });
    } catch (e) {
      console.error(e);
    }
  },

  loadMetrics: async () => {
    try {
      const metrics = await invoke<ApiMetric[]>('get_metrics');
      set({ metrics });
    } catch (e) {
      console.error('Failed to load metrics', e);
    }
  },

  clearMetrics: async () => {
    try {
      await invoke('clear_metrics');
      set({ metrics: [] });
    } catch (e) {
      console.error(e);
    }
  },

  // --- Dialogs ---
  browseGguf: async () => {
    try {
      return await invoke<string | null>('browse_file', { title: 'Select GGUF model file' });
    } catch (e) {
      console.error('File dialog error', e);
      return null;
    }
  },

  browseFolder: async (title) => {
    try {
      return await invoke<string | null>('browse_folder', { title });
    } catch (e) {
      console.error('Folder dialog error', e);
      return null;
    }
  },

  browseExecutable: async (title) => {
    try {
      return await invoke<string | null>('browse_executable', { title });
    } catch (e) {
      console.error('Executable dialog error', e);
      return null;
    }
  },

  // --- Listeners Setup ---
  initListeners: async () => {
    // Listen to log streaming
    const unlistenLogs = await listen<string>('server_log', (event) => {
      set((state) => {
        const nextLogs = [...state.logs, event.payload];
        if (nextLogs.length > 1000) {
          nextLogs.shift();
        }
        return { logs: nextLogs };
      });
    });

    // Listen to server status triggers
    const unlistenStatus = await listen('server_status_changed', () => {
      get().checkServerStatus();
      get().loadLogs();
      get().loadMetrics();
    });

    // Listen to conversion logs
    const unlistenConvLogs = await listen<string>('conversion_log', (event) => {
      set((state) => ({ conversionLogs: [...state.conversionLogs, event.payload] }));
    });

    // Listen to conversion completion triggers
    const unlistenConvStatus = await listen<boolean>('conversion_status', (event) => {
      set({ isConverting: false, conversionSuccess: event.payload });
      if (event.payload) {
        get().loadSettings();
      }
    });

    // Listen to model changes
    const unlistenModels = await listen('models_updated', () => {
      get().loadSettings();
    });

    // Return clean-up callback
    return () => {
      unlistenLogs();
      unlistenStatus();
      unlistenConvLogs();
      unlistenConvStatus();
      unlistenModels();
    };
  },
}));
