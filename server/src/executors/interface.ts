/**
 * Tool Executor Interface
 * 
 * Defines the contract between the brain and actual execution.
 * Every tool executor must implement this interface.
 * 
 * Key principles:
 * - Deterministic outcomes Jarvis can reason about
 * - Side effects are declared and tracked
 * - Rollback capability where possible
 * - Execution is isolated from planning
 */

import { z } from 'zod';

// =============================================================================
// SIDE EFFECT CATEGORIES
// =============================================================================

/**
 * Normalized side effect types.
 * Every executor must use these categories for consistency.
 */
export type SideEffectType = 
  // State changes
  | 'state_change'       // Internal state modified
  | 'data_created'       // New data created
  | 'data_modified'      // Existing data modified
  | 'data_deleted'       // Data removed
  
  // External interactions
  | 'api_call'           // External API called
  | 'network_request'    // Network request made
  | 'device_control'     // Smart device controlled
  | 'service_invoked'    // External service used
  
  // Communication
  | 'message_sent'       // Message sent (email, SMS, etc.)
  | 'email_sent'         // Email specifically sent
  
  // System effects
  | 'file_read'          // File was read
  | 'file_write'         // File was written
  | 'file_delete'        // File was deleted
  | 'process_spawn'      // Process was started
  | 'process_kill'       // Process was terminated
  
  // User-facing
  | 'notification'       // User was notified
  | 'audio_played'       // Sound was played
  | 'ui_displayed'       // UI element shown
  
  // Scheduled
  | 'timer_created'      // Timer/alarm scheduled
  | 'timer_cancelled'    // Timer/alarm cancelled
  | 'reminder_set'       // Reminder scheduled;

/**
 * Impact severity of a side effect
 */
export type SideEffectSeverity = 
  | 'trivial'    // No real impact (logging, metrics)
  | 'minor'      // Easily reversible, local impact
  | 'moderate'   // May need attention to reverse
  | 'major'      // Significant change, careful rollback
  | 'critical';  // Potentially irreversible

export interface ExecutionSideEffect {
  // What kind of effect
  type: SideEffectType;
  // What was affected
  target: string;
  // Human description
  description: string;
  // Can it be undone?
  reversible: boolean;
  // How to undo (action name or description)
  rollbackAction?: string;
  // Impact severity (defaults to 'minor' if not specified)
  severity?: SideEffectSeverity;
  // Structured data about what changed
  details?: {
    before?: any;
    after?: any;
    metadata?: Record<string, any>;
  };
}

// =============================================================================
// EXECUTION RESULT
// =============================================================================

export interface ExecutionResult {
  success: boolean;
  // What the tool returned
  output: any;
  // Human-readable message
  message: string;
  // What changed as a result
  sideEffects: ExecutionSideEffect[];
  // Error details if failed
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  // Execution metadata
  meta: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    executor: string;
    sandboxed: boolean;
  };
}

// =============================================================================
// TOOL CAPABILITY
// =============================================================================

export interface ToolCapability {
  name: string;
  description: string;
  // Zod schema for parameters
  schema: z.ZodType<any>;
  // Risk assessment
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  // Can this be undone?
  reversible: boolean;
  // Does it affect external systems?
  externalImpact: boolean;
  // Estimated blast radius
  blastRadius: 'local' | 'device' | 'network' | 'external';
  // Required permissions
  requiredPermissions: string[];
  // Can be simulated without real execution?
  supportsSimulation: boolean;
}

// =============================================================================
// EXECUTOR INTERFACE
// =============================================================================

export interface IToolExecutor {
  // Unique identifier for this executor
  readonly id: string;
  // Human-readable name
  readonly name: string;
  // What category of tools this handles
  readonly category: string;
  
  /**
   * Get all capabilities this executor provides
   */
  getCapabilities(): ToolCapability[];
  
  /**
   * Check if this executor can handle a given tool
   */
  canExecute(toolName: string): boolean;
  
  /**
   * Validate parameters before execution
   */
  validate(toolName: string, params: Record<string, any>): {
    valid: boolean;
    errors?: string[];
    sanitizedParams?: Record<string, any>;
  };
  
  /**
   * Simulate execution (dry run)
   * Returns what WOULD happen without actually doing it
   */
  simulate(toolName: string, params: Record<string, any>): Promise<{
    wouldSucceed: boolean;
    predictedOutput: any;
    predictedSideEffects: ExecutionSideEffect[];
    warnings: string[];
  }>;
  
  /**
   * Execute the tool for real
   */
  execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult>;
  
  /**
   * Attempt to rollback a previous execution
   */
  rollback?(executionId: string): Promise<{ success: boolean; message: string }>;
}

// =============================================================================
// EXECUTOR REGISTRY
// =============================================================================

class ExecutorRegistry {
  private executors: Map<string, IToolExecutor> = new Map();
  private toolToExecutor: Map<string, string> = new Map();

  /**
   * Register an executor
   */
  register(executor: IToolExecutor): void {
    this.executors.set(executor.id, executor);
    
    // Map each capability to this executor
    for (const cap of executor.getCapabilities()) {
      this.toolToExecutor.set(cap.name, executor.id);
    }
    
    console.log(`[ExecutorRegistry] Registered ${executor.name} with ${executor.getCapabilities().length} capabilities`);
  }

  /**
   * Get executor for a tool
   */
  getExecutor(toolName: string): IToolExecutor | null {
    const executorId = this.toolToExecutor.get(toolName);
    if (!executorId) return null;
    return this.executors.get(executorId) || null;
  }

  /**
   * Get all registered capabilities
   */
  getAllCapabilities(): ToolCapability[] {
    const caps: ToolCapability[] = [];
    for (const executor of this.executors.values()) {
      caps.push(...executor.getCapabilities());
    }
    return caps;
  }

  /**
   * Get capability by name
   */
  getCapability(toolName: string): ToolCapability | null {
    const executor = this.getExecutor(toolName);
    if (!executor) return null;
    return executor.getCapabilities().find(c => c.name === toolName) || null;
  }

  /**
   * Execute a tool
   */
  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const executor = this.getExecutor(toolName);
    
    if (!executor) {
      return {
        success: false,
        output: null,
        message: `No executor found for tool: ${toolName}`,
        sideEffects: [],
        error: {
          code: 'NO_EXECUTOR',
          message: `Tool "${toolName}" is not registered`,
          recoverable: false,
        },
        meta: {
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
          executor: 'none',
          sandboxed: false,
        },
      };
    }

    // Validate first
    const validation = executor.validate(toolName, params);
    if (!validation.valid) {
      return {
        success: false,
        output: null,
        message: `Validation failed: ${validation.errors?.join(', ')}`,
        sideEffects: [],
        error: {
          code: 'VALIDATION_FAILED',
          message: validation.errors?.join(', ') || 'Validation failed',
          recoverable: true,
        },
        meta: {
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
          executor: executor.id,
          sandboxed: false,
        },
      };
    }

    // Execute with sanitized params
    return executor.execute(toolName, validation.sanitizedParams || params);
  }

  /**
   * Simulate a tool execution
   */
  async simulate(toolName: string, params: Record<string, any>) {
    const executor = this.getExecutor(toolName);
    
    if (!executor) {
      return {
        wouldSucceed: false,
        predictedOutput: null,
        predictedSideEffects: [],
        warnings: [`No executor found for tool: ${toolName}`],
      };
    }

    const cap = executor.getCapabilities().find(c => c.name === toolName);
    if (!cap?.supportsSimulation) {
      return {
        wouldSucceed: false,
        predictedOutput: null,
        predictedSideEffects: [],
        warnings: [`Tool "${toolName}" does not support simulation`],
      };
    }

    return executor.simulate(toolName, params);
  }
}

// Singleton registry
export const executorRegistry = new ExecutorRegistry();

// =============================================================================
// SIDE EFFECT HELPERS
// =============================================================================

/**
 * Create a side effect with sensible defaults
 */
export function createSideEffect(
  type: SideEffectType,
  target: string,
  description: string,
  options: {
    reversible?: boolean;
    rollbackAction?: string;
    severity?: SideEffectSeverity;
    details?: ExecutionSideEffect['details'];
  } = {}
): ExecutionSideEffect {
  // Infer severity from type if not provided
  let defaultSeverity: SideEffectSeverity = 'minor';
  
  switch (type) {
    case 'notification':
    case 'audio_played':
    case 'ui_displayed':
    case 'file_read':
      defaultSeverity = 'trivial';
      break;
    case 'state_change':
    case 'timer_created':
    case 'timer_cancelled':
    case 'reminder_set':
    case 'data_created':
      defaultSeverity = 'minor';
      break;
    case 'data_modified':
    case 'api_call':
    case 'network_request':
    case 'file_write':
      defaultSeverity = 'moderate';
      break;
    case 'device_control':
    case 'service_invoked':
    case 'process_spawn':
    case 'data_deleted':
      defaultSeverity = 'major';
      break;
    case 'file_delete':
    case 'process_kill':
      defaultSeverity = 'critical';
      break;
  }
  
  return {
    type,
    target,
    description,
    reversible: options.reversible ?? true,
    rollbackAction: options.rollbackAction,
    severity: options.severity ?? defaultSeverity,
    details: options.details,
  };
}
