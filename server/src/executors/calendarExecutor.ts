/**
 * Calendar Executor - Google Calendar integration
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { getDatabase } from '../db/init';
import { logger } from '../services/logger';

async function getToken(userId: string): Promise<string | null> {
  const db = getDatabase();
  const row = db.prepare('SELECT access_token FROM oauth_tokens WHERE user_id = ? AND provider = ?').get(userId, 'google') as any;
  return row?.access_token || null;
}

async function calendarApi(userId: string, endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = await getToken(userId);
  if (!token) throw new Error('Google Calendar not connected');
  const response = await fetch(`https://www.googleapis.com/calendar/v3${endpoint}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`Calendar API error: ${response.status}`);
  return response.json();
}

export class CalendarExecutor implements IToolExecutor {
  id = 'calendar';
  name = 'Google Calendar';
  category = 'productivity';
  description = 'Manage Google Calendar';
  private userId: string = 'default';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'getTodayEvents',
        description: 'Get today\'s events',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'getUpcomingEvents',
        description: 'Get upcoming events',
        schema: z.object({ days: z.number().min(1).max(30).optional().default(7) }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'createEvent',
        description: 'Create calendar event',
        schema: z.object({
          title: z.string(),
          date: z.string(),
          time: z.string().optional(),
          duration: z.number().optional().default(60),
        }),
        riskLevel: 'medium',
        reversible: true,
        externalImpact: true,
        blastRadius: 'external',
        requiredPermissions: [],
        supportsSimulation: true,
      },
    ];
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    try {
      let output: any, message: string;
      const sideEffects: any[] = [];

      switch (toolName) {
        case 'getTodayEvents': {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
          const result = await calendarApi(this.userId, `/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime`);
          const events = result.items?.map((e: any) => ({ title: e.summary, time: e.start?.dateTime || e.start?.date })) || [];
          output = { events };
          message = events.length ? `${events.length} events today` : 'No events today';
          break;
        }
        case 'getUpcomingEvents': {
          const now = new Date();
          const end = new Date(now.getTime() + params.days * 24 * 60 * 60 * 1000).toISOString();
          const result = await calendarApi(this.userId, `/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end}&maxResults=10&singleEvents=true&orderBy=startTime`);
          const events = result.items?.map((e: any) => ({ title: e.summary, time: e.start?.dateTime || e.start?.date })) || [];
          output = { events };
          message = events.length ? `${events.length} upcoming events` : 'No upcoming events';
          break;
        }
        case 'createEvent': {
          const startDate = new Date(params.date);
          if (params.time) {
            const [h, m] = params.time.split(':').map(Number);
            startDate.setHours(h || 9, m || 0);
          }
          const endDate = new Date(startDate.getTime() + params.duration * 60000);
          const event = {
            summary: params.title,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() },
          };
          const result = await calendarApi(this.userId, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(event) });
          output = { eventId: result.id };
          message = `Created: ${params.title}`;
          sideEffects.push(createSideEffect('data_created', 'calendar', message, { reversible: true }));
          break;
        }
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return { success: true, output, message, sideEffects, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    } catch (error: any) {
      return { success: false, output: null, message: error.message, sideEffects: [], error: { code: 'CALENDAR_ERROR', message: error.message, recoverable: true }, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    }
  }

  async simulate(toolName: string, params: Record<string, any>) {
    return { wouldSucceed: true, predictedOutput: { simulated: true }, predictedSideEffects: [], warnings: [] };
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

export const calendarExecutor = new CalendarExecutor();
