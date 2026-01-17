/**
 * SMS Executor - Send and receive text messages via Twilio
 * 
 * Capabilities:
 * - Send SMS messages
 * - Send to contacts by name (requires contacts list)
 * - Check message status
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// CONTACTS MANAGEMENT
// =============================================================================

interface Contact {
  name: string;
  phone: string;
  relationship?: string;
}

function getContacts(userId: string): Contact[] {
  const db = getDatabase();
  
  // Ensure contacts table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      relationship TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, phone)
    )
  `);
  
  const rows = db.prepare('SELECT name, phone, relationship FROM contacts WHERE user_id = ?').all(userId) as any[];
  return rows || [];
}

function findContactByName(userId: string, name: string): Contact | null {
  const contacts = getContacts(userId);
  const normalizedName = name.toLowerCase().trim();
  
  // Exact match first
  let contact = contacts.find(c => c.name.toLowerCase() === normalizedName);
  if (contact) return contact;
  
  // Partial match
  contact = contacts.find(c => c.name.toLowerCase().includes(normalizedName));
  if (contact) return contact;
  
  // Relationship match (e.g., "mom", "dad")
  contact = contacts.find(c => c.relationship?.toLowerCase() === normalizedName);
  return contact || null;
}

function addContact(userId: string, contact: Contact): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO contacts (user_id, name, phone, relationship)
    VALUES (?, ?, ?, ?)
  `).run(userId, contact.name, contact.phone, contact.relationship || null);
}

// =============================================================================
// TWILIO API
// =============================================================================

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  
  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }
  
  return { accountSid, authToken, fromNumber };
}

async function sendSMS(to: string, body: string): Promise<any> {
  const config = getTwilioConfig();
  
  if (!config) {
    throw new Error('SMS not configured. Please add Twilio credentials in Settings.');
  }
  
  // Normalize phone number
  let normalizedTo = to.replace(/[^\d+]/g, '');
  if (!normalizedTo.startsWith('+')) {
    // Assume US number if no country code
    if (normalizedTo.length === 10) {
      normalizedTo = '+1' + normalizedTo;
    } else if (normalizedTo.length === 11 && normalizedTo.startsWith('1')) {
      normalizedTo = '+' + normalizedTo;
    }
  }
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: normalizedTo,
      From: config.fromNumber,
      Body: body,
    }),
  });
  
  const data = await response.json() as any;
  
  if (!response.ok) {
    throw new Error(data.message || `Twilio error: ${response.status}`);
  }
  
  return data;
}

async function getMessageStatus(messageSid: string): Promise<any> {
  const config = getTwilioConfig();
  
  if (!config) {
    throw new Error('SMS not configured');
  }
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages/${messageSid}.json`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get message status: ${response.status}`);
  }
  
  return response.json();
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class SMSExecutor implements IToolExecutor {
  id = 'sms';
  name = 'SMS Messaging';
  category = 'communication';
  description = 'Send text messages via SMS';
  
  private userId: string = 'default';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'sendMessage',
        description: 'Send an SMS text message to a phone number or contact name',
        schema: z.object({
          to: z.string().describe('Phone number or contact name (e.g., "+1234567890" or "mom")'),
          message: z.string().min(1).max(1600).describe('Message text'),
        }),
        riskLevel: 'high',
        reversible: false,
        externalImpact: true,
        blastRadius: 'external',
        requiredPermissions: ['sms.send'],
        supportsSimulation: true,
      },
      {
        name: 'addContact',
        description: 'Add a contact for easy messaging',
        schema: z.object({
          name: z.string().describe('Contact name'),
          phone: z.string().describe('Phone number'),
          relationship: z.string().optional().describe('Relationship (e.g., "mom", "boss")'),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'listContacts',
        description: 'List saved contacts',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'getMessageStatus',
        description: 'Check the delivery status of a sent message',
        schema: z.object({
          messageId: z.string().describe('Message SID from Twilio'),
        }),
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
      let output: any;
      let message: string;
      const sideEffects: any[] = [];

      switch (toolName) {
        case 'sendMessage': {
          const { to, message: msgBody } = params;
          
          // Check if 'to' is a contact name
          let phoneNumber = to;
          let recipientName = to;
          
          // If doesn't look like a phone number, try to find contact
          if (!/^[\d+\-() ]+$/.test(to)) {
            const contact = findContactByName(this.userId, to);
            if (contact) {
              phoneNumber = contact.phone;
              recipientName = contact.name;
            } else {
              throw new Error(`Contact "${to}" not found. Add them first with addContact or use a phone number.`);
            }
          }
          
          const result = await sendSMS(phoneNumber, msgBody);
          
          output = {
            sent: true,
            messageId: result.sid,
            to: phoneNumber,
            recipientName,
            status: result.status,
          };
          
          message = `Message sent to ${recipientName}`;
          
          sideEffects.push(createSideEffect(
            'message_sent',
            phoneNumber,
            `Sent SMS to ${recipientName}: "${msgBody.substring(0, 50)}${msgBody.length > 50 ? '...' : ''}"`,
            { reversible: false, severity: 'major' }
          ));
          
          auditLog('SMS_SENT', { 
            to: phoneNumber, 
            recipientName,
            messageId: result.sid,
            bodyLength: msgBody.length,
          });
          break;
        }

        case 'addContact': {
          const { name, phone, relationship } = params;
          
          addContact(this.userId, { name, phone, relationship });
          
          output = { added: true, name, phone, relationship };
          message = `Added contact: ${name} (${phone})${relationship ? ` - ${relationship}` : ''}`;
          
          sideEffects.push(createSideEffect(
            'data_created',
            'contacts',
            `Added contact: ${name}`,
            { reversible: true }
          ));
          break;
        }

        case 'listContacts': {
          const contacts = getContacts(this.userId);
          
          output = { contacts, count: contacts.length };
          
          if (contacts.length === 0) {
            message = 'No contacts saved. Add contacts with "add contact"';
          } else {
            message = `You have ${contacts.length} contact(s):\n` + 
              contacts.map(c => `• ${c.name}${c.relationship ? ` (${c.relationship})` : ''}: ${c.phone}`).join('\n');
          }
          break;
        }

        case 'getMessageStatus': {
          const { messageId } = params;
          
          const status = await getMessageStatus(messageId);
          
          output = {
            messageId,
            status: status.status,
            to: status.to,
            dateSent: status.date_sent,
            errorCode: status.error_code,
            errorMessage: status.error_message,
          };
          
          const statusMap: Record<string, string> = {
            'queued': 'Message is queued for delivery',
            'sending': 'Message is being sent',
            'sent': 'Message was sent successfully',
            'delivered': 'Message was delivered',
            'undelivered': 'Message could not be delivered',
            'failed': 'Message failed to send',
          };
          
          message = statusMap[status.status] || `Status: ${status.status}`;
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
      logger.error('SMS execution failed', { toolName, error: error.message });
      
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects: [],
        error: {
          code: 'SMS_ERROR',
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
    if (toolName === 'sendMessage') {
      // Check if contact exists
      let recipientName = params.to;
      if (!/^[\d+\-() ]+$/.test(params.to)) {
        const contact = findContactByName(this.userId, params.to);
        if (contact) {
          recipientName = `${contact.name} (${contact.phone})`;
        } else {
          return {
            wouldSucceed: false,
            predictedOutput: null,
            predictedSideEffects: [],
            warnings: [`Contact "${params.to}" not found`],
          };
        }
      }
      
      return {
        wouldSucceed: true,
        predictedOutput: { simulated: true, to: recipientName },
        predictedSideEffects: [{
          type: 'message_sent' as const,
          target: recipientName,
          description: `Would send SMS: "${params.message.substring(0, 30)}..."`,
          reversible: false,
        }],
        warnings: ['This will send a real SMS that cannot be unsent', 'Standard messaging rates may apply'],
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

export const smsExecutor = new SMSExecutor();
