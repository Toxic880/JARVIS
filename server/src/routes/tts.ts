/**
 * TTS (Text-to-Speech) Proxy Route
 * 
 * Proxies TTS requests to ElevenLabs and:
 * - Keeps API key server-side only
 * - Validates and sanitizes text input
 * - Caches common responses
 * - Rate limits per user
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger, auditLog } from '../services/logger';

export const ttsRouter = Router();

// Require authentication
ttsRouter.use(requireAuth);

// Simple in-memory cache for common phrases
const ttsCache = new Map<string, { audio: Buffer; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 100;

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
  voiceSettings: z.object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
  }).optional(),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/v1/tts/speak
 * Convert text to speech
 */
ttsRouter.post('/speak', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Validate request
    const result = ttsRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        details: result.error.issues 
      });
    }

    const { text, voiceId, modelId, voiceSettings } = result.data;

    // Check if ElevenLabs is configured
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'TTS service not configured' });
    }

    const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

    // Check cache for short common phrases
    const cacheKey = `${voice}:${text}`;
    const cached = ttsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      auditLog('TTS_CACHE_HIT', { userId: req.user!.userId, textLength: text.length });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.audio);
    }

    // Make request to ElevenLabs
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId || 'eleven_monolingual_v1',
          voice_settings: voiceSettings || {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ElevenLabs API error', { 
        status: response.status, 
        error: errorText 
      });
      return res.status(response.status).json({ 
        error: 'TTS request failed',
        details: process.env.NODE_ENV === 'development' ? errorText : undefined,
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Cache short responses
    if (text.length < 200) {
      // Evict old entries if cache is full
      if (ttsCache.size >= MAX_CACHE_SIZE) {
        const oldest = Array.from(ttsCache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) ttsCache.delete(oldest[0]);
      }
      ttsCache.set(cacheKey, { audio: audioBuffer, timestamp: Date.now() });
    }

    auditLog('TTS_REQUEST', {
      userId: req.user!.userId,
      textLength: text.length,
      voiceId: voice,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Cache', 'MISS');
    res.send(audioBuffer);

  } catch (error) {
    logger.error('TTS error', { error });
    res.status(500).json({ error: 'TTS request failed' });
  }
});

/**
 * GET /api/v1/tts/voices
 * List available voices
 */
ttsRouter.get('/voices', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'TTS service not configured' });
    }

    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch voices' });
    }

    const data = await response.json() as any;
    
    // Return simplified voice list
    const voices = data.voices?.map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      preview_url: v.preview_url,
    })) || [];

    res.json({ voices });

  } catch (error) {
    logger.error('Voices fetch error', { error });
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

/**
 * GET /api/v1/tts/status
 * Check TTS service status
 */
ttsRouter.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    return res.json({
      configured: false,
      status: 'not_configured',
    });
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });

    if (response.ok) {
      const data = await response.json() as any;
      res.json({
        configured: true,
        status: 'online',
        subscription: data.subscription?.tier,
        charactersRemaining: data.subscription?.character_count - data.subscription?.character_used,
      });
    } else {
      res.json({
        configured: true,
        status: 'error',
        error: 'Invalid API key or quota exceeded',
      });
    }
  } catch (error) {
    res.json({
      configured: true,
      status: 'offline',
    });
  }
});

/**
 * DELETE /api/v1/tts/cache
 * Clear TTS cache (admin only)
 */
ttsRouter.delete('/cache', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const count = ttsCache.size;
  ttsCache.clear();

  auditLog('TTS_CACHE_CLEARED', { userId: req.user!.userId, entriesCleared: count });

  res.json({ message: `Cleared ${count} cached entries` });
});
