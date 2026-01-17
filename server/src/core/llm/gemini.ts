import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { ILLMProvider, ChatMessage, ChatOptions } from './interface';
import { logger } from '../../services/logger';

export class GeminiProvider implements ILLMProvider {
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private embeddingModel: GenerativeModel | null = null;

  async initialize(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('Gemini API key not found (GEMINI_API_KEY)');
      return;
    }

    try {
      this.client = new GoogleGenerativeAI(apiKey);
      // Use gemini-pro (or 1.5-pro/flash) for chat
      this.model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });
      // Use embedding-001 for embeddings
      this.embeddingModel = this.client.getGenerativeModel({ model: 'text-embedding-004' });
      logger.info('Gemini provider initialized');
    } catch (error) {
      logger.error('Failed to initialize Gemini provider', { error });
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (!this.model) await this.initialize();
    if (!this.model) throw new Error('Gemini not initialized');

    try {
      // Convert standard messages to Gemini format
      // Gemini expects a history + last message structure, or we can use generateContent with full context
      // For simplicity in single-turn or stateless calls, we'll format as a single prompt or chat session

      const history = messages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model', // Gemini uses 'model' instead of 'assistant'
        parts: [{ text: m.content }],
      }));

      const lastMessage = messages[messages.length - 1];

      const chat = this.model.startChat({
        history: history as any,
        generationConfig: {
          temperature: options?.temperature || 0.7,
          maxOutputTokens: options?.maxTokens,
        },
      });

      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;
      return response.text();
    } catch (error) {
      logger.error('Gemini chat error', { error });
      throw error;
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embeddingModel) await this.initialize();
    if (!this.embeddingModel) throw new Error('Gemini not initialized');

    try {
      const result = await this.embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      logger.error('Gemini embedding error', { error });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.initialize();
      if (!this.model) return false;
      // Simple generation check
      const result = await this.model.generateContent('Ping');
      return !!result.response.text();
    } catch (e) {
      return false;
    }
  }
}
