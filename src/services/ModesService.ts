/**
 * MODES SERVICE - JARVIS Operating Modes
 * 
 * Different modes change how JARVIS behaves:
 * 
 * - NORMAL: Full functionality
 * - DND (Do Not Disturb): No proactive alerts, limited responses
 * - SLEEP: Minimal interaction, no sounds, emergency only
 * - GUEST: Limited personal info, public-friendly responses
 * - PARTY: Music mode, fun responses, limited serious functions
 * - AWAY: Security focus, presence simulation, monitoring only
 * - FOCUS: No interruptions except priority items
 */

export type JarvisMode = 'normal' | 'dnd' | 'sleep' | 'guest' | 'party' | 'away' | 'focus';

export interface ModeConfig {
  name: string;
  description: string;
  allowProactiveAlerts: boolean;
  allowedAlertPriorities: ('low' | 'medium' | 'high' | 'urgent')[];
  speakResponses: boolean;
  volumeMultiplier: number;
  revealPersonalInfo: boolean;
  allowSmartHomeControl: boolean;
  allowMediaControl: boolean;
  allowCommunications: boolean;
  customPromptAddition?: string;
  autoExitAfter?: number; // minutes
  scheduledStart?: string; // HH:MM
  scheduledEnd?: string; // HH:MM
}

export interface ScheduledMode {
  mode: JarvisMode;
  startTime: string; // HH:MM
  endTime: string;
  days: number[]; // 0=Sunday, 6=Saturday
  enabled: boolean;
}

export interface ModeChangeEvent {
  previousMode: JarvisMode;
  newMode: JarvisMode;
  reason: 'manual' | 'scheduled' | 'auto' | 'timeout';
  timestamp: Date;
}

const MODE_CONFIGS: Record<JarvisMode, ModeConfig> = {
  normal: {
    name: 'Normal',
    description: 'Full JARVIS functionality',
    allowProactiveAlerts: true,
    allowedAlertPriorities: ['low', 'medium', 'high', 'urgent'],
    speakResponses: true,
    volumeMultiplier: 1.0,
    revealPersonalInfo: true,
    allowSmartHomeControl: true,
    allowMediaControl: true,
    allowCommunications: true,
  },
  
  dnd: {
    name: 'Do Not Disturb',
    description: 'No interruptions except emergencies',
    allowProactiveAlerts: true,
    allowedAlertPriorities: ['urgent'],
    speakResponses: true,
    volumeMultiplier: 0.5,
    revealPersonalInfo: true,
    allowSmartHomeControl: true,
    allowMediaControl: true,
    allowCommunications: false, // Won't announce calls/messages
    customPromptAddition: 'The user is in Do Not Disturb mode. Keep responses brief and only mention urgent matters.',
  },
  
  sleep: {
    name: 'Sleep Mode',
    description: 'Minimal interaction, no sounds',
    allowProactiveAlerts: true,
    allowedAlertPriorities: ['urgent'], // Only emergencies
    speakResponses: false, // Silent unless emergency
    volumeMultiplier: 0.0,
    revealPersonalInfo: true,
    allowSmartHomeControl: true, // Can still turn off lights etc
    allowMediaControl: false,
    allowCommunications: false,
    customPromptAddition: 'The user is sleeping. Only respond to genuine emergencies. Do not speak unless absolutely necessary.',
    scheduledStart: '22:00',
    scheduledEnd: '07:00',
  },
  
  guest: {
    name: 'Guest Mode',
    description: 'Privacy-safe mode for visitors',
    allowProactiveAlerts: false,
    allowedAlertPriorities: [],
    speakResponses: true,
    volumeMultiplier: 1.0,
    revealPersonalInfo: false, // Hide calendars, emails, personal data
    allowSmartHomeControl: true, // Basic controls only
    allowMediaControl: true,
    allowCommunications: false, // Don't read messages aloud
    customPromptAddition: 'There are guests present. Do not reveal any personal information like calendar events, emails, messages, or personal details. Be friendly and helpful but privacy-focused.',
    autoExitAfter: 240, // 4 hours
  },
  
  party: {
    name: 'Party Mode',
    description: 'Fun mode for entertaining',
    allowProactiveAlerts: false,
    allowedAlertPriorities: ['urgent'],
    speakResponses: true,
    volumeMultiplier: 1.2, // Louder for parties
    revealPersonalInfo: false,
    allowSmartHomeControl: true,
    allowMediaControl: true,
    allowCommunications: false,
    customPromptAddition: 'Party mode is active. Be fun, entertaining, and upbeat. Handle music requests enthusiastically. Don\'t mention work, calendars, or serious matters unless asked directly.',
    autoExitAfter: 360, // 6 hours
  },
  
  away: {
    name: 'Away Mode',
    description: 'Security monitoring while away',
    allowProactiveAlerts: true,
    allowedAlertPriorities: ['high', 'urgent'],
    speakResponses: false, // Don't speak to empty house
    volumeMultiplier: 0.0,
    revealPersonalInfo: true,
    allowSmartHomeControl: true,
    allowMediaControl: false,
    allowCommunications: true, // Forward important messages
    customPromptAddition: 'The user is away from home. Focus on security and monitoring. Any unusual activity should be flagged.',
  },
  
  focus: {
    name: 'Focus Mode',
    description: 'Deep work, minimal interruptions',
    allowProactiveAlerts: true,
    allowedAlertPriorities: ['high', 'urgent'],
    speakResponses: true,
    volumeMultiplier: 0.7,
    revealPersonalInfo: true,
    allowSmartHomeControl: true,
    allowMediaControl: false, // No random music
    allowCommunications: false,
    customPromptAddition: 'The user is in focus mode for deep work. Keep responses extremely brief and to the point. Don\'t initiate conversation.',
    autoExitAfter: 180, // 3 hours
  },
};

export class ModesService {
  private currentMode: JarvisMode = 'normal';
  private modeStartTime: Date = new Date();
  private scheduledModes: ScheduledMode[] = [];
  private modeHistory: ModeChangeEvent[] = [];
  private onModeChange?: (event: ModeChangeEvent) => void;
  private autoExitTimer?: NodeJS.Timeout;
  private scheduleChecker?: NodeJS.Timeout;

  constructor(onModeChange?: (event: ModeChangeEvent) => void) {
    this.onModeChange = onModeChange;
    this.loadState();
    this.startScheduleChecker();
  }

  private loadState() {
    const saved = localStorage.getItem('jarvis_mode');
    if (saved) {
      const state = JSON.parse(saved);
      this.currentMode = state.currentMode || 'normal';
      this.modeStartTime = new Date(state.modeStartTime);
      this.scheduledModes = state.scheduledModes || [];
    }
    
    // Load default sleep schedule if none exists
    if (this.scheduledModes.length === 0) {
      this.scheduledModes = [
        {
          mode: 'sleep',
          startTime: '23:00',
          endTime: '07:00',
          days: [0, 1, 2, 3, 4, 5, 6], // Every day
          enabled: false, // Disabled by default
        },
      ];
    }
  }

  private saveState() {
    localStorage.setItem('jarvis_mode', JSON.stringify({
      currentMode: this.currentMode,
      modeStartTime: this.modeStartTime.toISOString(),
      scheduledModes: this.scheduledModes,
    }));
  }

  /**
   * Get current mode
   */
  getCurrentMode(): JarvisMode {
    return this.currentMode;
  }

  /**
   * Get current mode configuration
   */
  getCurrentConfig(): ModeConfig {
    return MODE_CONFIGS[this.currentMode];
  }

  /**
   * Get config for any mode
   */
  getModeConfig(mode: JarvisMode): ModeConfig {
    return MODE_CONFIGS[mode];
  }

  /**
   * Get all available modes
   */
  getAllModes(): { mode: JarvisMode; config: ModeConfig }[] {
    return Object.entries(MODE_CONFIGS).map(([mode, config]) => ({
      mode: mode as JarvisMode,
      config,
    }));
  }

  /**
   * Set mode manually
   */
  setMode(mode: JarvisMode, reason: 'manual' | 'scheduled' | 'auto' = 'manual'): void {
    if (mode === this.currentMode) return;

    const event: ModeChangeEvent = {
      previousMode: this.currentMode,
      newMode: mode,
      reason,
      timestamp: new Date(),
    };

    this.currentMode = mode;
    this.modeStartTime = new Date();
    this.modeHistory.push(event);

    // Clear existing auto-exit timer
    if (this.autoExitTimer) {
      clearTimeout(this.autoExitTimer);
      this.autoExitTimer = undefined;
    }

    // Set auto-exit if configured
    const config = MODE_CONFIGS[mode];
    if (config.autoExitAfter) {
      this.autoExitTimer = setTimeout(() => {
        this.setMode('normal', 'timeout');
      }, config.autoExitAfter * 60 * 1000);
    }

    this.saveState();
    this.onModeChange?.(event);

    console.log(`[Modes] Changed from ${event.previousMode} to ${event.newMode} (${reason})`);
  }

  /**
   * Check if an action is allowed in current mode
   */
  isAllowed(action: 'proactiveAlert' | 'speak' | 'personalInfo' | 'smartHome' | 'media' | 'communications'): boolean {
    const config = this.getCurrentConfig();
    
    switch (action) {
      case 'proactiveAlert':
        return config.allowProactiveAlerts;
      case 'speak':
        return config.speakResponses;
      case 'personalInfo':
        return config.revealPersonalInfo;
      case 'smartHome':
        return config.allowSmartHomeControl;
      case 'media':
        return config.allowMediaControl;
      case 'communications':
        return config.allowCommunications;
      default:
        return true;
    }
  }

  /**
   * Check if a specific alert priority is allowed
   */
  isAlertPriorityAllowed(priority: 'low' | 'medium' | 'high' | 'urgent'): boolean {
    const config = this.getCurrentConfig();
    return config.allowedAlertPriorities.includes(priority);
  }

  /**
   * Get volume multiplier for current mode
   */
  getVolumeMultiplier(): number {
    return this.getCurrentConfig().volumeMultiplier;
  }

  /**
   * Get custom prompt addition for LLM
   */
  getPromptAddition(): string | undefined {
    return this.getCurrentConfig().customPromptAddition;
  }

  /**
   * Get how long current mode has been active
   */
  getModeUptime(): number {
    return Date.now() - this.modeStartTime.getTime();
  }

  // ==========================================================================
  // SCHEDULED MODES
  // ==========================================================================

  /**
   * Add a scheduled mode
   */
  addScheduledMode(schedule: ScheduledMode): void {
    this.scheduledModes.push(schedule);
    this.saveState();
  }

  /**
   * Remove a scheduled mode
   */
  removeScheduledMode(index: number): void {
    this.scheduledModes.splice(index, 1);
    this.saveState();
  }

  /**
   * Update a scheduled mode
   */
  updateScheduledMode(index: number, schedule: Partial<ScheduledMode>): void {
    this.scheduledModes[index] = { ...this.scheduledModes[index], ...schedule };
    this.saveState();
  }

  /**
   * Get all scheduled modes
   */
  getScheduledModes(): ScheduledMode[] {
    return this.scheduledModes;
  }

  /**
   * Start the schedule checker
   */
  private startScheduleChecker(): void {
    // Check every minute
    this.scheduleChecker = setInterval(() => {
      this.checkScheduledModes();
    }, 60000);
    
    // Also check immediately
    this.checkScheduledModes();
  }

  /**
   * Check if any scheduled mode should activate/deactivate
   */
  private checkScheduledModes(): void {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay();

    for (const schedule of this.scheduledModes) {
      if (!schedule.enabled) continue;
      if (!schedule.days.includes(currentDay)) continue;

      // Check if we should enter this mode
      if (currentTime === schedule.startTime && this.currentMode !== schedule.mode) {
        this.setMode(schedule.mode, 'scheduled');
      }

      // Check if we should exit this mode
      if (currentTime === schedule.endTime && this.currentMode === schedule.mode) {
        this.setMode('normal', 'scheduled');
      }
    }
  }

  // ==========================================================================
  // MODE HISTORY
  // ==========================================================================

  /**
   * Get mode change history
   */
  getModeHistory(limit: number = 20): ModeChangeEvent[] {
    return this.modeHistory.slice(-limit);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Destroy the service
   */
  destroy(): void {
    if (this.autoExitTimer) clearTimeout(this.autoExitTimer);
    if (this.scheduleChecker) clearInterval(this.scheduleChecker);
  }

  // ==========================================================================
  // FORMATTING FOR SPEECH
  // ==========================================================================

  /**
   * Format mode change for JARVIS to speak
   */
  formatModeChangeForSpeech(event: ModeChangeEvent): string {
    const config = MODE_CONFIGS[event.newMode];
    
    switch (event.newMode) {
      case 'dnd':
        return "Do not disturb mode activated. I'll only alert you for emergencies.";
      case 'sleep':
        return "Sleep mode activated. Goodnight, sir. I'll keep watch.";
      case 'guest':
        return "Guest mode activated. I'll keep things professional and private.";
      case 'party':
        return "Party mode! Let's have some fun. What would you like to hear?";
      case 'away':
        return "Away mode activated. Security monitoring enabled. Safe travels.";
      case 'focus':
        return "Focus mode. I'll keep interruptions to a minimum.";
      case 'normal':
        return event.previousMode === 'sleep' 
          ? "Good morning, sir. Normal mode resumed."
          : "Normal mode resumed.";
      default:
        return `${config.name} mode activated.`;
    }
  }

  /**
   * Get current mode status for speech
   */
  formatStatusForSpeech(): string {
    const config = this.getCurrentConfig();
    const uptime = this.getModeUptime();
    const hours = Math.floor(uptime / 3600000);
    const mins = Math.floor((uptime % 3600000) / 60000);

    let duration = '';
    if (hours > 0) {
      duration = `for ${hours} hour${hours !== 1 ? 's' : ''}`;
      if (mins > 0) duration += ` and ${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (mins > 0) {
      duration = `for ${mins} minute${mins !== 1 ? 's' : ''}`;
    } else {
      duration = 'just now';
    }

    return `Currently in ${config.name} mode, active ${duration}.`;
  }
}
