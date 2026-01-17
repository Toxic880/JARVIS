/**
 * JARVIS Server - Secure Backend
 * 
 * This server handles:
 * - Authentication (JWT)
 * - LLM proxy (sanitizes requests, holds no client-side keys)
 * - TTS proxy (ElevenLabs API key server-side)
 * - Memory persistence (SQLite)
 * - Tool execution guards (allowlist, validation, logging)
 * - Home Assistant proxy
 * - OAuth token exchange (Spotify, Google)
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';

import { logger } from './services/logger';
import { initDatabase } from './db/init';
import { authRouter } from './routes/auth';
import { llmRouter } from './routes/llm.v2';  // New structured pipeline
import { ttsRouter } from './routes/tts';
import { memoryRouter } from './routes/memory';
import { toolsRouter } from './routes/tools';
import { homeAssistantRouter } from './routes/homeAssistant';
import { oauthRouter } from './routes/oauth';
import { healthRouter } from './routes/health';
import { perceptionRouter } from './routes/perception';
import { orchestratorRouter } from './routes/orchestrator';
import { voiceRouter } from './routes/voice';
import { uiRouter } from './routes/ui';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });
  next();
});

// =============================================================================
// ROUTES
// =============================================================================

// Health check (no auth required)
app.use('/api/v1/health', healthRouter);

// Authentication
app.use('/api/v1/auth', authRouter);

// Protected routes
app.use('/api/v1/llm', llmRouter);
app.use('/api/v1/tts', ttsRouter);
app.use('/api/v1/memory', memoryRouter);
app.use('/api/v1/tools', toolsRouter);
app.use('/api/v1/home-assistant', homeAssistantRouter);
app.use('/api/v1/oauth', oauthRouter);
app.use('/api/v1/perception', perceptionRouter);
app.use('/api/v1/orchestrator', orchestratorRouter);
app.use('/api/v1/voice', voiceRouter);
app.use('/api/v1/ui', uiRouter);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(500).json({ error: message });
});

// =============================================================================
// STARTUP
// =============================================================================

async function start() {
  try {
    // Validate required environment variables
    const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    // Warn about default secrets
    if (process.env.JWT_SECRET === 'change-this-to-a-long-random-string-at-least-32-chars') {
      logger.warn('⚠️  WARNING: Using default JWT_SECRET - change this in production!');
    }

    // Initialize database
    await initDatabase();
    logger.info('Database initialized');

    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 JARVIS Server running on port ${PORT}`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   Pipeline: v2 (structured function calling)`);
      logger.info(`   LLM Backend: ${process.env.LLM_BASE_URL || 'not configured'}`);
      logger.info(`   Home Assistant: ${process.env.HOME_ASSISTANT_URL ? 'configured' : 'not configured'}`);
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

start();

export { app }; // For testing
