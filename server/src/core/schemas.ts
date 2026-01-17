/**
 * JARVIS Core Schemas
 * 
 * These schemas define the ONLY formats the LLM is allowed to output.
 * The LLM is a PLANNER - it emits INTENT, never executes directly.
 * 
 * Output Types:
 * 1. RESPONSE - Plain text response to user (no action)
 * 2. ACTION - Structured tool call with params
 * 3. CLARIFY - Ask user for more info before proceeding
 * 4. PLAN - Multi-step sequence for complex requests
 */

import { z } from 'zod';

// =============================================================================
// CONFIDENCE & SAFETY LEVELS
// =============================================================================

export const ConfidenceLevel = z.number().min(0).max(1);

export const SafetyLevel = z.enum([
  'safe',       // Read-only, no side effects - auto-approve
  'low_risk',   // Minor side effects, reversible - announce & act
  'medium',     // Noticeable effects - confirm with single click
  'high_risk',  // Significant effects - confirm with details shown
  'critical',   // Irreversible/external - require explicit typed confirmation
]);

// =============================================================================
// INTENT TYPES
// =============================================================================

/**
 * RESPONSE - LLM just wants to talk, no action needed
 */
export const ResponseIntent = z.object({
  type: z.literal('response'),
  text: z.string().min(1).max(10000),
  // Optional: suggest follow-up actions without executing
  suggestions: z.array(z.string()).optional(),
});

/**
 * ACTION - LLM wants to execute a single tool
 */
export const ActionIntent = z.object({
  type: z.literal('action'),
  action: z.string().min(1).max(100),
  params: z.record(z.any()),
  // LLM's confidence in this being the right action
  confidence: ConfidenceLevel.default(0.8),
  // Natural language explanation for the user
  reasoning: z.string().max(500).optional(),
});

/**
 * CLARIFY - LLM needs more information before proceeding
 */
export const ClarifyIntent = z.object({
  type: z.literal('clarify'),
  question: z.string().min(1).max(1000),
  // Optional quick-pick options
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional(),
  // What the LLM will do once clarified
  pendingAction: z.string().optional(),
});

/**
 * PLAN - Multi-step sequence for complex requests
 * Each step is validated and confirmed before execution
 */
export const PlanStep = z.object({
  action: z.string(),
  params: z.record(z.any()),
  reasoning: z.string().optional(),
  // Can this step be auto-approved based on autonomy rules?
  canAutoApprove: z.boolean().default(false),
});

export const PlanIntent = z.object({
  type: z.literal('plan'),
  goal: z.string().max(500), // What user asked for
  steps: z.array(PlanStep).min(1).max(20),
  // Overall confidence in this plan
  confidence: ConfidenceLevel.default(0.7),
  // Natural summary of what will happen
  summary: z.string().max(1000),
});

/**
 * OBSERVE - LLM noticed something and wants to inform/suggest
 * Used for proactive intelligence
 */
export const ObserveIntent = z.object({
  type: z.literal('observe'),
  observation: z.string().max(500),
  // Optional suggested action
  suggestion: ActionIntent.optional(),
  // How urgent is this observation?
  priority: z.enum(['low', 'medium', 'high']).default('low'),
});

/**
 * Combined Intent - one of the above types
 */
export const JarvisIntent = z.discriminatedUnion('type', [
  ResponseIntent,
  ActionIntent,
  ClarifyIntent,
  PlanIntent,
  ObserveIntent,
]);

export type JarvisIntentType = z.infer<typeof JarvisIntent>;
export type ActionIntentType = z.infer<typeof ActionIntent>;
export type PlanIntentType = z.infer<typeof PlanIntent>;
export type ClarifyIntentType = z.infer<typeof ClarifyIntent>;

// =============================================================================
// TOOL DEFINITION SCHEMA
// =============================================================================

/**
 * Enhanced tool definition with safety metadata
 */
export const ToolDefinition = z.object({
  name: z.string(),
  description: z.string(),
  // JSON Schema for parameters
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
  }),
  // Safety classification
  safetyLevel: SafetyLevel,
  // Roles allowed to use this tool (empty = all)
  allowedRoles: z.array(z.string()).optional(),
  // Category for UI grouping
  category: z.enum([
    'info',        // Read-only information
    'timer',       // Timers, alarms, reminders
    'list',        // Lists and notes
    'smart_home',  // Device control
    'music',       // Spotify/audio
    'calendar',    // Events and tasks
    'communication', // Email, SMS
    'memory',      // Remember/forget
    'system',      // Modes, settings
    'vision',      // Screen/camera
  ]),
  // If true, can be auto-approved based on patterns
  supportsAutoApproval: z.boolean().default(false),
});

export type ToolDefinitionType = z.infer<typeof ToolDefinition>;

// =============================================================================
// WORLD STATE SCHEMA
// =============================================================================

/**
 * Current state of the world - fed to LLM for context
 */
export const WorldState = z.object({
  // Time context
  time: z.object({
    current: z.string(), // ISO string
    dayOfWeek: z.string(),
    timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']),
  }),
  
  // User context
  user: z.object({
    name: z.string().optional(),
    mode: z.enum(['normal', 'focus', 'dnd', 'sleep', 'away', 'guest']).default('normal'),
    lastInteraction: z.string().optional(), // ISO string
    recentTopics: z.array(z.string()).optional(),
  }),
  
  // Active window/app context (from perception layer)
  desktop: z.object({
    activeApp: z.string().optional(),
    activeWindow: z.string().optional(),
    focusDuration: z.number().optional(), // seconds on current window
    recentApps: z.array(z.string()).optional(),
  }).optional(),
  
  // Smart home context
  home: z.object({
    activeDevices: z.array(z.string()).optional(),
    currentScene: z.string().optional(),
    audioOutput: z.string().optional(),
  }).optional(),
  
  // Music context
  music: z.object({
    isPlaying: z.boolean().optional(),
    currentTrack: z.string().optional(),
    currentPlaylist: z.string().optional(),
  }).optional(),
  
  // Patterns detected
  patterns: z.object({
    repeatedAction: z.object({
      action: z.string(),
      count: z.number(),
      lastAt: z.string(),
    }).optional(),
    possibleFrustration: z.object({
      indicator: z.string(),
      confidence: z.number(),
    }).optional(),
    usualBehavior: z.array(z.string()).optional(),
  }).optional(),
  
  // Active timers/reminders
  pending: z.object({
    timers: z.array(z.object({
      label: z.string(),
      remainingSeconds: z.number(),
    })).optional(),
    reminders: z.array(z.object({
      message: z.string(),
      dueIn: z.string(),
    })).optional(),
  }).optional(),
});

export type WorldStateType = z.infer<typeof WorldState>;

// =============================================================================
// EXECUTION RESULT SCHEMA
// =============================================================================

/**
 * Result of executing a tool
 */
export const ExecutionResult = z.object({
  success: z.boolean(),
  action: z.string(),
  // Result data (tool-specific)
  data: z.any().optional(),
  // Human-readable result
  message: z.string().optional(),
  // Error details if failed
  error: z.string().optional(),
  // Execution metadata
  meta: z.object({
    executedAt: z.string(),
    durationMs: z.number(),
    confirmedBy: z.enum(['auto', 'user', 'pattern']).optional(),
  }).optional(),
});

export type ExecutionResultType = z.infer<typeof ExecutionResult>;

// =============================================================================
// CONVERSATION CONTEXT
// =============================================================================

/**
 * Context passed to LLM for each request
 */
export const ConversationContext = z.object({
  // Summarized world state
  worldState: WorldState,
  // Available tools (names only for prompt efficiency)
  availableTools: z.array(z.string()),
  // Recent conversation turns (summarized)
  recentHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    summary: z.string(),
    hadAction: z.boolean().optional(),
  })).optional(),
  // Pending confirmations
  pendingConfirmations: z.array(z.object({
    id: z.string(),
    action: z.string(),
    expiresAt: z.string(),
  })).optional(),
});

export type ConversationContextType = z.infer<typeof ConversationContext>;
