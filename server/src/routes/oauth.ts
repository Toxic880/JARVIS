/**
 * OAuth Routes
 * 
 * Server-side token exchange for:
 * - Spotify (handles client secret)
 * - Google (handles client secret)
 * 
 * Clients initiate OAuth flow, server handles token exchange
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest, optionalAuth } from '../middleware/auth';
import { logger, auditLog } from '../services/logger';

export const oauthRouter = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const tokenExchangeSchema = z.object({
  code: z.string(),
  redirectUri: z.string().url(),
  codeVerifier: z.string().optional(), // For PKCE
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// =============================================================================
// SPOTIFY
// =============================================================================

/**
 * GET /api/v1/oauth/spotify/config
 * Get Spotify OAuth config (client ID only, not secret)
 */
oauthRouter.get('/spotify/config', optionalAuth, (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  
  res.json({
    configured: !!clientId,
    clientId: clientId || null,
    authUrl: 'https://accounts.spotify.com/authorize',
    scopes: [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'user-library-read',
    ].join(' '),
  });
});

/**
 * POST /api/v1/oauth/spotify/url
 * Generate OAuth URL for Spotify (uses server's client ID)
 */
oauthRouter.post('/spotify/url', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    
    if (!clientId) {
      return res.status(503).json({ 
        error: 'Spotify not configured',
        message: 'Spotify integration requires configuration. Add SPOTIFY_CLIENT_ID to your .env file.',
        setupUrl: 'https://developer.spotify.com/dashboard',
      });
    }
    
    const { state, redirect_uri, scopes } = req.body;
    
    const scopeString = Array.isArray(scopes) ? scopes.join(' ') : 
      'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private';
    
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirect_uri || `${req.headers.origin}/oauth/callback`,
      scope: scopeString,
      state: state || '',
    });
    
    const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
    
    res.json({ url });
    
  } catch (error) {
    logger.error('Spotify URL generation error', { error });
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * POST /api/v1/oauth/spotify/callback
 * Handle OAuth callback - exchange code for tokens
 */
oauthRouter.post('/spotify/callback', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, redirect_uri } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }
    
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(503).json({ error: 'Spotify not configured' });
    }
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect_uri || `${req.headers.origin}/oauth/callback`,
    });
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: params.toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Spotify callback failed', { status: response.status, error: errorText });
      return res.status(response.status).json({ error: 'Token exchange failed' });
    }
    
    const tokens = await response.json() as any;
    
    // Get user profile to get email
    let email = null;
    try {
      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json() as any;
        email = profile.email;
      }
    } catch (e) {
      // Ignore profile fetch errors
    }
    
    auditLog('OAUTH_SPOTIFY_CONNECTED', { userId: req.user!.userId });
    
    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      email,
    });
    
  } catch (error) {
    logger.error('Spotify callback error', { error });
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

/**
 * POST /api/v1/oauth/spotify/token
 * Exchange authorization code for tokens
 */
oauthRouter.post('/spotify/token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = tokenExchangeSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    }

    const { code, redirectUri, codeVerifier } = result.data;
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId) {
      return res.status(503).json({ error: 'Spotify not configured' });
    }

    // Build token request
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    // PKCE flow (no client secret needed)
    if (codeVerifier) {
      params.append('client_id', clientId);
      params.append('code_verifier', codeVerifier);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // If we have client secret, use it
    if (clientSecret && !codeVerifier) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Spotify token exchange failed', { status: response.status, error: errorText });
      return res.status(response.status).json({ error: 'Token exchange failed' });
    }

    const tokens = await response.json() as any;

    auditLog('OAUTH_SPOTIFY_TOKEN', { userId: req.user!.userId, ip: req.ip });

    // Return tokens to client (they handle storage)
    res.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });

  } catch (error) {
    logger.error('Spotify token error', { error });
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

/**
 * POST /api/v1/oauth/spotify/refresh
 * Refresh Spotify access token
 */
oauthRouter.post('/spotify/refresh', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = refreshTokenSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const { refreshToken } = result.data;
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId) {
      return res.status(503).json({ error: 'Spotify not configured' });
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (clientSecret) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers,
      body: params.toString(),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Token refresh failed' });
    }

    const tokens = await response.json() as any;

    res.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken, // May not always return new refresh token
      expiresIn: tokens.expires_in,
    });

  } catch (error) {
    logger.error('Spotify refresh error', { error });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// =============================================================================
// GOOGLE
// =============================================================================

/**
 * GET /api/v1/oauth/google/config
 * Get Google OAuth config
 */
oauthRouter.get('/google/config', optionalAuth, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  
  res.json({
    configured: !!clientId,
    clientId: clientId || null,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/tasks',
      'https://www.googleapis.com/auth/gmail.readonly',
    ].join(' '),
  });
});

/**
 * POST /api/v1/oauth/google/url
 * Generate OAuth URL for Google (uses server's client ID)
 */
oauthRouter.post('/google/url', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    
    if (!clientId) {
      return res.status(503).json({ 
        error: 'Google not configured',
        message: 'Google integration requires configuration. Add GOOGLE_CLIENT_ID to your .env file.',
        setupUrl: 'https://console.cloud.google.com/apis/credentials',
      });
    }
    
    const { state, redirect_uri, scopes } = req.body;
    
    const scopeString = Array.isArray(scopes) ? scopes.join(' ') : 
      'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';
    
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirect_uri || `${req.headers.origin}/oauth/callback`,
      scope: scopeString,
      state: state || '',
      access_type: 'offline',
      prompt: 'consent',
    });
    
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    
    res.json({ url });
    
  } catch (error) {
    logger.error('Google URL generation error', { error });
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

/**
 * POST /api/v1/oauth/google/callback
 * Handle OAuth callback - exchange code for tokens
 */
oauthRouter.post('/google/callback', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code, redirect_uri } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      return res.status(503).json({ error: 'Google not configured' });
    }
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect_uri || `${req.headers.origin}/oauth/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Google callback failed', { status: response.status, error: errorText });
      return res.status(response.status).json({ error: 'Token exchange failed' });
    }
    
    const tokens = await response.json() as any;
    
    // Get user email
    let email = null;
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
      });
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json() as any;
        email = userInfo.email;
      }
    } catch (e) {
      // Ignore profile fetch errors
    }
    
    auditLog('OAUTH_GOOGLE_CONNECTED', { userId: req.user!.userId, email });
    
    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      email,
    });
    
  } catch (error) {
    logger.error('Google callback error', { error });
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

/**
 * POST /api/v1/oauth/google/token
 * Exchange authorization code for tokens
 */
oauthRouter.post('/google/token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = tokenExchangeSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid request', details: result.error.issues });
    }

    const { code, redirectUri } = result.data;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(503).json({ error: 'Google OAuth not configured' });
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Google token exchange failed', { status: response.status, error: errorText });
      return res.status(response.status).json({ error: 'Token exchange failed' });
    }

    const tokens = await response.json() as any;

    auditLog('OAUTH_GOOGLE_TOKEN', { userId: req.user!.userId, ip: req.ip });

    res.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });

  } catch (error) {
    logger.error('Google token error', { error });
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

/**
 * POST /api/v1/oauth/google/refresh
 * Refresh Google access token
 */
oauthRouter.post('/google/refresh', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = refreshTokenSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const { refreshToken } = result.data;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(503).json({ error: 'Google OAuth not configured' });
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Token refresh failed' });
    }

    const tokens = await response.json() as any;

    res.json({
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
    });

  } catch (error) {
    logger.error('Google refresh error', { error });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});
