import { ILLMProvider } from './interface';
import { GeminiProvider } from './gemini';
import { LocalProvider } from './local';
import { logger } from '../../services/logger';

export class LLMFactory {
  private static instance: ILLMProvider | null = null;

  static async getProvider(): Promise<ILLMProvider> {
    if (this.instance) return this.instance;

    const providerType = process.env.LLM_PROVIDER || 'local';
    logger.info(`Initializing LLM provider: ${providerType}`);

    switch (providerType.toLowerCase()) {
      case 'gemini':
        this.instance = new GeminiProvider();
        break;
      case 'local':
      default:
        this.instance = new LocalProvider();
        break;
    }

    await this.instance.initialize();
    return this.instance;
  }
}
