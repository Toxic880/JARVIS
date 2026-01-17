import { ILLMProvider, ChatMessage, ChatOptions } from './interface';
import { logger } from '../../services/logger';

export class LocalProvider implements ILLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
    this.apiKey = process.env.LLM_API_KEY || 'lm-studio';
    this.model = process.env.LLM_MODEL || 'local-model';
  }

  async initialize(): Promise<void> {
    logger.info('Local provider initialized', { baseUrl: this.baseUrl, model: this.model });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature || 0.7,
          max_tokens: options?.maxTokens || -1,
          stream: false,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Local LLM error: ${response.status} - ${error}`);
      }

      const data = await response.json() as any;
      return data.choices[0].message.content;
    } catch (error) {
      logger.error('Local chat error', { error });
      throw error;
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-nomic-embed-text-v1.5', // Default or config?
          input: text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Local embedding error: ${response.status} - ${error}`);
      }

      const data = await response.json() as any;
      return data.data[0].embedding;
    } catch (error) {
      logger.error('Local embedding error', { error });
      // Fallback: return empty array or simple hash if embeddings aren't critical for basic functionality,
      // but for memory they are. For now throw.
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}
