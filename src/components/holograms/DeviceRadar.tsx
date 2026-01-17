/**
 * DEVICE RADAR HOLOGRAM - NETWORK SCANNER DISPLAY
 * 
 * A visual "radar sweep" that discovers smart devices on your network.
 * Uses SSDP/UPnP to find Hue lights, Sonos speakers, Chromecast, etc.
 * 
 * Projects when you say "Scan for devices" or "Find smart home hardware"
 */

import React, { useEffect, useState, useCallback } from 'react';

interface DiscoveredDevice {
  ip: string;
  port?: number;
  type: string;
  name: string;
  manufacturer?: string;
  location?: string;
  discoveredAt?: number;
}

interface DeviceRadarProps {
  onDeviceSelect?: (device: DiscoveredDevice) => void;
  onClose?: () => void;
}

// Device type to color/icon mapping
const deviceStyles: Record<string, { color: string; icon: string; glow: string }> = {
  light: { color: 'bg-yellow-400', icon: '💡', glow: 'shadow-[0_0_15px_#facc15]' },
  speaker: { color: 'bg-purple-400', icon: '🔊', glow: 'shadow-[0_0_15px_#c084fc]' },
  media: { color: 'bg-red-400', icon: '📺', glow: 'shadow-[0_0_15px_#f87171]' },
  hub: { color: 'bg-green-400', icon: '🏠', glow: 'shadow-[0_0_15px_#4ade80]' },
  switch: { color: 'bg-orange-400', icon: '🔌', glow: 'shadow-[0_0_15px_#fb923c]' },
  network: { color: 'bg-blue-400', icon: '🌐', glow: 'shadow-[0_0_15px_#60a5fa]' },
  unknown: { color: 'bg-cyan-400', icon: '❓', glow: 'shadow-[0_0_15px_#22d3ee]' },
};

export const DeviceRadar: React.FC<DeviceRadarProps> = ({ onDeviceSelect, onClose }) => {
  const [scanning, setScanning] = useState(true);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

  // Run network scan
  const runScan = useCallback(async () => {
    setScanning(true);
    setScanProgress(0);
    setDevices([]);

    // Progress animation
    const progressInterval = setInterval(() => {
      setScanProgress(prev => Math.min(prev + 2, 95));
    }, 80);

    try {
      // Check if running in Electron with jarvisHost
      if (window.jarvisHost?.scanNetwork) {
        console.log('[Radar] Starting SSDP network scan...');
        const results = await window.jarvisHost.scanNetwork();
        setDevices(results);
        console.log(`[Radar] Found ${results.length} devices`);
      } else {
        // Browser fallback: simulate discovery with mock data
        console.log('[Radar] Running in browser mode - using mock data');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        setDevices([
          { ip: '192.168.1.5', type: 'light', name: 'Philips Hue Bridge', manufacturer: 'Philips' },
          { ip: '192.168.1.12', type: 'speaker', name: 'Sonos Play:1', manufacturer: 'Sonos' },
          { ip: '192.168.1.20', type: 'media', name: 'Google Chromecast', manufacturer: 'Google' },
          { ip: '192.168.1.25', type: 'hub', name: 'Home Assistant', manufacturer: 'Home Assistant' },
          { ip: '192.168.1.30', type: 'speaker', name: 'Amazon Echo', manufacturer: 'Amazon' },
          { ip: '192.168.1.35', type: 'switch', name: 'TP-Link Smart Plug', manufacturer: 'TP-Link' },
        ]);
      }
    } catch (error) {
      console.error('[Radar] Scan failed:', error);
    } finally {
      clearInterval(progressInterval);
      setScanProgress(100);
      setScanning(false);
    }
  }, []);

  // Start scan on mount
  useEffect(() => {
    runScan();
  }, [runScan]);

  // Calculate device positions on radar
  const getDevicePosition = (index: number, total: number) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const radiusVariation = 80 + (index % 3) * 40; // Vary the radius
    const x = Math.cos(angle) * radiusVariation;
    const y = Math.sin(angle) * radiusVariation;
    return { x, y };
  };

  const handleDeviceClick = (device: DiscoveredDevice) => {
    setSelectedDevice(device);
    onDeviceSelect?.(device);
  };

  const getStyle = (type: string) => deviceStyles[type] || deviceStyles.unknown;

  return (
    <div className="relative bg-black/95 border border-cyan-500/40 rounded-2xl p-8 w-[700px] shadow-[0_0_60px_rgba(0,255,255,0.15)]">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400" />

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${scanning ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
          <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm">
            NETWORK DISCOVERY
          </h2>
        </div>
        <div className="text-cyan-600/60 font-mono text-xs">
          {scanning ? `SCANNING... ${scanProgress}%` : `${devices.length} DEVICES FOUND`}
        </div>
      </div>

      {/* Radar Display */}
      <div className="relative w-[500px] h-[500px] mx-auto flex items-center justify-center">
        
        {/* Radar Grid Circles */}
        <div className="absolute inset-0 rounded-full border border-cyan-500/20" />
        <div className="absolute inset-[60px] rounded-full border border-cyan-500/15" />
        <div className="absolute inset-[120px] rounded-full border border-cyan-500/10" />
        <div className="absolute inset-[180px] rounded-full border border-cyan-500/10" />
        
        {/* Cross Lines */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px bg-cyan-500/15" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-full w-px bg-cyan-500/15" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px bg-cyan-500/10 rotate-45 origin-center" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px bg-cyan-500/10 -rotate-45 origin-center" />
        </div>

        {/* Radar Sweep Animation */}
        {scanning && (
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div 
              className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-left"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0deg, rgba(34, 211, 238, 0.3) 30deg, transparent 60deg)',
                animation: 'spin 2s linear infinite',
              }}
            />
          </div>
        )}

        {/* Center Hub (Your Computer) */}
        <div className="absolute w-6 h-6 bg-cyan-500 rounded-full shadow-[0_0_20px_#06b6d4] z-20 flex items-center justify-center">
          <div className="w-2 h-2 bg-white rounded-full" />
        </div>

        {/* Discovered Devices */}
        {devices.map((device, index) => {
          const { x, y } = getDevicePosition(index, devices.length);
          const style = getStyle(device.type);
          const isSelected = selectedDevice?.ip === device.ip;
          
          return (
            <div
              key={device.ip}
              className={`absolute flex flex-col items-center cursor-pointer transition-all duration-300 z-10
                ${scanning ? 'animate-pulse' : ''}`}
              style={{ 
                transform: `translate(${x}px, ${y}px)`,
                opacity: scanning ? 0.7 : 1,
              }}
              onClick={() => handleDeviceClick(device)}
            >
              {/* Device Dot */}
              <div className={`
                w-4 h-4 rounded-full ${style.color} ${style.glow}
                transition-all duration-200
                ${isSelected ? 'scale-150 ring-2 ring-white' : 'hover:scale-125'}
              `} />
              
              {/* Device Label (on hover or selected) */}
              <div className={`
                absolute top-6 bg-black/90 border border-cyan-500/50 px-2 py-1 
                rounded text-[10px] font-mono whitespace-nowrap z-30
                transition-opacity duration-200
                ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              `}
                style={{ opacity: isSelected ? 1 : undefined }}
              >
                <div className="text-white font-medium">{device.name}</div>
                <div className="text-cyan-500/60">{device.ip}</div>
              </div>
            </div>
          );
        })}

        {/* Status Ring */}
        <div className={`absolute inset-[-4px] rounded-full border-2 transition-colors duration-500 ${
          scanning ? 'border-yellow-500/30 animate-pulse' : 'border-green-500/30'
        }`} />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-6 flex-wrap">
        {Object.entries(deviceStyles).slice(0, 6).map(([type, style]) => (
          <div key={type} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${style.color}`} />
            <span className="text-cyan-600/60 font-mono text-[10px] uppercase">{type}</span>
          </div>
        ))}
      </div>

      {/* Selected Device Details */}
      {selectedDevice && (
        <div className="mt-6 p-4 bg-cyan-900/20 border border-cyan-500/30 rounded-lg">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-white font-rajdhani text-lg">{selectedDevice.name}</div>
              <div className="text-cyan-500/60 font-mono text-xs mt-1">
                IP: {selectedDevice.ip}
                {selectedDevice.manufacturer && ` • ${selectedDevice.manufacturer}`}
              </div>
            </div>
            <button 
              className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 rounded text-cyan-400 font-mono text-xs hover:bg-cyan-500/30 transition-colors"
              onClick={() => {
                // Here you would integrate the device
                console.log('Integrating device:', selectedDevice);
              }}
            >
              INTEGRATE
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-cyan-800/30">
        <button 
          onClick={runScan}
          disabled={scanning}
          className={`px-4 py-2 border rounded font-mono text-xs transition-colors ${
            scanning 
              ? 'border-cyan-800/30 text-cyan-800 cursor-not-allowed' 
              : 'border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10'
          }`}
        >
          {scanning ? 'SCANNING...' : 'RESCAN'}
        </button>
        
        {onClose && (
          <button 
            onClick={onClose}
            className="px-4 py-2 border border-cyan-500/40 text-cyan-400 rounded font-mono text-xs hover:bg-cyan-500/10 transition-colors"
          >
            CLOSE
          </button>
        )}
      </div>

      {/* CSS for radar sweep animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default DeviceRadar;
