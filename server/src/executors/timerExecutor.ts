/**
 * Timer Executor
 * 
 * Handles timers, alarms, and reminders.
 * These run in-process with persistence to database.
 */

import { z } from 'zod';
import { 
  IToolExecutor, 
  ToolCapability, 
  ExecutionResult, 
  ExecutionSideEffect 
} from './interface';
import { getDatabase } from '../db/init';
import { logger } from '../services/logger';

// =============================================================================
// ACTIVE TIMERS (in-memory with DB persistence)
// =============================================================================

interface ActiveTimer {
  id: string;
  label: string;
  duration: number; // total seconds
  remaining: number; // seconds remaining
  startedAt: Date;
  pausedAt?: Date;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  onComplete?: () => void;
}

interface ActiveAlarm {
  id: string;
  label: string;
  time: string; // HH:MM
  days?: string[]; // For recurring: ['monday', 'tuesday', ...]
  enabled: boolean;
  nextTrigger: Date;
}

interface ActiveReminder {
  id: string;
  message: string;
  triggerAt: Date;
  triggered: boolean;
}

// In-memory storage
const activeTimers: Map<string, ActiveTimer> = new Map();
const activeAlarms: Map<string, ActiveAlarm> = new Map();
const activeReminders: Map<string, ActiveReminder> = new Map();

// Timer intervals
const timerIntervals: Map<string, NodeJS.Timeout> = new Map();

// Callbacks
let onTimerComplete: ((timer: ActiveTimer) => void) | null = null;
let onAlarmTrigger: ((alarm: ActiveAlarm) => void) | null = null;
let onReminderTrigger: ((reminder: ActiveReminder) => void) | null = null;

// =============================================================================
// TIMER MANAGEMENT
// =============================================================================

function startTimerCountdown(timer: ActiveTimer): void {
  // Clear existing interval if any
  const existingInterval = timerIntervals.get(timer.id);
  if (existingInterval) {
    clearInterval(existingInterval);
  }

  const interval = setInterval(() => {
    const t = activeTimers.get(timer.id);
    if (!t || t.status !== 'running') {
      clearInterval(interval);
      timerIntervals.delete(timer.id);
      return;
    }

    t.remaining -= 1;

    if (t.remaining <= 0) {
      t.status = 'completed';
      clearInterval(interval);
      timerIntervals.delete(timer.id);
      
      logger.info('Timer completed', { id: t.id, label: t.label });
      onTimerComplete?.(t);
    }
  }, 1000);

  timerIntervals.set(timer.id, interval);
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class TimerExecutor implements IToolExecutor {
  readonly id = 'timer-executor';
  readonly name = 'Timer & Alarm Executor';
  readonly category = 'timer';

  constructor(callbacks?: {
    onTimerComplete?: (timer: ActiveTimer) => void;
    onAlarmTrigger?: (alarm: ActiveAlarm) => void;
    onReminderTrigger?: (reminder: ActiveReminder) => void;
  }) {
    if (callbacks?.onTimerComplete) onTimerComplete = callbacks.onTimerComplete;
    if (callbacks?.onAlarmTrigger) onAlarmTrigger = callbacks.onAlarmTrigger;
    if (callbacks?.onReminderTrigger) onReminderTrigger = callbacks.onReminderTrigger;
  }

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'setTimer',
        description: 'Set a countdown timer',
        schema: z.object({
          duration: z.number().min(1).max(86400),
          label: z.string().max(100).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'cancelTimer',
        description: 'Cancel a timer',
        schema: z.object({
          label: z.string().optional(),
          id: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: false,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'pauseTimer',
        description: 'Pause a running timer',
        schema: z.object({
          label: z.string().optional(),
          id: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'resumeTimer',
        description: 'Resume a paused timer',
        schema: z.object({
          label: z.string().optional(),
          id: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getTimers',
        description: 'Get all active timers',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'setAlarm',
        description: 'Set an alarm for a specific time',
        schema: z.object({
          time: z.string().regex(/^\d{1,2}:\d{2}$/),
          label: z.string().max(100).optional(),
          days: z.array(z.string()).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'cancelAlarm',
        description: 'Cancel an alarm',
        schema: z.object({
          label: z.string().optional(),
          id: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: false,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getAlarms',
        description: 'Get all alarms',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'setReminder',
        description: 'Set a reminder',
        schema: z.object({
          message: z.string().max(500),
          time: z.string(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getReminders',
        description: 'Get all pending reminders',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
    ];
  }

  canExecute(toolName: string): boolean {
    return this.getCapabilities().some(c => c.name === toolName);
  }

  validate(toolName: string, params: Record<string, any>) {
    const cap = this.getCapabilities().find(c => c.name === toolName);
    if (!cap) {
      return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    }

    const result = cap.schema.safeParse(params);
    if (!result.success) {
      return { 
        valid: false, 
        errors: result.error.issues.map(i => i.message) 
      };
    }

    return { valid: true, sanitizedParams: result.data };
  }

  async simulate(toolName: string, params: Record<string, any>) {
    const predictedSideEffects: ExecutionSideEffect[] = [];
    const warnings: string[] = [];

    switch (toolName) {
      case 'setTimer':
        predictedSideEffects.push({
          type: 'state_change',
          target: 'timers',
          description: `Will create timer "${params.label || 'unnamed'}" for ${params.duration} seconds`,
          reversible: true,
          rollbackAction: 'cancelTimer',
        });
        break;

      case 'setAlarm':
        predictedSideEffects.push({
          type: 'notification',
          target: 'user',
          description: `Will notify at ${params.time}`,
          reversible: true,
          rollbackAction: 'cancelAlarm',
        });
        break;

      case 'setReminder':
        predictedSideEffects.push({
          type: 'notification',
          target: 'user',
          description: `Will remind: "${params.message}"`,
          reversible: true,
        });
        break;
    }

    return {
      wouldSucceed: true,
      predictedOutput: { message: 'Simulation successful' },
      predictedSideEffects,
      warnings,
    };
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();

    try {
      let output: any;
      let message: string;
      const sideEffects: ExecutionSideEffect[] = [];

      switch (toolName) {
        case 'setTimer': {
          const id = `timer_${Date.now()}`;
          const timer: ActiveTimer = {
            id,
            label: params.label || `Timer ${activeTimers.size + 1}`,
            duration: params.duration,
            remaining: params.duration,
            startedAt: new Date(),
            status: 'running',
          };
          
          activeTimers.set(id, timer);
          startTimerCountdown(timer);
          
          output = { id, label: timer.label, duration: params.duration };
          message = `Timer "${timer.label}" set for ${this.formatDuration(params.duration)}`;
          sideEffects.push({
            type: 'state_change',
            target: 'timers',
            description: `Created timer ${id}`,
            reversible: true,
            rollbackAction: `cancelTimer:${id}`,
          });
          break;
        }

        case 'cancelTimer': {
          const timer = this.findTimer(params.label || params.id);
          if (!timer) {
            throw new Error('Timer not found');
          }
          
          timer.status = 'cancelled';
          const interval = timerIntervals.get(timer.id);
          if (interval) clearInterval(interval);
          timerIntervals.delete(timer.id);
          activeTimers.delete(timer.id);
          
          output = { cancelled: timer.id };
          message = `Timer "${timer.label}" cancelled`;
          sideEffects.push({
            type: 'state_change',
            target: 'timers',
            description: `Cancelled timer ${timer.id}`,
            reversible: false,
          });
          break;
        }

        case 'pauseTimer': {
          const timer = this.findTimer(params.label || params.id);
          if (!timer) throw new Error('Timer not found');
          if (timer.status !== 'running') throw new Error('Timer is not running');
          
          timer.status = 'paused';
          timer.pausedAt = new Date();
          const interval = timerIntervals.get(timer.id);
          if (interval) clearInterval(interval);
          
          output = { paused: timer.id, remaining: timer.remaining };
          message = `Timer "${timer.label}" paused with ${this.formatDuration(timer.remaining)} remaining`;
          break;
        }

        case 'resumeTimer': {
          const timer = this.findTimer(params.label || params.id);
          if (!timer) throw new Error('Timer not found');
          if (timer.status !== 'paused') throw new Error('Timer is not paused');
          
          timer.status = 'running';
          timer.pausedAt = undefined;
          startTimerCountdown(timer);
          
          output = { resumed: timer.id, remaining: timer.remaining };
          message = `Timer "${timer.label}" resumed with ${this.formatDuration(timer.remaining)} remaining`;
          break;
        }

        case 'getTimers': {
          const timers = Array.from(activeTimers.values())
            .filter(t => t.status === 'running' || t.status === 'paused')
            .map(t => ({
              id: t.id,
              label: t.label,
              remaining: t.remaining,
              status: t.status,
            }));
          
          output = { timers };
          message = timers.length === 0 
            ? 'No active timers' 
            : `${timers.length} active timer(s)`;
          break;
        }

        case 'setAlarm': {
          const id = `alarm_${Date.now()}`;
          const [hours, minutes] = params.time.split(':').map(Number);
          
          const now = new Date();
          const nextTrigger = new Date();
          nextTrigger.setHours(hours, minutes, 0, 0);
          if (nextTrigger <= now) {
            nextTrigger.setDate(nextTrigger.getDate() + 1);
          }
          
          const alarm: ActiveAlarm = {
            id,
            label: params.label || `Alarm ${params.time}`,
            time: params.time,
            days: params.days,
            enabled: true,
            nextTrigger,
          };
          
          activeAlarms.set(id, alarm);
          
          output = { id, time: params.time, nextTrigger: nextTrigger.toISOString() };
          message = `Alarm set for ${params.time}`;
          break;
        }

        case 'getAlarms': {
          const alarms = Array.from(activeAlarms.values())
            .filter(a => a.enabled)
            .map(a => ({
              id: a.id,
              label: a.label,
              time: a.time,
              days: a.days,
              nextTrigger: a.nextTrigger.toISOString(),
            }));
          
          output = { alarms };
          message = alarms.length === 0 
            ? 'No alarms set' 
            : `${alarms.length} alarm(s)`;
          break;
        }

        case 'cancelAlarm': {
          const alarm = this.findAlarm(params.label || params.id);
          if (!alarm) throw new Error('Alarm not found');
          
          activeAlarms.delete(alarm.id);
          
          output = { cancelled: alarm.id };
          message = `Alarm "${alarm.label}" cancelled`;
          break;
        }

        case 'setReminder': {
          const id = `reminder_${Date.now()}`;
          const triggerAt = this.parseReminderTime(params.time);
          
          const reminder: ActiveReminder = {
            id,
            message: params.message,
            triggerAt,
            triggered: false,
          };
          
          activeReminders.set(id, reminder);
          
          // Schedule reminder
          const delay = triggerAt.getTime() - Date.now();
          if (delay > 0) {
            setTimeout(() => {
              const r = activeReminders.get(id);
              if (r && !r.triggered) {
                r.triggered = true;
                onReminderTrigger?.(r);
              }
            }, delay);
          }
          
          output = { id, triggerAt: triggerAt.toISOString() };
          message = `Reminder set: "${params.message}"`;
          break;
        }

        case 'getReminders': {
          const reminders = Array.from(activeReminders.values())
            .filter(r => !r.triggered)
            .map(r => ({
              id: r.id,
              message: r.message,
              triggerAt: r.triggerAt.toISOString(),
            }));
          
          output = { reminders };
          message = reminders.length === 0 
            ? 'No pending reminders' 
            : `${reminders.length} reminder(s)`;
          break;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      const completedAt = new Date();
      
      return {
        success: true,
        output,
        message,
        sideEffects,
        meta: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };

    } catch (error) {
      const completedAt = new Date();
      return {
        success: false,
        output: null,
        message: error instanceof Error ? error.message : 'Execution failed',
        sideEffects: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
        meta: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };
    }
  }

  // Helper methods
  private findTimer(identifier: string): ActiveTimer | undefined {
    // Try by ID first
    if (activeTimers.has(identifier)) {
      return activeTimers.get(identifier);
    }
    // Then by label
    for (const timer of activeTimers.values()) {
      if (timer.label.toLowerCase() === identifier.toLowerCase()) {
        return timer;
      }
    }
    return undefined;
  }

  private findAlarm(identifier: string): ActiveAlarm | undefined {
    if (activeAlarms.has(identifier)) {
      return activeAlarms.get(identifier);
    }
    for (const alarm of activeAlarms.values()) {
      if (alarm.label.toLowerCase() === identifier.toLowerCase()) {
        return alarm;
      }
    }
    return undefined;
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins} minutes and ${secs} seconds` : `${mins} minutes`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours} hours and ${mins} minutes` : `${hours} hours`;
  }

  private parseReminderTime(time: string): Date {
    const now = new Date();
    
    // Handle relative time like "in 30 minutes"
    const relativeMatch = time.match(/in\s+(\d+)\s+(minute|hour|second)s?/i);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const ms = unit === 'second' ? 1000 : unit === 'minute' ? 60000 : 3600000;
      return new Date(now.getTime() + amount * ms);
    }

    // Handle absolute time like "3pm" or "15:30"
    const timeMatch = time.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2] || '0');
      const meridiem = timeMatch[3]?.toLowerCase();
      
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      
      const result = new Date(now);
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) {
        result.setDate(result.getDate() + 1);
      }
      return result;
    }

    // Default: 30 minutes from now
    return new Date(now.getTime() + 30 * 60000);
  }
}
