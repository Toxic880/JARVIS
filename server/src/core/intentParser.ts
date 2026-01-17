/**
 * Intent Parser
 * 
 * Parses LLM output and extracts structured intents.
 * The LLM is instructed to output in specific formats:
 * 
 * 1. Plain text response (no action)
 * 2. JSON code block with intent schema
 * 
 * This parser:
 * - Extracts JSON from markdown code blocks
 * - Validates against our intent schemas
 * - Falls back to response-only if no valid action found
 * - Detects attempts to bypass structure (injection)
 */

import { z } from 'zod';
import { 
  JarvisIntent, 
  JarvisIntentType,
  ActionIntent,
  ResponseIntent,
  ClarifyIntent,
  PlanIntent,
} from './schemas';
import { logger } from '../services/logger';

// =============================================================================
// PARSER RESULT
// =============================================================================

export interface ParseResult {
  success: boolean;
  intent: JarvisIntentType | null;
  // If there's text before/after the JSON, capture it
  preamble?: string;
  // Raw extracted JSON for debugging
  rawJson?: string;
  // Parse errors
  errors?: string[];
  // Was this a fallback to response-only?
  wasFallback?: boolean;
  // Injection attempt detected?
  injectionDetected?: boolean;
}

// =============================================================================
// JSON EXTRACTION
// =============================================================================

/**
 * Extract JSON from markdown code blocks or raw JSON
 */
function extractJson(text: string): { json: string | null; preamble: string } {
  // Try to find JSON in code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const preamble = text.substring(0, codeBlockMatch.index || 0).trim();
    return { json: codeBlockMatch[1].trim(), preamble };
  }
  
  // Try to find raw JSON object
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    // Check if it looks like a valid intent JSON
    const potentialJson = jsonMatch[1];
    if (potentialJson.includes('"type"') && 
        (potentialJson.includes('"action"') || 
         potentialJson.includes('"response"') ||
         potentialJson.includes('"clarify"') ||
         potentialJson.includes('"plan"'))) {
      const preamble = text.substring(0, jsonMatch.index || 0).trim();
      return { json: potentialJson, preamble };
    }
  }
  
  return { json: null, preamble: text.trim() };
}

// =============================================================================
// INJECTION DETECTION
// =============================================================================

/**
 * Patterns that indicate attempted structure bypass
 */
const INJECTION_PATTERNS = [
  // Trying to embed actions in "response" text
  /execute|run|call|invoke.*function/i,
  // Trying to override type field
  /"type"\s*:\s*"(?!response|action|clarify|plan|observe)/i,
  // Shell command patterns in params
  /\$\(.*\)|`.*`|;\s*(rm|curl|wget|bash|sh|python)/i,
  // Path traversal
  /\.\.\//,
  // Encoded payloads
  /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i,
];

function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Sanitize params to remove dangerous patterns
 */
function sanitizeParams(params: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      // Remove shell special chars and path traversal
      let clean = value
        .replace(/\.\.\//g, '')
        .replace(/[;|&$`]/g, '')
        .trim();
      sanitized[key] = clean;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeParams(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse LLM output into structured intent
 */
export function parseIntent(llmOutput: string): ParseResult {
  const errors: string[] = [];
  
  // Check for empty output
  if (!llmOutput || llmOutput.trim().length === 0) {
    return {
      success: false,
      intent: null,
      errors: ['Empty LLM output'],
    };
  }
  
  // Check for injection attempts in raw output
  if (detectInjection(llmOutput)) {
    logger.warn('Injection attempt detected in LLM output', {
      preview: llmOutput.substring(0, 200),
    });
    return {
      success: false,
      intent: null,
      errors: ['Potential injection detected'],
      injectionDetected: true,
    };
  }
  
  // Extract JSON from output
  const { json, preamble } = extractJson(llmOutput);
  
  // If no JSON found, treat entire output as response
  if (!json) {
    return {
      success: true,
      intent: {
        type: 'response',
        text: llmOutput.trim(),
      },
      wasFallback: true,
    };
  }
  
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    logger.warn('Failed to parse JSON from LLM output', { 
      json: json.substring(0, 200),
      error: e,
    });
    
    // Fall back to response with preamble
    return {
      success: true,
      intent: {
        type: 'response',
        text: preamble || llmOutput.trim(),
      },
      errors: ['Invalid JSON in output'],
      rawJson: json,
      wasFallback: true,
    };
  }
  
  // Validate against intent schema
  const result = JarvisIntent.safeParse(parsed);
  
  if (!result.success) {
    logger.warn('LLM output failed schema validation', {
      errors: result.error.issues,
      parsed,
    });
    
    // Try to extract useful info anyway
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      const p = parsed as Record<string, unknown>;
      
      // Partial action - missing fields
      if (p.type === 'action' && typeof p.action === 'string') {
        return {
          success: true,
          intent: {
            type: 'action',
            action: p.action,
            params: sanitizeParams((p.params as Record<string, any>) || {}),
            confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
            reasoning: typeof p.reasoning === 'string' ? p.reasoning : undefined,
          },
          errors: result.error.issues.map(i => i.message),
          rawJson: json,
        };
      }
    }
    
    // Fall back to response
    return {
      success: true,
      intent: {
        type: 'response',
        text: preamble || llmOutput.trim(),
      },
      errors: result.error.issues.map(i => i.message),
      rawJson: json,
      wasFallback: true,
    };
  }
  
  // Validated intent - sanitize params if action
  let intent = result.data;
  
  if (intent.type === 'action') {
    intent = {
      ...intent,
      params: sanitizeParams(intent.params),
    };
  } else if (intent.type === 'plan') {
    intent = {
      ...intent,
      steps: intent.steps.map(step => ({
        ...step,
        params: sanitizeParams(step.params),
      })),
    };
  }
  
  return {
    success: true,
    intent,
    preamble: preamble || undefined,
    rawJson: json,
  };
}

// =============================================================================
// RESPONSE BUILDER
// =============================================================================

/**
 * Build a response intent from plain text
 */
export function buildResponseIntent(text: string, suggestions?: string[]): JarvisIntentType {
  return {
    type: 'response',
    text,
    suggestions,
  };
}

/**
 * Build a clarification intent
 */
export function buildClarifyIntent(
  question: string, 
  options?: { label: string; value: string }[],
  pendingAction?: string
): JarvisIntentType {
  return {
    type: 'clarify',
    question,
    options,
    pendingAction,
  };
}

/**
 * Build an action intent
 */
export function buildActionIntent(
  action: string,
  params: Record<string, any>,
  confidence = 0.8,
  reasoning?: string
): JarvisIntentType {
  return {
    type: 'action',
    action,
    params: sanitizeParams(params),
    confidence,
    reasoning,
  };
}
