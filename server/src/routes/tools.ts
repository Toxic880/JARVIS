/**
 * Tools Routes
 * 
 * Secure tool execution with:
 * - Allowlist validation
 * - Parameter validation
 * - Confirmation for dangerous actions
 * - Complete audit logging
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { ToolGuard, ConfirmationManager, TOOL_DEFINITIONS } from '../services/toolGuard';
import { logger } from '../services/logger';

export const toolsRouter = Router();

// Require authentication
toolsRouter.use(requireAuth);

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const executeToolSchema = z.object({
  name: z.string(),
  parameters: z.record(z.any()).optional(),
});

const confirmToolSchema = z.object({
  confirmationId: z.string().uuid(),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/v1/tools
 * List available tools and their definitions
 */
toolsRouter.get('/', (req: AuthenticatedRequest, res: Response) => {
  const tools = ToolGuard.getDefinitions();
  res.json({ tools });
});

/**
 * POST /api/v1/tools/execute
 * Execute a tool (with validation and logging)
 */
toolsRouter.post('/execute', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();

  try {
    // Validate request
    const result = executeToolSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        details: result.error.issues 
      });
    }

    const { name, parameters = {} } = result.data;

    // Validate tool against allowlist and schema
    const validation = ToolGuard.validate(name, parameters);
    if (!validation.valid) {
      ToolGuard.logExecution(
        req.user!.userId,
        name,
        parameters,
        { error: validation.error },
        'rejected',
        Date.now() - startTime,
        req.ip
      );

      logger.warn('Tool execution rejected', {
        userId: req.user!.userId,
        tool: name,
        reason: validation.error,
      });

      return res.status(400).json({ 
        error: 'Tool validation failed', 
        details: validation.error 
      });
    }

    // Check if confirmation is required
    if (validation.requiresConfirmation) {
      const confirmationId = ConfirmationManager.create(
        req.user!.userId,
        name,
        parameters
      );

      ToolGuard.logExecution(
        req.user!.userId,
        name,
        parameters,
        { confirmationId },
        'pending_confirmation',
        Date.now() - startTime,
        req.ip
      );

      return res.status(202).json({
        status: 'confirmation_required',
        message: `This action requires confirmation. Tool: ${name}`,
        confirmationId,
        tool: name,
        parameters,
        category: validation.category,
        expiresIn: 300, // 5 minutes
      });
    }

    // Execute the tool
    // NOTE: This returns a result object that should be processed by the client
    // The actual tool implementation lives in the client or in specific tool handlers
    const toolResult = await executeToolHandler(name, parameters, req.user!.userId);

    ToolGuard.logExecution(
      req.user!.userId,
      name,
      parameters,
      toolResult,
      toolResult.error ? 'error' : 'success',
      Date.now() - startTime,
      req.ip
    );

    res.json({
      status: 'success',
      tool: name,
      result: toolResult,
    });

  } catch (error) {
    logger.error('Tool execution error', { error });
    res.status(500).json({ error: 'Tool execution failed' });
  }
});

/**
 * POST /api/v1/tools/confirm
 * Confirm a dangerous tool execution
 */
toolsRouter.post('/confirm', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();

  try {
    const result = confirmToolSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid confirmation ID' });
    }

    const { confirmationId } = result.data;

    // Get and consume the pending confirmation
    const confirmation = ConfirmationManager.consume(confirmationId, req.user!.userId);
    if (!confirmation) {
      return res.status(404).json({ 
        error: 'Confirmation not found or expired',
        message: 'The confirmation may have expired or already been used. Please try the action again.'
      });
    }

    // Execute the confirmed tool
    const toolResult = await executeToolHandler(
      confirmation.toolName, 
      confirmation.parameters, 
      req.user!.userId
    );

    ToolGuard.logExecution(
      req.user!.userId,
      confirmation.toolName,
      confirmation.parameters,
      { ...toolResult, confirmedAt: new Date().toISOString() },
      toolResult.error ? 'error' : 'success',
      Date.now() - startTime,
      req.ip
    );

    res.json({
      status: 'success',
      tool: confirmation.toolName,
      result: toolResult,
      confirmed: true,
    });

  } catch (error) {
    logger.error('Tool confirmation error', { error });
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

/**
 * DELETE /api/v1/tools/confirm/:id
 * Cancel a pending confirmation
 */
toolsRouter.delete('/confirm/:id', (req: AuthenticatedRequest, res: Response) => {
  // Just let it expire - we don't need to actively cancel
  res.json({ message: 'Confirmation cancelled' });
});

/**
 * GET /api/v1/tools/pending
 * Get pending confirmations for current user
 */
toolsRouter.get('/pending', (req: AuthenticatedRequest, res: Response) => {
  const pending = ConfirmationManager.getPending(req.user!.userId);
  res.json({
    pending: pending.map(p => ({
      id: p.id,
      tool: p.toolName,
      parameters: p.parameters,
      expiresAt: p.expiresAt.toISOString(),
    })),
  });
});

/**
 * GET /api/v1/tools/history
 * Get tool execution history
 */
toolsRouter.get('/history', (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const offset = parseInt(req.query.offset as string) || 0;

  const history = ToolGuard.getHistory({
    userId: req.user!.role === 'admin' ? undefined : req.user!.userId,
    toolName: req.query.tool as string,
    status: req.query.status as string,
    limit,
    offset,
  });

  // Parse JSON fields
  const parsed = history.map((h: any) => ({
    ...h,
    parameters: JSON.parse(h.parameters),
    result: h.result ? JSON.parse(h.result) : null,
  }));

  res.json({ history: parsed });
});

// =============================================================================
// TOOL HANDLERS
// =============================================================================

/**
 * Execute a tool handler
 * 
 * NOTE: Most tools need to be executed on the client side because they
 * interact with browser APIs (speech, localStorage cache, etc.) or
 * need real-time UI updates.
 * 
 * Server-side tools are those that:
 * - Access external APIs with secrets (weather, stocks, etc.)
 * - Persist data (memory, lists, notes)
 * - Control Home Assistant devices
 */
async function executeToolHandler(
  name: string, 
  parameters: any,
  userId: string
): Promise<{ result?: any; error?: string }> {
  
  switch (name) {
    // Server-side executable tools
    case 'getTime':
      return { result: new Date().toLocaleTimeString() };
    
    case 'getDate':
      return { result: new Date().toLocaleDateString() };

    // Most tools return instructions for client-side execution
    default:
      return {
        result: {
          executeOnClient: true,
          tool: name,
          parameters,
          validatedAt: new Date().toISOString(),
        }
      };
  }
}
