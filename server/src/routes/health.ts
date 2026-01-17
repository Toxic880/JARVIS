/**
 * Health Check Routes
 * 
 * Unauthenticated endpoints for:
 * - Basic health check
 * - Readiness check
 * - Version info
 */

import { Router } from 'express';
import { getDatabase } from '../db/init';

export const healthRouter = Router();

/**
 * GET /api/v1/health
 * Basic health check
 */
healthRouter.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v1/health/ready
 * Readiness check (database connectivity)
 */
healthRouter.get('/ready', (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
    
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/health/version
 * Version and build info
 */
healthRouter.get('/version', (req, res) => {
  res.json({
    version: '1.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
  });
});

/**
 * GET /api/v1/health/config
 * Check which services are configured (no secrets exposed)
 */
healthRouter.get('/config', (req, res) => {
  res.json({
    llm: {
      configured: !!process.env.LLM_BASE_URL,
      url: process.env.LLM_BASE_URL ? new URL(process.env.LLM_BASE_URL).origin : null,
    },
    tts: {
      configured: !!process.env.ELEVENLABS_API_KEY,
    },
    homeAssistant: {
      configured: !!process.env.HOME_ASSISTANT_URL && !!process.env.HOME_ASSISTANT_TOKEN,
    },
    spotify: {
      configured: !!process.env.SPOTIFY_CLIENT_ID,
    },
    google: {
      configured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    },
    pushNotifications: {
      pushover: !!process.env.PUSHOVER_API_TOKEN,
    },
    sms: {
      configured: !!process.env.TWILIO_ACCOUNT_SID,
    },
  });
});
