/**
 * Electron Preload Script
 * 
 * Exposes a secure API to the renderer process
 * 
 * === PHASE 3: SYSTEM INTEGRATION ===
 * Added jarvisHost API for direct OS control:
 * - Launch applications
 * - Lock/Sleep/Shutdown
 * - Volume control
 * - Execute commands
 * - File system access
 */

const { contextBridge, ipcRenderer } = require('electron');

// =============================================================================
// JARVIS SERVER API (Existing)
// =============================================================================
contextBridge.exposeInMainWorld('jarvis', {
  // Server management
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Listen for events from main process
  onVoiceActivate: (callback) => {
    ipcRenderer.on('voice-activate', callback);
    return () => ipcRenderer.removeListener('voice-activate', callback);
  },
  
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', callback);
    return () => ipcRenderer.removeListener('open-settings', callback);
  },
  
  // Platform info
  platform: process.platform,
  isElectron: true,
});

// =============================================================================
// JARVIS HOST API (Phase 3: System Control)
// =============================================================================
contextBridge.exposeInMainWorld('jarvisHost', {
  // --- SYSTEM COMMANDS ---
  // Execute arbitrary shell command (use with caution!)
  exec: (command) => ipcRenderer.invoke('system:exec', command),
  
  // --- APPLICATION CONTROL ---
  launchApp: (appName) => ipcRenderer.invoke('system:launch-app', appName),
  closeApp: (appName) => ipcRenderer.invoke('system:close-app', appName),
  getActiveWindow: () => ipcRenderer.invoke('system:get-active-window'),
  getRunningApps: () => ipcRenderer.invoke('system:get-running-apps'),
  
  // --- MEDIA CONTROL ---
  setVolume: (level) => ipcRenderer.invoke('system:set-volume', level),
  getVolume: () => ipcRenderer.invoke('system:get-volume'),
  mute: () => ipcRenderer.invoke('system:mute'),
  unmute: () => ipcRenderer.invoke('system:unmute'),
  playPause: () => ipcRenderer.invoke('system:media-play-pause'),
  nextTrack: () => ipcRenderer.invoke('system:media-next'),
  prevTrack: () => ipcRenderer.invoke('system:media-prev'),
  
  // --- POWER MANAGEMENT ---
  shutdown: () => ipcRenderer.invoke('system:shutdown'),
  restart: () => ipcRenderer.invoke('system:restart'),
  lock: () => ipcRenderer.invoke('system:lock'),
  sleep: () => ipcRenderer.invoke('system:sleep'),
  
  // --- DISPLAY CONTROL ---
  setBrightness: (level) => ipcRenderer.invoke('system:set-brightness', level),
  getBrightness: () => ipcRenderer.invoke('system:get-brightness'),
  
  // --- HARDWARE INFO ---
  getBattery: () => ipcRenderer.invoke('system:get-battery'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  getCpuUsage: () => ipcRenderer.invoke('system:get-cpu'),
  getMemoryUsage: () => ipcRenderer.invoke('system:get-memory'),
  
  // --- CLIPBOARD ---
  copyToClipboard: (text) => ipcRenderer.invoke('system:clipboard-write', text),
  readClipboard: () => ipcRenderer.invoke('system:clipboard-read'),
  
  // --- FILE SYSTEM ---
  openFile: (filePath) => ipcRenderer.invoke('system:open-file', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('system:open-folder', folderPath),
  
  // --- NOTIFICATIONS ---
  showSystemNotification: (title, body, icon) => 
    ipcRenderer.invoke('system:notification', { title, body, icon }),
  
  // --- PHASE 4: NETWORK DISCOVERY ---
  scanNetwork: () => ipcRenderer.invoke('system:scan-network'),
  probeDevice: (ip) => ipcRenderer.invoke('system:probe-device', ip),
  getNetworkInfo: () => ipcRenderer.invoke('system:get-network-info'),
});

// Expose API URL
contextBridge.exposeInMainWorld('JARVIS_API_URL', 'http://localhost:3001');
