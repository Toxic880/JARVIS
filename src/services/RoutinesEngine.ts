/**
 * ROUTINES ENGINE
 * Handles automated sequences with voice AND time-based triggers
 * 
 * Features:
 * - Voice triggers: "good morning", "I'm leaving"
 * - Time triggers: "7:00 AM every weekday"
 * - Action sequences: weather, calendar, device control, etc.
 */

import { Routine, RoutineAction, JarvisState } from '../types';

const STORAGE_KEY = 'jarvis_routines';
const SCHEDULE_KEY = 'jarvis_routine_schedule';

export interface ScheduledTrigger {
  type: 'time';
  time: string;        // "07:00" 24-hour format
  days: number[];      // [1,2,3,4,5] for weekdays, [0,6] for weekend, [] for daily
  enabled: boolean;
}

export interface VoiceTrigger {
  type: 'voice';
  phrase: string;
}

export type RoutineTrigger = VoiceTrigger | ScheduledTrigger;

// Default routines that come pre-configured
const DEFAULT_ROUTINES: Routine[] = [
  {
    id: 'good-morning',
    name: 'Good Morning',
    trigger: { type: 'voice', phrase: 'good morning' },
    actions: [
      { type: 'speak', message: 'Good morning, Sir. Let me brief you on the day ahead.' },
      { type: 'weather' },
      { type: 'calendar' },
      { type: 'news' },
      { type: 'reminders' },
    ],
    enabled: true,
  },
  {
    id: 'good-night',
    name: 'Good Night',
    trigger: { type: 'voice', phrase: 'good night' },
    actions: [
      { type: 'speak', message: 'Goodnight, Sir. Sleep well.' },
      { type: 'device', deviceId: 'all_lights', action: 'turn_off' },
      { type: 'calendar_tomorrow' },
    ],
    enabled: true,
  },
  {
    id: 'leaving-home',
    name: 'Leaving Home',
    trigger: { type: 'voice', phrase: 'i\'m leaving' },
    actions: [
      { type: 'speak', message: 'Have a good day, Sir.' },
      { type: 'device', deviceId: 'all_lights', action: 'turn_off' },
      { type: 'traffic' },
      { type: 'weather' },
    ],
    enabled: true,
  },
  {
    id: 'coming-home',
    name: 'Coming Home',
    trigger: { type: 'voice', phrase: 'i\'m home' },
    actions: [
      { type: 'speak', message: 'Welcome home, Sir.' },
      { type: 'device', deviceId: 'living_room_lights', action: 'turn_on' },
      { type: 'messages' },
      { type: 'reminders' },
    ],
    enabled: true,
  },
  {
    id: 'status-report',
    name: 'Status Report',
    trigger: { type: 'voice', phrase: 'status report' },
    actions: [
      { type: 'system_status' },
      { type: 'weather' },
      { type: 'calendar' },
      { type: 'reminders' },
      { type: 'timers' },
    ],
    enabled: true,
  },
  {
    id: 'whats-new',
    name: 'What\'s New',
    trigger: { type: 'voice', phrase: 'what\'s new' },
    actions: [
      { type: 'news' },
      { type: 'stocks' },
    ],
    enabled: true,
  },
  // TIME-BASED DEFAULTS
  {
    id: 'weekday-morning',
    name: 'Weekday Morning Briefing',
    trigger: { type: 'time', time: '07:00', days: [1, 2, 3, 4, 5], enabled: false },
    actions: [
      { type: 'speak', message: 'Good morning, Sir. Here is your morning briefing.' },
      { type: 'weather' },
      { type: 'calendar' },
      { type: 'traffic' },
    ],
    enabled: false, // User must enable
  },
  {
    id: 'evening-summary',
    name: 'Evening Summary',
    trigger: { type: 'time', time: '21:00', days: [], enabled: false },
    actions: [
      { type: 'speak', message: 'Good evening, Sir. Here is your evening summary.' },
      { type: 'calendar_tomorrow' },
      { type: 'reminders' },
    ],
    enabled: false,
  },
];

export interface RoutineResult {
  routine: Routine;
  results: string[];
}

export class RoutinesEngine {
  private routines: Routine[] = [];
  private state: JarvisState;
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private lastTriggered: Map<string, string> = new Map(); // routineId -> "YYYY-MM-DD HH:mm"
  private onRoutineTrigger?: (routine: Routine) => void;
  
  constructor(state: JarvisState, onRoutineTrigger?: (routine: Routine) => void) {
    this.state = state;
    this.onRoutineTrigger = onRoutineTrigger;
    this.loadRoutines();
    this.loadScheduleState();
    this.startScheduler();
  }

  private loadRoutines() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.routines = JSON.parse(saved);
      } else {
        this.routines = [...DEFAULT_ROUTINES];
        this.saveRoutines();
      }
    } catch {
      this.routines = [...DEFAULT_ROUTINES];
    }
  }

  private saveRoutines() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.routines));
  }

  private loadScheduleState() {
    try {
      const saved = localStorage.getItem(SCHEDULE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        this.lastTriggered = new Map(Object.entries(data));
      }
    } catch {
      // Ignore
    }
  }

  private saveScheduleState() {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(Object.fromEntries(this.lastTriggered)));
  }

  public updateState(state: JarvisState) {
    this.state = state;
  }

  // ===========================================================================
  // TIME-BASED SCHEDULING
  // ===========================================================================

  private startScheduler() {
    // Check every minute
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledRoutines();
    }, 60000);
    
    // Also check immediately on start
    this.checkScheduledRoutines();
    
    console.log('[Routines] Scheduler started');
  }

  public stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  private checkScheduledRoutines() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = now.getDay(); // 0 = Sunday
    const dateKey = now.toISOString().split('T')[0] + ' ' + currentTime;

    for (const routine of this.routines) {
      if (!routine.enabled) continue;
      
      const trigger = routine.trigger as ScheduledTrigger;
      if (trigger.type !== 'time' || !trigger.enabled) continue;

      // Check if time matches
      if (trigger.time !== currentTime) continue;

      // Check if day matches (empty array = every day)
      if (trigger.days.length > 0 && !trigger.days.includes(currentDay)) continue;

      // Check if already triggered this minute
      const lastTrigger = this.lastTriggered.get(routine.id);
      if (lastTrigger === dateKey) continue;

      // Trigger the routine!
      console.log('[Routines] Time trigger:', routine.name, 'at', currentTime);
      this.lastTriggered.set(routine.id, dateKey);
      this.saveScheduleState();

      if (this.onRoutineTrigger) {
        this.onRoutineTrigger(routine);
      }
    }
  }

  // ===========================================================================
  // VOICE TRIGGERS
  // ===========================================================================

  /**
   * Check if user input triggers a routine
   */
  public checkTrigger(input: string): Routine | null {
    const normalized = input.toLowerCase().trim();
    
    for (const routine of this.routines) {
      if (!routine.enabled) continue;
      
      const trigger = routine.trigger as VoiceTrigger;
      if (trigger.type === 'voice' && trigger.phrase) {
        if (normalized.includes(trigger.phrase.toLowerCase())) {
          return routine;
        }
      }
    }
    
    return null;
  }

  // ===========================================================================
  // ROUTINE MANAGEMENT
  // ===========================================================================

  public getRoutines(): Routine[] {
    return [...this.routines];
  }

  public getScheduledRoutines(): Routine[] {
    return this.routines.filter(r => (r.trigger as any).type === 'time');
  }

  public getVoiceRoutines(): Routine[] {
    return this.routines.filter(r => (r.trigger as any).type === 'voice');
  }

  public addRoutine(routine: Omit<Routine, 'id'>): Routine {
    const newRoutine: Routine = {
      ...routine,
      id: crypto.randomUUID(),
    };
    this.routines.push(newRoutine);
    this.saveRoutines();
    return newRoutine;
  }

  /**
   * Add a time-based routine
   */
  public addScheduledRoutine(
    name: string,
    time: string,
    days: number[],
    actions: RoutineAction[]
  ): Routine {
    return this.addRoutine({
      name,
      trigger: { type: 'time', time, days, enabled: true },
      actions,
      enabled: true,
    });
  }

  public updateRoutine(id: string, updates: Partial<Routine>): boolean {
    const index = this.routines.findIndex(r => r.id === id);
    if (index === -1) return false;
    
    this.routines[index] = { ...this.routines[index], ...updates };
    this.saveRoutines();
    return true;
  }

  public deleteRoutine(id: string): boolean {
    const initialLength = this.routines.length;
    this.routines = this.routines.filter(r => r.id !== id);
    if (this.routines.length < initialLength) {
      this.saveRoutines();
      this.lastTriggered.delete(id);
      this.saveScheduleState();
      return true;
    }
    return false;
  }

  public toggleRoutine(id: string): boolean {
    const routine = this.routines.find(r => r.id === id);
    if (!routine) return false;
    
    routine.enabled = !routine.enabled;
    this.saveRoutines();
    return true;
  }

  /**
   * Enable/disable just the schedule trigger (for time-based routines)
   */
  public toggleScheduleTrigger(id: string): boolean {
    const routine = this.routines.find(r => r.id === id);
    if (!routine) return false;
    
    const trigger = routine.trigger as ScheduledTrigger;
    if (trigger.type !== 'time') return false;
    
    trigger.enabled = !trigger.enabled;
    this.saveRoutines();
    return true;
  }

  public resetToDefaults(): void {
    this.routines = [...DEFAULT_ROUTINES];
    this.saveRoutines();
    this.lastTriggered.clear();
    this.saveScheduleState();
  }

  /**
   * Get next scheduled run time for a routine
   */
  public getNextRunTime(id: string): Date | null {
    const routine = this.routines.find(r => r.id === id);
    if (!routine || !routine.enabled) return null;
    
    const trigger = routine.trigger as ScheduledTrigger;
    if (trigger.type !== 'time' || !trigger.enabled) return null;

    const [hours, minutes] = trigger.time.split(':').map(Number);
    const now = new Date();
    
    // Start from today
    let nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // If today's time has passed, start from tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    // If specific days, find the next matching day
    if (trigger.days.length > 0) {
      while (!trigger.days.includes(nextRun.getDay())) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
    }
    
    return nextRun;
  }
}

