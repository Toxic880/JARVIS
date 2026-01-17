/**
 * GOOGLE SERVICES
 * Handles Google Calendar and Google Tasks integration
 * 
 * NOTE: Google REQUIRES client_secret even with PKCE for web apps.
 * This is different from Spotify which works without a secret.
 * 
 * SETUP REQUIRED:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a new project
 * 3. Enable Google Calendar API and Google Tasks API
 * 4. Create OAuth 2.0 credentials (Web application)
 * 5. Add authorized redirect URI: http://localhost:3000/google-callback
 * 6. Copy Client ID AND Client Secret to JARVIS settings
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
const TASKS_API_URL = 'https://tasks.googleapis.com/tasks/v1';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  isAllDay: boolean;
  calendarId: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: Date;
  completed: boolean;
  listId: string;
}

export interface TaskList {
  id: string;
  title: string;
}

export class GoogleService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;
  private redirectUri: string;

  constructor(clientId: string, clientSecret: string = '', redirectUri: string = `${window.location.origin}/google-callback`) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.loadTokens();
  }

  /**
   * Update client secret (can be set after construction)
   */
  public setClientSecret(secret: string) {
    this.clientSecret = secret;
  }

  private loadTokens() {
    this.accessToken = localStorage.getItem('google_access_token');
    this.refreshToken = localStorage.getItem('google_refresh_token');
    this.tokenExpiry = parseInt(localStorage.getItem('google_token_expiry') || '0');
  }

  private saveTokens(accessToken: string, refreshToken: string | null, expiresIn: number) {
    this.accessToken = accessToken;
    if (refreshToken) this.refreshToken = refreshToken;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);
    
    localStorage.setItem('google_access_token', accessToken);
    if (refreshToken) localStorage.setItem('google_refresh_token', refreshToken);
    localStorage.setItem('google_token_expiry', this.tokenExpiry.toString());
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  /**
   * Check if properly configured (has both ID and secret)
   */
  public isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /**
   * Generate the authorization URL for OAuth
   */
  public getAuthUrl(): string {
    const state = crypto.randomUUID();
    localStorage.setItem('google_auth_state', state);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES,
      state: state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * NOTE: Google requires client_secret for web applications
   */
  public async handleCallback(code: string): Promise<boolean> {
    if (!this.clientSecret) {
      console.error('[Google] Client secret is required for token exchange');
      return false;
    }

    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Google] Token exchange failed:', error);
        return false;
      }

      const data = await response.json();
      this.saveTokens(data.access_token, data.refresh_token, data.expires_in);
      return true;
    } catch (error) {
      console.error('[Google] Auth error:', error);
      return false;
    }
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken || !this.clientSecret) return false;

    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        this.saveTokens(data.access_token, null, data.expires_in);
        return true;
      }
    } catch (error) {
      console.error('[Google] Token refresh failed:', error);
    }
    return false;
  }

  /**
   * Set access token directly (for manual OAuth flow)
   */
  public setAccessToken(token: string, expiresIn: number = 3600): void {
    this.saveTokens(token, null, expiresIn);
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest(baseUrl: string, endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Google');
    }

    // Check if token needs refresh
    if (Date.now() >= this.tokenExpiry - 60000 && this.refreshToken) {
      await this.refreshAccessToken();
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Google API error: ${response.status}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  // ===========================================================================
  // CALENDAR
  // ===========================================================================

  /**
   * Get upcoming calendar events
   */
  async getUpcomingEvents(maxResults: number = 10, daysAhead: number = 7): Promise<CalendarEvent[]> {
    try {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      const params = new URLSearchParams({
        maxResults: maxResults.toString(),
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
      });

      const data = await this.apiRequest(
        CALENDAR_API_URL,
        `/calendars/primary/events?${params.toString()}`
      );

      return (data.items || []).map((event: any) => ({
        id: event.id,
        title: event.summary || 'Untitled',
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
        location: event.location,
        description: event.description,
        isAllDay: !event.start.dateTime,
        calendarId: 'primary',
      }));
    } catch (error) {
      console.error('[Calendar] Failed to fetch events:', error);
      return [];
    }
  }

  /**
   * Get today's events
   */
  async getTodayEvents(): Promise<CalendarEvent[]> {
    const events = await this.getUpcomingEvents(20, 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return events.filter(e => e.start >= today && e.start < tomorrow);
  }

  /**
   * Get tomorrow's events
   */
  async getTomorrowEvents(): Promise<CalendarEvent[]> {
    const events = await this.getUpcomingEvents(20, 2);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    return events.filter(e => e.start >= tomorrow && e.start < dayAfter);
  }

  /**
   * Create a calendar event
   */
  async createEvent(
    title: string,
    start: Date,
    end?: Date,
    description?: string,
    location?: string
  ): Promise<CalendarEvent | null> {
    try {
      const endTime = end || new Date(start.getTime() + 60 * 60 * 1000); // Default 1 hour

      const event = {
        summary: title,
        description,
        location,
        start: {
          dateTime: start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      };

      const data = await this.apiRequest(
        CALENDAR_API_URL,
        '/calendars/primary/events',
        'POST',
        event
      );

      return {
        id: data.id,
        title: data.summary,
        start: new Date(data.start.dateTime),
        end: new Date(data.end.dateTime),
        location: data.location,
        description: data.description,
        isAllDay: false,
        calendarId: 'primary',
      };
    } catch (error) {
      console.error('[Calendar] Failed to create event:', error);
      return null;
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    try {
      await this.apiRequest(
        CALENDAR_API_URL,
        `/calendars/primary/events/${eventId}`,
        'DELETE'
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format events for speech
   */
  formatEventsForSpeech(events: CalendarEvent[]): string {
    if (events.length === 0) {
      return "You have no upcoming events.";
    }

    const eventStrings = events.slice(0, 5).map(event => {
      const time = event.isAllDay 
        ? 'all day' 
        : event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${event.title} at ${time}`;
    });

    if (events.length === 1) {
      return `You have one event: ${eventStrings[0]}.`;
    }

    return `You have ${events.length} events. ${eventStrings.join('. ')}.`;
  }

  // ===========================================================================
  // TASKS
  // ===========================================================================

  /**
   * Get all task lists
   */
  async getTaskLists(): Promise<TaskList[]> {
    try {
      const data = await this.apiRequest(TASKS_API_URL, '/users/@me/lists');
      return (data.items || []).map((list: any) => ({
        id: list.id,
        title: list.title,
      }));
    } catch (error) {
      console.error('[Tasks] Failed to fetch task lists:', error);
      return [];
    }
  }

  /**
   * Get tasks from a list
   */
  async getTasks(listId: string = '@default', showCompleted: boolean = false): Promise<GoogleTask[]> {
    try {
      const params = new URLSearchParams({
        showCompleted: showCompleted.toString(),
        showHidden: 'false',
      });

      const data = await this.apiRequest(
        TASKS_API_URL,
        `/lists/${listId}/tasks?${params.toString()}`
      );

      return (data.items || []).map((task: any) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        due: task.due ? new Date(task.due) : undefined,
        completed: task.status === 'completed',
        listId: listId,
      }));
    } catch (error) {
      console.error('[Tasks] Failed to fetch tasks:', error);
      return [];
    }
  }

  /**
   * Create a new task
   */
  async createTask(
    title: string,
    listId: string = '@default',
    notes?: string,
    due?: Date
  ): Promise<GoogleTask | null> {
    try {
      const task: any = {
        title,
        notes,
      };

      if (due) {
        task.due = due.toISOString();
      }

      const data = await this.apiRequest(
        TASKS_API_URL,
        `/lists/${listId}/tasks`,
        'POST',
        task
      );

      return {
        id: data.id,
        title: data.title,
        notes: data.notes,
        due: data.due ? new Date(data.due) : undefined,
        completed: data.status === 'completed',
        listId: listId,
      };
    } catch (error) {
      console.error('[Tasks] Failed to create task:', error);
      return null;
    }
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string, listId: string = '@default'): Promise<boolean> {
    try {
      await this.apiRequest(
        TASKS_API_URL,
        `/lists/${listId}/tasks/${taskId}`,
        'PATCH',
        { status: 'completed' }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string, listId: string = '@default'): Promise<boolean> {
    try {
      await this.apiRequest(
        TASKS_API_URL,
        `/lists/${listId}/tasks/${taskId}`,
        'DELETE'
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format tasks for speech
   */
  formatTasksForSpeech(tasks: GoogleTask[]): string {
    const pending = tasks.filter(t => !t.completed);
    
    if (pending.length === 0) {
      return "You have no pending tasks.";
    }

    const taskStrings = pending.slice(0, 5).map(task => task.title);

    if (pending.length === 1) {
      return `You have one task: ${taskStrings[0]}.`;
    }

    return `You have ${pending.length} tasks. ${taskStrings.join('. ')}.`;
  }

  /**
   * Logout
   */
  public logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_refresh_token');
    localStorage.removeItem('google_token_expiry');
  }
}
