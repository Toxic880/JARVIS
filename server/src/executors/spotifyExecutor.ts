/**
 * Spotify Executor - Music control via Spotify API
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

async function getTokens(userId: string): Promise<any | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = ? AND provider = ?'
  ).get(userId, 'spotify') as any;
  return row || null;
}

async function refreshTokenIfNeeded(userId: string): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 300000) return tokens.access_token;
  
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    const db = getDatabase();
    db.prepare('UPDATE oauth_tokens SET access_token = ?, expires_at = ? WHERE user_id = ? AND provider = ?')
      .run(data.access_token, Date.now() + (data.expires_in * 1000), userId, 'spotify');
    return data.access_token;
  } catch { return null; }
}

async function spotifyApi(userId: string, endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = await refreshTokenIfNeeded(userId);
  if (!token) throw new Error('Spotify not connected');
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return { success: true };
  if (!response.ok) throw new Error(`Spotify API error: ${response.status}`);
  return response.json();
}

export class SpotifyExecutor implements IToolExecutor {
  id = 'spotify';
  name = 'Spotify Music Control';
  category = 'media';
  description = 'Control Spotify playback';
  private userId: string = 'default';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'playMusic',
        description: 'Play music',
        schema: z.object({
          query: z.string().optional(),
          type: z.enum(['track', 'artist', 'album', 'playlist']).optional().default('track'),
          shuffle: z.boolean().optional().default(false),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'pauseMusic',
        description: 'Pause music',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'skipTrack',
        description: 'Skip track',
        schema: z.object({ direction: z.enum(['next', 'previous']).optional().default('next') }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'setVolume',
        description: 'Set volume',
        schema: z.object({ volume: z.number().min(0).max(100) }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getCurrentTrack',
        description: 'Get current track',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
    ];
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    try {
      let output: any, message: string;
      const sideEffects: any[] = [];

      switch (toolName) {
        case 'playMusic': {
          const { query, type, shuffle } = params;
          if (query) {
            const searchResult = await spotifyApi(this.userId, `/search?q=${encodeURIComponent(query)}&type=${type}&limit=1`);
            const items = searchResult[`${type}s`]?.items;
            if (!items?.length) throw new Error(`Couldn't find "${query}"`);
            const item = items[0];
            if (shuffle) await spotifyApi(this.userId, '/me/player/shuffle?state=true', { method: 'PUT' });
            const body: any = type === 'track' ? { uris: [item.uri] } : { context_uri: item.uri };
            await spotifyApi(this.userId, '/me/player/play', { method: 'PUT', body: JSON.stringify(body) });
            output = { item: { name: item.name } };
            message = `Now playing: ${item.name}`;
          } else {
            await spotifyApi(this.userId, '/me/player/play', { method: 'PUT' });
            message = 'Resumed playback';
            output = { resumed: true };
          }
          sideEffects.push(createSideEffect('device_control', 'spotify', message, { reversible: true }));
          break;
        }
        case 'pauseMusic': {
          await spotifyApi(this.userId, '/me/player/pause', { method: 'PUT' });
          output = { paused: true };
          message = 'Paused playback';
          sideEffects.push(createSideEffect('device_control', 'spotify', message, { reversible: true }));
          break;
        }
        case 'skipTrack': {
          const endpoint = params.direction === 'previous' ? '/me/player/previous' : '/me/player/next';
          await spotifyApi(this.userId, endpoint, { method: 'POST' });
          output = { skipped: true };
          message = params.direction === 'previous' ? 'Previous track' : 'Next track';
          sideEffects.push(createSideEffect('device_control', 'spotify', message, { reversible: true }));
          break;
        }
        case 'setVolume': {
          await spotifyApi(this.userId, `/me/player/volume?volume_percent=${params.volume}`, { method: 'PUT' });
          output = { volume: params.volume };
          message = `Volume set to ${params.volume}%`;
          sideEffects.push(createSideEffect('device_control', 'spotify', message, { reversible: true }));
          break;
        }
        case 'getCurrentTrack': {
          const current = await spotifyApi(this.userId, '/me/player/currently-playing');
          if (!current?.item) {
            output = { playing: false };
            message = 'Nothing playing';
          } else {
            output = { track: current.item.name, artist: current.item.artists?.map((a: any) => a.name).join(', ') };
            message = `Now playing: "${current.item.name}" by ${output.artist}`;
          }
          break;
        }
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return { success: true, output, message, sideEffects, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    } catch (error: any) {
      return { success: false, output: null, message: error.message, sideEffects: [], error: { code: 'SPOTIFY_ERROR', message: error.message, recoverable: true }, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    }
  }

  async simulate(toolName: string, params: Record<string, any>) {
    return { wouldSucceed: true, predictedOutput: { simulated: true }, predictedSideEffects: [], warnings: ['Requires active Spotify session'] };
  }

  validate(toolName: string, params: Record<string, any>) {
    const cap = this.getCapabilities().find(c => c.name === toolName);
    if (!cap) return { valid: false, errors: ['Unknown tool'] };
    const result = cap.schema.safeParse(params);
    return result.success ? { valid: true, sanitizedParams: result.data } : { valid: false, errors: result.error.issues.map(i => i.message) };
  }

  canExecute(toolName: string): boolean { return this.getCapabilities().some(c => c.name === toolName); }
  setUserId(userId: string): void { this.userId = userId; }
}

export const spotifyExecutor = new SpotifyExecutor();
