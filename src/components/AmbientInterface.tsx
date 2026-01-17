/**
 * AMBIENT INTERFACE - THE MOVIE-ACCURATE UI
 * 
 * This is NOT a dashboard. This is a PRESENCE.
 * The screen is mostly empty or ambient until interaction happens.
 * JARVIS projects information when asked or when relevant.
 * 
 * Think: Arc Reactor floating in void, with data appearing as holograms.
 * 
 * === PHASE 2: HOLOGRAPHIC DISPLAY SYSTEM ===
 * Tools now trigger visual overlays automatically:
 * - "What's the weather?" → WeatherHolo projects
 * - "System status" → SystemHolo projects
 * - "Show my shopping list" → ListsHolo projects
 * 
 * === PHASE 4: NETWORK DISCOVERY ===
 * - "Scan for devices" → DeviceRadar projects
 */

import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useJarvis, OverlayType } from '../store/JarvisContext';
import { ArcReactor } from './ArcReactor';
import { NewsDossier } from './NewsDossier';
import { SettingsPanel } from './SettingsPanel';
import { TimersPanel } from './TimersPanel';
import { SmartHomePanel } from './SmartHomePanel';
import { TerminalLog } from './TerminalLog';
import { LogEntry } from '../types';

// === PHASE 2 & 4: HOLOGRAPHIC ARSENAL ===
import { WeatherHolo, SystemHolo, ListsHolo, CalendarHolo, DeviceRadar } from './holograms';

// Helper to convert LogEntry[] to string[]
const logsToStrings = (logs: LogEntry[]): string[] => {
  return logs.map(log => `[${log.level}] ${log.message}`);
};

export const AmbientInterface: React.FC = () => {
  const { state, ui, actions, isConnected } = useJarvis();
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Focus input when text input is shown
  useEffect(() => {
    if (ui.showTextInput) {
      inputRef.current?.focus();
    }
  }, [ui.showTextInput]);

  if (!state) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-cyan-500 animate-pulse font-mono">
          INITIALIZING SYSTEMS...
        </div>
      </div>
    );
  }

  const isListening = state.status === 'LISTENING';
  const isSpeaking = state.status === 'SPEAKING';
  const isProcessing = state.status === 'PROCESSING';
  const hasOverlay = ui.currentOverlay !== 'NONE';

  // Handle text submission
  const handleTextSubmit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && textInput.trim()) {
      actions.sendText(textInput.trim());
      setTextInput('');
    }
  };

  // Quick action buttons for HUD
  const quickActions: { label: string; icon: string; overlay: OverlayType }[] = [
    { label: 'NEWS', icon: '📰', overlay: 'NEWS' },
    { label: 'TIMERS', icon: '⏱', overlay: 'TIMERS' },
    { label: 'HOME', icon: '🏠', overlay: 'SMART_HOME' },
    { label: 'LOG', icon: '📋', overlay: 'TERMINAL' },
    { label: 'SETTINGS', icon: '⚙', overlay: 'SETTINGS' },
  ];

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none">
      {/* ================================================================== */}
      {/* 1. THE VOID GRID (Subtle movement background) */}
      {/* ================================================================== */}
      <div className="perspective-grid" />

      {/* ================================================================== */}
      {/* 2. TOP LEFT CORNER - System Status HUD */}
      {/* ================================================================== */}
      <div 
        className={`absolute top-6 left-6 transition-opacity duration-500 ${hasOverlay && ui.focusMode ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="text-cyan-500/60 font-mono text-xs tracking-widest space-y-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} ${isConnected ? 'animate-pulse' : ''}`} />
            <span>SYS: {state.status}</span>
          </div>
          <div>NET: {state.environment.online ? 'CONNECTED' : 'OFFLINE'}</div>
          <div>LOC: {state.environment.location?.toUpperCase() || 'UNKNOWN'}</div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 3. TOP RIGHT CORNER - Time & Weather */}
      {/* ================================================================== */}
      <div 
        className={`absolute top-6 right-6 text-right transition-opacity duration-500 ${hasOverlay && ui.focusMode ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="text-white/90 font-thin text-5xl font-rajdhani tracking-wider">
          {state.environment.time?.slice(0, -3) || '--:--'}
        </div>
        <div className="text-cyan-500/60 font-mono text-xs tracking-widest mt-2">
          {state.environment.temperature}° {state.environment.weatherCondition?.toUpperCase() || ''}
        </div>
        <div className="text-cyan-500/40 font-mono text-[10px] mt-1">
          {state.environment.date}
        </div>
      </div>

      {/* ================================================================== */}
      {/* 4. CENTER STAGE - THE ARC REACTOR */}
      {/* ================================================================== */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div 
          onClick={actions.wake}
          className={`
            transform transition-all duration-700 cursor-pointer
            ${hasOverlay ? 'scale-[0.35] -translate-y-[35vh] opacity-60' : 'scale-100'}
            ${isProcessing ? 'animate-pulse' : ''}
            hover:scale-105
          `}
        >
          <ArcReactor volume={ui.volume} status={state.status} />
        </div>
      </div>

      {/* ================================================================== */}
      {/* 5. TRANSCRIPT (Floating near reactor when speaking) */}
      {/* ================================================================== */}
      {state.lastTranscript && !hasOverlay && (
        <div className="absolute bottom-40 left-0 right-0 text-center z-20 pointer-events-none animate-fadeIn">
          <p className="text-cyan-500/50 font-mono text-xs mb-2 tracking-widest">
            {isProcessing ? 'PROCESSING' : 'INPUT DETECTED'}
          </p>
          <p className="text-white/80 font-rajdhani text-2xl max-w-2xl mx-auto px-8">
            "{state.lastTranscript}"
          </p>
        </div>
      )}

      {/* Response display */}
      {state.lastResponse && !hasOverlay && (
        <div className="absolute bottom-24 left-0 right-0 text-center z-20 pointer-events-none">
          <p className="text-cyan-400/70 font-rajdhani text-lg max-w-2xl mx-auto px-8 line-clamp-3">
            {state.lastResponse}
          </p>
        </div>
      )}

      {/* ================================================================== */}
      {/* 6. HOLOGRAPHIC OVERLAYS (Projections) */}
      {/* ================================================================== */}
      <div className={`
        absolute inset-0 flex items-center justify-center z-30
        transition-all duration-500 
        ${hasOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
      `}>
        {/* Overlay Container */}
        <div className="w-full max-w-5xl max-h-[80vh] mx-4 overflow-hidden flex items-center justify-center">
          
          {/* === PHASE 2: TOOL-TRIGGERED HOLOGRAMS === */}
          
          {/* WEATHER HOLOGRAM - Triggered by getWeather tool */}
          {ui.currentOverlay === 'WEATHER' && (
            <WeatherHolo 
              data={state.visualData} 
              onClose={actions.dismissOverlay}
            />
          )}

          {/* SYSTEM HOLOGRAM - Triggered by getSystemStatus tool */}
          {ui.currentOverlay === 'SYSTEM' && (
            <SystemHolo 
              data={state.visualData}
              onClose={actions.dismissOverlay}
            />
          )}

          {/* LISTS HOLOGRAM - Triggered by getList tool */}
          {ui.currentOverlay === 'LISTS' && state.visualData && (
            <ListsHolo 
              listName={state.visualData.listName || 'List'}
              items={state.visualData.items || []}
              onClose={actions.dismissOverlay}
            />
          )}

          {/* CALENDAR HOLOGRAM - Triggered by getSchedule/getTodayEvents */}
          {ui.currentOverlay === 'CALENDAR' && (
            <CalendarHolo 
              events={state.visualData?.events || state.calendar || []}
              onClose={actions.dismissOverlay}
            />
          )}

          {/* DEVICE RADAR HOLOGRAM - Triggered by scanDevices tool (Phase 4) */}
          {ui.currentOverlay === 'RADAR' && (
            <DeviceRadar 
              onClose={actions.dismissOverlay}
            />
          )}

          {/* === MANUAL UI OVERLAYS === */}
          
          {/* NEWS PROJECTION - Uses its own fullscreen modal */}
          {ui.currentOverlay === 'NEWS' && (
            <NewsDossier 
              news={state.currentNews || []} 
              isVisible={true}
              onClose={actions.dismissOverlay}
              isSpeaking={state.status === 'SPEAKING'}
            />
          )}

          {/* SETTINGS PROJECTION - Uses its own modal */}
          {ui.currentOverlay === 'SETTINGS' && (
            <SettingsPanel 
              profile={state.userProfile!}
              onSave={(profile) => {
                actions.updateSettings(profile);
                actions.dismissOverlay();
              }}
              onClose={actions.dismissOverlay}
            />
          )}

          {/* TIMERS PROJECTION */}
          {ui.currentOverlay === 'TIMERS' && (
            <HolographicPanel title="TEMPORAL TRACKING" onClose={actions.dismissOverlay}>
              <TimersPanel 
                timers={state.timers}
                alarms={state.alarms}
              />
            </HolographicPanel>
          )}

          {/* SMART HOME PROJECTION */}
          {ui.currentOverlay === 'SMART_HOME' && (
            <HolographicPanel title="DOMICILE CONTROL" onClose={actions.dismissOverlay}>
              <SmartHomePanel devices={state.smartHome} />
            </HolographicPanel>
          )}

          {/* TERMINAL PROJECTION */}
          {ui.currentOverlay === 'TERMINAL' && (
            <HolographicPanel title="SYSTEM LOG" onClose={actions.dismissOverlay}>
              <TerminalLog logs={logsToStrings(state.logs)} />
            </HolographicPanel>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* 7. BOTTOM HUD - Quick Actions */}
      {/* ================================================================== */}
      <div className={`
        absolute bottom-6 left-1/2 -translate-x-1/2 z-40
        transition-opacity duration-500
        ${hasOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="flex items-center gap-4">
          {quickActions.map(({ label, icon, overlay }) => (
            <button
              key={label}
              onClick={() => actions.setOverlay(overlay)}
              className="group flex flex-col items-center gap-1 px-3 py-2 rounded-lg
                       bg-black/30 border border-cyan-500/20 
                       hover:border-cyan-500/50 hover:bg-cyan-900/20
                       transition-all duration-300"
            >
              <span className="text-lg opacity-60 group-hover:opacity-100 transition-opacity">
                {icon}
              </span>
              <span className="text-[10px] text-cyan-500/50 group-hover:text-cyan-400 
                           font-mono tracking-widest transition-colors">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================== */}
      {/* 8. TEXT INPUT (Fallback for when voice fails) */}
      {/* ================================================================== */}
      <div className={`
        fixed bottom-20 left-1/2 -translate-x-1/2 z-50
        transition-all duration-300
        ${ui.showTextInput ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
      `}>
        <div className="flex items-center gap-2 bg-black/80 border border-cyan-500/30 rounded-full px-4 py-2 backdrop-blur-sm">
          <span className="text-cyan-500 text-sm">›</span>
          <input
            ref={inputRef}
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleTextSubmit}
            placeholder="Type your command..."
            className="bg-transparent text-white text-sm w-64 focus:outline-none placeholder:text-cyan-800"
          />
          <button 
            onClick={() => {
              if (textInput.trim()) {
                actions.sendText(textInput.trim());
                setTextInput('');
              }
            }}
            className="text-cyan-500 hover:text-white transition-colors"
          >
            ↵
          </button>
        </div>
      </div>

      {/* Text input toggle button */}
      <button
        onClick={actions.toggleTextInput}
        className={`
          fixed bottom-6 right-6 z-50
          w-10 h-10 rounded-full
          bg-black/50 border border-cyan-500/30
          flex items-center justify-center
          hover:border-cyan-500 hover:bg-cyan-900/30
          transition-all duration-300
          ${ui.showTextInput ? 'border-cyan-400' : ''}
        `}
      >
        <span className="text-cyan-500 text-lg">⌨</span>
      </button>

      {/* Connection warning */}
      {!isConnected && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                      bg-red-900/80 border border-red-500 rounded-lg px-6 py-4 text-center">
          <div className="text-red-400 font-mono text-sm mb-2">⚠ NEURAL ENGINE OFFLINE</div>
          <div className="text-white/70 text-xs">
            Start LM Studio with a model loaded to enable full functionality
          </div>
        </div>
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
};

// =============================================================================
// HOLOGRAPHIC PANEL COMPONENT
// =============================================================================

interface HolographicPanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

const HolographicPanel: React.FC<HolographicPanelProps> = ({ title, onClose, children, wide }) => {
  return (
    <div 
      className={`
        bg-black/90 backdrop-blur-md 
        border border-cyan-500/30 
        rounded-xl 
        shadow-[0_0_50px_rgba(0,255,255,0.1)]
        overflow-hidden
        animate-hologramIn
        ${wide ? 'max-w-6xl' : 'max-w-4xl'}
        mx-auto
      `}
    >
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-cyan-900/50 bg-cyan-900/10">
        <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm flex items-center gap-3">
          <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          {title}
        </h2>
        <button 
          onClick={onClose}
          className="text-cyan-700 hover:text-white transition-colors text-sm font-mono tracking-widest"
        >
          [CLOSE]
        </button>
      </div>
      
      {/* Content */}
      <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {children}
      </div>

      <style>{`
        @keyframes hologramIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-hologramIn {
          animation: hologramIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default AmbientInterface;
