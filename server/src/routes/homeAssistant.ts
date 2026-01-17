/**
 * Home Assistant Proxy Routes
 * 
 * Proxies requests to Home Assistant and:
 * - Keeps the HA token server-side
 * - Validates device/entity IDs
 * - Logs all device control actions
 */

import { Router, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger, auditLog } from '../services/logger';

export const homeAssistantRouter = Router();

// Require authentication
homeAssistantRouter.use(requireAuth);

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const controlDeviceSchema = z.object({
  entityId: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),
  action: z.enum(['turn_on', 'turn_off', 'toggle', 'lock', 'unlock']),
  data: z.record(z.any()).optional(),
});

const callServiceSchema = z.object({
  domain: z.string(),
  service: z.string(),
  data: z.record(z.any()).optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function haFetch(path: string, options: RequestInit = {}): Promise<globalThis.Response> {
  const haUrl = process.env.HOME_ASSISTANT_URL;
  const haToken = process.env.HOME_ASSISTANT_TOKEN;

  if (!haUrl || !haToken) {
    throw new Error('Home Assistant not configured');
  }

  const url = `${haUrl.replace(/\/$/, '')}/api${path}`;
  
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${haToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/v1/home-assistant/status
 * Check Home Assistant connection
 */
homeAssistantRouter.get('/status', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  const haUrl = process.env.HOME_ASSISTANT_URL;
  
  if (!haUrl) {
    return res.json({
      configured: false,
      status: 'not_configured',
    });
  }

  try {
    const response = await haFetch('/');
    
    if (response.ok) {
      const data = await response.json() as any;
      res.json({
        configured: true,
        status: 'online',
        version: data.version,
        location: data.location_name,
      });
    } else {
      res.json({
        configured: true,
        status: 'error',
        error: 'Authentication failed',
      });
    }
  } catch (error) {
    res.json({
      configured: true,
      status: 'offline',
      error: 'Connection failed',
    });
  }
});

/**
 * GET /api/v1/home-assistant/states
 * Get all entity states
 */
homeAssistantRouter.get('/states', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const response = await haFetch('/states');
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch states' });
    }

    const states = await response.json() as any[];
    
    // Filter to relevant domains
    const relevantDomains = ['light', 'switch', 'lock', 'cover', 'climate', 'media_player', 'scene', 'sensor'];
    const filtered = states.filter((s: any) => {
      const domain = s.entity_id.split('.')[0];
      return relevantDomains.includes(domain);
    });

    res.json({ states: filtered });

  } catch (error: any) {
    logger.error('HA states error', { error: error.message });
    res.status(500).json({ error: error.message || 'Failed to fetch states' });
  }
});

/**
 * GET /api/v1/home-assistant/states/:entityId
 * Get single entity state
 */
homeAssistantRouter.get('/states/:entityId', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const response = await haFetch(`/states/${req.params.entityId}`);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Entity not found' });
    }

    const state = await response.json();
    res.json(state);

  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch state' });
  }
});

/**
 * POST /api/v1/home-assistant/control
 * Control a device (turn on/off, lock, etc.)
 */
homeAssistantRouter.post('/control', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const result = controlDeviceSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    }

    const { entityId, action, data } = result.data;
    const domain = entityId.split('.')[0];

    // Map action to service
    let service: string;
    switch (action) {
      case 'turn_on':
        service = 'turn_on';
        break;
      case 'turn_off':
        service = 'turn_off';
        break;
      case 'toggle':
        service = 'toggle';
        break;
      case 'lock':
        service = 'lock';
        break;
      case 'unlock':
        service = 'unlock';
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const response = await haFetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify({
        entity_id: entityId,
        ...data,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('HA control error', { entityId, action, error: errorText });
      return res.status(response.status).json({ error: 'Control failed' });
    }

    auditLog('HA_DEVICE_CONTROL', {
      userId: req.user!.userId,
      entityId,
      action,
      data,
      ip: req.ip,
    });

    res.json({ success: true, entityId, action });

  } catch (error: any) {
    logger.error('HA control error', { error: error.message });
    res.status(500).json({ error: error.message || 'Control failed' });
  }
});

/**
 * POST /api/v1/home-assistant/services
 * Call any HA service
 */
homeAssistantRouter.post('/services', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const result = callServiceSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    }

    const { domain, service, data } = result.data;

    // Blocklist dangerous services
    const blockedServices = [
      'homeassistant.restart',
      'homeassistant.stop',
      'system_log.clear',
    ];
    
    if (blockedServices.includes(`${domain}.${service}`)) {
      return res.status(403).json({ error: 'Service not allowed' });
    }

    const response = await haFetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Service call failed' });
    }

    auditLog('HA_SERVICE_CALL', {
      userId: req.user!.userId,
      domain,
      service,
      data,
      ip: req.ip,
    });

    const result_data = await response.json();
    res.json({ success: true, result: result_data });

  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Service call failed' });
  }
});

/**
 * POST /api/v1/home-assistant/scenes/activate
 * Activate a scene
 */
homeAssistantRouter.post('/scenes/activate', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const { sceneId } = req.body;
    
    if (!sceneId || typeof sceneId !== 'string') {
      return res.status(400).json({ error: 'Scene ID required' });
    }

    const entityId = sceneId.startsWith('scene.') ? sceneId : `scene.${sceneId}`;

    const response = await haFetch('/services/scene/turn_on', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Scene activation failed' });
    }

    auditLog('HA_SCENE_ACTIVATE', {
      userId: req.user!.userId,
      sceneId: entityId,
      ip: req.ip,
    });

    res.json({ success: true, scene: entityId });

  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Scene activation failed' });
  }
});

/**
 * GET /api/v1/home-assistant/history/:entityId
 * Get entity history
 */
homeAssistantRouter.get('/history/:entityId', async (req: AuthenticatedRequest, res: ExpressResponse) => {
  try {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168); // Max 1 week
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    const response = await haFetch(
      `/history/period/${startTime}?filter_entity_id=${req.params.entityId}`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'History fetch failed' });
    }

    const history = await response.json() as any[];
    res.json({ history: history[0] || [] });

  } catch (error: any) {
    res.status(500).json({ error: error.message || 'History fetch failed' });
  }
});
