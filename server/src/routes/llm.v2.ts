/**
 * LLM Route - Structured Function Calling
 * 
 * This replaces the naive LLM proxy with the proper pipeline:
 * 1. Build world state context
 * 2. Generate system prompt that enforces structured output
 * 3. Send to LLM
 * 4. Parse response into structured intent
 * 5. Route through autonomy engine
 * 6. Execute or request confirmation
 * 
 * The LLM is a PLANNER. It emits INTENT. Execution is sandboxed.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger, auditLog } from '../services/logger';
import { 
  processPipeline, 
  confirmAndExecute, 
  cancelConfirmation,
  getPendingConfirmation,
  buildWorldState,
} from '../core/executionPipeline';
import { 
  WorldStateType,
  JarvisIntentType,
} from '../core/schemas';
import { LLMFactory } from '../core/llm/factory';

export const llmRouter = Router();

// Require authentication for all LLM routes
llmRouter.use(requireAuth);

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(50000),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
});

const chatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
  // Optional world state overrides
  worldState: z.object({
    user: z.object({
      name: z.string().optional(),
      mode: z.enum(['normal', 'focus', 'dnd', 'sleep', 'away', 'guest']).optional(),
    }).optional(),
    desktop: z.object({
      activeApp: z.string().optional(),
      activeWindow: z.string().optional(),
      focusDuration: z.number().optional(),
    }).optional(),
    home: z.object({
      audioOutput: z.string().optional(),
      currentScene: z.string().optional(),
    }).optional(),
    music: z.object({
      isPlaying: z.boolean().optional(),
      currentTrack: z.string().optional(),
    }).optional(),
  }).optional(),
});

const confirmRequestSchema = z.object({
  confirmationId: z.string().min(1),
});

// =============================================================================
// MAIN CHAT ENDPOINT
// =============================================================================

/**
 * POST /api/v1/llm/chat
 * 
 * Send a message through the structured pipeline.
 * Returns either:
 * - A response (just text)
 * - A pending confirmation (action needs approval)
 * - An execution result (action was auto-approved and executed)
 * - A clarification request (LLM needs more info)
 */
llmRouter.post('/chat', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();

  try {
    // Validate request
    const result = chatRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        details: result.error.issues 
      });
    }

    const { message, conversationHistory, worldState } = result.data;

    auditLog('CHAT_REQUEST', {
      userId: req.user!.userId,
      messageLength: message.length,
      hasHistory: !!conversationHistory?.length,
      ip: req.ip,
    });

    // Process through pipeline
    const pipelineResponse = await processPipeline({
      userId: req.user!.userId,
      message,
      conversationHistory,
      worldState: worldState as any,
    });

    const duration = Date.now() - startTime;

    auditLog('CHAT_RESPONSE', {
      userId: req.user!.userId,
      duration,
      intentType: pipelineResponse.intent?.type,
      hasPendingConfirmation: !!pipelineResponse.pendingConfirmation,
      hasExecutionResult: !!pipelineResponse.executionResult,
    });

    // Return structured response
    res.json({
      response: pipelineResponse.response,
      intent: pipelineResponse.intent ? {
        type: pipelineResponse.intent.type,
        // Don't expose full intent details to client
      } : null,
      pendingConfirmation: pipelineResponse.pendingConfirmation ? {
        id: pipelineResponse.pendingConfirmation.id,
        action: pipelineResponse.pendingConfirmation.action,
        displayMessage: pipelineResponse.pendingConfirmation.displayMessage,
        displayParams: pipelineResponse.pendingConfirmation.displayParams,
        expiresAt: pipelineResponse.pendingConfirmation.expiresAt.toISOString(),
      } : null,
      executionResult: pipelineResponse.executionResult ? {
        success: pipelineResponse.executionResult.success,
        message: pipelineResponse.executionResult.message,
        error: pipelineResponse.executionResult.error,
      } : null,
      clarification: pipelineResponse.clarification,
      plan: pipelineResponse.plan,
      meta: {
        durationMs: duration,
      },
    });

  } catch (error) {
    logger.error('Chat endpoint error', { error });
    res.status(500).json({ error: 'Chat request failed' });
  }
});

// =============================================================================
// CONFIRMATION ENDPOINTS
// =============================================================================

/**
 * POST /api/v1/llm/confirm
 * 
 * Confirm a pending action
 */
llmRouter.post('/confirm', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = confirmRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { confirmationId } = result.data;
    const userId = req.user!.userId;

    // Check if confirmation exists
    const pending = getPendingConfirmation(confirmationId, userId);
    if (!pending) {
      return res.status(404).json({ 
        error: 'Confirmation not found or expired' 
      });
    }

    // Execute the action
    const executionResult = await confirmAndExecute(confirmationId, userId);

    if (!executionResult) {
      return res.status(500).json({ error: 'Execution failed' });
    }

    res.json({
      confirmed: true,
      result: {
        success: executionResult.success,
        message: executionResult.message,
        error: executionResult.error,
      },
    });

  } catch (error) {
    logger.error('Confirm endpoint error', { error });
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

/**
 * POST /api/v1/llm/cancel
 * 
 * Cancel a pending confirmation
 */
llmRouter.post('/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = confirmRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { confirmationId } = result.data;
    const userId = req.user!.userId;

    const cancelled = cancelConfirmation(confirmationId, userId);

    if (!cancelled) {
      return res.status(404).json({ 
        error: 'Confirmation not found or already processed' 
      });
    }

    res.json({ cancelled: true });

  } catch (error) {
    logger.error('Cancel endpoint error', { error });
    res.status(500).json({ error: 'Cancellation failed' });
  }
});

// =============================================================================
// LEGACY COMPATIBILITY - Chat Completions
// =============================================================================

/**
 * POST /api/v1/llm/chat/completions
 * 
 * Legacy endpoint for direct LLM proxy.
 * Kept for backward compatibility but routes through pipeline.
 */
llmRouter.post('/chat/completions', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();

  try {
    // Extract user message from OpenAI format
    const messages = req.body.messages as { role: string; content: string }[];
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    // Find the last user message
    const userMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!userMessage) {
      return res.status(400).json({ error: 'No user message found' });
    }

    // Build conversation history from previous messages
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1) // Exclude the last user message
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Process through pipeline
    const pipelineResponse = await processPipeline({
      userId: req.user!.userId,
      message: userMessage.content,
      conversationHistory: history.length > 0 ? history : undefined,
    });

    // Convert to OpenAI response format
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: process.env.LLM_MODEL || 'jarvis',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: pipelineResponse.response,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      // JARVIS extensions
      jarvis: {
        pendingConfirmation: pipelineResponse.pendingConfirmation ? {
          id: pipelineResponse.pendingConfirmation.id,
          action: pipelineResponse.pendingConfirmation.action,
          displayMessage: pipelineResponse.pendingConfirmation.displayMessage,
        } : null,
        executionResult: pipelineResponse.executionResult ? {
          success: pipelineResponse.executionResult.success,
        } : null,
        clarification: pipelineResponse.clarification,
      },
    };

    res.json(openaiResponse);

  } catch (error) {
    logger.error('Legacy completions error', { error });
    res.status(500).json({ error: 'Request failed' });
  }
});

// =============================================================================
// STATUS ENDPOINTS
// =============================================================================

/**
 * GET /api/v1/llm/status
 */
llmRouter.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = await LLMFactory.getProvider();
    const isHealthy = await provider.healthCheck();

    res.json({
      configured: true,
      status: isHealthy ? 'online' : 'error',
      provider: process.env.LLM_PROVIDER || 'local',
      pipeline: 'v2',
    });
  } catch (error) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

/**
 * GET /api/v1/llm/models
 */
llmRouter.get('/models', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const llmBaseUrl = process.env.LLM_BASE_URL;
    if (!llmBaseUrl) {
      return res.status(503).json({ error: 'LLM backend not configured' });
    }

    const response = await fetch(`${llmBaseUrl}/v1/models`, {
      headers: {
        ...(process.env.LLM_API_KEY && { 'Authorization': `Bearer ${process.env.LLM_API_KEY}` }),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch models' });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    logger.error('Models fetch error', { error });
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

/**
 * GET /api/v1/llm/context
 * 
 * Get current world state context (for debugging/UI)
 */
llmRouter.get('/context', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const worldState = buildWorldState();
    res.json({ worldState });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build context' });
  }
});

// =============================================================================
// STREAMING ENDPOINT (for better UX)
// =============================================================================

/**
 * POST /api/v1/llm/chat/stream
 * 
 * Stream tokens as they're generated for real-time response display.
 * Uses Server-Sent Events (SSE) format.
 */
llmRouter.post('/chat/stream', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = chatRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { message, conversationHistory, worldState } = result.data;
    const llmBaseUrl = process.env.LLM_BASE_URL;

    if (!llmBaseUrl) {
      return res.status(503).json({ error: 'LLM backend not configured' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Build the request for the LLM
    const llmRequest = {
      model: process.env.LLM_MODEL || 'qwen/qwen3-14b',
      messages: [
        ...(conversationHistory || []),
        { role: 'user', content: message },
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
    };

    // Make streaming request to LLM backend
    const response = await fetch(`${llmBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.LLM_API_KEY && { 'Authorization': `Bearer ${process.env.LLM_API_KEY}` }),
      },
      body: JSON.stringify(llmRequest),
    });

    if (!response.ok || !response.body) {
      res.write('data: {"error": "LLM request failed"}\n\n');
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Stream the response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content || '';
              if (token) {
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
              }
            } catch {
              // Forward the raw data if we can't parse it
              res.write(`data: ${data}\n\n`);
            }
          }
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    logger.error('Stream chat error', { error });
    res.write('data: {"error": "Stream failed"}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
});
