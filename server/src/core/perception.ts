/**
 * Perception Layer
 * 
 * Tracks the "world state" that makes Jarvis aware:
 * - What app/window is focused
 * - How long user has been on current task
 * - Recent actions and patterns
 * - Possible frustration indicators
 * - Time-based context
 * 
 * This feeds into the system prompt to give the LLM situational awareness.
 * 
 * In production, this would integrate with:
 * - Native screen capture agent
 * - OS accessibility APIs
 * - Home Assistant sensors
 * - Audio activity detection
 */

import { WorldStateType } from './schemas';
import { logger } from '../services/logger';

// =============================================================================
// STATE TRACKING
// =============================================================================

interface PerceptionState {
  // Current focus
  activeApp: string | null;
  activeWindow: string | null;
  focusStartTime: Date | null;
  
  // Recent app switches (for pattern detection)
  appSwitches: { app: string; at: Date }[];
  
  // Recent actions (for pattern detection)
  recentActions: { action: string; at: Date }[];
  
  // User interaction tracking
  lastInteraction: Date | null;
  idleSince: Date | null;
  
  // Music state
  musicPlaying: boolean;
  currentTrack: string | null;
  
  // Home state
  audioOutput: string | null;
  currentScene: string | null;
  
  // Mode
  currentMode: 'normal' | 'focus' | 'dnd' | 'sleep' | 'away' | 'guest';
  modeSetAt: Date | null;
}

// Singleton state
const state: PerceptionState = {
  activeApp: null,
  activeWindow: null,
  focusStartTime: null,
  appSwitches: [],
  recentActions: [],
  lastInteraction: null,
  idleSince: null,
  musicPlaying: false,
  currentTrack: null,
  audioOutput: null,
  currentScene: null,
  currentMode: 'normal',
  modeSetAt: null,
};

// =============================================================================
// STATE UPDATES
// =============================================================================

/**
 * Update active app/window
 */
export function updateFocus(app: string, window?: string): void {
  const now = new Date();
  
  // Track app switch
  if (state.activeApp !== app) {
    state.appSwitches.push({ app, at: now });
    // Keep last 50 switches
    if (state.appSwitches.length > 50) {
      state.appSwitches = state.appSwitches.slice(-50);
    }
    state.focusStartTime = now;
  }
  
  state.activeApp = app;
  state.activeWindow = window || null;
  state.lastInteraction = now;
  state.idleSince = null;
}

/**
 * Record a user action
 */
export function recordAction(action: string): void {
  const now = new Date();
  state.recentActions.push({ action, at: now });
  
  // Keep last 100 actions
  if (state.recentActions.length > 100) {
    state.recentActions = state.recentActions.slice(-100);
  }
  
  state.lastInteraction = now;
  state.idleSince = null;
}

/**
 * Mark user as idle
 */
export function markIdle(): void {
  if (!state.idleSince) {
    state.idleSince = new Date();
  }
}

/**
 * Update music state
 */
export function updateMusicState(playing: boolean, track?: string): void {
  state.musicPlaying = playing;
  state.currentTrack = track || null;
}

/**
 * Update home state
 */
export function updateHomeState(audioOutput?: string, scene?: string): void {
  if (audioOutput !== undefined) state.audioOutput = audioOutput;
  if (scene !== undefined) state.currentScene = scene;
}

/**
 * Update mode
 */
export function updateMode(mode: PerceptionState['currentMode']): void {
  state.currentMode = mode;
  state.modeSetAt = new Date();
}

// =============================================================================
// PATTERN DETECTION
// =============================================================================

interface DetectedPattern {
  type: 'repeated_action' | 'rapid_switching' | 'possible_frustration' | 'long_focus';
  description: string;
  confidence: number;
  data?: Record<string, any>;
}

/**
 * Detect patterns in recent behavior
 */
function detectPatterns(): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
  
  // Check for repeated actions
  const recentActions = state.recentActions.filter(a => a.at > fiveMinutesAgo);
  const actionCounts = recentActions.reduce((acc, a) => {
    acc[a.action] = (acc[a.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  for (const [action, count] of Object.entries(actionCounts)) {
    if (count >= 3) {
      patterns.push({
        type: 'repeated_action',
        description: `${action} repeated ${count} times in 5 minutes`,
        confidence: Math.min(0.9, 0.5 + count * 0.1),
        data: { action, count },
      });
    }
  }
  
  // Check for rapid app switching (possible frustration)
  const recentSwitches = state.appSwitches.filter(s => s.at > twoMinutesAgo);
  if (recentSwitches.length >= 5) {
    // Check if switching between same 2-3 apps
    const apps = new Set(recentSwitches.map(s => s.app));
    if (apps.size <= 3) {
      patterns.push({
        type: 'rapid_switching',
        description: `Rapidly switching between ${Array.from(apps).join(', ')}`,
        confidence: 0.7,
        data: { switchCount: recentSwitches.length, apps: Array.from(apps) },
      });
    }
  }
  
  // Check for very rapid switching (likely frustration)
  const veryRecentSwitches = state.appSwitches.filter(
    s => s.at > new Date(now.getTime() - 30 * 1000)
  );
  if (veryRecentSwitches.length >= 4) {
    patterns.push({
      type: 'possible_frustration',
      description: 'Rapid context switching detected',
      confidence: 0.8,
    });
  }
  
  // Check for long focus (good for not interrupting)
  if (state.focusStartTime) {
    const focusDuration = (now.getTime() - state.focusStartTime.getTime()) / 1000;
    if (focusDuration > 20 * 60) { // 20 minutes
      patterns.push({
        type: 'long_focus',
        description: `Focused on ${state.activeApp} for ${Math.round(focusDuration / 60)} minutes`,
        confidence: 0.9,
        data: { app: state.activeApp, durationMinutes: Math.round(focusDuration / 60) },
      });
    }
  }
  
  return patterns;
}

// =============================================================================
// WORLD STATE BUILDER
// =============================================================================

/**
 * Build the current world state for LLM context
 */
export function buildPerceptionWorldState(
  userName?: string,
  overrides?: Partial<WorldStateType>
): WorldStateType {
  const now = new Date();
  const hour = now.getHours();
  
  // Determine time of day
  let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // Calculate focus duration
  let focusDuration: number | undefined;
  if (state.focusStartTime) {
    focusDuration = Math.round((now.getTime() - state.focusStartTime.getTime()) / 1000);
  }
  
  // Get recent app list
  const recentApps = [...new Set(
    state.appSwitches
      .slice(-10)
      .map(s => s.app)
  )].slice(0, 5);
  
  // Detect patterns
  const patterns = detectPatterns();
  const repeatedAction = patterns.find(p => p.type === 'repeated_action');
  const frustration = patterns.find(p => p.type === 'possible_frustration' || p.type === 'rapid_switching');
  
  // Build base state
  const worldState: WorldStateType = {
    time: {
      current: now.toISOString(),
      dayOfWeek: days[now.getDay()],
      timeOfDay,
    },
    user: {
      name: userName,
      mode: state.currentMode,
      lastInteraction: state.lastInteraction?.toISOString(),
      recentTopics: [], // Would be populated from conversation history
    },
    desktop: state.activeApp ? {
      activeApp: state.activeApp,
      activeWindow: state.activeWindow || undefined,
      focusDuration,
      recentApps: recentApps.length > 0 ? recentApps : undefined,
    } : undefined,
    home: (state.audioOutput || state.currentScene) ? {
      audioOutput: state.audioOutput || undefined,
      currentScene: state.currentScene || undefined,
    } : undefined,
    music: state.musicPlaying ? {
      isPlaying: true,
      currentTrack: state.currentTrack || undefined,
    } : undefined,
    patterns: (repeatedAction || frustration) ? {
      repeatedAction: repeatedAction?.data ? {
        action: repeatedAction.data.action,
        count: repeatedAction.data.count,
        lastAt: now.toISOString(),
      } : undefined,
      possibleFrustration: frustration ? {
        indicator: frustration.description,
        confidence: frustration.confidence,
      } : undefined,
    } : undefined,
  };
  
  // Apply overrides
  if (overrides) {
    return mergeWorldState(worldState, overrides);
  }
  
  return worldState;
}

/**
 * Deep merge world state with overrides
 */
function mergeWorldState(
  base: WorldStateType, 
  overrides: Partial<WorldStateType>
): WorldStateType {
  const result = { ...base };
  
  if (overrides.time) {
    result.time = { ...base.time, ...overrides.time };
  }
  if (overrides.user) {
    result.user = { ...base.user, ...overrides.user };
  }
  if (overrides.desktop) {
    result.desktop = { ...base.desktop, ...overrides.desktop };
  }
  if (overrides.home) {
    result.home = { ...base.home, ...overrides.home };
  }
  if (overrides.music) {
    result.music = { ...base.music, ...overrides.music };
  }
  if (overrides.patterns) {
    result.patterns = { ...base.patterns, ...overrides.patterns };
  }
  if (overrides.pending) {
    result.pending = { ...base.pending, ...overrides.pending };
  }
  
  return result;
}

// =============================================================================
// PERCEPTION ENDPOINTS (for native agent to update)
// =============================================================================

/**
 * Handle perception update from native agent
 */
export function handlePerceptionUpdate(update: {
  type: 'focus' | 'music' | 'home' | 'idle' | 'action';
  data: Record<string, any>;
}): void {
  switch (update.type) {
    case 'focus':
      updateFocus(update.data.app, update.data.window);
      break;
    case 'music':
      updateMusicState(update.data.playing, update.data.track);
      break;
    case 'home':
      updateHomeState(update.data.audioOutput, update.data.scene);
      break;
    case 'idle':
      markIdle();
      break;
    case 'action':
      recordAction(update.data.action);
      break;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  state as perceptionState,
  detectPatterns,
};
