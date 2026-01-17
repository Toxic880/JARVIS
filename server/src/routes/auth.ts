/**
 * Authentication Routes
 * 
 * POST /api/v1/auth/setup    - Initial admin setup (first run only)
 * POST /api/v1/auth/login    - Login with username/password
 * POST /api/v1/auth/refresh  - Refresh access token
 * POST /api/v1/auth/logout   - Invalidate refresh token
 * GET  /api/v1/auth/me       - Get current user info
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';
import {
  AuthenticatedRequest,
  requireAuth,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../middleware/auth';

export const authRouter = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const setupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * Initial Setup - Create admin user (first run only)
 */
authRouter.post('/setup', async (req, res) => {
  try {
    const db = getDatabase();
    
    // Check if any users exist
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    
    if (userCount.count > 0) {
      return res.status(400).json({ error: 'Setup already completed. Use login instead.' });
    }

    // Validate input
    const result = setupSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid input', details: result.error.issues });
    }

    const { username, password } = result.data;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user
    const userId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run(userId, username, passwordHash);

    auditLog('ADMIN_SETUP', { userId, username, ip: req.ip });
    logger.info('Admin user created', { userId, username });

    // Generate tokens
    const accessToken = generateAccessToken({ userId, username, role: 'admin' });
    const refreshToken = generateRefreshToken({ userId, username, role: 'admin' });

    // Store refresh token hash
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    db.prepare(`
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, refreshTokenHash, expiresAt, req.ip, req.get('user-agent'));

    res.status(201).json({
      message: 'Admin account created',
      user: { id: userId, username, role: 'admin' },
      accessToken,
      refreshToken,
    });

  } catch (error) {
    logger.error('Setup failed', { error });
    res.status(500).json({ error: 'Setup failed' });
  }
});

/**
 * Check if setup is required
 */
authRouter.get('/status', (req, res) => {
  try {
    const db = getDatabase();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    
    res.json({
      setupRequired: userCount.count === 0,
      serverVersion: '1.0.0',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/**
 * Login
 */
authRouter.post('/login', async (req, res) => {
  try {
    const db = getDatabase();

    // Validate input
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { username, password } = result.data;

    // Find user
    const user = db.prepare(`
      SELECT id, username, password_hash, role, is_active
      FROM users WHERE username = ?
    `).get(username) as { id: string; username: string; password_hash: string; role: string; is_active: number } | undefined;

    if (!user) {
      auditLog('LOGIN_FAILED', { username, reason: 'user_not_found', ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      auditLog('LOGIN_FAILED', { username, reason: 'account_disabled', ip: req.ip });
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      auditLog('LOGIN_FAILED', { username, reason: 'invalid_password', ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
      role: user.role as 'admin' | 'user',
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      username: user.username,
      role: user.role as 'admin' | 'user',
    });

    // Store refresh token hash
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    db.prepare(`
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, user.id, refreshTokenHash, expiresAt, req.ip, req.get('user-agent'));

    // Update last login
    db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);

    auditLog('LOGIN_SUCCESS', { userId: user.id, username, ip: req.ip });

    res.json({
      user: { id: user.id, username: user.username, role: user.role },
      accessToken,
      refreshToken,
    });

  } catch (error) {
    logger.error('Login failed', { error });
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Refresh token
 */
authRouter.post('/refresh', async (req, res) => {
  try {
    const db = getDatabase();

    const result = refreshSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const { refreshToken } = result.data;

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Find matching session (we need to check all sessions for this user)
    const sessions = db.prepare(`
      SELECT id, refresh_token_hash FROM sessions
      WHERE user_id = ? AND expires_at > datetime('now')
    `).all(payload.userId) as { id: string; refresh_token_hash: string }[];

    let validSession: { id: string; refresh_token_hash: string } | null = null;
    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.refresh_token_hash)) {
        validSession = session;
        break;
      }
    }

    if (!validSession) {
      auditLog('REFRESH_FAILED', { userId: payload.userId, reason: 'no_valid_session', ip: req.ip });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Get current user info
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.userId) as {
      id: string;
      username: string;
      role: string;
    } | undefined;

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
      role: user.role as 'admin' | 'user',
    });

    res.json({
      accessToken: newAccessToken,
    });

  } catch (error) {
    logger.error('Token refresh failed', { error });
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * Logout - Invalidate refresh token
 */
authRouter.post('/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();

    // Delete all sessions for this user (or just the current one if you prefer)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user!.userId);

    auditLog('LOGOUT', { userId: req.user!.userId, ip: req.ip });

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    logger.error('Logout failed', { error });
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * Get current user info
 */
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const db = getDatabase();
  
  const user = db.prepare(`
    SELECT id, username, role, created_at, last_login
    FROM users WHERE id = ?
  `).get(req.user!.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
});
