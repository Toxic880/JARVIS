import { SystemTimer, SmartDevice } from '../types';

/**
 * HARDWARE ABSTRACTION LAYER
 * Separates "Real" Browser APIs from "Simulated" World Logic.
 * 
 * === PHASE 3: SYSTEM INTEGRATION ===
 * Added jarvisHost interface for Electron system control:
 * - Application launching/closing
 * - Power management (lock, sleep, shutdown)
 * - Volume/media control
 * - System info (battery, CPU, memory)
 * - Clipboard access
 */

// =============================================================================
// TYPE DEFINITIONS FOR ELECTRON HOST
// =============================================================================

declare global {
  interface Window {
    jarvisHost?: {
      // System commands
      exec: (cmd: string) => Promise<{ success: boolean; output?: string; error?: string }>;
      
      // Application control
      launchApp: (name: string) => Promise<{ success: boolean; app?: string; error?: string }>;
      closeApp: (name: string) => Promise<{ success: boolean; error?: string }>;
      getActiveWindow: () => Promise<{ title?: string; app?: string }>;
      getRunningApps: () => Promise<string[]>;
      
      // Media control
      setVolume: (level: number) => Promise<{ success: boolean; level?: number }>;
      getVolume: () => Promise<{ level: number }>;
      mute: () => Promise<{ success: boolean }>;
      unmute: () => Promise<{ success: boolean }>;
      playPause: () => Promise<{ success: boolean }>;
      nextTrack: () => Promise<{ success: boolean }>;
      prevTrack: () => Promise<{ success: boolean }>;
      
      // Power management
      shutdown: () => Promise<{ success: boolean; message?: string }>;
      restart: () => Promise<{ success: boolean; message?: string }>;
      lock: () => Promise<{ success: boolean }>;
      sleep: () => Promise<{ success: boolean }>;
      
      // Display
      setBrightness: (level: number) => Promise<{ success: boolean; level?: number }>;
      getBrightness: () => Promise<{ level: number }>;
      
      // Hardware info
      getBattery: () => Promise<{ level: number; charging: boolean; hasBattery: boolean }>;
      getSystemInfo: () => Promise<SystemInfo>;
      getCpuUsage: () => Promise<CpuInfo>;
      getMemoryUsage: () => Promise<MemoryInfo>;
      
      // Clipboard
      copyToClipboard: (text: string) => Promise<{ success: boolean }>;
      readClipboard: () => Promise<{ text: string }>;
      
      // File system
      openFile: (path: string) => Promise<{ success: boolean; error?: string }>;
      openFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
      
      // Notifications
      showSystemNotification: (title: string, body: string, icon?: string) => Promise<{ success: boolean }>;
      
      // Phase 4: Network Discovery
      scanNetwork: () => Promise<DiscoveredDevice[]>;
      probeDevice: (ip: string) => Promise<{ port: number; service: string; open: boolean }[]>;
      getNetworkInfo: () => Promise<NetworkInterface[]>;
    };
    
    jarvis?: {
      getServerStatus: () => Promise<{ running: boolean; port: number }>;
      restartServer: () => Promise<boolean>;
      getAppInfo: () => Promise<{ version: string; platform: string; isDev: boolean }>;
      showNotification: (title: string, body: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onVoiceActivate: (callback: () => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      platform: string;
      isElectron: boolean;
    };
  }
}

interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  username: string;
  homedir: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
}

interface CpuInfo {
  cores: number;
  model: string;
  speed: number;
  loadAverage: number;
  usage: number;
}

interface MemoryInfo {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

// Phase 4: Network Discovery Types
interface DiscoveredDevice {
  ip: string;
  port?: number;
  type: string;
  name: string;
  manufacturer?: string;
  model?: string;
  location?: string;
  server?: string;
  st?: string;
  discoveredAt?: number;
}

interface NetworkInterface {
  interface: string;
  ip: string;
  netmask: string;
  mac: string;
}

// =============================================================================
// 1. REAL: Things the Browser CAN actually do
// =============================================================================

export class BrowserHardware {
  
  // --- EXISTING BROWSER APIS ---
  
  static async getBatteryLevel(): Promise<number> {
    // First try Electron API for accurate battery info
    if (window.jarvisHost) {
      const battery = await window.jarvisHost.getBattery();
      return battery.level;
    }
    
    // Fallback to browser API
    if ('getBattery' in navigator) {
      const battery: any = await (navigator as any).getBattery();
      return Math.floor(battery.level * 100);
    }
    return 100;
  }

  static isOnline(): boolean {
    return navigator.onLine;
  }

  static async getLocation(): Promise<{lat: number, lng: number} | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null)
      );
    });
  }

  static async enableWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        await (navigator as any).wakeLock.request('screen');
        console.log("Wake Lock active");
      }
    } catch (err) {
      console.warn("Wake Lock failed", err);
    }
  }

  static speak(text: string) {
    // Fallback if Gemini TTS isn't used (Local Synthesis)
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
  
  // --- PHASE 3: SYSTEM CONTROL (Electron Only) ---
  
  /**
   * Check if running in Electron with system access
   */
  static isElectron(): boolean {
    return !!window.jarvisHost;
  }
  
  /**
   * Launch an application by name
   * Maps common names to platform-specific executables
   */
  static async launchApp(appName: string): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      console.warn('[System] Cannot launch app - not running in Electron');
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log(`[System] Launching ${appName}...`);
    const result = await window.jarvisHost.launchApp(appName);
    
    if (result.success) {
      return { success: true, message: `Launching ${appName}` };
    } else {
      return { success: false, message: result.error || 'Failed to launch app' };
    }
  }
  
  /**
   * Close a running application
   */
  static async closeApp(appName: string): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log(`[System] Closing ${appName}...`);
    const result = await window.jarvisHost.closeApp(appName);
    return { 
      success: result.success, 
      message: result.success ? `Closed ${appName}` : (result.error || 'Failed to close app')
    };
  }
  
  /**
   * Lock the workstation
   */
  static async lockScreen(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log('[System] Locking workstation...');
    await window.jarvisHost.lock();
    return { success: true, message: 'Workstation locked' };
  }
  
  /**
   * Put the system to sleep
   */
  static async sleepSystem(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log('[System] Entering sleep mode...');
    await window.jarvisHost.sleep();
    return { success: true, message: 'Entering sleep mode' };
  }
  
  /**
   * Shutdown the system (with 60 second delay for safety)
   */
  static async shutdownSystem(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log('[System] Initiating shutdown...');
    const result = await window.jarvisHost.shutdown();
    return { success: true, message: result.message || 'Shutdown scheduled' };
  }
  
  /**
   * Restart the system (with 60 second delay for safety)
   */
  static async restartSystem(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    console.log('[System] Initiating restart...');
    const result = await window.jarvisHost.restart();
    return { success: true, message: result.message || 'Restart scheduled' };
  }
  
  /**
   * Set system volume (0-100)
   */
  static async setSystemVolume(level: number): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    const vol = Math.max(0, Math.min(100, level));
    console.log(`[System] Setting volume to ${vol}%`);
    await window.jarvisHost.setVolume(vol);
    return { success: true, message: `Volume set to ${vol}%` };
  }
  
  /**
   * Mute system audio
   */
  static async muteAudio(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    await window.jarvisHost.mute();
    return { success: true, message: 'Audio muted' };
  }
  
  /**
   * Unmute system audio
   */
  static async unmuteAudio(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    await window.jarvisHost.unmute();
    return { success: true, message: 'Audio unmuted' };
  }
  
  /**
   * Media play/pause
   */
  static async mediaPlayPause(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    await window.jarvisHost.playPause();
    return { success: true, message: 'Media toggled' };
  }
  
  /**
   * Skip to next track
   */
  static async mediaNext(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    await window.jarvisHost.nextTrack();
    return { success: true, message: 'Skipped to next track' };
  }
  
  /**
   * Skip to previous track
   */
  static async mediaPrevious(): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    await window.jarvisHost.prevTrack();
    return { success: true, message: 'Skipped to previous track' };
  }
  
  /**
   * Get detailed system information
   */
  static async getSystemInfo(): Promise<SystemInfo | null> {
    if (!window.jarvisHost) {
      return null;
    }
    return window.jarvisHost.getSystemInfo();
  }
  
  /**
   * Get CPU usage information
   */
  static async getCpuUsage(): Promise<CpuInfo | null> {
    if (!window.jarvisHost) {
      return null;
    }
    return window.jarvisHost.getCpuUsage();
  }
  
  /**
   * Get memory usage information
   */
  static async getMemoryUsage(): Promise<MemoryInfo | null> {
    if (!window.jarvisHost) {
      return null;
    }
    return window.jarvisHost.getMemoryUsage();
  }
  
  /**
   * Copy text to system clipboard
   */
  static async copyToClipboard(text: string): Promise<{ success: boolean; message: string }> {
    // Try Electron first, then browser API
    if (window.jarvisHost) {
      await window.jarvisHost.copyToClipboard(text);
      return { success: true, message: 'Copied to clipboard' };
    }
    
    // Browser fallback
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, message: 'Copied to clipboard' };
    } catch {
      return { success: false, message: 'Clipboard access denied' };
    }
  }
  
  /**
   * Read from system clipboard
   */
  static async readClipboard(): Promise<string | null> {
    if (window.jarvisHost) {
      const result = await window.jarvisHost.readClipboard();
      return result.text;
    }
    
    // Browser fallback
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
  
  /**
   * Open a file with the default application
   */
  static async openFile(filePath: string): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    const result = await window.jarvisHost.openFile(filePath);
    return { 
      success: result.success, 
      message: result.success ? `Opened ${filePath}` : (result.error || 'Failed to open file')
    };
  }
  
  /**
   * Open folder in file explorer
   */
  static async openFolder(folderPath: string): Promise<{ success: boolean; message: string }> {
    if (!window.jarvisHost) {
      return { success: false, message: 'Not running in desktop mode' };
    }
    
    const result = await window.jarvisHost.openFolder(folderPath);
    return { 
      success: result.success, 
      message: result.success ? `Opened ${folderPath}` : (result.error || 'Failed to open folder')
    };
  }
  
  /**
   * Execute a shell command (use with extreme caution!)
   */
  static async executeCommand(command: string): Promise<{ success: boolean; output: string }> {
    if (!window.jarvisHost) {
      return { success: false, output: 'Not running in desktop mode' };
    }
    
    console.log(`[System] Executing: ${command}`);
    const result = await window.jarvisHost.exec(command);
    return { 
      success: result.success, 
      output: result.output || result.error || '' 
    };
  }
  
  // =========================================================================
  // PHASE 4: NETWORK DISCOVERY
  // =========================================================================
  
  /**
   * Scan local network for smart devices using SSDP
   * Finds: Philips Hue, Sonos, Chromecast, WeMo, Home Assistant, etc.
   */
  static async scanNetwork(): Promise<DiscoveredDevice[]> {
    if (!window.jarvisHost?.scanNetwork) {
      console.warn('[Network] Scan not available - not running in Electron');
      return [];
    }
    
    console.log('[Network] Starting SSDP discovery scan...');
    const devices = await window.jarvisHost.scanNetwork();
    console.log(`[Network] Found ${devices.length} devices`);
    return devices;
  }
  
  /**
   * Probe a specific IP address for common smart home ports
   */
  static async probeDevice(ip: string): Promise<{ port: number; service: string; open: boolean }[]> {
    if (!window.jarvisHost?.probeDevice) {
      return [];
    }
    
    console.log(`[Network] Probing ${ip}...`);
    return window.jarvisHost.probeDevice(ip);
  }
  
  /**
   * Get information about local network interfaces
   */
  static async getNetworkInfo(): Promise<NetworkInterface[]> {
    if (!window.jarvisHost?.getNetworkInfo) {
      return [];
    }
    
    return window.jarvisHost.getNetworkInfo();
  }
  
  /**
   * Check if a device is likely a specific type based on open ports
   */
  static identifyDeviceType(openPorts: { port: number; service: string }[]): string {
    const ports = openPorts.map(p => p.port);
    
    if (ports.includes(8123)) return 'hub'; // Home Assistant
    if (ports.includes(1400)) return 'speaker'; // Sonos
    if (ports.includes(8008)) return 'media'; // Chromecast
    if (ports.includes(9197)) return 'light'; // Hue Bridge
    if (ports.includes(55443)) return 'light'; // Yeelight
    if (ports.includes(80) || ports.includes(443)) return 'network';
    
    return 'unknown';
  }
}

// =============================================================================
// 2. REAL APIs: External Services
// =============================================================================

export class RealExternalAPIs {
  
  static async fetchWeather(lat: number, lng: number, unit: 'celsius' | 'fahrenheit'): Promise<{temp: number, condition: string, wind: number, humidity: number, feelsLike?: number}> {
      try {
          const u = unit === 'fahrenheit' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
          const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature${u}`);
          const data = await res.json();
          
          // Map WMO codes to text
          const code = data.current.weather_code;
          let cond = 'Clear';
          if (code > 0 && code < 4) cond = 'Cloudy';
          if (code >= 45 && code < 50) cond = 'Fog';
          if (code >= 51 && code < 70) cond = 'Rain';
          if (code >= 71) cond = 'Snow';
          if (code >= 95) cond = 'Thunderstorm';

          return {
              temp: data.current.temperature_2m,
              condition: cond,
              humidity: data.current.relative_humidity_2m,
              wind: data.current.wind_speed_10m,
              feelsLike: data.current.apparent_temperature,
          };
      } catch (e) {
          console.error("Weather fetch failed", e);
          return { temp: 0, condition: 'Data Error', humidity: 0, wind: 0 };
      }
  }

  static async sendWebhook(url: string, payload: any, token?: string): Promise<boolean> {
      try {
          const headers: any = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          
          await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload)
          });
          return true;
      } catch (e) {
          console.error("Webhook failed", e);
          return false;
      }
  }
}

// =============================================================================
// 3. MIXED: Logic that manages state
// =============================================================================

export class DeviceManager {
  private timerWorker: Worker | null = null;
  private callbacks: Map<string, () => void> = new Map();

  constructor() {
      this.initWorker();
  }

  private initWorker() {
      // Create a Blob worker to run timers off the main thread
      // This prevents Chrome from throttling the timer when the tab is backgrounded
      const blob = new Blob([`
          let timers = {};
          self.onmessage = function(e) {
              const { type, id, duration } = e.data;
              if (type === 'START') {
                  timers[id] = setTimeout(() => {
                      self.postMessage({ type: 'DONE', id });
                      delete timers[id];
                  }, duration * 1000);
              } else if (type === 'CANCEL') {
                  if (timers[id]) {
                      clearTimeout(timers[id]);
                      delete timers[id];
                  }
              }
          }
      `], { type: 'application/javascript' });
      
      this.timerWorker = new Worker(URL.createObjectURL(blob));
      this.timerWorker.onmessage = (e) => {
          if (e.data.type === 'DONE') {
              const cb = this.callbacks.get(e.data.id);
              if (cb) {
                  cb();
                  this.callbacks.delete(e.data.id);
              }
          }
      };
  }

  createTimer(durationSec: number, callback: () => void): string {
    const id = crypto.randomUUID();
    this.callbacks.set(id, callback);
    this.timerWorker?.postMessage({ type: 'START', id, duration: durationSec });
    return id;
  }

  cancelTimer(id: string) {
    this.timerWorker?.postMessage({ type: 'CANCEL', id });
    this.callbacks.delete(id);
  }
}