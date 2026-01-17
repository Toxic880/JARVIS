/**
 * JARVIS CONTEXT - THE BRAIN STEM
 * 
 * Replaces the "State Bloat" in old App.tsx with clean, manageable state.
 * Manages:
 * - Connection to JarvisCore (the actual AI brain)
 * - UI State (which overlay is active, focus mode, etc.)
 * - Setup flow state
 * 
 * === PHASE 2: HOLOGRAPHIC DISPLAY SYSTEM ===
 * The Core can now trigger visual overlays when tools are called.
 * Weather, System Status, Lists, etc. all project holograms automatically.
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { JarvisCore } from '../services/JarvisCore';
import { JarvisState, UserProfile, SmartDevice, CalendarEvent, HolographicOverlay } from '../types';

// =============================================================================
// TYPES
// =============================================================================

// Overlay types: manual UI overlays + tool-triggered holograms
export type OverlayType = HolographicOverlay | 'SETTINGS' | 'TIMERS' | 'SMART_HOME' | 'TERMINAL';

export interface UIState {
  currentOverlay: OverlayType;
  focusMode: boolean;        // If true, hides everything but the active element
  isSetupComplete: boolean;
  showTextInput: boolean;    // Fallback text input visibility
  volume: number;            // Audio visualization level (0-100)
  // Track if overlay was triggered by tool (auto-dismiss after speaking)
  overlayTriggeredByTool: boolean;
}

interface JarvisContextValue {
  // Core instance
  jarvis: JarvisCore | null;
  
  // State
  state: JarvisState | null;
  ui: UIState;
  isConnected: boolean;
  
  // Actions
  actions: {
    // Overlay control
    setOverlay: (overlay: OverlayType) => void;
    dismissOverlay: () => void;
    toggleFocus: () => void;
    
    // Core control
    wake: () => void;
    sendText: (text: string) => void;
    interrupt: () => void;
    toggleTextInput: () => void;
    
    // Setup
    completeSetup: (profile: UserProfile) => void;
    resetSetup: () => void;
    
    // Volume (for audio reactivity)
    setVolume: (v: number) => void;
    
    // Settings
    updateSettings: (profile: UserProfile) => void;
  };
}

// =============================================================================
// CONTEXT
// =============================================================================

const JarvisContext = createContext<JarvisContextValue | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

export function JarvisProvider({ children }: { children: React.ReactNode }) {
  const coreRef = useRef<JarvisCore | null>(null);
  const [jarvisState, setJarvisState] = useState<JarvisState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const [ui, setUi] = useState<UIState>({
    currentOverlay: 'NONE',
    focusMode: false,
    isSetupComplete: !!localStorage.getItem('jarvis_profile_v2'),
    showTextInput: false,
    volume: 0,
    overlayTriggeredByTool: false,
  });

  // Initialize Core when setup is complete
  useEffect(() => {
    if (ui.isSetupComplete && !coreRef.current) {
      const profile = JSON.parse(localStorage.getItem('jarvis_profile_v2') || '{}');
      const devices = JSON.parse(localStorage.getItem('jarvis_devices') || '[]');
      const calendar = JSON.parse(localStorage.getItem('jarvis_calendar') || '[]');
      
      try {
        const core = new JarvisCore(profile, devices, calendar);
        coreRef.current = core;
        
        // Subscribe to state changes
        core.subscribe((newState) => {
          setJarvisState({ ...newState });
          
          // === PHASE 2: HOLOGRAPHIC DISPLAY SYSTEM ===
          // Sync UI overlay with Core's activeOverlay when tools trigger visuals
          if (newState.activeOverlay && newState.activeOverlay !== 'NONE') {
            setUi(prev => {
              // Only auto-show if we're not already showing something manually
              if (prev.currentOverlay === 'NONE' || prev.overlayTriggeredByTool) {
                return { 
                  ...prev, 
                  currentOverlay: newState.activeOverlay as OverlayType,
                  overlayTriggeredByTool: true,
                };
              }
              return prev;
            });
          }
          
          // Legacy: News overlay (keeping for backwards compatibility)
          if (newState.currentNews && newState.currentNews.length > 0) {
            setUi(prev => {
              if (prev.currentOverlay === 'NONE') {
                return { ...prev, currentOverlay: 'NEWS', overlayTriggeredByTool: true };
              }
              return prev;
            });
          }
        });
        
        // Start the system
        core.start();
        
        // Check connection
        core.checkConnection().then(connected => {
          setIsConnected(connected);
          if (connected) {
            // Movie authenticity: Speak greeting on load
            setTimeout(() => core.greet(), 500);
          }
        });
        
        console.log('[JarvisContext] Core initialized successfully');
      } catch (error) {
        console.error('[JarvisContext] Failed to initialize core:', error);
      }
    }
    
    return () => {
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
    };
  }, [ui.isSetupComplete]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const actions = {
    // Overlay Control
    setOverlay: useCallback((overlay: OverlayType) => {
      setUi(prev => ({ ...prev, currentOverlay: overlay, overlayTriggeredByTool: false }));
    }, []),
    
    dismissOverlay: useCallback(() => {
      // Close both UI overlay and Core overlay
      setUi(prev => ({ ...prev, currentOverlay: 'NONE', overlayTriggeredByTool: false }));
      coreRef.current?.closeOverlay();
    }, []),
    
    toggleFocus: useCallback(() => {
      setUi(prev => ({ ...prev, focusMode: !prev.focusMode }));
    }, []),
    
    // Core Control
    wake: useCallback(() => {
      coreRef.current?.wake();
    }, []),
    
    sendText: useCallback((text: string) => {
      coreRef.current?.sendText(text);
    }, []),
    
    interrupt: useCallback(() => {
      coreRef.current?.interrupt();
    }, []),
    
    toggleTextInput: useCallback(() => {
      setUi(prev => ({ ...prev, showTextInput: !prev.showTextInput }));
    }, []),
    
    // Setup
    completeSetup: useCallback((profile: UserProfile) => {
      localStorage.setItem('jarvis_profile_v2', JSON.stringify(profile));
      setUi(prev => ({ ...prev, isSetupComplete: true }));
    }, []),
    
    resetSetup: useCallback(() => {
      localStorage.removeItem('jarvis_profile_v2');
      localStorage.removeItem('jarvis_devices');
      localStorage.removeItem('jarvis_calendar');
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
      setJarvisState(null);
      setUi(prev => ({ ...prev, isSetupComplete: false }));
    }, []),
    
    // Volume (for audio reactivity visualization)
    setVolume: useCallback((v: number) => {
      setUi(prev => ({ ...prev, volume: Math.max(0, Math.min(100, v)) }));
    }, []),
    
    // Settings
    updateSettings: useCallback((profile: UserProfile) => {
      localStorage.setItem('jarvis_profile_v2', JSON.stringify(profile));
      coreRef.current?.updateSettings(profile);
    }, []),
  };

  return (
    <JarvisContext.Provider value={{
      jarvis: coreRef.current,
      state: jarvisState,
      ui,
      isConnected,
      actions,
    }}>
      {children}
    </JarvisContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

export const useJarvis = () => {
  const context = useContext(JarvisContext);
  if (!context) {
    throw new Error('useJarvis must be used within JarvisProvider');
  }
  return context;
};

export default JarvisProvider;
