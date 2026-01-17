/**
 * Web Search Executor - Search the web for information
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { logger } from '../services/logger';

async function searchDuckDuckGo(query: string): Promise<{ results: any[]; instant?: string }> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(url);
    const data = await response.json() as any;
    const results: any[] = [];
    let instant: string | undefined = data.Abstract || undefined;
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text && topic.FirstURL) {
          results.push({ title: topic.Text.split(' - ')[0], link: topic.FirstURL, snippet: topic.Text });
        }
      }
    }
    return { results, instant };
  } catch { return { results: [] }; }
}

async function searchWikipedia(query: string): Promise<{ summary: string; link: string } | null> {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json() as any;
    if (!searchData[1]?.length) return null;
    const title = searchData[1][0];
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryResponse = await fetch(summaryUrl);
    const summaryData = await summaryResponse.json() as any;
    return { summary: summaryData.extract, link: summaryData.content_urls?.desktop?.page || '' };
  } catch { return null; }
}

export class WebSearchExecutor implements IToolExecutor {
  id = 'webSearch';
  name = 'Web Search';
  category = 'information';
  description = 'Search the web for information';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'webSearch',
        description: 'Search the web',
        schema: z.object({ query: z.string() }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'quickFact',
        description: 'Get a quick fact from Wikipedia',
        schema: z.object({ topic: z.string() }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'defineWord',
        description: 'Get word definition',
        schema: z.object({ word: z.string() }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
    ];
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    try {
      let output: any, message: string;

      switch (toolName) {
        case 'webSearch': {
          const { results, instant } = await searchDuckDuckGo(params.query);
          output = { query: params.query, results, instant };
          message = instant || (results.length > 0 ? results[0].snippet : `No results for "${params.query}"`);
          break;
        }
        case 'quickFact': {
          const wiki = await searchWikipedia(params.topic);
          if (wiki) {
            output = { topic: params.topic, summary: wiki.summary, source: wiki.link };
            message = wiki.summary;
          } else {
            const { results, instant } = await searchDuckDuckGo(params.topic);
            output = { topic: params.topic, results };
            message = instant || results[0]?.snippet || `No info found for "${params.topic}"`;
          }
          break;
        }
        case 'defineWord': {
          try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(params.word)}`);
            if (response.ok) {
              const data = await response.json() as any;
              const entry = data[0];
              const def = entry.meanings[0]?.definitions[0];
              output = { word: entry.word, definition: def?.definition, example: def?.example };
              message = `${entry.word}: ${def?.definition || 'No definition found'}`;
            } else {
              throw new Error('Not found');
            }
          } catch {
            output = { word: params.word };
            message = `Could not find definition for "${params.word}"`;
          }
          break;
        }
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return {
        success: true,
        output,
        message,
        sideEffects: [createSideEffect('network_request', 'web_search', `Searched: ${params.query || params.topic || params.word}`, { reversible: true })],
        meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects: [],
        error: { code: 'SEARCH_ERROR', message: error.message, recoverable: true },
        meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false },
      };
    }
  }

  async simulate(toolName: string, params: Record<string, any>) {
    return { wouldSucceed: true, predictedOutput: { simulated: true }, predictedSideEffects: [], warnings: [] };
  }

  validate(toolName: string, params: Record<string, any>) {
    const cap = this.getCapabilities().find(c => c.name === toolName);
    if (!cap) return { valid: false, errors: ['Unknown tool'] };
    const result = cap.schema.safeParse(params);
    return result.success ? { valid: true, sanitizedParams: result.data } : { valid: false, errors: result.error.issues.map(i => i.message) };
  }

  canExecute(toolName: string): boolean { return this.getCapabilities().some(c => c.name === toolName); }
}

export const webSearchExecutor = new WebSearchExecutor();
