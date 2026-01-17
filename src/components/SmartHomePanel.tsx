import React from 'react';
import { SmartDevice } from '../types';

interface Props {
  devices: SmartDevice[];
}

// Simple SVG Icons for devices
const Icons: Record<string, React.ReactNode> = {
  light: <path d="M9 18h6 M10 22h4 M12 2v6 M12 18v-6 M2 12h10 M12 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />, // Abstract bulb
  lock: <path d="M8 11V7a4 4 0 118 0v4 M7 11h10v10H7z" stroke="currentColor" strokeWidth="2" fill="none" />,
  thermostat: <path d="M12 2a5 5 0 015 5v3.57a8 8 0 11-10 0V7a5 5 0 015-5z M12 6v6" stroke="currentColor" strokeWidth="2" fill="none" />,
  camera: <path d="M15 10l5-4v12l-5-4v3H4V7h11v3z" stroke="currentColor" strokeWidth="2" fill="none" />,
  switch: <path d="M8 6h8 M8 18h8 M12 6v12" stroke="currentColor" strokeWidth="2" />
};

export const SmartHomePanel: React.FC<Props> = ({ devices }) => {
  return (
    <div className="glass-panel stark-corner p-4 h-full flex flex-col relative overflow-hidden">
      
      {/* Header */}
      <h3 className="text-cyan-400 font-orbitron text-xs tracking-widest mb-4 z-10 flex justify-between items-center border-b border-cyan-800 pb-2">
        <span>FACILITY CONTROL</span>
        <div className="flex gap-1">
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse delay-75"></div>
        </div>
      </h3>

      {/* Circuit Board Layout */}
      <div className="flex-1 relative pl-6 overflow-y-auto custom-scrollbar">
          
          {/* The "Bus" Line */}
          <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-cyan-900"></div>

          <div className="space-y-4">
              {devices.map((device, index) => {
                  const isActive = device.status === 'on' || device.status === 'unlocked' || device.status === 'active';
                  
                  return (
                      <div key={device.id} className="relative group">
                          {/* Connection Line to Bus */}
                          <div className={`absolute -left-6 top-1/2 w-6 h-0.5 transition-colors duration-300 ${isActive ? 'bg-cyan-400 shadow-[0_0_5px_cyan]' : 'bg-cyan-900'}`}></div>
                          
                          {/* Connection Node */}
                          <div className={`absolute -left-[26px] top-1/2 -mt-1 w-2 h-2 rounded-full border border-black transition-colors duration-300 ${isActive ? 'bg-cyan-400' : 'bg-cyan-900'}`}></div>

                          <div className={`
                              relative p-2 border-l-2 transition-all duration-300 flex items-center justify-between
                              ${isActive 
                                ? 'border-l-cyan-400 bg-cyan-900/30 shadow-[inset_10px_0_20px_rgba(34,211,238,0.1)]' 
                                : 'border-l-slate-700 bg-transparent opacity-70'}
                          `}>
                              
                              <div className="flex items-center gap-3">
                                  {/* Icon Box */}
                                  <div className={`w-8 h-8 flex items-center justify-center rounded border ${isActive ? 'border-cyan-400 text-cyan-400' : 'border-slate-600 text-slate-600'}`}>
                                      <svg viewBox="0 0 24 24" className="w-5 h-5">
                                          {Icons[device.type] || Icons.switch}
                                      </svg>
                                  </div>

                                  <div className="flex flex-col">
                                      <span className="font-rajdhani font-bold text-white leading-none text-lg">
                                          {device.name}
                                      </span>
                                      <span className="font-mono text-[10px] text-cyan-600 uppercase">
                                          {device.location}
                                      </span>
                                  </div>
                              </div>

                              <div className="text-right">
                                  <div className={`font-mono text-xs font-bold uppercase ${isActive ? 'text-cyan-300 text-glow' : 'text-slate-500'}`}>
                                      {device.status}
                                  </div>
                                  {device.value && (
                                      <div className="font-mono text-[10px] text-white">
                                          {device.value}
                                      </div>
                                  )}
                              </div>
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>
    </div>
  );
};