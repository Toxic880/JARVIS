/**
 * UI State Routes
 * 
 * Provides UI state to the frontend via:
 * - GET /api/v1/ui/state - Poll current state
 * - GET /api/v1/ui/stream - Server-Sent Events for real-time updates
 */

import { Router, Response, Request } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { subscribeToUIState, getUIState } from '../executors/uiControlExecutor';

export const uiRouter = Router();

// Auth required for all routes
uiRouter.use(requireAuth);

/**
 * GET /api/v1/ui/state
 * Get current UI state (for polling)
 */
uiRouter.get('/state', (req: AuthenticatedRequest, res: Response) => {
  res.json(getUIState());
});

/**
 * GET /api/v1/ui/stream
 * Server-Sent Events stream for real-time UI updates
 */
uiRouter.get('/stream', (req: AuthenticatedRequest, res: Response) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Send initial state
  res.write(`data: ${JSON.stringify(getUIState())}\n\n`);
  
  // Subscribe to updates
  const unsubscribe = subscribeToUIState((state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  });
  
  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);
  
  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
