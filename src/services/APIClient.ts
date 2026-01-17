/**
 * JARVIS API Client
 * 
 * Handles all communication with the JARVIS server:
 * - Authentication
 * - Token management (access + refresh)
 * - API requests
 */

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

class JarvisAPIClient {
  private serverUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.serverUrl = localStorage.getItem('jarvis_server_url') || DEFAULT_SERVER_URL;
    this.loadTokens();
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  public setServerUrl(url: string) {
    this.serverUrl = url.replace(/\/$/, '');
    localStorage.setItem('jarvis_server_url', this.serverUrl);
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  // ===========================================================================
  // TOKEN MANAGEMENT
  // ===========================================================================

  private loadTokens() {
    this.accessToken = localStorage.getItem('jarvis_access_token');
    this.refreshToken = localStorage.getItem('jarvis_refresh_token');
  }

  private saveTokens(access: string, refresh?: string) {
    this.accessToken = access;
    localStorage.setItem('jarvis_access_token', access);
    
    if (refresh) {
      this.refreshToken = refresh;
      localStorage.setItem('jarvis_refresh_token', refresh);
    }
  }

  public clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('jarvis_access_token');
    localStorage.removeItem('jarvis_refresh_token');
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // ===========================================================================
  // AUTH METHODS
  // ===========================================================================

  public async checkAuthStatus(): Promise<{ setupRequired: boolean; serverVersion?: string }> {
    const response = await this.fetch('/api/v1/auth/status', { auth: false });
    return response.json();
  }

  public async setup(username: string, password: string): Promise<LoginResponse> {
    const response = await this.fetch('/api/v1/auth/setup', {
      method: 'POST',
      auth: false,
      body: { username, password },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Setup failed');
    }

    const data = await response.json();
    this.saveTokens(data.accessToken, data.refreshToken);
    return data;
  }

  public async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.fetch('/api/v1/auth/login', {
      method: 'POST',
      auth: false,
      body: { username, password },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();
    this.saveTokens(data.accessToken, data.refreshToken);
    return data;
  }

  public async logout(): Promise<void> {
    try {
      await this.fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors on logout
    }
    this.clearTokens();
  }

  public async getCurrentUser(): Promise<User | null> {
    if (!this.accessToken) return null;

    try {
      const response = await this.fetch('/api/v1/auth/me');
      if (response.ok) {
        const data = await response.json();
        return data.user;
      }
    } catch {
      // Token might be invalid
    }
    return null;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await this.fetch('/api/v1/auth/refresh', {
          method: 'POST',
          auth: false,
          body: { refreshToken: this.refreshToken },
        });

        if (response.ok) {
          const data = await response.json();
          this.saveTokens(data.accessToken);
          return true;
        }
      } catch {
        // Refresh failed
      }
      
      this.clearTokens();
      return false;
    })();

    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  // ===========================================================================
  // REQUEST HELPERS
  // ===========================================================================

  private async fetch(
    path: string,
    options: {
      method?: string;
      body?: any;
      auth?: boolean;
      headers?: Record<string, string>;
    } = {}
  ): Promise<Response> {
    const { method = 'GET', body, auth = true, headers = {} } = options;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (auth && this.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle token expiration
    if (response.status === 401 && auth) {
      const data = await response.clone().json().catch(() => ({}));
      
      if (data.code === 'TOKEN_EXPIRED') {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry the request with new token
          requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
          return fetch(`${this.serverUrl}${path}`, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
          });
        }
      }
    }

    return response;
  }

  // ===========================================================================
  // LLM PROXY
  // ===========================================================================

  /**
   * New structured chat endpoint (v2 pipeline)
   * Returns structured intents with confirmation handling
   */
  public async chat(request: {
    message: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    worldState?: {
      user?: { name?: string; mode?: string };
      desktop?: { activeApp?: string; activeWindow?: string };
      home?: { audioOutput?: string; currentScene?: string };
      music?: { isPlaying?: boolean; currentTrack?: string };
    };
  }): Promise<{
    response: string;
    intent: { type: string } | null;
    pendingConfirmation: {
      id: string;
      action: string;
      displayMessage: string;
      displayParams?: Record<string, string>;
      expiresAt: string;
    } | null;
    executionResult: {
      success: boolean;
      message?: string;
      error?: string;
    } | null;
    clarification: {
      question: string;
      options?: { label: string; value: string }[];
    } | null;
    plan: {
      goal: string;
      summary: string;
      steps: { action: string; status: string }[];
    } | null;
  }> {
    const response = await this.fetch('/api/v1/llm/chat', {
      method: 'POST',
      body: request,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Chat request failed');
    }

    return response.json();
  }

  /**
   * Confirm a pending action from the chat endpoint
   */
  public async confirmChat(confirmationId: string): Promise<{
    confirmed: boolean;
    result: {
      success: boolean;
      message?: string;
      error?: string;
    };
  }> {
    const response = await this.fetch('/api/v1/llm/confirm', {
      method: 'POST',
      body: { confirmationId },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Confirmation failed');
    }

    return response.json();
  }

  /**
   * Cancel a pending confirmation
   */
  public async cancelChat(confirmationId: string): Promise<{ cancelled: boolean }> {
    const response = await this.fetch('/api/v1/llm/cancel', {
      method: 'POST',
      body: { confirmationId },
    });
    return response.json();
  }

  /**
   * Legacy chat completion (OpenAI format)
   */
  public async chatCompletion(request: {
    messages: { role: string; content: string }[];
    tools?: any[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<any> {
    const response = await this.fetch('/api/v1/llm/chat/completions', {
      method: 'POST',
      body: {
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'LLM request failed');
    }

    return response.json();
  }

  /**
   * Streaming chat - returns tokens as they're generated
   * This provides much better UX than waiting for the full response
   */
  public async chatStream(
    request: {
      message: string;
      conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
      worldState?: any;
    },
    callbacks: {
      onToken: (token: string) => void;
      onComplete?: (fullResponse: string) => void;
      onError?: (error: Error) => void;
    }
  ): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/api/v1/llm/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              callbacks.onComplete?.(fullResponse);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                fullResponse += parsed.token;
                callbacks.onToken(parsed.token);
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      callbacks.onComplete?.(fullResponse);
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public async getLLMStatus(): Promise<{ configured: boolean; status: string; pipeline?: string }> {
    const response = await this.fetch('/api/v1/llm/status');
    return response.json();
  }

  public async getLLMContext(): Promise<{ worldState: any }> {
    const response = await this.fetch('/api/v1/llm/context');
    return response.json();
  }

  // ===========================================================================
  // PERCEPTION (World State Updates)
  // ===========================================================================

  /**
   * Update focus state (what app/window is active)
   */
  public async updateFocus(app: string, window?: string): Promise<void> {
    await this.fetch('/api/v1/perception/focus', {
      method: 'POST',
      body: { app, window },
    });
  }

  /**
   * Update music state
   */
  public async updateMusicState(playing: boolean, track?: string, artist?: string): Promise<void> {
    await this.fetch('/api/v1/perception/music', {
      method: 'POST',
      body: { playing, track, artist },
    });
  }

  /**
   * Update home state
   */
  public async updateHomeState(audioOutput?: string, scene?: string): Promise<void> {
    await this.fetch('/api/v1/perception/home', {
      method: 'POST',
      body: { audioOutput, scene },
    });
  }

  /**
   * Update mode
   */
  public async updateMode(mode: 'normal' | 'focus' | 'dnd' | 'sleep' | 'away' | 'guest'): Promise<void> {
    await this.fetch('/api/v1/perception/mode', {
      method: 'POST',
      body: { mode },
    });
  }

  /**
   * Record an action (for pattern detection)
   */
  public async recordAction(action: string): Promise<void> {
    await this.fetch('/api/v1/perception/action', {
      method: 'POST',
      body: { action },
    });
  }

  /**
   * Mark user as idle
   */
  public async markIdle(): Promise<void> {
    await this.fetch('/api/v1/perception/idle', {
      method: 'POST',
    });
  }

  /**
   * Get current perception state
   */
  public async getPerceptionState(): Promise<{
    worldState: any;
    raw: {
      activeApp: string | null;
      activeWindow: string | null;
      mode: string;
      musicPlaying: boolean;
      currentTrack: string | null;
    };
  }> {
    const response = await this.fetch('/api/v1/perception/state');
    return response.json();
  }

  /**
   * Batch update perception state
   */
  public async batchUpdatePerception(updates: { type: string; data: any }[]): Promise<void> {
    await this.fetch('/api/v1/perception/batch', {
      method: 'POST',
      body: { updates },
    });
  }

  // ===========================================================================
  // TTS PROXY
  // ===========================================================================

  public async speak(text: string, voiceId?: string): Promise<ArrayBuffer> {
    const response = await this.fetch('/api/v1/tts/speak', {
      method: 'POST',
      body: { text, voiceId },
    });

    if (!response.ok) {
      throw new Error('TTS request failed');
    }

    return response.arrayBuffer();
  }

  public async getTTSStatus(): Promise<{ configured: boolean; status: string }> {
    const response = await this.fetch('/api/v1/tts/status');
    return response.json();
  }

  // ===========================================================================
  // MEMORY
  // ===========================================================================

  public async getMemories(options?: {
    type?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: any[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const response = await this.fetch(`/api/v1/memory?${params}`);
    return response.json();
  }

  public async createMemory(entry: {
    type: string;
    content: string;
    keywords?: string[];
    source?: string;
  }): Promise<any> {
    const response = await this.fetch('/api/v1/memory', {
      method: 'POST',
      body: entry,
    });
    return response.json();
  }

  public async syncMemory(lastSyncTime?: string, localChanges?: any[]): Promise<{
    serverChanges: any[];
    conflicts: any[];
    syncTime: string;
  }> {
    const response = await this.fetch('/api/v1/memory/sync', {
      method: 'POST',
      body: { lastSyncTime, localChanges },
    });
    return response.json();
  }

  // ===========================================================================
  // TOOLS
  // ===========================================================================

  public async executeTool(name: string, parameters: any): Promise<{
    status: 'success' | 'confirmation_required';
    result?: any;
    confirmationId?: string;
  }> {
    const response = await this.fetch('/api/v1/tools/execute', {
      method: 'POST',
      body: { name, parameters },
    });

    if (response.status === 202) {
      // Confirmation required
      return response.json();
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Tool execution failed');
    }

    return response.json();
  }

  public async confirmTool(confirmationId: string): Promise<any> {
    const response = await this.fetch('/api/v1/tools/confirm', {
      method: 'POST',
      body: { confirmationId },
    });
    return response.json();
  }

  public async getToolDefinitions(): Promise<any[]> {
    const response = await this.fetch('/api/v1/tools');
    const data = await response.json();
    return data.tools;
  }

  // ===========================================================================
  // HOME ASSISTANT
  // ===========================================================================

  public async getHomeAssistantStatus(): Promise<{ connected: boolean; configured: boolean }> {
    const response = await this.fetch('/api/v1/home-assistant/status');
    return response.json();
  }

  public async getHomeAssistantStates(): Promise<any[]> {
    const response = await this.fetch('/api/v1/home-assistant/states');
    const data = await response.json();
    return data.states || [];
  }

  public async getHomeAssistantState(entityId: string): Promise<any | null> {
    try {
      const response = await this.fetch(`/api/v1/home-assistant/states/${entityId}`);
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  public async controlHomeAssistantDevice(
    entityId: string,
    action: string,
    value?: Record<string, any>
  ): Promise<{ success: boolean; message: string; newState?: string }> {
    const response = await this.fetch('/api/v1/home-assistant/control', {
      method: 'POST',
      body: { entityId, action, value },
    });
    return response.json();
  }

  public async callHomeAssistantService(
    domain: string,
    service: string,
    data?: Record<string, any>
  ): Promise<{ success: boolean }> {
    const response = await this.fetch('/api/v1/home-assistant/services', {
      method: 'POST',
      body: { domain, service, data },
    });
    return response.json();
  }

  public async activateHomeAssistantScene(sceneId: string): Promise<{ success: boolean }> {
    const response = await this.fetch('/api/v1/home-assistant/scenes/activate', {
      method: 'POST',
      body: { sceneId },
    });
    return response.json();
  }

  public async getHomeAssistantHistory(
    entityId: string,
    startTime?: string,
    endTime?: string
  ): Promise<any[]> {
    const params = new URLSearchParams();
    if (startTime) params.set('start', startTime);
    if (endTime) params.set('end', endTime);
    
    const response = await this.fetch(`/api/v1/home-assistant/history/${entityId}?${params}`);
    const data = await response.json();
    return data.history || [];
  }

  // Legacy aliases for backwards compatibility
  public async getHAStatus() {
    return this.getHomeAssistantStatus();
  }

  public async getHAStates() {
    return this.getHomeAssistantStates();
  }

  public async controlHADevice(entityId: string, action: string, data?: any) {
    return this.controlHomeAssistantDevice(entityId, action, data);
  }

  // ===========================================================================
  // TOOL EXECUTION
  // ===========================================================================

  public async confirmToolExecution(confirmationId: string): Promise<{ confirmed: boolean; result?: any }> {
    const response = await this.fetch('/api/v1/tools/confirm', {
      method: 'POST',
      body: { confirmationId },
    });
    return response.json();
  }

  public async getPendingConfirmations(): Promise<any[]> {
    const response = await this.fetch('/api/v1/tools/pending');
    const data = await response.json();
    return data.pending || [];
  }

  public async getToolExecutionHistory(options?: {
    limit?: number;
    toolName?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.toolName) params.set('tool', options.toolName);
    
    const response = await this.fetch(`/api/v1/tools/history?${params}`);
    const data = await response.json();
    return data.history || [];
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  public async checkHealth(): Promise<{ status: string }> {
    const response = await fetch(`${this.serverUrl}/api/v1/health`);
    return response.json();
  }

  public async getServiceConfig(): Promise<any> {
    const response = await fetch(`${this.serverUrl}/api/v1/health/config`);
    return response.json();
  }
}

// Singleton instance
export const apiClient = new JarvisAPIClient();
