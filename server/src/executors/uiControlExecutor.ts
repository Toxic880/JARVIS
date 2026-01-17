/**
 * UI Control Executor
 * 
 * Gives the LLM control over the frontend UI.
 * The LLM can show news, weather, highlights, etc.
 * Results are sent to connected clients via SSE.
 */

import { 
  IToolExecutor, 
  ToolCapability, 
  ExecutionResult, 
  ExecutionSideEffect,
  createSideEffect
} from './interface';
import { logger } from '../services/logger';
import { z } from 'zod';

// =============================================================================
// UI STATE
// =============================================================================

interface UIState {
  activePanel: 'none' | 'news' | 'weather' | 'calendar' | 'smart-home';
  newsItems: NewsItem[];
  newsHighlightIndex: number;
  weather: WeatherDisplay | null;
  customMessage: string | null;
}

interface NewsItem {
  title: string;
  source: string;
  summary: string;
  url: string;
  publishedAt: string;
}

interface WeatherDisplay {
  location: string;
  temperature: number;
  condition: string;
  icon: string;
  humidity: number;
  windSpeed: number;
}

// Global UI state
let uiState: UIState = {
  activePanel: 'none',
  newsItems: [],
  newsHighlightIndex: -1,
  weather: null,
  customMessage: null,
};

// Subscribers
const subscribers: Set<(state: UIState) => void> = new Set();

export function subscribeToUIState(callback: (state: UIState) => void): () => void {
  subscribers.add(callback);
  callback(uiState);
  return () => subscribers.delete(callback);
}

export function getUIState(): UIState {
  return { ...uiState };
}

function broadcastUIState() {
  subscribers.forEach(cb => {
    try { cb(uiState); } catch (e) { /* ignore */ }
  });
}

// =============================================================================
// EXECUTOR
// =============================================================================

export class UIControlExecutor implements IToolExecutor {
  readonly id = 'ui-control';
  readonly name = 'UI Control';
  readonly category = 'interface';
  
  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'showNews',
        description: 'Display news panel and fetch fresh news. Use this when user asks about news.',
        schema: z.object({
          category: z.enum(['general', 'tech', 'business', 'sports', 'entertainment']).optional(),
          count: z.number().min(1).max(10).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'highlightNewsItem',
        description: 'Highlight a specific news item while discussing it. Call this as you talk about each item.',
        schema: z.object({
          index: z.number().min(0),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'showWeather',
        description: 'Display weather panel. Use when discussing weather.',
        schema: z.object({
          location: z.string().max(100).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'showPanel',
        description: 'Show or hide a UI panel',
        schema: z.object({
          panel: z.enum(['none', 'news', 'weather', 'calendar', 'smart-home']),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
    ];
  }
  
  canExecute(toolName: string): boolean {
    return this.getCapabilities().some(c => c.name === toolName);
  }
  
  validate(toolName: string, params: Record<string, any>) {
    const cap = this.getCapabilities().find(c => c.name === toolName);
    if (!cap) return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    return { valid: true, sanitizedParams: params };
  }
  
  async simulate(toolName: string, params: Record<string, any>) {
    return {
      wouldSucceed: true,
      predictedOutput: { simulated: true },
      predictedSideEffects: [],
      warnings: [],
    };
  }
  
  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    const sideEffects: ExecutionSideEffect[] = [];
    
    try {
      let output: any = null;
      let message = '';
      
      switch (toolName) {
        case 'showNews': {
          const category = params.category || 'general';
          const count = Math.min(Math.max(params.count || 5, 1), 10);
          
          const news = await this.fetchNews(category, count);
          
          uiState.activePanel = 'news';
          uiState.newsItems = news;
          uiState.newsHighlightIndex = 0;
          broadcastUIState();
          
          output = { news, count: news.length };
          message = `Showing ${news.length} ${category} news articles`;
          sideEffects.push(createSideEffect('state_change', 'ui', 'Showed news panel'));
          break;
        }
        
        case 'highlightNewsItem': {
          const index = params.index;
          if (index >= 0 && index < uiState.newsItems.length) {
            uiState.newsHighlightIndex = index;
            broadcastUIState();
            output = { index, item: uiState.newsItems[index] };
            message = `Highlighting article ${index + 1}: ${uiState.newsItems[index]?.title}`;
          } else {
            throw new Error(`Invalid index: ${index}`);
          }
          break;
        }
        
        case 'showWeather': {
          const weather = await this.fetchWeather(params.location);
          uiState.activePanel = 'weather';
          uiState.weather = weather;
          broadcastUIState();
          output = weather;
          message = `Showing weather for ${weather.location}`;
          sideEffects.push(createSideEffect('state_change', 'ui', 'Showed weather panel'));
          break;
        }
        
        case 'showPanel': {
          uiState.activePanel = params.panel;
          broadcastUIState();
          output = { panel: params.panel };
          message = params.panel === 'none' ? 'Closed panel' : `Switched to ${params.panel}`;
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
      logger.error('UI control error', { toolName, params, error: error.message });
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects,
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
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private async fetchNews(category: string, count: number): Promise<NewsItem[]> {
    const feeds: Record<string, string[]> = {
      general: ['https://feeds.bbci.co.uk/news/rss.xml'],
      tech: ['https://feeds.arstechnica.com/arstechnica/technology-lab'],
      business: ['https://feeds.bbci.co.uk/news/business/rss.xml'],
      sports: ['https://feeds.bbci.co.uk/sport/rss.xml'],
      entertainment: ['https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'],
    };
    
    const feedUrls = feeds[category] || feeds.general;
    const allItems: NewsItem[] = [];
    
    for (const url of feedUrls) {
      try {
        const response = await fetch(url, { 
          headers: { 'User-Agent': 'JARVIS/2.0' },
          signal: AbortSignal.timeout(5000),
        });
        
        if (!response.ok) continue;
        
        const xml = await response.text();
        const items = this.parseRSS(xml);
        allItems.push(...items);
      } catch (e) {
        logger.warn('RSS fetch failed', { url });
      }
    }
    
    return allItems.slice(0, count);
  }
  
  private parseRSS(xml: string): NewsItem[] {
    const items: NewsItem[] = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    
    for (const item of itemMatches.slice(0, 10)) {
      const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
      const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const desc = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/)?.[1] || '';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      
      if (title) {
        items.push({
          title: title.replace(/<[^>]+>/g, '').trim(),
          source: link ? new URL(link).hostname.replace('www.', '') : 'unknown',
          summary: desc.replace(/<[^>]+>/g, '').substring(0, 200).trim(),
          url: link,
          publishedAt: pubDate,
        });
      }
    }
    
    return items;
  }
  
  private async fetchWeather(location?: string): Promise<WeatherDisplay> {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const loc = location || process.env.DEFAULT_LOCATION || 'London';
    
    if (apiKey) {
      try {
        const response = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(loc)}&appid=${apiKey}&units=metric`
        );
        
        if (response.ok) {
          const data = await response.json() as any;
          return {
            location: data.name,
            temperature: Math.round(data.main.temp),
            condition: data.weather[0].description,
            icon: data.weather[0].icon,
            humidity: data.main.humidity,
            windSpeed: Math.round(data.wind.speed),
          };
        }
      } catch (e) {
        logger.warn('Weather fetch failed', { location: loc });
      }
    }
    
    return {
      location: loc,
      temperature: 15,
      condition: 'partly cloudy',
      icon: '02d',
      humidity: 65,
      windSpeed: 12,
    };
  }
}

export const uiControlExecutor = new UIControlExecutor();
