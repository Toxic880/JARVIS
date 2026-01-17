/**
 * Autonomy Engine
 * 
 * Decides how to handle each action based on:
 * 1. Tool's inherent safety level
 * 2. User's historical patterns (learned approval)
 * 3. Context (time, mode, recent behavior)
 * 4. Confidence score from LLM
 * 
 * Outputs:
 * - AUTO_APPROVE: Execute immediately, no confirmation
 * - ANNOUNCE: Brief notification, then execute
 * - CONFIRM_SIMPLE: One-click confirmation
 * - CONFIRM_DETAILED: Show full details, require explicit confirmation
 * - DENY: Block execution entirely
 */

import { z } from 'zod';
import { 
  ActionIntentType, 
  ToolDefinitionType, 
  WorldStateType,
  ExecutionResultType,
} from './schemas';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// AUTONOMY DECISION
// =============================================================================

export enum AutonomyLevel {
  AUTO_APPROVE = 'auto_approve',
  ANNOUNCE = 'announce',
  CONFIRM_SIMPLE = 'confirm_simple',
  CONFIRM_DETAILED = 'confirm_detailed',
  DENY = 'deny',
}

export interface AutonomyDecision {
  level: AutonomyLevel;
  reason: string;
  // For confirmations, what to show the user
  displayMessage?: string;
  displayParams?: Record<string, string>;
  // How long until this confirmation expires
  expiresInSeconds?: number;
}

// =============================================================================
// PATTERN LEARNING
// =============================================================================

/**
 * Tracks patterns of user approvals for auto-approval learning
 */
interface ApprovalPattern {
  action: string;
  paramsHash: string;
  approvalCount: number;
  lastApproved: Date;
  // Context in which it was approved
  contexts: {
    timeOfDay: string;
    mode: string;
    activeApp?: string;
  }[];
}

// In-memory pattern storage (would be DB in production)
const approvalPatterns: Map<string, ApprovalPattern> = new Map();

/**
 * Hash params for pattern matching (ignoring volatile fields)
 */
function hashParams(action: string, params: Record<string, any>): string {
  // Remove timestamps, IDs, and other volatile fields
  const stableParams = Object.entries(params)
    .filter(([key]) => !['id', 'timestamp', 'requestId'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join('|');
  
  return `${action}:${stableParams}`;
}

/**
 * Check if this action+params combo has been approved enough times
 */
function hasLearnedApproval(
  action: string, 
  params: Record<string, any>,
  context: { timeOfDay: string; mode: string; activeApp?: string }
): boolean {
  const hash = hashParams(action, params);
  const pattern = approvalPatterns.get(hash);
  
  if (!pattern) return false;
  
  // Require at least 3 approvals
  if (pattern.approvalCount < 3) return false;
  
  // Check if approved in similar context
  const similarContext = pattern.contexts.some(
    ctx => ctx.timeOfDay === context.timeOfDay || ctx.mode === context.mode
  );
  
  return similarContext;
}

/**
 * Record an approval for pattern learning
 */
export function recordApproval(
  action: string,
  params: Record<string, any>,
  context: { timeOfDay: string; mode: string; activeApp?: string }
): void {
  const hash = hashParams(action, params);
  const existing = approvalPatterns.get(hash);
  
  if (existing) {
    existing.approvalCount++;
    existing.lastApproved = new Date();
    existing.contexts.push(context);
    // Keep only last 10 contexts
    if (existing.contexts.length > 10) {
      existing.contexts = existing.contexts.slice(-10);
    }
  } else {
    approvalPatterns.set(hash, {
      action,
      paramsHash: hash,
      approvalCount: 1,
      lastApproved: new Date(),
      contexts: [context],
    });
  }
  
  logger.info('Recorded approval pattern', { action, hash, count: approvalPatterns.get(hash)?.approvalCount });
}

// =============================================================================
// TOOL SAFETY CONFIGURATION
// =============================================================================

/**
 * Default safety levels for tools (can be overridden per-tool)
 */
const DEFAULT_SAFETY: Record<string, AutonomyLevel> = {
  // Always safe - information retrieval
  'getTime': AutonomyLevel.AUTO_APPROVE,
  'getDate': AutonomyLevel.AUTO_APPROVE,
  'getWeather': AutonomyLevel.AUTO_APPROVE,
  'getTimers': AutonomyLevel.AUTO_APPROVE,
  'getAlarms': AutonomyLevel.AUTO_APPROVE,
  'getReminders': AutonomyLevel.AUTO_APPROVE,
  'getList': AutonomyLevel.AUTO_APPROVE,
  'getAllLists': AutonomyLevel.AUTO_APPROVE,
  'getNote': AutonomyLevel.AUTO_APPROVE,
  'getAllNotes': AutonomyLevel.AUTO_APPROVE,
  'getDeviceState': AutonomyLevel.AUTO_APPROVE,
  'getAllDevices': AutonomyLevel.AUTO_APPROVE,
  'getCurrentTrack': AutonomyLevel.AUTO_APPROVE,
  'getSchedule': AutonomyLevel.AUTO_APPROVE,
  'getTasks': AutonomyLevel.AUTO_APPROVE,
  'getEmails': AutonomyLevel.AUTO_APPROVE,
  'recall': AutonomyLevel.AUTO_APPROVE,
  'getMemorySummary': AutonomyLevel.AUTO_APPROVE,
  'getMode': AutonomyLevel.AUTO_APPROVE,
  'getSystemStatus': AutonomyLevel.AUTO_APPROVE,
  'getHealthSummary': AutonomyLevel.AUTO_APPROVE,
  'calculate': AutonomyLevel.AUTO_APPROVE,
  'convert': AutonomyLevel.AUTO_APPROVE,
  'getNews': AutonomyLevel.AUTO_APPROVE,
  'getStockPrice': AutonomyLevel.AUTO_APPROVE,
  
  // Low risk - reversible, local effects
  'setTimer': AutonomyLevel.ANNOUNCE,
  'cancelTimer': AutonomyLevel.ANNOUNCE,
  'pauseTimer': AutonomyLevel.ANNOUNCE,
  'resumeTimer': AutonomyLevel.ANNOUNCE,
  'setAlarm': AutonomyLevel.ANNOUNCE,
  'cancelAlarm': AutonomyLevel.ANNOUNCE,
  'addToList': AutonomyLevel.ANNOUNCE,
  'removeFromList': AutonomyLevel.ANNOUNCE,
  'createNote': AutonomyLevel.ANNOUNCE,
  'setMode': AutonomyLevel.ANNOUNCE,
  'pauseMusic': AutonomyLevel.ANNOUNCE,
  'resumeMusic': AutonomyLevel.ANNOUNCE,
  'nextTrack': AutonomyLevel.ANNOUNCE,
  'previousTrack': AutonomyLevel.ANNOUNCE,
  'setVolume': AutonomyLevel.ANNOUNCE,
  'shuffleOn': AutonomyLevel.ANNOUNCE,
  'shuffleOff': AutonomyLevel.ANNOUNCE,
  
  // Medium risk - noticeable effects
  'playMusic': AutonomyLevel.CONFIRM_SIMPLE,
  'controlDevice': AutonomyLevel.CONFIRM_SIMPLE,
  'activateScene': AutonomyLevel.CONFIRM_SIMPLE,
  'setReminder': AutonomyLevel.CONFIRM_SIMPLE,
  'remember': AutonomyLevel.CONFIRM_SIMPLE,
  'addTask': AutonomyLevel.CONFIRM_SIMPLE,
  'completeTask': AutonomyLevel.CONFIRM_SIMPLE,
  'announce': AutonomyLevel.CONFIRM_SIMPLE,
  'analyzeImage': AutonomyLevel.CONFIRM_SIMPLE,
  
  // High risk - significant effects, external
  'createEvent': AutonomyLevel.CONFIRM_DETAILED,
  'deleteEvent': AutonomyLevel.CONFIRM_DETAILED,
  'clearList': AutonomyLevel.CONFIRM_DETAILED,
  'deleteNote': AutonomyLevel.CONFIRM_DETAILED,
  'cancelReminder': AutonomyLevel.CONFIRM_DETAILED,
  
  // Critical - irreversible, external communication
  'sendEmail': AutonomyLevel.CONFIRM_DETAILED,
  'sendSMS': AutonomyLevel.CONFIRM_DETAILED,
  'forget': AutonomyLevel.CONFIRM_DETAILED,
};

// =============================================================================
// MAIN DECISION ENGINE
// =============================================================================

export interface AutonomyContext {
  userId: string;
  worldState: WorldStateType;
  tool: ToolDefinitionType;
  recentApprovals?: { action: string; at: Date }[];
}

/**
 * Determine the autonomy level for an action
 */
export function determineAutonomy(
  intent: ActionIntentType,
  context: AutonomyContext
): AutonomyDecision {
  const { action, params, confidence, reasoning } = intent;
  const { worldState, tool } = context;
  
  // 1. Check explicit tool safety level first
  let baseLevel = DEFAULT_SAFETY[action] || AutonomyLevel.CONFIRM_SIMPLE;
  
  // Override with tool definition if specified
  if (tool.safetyLevel === 'safe') {
    baseLevel = AutonomyLevel.AUTO_APPROVE;
  } else if (tool.safetyLevel === 'critical') {
    baseLevel = AutonomyLevel.CONFIRM_DETAILED;
  } else if (tool.safetyLevel === 'high_risk') {
    baseLevel = AutonomyLevel.CONFIRM_DETAILED;
  }
  
  // 2. Adjust based on confidence
  if (confidence < 0.5) {
    // Low confidence always requires confirmation
    return {
      level: AutonomyLevel.CONFIRM_DETAILED,
      reason: 'Low confidence requires confirmation',
      displayMessage: `I'm only ${Math.round(confidence * 100)}% confident about this.`,
    };
  }
  
  if (confidence < 0.7 && baseLevel === AutonomyLevel.AUTO_APPROVE) {
    // Bump up auto-approve to announce if confidence is moderate
    baseLevel = AutonomyLevel.ANNOUNCE;
  }
  
  // 3. Check for learned patterns (auto-approval through repetition)
  if (baseLevel === AutonomyLevel.CONFIRM_SIMPLE && tool.supportsAutoApproval) {
    const patternContext = {
      timeOfDay: worldState.time.timeOfDay,
      mode: worldState.user.mode,
      activeApp: worldState.desktop?.activeApp,
    };
    
    if (hasLearnedApproval(action, params, patternContext)) {
      return {
        level: AutonomyLevel.ANNOUNCE,
        reason: 'Learned from previous approvals',
        displayMessage: reasoning || `Executing ${action} (previously approved pattern)`,
      };
    }
  }
  
  // 4. Mode-based adjustments
  if (worldState.user.mode === 'focus' || worldState.user.mode === 'dnd') {
    // In focus mode, require confirmation for anything that makes noise
    if (['playMusic', 'announce', 'setVolume'].includes(action)) {
      return {
        level: AutonomyLevel.CONFIRM_DETAILED,
        reason: 'Focus mode active - confirm audio changes',
        displayMessage: `You're in ${worldState.user.mode} mode. Still want to ${action}?`,
      };
    }
  }
  
  if (worldState.user.mode === 'guest') {
    // Guest mode requires confirmation for everything except reads
    if (baseLevel === AutonomyLevel.AUTO_APPROVE) {
      // Keep auto-approve for reads
    } else {
      baseLevel = AutonomyLevel.CONFIRM_DETAILED;
    }
  }
  
  // 5. Time-based adjustments
  if (worldState.time.timeOfDay === 'night') {
    // Late night, be more careful with audio/lights
    if (['playMusic', 'announce', 'controlDevice'].includes(action)) {
      const currentLevel = baseLevel;
      if (currentLevel === AutonomyLevel.ANNOUNCE) {
        baseLevel = AutonomyLevel.CONFIRM_SIMPLE;
      }
    }
  }
  
  // 6. Build display message for confirmations
  let displayMessage: string | undefined;
  let displayParams: Record<string, string> | undefined;
  
  if (baseLevel === AutonomyLevel.CONFIRM_SIMPLE || baseLevel === AutonomyLevel.CONFIRM_DETAILED) {
    displayMessage = reasoning || `Execute ${action}?`;
    displayParams = formatParamsForDisplay(action, params);
  } else if (baseLevel === AutonomyLevel.ANNOUNCE) {
    displayMessage = reasoning || formatAnnouncementMessage(action, params);
  }
  
  return {
    level: baseLevel,
    reason: `Default for ${action}`,
    displayMessage,
    displayParams,
    expiresInSeconds: baseLevel === AutonomyLevel.CONFIRM_DETAILED ? 300 : 120,
  };
}

/**
 * Format params for user display (hide technical details)
 */
function formatParamsForDisplay(action: string, params: Record<string, any>): Record<string, string> {
  const display: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Skip internal/technical params
    if (['id', 'timestamp', 'requestId', 'userId'].includes(key)) continue;
    
    // Format nicely
    const displayKey = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
    
    if (typeof value === 'string') {
      display[displayKey] = value.length > 100 ? value.substring(0, 100) + '...' : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      display[displayKey] = String(value);
    } else if (Array.isArray(value)) {
      display[displayKey] = value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : '');
    }
  }
  
  return display;
}

/**
 * Format a brief announcement message
 */
function formatAnnouncementMessage(action: string, params: Record<string, any>): string {
  // Action-specific messages
  switch (action) {
    case 'setTimer':
      return `Setting timer for ${params.duration} seconds${params.label ? `: ${params.label}` : ''}`;
    case 'setAlarm':
      return `Setting alarm for ${params.time}${params.label ? `: ${params.label}` : ''}`;
    case 'addToList':
      return `Adding "${params.item}" to ${params.listName}`;
    case 'setVolume':
      return `Setting volume to ${params.volume}%`;
    case 'setMode':
      return `Switching to ${params.mode} mode`;
    case 'playMusic':
      return `Playing "${params.query}"`;
    case 'pauseMusic':
      return 'Pausing music';
    case 'resumeMusic':
      return 'Resuming music';
    case 'nextTrack':
      return 'Skipping to next track';
    default:
      return `Executing ${action}`;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { AutonomyLevel as AutonomyLevelEnum };
