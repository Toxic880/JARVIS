/**
 * LM STUDIO SERVICE
 * OpenAI-compatible API client for LLM inference
 * 
 * Supports two modes:
 * 1. Direct mode: Connects directly to LM Studio (dev only, insecure)
 * 2. Proxy mode: Routes through JARVIS server (production, secure)
 * 
 * In production, always use proxy mode to:
 * - Keep API keys server-side
 * - Enable request validation and logging
 * - Apply rate limiting and security controls
 */

import { JarvisTool, ToolCall, ConversationMessage } from '../types';
import { apiClient } from './APIClient';

export type LLMMode = 'direct' | 'proxy';

export interface LMStudioConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  mode?: LLMMode;  // 'direct' for dev, 'proxy' for production
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length';
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class LMStudioService {
  private config: LMStudioConfig;
  private conversationHistory: ConversationMessage[] = [];
  private systemPrompt: string = '';
  private tools: JarvisTool[] = [];
  private mode: LLMMode;

  constructor(config?: Partial<LMStudioConfig>) {
    this.config = {
      baseUrl: config?.baseUrl || 'http://127.0.0.1:1234',
      model: config?.model || 'qwen/qwen3-14b',
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 2048,
    };
    
    // Default to proxy mode if API client is authenticated, direct otherwise
    this.mode = config?.mode || (apiClient.isAuthenticated() ? 'proxy' : 'direct');
    
    console.log(`[LMStudio] Initialized in ${this.mode} mode`);
  }

  /**
   * Set the operating mode
   */
  public setMode(mode: LLMMode): void {
    this.mode = mode;
    console.log(`[LMStudio] Mode changed to: ${mode}`);
  }

  /**
   * Get current mode
   */
  public getMode(): LLMMode {
    return this.mode;
  }

  /**
   * Update the base URL at runtime
   */
  public updateUrl(url: string): void {
    this.config.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
    console.log('[LMStudio] URL updated to:', this.config.baseUrl);
  }

  /**
   * Set the system prompt that defines JARVIS personality
   */
  public setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Register available tools/functions
   */
  public setTools(tools: JarvisTool[]): void {
    this.tools = tools;
  }

  /**
   * Add a message to conversation history
   */
  public addMessage(message: ConversationMessage): void {
    this.conversationHistory.push(message);
    
    // Keep conversation history manageable (last 20 exchanges)
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40);
    }
  }

  /**
   * Clear conversation history (new session)
   */
  public clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  public getHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Build messages array for API call
   */
  private buildMessages(): any[] {
    const messages: any[] = [];

    // System prompt first
    if (this.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.systemPrompt
      });
    }

    // Add conversation history
    for (const msg of this.conversationHistory) {
      if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content
        });
      } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Format assistant message with tool calls in OpenAI format
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });
      } else {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    return messages;
  }

  /**
   * Build tools array for API call (OpenAI format)
   */
  private buildToolsPayload(): any[] | undefined {
    if (this.tools.length === 0) return undefined;

    return this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Send a message and get a response
   */
  public async chat(userMessage: string): Promise<{
    content: string | null;
    toolCalls: ToolCall[] | null;
    finishReason: string;
  }> {
    // Add user message to history
    this.addMessage({
      role: 'user',
      content: userMessage
    });

    const response = await this.sendRequest();
    
    // Add assistant response to history
    if (response.content || response.toolCalls) {
      this.addMessage({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls || undefined
      });
    }

    return response;
  }

  /**
   * Send tool results back to continue the conversation
   */
  public async sendToolResults(results: { toolCallId: string; result: string }[]): Promise<{
    content: string | null;
    toolCalls: ToolCall[] | null;
    finishReason: string;
  }> {
    // Add tool results to history
    for (const result of results) {
      this.addMessage({
        role: 'tool',
        toolCallId: result.toolCallId,
        content: result.result
      });
    }

    const response = await this.sendRequest();

    // Add assistant response to history
    if (response.content || response.toolCalls) {
      this.addMessage({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls || undefined
      });
    }

    return response;
  }

  /**
   * Core API request - routes through proxy or direct based on mode
   */
  private async sendRequest(): Promise<{
    content: string | null;
    toolCalls: ToolCall[] | null;
    finishReason: string;
  }> {
    const messages = this.buildMessages();
    const tools = this.buildToolsPayload();

    try {
      let data: ChatCompletionResponse;

      if (this.mode === 'proxy') {
        // Use server proxy (production mode)
        data = await apiClient.chatCompletion({
          messages: messages.map(m => ({ role: m.role, content: m.content || '' })),
          tools,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });
      } else {
        // Direct mode (development only)
        const payload: any = {
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        };

        if (tools) {
          payload.tools = tools;
          payload.tool_choice = 'auto';
        }

        const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LM Studio API error: ${response.status} - ${errorText}`);
        }

        data = await response.json();
      }

      const choice = data.choices[0];

      // Parse tool calls if present
      let toolCalls: ToolCall[] | null = null;
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        toolCalls = choice.message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: this.safeParseJSON(tc.function.arguments)
        }));
      }

      return {
        content: choice.message.content,
        toolCalls,
        finishReason: choice.finish_reason
      };
    } catch (error) {
      console.error('[LMStudio] Request failed:', error);
      throw error;
    }
  }

  /**
   * Safely parse JSON arguments from tool calls
   */
  private safeParseJSON(str: string): Record<string, any> {
    try {
      return JSON.parse(str);
    } catch {
      console.warn('[LMStudio] Failed to parse tool arguments:', str);
      return {};
    }
  }

  /**
   * Check if LM Studio is reachable
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get available models from LM Studio
   */
  public async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/models`);
      const data = await response.json();
      return data.data?.map((m: any) => m.id) || [];
    } catch {
      return [];
    }
  }
}
