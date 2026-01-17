/**
 * Gmail Executor - Full email management via Gmail API
 * 
 * Capabilities:
 * - Read recent/unread emails
 * - Search emails
 * - Send emails
 * - Reply to emails
 * - Get email details
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// GMAIL API HELPERS
// =============================================================================

interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function getTokens(userId: string): Promise<GmailTokens | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = ? AND provider = ?'
  ).get(userId, 'google') as any;
  
  if (!row) return null;
  
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

async function refreshTokenIfNeeded(userId: string): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) return null;
  
  // Check if token is still valid (with 5 min buffer)
  if (Date.now() < tokens.expiresAt - 300000) {
    return tokens.accessToken;
  }
  
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    logger.error('Google credentials not configured');
    return null;
  }
  
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    
    if (!response.ok) {
      logger.error('Failed to refresh Google token');
      return null;
    }
    
    const data = await response.json() as any;
    
    // Update tokens in database
    const db = getDatabase();
    db.prepare(`
      UPDATE oauth_tokens 
      SET access_token = ?, expires_at = ?
      WHERE user_id = ? AND provider = ?
    `).run(
      data.access_token,
      Date.now() + (data.expires_in * 1000),
      userId,
      'google'
    );
    
    return data.access_token;
  } catch (error) {
    logger.error('Error refreshing Google token', { error: String(error) });
    return null;
  }
}

async function gmailApi(
  userId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const token = await refreshTokenIfNeeded(userId);
  
  if (!token) {
    throw new Error('Gmail not connected. Please link your Google account in Settings.');
  }
  
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as any;
    throw new Error(errorData.error?.message || `Gmail API error: ${response.status}`);
  }
  
  return response.json();
}

// =============================================================================
// EMAIL PARSING HELPERS
// =============================================================================

function decodeBase64Url(data: string): string {
  // Replace URL-safe characters and decode
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return data;
  }
}

function getHeader(headers: any[], name: string): string {
  const header = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function parseEmail(message: any): any {
  const headers = message.payload?.headers || [];
  
  // Get body - handle different structures
  let body = '';
  const payload = message.payload;
  
  if (payload?.body?.data) {
    body = decodeBase64Url(payload.body.data);
  } else if (payload?.parts) {
    // Multipart message - find text/plain or text/html
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    
    if (textPart?.body?.data) {
      body = decodeBase64Url(textPart.body.data);
    } else if (htmlPart?.body?.data) {
      // Strip HTML tags for plain text
      body = decodeBase64Url(htmlPart.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  
  // Truncate body for display
  const maxBodyLength = 500;
  const truncatedBody = body.length > maxBodyLength 
    ? body.substring(0, maxBodyLength) + '...' 
    : body;
  
  return {
    id: message.id,
    threadId: message.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    snippet: message.snippet,
    body: truncatedBody,
    isUnread: message.labelIds?.includes('UNREAD'),
    labels: message.labelIds || [],
  };
}

function createEmailBody(to: string, subject: string, body: string, inReplyTo?: string): string {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
  ];
  
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }
  
  const email = headers.join('\r\n') + '\r\n\r\n' + body;
  
  // Encode as base64url
  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class GmailExecutor implements IToolExecutor {
  id = 'gmail';
  name = 'Gmail';
  category = 'communication';
  description = 'Read and send emails via Gmail';
  
  private userId: string = 'default';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'getRecentEmails',
        description: 'Get recent emails from inbox',
        schema: z.object({
          count: z.number().min(1).max(20).optional().default(5),
          unreadOnly: z.boolean().optional().default(false),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['gmail.read'],
        supportsSimulation: false,
      },
      {
        name: 'searchEmails',
        description: 'Search emails with a query',
        schema: z.object({
          query: z.string().describe('Search query (supports Gmail search syntax)'),
          count: z.number().min(1).max(20).optional().default(10),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['gmail.read'],
        supportsSimulation: false,
      },
      {
        name: 'getEmailDetails',
        description: 'Get full details of a specific email',
        schema: z.object({
          emailId: z.string().describe('Email ID'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['gmail.read'],
        supportsSimulation: false,
      },
      {
        name: 'sendEmail',
        description: 'Send a new email',
        schema: z.object({
          to: z.string().email().describe('Recipient email address'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body text'),
        }),
        riskLevel: 'high',
        reversible: false,
        externalImpact: true,
        blastRadius: 'external',
        requiredPermissions: ['gmail.send'],
        supportsSimulation: true,
      },
      {
        name: 'replyToEmail',
        description: 'Reply to an existing email',
        schema: z.object({
          emailId: z.string().describe('Email ID to reply to'),
          body: z.string().describe('Reply body text'),
        }),
        riskLevel: 'high',
        reversible: false,
        externalImpact: true,
        blastRadius: 'external',
        requiredPermissions: ['gmail.send'],
        supportsSimulation: true,
      },
      {
        name: 'markAsRead',
        description: 'Mark an email as read',
        schema: z.object({
          emailId: z.string().describe('Email ID'),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['gmail.modify'],
        supportsSimulation: true,
      },
      {
        name: 'archiveEmail',
        description: 'Archive an email (remove from inbox)',
        schema: z.object({
          emailId: z.string().describe('Email ID'),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['gmail.modify'],
        supportsSimulation: true,
      },
    ];
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    
    try {
      let output: any;
      let message: string;
      const sideEffects: any[] = [];

      switch (toolName) {
        case 'getRecentEmails': {
          const { count, unreadOnly } = params;
          const query = unreadOnly ? 'is:unread' : '';
          
          const listResult = await gmailApi(
            this.userId,
            `/users/me/messages?maxResults=${count}${query ? `&q=${encodeURIComponent(query)}` : ''}`
          );
          
          if (!listResult.messages?.length) {
            output = { emails: [], count: 0 };
            message = unreadOnly ? 'No unread emails' : 'No recent emails';
            break;
          }
          
          // Fetch details for each message
          const emails = await Promise.all(
            listResult.messages.slice(0, count).map(async (msg: any) => {
              const detail = await gmailApi(this.userId, `/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
              return parseEmail(detail);
            })
          );
          
          output = { emails, count: emails.length };
          
          if (unreadOnly) {
            message = emails.length === 1 
              ? `You have 1 unread email from ${emails[0].from}`
              : `You have ${emails.length} unread emails`;
          } else {
            message = `Here are your ${emails.length} most recent emails`;
          }
          
          // Add summary
          if (emails.length > 0 && emails.length <= 5) {
            message += ':\n' + emails.map((e: any, i: number) => 
              `${i + 1}. From: ${e.from.split('<')[0].trim()} - "${e.subject}"`
            ).join('\n');
          }
          break;
        }

        case 'searchEmails': {
          const { query, count } = params;
          
          const listResult = await gmailApi(
            this.userId,
            `/users/me/messages?maxResults=${count}&q=${encodeURIComponent(query)}`
          );
          
          if (!listResult.messages?.length) {
            output = { emails: [], count: 0, query };
            message = `No emails found matching "${query}"`;
            break;
          }
          
          const emails = await Promise.all(
            listResult.messages.map(async (msg: any) => {
              const detail = await gmailApi(this.userId, `/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
              return parseEmail(detail);
            })
          );
          
          output = { emails, count: emails.length, query };
          message = `Found ${emails.length} email(s) matching "${query}"`;
          break;
        }

        case 'getEmailDetails': {
          const { emailId } = params;
          
          const detail = await gmailApi(this.userId, `/users/me/messages/${emailId}?format=full`);
          const email = parseEmail(detail);
          
          output = { email };
          message = `Email from ${email.from}:\nSubject: ${email.subject}\n\n${email.body}`;
          break;
        }

        case 'sendEmail': {
          const { to, subject, body } = params;
          
          const raw = createEmailBody(to, subject, body);
          
          const result = await gmailApi(this.userId, '/users/me/messages/send', {
            method: 'POST',
            body: JSON.stringify({ raw }),
          });
          
          output = { 
            sent: true, 
            messageId: result.id,
            to,
            subject,
          };
          message = `Email sent to ${to}`;
          
          sideEffects.push(createSideEffect(
            'message_sent',
            to,
            `Sent email: "${subject}"`,
            { reversible: false, severity: 'major' }
          ));
          
          auditLog('EMAIL_SENT', { to, subject, messageId: result.id });
          break;
        }

        case 'replyToEmail': {
          const { emailId, body } = params;
          
          // Get original email details
          const original = await gmailApi(this.userId, `/users/me/messages/${emailId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
          const originalEmail = parseEmail(original);
          
          const to = originalEmail.from;
          const subject = originalEmail.subject.startsWith('Re:') 
            ? originalEmail.subject 
            : `Re: ${originalEmail.subject}`;
          const messageId = getHeader(original.payload?.headers || [], 'Message-ID');
          
          const raw = createEmailBody(to, subject, body, messageId);
          
          const result = await gmailApi(this.userId, '/users/me/messages/send', {
            method: 'POST',
            body: JSON.stringify({ 
              raw,
              threadId: original.threadId,
            }),
          });
          
          output = {
            sent: true,
            messageId: result.id,
            inReplyTo: emailId,
            to,
          };
          message = `Reply sent to ${to}`;
          
          sideEffects.push(createSideEffect(
            'message_sent',
            to,
            `Replied to: "${originalEmail.subject}"`,
            { reversible: false, severity: 'major' }
          ));
          break;
        }

        case 'markAsRead': {
          const { emailId } = params;
          
          await gmailApi(this.userId, `/users/me/messages/${emailId}/modify`, {
            method: 'POST',
            body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
          });
          
          output = { marked: true, emailId };
          message = 'Email marked as read';
          
          sideEffects.push(createSideEffect(
            'data_modified',
            'gmail',
            'Marked email as read',
            { reversible: true }
          ));
          break;
        }

        case 'archiveEmail': {
          const { emailId } = params;
          
          await gmailApi(this.userId, `/users/me/messages/${emailId}/modify`, {
            method: 'POST',
            body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
          });
          
          output = { archived: true, emailId };
          message = 'Email archived';
          
          sideEffects.push(createSideEffect(
            'data_modified',
            'gmail',
            'Archived email',
            { reversible: true }
          ));
          break;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return {
        success: true,
        output,
        message,
        sideEffects,
        meta: {
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };

    } catch (error: any) {
      logger.error('Gmail execution failed', { toolName, error: error.message });
      
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects: [],
        error: {
          code: 'GMAIL_ERROR',
          message: error.message,
          recoverable: true,
        },
        meta: {
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };
    }
  }

  async simulate(toolName: string, params: Record<string, any>) {
    if (toolName === 'sendEmail' || toolName === 'replyToEmail') {
      return {
        wouldSucceed: true,
        predictedOutput: { simulated: true, to: params.to },
        predictedSideEffects: [{
          type: 'message_sent' as const,
          target: params.to || 'recipient',
          description: `Would send email${params.subject ? `: "${params.subject}"` : ''}`,
          reversible: false,
        }],
        warnings: ['This will send a real email that cannot be unsent'],
      };
    }
    
    return {
      wouldSucceed: true,
      predictedOutput: { simulated: true },
      predictedSideEffects: [],
      warnings: [],
    };
  }

  validate(toolName: string, params: Record<string, any>) {
    const capability = this.getCapabilities().find(c => c.name === toolName);
    if (!capability) {
      return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    }
    
    const result = capability.schema.safeParse(params);
    if (!result.success) {
      return { 
        valid: false, 
        errors: result.error.issues.map(i => i.message),
      };
    }
    
    return { valid: true, sanitizedParams: result.data };
  }

  canExecute(toolName: string): boolean {
    return this.getCapabilities().some(c => c.name === toolName);
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }
}

export const gmailExecutor = new GmailExecutor();
