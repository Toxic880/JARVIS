/**
 * Native Perception Agent
 * 
 * A persistent agent that runs alongside the OS to gather real signals:
 * - Active window/app (via OS APIs)
 * - Window titles
 * - Error dialogs & notifications
 * - Audio devices in use
 * - App-specific states
 * 
 * Emits FACTS, not interpretations:
 * {
 *   "focused_app": "Ableton Live",
 *   "window_title": "Ambient.als",
 *   "error_detected": true,
 *   "error_text": "Audio engine failed"
 * }
 * 
 * This module provides the server-side receiver and state manager.
 * The actual native agent runs as a separate process/app.
 */

import { EventEmitter } from 'events';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// PERCEPTION DATA TYPES
// =============================================================================

export interface WindowInfo {
  app: string;
  title: string;
  bundleId?: string;
  pid?: number;
}

export interface AudioState {
  outputDevice: string;
  inputDevice?: string;
  volume: number;
  muted: boolean;
  activeApps: string[]; // Apps currently producing audio
}

export interface SystemNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  timestamp: Date;
  actionable: boolean;
}

export interface ErrorDetection {
  detected: boolean;
  type: 'dialog' | 'notification' | 'crash' | 'hang';
  app: string;
  message: string;
  timestamp: Date;
}

export interface DisplayInfo {
  count: number;
  primary: {
    width: number;
    height: number;
    scale: number;
  };
  cursorPosition?: { x: number; y: number };
}

export interface PerceptionFact {
  timestamp: Date;
  source: 'os' | 'app' | 'user' | 'system';
  category: 'window' | 'audio' | 'notification' | 'error' | 'input' | 'display' | 'network' | 'power';
  data: Record<string, any>;
  confidence: number; // 0-1, how certain we are about this fact
}

export interface PerceptionSnapshot {
  timestamp: Date;
  window: WindowInfo | null;
  audio: AudioState | null;
  notifications: SystemNotification[];
  errors: ErrorDetection[];
  display: DisplayInfo | null;
  facts: PerceptionFact[];
  // Derived insights
  insights: {
    userActive: boolean;
    lastActivity: Date;
    currentContext: string;
    potentialFrustration: boolean;
  };
}

// =============================================================================
// PERCEPTION STATE
// =============================================================================

class PerceptionState {
  // Current state
  currentWindow: WindowInfo | null = null;
  currentAudio: AudioState | null = null;
  recentNotifications: SystemNotification[] = [];
  recentErrors: ErrorDetection[] = [];
  displayInfo: DisplayInfo | null = null;
  
  // Historical facts
  facts: PerceptionFact[] = [];
  private readonly MAX_FACTS = 1000;
  private readonly MAX_NOTIFICATIONS = 50;
  private readonly MAX_ERRORS = 20;
  
  // Activity tracking
  lastActivityTime: Date = new Date();
  isUserActive: boolean = true;
  idleThresholdMs: number = 5 * 60 * 1000; // 5 minutes
  
  // App usage tracking
  appUsage: Map<string, { totalTime: number; lastSeen: Date; switchCount: number }> = new Map();
  windowHistory: { app: string; title: string; startTime: Date; endTime?: Date }[] = [];
  
  // Error/frustration detection
  errorCount: number = 0;
  rapidSwitchCount: number = 0;
  lastSwitchTime: Date | null = null;
  frustrationIndicators: string[] = [];

  /**
   * Update window focus
   */
  updateWindow(window: WindowInfo): void {
    const now = new Date();
    
    // Track switch speed
    if (this.lastSwitchTime) {
      const timeSinceSwitch = now.getTime() - this.lastSwitchTime.getTime();
      if (timeSinceSwitch < 2000) { // Less than 2 seconds
        this.rapidSwitchCount++;
        if (this.rapidSwitchCount > 5) {
          this.frustrationIndicators.push('rapid_app_switching');
        }
      } else {
        this.rapidSwitchCount = Math.max(0, this.rapidSwitchCount - 1);
      }
    }
    this.lastSwitchTime = now;
    
    // Close previous window history entry
    if (this.windowHistory.length > 0) {
      const last = this.windowHistory[this.windowHistory.length - 1];
      if (!last.endTime) {
        last.endTime = now;
      }
    }
    
    // Track app usage
    if (this.currentWindow) {
      const usage = this.appUsage.get(this.currentWindow.app) || { 
        totalTime: 0, 
        lastSeen: now,
        switchCount: 0,
      };
      usage.totalTime += now.getTime() - usage.lastSeen.getTime();
      usage.switchCount++;
      usage.lastSeen = now;
      this.appUsage.set(this.currentWindow.app, usage);
    }
    
    // Update current
    this.currentWindow = window;
    this.lastActivityTime = now;
    this.isUserActive = true;
    
    // Add to history
    this.windowHistory.push({
      app: window.app,
      title: window.title,
      startTime: now,
    });
    
    // Limit history
    if (this.windowHistory.length > 100) {
      this.windowHistory = this.windowHistory.slice(-100);
    }
    
    // Record fact
    this.addFact({
      timestamp: now,
      source: 'os',
      category: 'window',
      data: window,
      confidence: 1.0,
    });
  }

  /**
   * Update audio state
   */
  updateAudio(audio: AudioState): void {
    this.currentAudio = audio;
    this.lastActivityTime = new Date();
    
    this.addFact({
      timestamp: new Date(),
      source: 'os',
      category: 'audio',
      data: audio,
      confidence: 1.0,
    });
  }

  /**
   * Add notification
   */
  addNotification(notification: SystemNotification): void {
    this.recentNotifications.unshift(notification);
    
    if (this.recentNotifications.length > this.MAX_NOTIFICATIONS) {
      this.recentNotifications = this.recentNotifications.slice(0, this.MAX_NOTIFICATIONS);
    }
    
    this.addFact({
      timestamp: notification.timestamp,
      source: 'os',
      category: 'notification',
      data: notification,
      confidence: 1.0,
    });
  }

  /**
   * Record error detection
   */
  recordError(error: ErrorDetection): void {
    this.recentErrors.unshift(error);
    this.errorCount++;
    
    if (this.recentErrors.length > this.MAX_ERRORS) {
      this.recentErrors = this.recentErrors.slice(0, this.MAX_ERRORS);
    }
    
    // Track frustration
    if (this.errorCount > 3) {
      this.frustrationIndicators.push('multiple_errors');
    }
    
    this.addFact({
      timestamp: error.timestamp,
      source: 'os',
      category: 'error',
      data: error,
      confidence: 0.9,
    });
    
    auditLog('ERROR_DETECTED', { 
      app: error.app, 
      type: error.type,
      message: error.message.substring(0, 100),
    });
  }

  /**
   * Update display info
   */
  updateDisplay(display: DisplayInfo): void {
    this.displayInfo = display;
    
    this.addFact({
      timestamp: new Date(),
      source: 'os',
      category: 'display',
      data: display,
      confidence: 1.0,
    });
  }

  /**
   * Mark user as idle
   */
  markIdle(): void {
    this.isUserActive = false;
    this.rapidSwitchCount = 0;
  }

  /**
   * Add a perception fact
   */
  addFact(fact: PerceptionFact): void {
    this.facts.unshift(fact);
    
    if (this.facts.length > this.MAX_FACTS) {
      this.facts = this.facts.slice(0, this.MAX_FACTS);
    }
  }

  /**
   * Get current snapshot
   */
  getSnapshot(): PerceptionSnapshot {
    const now = new Date();
    const timeSinceActivity = now.getTime() - this.lastActivityTime.getTime();
    
    return {
      timestamp: now,
      window: this.currentWindow,
      audio: this.currentAudio,
      notifications: this.recentNotifications.slice(0, 10),
      errors: this.recentErrors.slice(0, 5),
      display: this.displayInfo,
      facts: this.facts.slice(0, 50),
      insights: {
        userActive: timeSinceActivity < this.idleThresholdMs,
        lastActivity: this.lastActivityTime,
        currentContext: this.inferContext(),
        potentialFrustration: this.frustrationIndicators.length > 0,
      },
    };
  }

  /**
   * Infer current context from state
   */
  private inferContext(): string {
    if (!this.currentWindow) return 'unknown';
    
    const app = this.currentWindow.app.toLowerCase();
    const title = this.currentWindow.title.toLowerCase();
    
    // Coding
    if (['code', 'vscode', 'sublime', 'vim', 'neovim', 'intellij', 'xcode'].some(a => app.includes(a))) {
      return 'coding';
    }
    
    // Music production
    if (['ableton', 'logic', 'fl studio', 'pro tools', 'garageband', 'reaper'].some(a => app.includes(a))) {
      return 'music_production';
    }
    
    // Communication
    if (['slack', 'discord', 'teams', 'zoom', 'messages', 'mail'].some(a => app.includes(a))) {
      return 'communication';
    }
    
    // Browsing
    if (['chrome', 'firefox', 'safari', 'edge', 'brave', 'arc'].some(a => app.includes(a))) {
      if (title.includes('youtube') || title.includes('netflix') || title.includes('twitch')) {
        return 'entertainment';
      }
      if (title.includes('github') || title.includes('stackoverflow')) {
        return 'development';
      }
      return 'browsing';
    }
    
    // Gaming
    if (['steam', 'epic', 'game'].some(a => app.includes(a) || title.includes(a))) {
      return 'gaming';
    }
    
    return 'general';
  }

  /**
   * Reset frustration indicators
   */
  resetFrustration(): void {
    this.frustrationIndicators = [];
    this.errorCount = 0;
    this.rapidSwitchCount = 0;
  }

  /**
   * Get facts filtered by category
   */
  getFactsByCategory(category: PerceptionFact['category'], limit = 20): PerceptionFact[] {
    return this.facts
      .filter(f => f.category === category)
      .slice(0, limit);
  }

  /**
   * Get app usage summary
   */
  getAppUsageSummary(): { app: string; minutes: number; switches: number }[] {
    return Array.from(this.appUsage.entries())
      .map(([app, usage]) => ({
        app,
        minutes: Math.round(usage.totalTime / 60000),
        switches: usage.switchCount,
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
  }
}

// =============================================================================
// PERCEPTION AGENT
// =============================================================================

export class NativePerceptionAgent extends EventEmitter {
  private state: PerceptionState;
  private pollingInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    this.state = new PerceptionState();
  }

  /**
   * Start the perception agent
   */
  start(): void {
    logger.info('Starting native perception agent');
    
    // Start idle detection
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.state.lastActivityTime.getTime();
      if (timeSinceActivity > this.state.idleThresholdMs && this.state.isUserActive) {
        this.state.markIdle();
        this.emit('idle');
      }
    }, 30000); // Check every 30 seconds
    
    this.emit('started');
  }

  /**
   * Stop the perception agent
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    
    this.emit('stopped');
    logger.info('Native perception agent stopped');
  }

  /**
   * Process incoming perception data from native client
   */
  ingest(data: {
    type: 'window' | 'audio' | 'notification' | 'error' | 'display' | 'input';
    payload: any;
  }): void {
    const { type, payload } = data;
    
    switch (type) {
      case 'window':
        this.state.updateWindow(payload as WindowInfo);
        this.emit('window_change', payload);
        break;
        
      case 'audio':
        this.state.updateAudio(payload as AudioState);
        this.emit('audio_change', payload);
        break;
        
      case 'notification':
        this.state.addNotification({
          ...payload,
          timestamp: new Date(),
        } as SystemNotification);
        this.emit('notification', payload);
        break;
        
      case 'error':
        this.state.recordError({
          ...payload,
          timestamp: new Date(),
        } as ErrorDetection);
        this.emit('error_detected', payload);
        break;
        
      case 'display':
        this.state.updateDisplay(payload as DisplayInfo);
        this.emit('display_change', payload);
        break;
        
      case 'input':
        // Mouse/keyboard activity
        this.state.lastActivityTime = new Date();
        this.state.isUserActive = true;
        break;
    }
  }

  /**
   * Get current perception snapshot
   */
  getSnapshot(): PerceptionSnapshot {
    return this.state.getSnapshot();
  }

  /**
   * Get current context for LLM
   */
  getContextForLLM(): string {
    const snapshot = this.state.getSnapshot();
    const parts: string[] = [];
    
    if (snapshot.window) {
      parts.push(`Currently in: ${snapshot.window.app} - "${snapshot.window.title}"`);
    }
    
    parts.push(`Context: ${snapshot.insights.currentContext}`);
    parts.push(`User ${snapshot.insights.userActive ? 'active' : 'idle'}`);
    
    if (snapshot.insights.potentialFrustration) {
      parts.push('⚠️ Potential frustration detected');
    }
    
    if (snapshot.errors.length > 0) {
      parts.push(`Recent errors: ${snapshot.errors.map(e => e.message).join(', ')}`);
    }
    
    if (snapshot.audio?.activeApps.length) {
      parts.push(`Audio playing: ${snapshot.audio.activeApps.join(', ')}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Check if user is likely interruptible
   */
  isInterruptible(): { canInterrupt: boolean; reason: string } {
    const snapshot = this.state.getSnapshot();
    
    // Don't interrupt if idle
    if (!snapshot.insights.userActive) {
      return { canInterrupt: false, reason: 'User is idle' };
    }
    
    // Be careful during focused work
    const focusedContexts = ['coding', 'music_production', 'gaming'];
    if (focusedContexts.includes(snapshot.insights.currentContext)) {
      return { canInterrupt: false, reason: `User is focused on ${snapshot.insights.currentContext}` };
    }
    
    // Check for full-screen video
    if (snapshot.window?.title.toLowerCase().includes('fullscreen')) {
      return { canInterrupt: false, reason: 'User appears to be in fullscreen mode' };
    }
    
    // Check audio state
    if (snapshot.audio?.activeApps.some(app => 
      ['zoom', 'teams', 'meet'].some(m => app.toLowerCase().includes(m))
    )) {
      return { canInterrupt: false, reason: 'User may be in a call' };
    }
    
    return { canInterrupt: true, reason: 'User appears interruptible' };
  }

  /**
   * Get app usage summary
   */
  getAppUsage(): { app: string; minutes: number; switches: number }[] {
    return this.state.getAppUsageSummary();
  }

  /**
   * Reset state (e.g., at start of day)
   */
  resetDaily(): void {
    this.state.resetFrustration();
    this.state.appUsage.clear();
    this.state.windowHistory = [];
    logger.info('Perception state reset for new day');
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const perceptionAgent = new NativePerceptionAgent();

// =============================================================================
// NATIVE CLIENT PROTOCOL
// =============================================================================

/**
 * Protocol definition for native client communication.
 * The native client (Swift/Kotlin/Electron) should send messages in this format.
 */
export const PERCEPTION_PROTOCOL = {
  version: '1.0',
  
  // Message types native client should send
  messageTypes: {
    WINDOW_CHANGE: 'window',
    AUDIO_CHANGE: 'audio',
    NOTIFICATION: 'notification',
    ERROR_DETECTED: 'error',
    DISPLAY_CHANGE: 'display',
    USER_INPUT: 'input',
  },
  
  // Expected payload shapes
  payloads: {
    window: {
      app: 'string',
      title: 'string',
      bundleId: 'string?',
      pid: 'number?',
    },
    audio: {
      outputDevice: 'string',
      inputDevice: 'string?',
      volume: 'number',
      muted: 'boolean',
      activeApps: 'string[]',
    },
    notification: {
      id: 'string',
      app: 'string',
      title: 'string',
      body: 'string',
      actionable: 'boolean',
    },
    error: {
      detected: 'boolean',
      type: "'dialog' | 'notification' | 'crash' | 'hang'",
      app: 'string',
      message: 'string',
    },
    display: {
      count: 'number',
      primary: { width: 'number', height: 'number', scale: 'number' },
      cursorPosition: '{ x: number, y: number }?',
    },
  },
};
