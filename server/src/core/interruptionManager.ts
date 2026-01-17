/**
 * Silence & Interruption Budgeting
 * 
 * Jarvis must know:
 * - When NOT to speak
 * - When NOT to suggest
 * - When to wait
 * 
 * Silence is intelligence.
 * 
 * This module manages:
 * - Interruption budgets per time window
 * - Context-aware silence decisions
 * - Urgency thresholds
 * - User focus protection
 */

import { logger, auditLog } from '../services/logger';

// =============================================================================
// TYPES
// =============================================================================

export type InterruptionType = 
  | 'notification'   // Passive info display
  | 'suggestion'     // Proactive recommendation
  | 'question'       // Requires response
  | 'alert'          // Important but not critical
  | 'urgent'         // Time-sensitive, requires attention
  | 'critical';      // Must interrupt immediately

export type UserState = 
  | 'idle'           // No activity
  | 'active'         // General activity
  | 'focused'        // Deep work detected
  | 'presenting'     // Sharing screen/presenting
  | 'meeting'        // In a call/meeting
  | 'dnd'            // Do not disturb
  | 'away';          // AFK

export interface InterruptionRequest {
  type: InterruptionType;
  message: string;
  context?: string;
  urgency: number; // 1-10
  source: string;
  expiresIn?: number; // ms, after which it's no longer relevant
  canDefer?: boolean;
  deferUntil?: 'idle' | 'active' | 'any';
}

export interface InterruptionDecision {
  shouldInterrupt: boolean;
  reason: string;
  deferredUntil?: Date;
  alternativeAction?: 'queue' | 'badge' | 'silent_log' | 'discard';
}

// =============================================================================
// BUDGET CONFIGURATION
// =============================================================================

interface BudgetConfig {
  // Max interruptions per time window
  maxPerHour: number;
  maxPerMinute: number;
  // Cooldown between interruptions (ms)
  cooldownMs: number;
  // Urgency threshold (1-10) to bypass budget
  urgencyBypassThreshold: number;
  // State-based modifiers
  stateMultipliers: Record<UserState, number>;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxPerHour: 10,
  maxPerMinute: 2,
  cooldownMs: 30000, // 30 seconds minimum between interruptions
  urgencyBypassThreshold: 9,
  stateMultipliers: {
    idle: 2.0,        // More interruptions OK when idle
    active: 1.0,      // Normal budget
    focused: 0.2,     // Very few interruptions
    presenting: 0.0,  // No interruptions (except critical)
    meeting: 0.1,     // Almost no interruptions
    dnd: 0.0,         // No interruptions (except critical)
    away: 0.0,        // No point interrupting
  },
};

// =============================================================================
// INTERRUPTION MANAGER
// =============================================================================

export class InterruptionManager {
  private config: BudgetConfig;
  private interruptionLog: { timestamp: Date; type: InterruptionType; urgency: number }[] = [];
  private deferredQueue: { request: InterruptionRequest; deferUntil: UserState | 'any' }[] = [];
  private currentState: UserState = 'active';
  private lastInterruption: Date | null = null;
  private focusStartTime: Date | null = null;
  
  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET, ...config };
  }

  /**
   * Update user state
   */
  setUserState(state: UserState): void {
    const previousState = this.currentState;
    this.currentState = state;
    
    if (state === 'focused' && previousState !== 'focused') {
      this.focusStartTime = new Date();
    } else if (state !== 'focused') {
      this.focusStartTime = null;
    }
    
    // Check deferred queue when state changes
    if (previousState !== state) {
      this.processDeferred();
    }
    
    logger.debug('User state updated', { previousState, newState: state });
  }

  /**
   * Get current user state
   */
  getUserState(): UserState {
    return this.currentState;
  }

  /**
   * Check if we should interrupt
   */
  shouldInterrupt(request: InterruptionRequest): InterruptionDecision {
    // Critical always interrupts
    if (request.type === 'critical') {
      return {
        shouldInterrupt: true,
        reason: 'Critical interruption always allowed',
      };
    }

    // Check if urgency bypasses budget
    if (request.urgency >= this.config.urgencyBypassThreshold) {
      return {
        shouldInterrupt: true,
        reason: `Urgency ${request.urgency} bypasses budget threshold`,
      };
    }

    // Check state-based blocking
    const stateMultiplier = this.config.stateMultipliers[this.currentState];
    if (stateMultiplier === 0) {
      if (request.canDefer) {
        this.defer(request, request.deferUntil || 'active');
        return {
          shouldInterrupt: false,
          reason: `User is ${this.currentState}, deferring until available`,
          alternativeAction: 'queue',
        };
      }
      return {
        shouldInterrupt: false,
        reason: `User is ${this.currentState}, interruptions blocked`,
        alternativeAction: 'silent_log',
      };
    }

    // Check cooldown
    if (this.lastInterruption) {
      const timeSince = Date.now() - this.lastInterruption.getTime();
      if (timeSince < this.config.cooldownMs) {
        const waitTime = this.config.cooldownMs - timeSince;
        if (request.canDefer) {
          return {
            shouldInterrupt: false,
            reason: `Cooldown active, ${Math.round(waitTime / 1000)}s remaining`,
            deferredUntil: new Date(Date.now() + waitTime),
            alternativeAction: 'queue',
          };
        }
        return {
          shouldInterrupt: false,
          reason: 'Cooldown active',
          alternativeAction: 'badge',
        };
      }
    }

    // Check budget
    const effectiveBudget = this.getEffectiveBudget();
    const recentCount = this.getRecentInterruptionCount();
    
    if (recentCount >= effectiveBudget.perHour) {
      if (request.canDefer) {
        return {
          shouldInterrupt: false,
          reason: 'Hourly budget exhausted',
          alternativeAction: 'queue',
        };
      }
      return {
        shouldInterrupt: false,
        reason: 'Hourly budget exhausted',
        alternativeAction: 'badge',
      };
    }

    // Check focus duration protection
    if (this.currentState === 'focused' && this.focusStartTime) {
      const focusDuration = Date.now() - this.focusStartTime.getTime();
      const focusMinutes = focusDuration / 60000;
      
      // Protect deep focus sessions (>15 min)
      if (focusMinutes > 15 && request.urgency < 7) {
        return {
          shouldInterrupt: false,
          reason: `Protecting focus session (${Math.round(focusMinutes)} min)`,
          alternativeAction: 'queue',
        };
      }
    }

    // Allow interruption
    return {
      shouldInterrupt: true,
      reason: 'Within budget and appropriate context',
    };
  }

  /**
   * Record an interruption
   */
  recordInterruption(type: InterruptionType, urgency: number): void {
    this.interruptionLog.push({
      timestamp: new Date(),
      type,
      urgency,
    });
    
    this.lastInterruption = new Date();
    
    // Clean old entries
    this.cleanOldEntries();
    
    auditLog('INTERRUPTION', { type, urgency, state: this.currentState });
  }

  /**
   * Defer an interruption for later
   */
  private defer(request: InterruptionRequest, until: UserState | 'any'): void {
    this.deferredQueue.push({ request, deferUntil: until });
    
    logger.debug('Interruption deferred', { 
      message: request.message.substring(0, 50), 
      until 
    });
  }

  /**
   * Process deferred interruptions
   */
  private processDeferred(): { request: InterruptionRequest; decision: InterruptionDecision }[] {
    const results: { request: InterruptionRequest; decision: InterruptionDecision }[] = [];
    const stillDeferred: typeof this.deferredQueue = [];
    
    for (const { request, deferUntil } of this.deferredQueue) {
      // Check if request has expired
      if (request.expiresIn) {
        // We'd need to track when it was deferred - simplified for now
      }
      
      // Check if state matches deferUntil
      const stateMatches = 
        deferUntil === 'any' ||
        (deferUntil === 'idle' && this.currentState === 'idle') ||
        (deferUntil === 'active' && ['idle', 'active'].includes(this.currentState));
      
      if (stateMatches) {
        const decision = this.shouldInterrupt(request);
        results.push({ request, decision });
        
        if (!decision.shouldInterrupt && decision.alternativeAction === 'queue') {
          // Still can't interrupt, keep in queue
          stillDeferred.push({ request, deferUntil });
        }
      } else {
        stillDeferred.push({ request, deferUntil });
      }
    }
    
    this.deferredQueue = stillDeferred;
    return results;
  }

  /**
   * Get effective budget based on current state
   */
  private getEffectiveBudget(): { perHour: number; perMinute: number } {
    const multiplier = this.config.stateMultipliers[this.currentState];
    return {
      perHour: Math.floor(this.config.maxPerHour * multiplier),
      perMinute: Math.floor(this.config.maxPerMinute * multiplier),
    };
  }

  /**
   * Get count of recent interruptions
   */
  private getRecentInterruptionCount(): number {
    const hourAgo = new Date(Date.now() - 3600000);
    return this.interruptionLog.filter(i => i.timestamp > hourAgo).length;
  }

  /**
   * Clean old log entries
   */
  private cleanOldEntries(): void {
    const hourAgo = new Date(Date.now() - 3600000);
    this.interruptionLog = this.interruptionLog.filter(i => i.timestamp > hourAgo);
  }

  /**
   * Get interruption statistics
   */
  getStats(): {
    currentState: UserState;
    interruptionsLastHour: number;
    effectiveBudget: { perHour: number; perMinute: number };
    deferredCount: number;
    lastInterruption: Date | null;
    focusDuration: number | null;
  } {
    return {
      currentState: this.currentState,
      interruptionsLastHour: this.getRecentInterruptionCount(),
      effectiveBudget: this.getEffectiveBudget(),
      deferredCount: this.deferredQueue.length,
      lastInterruption: this.lastInterruption,
      focusDuration: this.focusStartTime 
        ? Date.now() - this.focusStartTime.getTime() 
        : null,
    };
  }

  /**
   * Get pending deferred items
   */
  getDeferredQueue(): InterruptionRequest[] {
    return this.deferredQueue.map(d => d.request);
  }

  /**
   * Clear the deferred queue
   */
  clearDeferred(): void {
    this.deferredQueue = [];
  }

  /**
   * Check if now is a good time for proactive suggestions
   */
  canSuggest(): boolean {
    // Never suggest during focus/presenting/meeting/dnd
    if (['focused', 'presenting', 'meeting', 'dnd', 'away'].includes(this.currentState)) {
      return false;
    }
    
    // Check if we have budget
    const budget = this.getEffectiveBudget();
    if (this.getRecentInterruptionCount() >= budget.perHour * 0.5) {
      // Only use half budget for suggestions
      return false;
    }
    
    // Check cooldown (longer for suggestions)
    if (this.lastInterruption) {
      const timeSince = Date.now() - this.lastInterruption.getTime();
      if (timeSince < this.config.cooldownMs * 2) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Determine how to deliver a message based on context
   */
  getDeliveryMethod(request: InterruptionRequest): 
    'speak' | 'display' | 'badge' | 'silent' | 'defer' {
    
    const decision = this.shouldInterrupt(request);
    
    if (!decision.shouldInterrupt) {
      if (decision.alternativeAction === 'queue') return 'defer';
      if (decision.alternativeAction === 'badge') return 'badge';
      return 'silent';
    }
    
    // Decide between speak and display based on type and context
    if (this.currentState === 'idle' && request.urgency >= 7) {
      return 'speak';
    }
    
    if (request.type === 'urgent' || request.type === 'critical') {
      return 'speak';
    }
    
    return 'display';
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const interruptionManager = new InterruptionManager();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Simple check if we should stay silent
 */
export function shouldStaySilent(): boolean {
  const state = interruptionManager.getUserState();
  return ['focused', 'presenting', 'meeting', 'dnd'].includes(state);
}

/**
 * Check if proactive behavior is appropriate
 */
export function canBeProactive(): boolean {
  return interruptionManager.canSuggest();
}
