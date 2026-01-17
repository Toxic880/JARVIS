/**
 * Executor Registry & Initialization
 * 
 * Registers all tool executors and provides unified access.
 */

import { executorRegistry, IToolExecutor, ToolCapability, ExecutionResult } from './interface';
import { TimerExecutor } from './timerExecutor';
import { HomeAssistantExecutor } from './homeAssistantExecutor';
import { ListsNotesExecutor } from './listsNotesExecutor';
import { InfoUtilityExecutor } from './infoUtilityExecutor';
import { SpotifyExecutor } from './spotifyExecutor';
import { CalendarExecutor } from './calendarExecutor';
import { WebSearchExecutor } from './webSearchExecutor';
import { AppLauncherExecutor } from './appLauncherExecutor';
import { GmailExecutor } from './gmailExecutor';
import { SMSExecutor } from './smsExecutor';
import { GoalsExecutor } from './goalsExecutor';
import { SelfKnowledgeExecutor } from './selfKnowledgeExecutor';
import { uiControlExecutor, UIControlExecutor } from './uiControlExecutor';
import { SandboxExecutor, sandboxExecutor } from './sandboxExecutor';
import { logger } from '../services/logger';

// =============================================================================
// EXECUTOR CALLBACKS
// =============================================================================

interface ExecutorCallbacks {
  onTimerComplete?: (timer: any) => void;
  onAlarmTrigger?: (alarm: any) => void;
  onReminderTrigger?: (reminder: any) => void;
}

let callbacks: ExecutorCallbacks = {};

export function setExecutorCallbacks(cb: ExecutorCallbacks): void {
  callbacks = cb;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

let initialized = false;

export function initializeExecutors(): void {
  if (initialized) return;
  
  logger.info('Initializing tool executors...');
  
  // Core executors
  executorRegistry.register(new TimerExecutor({
    onTimerComplete: (timer) => callbacks.onTimerComplete?.(timer),
    onAlarmTrigger: (alarm) => callbacks.onAlarmTrigger?.(alarm),
    onReminderTrigger: (reminder) => callbacks.onReminderTrigger?.(reminder),
  }));
  
  executorRegistry.register(new HomeAssistantExecutor());
  executorRegistry.register(new ListsNotesExecutor());
  executorRegistry.register(new InfoUtilityExecutor());
  
  // Media & Productivity
  executorRegistry.register(new SpotifyExecutor());
  executorRegistry.register(new CalendarExecutor());
  executorRegistry.register(new GoalsExecutor());
  
  // Information & System
  executorRegistry.register(new WebSearchExecutor());
  executorRegistry.register(new AppLauncherExecutor());
  
  // Communication
  executorRegistry.register(new GmailExecutor());
  executorRegistry.register(new SMSExecutor());
  
  // Meta (self-knowledge)
  executorRegistry.register(new SelfKnowledgeExecutor());
  
  // UI Control (lets LLM control the display)
  executorRegistry.register(uiControlExecutor);
  
  initialized = true;
  
  const capabilities = executorRegistry.getAllCapabilities();
  logger.info(`Executors initialized. ${capabilities.length} tools available.`);
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string, 
  params: Record<string, any>
): Promise<ExecutionResult> {
  if (!initialized) {
    initializeExecutors();
  }
  
  return executorRegistry.execute(toolName, params);
}

/**
 * Simulate a tool execution (dry run)
 */
export async function simulateTool(
  toolName: string, 
  params: Record<string, any>
): Promise<{
  wouldSucceed: boolean;
  predictedOutput: any;
  predictedSideEffects: any[];
  warnings: string[];
}> {
  if (!initialized) {
    initializeExecutors();
  }
  
  return executorRegistry.simulate(toolName, params);
}

/**
 * Get all available tool capabilities
 */
export function getAllCapabilities(): ToolCapability[] {
  if (!initialized) {
    initializeExecutors();
  }
  
  return executorRegistry.getAllCapabilities();
}

/**
 * Get capability by name
 */
export function getCapability(toolName: string): ToolCapability | null {
  if (!initialized) {
    initializeExecutors();
  }
  
  return executorRegistry.getCapability(toolName);
}

/**
 * Check if a tool exists
 */
export function toolExists(toolName: string): boolean {
  if (!initialized) {
    initializeExecutors();
  }
  
  return executorRegistry.getExecutor(toolName) !== null;
}

/**
 * Get tools grouped by category
 */
export function getToolsByCategory(): Record<string, ToolCapability[]> {
  const capabilities = getAllCapabilities();
  const grouped: Record<string, ToolCapability[]> = {};
  
  for (const cap of capabilities) {
    const executor = executorRegistry.getExecutor(cap.name);
    const category = executor?.category || 'unknown';
    
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(cap);
  }
  
  return grouped;
}

/**
 * Get tools by risk level
 */
export function getToolsByRiskLevel(level: 'none' | 'low' | 'medium' | 'high' | 'critical'): ToolCapability[] {
  return getAllCapabilities().filter(cap => cap.riskLevel === level);
}

// =============================================================================
// EXPORTS
// =============================================================================

export { executorRegistry, ExecutionResult, ToolCapability, IToolExecutor };
export { TimerExecutor } from './timerExecutor';
export { HomeAssistantExecutor } from './homeAssistantExecutor';
export { ListsNotesExecutor } from './listsNotesExecutor';
export { InfoUtilityExecutor } from './infoUtilityExecutor';
export { SpotifyExecutor } from './spotifyExecutor';
export { CalendarExecutor } from './calendarExecutor';
export { WebSearchExecutor } from './webSearchExecutor';
export { AppLauncherExecutor } from './appLauncherExecutor';
export { GmailExecutor } from './gmailExecutor';
export { SMSExecutor } from './smsExecutor';
export { GoalsExecutor } from './goalsExecutor';
export { SelfKnowledgeExecutor } from './selfKnowledgeExecutor';
export { SandboxExecutor, sandboxExecutor } from './sandboxExecutor';
