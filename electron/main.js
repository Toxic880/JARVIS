/**
 * JARVIS Electron Main Process
 * 
 * Creates a desktop application with:
 * - System tray integration
 * - Global hotkeys
 * - Auto-start on login
 * - Native notifications
 * - Background server management
 * 
 * === PHASE 3: SYSTEM INTEGRATION ===
 * Added "The Hands" - direct OS control:
 * - Launch/close applications
 * - Power management (lock, sleep, shutdown)
 * - Volume/media control
 * - System info (battery, CPU, memory)
 * - Clipboard access
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, Notification, shell, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// =============================================================================
// CONFIGURATION
// =============================================================================

const isDev = process.env.NODE_ENV === 'development';
const APP_NAME = 'JARVIS';
const SERVER_PORT = 3001;
const UI_PORT = isDev ? 5173 : 3001;

// =============================================================================
// GLOBAL STATE
// =============================================================================

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

// =============================================================================
// WINDOW MANAGEMENT
// =============================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: APP_NAME,
    icon: getIconPath(),
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show until ready
  });

  // Load the UI
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${UI_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Show welcome notification on first launch
    const firstLaunch = !fs.existsSync(getConfigPath());
    if (firstLaunch) {
      showNotification('Welcome to JARVIS', 'Press Ctrl+Shift+J to activate voice control');
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show tray notification on first minimize
      const hideNotified = store.get('hideNotified', false);
      if (!hideNotified) {
        showNotification('JARVIS is still running', 'Click the tray icon to open');
        store.set('hideNotified', true);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

// =============================================================================
// SYSTEM TRAY
// =============================================================================

function createTray() {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  
  // Resize for tray (16x16 on most systems)
  const trayIcon = icon.resize({ width: 16, height: 16 });
  
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  
  updateTrayMenu();
  
  // Double-click to show window
  tray.on('double-click', () => {
    showWindow();
  });
}

function updateTrayMenu(serverRunning = true) {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open JARVIS',
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: 'Voice Activation',
      accelerator: 'CmdOrCtrl+Shift+J',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('voice-activate');
      },
    },
    {
      label: 'Quick Command...',
      accelerator: 'CmdOrCtrl+Shift+K',
      click: showQuickCommand,
    },
    {
      type: 'separator',
    },
    {
      label: serverRunning ? '● Server Running' : '○ Server Stopped',
      enabled: false,
    },
    {
      label: serverRunning ? 'Restart Server' : 'Start Server',
      click: () => {
        stopServer();
        startServer();
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          openAsHidden: true,
        });
      },
    },
    {
      label: 'Settings',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('open-settings');
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit JARVIS',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  
  tray.setContextMenu(contextMenu);
}

// =============================================================================
// QUICK COMMAND (Mini command prompt)
// =============================================================================

let quickCommandWindow = null;

function showQuickCommand() {
  if (quickCommandWindow) {
    quickCommandWindow.focus();
    return;
  }
  
  quickCommandWindow = new BrowserWindow({
    width: 600,
    height: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  
  // Center on screen
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  quickCommandWindow.setPosition(
    Math.round((width - 600) / 2),
    Math.round(height / 4)
  );
  
  quickCommandWindow.loadFile(path.join(__dirname, 'quick-command.html'));
  
  quickCommandWindow.on('blur', () => {
    quickCommandWindow?.close();
  });
  
  quickCommandWindow.on('closed', () => {
    quickCommandWindow = null;
  });
}

// =============================================================================
// SERVER MANAGEMENT
// =============================================================================

function startServer() {
  if (serverProcess) {
    console.log('[Electron] Server already running');
    return;
  }
  
  const serverPath = isDev 
    ? path.join(__dirname, '../server')
    : path.join(process.resourcesPath, 'server');
  
  console.log('[Electron] Starting server from:', serverPath);
  
  // Check if we can run the server
  const serverEntry = path.join(serverPath, 'dist/index.js');
  if (!fs.existsSync(serverEntry)) {
    console.error('[Electron] Server entry not found:', serverEntry);
    showNotification('Server Error', 'Could not find server files');
    return;
  }
  
  serverProcess = spawn('node', [serverEntry], {
    cwd: serverPath,
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      PORT: SERVER_PORT.toString(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  
  serverProcess.stdout.on('data', (data) => {
    console.log('[Server]', data.toString().trim());
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error('[Server Error]', data.toString().trim());
  });
  
  serverProcess.on('close', (code) => {
    console.log('[Electron] Server exited with code:', code);
    serverProcess = null;
    updateTrayMenu(false);
  });
  
  serverProcess.on('error', (err) => {
    console.error('[Electron] Server error:', err);
    serverProcess = null;
    updateTrayMenu(false);
  });
  
  // Update tray after a moment to show running status
  setTimeout(() => {
    updateTrayMenu(serverProcess !== null);
  }, 2000);
}

function stopServer() {
  if (serverProcess) {
    console.log('[Electron] Stopping server...');
    serverProcess.kill();
    serverProcess = null;
    updateTrayMenu(false);
  }
}

// =============================================================================
// GLOBAL SHORTCUTS
// =============================================================================

function registerShortcuts() {
  // Voice activation
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    showWindow();
    mainWindow?.webContents.send('voice-activate');
  });
  
  // Quick command
  globalShortcut.register('CommandOrControl+Shift+K', () => {
    showQuickCommand();
  });
  
  // Toggle window
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    toggleWindow();
  });
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

function setupIPC() {
  // Get server status
  ipcMain.handle('get-server-status', () => {
    return {
      running: serverProcess !== null,
      port: SERVER_PORT,
    };
  });
  
  // Restart server
  ipcMain.handle('restart-server', () => {
    stopServer();
    startServer();
    return true;
  });
  
  // Get app info
  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      isDev,
    };
  });
  
  // Show notification
  ipcMain.handle('show-notification', (_, { title, body }) => {
    showNotification(title, body);
  });
  
  // Open external link
  ipcMain.handle('open-external', (_, url) => {
    shell.openExternal(url);
  });
  
  // =========================================================================
  // PHASE 3: SYSTEM CONTROL HANDLERS
  // =========================================================================
  
  // --- GENERIC COMMAND EXECUTION ---
  ipcMain.handle('system:exec', async (_, command) => {
    return new Promise((resolve) => {
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        resolve({ 
          success: !error, 
          output: stdout || stderr,
          error: error?.message 
        });
      });
    });
  });
  
  // --- APPLICATION CONTROL ---
  ipcMain.handle('system:launch-app', async (_, appName) => {
    const platform = os.platform();
    let cmd = '';
    
    // Normalize common app names
    const appMap = {
      'spotify': platform === 'win32' ? 'Spotify' : platform === 'darwin' ? 'Spotify' : 'spotify',
      'chrome': platform === 'win32' ? 'chrome' : platform === 'darwin' ? 'Google Chrome' : 'google-chrome',
      'firefox': platform === 'win32' ? 'firefox' : platform === 'darwin' ? 'Firefox' : 'firefox',
      'vscode': platform === 'win32' ? 'code' : platform === 'darwin' ? 'Visual Studio Code' : 'code',
      'terminal': platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'Terminal' : 'gnome-terminal',
      'explorer': platform === 'win32' ? 'explorer' : platform === 'darwin' ? 'Finder' : 'nautilus',
      'notepad': platform === 'win32' ? 'notepad' : platform === 'darwin' ? 'TextEdit' : 'gedit',
      'calculator': platform === 'win32' ? 'calc' : platform === 'darwin' ? 'Calculator' : 'gnome-calculator',
      'settings': platform === 'win32' ? 'ms-settings:' : platform === 'darwin' ? 'System Preferences' : 'gnome-control-center',
    };
    
    const resolvedApp = appMap[appName.toLowerCase()] || appName;
    
    try {
      if (platform === 'win32') {
        // Windows: try start command
        cmd = `start "" "${resolvedApp}"`;
      } else if (platform === 'darwin') {
        // macOS: use open -a
        cmd = `open -a "${resolvedApp}"`;
      } else {
        // Linux: try various methods
        cmd = `xdg-open "${resolvedApp}" || ${resolvedApp} &`;
      }
      
      exec(cmd);
      console.log(`[System] Launched: ${appName}`);
      return { success: true, app: appName };
    } catch (error) {
      console.error(`[System] Failed to launch ${appName}:`, error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('system:close-app', async (_, appName) => {
    const platform = os.platform();
    try {
      if (platform === 'win32') {
        exec(`taskkill /IM "${appName}.exe" /F`);
      } else if (platform === 'darwin') {
        exec(`osascript -e 'quit app "${appName}"'`);
      } else {
        exec(`pkill -f "${appName}"`);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('system:get-active-window', async () => {
    const platform = os.platform();
    try {
      if (platform === 'win32') {
        // Would need powershell or external tool
        return { title: 'Unknown', app: 'Unknown' };
      } else if (platform === 'darwin') {
        const result = execSync(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`);
        return { app: result.toString().trim() };
      } else {
        const result = execSync(`xdotool getactivewindow getwindowname`);
        return { title: result.toString().trim() };
      }
    } catch {
      return { title: 'Unknown', app: 'Unknown' };
    }
  });
  
  ipcMain.handle('system:get-running-apps', async () => {
    const platform = os.platform();
    try {
      if (platform === 'win32') {
        const result = execSync('tasklist /FO CSV /NH');
        const apps = result.toString().split('\n')
          .slice(0, 20)
          .map(line => line.split(',')[0]?.replace(/"/g, ''))
          .filter(Boolean);
        return apps;
      } else if (platform === 'darwin') {
        const result = execSync(`ps -eo comm | head -20`);
        return result.toString().split('\n').filter(Boolean);
      } else {
        const result = execSync(`ps -eo comm | head -20`);
        return result.toString().split('\n').filter(Boolean);
      }
    } catch {
      return [];
    }
  });
  
  // --- MEDIA CONTROL ---
  ipcMain.handle('system:set-volume', async (_, level) => {
    const platform = os.platform();
    const vol = Math.max(0, Math.min(100, level));
    
    try {
      if (platform === 'win32') {
        // Windows: Use PowerShell
        exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`, () => {
          // Workaround: set volume via nircmd if available, otherwise use powershell audio
          exec(`powershell -c "$vol = [math]::Round(${vol} * 65535 / 100); (Get-WmiObject -Query 'Select * from Win32_SoundDevice').SetVolume($vol)"`);
        });
      } else if (platform === 'darwin') {
        exec(`osascript -e 'set volume output volume ${vol}'`);
      } else {
        exec(`amixer set Master ${vol}%`);
      }
      return { success: true, level: vol };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('system:get-volume', async () => {
    const platform = os.platform();
    try {
      if (platform === 'darwin') {
        const result = execSync(`osascript -e 'output volume of (get volume settings)'`);
        return { level: parseInt(result.toString().trim()) };
      } else if (platform === 'linux') {
        const result = execSync(`amixer get Master | grep -oP '\\d+%' | head -1`);
        return { level: parseInt(result.toString()) };
      }
      return { level: 50 }; // Default fallback
    } catch {
      return { level: 50 };
    }
  });
  
  ipcMain.handle('system:mute', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`);
    } else if (platform === 'darwin') {
      exec(`osascript -e 'set volume with output muted'`);
    } else {
      exec(`amixer set Master mute`);
    }
    return { success: true };
  });
  
  ipcMain.handle('system:unmute', async () => {
    const platform = os.platform();
    if (platform === 'darwin') {
      exec(`osascript -e 'set volume without output muted'`);
    } else if (platform === 'linux') {
      exec(`amixer set Master unmute`);
    }
    return { success: true };
  });
  
  ipcMain.handle('system:media-play-pause', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"`);
    } else if (platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to key code 16 using command down'`);
    } else {
      exec(`dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.PlayPause`);
    }
    return { success: true };
  });
  
  ipcMain.handle('system:media-next', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"`);
    } else if (platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to key code 17 using command down'`);
    } else {
      exec(`dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Next`);
    }
    return { success: true };
  });
  
  ipcMain.handle('system:media-prev', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      exec(`powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"`);
    } else if (platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to key code 18 using command down'`);
    } else {
      exec(`dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.Previous`);
    }
    return { success: true };
  });
  
  // --- POWER MANAGEMENT ---
  ipcMain.handle('system:lock', async () => {
    const platform = os.platform();
    console.log('[System] Locking workstation...');
    
    if (platform === 'win32') {
      exec('rundll32.exe user32.dll,LockWorkStation');
    } else if (platform === 'darwin') {
      exec('pmset displaysleepnow');
    } else {
      exec('loginctl lock-session || gnome-screensaver-command -l');
    }
    return { success: true };
  });
  
  ipcMain.handle('system:sleep', async () => {
    const platform = os.platform();
    console.log('[System] Entering sleep mode...');
    
    if (platform === 'win32') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    } else if (platform === 'darwin') {
      exec('pmset sleepnow');
    } else {
      exec('systemctl suspend');
    }
    return { success: true };
  });
  
  ipcMain.handle('system:shutdown', async () => {
    const platform = os.platform();
    console.log('[System] Initiating shutdown...');
    
    if (platform === 'win32') {
      exec('shutdown /s /t 60 /c "JARVIS: System shutdown in 60 seconds"');
    } else if (platform === 'darwin') {
      exec('osascript -e \'tell app "System Events" to shut down\'');
    } else {
      exec('shutdown -h +1');
    }
    return { success: true, message: 'Shutdown scheduled in 60 seconds' };
  });
  
  ipcMain.handle('system:restart', async () => {
    const platform = os.platform();
    console.log('[System] Initiating restart...');
    
    if (platform === 'win32') {
      exec('shutdown /r /t 60 /c "JARVIS: System restart in 60 seconds"');
    } else if (platform === 'darwin') {
      exec('osascript -e \'tell app "System Events" to restart\'');
    } else {
      exec('shutdown -r +1');
    }
    return { success: true, message: 'Restart scheduled in 60 seconds' };
  });
  
  // --- DISPLAY CONTROL ---
  ipcMain.handle('system:set-brightness', async (_, level) => {
    const platform = os.platform();
    const brightness = Math.max(0, Math.min(100, level));
    
    try {
      if (platform === 'darwin') {
        exec(`osascript -e 'tell application "System Events" to set brightness to ${brightness / 100}'`);
      } else if (platform === 'linux') {
        exec(`xrandr --output $(xrandr | grep " connected" | cut -d" " -f1) --brightness ${brightness / 100}`);
      }
      // Windows requires external tools or WMI
      return { success: true, level: brightness };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('system:get-brightness', async () => {
    return { level: 100 }; // Placeholder - real impl needs platform-specific code
  });
  
  // --- HARDWARE INFO ---
  ipcMain.handle('system:get-battery', async () => {
    const platform = os.platform();
    try {
      if (platform === 'darwin') {
        const result = execSync(`pmset -g batt | grep -Eo '\\d+%'`);
        const level = parseInt(result.toString());
        const charging = execSync(`pmset -g batt`).toString().includes('AC Power');
        return { level, charging, hasBattery: true };
      } else if (platform === 'linux') {
        const level = parseInt(fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8'));
        const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim();
        return { level, charging: status === 'Charging', hasBattery: true };
      } else if (platform === 'win32') {
        const result = execSync('WMIC Path Win32_Battery Get EstimatedChargeRemaining');
        const level = parseInt(result.toString().match(/\d+/)?.[0] || '100');
        return { level, charging: false, hasBattery: true };
      }
    } catch {
      return { level: 100, charging: true, hasBattery: false };
    }
    return { level: 100, charging: true, hasBattery: false };
  });
  
  ipcMain.handle('system:get-info', async () => {
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      username: os.userInfo().username,
      homedir: os.homedir(),
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)), // GB
      freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)), // GB
      uptime: Math.round(os.uptime() / 3600), // Hours
    };
  });
  
  ipcMain.handle('system:get-cpu', async () => {
    const cpus = os.cpus();
    const avgLoad = os.loadavg()[0]; // 1 minute load average
    return {
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      speed: cpus[0]?.speed || 0,
      loadAverage: avgLoad,
      usage: Math.min(100, Math.round((avgLoad / cpus.length) * 100)),
    };
  });
  
  ipcMain.handle('system:get-memory', async () => {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total: Math.round(total / (1024 * 1024 * 1024)),
      free: Math.round(free / (1024 * 1024 * 1024)),
      used: Math.round(used / (1024 * 1024 * 1024)),
      usagePercent: Math.round((used / total) * 100),
    };
  });
  
  // --- CLIPBOARD ---
  ipcMain.handle('system:clipboard-write', async (_, text) => {
    clipboard.writeText(text);
    return { success: true };
  });
  
  ipcMain.handle('system:clipboard-read', async () => {
    return { text: clipboard.readText() };
  });
  
  // --- FILE SYSTEM ---
  ipcMain.handle('system:open-file', async (_, filePath) => {
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('system:open-folder', async (_, folderPath) => {
    try {
      shell.showItemInFolder(folderPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // --- NOTIFICATIONS ---
  ipcMain.handle('system:notification', async (_, { title, body, icon }) => {
    showNotification(title, body);
    return { success: true };
  });
  
  // =========================================================================
  // PHASE 4: NETWORK AUTO-DISCOVERY (SSDP/mDNS)
  // =========================================================================
  
  const dgram = require('dgram');
  
  /**
   * Scan local network for smart devices using SSDP (Simple Service Discovery Protocol)
   * Finds: Philips Hue, Sonos, Chromecast, WeMo, Home Assistant, and other UPnP devices
   */
  ipcMain.handle('system:scan-network', async () => {
    return new Promise((resolve) => {
      const devices = [];
      const seenIPs = new Set();
      
      try {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        
        // SSDP M-SEARCH message - discovers all UPnP/SSDP devices
        const SSDP_SEARCH = 
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 3\r\n' +
          'ST: ssdp:all\r\n' +
          '\r\n';

        socket.on('message', (msg, rinfo) => {
          // Skip if we've already seen this IP
          if (seenIPs.has(rinfo.address)) return;
          seenIPs.add(rinfo.address);
          
          const response = msg.toString();
          
          // Parse HTTP-style headers
          const headers = {};
          response.split('\r\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.substring(0, colonIndex).toUpperCase().trim();
              const value = line.substring(colonIndex + 1).trim();
              headers[key] = value;
            }
          });

          // Identify device type based on response content
          let type = 'unknown';
          let name = 'Network Device';
          let manufacturer = '';
          let model = '';
          
          const responseUpper = response.toUpperCase();
          const server = headers['SERVER'] || '';
          const location = headers['LOCATION'] || '';
          const st = headers['ST'] || '';
          
          // Philips Hue
          if (responseUpper.includes('HUE') || responseUpper.includes('PHILIPS')) {
            type = 'light';
            name = 'Philips Hue Bridge';
            manufacturer = 'Philips';
          }
          // Sonos
          else if (responseUpper.includes('SONOS')) {
            type = 'speaker';
            name = 'Sonos Speaker';
            manufacturer = 'Sonos';
          }
          // Google Chromecast
          else if (responseUpper.includes('CHROMECAST') || responseUpper.includes('GOOGLE')) {
            type = 'media';
            name = 'Google Chromecast';
            manufacturer = 'Google';
          }
          // Home Assistant
          else if (responseUpper.includes('HOMEASSISTANT') || responseUpper.includes('HOME-ASSISTANT')) {
            type = 'hub';
            name = 'Home Assistant';
            manufacturer = 'Home Assistant';
          }
          // Belkin WeMo
          else if (responseUpper.includes('WEMO') || responseUpper.includes('BELKIN')) {
            type = 'switch';
            name = 'Belkin WeMo';
            manufacturer = 'Belkin';
          }
          // Samsung SmartThings
          else if (responseUpper.includes('SMARTTHINGS') || responseUpper.includes('SAMSUNG')) {
            type = 'hub';
            name = 'Samsung SmartThings';
            manufacturer = 'Samsung';
          }
          // Amazon Echo
          else if (responseUpper.includes('AMAZON') || responseUpper.includes('ECHO')) {
            type = 'speaker';
            name = 'Amazon Echo';
            manufacturer = 'Amazon';
          }
          // Roku
          else if (responseUpper.includes('ROKU')) {
            type = 'media';
            name = 'Roku';
            manufacturer = 'Roku';
          }
          // LIFX
          else if (responseUpper.includes('LIFX')) {
            type = 'light';
            name = 'LIFX Light';
            manufacturer = 'LIFX';
          }
          // TP-Link / Kasa
          else if (responseUpper.includes('TP-LINK') || responseUpper.includes('KASA')) {
            type = 'switch';
            name = 'TP-Link Smart Device';
            manufacturer = 'TP-Link';
          }
          // NVIDIA Shield
          else if (responseUpper.includes('NVIDIA') || responseUpper.includes('SHIELD')) {
            type = 'media';
            name = 'NVIDIA Shield';
            manufacturer = 'NVIDIA';
          }
          // Generic UPnP with server info
          else if (server) {
            name = server.substring(0, 50);
            type = 'network';
          }
          // Check ST for media renderer
          else if (st.includes('MEDIARENDERER') || st.includes('AVTRANSPORT')) {
            type = 'media';
            name = 'Media Renderer';
          }

          devices.push({
            ip: rinfo.address,
            port: rinfo.port,
            type,
            name,
            manufacturer,
            model,
            location,
            server,
            st,
            discoveredAt: Date.now(),
          });
          
          console.log(`[Discovery] Found: ${name} at ${rinfo.address}`);
        });

        socket.on('error', (err) => {
          console.error('[Discovery] Socket error:', err);
          socket.close();
          resolve(devices);
        });

        socket.bind(() => {
          socket.setBroadcast(true);
          socket.setMulticastTTL(4);
          
          // Send SSDP discovery to multicast address
          socket.send(SSDP_SEARCH, 0, SSDP_SEARCH.length, 1900, '239.255.255.250', (err) => {
            if (err) console.error('[Discovery] Send error:', err);
          });
          
          // Send a second time after 500ms for better coverage
          setTimeout(() => {
            socket.send(SSDP_SEARCH, 0, SSDP_SEARCH.length, 1900, '239.255.255.250');
          }, 500);
        });

        // Listen for 4 seconds then return results
        setTimeout(() => {
          try {
            socket.close();
          } catch (e) {}
          
          console.log(`[Discovery] Scan complete. Found ${devices.length} devices.`);
          resolve(devices);
        }, 4000);
        
      } catch (error) {
        console.error('[Discovery] Scan failed:', error);
        resolve(devices);
      }
    });
  });
  
  /**
   * Probe a specific IP for common smart home ports
   */
  ipcMain.handle('system:probe-device', async (_, ip) => {
    const net = require('net');
    const results = [];
    
    // Common smart home ports
    const ports = [
      { port: 80, service: 'HTTP' },
      { port: 443, service: 'HTTPS' },
      { port: 8080, service: 'HTTP Alt' },
      { port: 8123, service: 'Home Assistant' },
      { port: 1400, service: 'Sonos' },
      { port: 8008, service: 'Chromecast' },
      { port: 9197, service: 'Hue Bridge' },
      { port: 55443, service: 'Yeelight' },
    ];
    
    const probePort = (port, service) => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        
        socket.on('connect', () => {
          socket.destroy();
          resolve({ port, service, open: true });
        });
        
        socket.on('timeout', () => {
          socket.destroy();
          resolve({ port, service, open: false });
        });
        
        socket.on('error', () => {
          resolve({ port, service, open: false });
        });
        
        socket.connect(port, ip);
      });
    };
    
    const probes = await Promise.all(ports.map(p => probePort(p.port, p.service)));
    return probes.filter(p => p.open);
  });
  
  /**
   * Get local network info (subnet, gateway)
   */
  ipcMain.handle('system:get-network-info', async () => {
    const interfaces = os.networkInterfaces();
    const networks = [];
    
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          networks.push({
            interface: name,
            ip: addr.address,
            netmask: addr.netmask,
            mac: addr.mac,
          });
        }
      }
    }
    
    return networks;
  });
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: getIconPath(),
    }).show();
  }
}

// =============================================================================
// PATHS & HELPERS
// =============================================================================

function getIconPath() {
  if (process.platform === 'darwin') {
    return path.join(__dirname, '../assets/icon.icns');
  } else if (process.platform === 'win32') {
    return path.join(__dirname, '../assets/icon.ico');
  } else {
    return path.join(__dirname, '../assets/icon.png');
  }
}

function getTrayIconPath() {
  if (process.platform === 'darwin') {
    return path.join(__dirname, '../assets/tray-icon.png');
  } else if (process.platform === 'win32') {
    return path.join(__dirname, '../assets/tray-icon.ico');
  } else {
    return path.join(__dirname, '../assets/tray-icon.png');
  }
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Simple store for settings
const store = {
  data: {},
  init() {
    try {
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        this.data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      this.data = {};
    }
  },
  get(key, defaultValue) {
    return this.data[key] ?? defaultValue;
  },
  set(key, value) {
    this.data[key] = value;
    try {
      fs.writeFileSync(getConfigPath(), JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  },
};

// =============================================================================
// APP LIFECYCLE
// =============================================================================

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    showWindow();
  });
  
  app.whenReady().then(() => {
    store.init();
    
    createTray();
    createWindow();
    registerShortcuts();
    setupIPC();
    
    // Start the backend server
    startServer();
  });
  
  app.on('activate', () => {
    // macOS: Re-create window when dock icon clicked
    if (mainWindow === null) {
      createWindow();
    } else {
      showWindow();
    }
  });
  
  app.on('window-all-closed', () => {
    // Don't quit on macOS
    if (process.platform !== 'darwin') {
      // Actually, keep running in tray
      // app.quit();
    }
  });
  
  app.on('before-quit', () => {
    isQuitting = true;
    stopServer();
    globalShortcut.unregisterAll();
  });
}
