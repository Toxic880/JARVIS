/**
 * Tool Guard Service
 * 
 * Security layer for LLM tool execution:
 * - Allowlist of permitted tools
 * - JSON Schema validation for parameters
 * - Logging of all tool calls
 * - Confirmation requirement for destructive actions
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/init';
import { logger, auditLog } from './logger';

// =============================================================================
// TOOL DEFINITIONS WITH SCHEMAS
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'safe' | 'moderate' | 'dangerous';
  requiresConfirmation: boolean;
  schema: z.ZodType<any>;
}

// Define all allowed tools with their parameter schemas
export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // SAFE - No confirmation needed, read-only or local
  getTime: {
    name: 'getTime',
    description: 'Get current time',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      timezone: z.string().optional(),
    }),
  },
  getDate: {
    name: 'getDate',
    description: 'Get current date',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getWeather: {
    name: 'getWeather',
    description: 'Get weather conditions',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      location: z.string().optional(),
    }),
  },
  getTimers: {
    name: 'getTimers',
    description: 'Get active timers',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getAlarms: {
    name: 'getAlarms',
    description: 'Get alarms',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getReminders: {
    name: 'getReminders',
    description: 'Get reminders',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getList: {
    name: 'getList',
    description: 'Read a list',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      listName: z.string(),
    }),
  },
  getNote: {
    name: 'getNote',
    description: 'Read a note',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      title: z.string(),
    }),
  },
  getSchedule: {
    name: 'getSchedule',
    description: 'Get calendar events',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      when: z.enum(['today', 'tomorrow']).optional(),
    }),
  },
  getCurrentTrack: {
    name: 'getCurrentTrack',
    description: 'Get currently playing track',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getNews: {
    name: 'getNews',
    description: 'Get news headlines',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      category: z.string().optional(),
    }),
  },
  getStockPrice: {
    name: 'getStockPrice',
    description: 'Get stock price',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      symbol: z.string().max(10),
    }),
  },
  calculate: {
    name: 'calculate',
    description: 'Calculate math expression',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      expression: z.string().max(200),
    }),
  },
  recall: {
    name: 'recall',
    description: 'Recall from memory',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({
      query: z.string(),
    }),
  },
  getSystemStatus: {
    name: 'getSystemStatus',
    description: 'Get system status',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  getMode: {
    name: 'getMode',
    description: 'Get current mode',
    category: 'safe',
    requiresConfirmation: false,
    schema: z.object({}),
  },

  // MODERATE - Creates data, but reversible
  setTimer: {
    name: 'setTimer',
    description: 'Set a timer',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      duration: z.number().min(1).max(86400), // Max 24 hours
      label: z.string().max(100).optional(),
    }),
  },
  cancelTimer: {
    name: 'cancelTimer',
    description: 'Cancel a timer',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      label: z.string(),
    }),
  },
  setAlarm: {
    name: 'setAlarm',
    description: 'Set an alarm',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      time: z.string().regex(/^\d{1,2}:\d{2}$/),
      label: z.string().max(100).optional(),
      recurring: z.boolean().optional(),
      days: z.array(z.string()).optional(),
    }),
  },
  setReminder: {
    name: 'setReminder',
    description: 'Set a reminder',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      message: z.string().max(500),
      time: z.string(),
    }),
  },
  addToList: {
    name: 'addToList',
    description: 'Add to list',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      listName: z.string().max(100),
      item: z.string().max(500),
    }),
  },
  removeFromList: {
    name: 'removeFromList',
    description: 'Remove from list',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      listName: z.string(),
      item: z.string(),
    }),
  },
  createNote: {
    name: 'createNote',
    description: 'Create a note',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      title: z.string().max(200),
      content: z.string().max(10000),
    }),
  },
  remember: {
    name: 'remember',
    description: 'Remember information',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      information: z.string().max(1000),
    }),
  },
  playMusic: {
    name: 'playMusic',
    description: 'Play music',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      query: z.string().max(200),
    }),
  },
  pauseMusic: {
    name: 'pauseMusic',
    description: 'Pause music',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  resumeMusic: {
    name: 'resumeMusic',
    description: 'Resume music',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({}),
  },
  setVolume: {
    name: 'setVolume',
    description: 'Set volume',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      volume: z.number().min(0).max(100),
    }),
  },
  setMode: {
    name: 'setMode',
    description: 'Set JARVIS mode',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      mode: z.enum(['normal', 'dnd', 'sleep', 'guest', 'party', 'away', 'focus']),
    }),
  },
  announce: {
    name: 'announce',
    description: 'Make announcement',
    category: 'moderate',
    requiresConfirmation: false,
    schema: z.object({
      message: z.string().max(500),
      rooms: z.array(z.string()).optional(),
    }),
  },

  // DANGEROUS - Controls physical devices, sends messages, irreversible
  controlDevice: {
    name: 'controlDevice',
    description: 'Control smart home device',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      device: z.string().max(100),
      action: z.enum(['turn_on', 'turn_off', 'lock', 'unlock', 'set', 'toggle']),
      value: z.number().optional(),
    }),
  },
  sendEmail: {
    name: 'sendEmail',
    description: 'Send an email',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      to: z.string().email(),
      subject: z.string().max(200),
      body: z.string().max(10000),
    }),
  },
  sendSMS: {
    name: 'sendSMS',
    description: 'Send SMS message',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      to: z.string().regex(/^\+?[1-9]\d{1,14}$/),
      message: z.string().max(1600),
    }),
  },
  createEvent: {
    name: 'createEvent',
    description: 'Create calendar event',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      title: z.string().max(200),
      time: z.string(),
      duration: z.number().min(1).max(1440).optional(),
      description: z.string().max(2000).optional(),
    }),
  },
  deleteEvent: {
    name: 'deleteEvent',
    description: 'Delete calendar event',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      eventId: z.string(),
    }),
  },
  forget: {
    name: 'forget',
    description: 'Delete from memory',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      query: z.string(),
    }),
  },
  clearList: {
    name: 'clearList',
    description: 'Clear entire list',
    category: 'dangerous',
    requiresConfirmation: true,
    schema: z.object({
      listName: z.string(),
    }),
  },
};

// =============================================================================
// TOOL GUARD CLASS
// =============================================================================

export class ToolGuard {
  /**
   * Validate a tool call
   */
  static validate(toolName: string, parameters: any): { 
    valid: boolean; 
    error?: string;
    requiresConfirmation?: boolean;
    category?: string;
  } {
    const definition = TOOL_DEFINITIONS[toolName];

    if (!definition) {
      return { 
        valid: false, 
        error: `Tool '${toolName}' is not in the allowlist` 
      };
    }

    // Validate parameters against schema
    const result = definition.schema.safeParse(parameters);
    if (!result.success) {
      return {
        valid: false,
        error: `Invalid parameters: ${result.error.issues.map(i => i.message).join(', ')}`,
      };
    }

    return {
      valid: true,
      requiresConfirmation: definition.requiresConfirmation,
      category: definition.category,
    };
  }

  /**
   * Validate a tool call (alias for use by execution pipeline)
   */
  validateToolCall(toolName: string, parameters: any): { 
    valid: boolean; 
    error?: string;
  } {
    return ToolGuard.validate(toolName, parameters);
  }

  /**
   * Log a tool execution
   */
  static logExecution(
    userId: string | null,
    toolName: string,
    parameters: any,
    result: any,
    status: 'success' | 'error' | 'rejected' | 'pending_confirmation',
    executionTimeMs: number,
    ipAddress?: string
  ): string {
    const db = getDatabase();
    const logId = uuidv4();

    db.prepare(`
      INSERT INTO tool_logs (id, user_id, tool_name, parameters, result, status, execution_time_ms, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      userId,
      toolName,
      JSON.stringify(parameters),
      JSON.stringify(result),
      status,
      executionTimeMs,
      ipAddress
    );

    // Also log to audit log for dangerous tools
    const definition = TOOL_DEFINITIONS[toolName];
    if (definition?.category === 'dangerous') {
      auditLog('DANGEROUS_TOOL_EXECUTION', {
        logId,
        userId,
        toolName,
        parameters,
        status,
        ipAddress,
      });
    }

    return logId;
  }

  /**
   * Get tool execution history
   */
  static getHistory(options: {
    userId?: string;
    toolName?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): any[] {
    const db = getDatabase();
    
    let query = 'SELECT * FROM tool_logs WHERE 1=1';
    const params: any[] = [];

    if (options.userId) {
      query += ' AND user_id = ?';
      params.push(options.userId);
    }
    if (options.toolName) {
      query += ' AND tool_name = ?';
      params.push(options.toolName);
    }
    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(options.limit || 100, options.offset || 0);

    return db.prepare(query).all(...params);
  }

  /**
   * Get all tool definitions (for client)
   */
  static getDefinitions(): { name: string; description: string; category: string; requiresConfirmation: boolean }[] {
    return Object.values(TOOL_DEFINITIONS).map(d => ({
      name: d.name,
      description: d.description,
      category: d.category,
      requiresConfirmation: d.requiresConfirmation,
    }));
  }

  /**
   * Check if a tool requires confirmation
   */
  static requiresConfirmation(toolName: string): boolean {
    return TOOL_DEFINITIONS[toolName]?.requiresConfirmation ?? true;
  }
}

// =============================================================================
// PENDING CONFIRMATIONS
// =============================================================================

interface PendingConfirmation {
  id: string;
  userId: string;
  toolName: string;
  parameters: any;
  createdAt: Date;
  expiresAt: Date;
}

// In-memory store for pending confirmations (short-lived)
const pendingConfirmations = new Map<string, PendingConfirmation>();

export const ConfirmationManager = {
  /**
   * Create a pending confirmation
   */
  create(userId: string, toolName: string, parameters: any): string {
    const id = uuidv4();
    const now = new Date();
    
    pendingConfirmations.set(id, {
      id,
      userId,
      toolName,
      parameters,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000), // 5 minute expiry
    });

    // Clean up expired confirmations
    for (const [key, conf] of pendingConfirmations.entries()) {
      if (conf.expiresAt < now) {
        pendingConfirmations.delete(key);
      }
    }

    return id;
  },

  /**
   * Get and consume a pending confirmation
   */
  consume(id: string, userId: string): PendingConfirmation | null {
    const confirmation = pendingConfirmations.get(id);
    
    if (!confirmation) return null;
    if (confirmation.userId !== userId) return null;
    if (confirmation.expiresAt < new Date()) {
      pendingConfirmations.delete(id);
      return null;
    }

    pendingConfirmations.delete(id);
    return confirmation;
  },

  /**
   * Get pending confirmations for a user
   */
  getPending(userId: string): PendingConfirmation[] {
    const now = new Date();
    const result: PendingConfirmation[] = [];
    
    for (const conf of pendingConfirmations.values()) {
      if (conf.userId === userId && conf.expiresAt > now) {
        result.push(conf);
      }
    }
    
    return result;
  },
};

// Singleton instance
export const toolGuard = new ToolGuard();
