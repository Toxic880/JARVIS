/**
 * Execution Pipeline
 * 
 * The complete flow from user message to executed action:
 * 
 * 1. Build context (world state, available tools)
 * 2. Generate system prompt
 * 3. Send to LLM
 * 4. Parse response into structured intent
 * 5. Determine autonomy level
 * 6. Route to confirmation or execution
 * 7. Execute in sandbox
 * 8. Return result to LLM for response generation
 * 
 * This is the HEART of the Jarvis architecture.
 */

import { z } from 'zod';
import { 
  JarvisIntentType, 
  ActionIntentType,
  PlanIntentType,
  WorldStateType,
  ToolDefinitionType,
  ExecutionResultType,
  ConversationContextType,
} from './schemas';
import { parseIntent, ParseResult } from './intentParser';
import { generateSystemPrompt, SystemPromptOptions } from './systemPrompt';
import { determineAutonomy, AutonomyDecision, AutonomyLevel, recordApproval } from './autonomyEngine';
import { logger, auditLog } from '../services/logger';
import { toolGuard, TOOL_DEFINITIONS } from '../services/toolGuard';
import { LLMFactory } from './llm/factory';

// =============================================================================
// TYPES
// =============================================================================

export interface PipelineRequest {
  userId: string;
  message: string;
  // Optional: previous conversation context
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
  // Optional: override world state
  worldState?: Partial<WorldStateType>;
}

export interface PipelineResponse {
  // The response text to show/speak to user
  response: string;
  // The parsed intent (for debugging/logging)
  intent: JarvisIntentType | null;
  // If action requires confirmation
  pendingConfirmation?: {
    id: string;
    action: string;
    params: Record<string, any>;
    displayMessage: string;
    displayParams?: Record<string, string>;
    expiresAt: Date;
  };
  // If action was executed
  executionResult?: ExecutionResultType;
  // Any clarification needed
  clarification?: {
    question: string;
    options?: { label: string; value: string }[];
  };
  // Plan steps if multi-step
  plan?: {
    goal: string;
    summary: string;
    steps: { action: string; status: 'pending' | 'approved' | 'executed' | 'failed' }[];
  };
}

// =============================================================================
// PENDING CONFIRMATIONS
// =============================================================================

interface PendingConfirmation {
  id: string;
  userId: string;
  intent: ActionIntentType;
  autonomy: AutonomyDecision;
  createdAt: Date;
  expiresAt: Date;
  worldStateSnapshot: WorldStateType;
}

const pendingConfirmations: Map<string, PendingConfirmation> = new Map();

/**
 * Create a pending confirmation
 */
function createPendingConfirmation(
  userId: string,
  intent: ActionIntentType,
  autonomy: AutonomyDecision,
  worldState: WorldStateType
): string {
  const id = `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresInMs = (autonomy.expiresInSeconds || 120) * 1000;
  
  pendingConfirmations.set(id, {
    id,
    userId,
    intent,
    autonomy,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInMs),
    worldStateSnapshot: worldState,
  });
  
  // Auto-cleanup after expiry
  setTimeout(() => {
    pendingConfirmations.delete(id);
  }, expiresInMs + 1000);
  
  return id;
}

/**
 * Get and validate a pending confirmation
 */
export function getPendingConfirmation(id: string, userId: string): PendingConfirmation | null {
  const pending = pendingConfirmations.get(id);
  
  if (!pending) return null;
  if (pending.userId !== userId) return null;
  if (pending.expiresAt < new Date()) {
    pendingConfirmations.delete(id);
    return null;
  }
  
  return pending;
}

/**
 * Confirm and execute a pending action
 */
export async function confirmAndExecute(
  id: string, 
  userId: string
): Promise<ExecutionResultType | null> {
  const pending = getPendingConfirmation(id, userId);
  if (!pending) return null;
  
  // Remove from pending
  pendingConfirmations.delete(id);
  
  // Record approval for pattern learning
  recordApproval(
    pending.intent.action,
    pending.intent.params,
    {
      timeOfDay: pending.worldStateSnapshot.time.timeOfDay,
      mode: pending.worldStateSnapshot.user.mode,
      activeApp: pending.worldStateSnapshot.desktop?.activeApp,
    }
  );
  
  // Execute
  const result = await executeAction(pending.intent, userId);
  
  auditLog('ACTION_CONFIRMED', {
    userId,
    confirmationId: id,
    action: pending.intent.action,
    result: result.success ? 'success' : 'failed',
  });
  
  return result;
}

/**
 * Cancel a pending confirmation
 */
export function cancelConfirmation(id: string, userId: string): boolean {
  const pending = getPendingConfirmation(id, userId);
  if (!pending) return false;
  
  pendingConfirmations.delete(id);
  
  auditLog('ACTION_CANCELLED', {
    userId,
    confirmationId: id,
    action: pending.intent.action,
  });
  
  return true;
}

// =============================================================================
// WORLD STATE BUILDER
// =============================================================================

/**
 * Build current world state
 * In production, this would pull from perception layer, sensors, etc.
 */
function buildWorldState(overrides?: Partial<WorldStateType>): WorldStateType {
  const now = new Date();
  const hour = now.getHours();
  
  let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  const baseState: WorldStateType = {
    time: {
      current: now.toISOString(),
      dayOfWeek: days[now.getDay()],
      timeOfDay,
    },
    user: {
      mode: 'normal',
    },
  };
  
  // Merge overrides
  if (overrides) {
    return {
      ...baseState,
      ...overrides,
      time: { ...baseState.time, ...overrides.time },
      user: { ...baseState.user, ...overrides.user },
    };
  }
  
  return baseState;
}

// =============================================================================
// ACTION EXECUTION
// =============================================================================

/**
 * Execute a validated action using real executors
 */
async function executeAction(
  intent: ActionIntentType,
  userId: string
): Promise<ExecutionResultType> {
  const startTime = Date.now();
  
  try {
    // Import executors dynamically to avoid circular deps
    const { executeTool, getCapability } = await import('../executors');
    
    // Check if tool exists
    const capability = getCapability(intent.action);
    if (!capability) {
      // Fall back to tool guard validation for legacy tools
      const validation = toolGuard.validateToolCall(intent.action, intent.params);
      if (!validation.valid) {
        return {
          success: false,
          action: intent.action,
          error: validation.error || `Unknown tool: ${intent.action}`,
          meta: {
            executedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          },
        };
      }
    }
    
    // Log the execution attempt
    auditLog('ACTION_EXECUTE', {
      userId,
      action: intent.action,
      params: intent.params,
      riskLevel: capability?.riskLevel || 'unknown',
    });
    
    // Execute using the real executor
    const executorResult = await executeTool(intent.action, intent.params);
    
    // Convert executor result to pipeline format
    const result: ExecutionResultType = {
      success: executorResult.success,
      action: intent.action,
      message: executorResult.message,
      data: executorResult.output,
      error: executorResult.error?.message,
      meta: {
        executedAt: executorResult.meta.startedAt.toISOString(),
        durationMs: executorResult.meta.durationMs,
        confirmedBy: 'auto',
      },
    };
    
    // Log completion
    auditLog('ACTION_COMPLETE', {
      userId,
      action: intent.action,
      success: result.success,
      durationMs: result.meta?.durationMs,
      sideEffects: executorResult.sideEffects.length,
    });
    
    // Track side effects for potential rollback
    if (executorResult.sideEffects.length > 0) {
      auditLog('ACTION_SIDE_EFFECTS', {
        userId,
        action: intent.action,
        sideEffects: executorResult.sideEffects,
      });
    }
    
    return result;
    
  } catch (error) {
    logger.error('Action execution failed', { action: intent.action, error });
    
    return {
      success: false,
      action: intent.action,
      error: error instanceof Error ? error.message : 'Execution failed',
      meta: {
        executedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    };
  }
}

// =============================================================================
// LLM INTERACTION
// =============================================================================

/**
 * Send request to LLM and get structured response
 */
async function queryLLM(
  systemPrompt: string,
  userMessage: string,
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const provider = await LLMFactory.getProvider();
  
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...(conversationHistory || []).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];
  
  return await provider.chat(messages, {
    temperature: 0.7,
    maxTokens: 1024,
  });
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

/**
 * Process a user message through the complete pipeline
 */
export async function processPipeline(request: PipelineRequest): Promise<PipelineResponse> {
  const { userId, message, conversationHistory, worldState: worldStateOverrides } = request;
  
  try {
    // 1. Build world state
    const worldState = buildWorldState(worldStateOverrides);
    
    // 2. Get available tools from real executors
    const { getAllCapabilities } = await import('../executors');
    const capabilities = getAllCapabilities();
    
    // Convert capabilities to tool definitions for system prompt
    const tools: ToolDefinitionType[] = capabilities.map(cap => ({
      name: cap.name,
      description: cap.description,
      parameters: {
        type: 'object' as const,
        properties: {}, // Schema is in the capability
        required: [],
      },
      safetyLevel: cap.riskLevel === 'none' ? 'safe' :
                   cap.riskLevel === 'low' ? 'low_risk' :
                   cap.riskLevel === 'medium' ? 'medium' :
                   cap.riskLevel === 'high' ? 'high_risk' : 'critical',
      category: 'info' as const, // Will be overridden
      supportsAutoApproval: cap.reversible && cap.riskLevel === 'none',
    }));
    
    // 3. Generate system prompt
    const systemPrompt = generateSystemPrompt({
      tools,
      worldState,
      userName: worldState.user.name,
    });
    
    // 4. Query LLM
    const llmOutput = await queryLLM(systemPrompt, message, conversationHistory);
    
    // 5. Parse intent
    const parseResult = parseIntent(llmOutput);
    
    if (!parseResult.success || !parseResult.intent) {
      return {
        response: "I'm sorry, I had trouble understanding that. Could you rephrase?",
        intent: null,
      };
    }
    
    if (parseResult.injectionDetected) {
      auditLog('INJECTION_BLOCKED', { userId, message: message.substring(0, 100) });
      return {
        response: "I can't process that request.",
        intent: null,
      };
    }
    
    const intent = parseResult.intent;
    
    // 6. Handle based on intent type
    switch (intent.type) {
      case 'response':
        return {
          response: intent.text,
          intent,
        };
        
      case 'clarify':
        return {
          response: intent.question,
          intent,
          clarification: {
            question: intent.question,
            options: intent.options,
          },
        };
        
      case 'action':
        return await handleActionIntent(intent, userId, worldState, tools, parseResult.preamble);
        
      case 'plan':
        return handlePlanIntent(intent, userId, worldState);
        
      case 'observe':
        // Proactive observation - just inform
        return {
          response: intent.observation,
          intent,
        };
        
      default:
        return {
          response: llmOutput, // Fallback to raw output
          intent: null,
        };
    }
    
  } catch (error) {
    logger.error('Pipeline error', { userId, error });
    return {
      response: "I encountered an error processing your request. Please try again.",
      intent: null,
    };
  }
}

/**
 * Handle an action intent
 */
async function handleActionIntent(
  intent: ActionIntentType,
  userId: string,
  worldState: WorldStateType,
  tools: ToolDefinitionType[],
  preamble?: string
): Promise<PipelineResponse> {
  // Find the tool definition
  const tool = tools.find(t => t.name === intent.action);
  
  if (!tool) {
    return {
      response: `I don't have a tool called "${intent.action}". Let me help you another way.`,
      intent,
    };
  }
  
  // Determine autonomy level
  const autonomy = determineAutonomy(intent, {
    userId,
    worldState,
    tool,
  });
  
  auditLog('AUTONOMY_DECISION', {
    userId,
    action: intent.action,
    level: autonomy.level,
    reason: autonomy.reason,
  });
  
  // Handle based on autonomy level
  switch (autonomy.level) {
    case AutonomyLevel.AUTO_APPROVE:
      // Execute immediately
      const autoResult = await executeAction(intent, userId);
      return {
        response: autoResult.success 
          ? (autoResult.message || `Done.`)
          : `Sorry, that didn't work: ${autoResult.error}`,
        intent,
        executionResult: autoResult,
      };
      
    case AutonomyLevel.ANNOUNCE:
      // Announce and execute
      const announceResult = await executeAction(intent, userId);
      const announceMessage = autonomy.displayMessage || `Executing ${intent.action}`;
      return {
        response: announceResult.success
          ? `${announceMessage}. ${announceResult.message || 'Done.'}`
          : `${announceMessage}. Sorry, that didn't work: ${announceResult.error}`,
        intent,
        executionResult: announceResult,
      };
      
    case AutonomyLevel.CONFIRM_SIMPLE:
    case AutonomyLevel.CONFIRM_DETAILED:
      // Create pending confirmation
      const confirmId = createPendingConfirmation(userId, intent, autonomy, worldState);
      const confirmPreamble = preamble || intent.reasoning || '';
      
      return {
        response: confirmPreamble 
          ? `${confirmPreamble}\n\n${autonomy.displayMessage || 'Confirm this action?'}`
          : (autonomy.displayMessage || 'Confirm this action?'),
        intent,
        pendingConfirmation: {
          id: confirmId,
          action: intent.action,
          params: intent.params,
          displayMessage: autonomy.displayMessage || `Execute ${intent.action}?`,
          displayParams: autonomy.displayParams,
          expiresAt: new Date(Date.now() + (autonomy.expiresInSeconds || 120) * 1000),
        },
      };
      
    case AutonomyLevel.DENY:
      return {
        response: "I'm not able to do that.",
        intent,
      };
      
    default:
      return {
        response: "I'm not sure how to proceed with that.",
        intent,
      };
  }
}

/**
 * Handle a multi-step plan
 */
function handlePlanIntent(
  intent: PlanIntentType,
  userId: string,
  worldState: WorldStateType
): PipelineResponse {
  // For now, just show the plan and ask for confirmation
  // In production, this would create a plan execution context
  
  const stepSummary = intent.steps
    .map((step, i) => `${i + 1}. ${step.reasoning || step.action}`)
    .join('\n');
  
  return {
    response: `${intent.summary}\n\nSteps:\n${stepSummary}\n\nShall I proceed?`,
    intent,
    plan: {
      goal: intent.goal,
      summary: intent.summary,
      steps: intent.steps.map(s => ({ action: s.action, status: 'pending' as const })),
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  buildWorldState,
  executeAction,
};
