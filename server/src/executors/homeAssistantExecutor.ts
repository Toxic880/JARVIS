/**
 * Home Assistant Executor
 * 
 * Real device control through Home Assistant API.
 * Handles lights, switches, climate, media, scenes.
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
// HOME ASSISTANT CLIENT
// =============================================================================

interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

class HomeAssistantClient {
  private baseUrl: string;
  private token: string;
  private stateCache: Map<string, HAState> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor() {
    this.baseUrl = process.env.HOME_ASSISTANT_URL || '';
    this.token = process.env.HOME_ASSISTANT_TOKEN || '';
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.token);
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('Home Assistant not configured');
    }

    const response = await fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Home Assistant error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async getState(entityId: string): Promise<HAState | null> {
    // Check cache
    const cached = this.stateCache.get(entityId);
    const expiry = this.cacheExpiry.get(entityId);
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    try {
      const state = await this.request(`/states/${entityId}`);
      this.stateCache.set(entityId, state);
      this.cacheExpiry.set(entityId, Date.now() + this.CACHE_TTL);
      return state;
    } catch (error) {
      logger.error('Failed to get HA state', { entityId, error });
      return null;
    }
  }

  async getAllStates(): Promise<HAState[]> {
    try {
      return await this.request('/states');
    } catch (error) {
      logger.error('Failed to get all HA states', { error });
      return [];
    }
  }

  async callService(domain: string, service: string, data: Record<string, any>): Promise<HAState[]> {
    const result = await this.request(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    // Invalidate cache for affected entities
    if (data.entity_id) {
      const entities = Array.isArray(data.entity_id) ? data.entity_id : [data.entity_id];
      for (const entity of entities) {
        this.stateCache.delete(entity);
        this.cacheExpiry.delete(entity);
      }
    }
    
    return result;
  }

  async turnOn(entityId: string, attributes?: Record<string, any>): Promise<HAState[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_on', { entity_id: entityId, ...attributes });
  }

  async turnOff(entityId: string): Promise<HAState[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_off', { entity_id: entityId });
  }

  async toggle(entityId: string): Promise<HAState[]> {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'toggle', { entity_id: entityId });
  }

  async activateScene(sceneId: string): Promise<HAState[]> {
    return this.callService('scene', 'turn_on', { entity_id: sceneId });
  }
}

const haClient = new HomeAssistantClient();

// =============================================================================
// BLOCKED SERVICES (security)
// =============================================================================

const BLOCKED_SERVICES = [
  'shell_command',
  'script',
  'automation.trigger',
  'homeassistant.restart',
  'homeassistant.stop',
  'persistent_notification',
  'notify',
];

const BLOCKED_DOMAINS = [
  'shell_command',
  'script',
  'automation',
  'input_boolean',
  'input_number',
  'input_select',
  'input_text',
];

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class HomeAssistantExecutor implements IToolExecutor {
  readonly id = 'home-assistant-executor';
  readonly name = 'Home Assistant Executor';
  readonly category = 'smart_home';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'controlDevice',
        description: 'Control a smart home device (lights, switches, etc.)',
        schema: z.object({
          device: z.string().max(100),
          action: z.enum(['turn_on', 'turn_off', 'toggle', 'set']),
          brightness: z.number().min(0).max(100).optional(),
          color: z.string().optional(),
          temperature: z.number().optional(),
        }),
        riskLevel: 'medium',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: ['home_assistant'],
        supportsSimulation: true,
      },
      {
        name: 'getDeviceState',
        description: 'Get current state of a device',
        schema: z.object({
          device: z.string().max(100),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['home_assistant'],
        supportsSimulation: true,
      },
      {
        name: 'getAllDevices',
        description: 'Get all smart home devices and their states',
        schema: z.object({
          domain: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: ['home_assistant'],
        supportsSimulation: true,
      },
      {
        name: 'activateScene',
        description: 'Activate a Home Assistant scene',
        schema: z.object({
          scene: z.string().max(100),
        }),
        riskLevel: 'medium',
        reversible: false,
        externalImpact: true,
        blastRadius: 'network',
        requiredPermissions: ['home_assistant'],
        supportsSimulation: true,
      },
      {
        name: 'setClimate',
        description: 'Set thermostat/climate settings',
        schema: z.object({
          device: z.string(),
          temperature: z.number().min(10).max(35).optional(),
          mode: z.enum(['heat', 'cool', 'auto', 'off']).optional(),
        }),
        riskLevel: 'medium',
        reversible: true,
        externalImpact: true,
        blastRadius: 'device',
        requiredPermissions: ['home_assistant'],
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

    // Security validation
    if (params.device) {
      const domain = params.device.split('.')[0];
      if (BLOCKED_DOMAINS.includes(domain)) {
        return { 
          valid: false, 
          errors: [`Domain "${domain}" is blocked for security reasons`] 
        };
      }
    }

    return { valid: true, sanitizedParams: result.data };
  }

  async simulate(toolName: string, params: Record<string, any>) {
    const predictedSideEffects: ExecutionSideEffect[] = [];
    const warnings: string[] = [];

    if (!haClient.isConfigured()) {
      return {
        wouldSucceed: false,
        predictedOutput: null,
        predictedSideEffects: [],
        warnings: ['Home Assistant is not configured'],
      };
    }

    switch (toolName) {
      case 'controlDevice': {
        const currentState = await haClient.getState(params.device);
        if (!currentState) {
          warnings.push(`Device "${params.device}" not found`);
        } else {
          const newState = params.action === 'toggle' 
            ? (currentState.state === 'on' ? 'off' : 'on')
            : (params.action === 'turn_on' ? 'on' : 'off');
          
          predictedSideEffects.push({
            type: 'device_control',
            target: params.device,
            description: `Will change ${params.device} from "${currentState.state}" to "${newState}"`,
            reversible: true,
            rollbackAction: `controlDevice:${params.device}:${currentState.state === 'on' ? 'turn_on' : 'turn_off'}`,
          });
        }
        break;
      }

      case 'activateScene':
        predictedSideEffects.push({
          type: 'device_control',
          target: params.scene,
          description: `Will activate scene "${params.scene}" (may affect multiple devices)`,
          reversible: false,
        });
        warnings.push('Scene activation affects multiple devices and cannot be directly undone');
        break;

      case 'setClimate':
        predictedSideEffects.push({
          type: 'device_control',
          target: params.device,
          description: `Will set climate to ${params.temperature}°${params.mode ? ` in ${params.mode} mode` : ''}`,
          reversible: true,
        });
        break;
    }

    return {
      wouldSucceed: true,
      predictedOutput: { simulated: true },
      predictedSideEffects,
      warnings,
    };
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();

    if (!haClient.isConfigured()) {
      return {
        success: false,
        output: null,
        message: 'Home Assistant is not configured',
        sideEffects: [],
        error: {
          code: 'NOT_CONFIGURED',
          message: 'Home Assistant URL and token must be set',
          recoverable: false,
        },
        meta: {
          startedAt,
          completedAt: new Date(),
          durationMs: 0,
          executor: this.id,
          sandboxed: false,
        },
      };
    }

    try {
      let output: any;
      let message: string;
      const sideEffects: ExecutionSideEffect[] = [];

      switch (toolName) {
        case 'controlDevice': {
          const previousState = await haClient.getState(params.device);
          
          let result: HAState[];
          switch (params.action) {
            case 'turn_on':
              result = await haClient.turnOn(params.device, {
                brightness_pct: params.brightness,
                color_name: params.color,
              });
              break;
            case 'turn_off':
              result = await haClient.turnOff(params.device);
              break;
            case 'toggle':
              result = await haClient.toggle(params.device);
              break;
            default:
              throw new Error(`Unknown action: ${params.action}`);
          }

          const newState = await haClient.getState(params.device);
          
          output = {
            device: params.device,
            previousState: previousState?.state,
            newState: newState?.state,
            attributes: newState?.attributes,
          };
          message = `${params.device} is now ${newState?.state}`;
          
          sideEffects.push({
            type: 'device_control',
            target: params.device,
            description: `Changed from ${previousState?.state} to ${newState?.state}`,
            reversible: true,
            rollbackAction: previousState?.state === 'on' ? 'turn_on' : 'turn_off',
          });
          break;
        }

        case 'getDeviceState': {
          const state = await haClient.getState(params.device);
          if (!state) {
            throw new Error(`Device "${params.device}" not found`);
          }
          
          output = {
            device: params.device,
            state: state.state,
            attributes: state.attributes,
            lastChanged: state.last_changed,
          };
          message = `${params.device} is ${state.state}`;
          break;
        }

        case 'getAllDevices': {
          const states = await haClient.getAllStates();
          let filtered = states;
          
          if (params.domain) {
            filtered = states.filter(s => s.entity_id.startsWith(`${params.domain}.`));
          }
          
          // Filter out blocked domains
          filtered = filtered.filter(s => {
            const domain = s.entity_id.split('.')[0];
            return !BLOCKED_DOMAINS.includes(domain);
          });

          // Group by domain
          const byDomain: Record<string, any[]> = {};
          for (const state of filtered) {
            const domain = state.entity_id.split('.')[0];
            if (!byDomain[domain]) byDomain[domain] = [];
            byDomain[domain].push({
              entity_id: state.entity_id,
              state: state.state,
              friendly_name: state.attributes.friendly_name,
            });
          }
          
          output = { devices: byDomain, total: filtered.length };
          message = `Found ${filtered.length} devices`;
          break;
        }

        case 'activateScene': {
          const sceneId = params.scene.startsWith('scene.') 
            ? params.scene 
            : `scene.${params.scene}`;
          
          await haClient.activateScene(sceneId);
          
          output = { scene: sceneId, activated: true };
          message = `Activated scene "${params.scene}"`;
          
          sideEffects.push({
            type: 'device_control',
            target: sceneId,
            description: 'Scene activated (multiple devices affected)',
            reversible: false,
          });
          break;
        }

        case 'setClimate': {
          const previousState = await haClient.getState(params.device);
          
          const serviceData: Record<string, any> = { entity_id: params.device };
          if (params.temperature !== undefined) {
            serviceData.temperature = params.temperature;
          }
          if (params.mode) {
            serviceData.hvac_mode = params.mode;
          }
          
          await haClient.callService('climate', 'set_temperature', serviceData);
          if (params.mode) {
            await haClient.callService('climate', 'set_hvac_mode', {
              entity_id: params.device,
              hvac_mode: params.mode,
            });
          }
          
          const newState = await haClient.getState(params.device);
          
          output = {
            device: params.device,
            previousTemp: previousState?.attributes?.temperature,
            newTemp: params.temperature,
            mode: params.mode || newState?.state,
          };
          message = `Climate set to ${params.temperature}°`;
          
          sideEffects.push({
            type: 'device_control',
            target: params.device,
            description: `Temperature set to ${params.temperature}°`,
            reversible: true,
          });
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
        sideEffects,
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
      logger.error('Home Assistant execution failed', { toolName, params, error });
      
      return {
        success: false,
        output: null,
        message: error instanceof Error ? error.message : 'Execution failed',
        sideEffects: [],
        error: {
          code: 'HA_ERROR',
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
}
