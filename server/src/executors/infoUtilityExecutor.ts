/**
 * Info & Utility Executor
 * 
 * Read-only information tools:
 * - Time/date
 * - Weather
 * - Calculations
 * - System status
 * - Unit conversions
 */

import { z } from 'zod';
import { 
  IToolExecutor, 
  ToolCapability, 
  ExecutionResult, 
  ExecutionSideEffect 
} from './interface';
import { logger } from '../services/logger';

// =============================================================================
// WEATHER API (optional)
// =============================================================================

interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  location: string;
}

async function fetchWeather(location?: string): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const defaultLocation = process.env.DEFAULT_LOCATION || 'London';
  const loc = location || defaultLocation;

  if (!apiKey) {
    // NO FAKE DATA - Return null and let the caller handle it properly
    logger.warn('Weather API not configured - OPENWEATHER_API_KEY not set');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(loc)}&appid=${apiKey}&units=metric`
    );
    
    if (!response.ok) {
      throw new Error('Weather API error');
    }
    
    const data = await response.json() as {
      main: { temp: number; humidity: number };
      weather: { description: string }[];
      wind: { speed: number };
      name: string;
    };
    
    return {
      temperature: Math.round(data.main.temp),
      condition: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6), // m/s to km/h
      location: data.name,
    };
  } catch (error) {
    logger.error('Weather fetch failed', { location: loc, error });
    return null;
  }
}

// =============================================================================
// SAFE MATH EVALUATOR
// =============================================================================

function safeEvaluate(expression: string): number {
  // Only allow safe math operations
  const sanitized = expression
    .replace(/[^0-9+\-*/().%\s^]/g, '')
    .replace(/\^/g, '**'); // Convert ^ to ** for exponentiation
  
  // Check for dangerous patterns
  if (/[a-zA-Z]/.test(sanitized)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Use Function constructor with strict math only
  const mathFn = new Function(`
    'use strict';
    return (${sanitized});
  `);
  
  const result = mathFn();
  
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Invalid result');
  }
  
  return result;
}

// =============================================================================
// UNIT CONVERSIONS
// =============================================================================

const CONVERSIONS: Record<string, Record<string, number>> = {
  // Length
  'm_to_ft': { factor: 3.28084 },
  'ft_to_m': { factor: 0.3048 },
  'km_to_mi': { factor: 0.621371 },
  'mi_to_km': { factor: 1.60934 },
  'cm_to_in': { factor: 0.393701 },
  'in_to_cm': { factor: 2.54 },
  
  // Weight
  'kg_to_lb': { factor: 2.20462 },
  'lb_to_kg': { factor: 0.453592 },
  'g_to_oz': { factor: 0.035274 },
  'oz_to_g': { factor: 28.3495 },
  
  // Temperature (special handling)
  'c_to_f': { factor: 1.8, offset: 32 },
  'f_to_c': { factor: 0.555556, offset: -17.7778 },
  
  // Volume
  'l_to_gal': { factor: 0.264172 },
  'gal_to_l': { factor: 3.78541 },
  'ml_to_floz': { factor: 0.033814 },
  'floz_to_ml': { factor: 29.5735 },
};

function convert(value: number, from: string, to: string): number {
  const key = `${from.toLowerCase()}_to_${to.toLowerCase()}`;
  const conversion = CONVERSIONS[key];
  
  if (!conversion) {
    throw new Error(`Unknown conversion: ${from} to ${to}`);
  }
  
  const result = value * conversion.factor + (conversion.offset || 0);
  return Math.round(result * 1000) / 1000;
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class InfoUtilityExecutor implements IToolExecutor {
  readonly id = 'info-utility-executor';
  readonly name = 'Info & Utility Executor';
  readonly category = 'info';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'getTime',
        description: 'Get current time',
        schema: z.object({
          timezone: z.string().optional(),
          format: z.enum(['12h', '24h']).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getDate',
        description: 'Get current date',
        schema: z.object({
          format: z.enum(['short', 'long', 'iso']).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getWeather',
        description: 'Get current weather conditions',
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
        name: 'calculate',
        description: 'Evaluate a mathematical expression',
        schema: z.object({
          expression: z.string().max(200),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'convert',
        description: 'Convert between units',
        schema: z.object({
          value: z.number(),
          from: z.string().max(20),
          to: z.string().max(20),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getSystemStatus',
        description: 'Get JARVIS system status',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getMode',
        description: 'Get current JARVIS mode',
        schema: z.object({}),
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
    if (!cap) {
      return { valid: false, errors: [`Unknown tool: ${toolName}`] };
    }

    const result = cap.schema.safeParse(params);
    if (!result.success) {
      return { 
        valid: false, 
        errors: result.error.issues.map(i => i.message) 
      };
    }

    return { valid: true, sanitizedParams: result.data };
  }

  async simulate(toolName: string, params: Record<string, any>) {
    // All info tools are safe and read-only
    return {
      wouldSucceed: true,
      predictedOutput: { simulated: true },
      predictedSideEffects: [],
      warnings: [],
    };
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();

    try {
      let output: any;
      let message: string;

      switch (toolName) {
        case 'getTime': {
          const now = new Date();
          let timeString: string;
          
          if (params.timezone) {
            try {
              timeString = now.toLocaleTimeString('en-US', {
                timeZone: params.timezone,
                hour12: params.format !== '24h',
              });
            } catch {
              timeString = now.toLocaleTimeString('en-US', {
                hour12: params.format !== '24h',
              });
            }
          } else {
            timeString = now.toLocaleTimeString('en-US', {
              hour12: params.format !== '24h',
            });
          }
          
          output = {
            time: timeString,
            timestamp: now.getTime(),
            iso: now.toISOString(),
          };
          message = `It's ${timeString}`;
          break;
        }

        case 'getDate': {
          const now = new Date();
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];
          
          let dateString: string;
          switch (params.format) {
            case 'iso':
              dateString = now.toISOString().split('T')[0];
              break;
            case 'short':
              dateString = now.toLocaleDateString('en-US');
              break;
            case 'long':
            default:
              dateString = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
          }
          
          output = {
            date: dateString,
            dayOfWeek: days[now.getDay()],
            day: now.getDate(),
            month: months[now.getMonth()],
            year: now.getFullYear(),
          };
          message = `Today is ${dateString}`;
          break;
        }

        case 'getWeather': {
          const weather = await fetchWeather(params.location);
          
          if (!weather) {
            // Return informative error instead of fake data
            const apiConfigured = !!process.env.OPENWEATHER_API_KEY;
            if (!apiConfigured) {
              return {
                success: false,
                output: null,
                message: 'Weather service not configured. Please set OPENWEATHER_API_KEY in your environment.',
                sideEffects: [],
                error: {
                  code: 'WEATHER_NOT_CONFIGURED',
                  message: 'Weather API key not configured',
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
            throw new Error('Could not fetch weather data - please try again');
          }
          
          output = weather;
          message = `${weather.location}: ${weather.temperature}°C, ${weather.condition}`;
          break;
        }

        case 'calculate': {
          const result = safeEvaluate(params.expression);
          
          output = {
            expression: params.expression,
            result,
          };
          message = `${params.expression} = ${result}`;
          break;
        }

        case 'convert': {
          const result = convert(params.value, params.from, params.to);
          
          output = {
            value: params.value,
            from: params.from,
            to: params.to,
            result,
          };
          message = `${params.value} ${params.from} = ${result} ${params.to}`;
          break;
        }

        case 'getSystemStatus': {
          const uptime = process.uptime();
          const memory = process.memoryUsage();
          
          output = {
            status: 'online',
            uptime: {
              seconds: Math.floor(uptime),
              formatted: this.formatUptime(uptime),
            },
            memory: {
              heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
              heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
              rss: Math.round(memory.rss / 1024 / 1024),
            },
            pipeline: 'v2',
            llmConfigured: !!process.env.LLM_BASE_URL,
            ttsConfigured: !!process.env.ELEVENLABS_API_KEY,
            haConfigured: !!process.env.HOME_ASSISTANT_URL,
          };
          message = `System online. Uptime: ${output.uptime.formatted}`;
          break;
        }

        case 'getMode': {
          // Get from perception layer
          const { perceptionState } = await import('../core/perception');
          
          output = {
            mode: perceptionState.currentMode,
            setAt: perceptionState.modeSetAt?.toISOString(),
          };
          message = `Current mode: ${perceptionState.currentMode}`;
          break;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      const completedAt = new Date();
      
      return {
        success: true,
        output,
        message,
        sideEffects: [],
        meta: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };

    } catch (error) {
      const completedAt = new Date();
      logger.error('Info execution failed', { toolName, params, error });
      
      return {
        success: false,
        output: null,
        message: error instanceof Error ? error.message : 'Execution failed',
        sideEffects: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
        meta: {
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          executor: this.id,
          sandboxed: false,
        },
      };
    }
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);
    
    return parts.join(' ');
  }
}
