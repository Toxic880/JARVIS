/**
 * Orchestrator API Routes
 * 
 * Control the JARVIS orchestrator and interact with the system.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { orchestrator } from '../core/orchestrator';
import { logger, auditLog } from '../services/logger';

export const orchestratorRouter = Router();

orchestratorRouter.use(requireAuth);

// =============================================================================
// SCHEMAS
// =============================================================================

const submitRequestSchema = z.object({
  toolName: z.string(),
  params: z.record(z.any()),
  immediate: z.boolean().optional(),
  priority: z.number().min(1).max(10).optional(),
});

const createGoalSchema = z.object({
  description: z.string().min(1).max(1000),
  priority: z.number().min(1).max(10).optional(),
  deadline: z.string().datetime().optional(),
  steps: z.array(z.string()).optional(),
});

// =============================================================================
// LIFECYCLE
// =============================================================================

/**
 * POST /orchestrator/start
 * Start the orchestrator
 */
orchestratorRouter.post('/start', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await orchestrator.start(req.user!.userId);
    res.json({ success: true, message: 'Orchestrator started' });
  } catch (error) {
    logger.error('Failed to start orchestrator', { error });
    res.status(500).json({ error: 'Failed to start orchestrator' });
  }
});

/**
 * POST /orchestrator/stop
 * Stop the orchestrator
 */
orchestratorRouter.post('/stop', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await orchestrator.stop();
    res.json({ success: true, message: 'Orchestrator stopped' });
  } catch (error) {
    logger.error('Failed to stop orchestrator', { error });
    res.status(500).json({ error: 'Failed to stop orchestrator' });
  }
});

/**
 * POST /orchestrator/pause
 * Pause the orchestrator
 */
orchestratorRouter.post('/pause', async (req: AuthenticatedRequest, res: Response) => {
  orchestrator.pause();
  res.json({ success: true, message: 'Orchestrator paused' });
});

/**
 * POST /orchestrator/resume
 * Resume the orchestrator
 */
orchestratorRouter.post('/resume', async (req: AuthenticatedRequest, res: Response) => {
  orchestrator.resume();
  res.json({ success: true, message: 'Orchestrator resumed' });
});

// =============================================================================
// STATUS
// =============================================================================

/**
 * GET /orchestrator/status
 * Get orchestrator status
 */
orchestratorRouter.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  const status = orchestrator.getStatus();
  res.json(status);
});

/**
 * GET /orchestrator/health
 * Get loop health
 */
orchestratorRouter.get('/health', async (req: AuthenticatedRequest, res: Response) => {
  const status = orchestrator.getStatus();
  
  const healthy = 
    status.state === 'running' &&
    status.health.perception.running &&
    status.health.cognition.running &&
    status.health.action.running &&
    status.health.perception.errors < 10 &&
    status.health.cognition.errors < 10 &&
    status.health.action.errors < 10;
  
  res.status(healthy ? 200 : 503).json({
    healthy,
    loops: status.health,
    state: status.state,
  });
});

/**
 * GET /orchestrator/self
 * Get self-knowledge
 */
orchestratorRouter.get('/self', async (req: AuthenticatedRequest, res: Response) => {
  const knowledge = orchestrator.getSelfKnowledge();
  res.json(knowledge);
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * POST /orchestrator/request
 * Submit a request to the orchestrator
 */
orchestratorRouter.post('/request', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = submitRequestSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    
    const { toolName, params, immediate, priority } = parsed.data;
    
    const intentId = await orchestrator.submitRequest(toolName, params, {
      immediate,
      priority,
    });
    
    res.json({ success: true, intentId });
    
  } catch (error) {
    logger.error('Request submission failed', { error });
    res.status(500).json({ error: 'Request failed' });
  }
});

/**
 * POST /orchestrator/confirm/:intentId
 * Confirm a pending action
 */
orchestratorRouter.post('/confirm/:intentId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { intentId } = req.params;
    
    const outcome = await orchestrator.confirmAction(intentId);
    
    if (!outcome) {
      return res.status(404).json({ error: 'No pending confirmation found' });
    }
    
    res.json({ success: true, outcome });
    
  } catch (error) {
    logger.error('Confirmation failed', { error });
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

/**
 * POST /orchestrator/reject/:intentId
 * Reject a pending action
 */
orchestratorRouter.post('/reject/:intentId', async (req: AuthenticatedRequest, res: Response) => {
  const { intentId } = req.params;
  const { reason } = req.body || {};
  
  orchestrator.rejectAction(intentId, reason);
  
  res.json({ success: true });
});

// =============================================================================
// GOALS
// =============================================================================

/**
 * POST /orchestrator/goals
 * Create a new goal
 */
orchestratorRouter.post('/goals', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createGoalSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid goal', details: parsed.error.issues });
    }
    
    const { description, priority, steps } = parsed.data;
    
    const goalId = await orchestrator.createGoal(description, {
      priority,
      steps,
    });
    
    res.json({ success: true, goalId });
    
  } catch (error) {
    logger.error('Goal creation failed', { error });
    res.status(500).json({ error: 'Goal creation failed' });
  }
});

// =============================================================================
// EVENTS (SSE)
// =============================================================================

/**
 * GET /orchestrator/events
 * Server-sent events for real-time updates
 */
orchestratorRouter.get('/events', async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Event handlers
  const onActionComplete = (outcome: any) => sendEvent('actionComplete', outcome);
  const onConfirmationRequired = (data: any) => sendEvent('confirmationRequired', data);
  const onInterruption = (data: any) => sendEvent('interruption', data);
  const onIntentQueued = (intent: any) => sendEvent('intentQueued', { id: intent.id });
  
  // Subscribe
  orchestrator.on('actionComplete', onActionComplete);
  orchestrator.on('confirmationRequired', onConfirmationRequired);
  orchestrator.on('interruption', onInterruption);
  orchestrator.on('intentQueued', onIntentQueued);
  
  // Heartbeat
  const heartbeat = setInterval(() => {
    sendEvent('heartbeat', { timestamp: new Date().toISOString() });
  }, 30000);
  
  // Cleanup on close
  req.on('close', () => {
    clearInterval(heartbeat);
    orchestrator.off('actionComplete', onActionComplete);
    orchestrator.off('confirmationRequired', onConfirmationRequired);
    orchestrator.off('interruption', onInterruption);
    orchestrator.off('intentQueued', onIntentQueued);
  });
  
  // Initial event
  sendEvent('connected', { timestamp: new Date().toISOString() });
});
