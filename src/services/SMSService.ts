/**
 * SMS SERVICE - Twilio Integration
 * 
 * Send and receive SMS messages through Twilio.
 * 
 * SETUP:
 * 1. Create Twilio account at twilio.com
 * 2. Get Account SID and Auth Token
 * 3. Buy a phone number
 * 4. Add credentials to JARVIS settings
 * 
 * NOTE: Receiving SMS requires a webhook server.
 * For local use, you can use ngrok or store messages in Twilio's logs.
 */

export interface SMSMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: Date;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  direction: 'inbound' | 'outbound';
}

export interface Contact {
  name: string;
  phone: string;
  relationship?: string;
}

export class SMSService {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;
  private contacts: Map<string, Contact> = new Map();
  private messageHistory: SMSMessage[] = [];

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = this.formatPhoneNumber(fromNumber);
    this.loadContacts();
    this.loadMessageHistory();
  }

  private loadContacts() {
    const saved = localStorage.getItem('jarvis_sms_contacts');
    if (saved) {
      const contacts: Contact[] = JSON.parse(saved);
      contacts.forEach(c => this.contacts.set(c.name.toLowerCase(), c));
    }
  }

  private saveContacts() {
    const contacts = Array.from(this.contacts.values());
    localStorage.setItem('jarvis_sms_contacts', JSON.stringify(contacts));
  }

  private loadMessageHistory() {
    const saved = localStorage.getItem('jarvis_sms_history');
    if (saved) {
      this.messageHistory = JSON.parse(saved).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
  }

  private saveMessageHistory() {
    // Keep last 100 messages
    const toSave = this.messageHistory.slice(-100);
    localStorage.setItem('jarvis_sms_history', JSON.stringify(toSave));
  }

  /**
   * Format phone number to E.164 format
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // If it's a US number without country code, add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // If it already has country code
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    // Otherwise assume it's complete
    return `+${digits}`;
  }

  /**
   * Resolve contact name to phone number
   */
  private resolveContact(nameOrNumber: string): string | null {
    // Check if it's already a phone number
    if (/^\+?\d{10,}$/.test(nameOrNumber.replace(/\D/g, ''))) {
      return this.formatPhoneNumber(nameOrNumber);
    }

    // Look up in contacts
    const contact = this.contacts.get(nameOrNumber.toLowerCase());
    if (contact) {
      return this.formatPhoneNumber(contact.phone);
    }

    // Try partial match
    for (const [name, c] of this.contacts) {
      if (name.includes(nameOrNumber.toLowerCase())) {
        return this.formatPhoneNumber(c.phone);
      }
    }

    return null;
  }

  // ==========================================================================
  // CONTACTS MANAGEMENT
  // ==========================================================================

  /**
   * Add a contact
   */
  addContact(name: string, phone: string, relationship?: string): void {
    const contact: Contact = {
      name,
      phone: this.formatPhoneNumber(phone),
      relationship,
    };
    this.contacts.set(name.toLowerCase(), contact);
    this.saveContacts();
  }

  /**
   * Remove a contact
   */
  removeContact(name: string): boolean {
    const deleted = this.contacts.delete(name.toLowerCase());
    if (deleted) this.saveContacts();
    return deleted;
  }

  /**
   * Get all contacts
   */
  getContacts(): Contact[] {
    return Array.from(this.contacts.values());
  }

  /**
   * Get contact by name
   */
  getContact(name: string): Contact | undefined {
    return this.contacts.get(name.toLowerCase());
  }

  // ==========================================================================
  // SEND SMS
  // ==========================================================================

  /**
   * Send an SMS message
   */
  async sendSMS(to: string, body: string): Promise<SMSMessage> {
    const toNumber = this.resolveContact(to);
    
    if (!toNumber) {
      throw new Error(`Could not find contact or parse phone number: ${to}`);
    }

    // Twilio API endpoint
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    // Create form data
    const formData = new URLSearchParams();
    formData.append('From', this.fromNumber);
    formData.append('To', toNumber);
    formData.append('Body', body);

    // Base64 encode credentials
    const credentials = btoa(`${this.accountSid}:${this.authToken}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Twilio error: ${response.status}`);
      }

      const result = await response.json();

      const message: SMSMessage = {
        id: result.sid,
        from: this.fromNumber,
        to: toNumber,
        body,
        timestamp: new Date(),
        status: result.status,
        direction: 'outbound',
      };

      this.messageHistory.push(message);
      this.saveMessageHistory();

      return message;
    } catch (error) {
      console.error('[SMS] Failed to send:', error);
      throw error;
    }
  }

  /**
   * Send SMS to multiple recipients
   */
  async sendBulkSMS(recipients: string[], body: string): Promise<SMSMessage[]> {
    const results: SMSMessage[] = [];
    
    for (const recipient of recipients) {
      try {
        const msg = await this.sendSMS(recipient, body);
        results.push(msg);
      } catch (e) {
        console.error(`[SMS] Failed to send to ${recipient}:`, e);
      }
    }

    return results;
  }

  /**
   * Quick text to common contacts
   */
  async textContact(contactName: string, message: string): Promise<SMSMessage> {
    return this.sendSMS(contactName, message);
  }

  // ==========================================================================
  // MESSAGE HISTORY
  // ==========================================================================

  /**
   * Get message history
   */
  getMessageHistory(limit: number = 20): SMSMessage[] {
    return this.messageHistory.slice(-limit).reverse();
  }

  /**
   * Get conversation with a contact
   */
  getConversation(contactNameOrNumber: string, limit: number = 20): SMSMessage[] {
    const phone = this.resolveContact(contactNameOrNumber);
    if (!phone) return [];

    return this.messageHistory
      .filter(m => m.from === phone || m.to === phone)
      .slice(-limit);
  }

  /**
   * Add received message (called by webhook or polling)
   */
  addReceivedMessage(from: string, body: string, sid: string): SMSMessage {
    const message: SMSMessage = {
      id: sid,
      from: this.formatPhoneNumber(from),
      to: this.fromNumber,
      body,
      timestamp: new Date(),
      status: 'received',
      direction: 'inbound',
    };

    this.messageHistory.push(message);
    this.saveMessageHistory();

    return message;
  }

  /**
   * Fetch recent messages from Twilio (polling method)
   */
  async fetchRecentMessages(limit: number = 10): Promise<SMSMessage[]> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json?PageSize=${limit}`;
    const credentials = btoa(`${this.accountSid}:${this.authToken}`);

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch messages');

      const result = await response.json();
      
      return result.messages.map((m: any) => ({
        id: m.sid,
        from: m.from,
        to: m.to,
        body: m.body,
        timestamp: new Date(m.date_sent || m.date_created),
        status: m.status,
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
      }));
    } catch (error) {
      console.error('[SMS] Failed to fetch messages:', error);
      return [];
    }
  }

  // ==========================================================================
  // FORMATTING FOR SPEECH
  // ==========================================================================

  /**
   * Format message for JARVIS to speak
   */
  formatMessageForSpeech(message: SMSMessage): string {
    const contactName = this.getContactNameByPhone(message.from) || message.from;
    const timeAgo = this.getTimeAgo(message.timestamp);
    
    return `${message.direction === 'inbound' ? 'From' : 'To'} ${contactName}, ${timeAgo}: "${message.body}"`;
  }

  /**
   * Get contact name by phone number
   */
  private getContactNameByPhone(phone: string): string | null {
    const formatted = this.formatPhoneNumber(phone);
    for (const [name, contact] of this.contacts) {
      if (this.formatPhoneNumber(contact.phone) === formatted) {
        return contact.name;
      }
    }
    return null;
  }

  /**
   * Get human-readable time ago
   */
  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'yesterday';
    return `${diffDays} days ago`;
  }

  /**
   * Format confirmation for sent message
   */
  formatSendConfirmation(message: SMSMessage): string {
    const contactName = this.getContactNameByPhone(message.to) || message.to;
    return `Message sent to ${contactName}.`;
  }
}
