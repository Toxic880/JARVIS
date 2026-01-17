/**
 * LLM Provider Interface
 *
 * Abstraction for different LLM backends (Gemini, Local/OpenAI, etc.)
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ILLMProvider {
  /**
   * Initialize the provider
   */
  initialize(): Promise<void>;

  /**
   * Generate a chat response
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /**
   * Generate text embeddings
   * @returns Array of floating point numbers representing the text vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Check if the provider is healthy/configured
   */
  healthCheck(): Promise<boolean>;
}
