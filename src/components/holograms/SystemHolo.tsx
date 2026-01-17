/**
 * SYSTEM HOLOGRAM - DIAGNOSTIC PANEL
 * 
 * A comprehensive system status display showing CPU, memory,
 * network, and security status. Projects when you say "System Status"
 * or JARVIS detects an anomaly.
 */

import React, { useState, useEffect } from 'react';

interface SystemStats {
  cpu?: number[];
  memory?: number;
  network?: number;
  storage?: number;
  battery?: number;
  uptime?: string;
}

interface SystemHoloProps {
  data?: SystemStats;
  onClose?: () => void;
}

// Generate realistic-looking fake stats if none provided
const generateMockStats = (): SystemStats => ({
  cpu: [
    Math.floor(Math.random() * 30) + 5,
    Math.floor(Math.random() * 40) + 10,
    Math.floor(Math.random() * 25) + 8,
    Math.floor(Math.random() * 35) + 5,
  ],
  memory: Math.floor(Math.random() * 30) + 40,
  network: Math.floor(Math.random() * 20) + 75,
  storage: Math.floor(Math.random() * 30) + 50,
  battery: 100,
  uptime: '14:23:07',
});

export const SystemHolo: React.FC<SystemHoloProps> = ({ data, onClose }) => {
  const [stats, setStats] = useState<SystemStats>(data || generateMockStats());
  const [securityStatus, setSecurityStatus] = useState<'SECURE' | 'ALERT' | 'SCANNING'>('SCANNING');

  // Simulate live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        cpu: prev.cpu?.map(v => Math.max(5, Math.min(95, v + (Math.random() * 10 - 5)))),
        network: Math.max(50, Math.min(100, (prev.network || 80) + (Math.random() * 6 - 3))),
      }));
    }, 2000);

    // Security scan simulation
    const securityTimer = setTimeout(() => {
      setSecurityStatus('SECURE');
    }, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(securityTimer);
    };
  }, []);

  const avgCpu = stats.cpu ? Math.round(stats.cpu.reduce((a, b) => a + b, 0) / stats.cpu.length) : 0;

  return (
    <div className="relative bg-black/90 backdrop-blur-md border border-cyan-500/40 p-6 w-[500px] rounded-xl shadow-[0_0_60px_rgba(0,255,255,0.15)]">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400" />

      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-cyan-800/50 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm">
            SYSTEM DIAGNOSTIC
          </h2>
        </div>
        <div className="text-cyan-600/60 font-mono text-xs">
          UPTIME: {stats.uptime || '00:00:00'}
        </div>
      </div>

      {/* CPU Cores */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-cyan-500 font-mono text-xs tracking-wider">CPU CORES</span>
          <span className="text-cyan-400 font-mono text-xs">{avgCpu}% AVG</span>
        </div>
        <div className="space-y-2">
          {stats.cpu?.map((load, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-cyan-600/60 font-mono text-[10px] w-16">CORE {i + 1}</span>
              <div className="flex-1 h-2 bg-cyan-900/30 rounded overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 rounded ${
                    load > 80 ? 'bg-red-500' : load > 50 ? 'bg-yellow-500' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${load}%` }}
                />
              </div>
              <span className={`font-mono text-xs w-10 text-right ${
                load > 80 ? 'text-red-400' : load > 50 ? 'text-yellow-400' : 'text-cyan-400'
              }`}>
                {Math.round(load)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System Resources Grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <ResourceGauge label="MEMORY" value={stats.memory || 0} />
        <ResourceGauge label="NETWORK" value={stats.network || 0} />
        <ResourceGauge label="STORAGE" value={stats.storage || 0} />
      </div>

      {/* Security Status */}
      <div className={`p-4 rounded-lg border transition-all duration-500 ${
        securityStatus === 'SECURE' 
          ? 'border-green-500/50 bg-green-900/10' 
          : securityStatus === 'ALERT'
          ? 'border-red-500/50 bg-red-900/10'
          : 'border-yellow-500/50 bg-yellow-900/10'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              securityStatus === 'SECURE' 
                ? 'bg-green-500' 
                : securityStatus === 'ALERT'
                ? 'bg-red-500 animate-pulse'
                : 'bg-yellow-500 animate-pulse'
            }`} />
            <span className={`font-mono text-sm ${
              securityStatus === 'SECURE' 
                ? 'text-green-400' 
                : securityStatus === 'ALERT'
                ? 'text-red-400'
                : 'text-yellow-400'
            }`}>
              SECURITY: {securityStatus}
            </span>
          </div>
          {securityStatus === 'SCANNING' && (
            <div className="flex gap-1">
              {[...Array(3)].map((_, i) => (
                <div 
                  key={i}
                  className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          )}
        </div>
        {securityStatus === 'SECURE' && (
          <div className="mt-2 text-green-600/60 font-mono text-[10px]">
            ALL PROTOCOLS ACTIVE • NO THREATS DETECTED
          </div>
        )}
      </div>

      {/* Active Processes */}
      <div className="mt-4 p-3 bg-cyan-900/10 border border-cyan-500/20 rounded-lg">
        <div className="text-cyan-600/80 font-mono text-[10px] mb-2">ACTIVE PROCESSES</div>
        <div className="flex flex-wrap gap-2">
          {['JARVIS_CORE', 'SPEECH_SVC', 'LLM_ENGINE', 'VOICE_SYNTH', 'HOME_CTRL'].map(proc => (
            <span key={proc} className="text-cyan-400/80 font-mono text-[9px] px-2 py-0.5 bg-cyan-900/30 rounded">
              {proc}
            </span>
          ))}
        </div>
      </div>

      {/* Close Button */}
      {onClose && (
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 text-cyan-600 hover:text-white transition-colors"
        >
          <span className="font-mono text-xs">[×]</span>
        </button>
      )}
    </div>
  );
};

// Circular gauge sub-component
const ResourceGauge: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const circumference = 2 * Math.PI * 20;
  const strokeDashoffset = circumference - (value / 100) * circumference;
  const color = value > 80 ? '#ef4444' : value > 60 ? '#eab308' : '#22d3ee';

  return (
    <div className="flex flex-col items-center p-3 bg-cyan-900/10 border border-cyan-500/20 rounded-lg">
      <div className="relative w-12 h-12 mb-2">
        <svg className="w-12 h-12 transform -rotate-90">
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
            className="text-cyan-900/50"
          />
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke={color}
            strokeWidth="4"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-mono text-xs">{Math.round(value)}</span>
        </div>
      </div>
      <span className="text-cyan-600/80 font-mono text-[9px] tracking-wider">{label}</span>
    </div>
  );
};

export default SystemHolo;
