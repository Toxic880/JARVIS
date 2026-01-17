/**
 * Self-Knowledge Executor - JARVIS explains what it can do
 * 
 * Handles queries like:
 * - "What can you do?"
 * - "Help" / "What are your capabilities?"
 * - "Can you do X?"
 * - "How do I use Y?"
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, executorRegistry } from './interface';
import { logger } from '../services/logger';

// =============================================================================
// CAPABILITY DESCRIPTIONS (Human-friendly)
// =============================================================================

const CATEGORY_DESCRIPTIONS: Record<string, { emoji: string; name: string; description: string }> = {
  'timers': {
    emoji: '⏱️',
    name: 'Timers & Reminders',
    description: 'Set timers, alarms, and reminders',
  },
  'home': {
    emoji: '🏠',
    name: 'Smart Home',
    description: 'Control lights, thermostats, and other smart devices',
  },
  'lists': {
    emoji: '📝',
    name: 'Lists & Notes',
    description: 'Manage to-do lists, shopping lists, and notes',
  },
  'utility': {
    emoji: '🔧',
    name: 'Utilities',
    description: 'Math, conversions, weather, and general info',
  },
  'media': {
    emoji: '🎵',
    name: 'Music & Media',
    description: 'Control Spotify, play music, manage playback',
  },
  'productivity': {
    emoji: '📅',
    name: 'Productivity',
    description: 'Calendar, goals, and task management',
  },
  'information': {
    emoji: '🔍',
    name: 'Information',
    description: 'Web search, definitions, and facts',
  },
  'system': {
    emoji: '🖥️',
    name: 'System Control',
    description: 'Launch apps, control windows, lock screen',
  },
  'communication': {
    emoji: '💬',
    name: 'Communication',
    description: 'Email, SMS, and messaging',
  },
};

const EXAMPLE_COMMANDS: Record<string, string[]> = {
  'timers': [
    '"Set a timer for 5 minutes"',
    '"Remind me to call mom at 3pm"',
    '"Wake me up at 7am tomorrow"',
  ],
  'home': [
    '"Turn off the living room lights"',
    '"Set the thermostat to 72"',
    '"Lock the front door"',
  ],
  'lists': [
    '"Add milk to my shopping list"',
    '"What\'s on my to-do list?"',
    '"Create a new list called Groceries"',
  ],
  'media': [
    '"Play some jazz music"',
    '"Skip this song"',
    '"Set volume to 50%"',
  ],
  'productivity': [
    '"What\'s on my calendar today?"',
    '"Schedule a meeting tomorrow at 2pm"',
    '"I want to learn Spanish" (creates a goal)',
  ],
  'information': [
    '"Who won the Super Bowl last year?"',
    '"What\'s the definition of serendipity?"',
    '"Tell me about Albert Einstein"',
  ],
  'system': [
    '"Open Chrome"',
    '"Close Spotify"',
    '"Lock my computer"',
  ],
  'communication': [
    '"Check my email"',
    '"Send a message to mom saying I\'ll be late"',
    '"Read my unread emails"',
  ],
};

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class SelfKnowledgeExecutor implements IToolExecutor {
  id = 'selfKnowledge';
  name = 'Self Knowledge';
  category = 'meta';
  description = 'Explains what JARVIS can do';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'getHelp',
        description: 'Get general help and list of capabilities. Use for "what can you do?", "help", etc.',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'getCategoryHelp',
        description: 'Get help for a specific category of capabilities',
        schema: z.object({
          category: z.string().describe('Category name like "music", "calendar", "email"'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'canIDo',
        description: 'Check if JARVIS can do a specific thing',
        schema: z.object({
          query: z.string().describe('What the user is asking about'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'getStatus',
        description: 'Get JARVIS system status and connected services',
        schema: z.object({}),
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
      let output: any;
      let message: string = '';

      switch (toolName) {
        case 'getHelp': {
          // Get all capabilities grouped by category
          const allCapabilities = executorRegistry.getAllCapabilities();
          const executorIds = new Set<string>();
          
          // Get unique executors
          for (const cap of allCapabilities) {
            const executor = executorRegistry.getExecutor(cap.name);
            if (executor) {
              executorIds.add(executor.id);
            }
          }
          
          // Build category summary
          const categories: any[] = [];
          
          for (const [catId, catInfo] of Object.entries(CATEGORY_DESCRIPTIONS)) {
            const examples = EXAMPLE_COMMANDS[catId] || [];
            categories.push({
              id: catId,
              ...catInfo,
              examples,
            });
          }
          
          output = {
            totalCapabilities: allCapabilities.length,
            categories,
          };
          
          message = `👋 Hi! I'm JARVIS, your personal AI assistant. Here's what I can help you with:\n\n`;
          
          for (const cat of categories) {
            message += `${cat.emoji} **${cat.name}**\n`;
            message += `   ${cat.description}\n`;
            if (cat.examples.length > 0) {
              message += `   Try: ${cat.examples[0]}\n`;
            }
            message += '\n';
          }
          
          message += `Just ask naturally! For example: "Play some music" or "What's on my calendar?"`;
          break;
        }

        case 'getCategoryHelp': {
          const { category } = params;
          const catLower = category.toLowerCase();
          
          // Map common terms to categories
          const categoryMap: Record<string, string> = {
            'music': 'media',
            'spotify': 'media',
            'calendar': 'productivity',
            'goals': 'productivity',
            'email': 'communication',
            'gmail': 'communication',
            'sms': 'communication',
            'text': 'communication',
            'message': 'communication',
            'search': 'information',
            'web': 'information',
            'timer': 'timers',
            'reminder': 'timers',
            'alarm': 'timers',
            'light': 'home',
            'lights': 'home',
            'thermostat': 'home',
            'smart home': 'home',
            'app': 'system',
            'apps': 'system',
            'launch': 'system',
            'list': 'lists',
            'note': 'lists',
            'todo': 'lists',
          };
          
          const mappedCat = categoryMap[catLower] || catLower;
          const catInfo = CATEGORY_DESCRIPTIONS[mappedCat];
          const examples = EXAMPLE_COMMANDS[mappedCat] || [];
          
          if (!catInfo) {
            message = `I'm not sure about "${category}". Try asking "what can you do?" for a full list.`;
            output = { found: false, query: category };
            break;
          }
          
          // Get actual capabilities for this category
          const allCaps = executorRegistry.getAllCapabilities();
          const categoryCaps = allCaps.filter(cap => {
            const executor = executorRegistry.getExecutor(cap.name);
            return executor?.category === mappedCat;
          });
          
          output = {
            category: mappedCat,
            info: catInfo,
            capabilities: categoryCaps.map(c => c.name),
            examples,
          };
          
          message = `${catInfo.emoji} **${catInfo.name}**\n\n`;
          message += `${catInfo.description}\n\n`;
          message += `**Things you can say:**\n`;
          for (const example of examples) {
            message += `• ${example}\n`;
          }
          
          if (categoryCaps.length > 0) {
            message += `\n**Available commands:** ${categoryCaps.map(c => c.name).join(', ')}`;
          }
          break;
        }

        case 'canIDo': {
          const { query } = params;
          const queryLower = query.toLowerCase();
          
          // Keywords to capability mapping
          const keywordMap: Record<string, { can: boolean; how: string }> = {
            'music': { can: true, how: 'Say "play some music" or "play [song/artist]"' },
            'spotify': { can: true, how: 'I can control Spotify - play, pause, skip, volume, search' },
            'calendar': { can: true, how: 'Ask "what\'s on my calendar?" or "schedule a meeting"' },
            'email': { can: true, how: 'Say "check my email" or "send an email to [person]"' },
            'gmail': { can: true, how: 'I can read, search, and send emails via Gmail' },
            'text': { can: true, how: 'Say "text [contact] [message]" - add contacts first!' },
            'sms': { can: true, how: 'I can send SMS via Twilio. Add contacts with "add contact"' },
            'timer': { can: true, how: 'Say "set a timer for X minutes"' },
            'reminder': { can: true, how: 'Say "remind me to [task] at [time]"' },
            'alarm': { can: true, how: 'Say "set an alarm for [time]"' },
            'weather': { can: true, how: 'Ask "what\'s the weather?"' },
            'light': { can: true, how: 'Say "turn on/off [room] lights" (requires Home Assistant)' },
            'search': { can: true, how: 'Just ask any question - "who won the super bowl?"' },
            'app': { can: true, how: 'Say "open [app name]" or "close [app]"' },
            'goal': { can: true, how: 'Tell me what you want to achieve - "I want to learn Spanish"' },
            'list': { can: true, how: 'Say "add [item] to my [list name] list"' },
            'note': { can: true, how: 'Say "create a note called [title]" or "add to my notes"' },
            'call': { can: false, how: 'I can\'t make phone calls yet, but I can send texts!' },
            'photo': { can: false, how: 'I can\'t access photos yet.' },
            'video': { can: false, how: 'I can\'t play videos, but I can control Spotify!' },
          };
          
          // Check for matches
          for (const [keyword, info] of Object.entries(keywordMap)) {
            if (queryLower.includes(keyword)) {
              output = { query, canDo: info.can, howTo: info.how };
              message = info.can 
                ? `Yes! ${info.how}`
                : `Not yet - ${info.how}`;
              break;
            }
          }
          
          // Default response
          if (!output) {
            output = { query, canDo: 'maybe', howTo: 'Try asking!' };
            message = `I'm not sure about "${query}" specifically, but try asking and I'll do my best! Say "what can you do?" for a full list.`;
          }
          break;
        }

        case 'getStatus': {
          // Check which services are configured
          const services = {
            spotify: !!process.env.SPOTIFY_CLIENT_ID,
            google: !!process.env.GOOGLE_CLIENT_ID,
            homeAssistant: !!process.env.HOME_ASSISTANT_URL,
            twilio: !!process.env.TWILIO_ACCOUNT_SID,
            elevenLabs: !!process.env.ELEVENLABS_API_KEY,
            openAI: !!process.env.OPENAI_API_KEY,
            lmStudio: !!process.env.LLM_BASE_URL,
          };
          
          const allCaps = executorRegistry.getAllCapabilities();
          
          output = {
            status: 'online',
            services,
            totalCapabilities: allCaps.length,
          };
          
          message = `🟢 **JARVIS Status: Online**\n\n`;
          message += `**Connected Services:**\n`;
          message += `• LLM: ${services.openAI ? 'OpenAI ✓' : services.lmStudio ? 'LM Studio ✓' : '❌'}\n`;
          message += `• Voice: ${services.elevenLabs ? 'ElevenLabs ✓' : '❌'}\n`;
          message += `• Music: ${services.spotify ? 'Spotify ✓' : '❌'}\n`;
          message += `• Calendar/Email: ${services.google ? 'Google ✓' : '❌'}\n`;
          message += `• Smart Home: ${services.homeAssistant ? 'Home Assistant ✓' : '❌'}\n`;
          message += `• SMS: ${services.twilio ? 'Twilio ✓' : '❌'}\n`;
          message += `\n**Total capabilities:** ${allCaps.length}`;
          break;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return {
        success: true,
        output,
        message,
        sideEffects: [],
        meta: {
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };

    } catch (error: any) {
      logger.error('Self-knowledge execution failed', { toolName, error: error.message });
      
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects: [],
        error: {
          code: 'SELF_KNOWLEDGE_ERROR',
          message: error.message,
          recoverable: true,
        },
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

  async simulate(toolName: string, params: Record<string, any>) {
    return {
      wouldSucceed: true,
      predictedOutput: { simulated: true },
      predictedSideEffects: [],
      warnings: [],
    };
  }

  validate(toolName: string, params: Record<string, any>) {
    const capability = this.getCapabilities().find(c => c.name === toolName);
    if (!capability) {
      return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    }
    
    const result = capability.schema.safeParse(params);
    if (!result.success) {
      return { 
        valid: false, 
        errors: result.error.issues.map(i => i.message),
      };
    }
    
    return { valid: true, sanitizedParams: result.data };
  }

  canExecute(toolName: string): boolean {
    return this.getCapabilities().some(c => c.name === toolName);
  }
}

export const selfKnowledgeExecutor = new SelfKnowledgeExecutor();
