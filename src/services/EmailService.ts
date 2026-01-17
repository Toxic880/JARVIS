/**
 * EMAIL SERVICE - Gmail API Integration
 * 
 * Full email capabilities:
 * - Read inbox/unread
 * - Send emails
 * - Search emails
 * - Summarize emails
 * - Mark as read/unread
 * - Archive/delete
 * 
 * SETUP:
 * 1. Enable Gmail API in Google Cloud Console
 * 2. Add scopes to OAuth consent screen
 * 3. Use same Google OAuth credentials as Calendar
 */

const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1';

export interface Email {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  bodyHtml?: string;
  date: Date;
  isUnread: boolean;
  isStarred: boolean;
  labels: string[];
  hasAttachments: boolean;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  messageCount: number;
  snippet: string;
  lastDate: Date;
  isUnread: boolean;
}

export interface EmailSendOptions {
  to: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  inReplyTo?: string; // Message ID to reply to
}

export class EmailService {
  private accessToken: string | null = null;
  private userEmail: string | null = null;

  constructor() {
    this.loadToken();
  }

  private loadToken() {
    this.accessToken = localStorage.getItem('google_access_token');
  }

  public setAccessToken(token: string) {
    this.accessToken = token;
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // ==========================================================================
  // API HELPERS
  // ==========================================================================

  private async apiRequest(
    endpoint: string, 
    method: string = 'GET', 
    body?: any
  ): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Gmail');
    }

    const response = await fetch(`${GMAIL_API_URL}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  // ==========================================================================
  // READ EMAILS
  // ==========================================================================

  /**
   * Get user's email address
   */
  async getProfile(): Promise<{ email: string; messagesTotal: number; threadsTotal: number }> {
    const profile = await this.apiRequest('/users/me/profile');
    this.userEmail = profile.emailAddress;
    return {
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
      threadsTotal: profile.threadsTotal,
    };
  }

  /**
   * Get unread email count
   */
  async getUnreadCount(): Promise<number> {
    const result = await this.apiRequest(
      '/users/me/messages?q=is:unread&maxResults=1'
    );
    return result.resultSizeEstimate || 0;
  }

  /**
   * Get inbox emails
   */
  async getInbox(maxResults: number = 10, unreadOnly: boolean = false): Promise<Email[]> {
    const query = unreadOnly ? 'is:unread' : 'in:inbox';
    const result = await this.apiRequest(
      `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
    );

    if (!result.messages) return [];

    const emails: Email[] = [];
    for (const msg of result.messages.slice(0, maxResults)) {
      try {
        const email = await this.getMessage(msg.id);
        if (email) emails.push(email);
      } catch (e) {
        console.error('[Email] Failed to fetch message:', e);
      }
    }

    return emails;
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<Email | null> {
    try {
      const msg = await this.apiRequest(
        `/users/me/messages/${messageId}?format=full`
      );
      return this.parseMessage(msg);
    } catch (e) {
      console.error('[Email] Failed to get message:', e);
      return null;
    }
  }

  /**
   * Search emails
   */
  async searchEmails(query: string, maxResults: number = 10): Promise<Email[]> {
    const result = await this.apiRequest(
      `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
    );

    if (!result.messages) return [];

    const emails: Email[] = [];
    for (const msg of result.messages) {
      const email = await this.getMessage(msg.id);
      if (email) emails.push(email);
    }

    return emails;
  }

  /**
   * Get emails from a specific sender
   */
  async getEmailsFrom(sender: string, maxResults: number = 5): Promise<Email[]> {
    return this.searchEmails(`from:${sender}`, maxResults);
  }

  /**
   * Get recent important emails
   */
  async getImportantEmails(maxResults: number = 5): Promise<Email[]> {
    return this.searchEmails('is:important', maxResults);
  }

  /**
   * Get starred emails
   */
  async getStarredEmails(maxResults: number = 5): Promise<Email[]> {
    return this.searchEmails('is:starred', maxResults);
  }

  // ==========================================================================
  // SEND EMAILS
  // ==========================================================================

  /**
   * Send an email
   */
  async sendEmail(options: EmailSendOptions): Promise<{ id: string; threadId: string }> {
    const toList = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    
    // Build RFC 2822 formatted email
    const headers = [
      `To: ${toList}`,
      `Subject: ${options.subject}`,
      `Content-Type: ${options.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
    ];

    if (options.cc?.length) {
      headers.push(`Cc: ${options.cc.join(', ')}`);
    }
    if (options.bcc?.length) {
      headers.push(`Bcc: ${options.bcc.join(', ')}`);
    }
    if (options.inReplyTo) {
      headers.push(`In-Reply-To: ${options.inReplyTo}`);
      headers.push(`References: ${options.inReplyTo}`);
    }

    const email = `${headers.join('\r\n')}\r\n\r\n${options.body}`;
    
    // Base64 URL encode
    const encodedEmail = btoa(unescape(encodeURIComponent(email)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await this.apiRequest('/users/me/messages/send', 'POST', {
      raw: encodedEmail,
      threadId: options.inReplyTo ? undefined : undefined, // Gmail handles threading automatically
    });

    return { id: result.id, threadId: result.threadId };
  }

  /**
   * Reply to an email
   */
  async replyToEmail(
    originalEmail: Email, 
    body: string, 
    replyAll: boolean = false
  ): Promise<{ id: string; threadId: string }> {
    const to = replyAll 
      ? [originalEmail.from, ...originalEmail.to.split(',').map(s => s.trim())]
      : [originalEmail.from];

    return this.sendEmail({
      to: to.filter(e => e !== this.userEmail), // Don't send to self
      subject: originalEmail.subject.startsWith('Re:') 
        ? originalEmail.subject 
        : `Re: ${originalEmail.subject}`,
      body,
      inReplyTo: originalEmail.id,
    });
  }

  /**
   * Forward an email
   */
  async forwardEmail(
    originalEmail: Email, 
    to: string | string[], 
    additionalMessage?: string
  ): Promise<{ id: string; threadId: string }> {
    const forwardBody = [
      additionalMessage || '',
      '',
      '---------- Forwarded message ----------',
      `From: ${originalEmail.from}`,
      `Date: ${originalEmail.date.toLocaleString()}`,
      `Subject: ${originalEmail.subject}`,
      '',
      originalEmail.body,
    ].join('\n');

    return this.sendEmail({
      to,
      subject: `Fwd: ${originalEmail.subject}`,
      body: forwardBody,
    });
  }

  // ==========================================================================
  // EMAIL ACTIONS
  // ==========================================================================

  /**
   * Mark email as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/modify`, 'POST', {
      removeLabelIds: ['UNREAD'],
    });
  }

  /**
   * Mark email as unread
   */
  async markAsUnread(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/modify`, 'POST', {
      addLabelIds: ['UNREAD'],
    });
  }

  /**
   * Star an email
   */
  async starEmail(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/modify`, 'POST', {
      addLabelIds: ['STARRED'],
    });
  }

  /**
   * Unstar an email
   */
  async unstarEmail(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/modify`, 'POST', {
      removeLabelIds: ['STARRED'],
    });
  }

  /**
   * Archive an email (remove from inbox)
   */
  async archiveEmail(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/modify`, 'POST', {
      removeLabelIds: ['INBOX'],
    });
  }

  /**
   * Move to trash
   */
  async trashEmail(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}/trash`, 'POST');
  }

  /**
   * Delete permanently
   */
  async deleteEmail(messageId: string): Promise<void> {
    await this.apiRequest(`/users/me/messages/${messageId}`, 'DELETE');
  }

  // ==========================================================================
  // PARSING & FORMATTING
  // ==========================================================================

  /**
   * Parse raw Gmail message into Email object
   */
  private parseMessage(msg: any): Email {
    const headers = msg.payload.headers;
    const getHeader = (name: string): string => {
      const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    // Extract body
    let body = '';
    let bodyHtml = '';
    
    const extractBody = (part: any): void => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = this.decodeBase64(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = this.decodeBase64(part.body.data);
      } else if (part.parts) {
        part.parts.forEach(extractBody);
      }
    };

    extractBody(msg.payload);

    // If no plain text, extract from HTML
    if (!body && bodyHtml) {
      body = bodyHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // Parse from field
    const fromRaw = getHeader('From');
    const fromMatch = fromRaw.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
    const fromName = fromMatch?.[1] || fromMatch?.[2] || fromRaw;
    const from = fromMatch?.[2] || fromRaw;

    // Check for attachments
    const attachments: EmailAttachment[] = [];
    const findAttachments = (part: any): void => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        part.parts.forEach(findAttachments);
      }
    };
    findAttachments(msg.payload);

    return {
      id: msg.id,
      threadId: msg.threadId,
      from,
      fromName,
      to: getHeader('To'),
      subject: getHeader('Subject') || '(no subject)',
      snippet: msg.snippet || '',
      body,
      bodyHtml,
      date: new Date(parseInt(msg.internalDate)),
      isUnread: msg.labelIds?.includes('UNREAD') || false,
      isStarred: msg.labelIds?.includes('STARRED') || false,
      labels: msg.labelIds || [],
      hasAttachments: attachments.length > 0,
      attachments,
    };
  }

  /**
   * Decode base64 URL encoded string
   */
  private decodeBase64(data: string): string {
    try {
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(base64)));
    } catch (e) {
      return data;
    }
  }

  // ==========================================================================
  // FORMATTING FOR SPEECH
  // ==========================================================================

  /**
   * Format email summary for JARVIS to speak
   */
  formatEmailForSpeech(email: Email): string {
    const timeAgo = this.getTimeAgo(email.date);
    return `From ${email.fromName}, ${timeAgo}: "${email.subject}". ${email.snippet.substring(0, 100)}`;
  }

  /**
   * Format inbox summary for speech
   */
  formatInboxSummary(emails: Email[], unreadCount: number): string {
    if (emails.length === 0) {
      return "Your inbox is clear, sir. No new messages.";
    }

    const summary = [`You have ${unreadCount} unread email${unreadCount !== 1 ? 's' : ''}.`];
    
    // Group by sender importance
    const important = emails.filter(e => e.labels.includes('IMPORTANT'));
    
    if (important.length > 0) {
      summary.push(`${important.length} marked as important.`);
    }

    // Top 3 summaries
    summary.push("Most recent:");
    emails.slice(0, 3).forEach((email, i) => {
      summary.push(`${i + 1}. From ${email.fromName}: "${email.subject}"`);
    });

    return summary.join(' ');
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
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }
}
