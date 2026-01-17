/**
 * AUTO SETUP - MOVIE-ACCURATE BOOT SEQUENCE
 * 
 * No more boring forms. This simulates a "System Boot" sequence that
 * automatically scans the network and initializes the "Neural Core."
 * 
 * The user only needs to enter their name and city - everything else
 * is discovered or defaulted intelligently.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useJarvis } from '../store/JarvisContext';
import { UserProfile } from '../types';

type Phase = 'BOOT' | 'NETWORK' | 'NEURAL' | 'IDENTITY' | 'COMPLETE';

export const AutoSetup: React.FC = () => {
  const { actions } = useJarvis();
  const [log, setLog] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('BOOT');
  const [identity, setIdentity] = useState({ name: '', city: '' });
  const [detectedSystems, setDetectedSystems] = useState({
    lmStudio: false,
    homeAssistant: false,
  });
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Helper to add terminal lines with delay
  const addLog = (line: string, delay = 0): Promise<void> => {
    return new Promise(resolve => {
      setTimeout(() => {
        setLog(prev => [...prev, `> ${line}`]);
        resolve();
      }, delay);
    });
  };

  // Phase 1: Boot Sequence
  useEffect(() => {
    if (phase !== 'BOOT') return;
    
    const runBoot = async () => {
      await addLog("J.A.R.V.I.S. PROTOCOL INITIATED...", 300);
      await addLog("LOADING KERNEL MODULES...", 800);
      await addLog("MOUNTING VIRTUAL FILESYSTEM...", 1400);
      await addLog("INITIALIZING SPEECH SYNTHESIS...", 2000);
      await addLog("CALIBRATING VOICE RECOGNITION...", 2600);
      await addLog("CHECKING SYSTEM INTEGRITY... OK", 3200);
      
      setTimeout(() => setPhase('NETWORK'), 3800);
    };
    
    runBoot();
  }, [phase]);

  // Phase 2: Network Scanning
  useEffect(() => {
    if (phase !== 'NETWORK') return;
    
    const runNetworkScan = async () => {
      await addLog("SCANNING LOCAL SUBNET...", 300);
      await addLog("DETECTED: HOST MACHINE (LOCALHOST)", 1000);
      
      // Try to detect LM Studio
      try {
        const response = await fetch('http://127.0.0.1:1234/v1/models', {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const data = await response.json();
          const modelName = data?.data?.[0]?.id || 'LOCAL-MODEL';
          await addLog(`DETECTED: NEURAL ENGINE (LM STUDIO) ON PORT 1234`, 1500);
          await addLog(`MODEL LOADED: ${modelName.toUpperCase()}`, 2000);
          setDetectedSystems(prev => ({ ...prev, lmStudio: true }));
        } else {
          throw new Error('Not responding');
        }
      } catch {
        await addLog("WARNING: NEURAL ENGINE NOT DETECTED", 1500);
        await addLog("RECOMMENDATION: START LM STUDIO FOR FULL CAPABILITY", 2000);
      }
      
      // Try to detect Home Assistant (optional)
      try {
        const haResponse = await fetch('http://homeassistant.local:8123/api/', {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        if (haResponse.ok || haResponse.status === 401) {
          await addLog("DETECTED: HOME ASSISTANT INSTANCE", 2500);
          setDetectedSystems(prev => ({ ...prev, homeAssistant: true }));
        }
      } catch {
        await addLog("NO HOME ASSISTANT DETECTED (OPTIONAL)", 2500);
      }
      
      await addLog("NETWORK SCAN COMPLETE", 3000);
      
      setTimeout(() => setPhase('NEURAL'), 3500);
    };
    
    runNetworkScan();
  }, [phase]);

  // Phase 3: Neural initialization
  useEffect(() => {
    if (phase !== 'NEURAL') return;
    
    const runNeural = async () => {
      await addLog("INITIALIZING NEURAL PATHWAYS...", 300);
      await addLog("LOADING PERSONALITY MATRIX...", 900);
      await addLog("CALIBRATING WIT PARAMETERS... 100%", 1500);
      await addLog("SARCASM MODULE: OPERATIONAL", 2100);
      await addLog("BRITISH ACCENT SYNTHESIZER: READY", 2700);
      await addLog("", 3000);
      await addLog("IDENTIFICATION REQUIRED.", 3300);
      
      setTimeout(() => setPhase('IDENTITY'), 3800);
    };
    
    runNeural();
  }, [phase]);

  // Handle identity submission
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity.name.trim() || !identity.city.trim()) return;
    
    setPhase('COMPLETE');
    
    await addLog(`REGISTERING USER: ${identity.name.toUpperCase()}`, 300);
    await addLog(`CALIBRATING SENSORS FOR: ${identity.city.toUpperCase()}`, 900);
    await addLog("ESTABLISHING SECURE CONNECTION...", 1500);
    await addLog("LOADING USER PREFERENCES...", 2100);
    await addLog("", 2400);
    await addLog("ALL SYSTEMS NOMINAL.", 2700);
    await addLog("SYSTEM ONLINE.", 3000);
    await addLog("", 3300);
    await addLog(`AWAITING YOUR COMMAND, ${identity.name.toUpperCase()}.`, 3600);

    // Create the profile
    setTimeout(() => {
      const profile: UserProfile = {
        name: identity.name,
        location: identity.city,
        isConfigured: true,
        permissions: 'ADMIN',
        preferences: {
          tempUnit: 'celsius',
          voiceProvider: 'browser',
          wakeWord: 'jarvis',
          wakeWordEnabled: true,
          voiceSpeed: 'normal',
          briefMode: false,
          whisperMode: false,
          whisperModeAuto: false,
          pushNotificationsEnabled: false,
          wallDashboardEnabled: false,
          musicService: 'default',
          newsSource: 'general',
          lmStudioUrl: 'http://127.0.0.1:1234',
          lmStudioModel: detectedSystems.lmStudio ? 'auto' : 'qwen/qwen3-14b',
          linkedAccounts: {
            googleCalendar: false,
            spotify: false,
            email: false,
            sms: false,
            whoop: false,
          },
        },
      };
      
      actions.completeSetup(profile);
    }, 4500);
  };

  return (
    <div className="fixed inset-0 bg-black text-cyan-500 font-mono flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Background Grid Effect */}
      <div className="perspective-grid" />
      
      {/* Terminal Container */}
      <div className="relative w-full max-w-3xl z-10">
        {/* Header */}
        <div className="border-b border-cyan-800/50 mb-6 pb-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-cyan-400 font-orbitron tracking-[0.3em] text-sm">
              TERMINAL ACCESS // BOOT_SEQ_001
            </span>
          </div>
          <span className="text-cyan-600 animate-pulse text-xs tracking-widest">
            {phase !== 'COMPLETE' ? 'INITIALIZING' : 'ONLINE'}
          </span>
        </div>
        
        {/* Log Output */}
        <div className="h-72 overflow-y-auto mb-8 space-y-1 text-sm font-mono custom-scrollbar">
          {log.map((line, i) => (
            <div 
              key={i} 
              className={`
                transition-opacity duration-300
                ${line.includes('WARNING') ? 'text-yellow-500' : ''}
                ${line.includes('DETECTED:') ? 'text-green-400' : ''}
                ${line.includes('AWAITING') ? 'text-white font-bold' : ''}
                ${line === '' ? 'h-4' : ''}
              `}
              style={{ 
                opacity: 0,
                animation: 'fadeSlideIn 0.3s forwards',
                animationDelay: '0s',
              }}
            >
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Identity Form */}
        {phase === 'IDENTITY' && (
          <form 
            onSubmit={handleIdentitySubmit} 
            className="bg-cyan-900/10 p-8 border border-cyan-500/30 rounded-lg backdrop-blur-sm"
            style={{ animation: 'fadeIn 0.5s forwards' }}
          >
            <h3 className="text-white font-orbitron tracking-[0.2em] mb-6 flex items-center gap-3">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              IDENTIFICATION REQUIRED
            </h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-cyan-600 text-xs tracking-widest mb-2">
                  ENTER DESIGNATION (NAME)
                </label>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g., LUKE"
                  className="w-full bg-black/50 border border-cyan-500/50 text-white p-3 
                           focus:outline-none focus:border-cyan-400 uppercase tracking-wider
                           placeholder:text-cyan-900 font-mono"
                  value={identity.name}
                  onChange={e => setIdentity({ ...identity, name: e.target.value })}
                />
              </div>
              
              <div>
                <label className="block text-cyan-600 text-xs tracking-widest mb-2">
                  ENTER OPERATIONAL SECTOR (CITY)
                </label>
                <input
                  type="text"
                  placeholder="e.g., LONDON"
                  className="w-full bg-black/50 border border-cyan-500/50 text-white p-3 
                           focus:outline-none focus:border-cyan-400 uppercase tracking-wider
                           placeholder:text-cyan-900 font-mono"
                  value={identity.city}
                  onChange={e => setIdentity({ ...identity, city: e.target.value })}
                />
              </div>
              
              <button 
                type="submit" 
                disabled={!identity.name.trim() || !identity.city.trim()}
                className="w-full bg-cyan-900/50 hover:bg-cyan-800/70 disabled:bg-gray-900/50
                         text-cyan-300 disabled:text-gray-600 py-4 mt-4 
                         border border-cyan-700/50 disabled:border-gray-700
                         font-orbitron tracking-[0.3em] transition-all duration-300
                         hover:shadow-[0_0_20px_rgba(6,182,212,0.3)]"
              >
                AUTHORIZE LINK
              </button>
            </div>
          </form>
        )}

        {/* System Status Indicators */}
        {phase === 'COMPLETE' && (
          <div className="text-center animate-pulse">
            <div className="inline-flex items-center gap-2 text-green-400 text-sm">
              <span className="w-2 h-2 bg-green-400 rounded-full" />
              SYSTEM ONLINE
            </div>
          </div>
        )}
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 0.9;
            transform: translateX(0);
          }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default AutoSetup;
