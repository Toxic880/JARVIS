/**
 * Perception Route
 * 
 * Endpoints for updating world state from:
 * - Native screen capture agent
 * - Client focus tracking
 * - Home Assistant webhooks
 * - Music service callbacks
 * 
 * This is what makes Jarvis "aware" of what's happening.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import {
  handlePerceptionUpdate,
  buildPerceptionWorldState,
  updateFocus,
  updateMusicState,
  updateHomeState,
  updateMode,
  recordAction,
  markIdle,
  perceptionState,
} from '../core/perception';

export const perceptionRouter = Router();

// Most perception updates require auth
perceptionRouter.use(requireAuth);

// =============================================================================
// SCHEMAS
// =============================================================================

const focusUpdateSchema = z.object({
  app: z.string().max(200),
  window: z.string().max(500).optional(),
});

const musicUpdateSchema = z.object({
  playing: z.boolean(),
  track: z.string().max(500).optional(),
  artist: z.string().max(200).optional(),
  playlist: z.string().max(200).optional(),
});

const homeUpdateSchema = z.object({
  audioOutput: z.string().max(200).optional(),
  scene: z.string().max(200).optional(),
  activeDevices: z.array(z.string()).optional(),
});

const modeUpdateSchema = z.object({
  mode: z.enum(['normal', 'focus', 'dnd', 'sleep', 'away', 'guest']),
});

const actionUpdateSchema = z.object({
  action: z.string().max(200),
  params: z.record(z.any()).optional(),
});

// =============================================================================
// ENDPOINTS
// =============================================================================

/**
 * POST /api/v1/perception/focus
 * 
 * Update current focus (app/window)
 * Called by native agent or client
 */
perceptionRouter.post('/focus', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = focusUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    }

    const { app, window } = result.data;
    updateFocus(app, window);

    res.json({ success: true });
  } catch (error) {
    logger.error('Focus update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /api/v1/perception/music
 * 
 * Update music playback state
 * Called by Spotify webhook or client
 */
perceptionRouter.post('/music', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = musicUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { playing, track, artist } = result.data;
    const trackName = artist ? `${track} - ${artist}` : track;
    updateMusicState(playing, trackName);

    res.json({ success: true });
  } catch (error) {
    logger.error('Music update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /api/v1/perception/home
 * 
 * Update home state
 * Called by Home Assistant webhook
 */
perceptionRouter.post('/home', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = homeUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { audioOutput, scene } = result.data;
    updateHomeState(audioOutput, scene);

    res.json({ success: true });
  } catch (error) {
    logger.error('Home update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /api/v1/perception/mode
 * 
 * Update Jarvis mode
 */
perceptionRouter.post('/mode', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = modeUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    updateMode(result.data.mode);
    res.json({ success: true, mode: result.data.mode });
  } catch (error) {
    logger.error('Mode update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /api/v1/perception/action
 * 
 * Record a user action (for pattern detection)
 */
perceptionRouter.post('/action', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = actionUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    recordAction(result.data.action);
    res.json({ success: true });
  } catch (error) {
    logger.error('Action record error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /api/v1/perception/idle
 * 
 * Mark user as idle
 */
perceptionRouter.post('/idle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    markIdle();
    res.json({ success: true });
  } catch (error) {
    logger.error('Idle update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * GET /api/v1/perception/state
 * 
 * Get current perception state (for debugging/UI)
 */
perceptionRouter.get('/state', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const worldState = buildPerceptionWorldState();
    
    res.json({
      worldState,
      raw: {
        activeApp: perceptionState.activeApp,
        activeWindow: perceptionState.activeWindow,
        mode: perceptionState.currentMode,
        musicPlaying: perceptionState.musicPlaying,
        currentTrack: perceptionState.currentTrack,
      },
    });
  } catch (error) {
    logger.error('State fetch error', { error });
    res.status(500).json({ error: 'Fetch failed' });
  }
});

/**
 * POST /api/v1/perception/batch
 * 
 * Batch update multiple perception fields at once
 * Useful for native agents that poll periodically
 */
perceptionRouter.post('/batch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updates = req.body.updates as { type: string; data: any }[];
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an array' });
    }

    for (const update of updates) {
      try {
        handlePerceptionUpdate(update as any);
      } catch (e) {
        logger.warn('Batch update item failed', { update, error: e });
      }
    }

    res.json({ success: true, processed: updates.length });
  } catch (error) {
    logger.error('Batch update error', { error });
    res.status(500).json({ error: 'Update failed' });
  }
});

// =============================================================================
// NATIVE CLIENT INTEGRATION
// =============================================================================

import { perceptionAgent } from '../core/nativePerception';

/**
 * POST /perception/native/ingest
 * Receive perception data from native Windows/Mac client
 */
perceptionRouter.post('/native/ingest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, payload } = req.body;
    
    if (!type || !payload) {
      return res.status(400).json({ error: 'type and payload required' });
    }
    
    // Feed into native perception agent
    perceptionAgent.ingest({ type, payload });
    
    // Also update the legacy perception state for compatibility
    if (type === 'window' && payload.app) {
      updateFocus(payload.app, payload.title);
    }
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Native ingest error', { error });
    res.status(500).json({ error: 'Ingest failed' });
  }
});

/**
 * GET /perception/native/snapshot
 * Get current native perception snapshot
 */
perceptionRouter.get('/native/snapshot', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snapshot = perceptionAgent.getSnapshot();
    res.json(snapshot);
  } catch (error) {
    logger.error('Native snapshot error', { error });
    res.status(500).json({ error: 'Snapshot failed' });
  }
});

/**
 * GET /perception/native/context
 * Get perception context string for LLM
 */
perceptionRouter.get('/native/context', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const context = perceptionAgent.getContextForLLM();
    res.json({ context });
  } catch (error) {
    logger.error('Native context error', { error });
    res.status(500).json({ error: 'Context failed' });
  }
});

/**
 * GET /perception/native/interruptible
 * Check if user is currently interruptible
 */
perceptionRouter.get('/native/interruptible', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = perceptionAgent.isInterruptible();
    res.json(result);
  } catch (error) {
    logger.error('Interruptible check error', { error });
    res.status(500).json({ error: 'Check failed' });
  }
});
