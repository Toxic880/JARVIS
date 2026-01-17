/**
 * Plugin-Based Capability System
 * 
 * Each app/device/service = plugin with:
 * - Declared capabilities
 * - Schemas
 * - Risk levels
 * - Confidence requirements
 * 
 * This keeps the system expandable without chaos.
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, executorRegistry } from '../executors/interface';
import { logger, auditLog } from '../services/logger';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// PLUGIN TYPES
// =============================================================================

export interface PluginManifest {
  // Unique identifier
  id: string;
  // Human-readable name
  name: string;
  // Version (semver)
  version: string;
  // Description
  description: string;
  // Author
  author?: string;
  // Plugin category
  category: 'app' | 'device' | 'service' | 'utility' | 'integration';
  // Required permissions
  permissions: string[];
  // Required environment variables
  requiredEnv?: string[];
  // Optional environment variables
  optionalEnv?: string[];
  // Dependencies on other plugins
  dependencies?: string[];
  // Capabilities provided
  capabilities: PluginCapability[];
  // Configuration schema
  configSchema?: z.ZodType<any>;
  // Default configuration
  defaultConfig?: Record<string, any>;
}

export interface PluginCapability {
  name: string;
  description: string;
  // Input parameter schema (as JSON Schema for manifest)
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  // Risk assessment
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  // Requires user confirmation above this confidence
  confirmationThreshold?: number;
  // Can be auto-approved if user has pattern
  supportsAutoApproval?: boolean;
  // Reversibility
  reversible?: boolean;
  // External impact
  externalImpact?: boolean;
}

export type PluginStatus = 
  | 'installed'     // Plugin files present
  | 'configured'    // Required config/env set
  | 'active'        // Running and available
  | 'disabled'      // Explicitly disabled
  | 'error';        // Failed to load/initialize

export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginStatus;
  config: Record<string, any>;
  executor?: IToolExecutor;
  loadedAt?: Date;
  error?: string;
}

// =============================================================================
// PLUGIN REGISTRY
// =============================================================================

class PluginRegistry {
  private plugins: Map<string, PluginInstance> = new Map();
  private pluginDir: string;
  
  constructor(pluginDir = './plugins') {
    this.pluginDir = pluginDir;
  }

  /**
   * Load all plugins from directory
   */
  async loadPlugins(): Promise<void> {
    logger.info('Loading plugins...', { dir: this.pluginDir });
    
    // Ensure plugin directory exists
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true });
      logger.info('Created plugin directory');
      return;
    }
    
    const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await this.loadPlugin(path.join(this.pluginDir, entry.name));
        } catch (error) {
          logger.error('Failed to load plugin', { 
            name: entry.name, 
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    logger.info('Plugins loaded', { count: this.plugins.size });
  }

  /**
   * Load a single plugin
   */
  async loadPlugin(pluginPath: string): Promise<PluginInstance | null> {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    
    if (!fs.existsSync(manifestPath)) {
      logger.warn('No manifest.json found', { path: pluginPath });
      return null;
    }
    
    // Load manifest
    const manifestJson = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestJson) as PluginManifest;
    
    // Validate manifest
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Invalid manifest: missing required fields');
    }
    
    // Check if already loaded
    if (this.plugins.has(manifest.id)) {
      logger.warn('Plugin already loaded', { id: manifest.id });
      return this.plugins.get(manifest.id)!;
    }
    
    // Check dependencies
    if (manifest.dependencies) {
      for (const dep of manifest.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Missing dependency: ${dep}`);
        }
      }
    }
    
    // Check required environment variables
    let configured = true;
    if (manifest.requiredEnv) {
      for (const envVar of manifest.requiredEnv) {
        if (!process.env[envVar]) {
          configured = false;
          logger.warn('Missing required env var', { plugin: manifest.id, envVar });
        }
      }
    }
    
    // Create instance
    const instance: PluginInstance = {
      manifest,
      status: configured ? 'configured' : 'installed',
      config: manifest.defaultConfig || {},
      loadedAt: new Date(),
    };
    
    // Try to load executor if configured
    if (configured) {
      try {
        const executorPath = path.join(pluginPath, 'executor.js');
        if (fs.existsSync(executorPath)) {
          const ExecutorClass = require(executorPath).default;
          instance.executor = new ExecutorClass(instance.config);
          
          // Register with main executor registry
          if (instance.executor) {
            executorRegistry.register(instance.executor);
          }
          
          instance.status = 'active';
        }
      } catch (error) {
        instance.status = 'error';
        instance.error = error instanceof Error ? error.message : 'Failed to load executor';
        logger.error('Failed to load plugin executor', { 
          plugin: manifest.id, 
          error: instance.error 
        });
      }
    }
    
    this.plugins.set(manifest.id, instance);
    
    auditLog('PLUGIN_LOADED', { 
      id: manifest.id, 
      status: instance.status,
      capabilities: manifest.capabilities.length,
    });
    
    return instance;
  }

  /**
   * Register a plugin programmatically (without loading from file)
   */
  registerPlugin(manifest: PluginManifest, executor?: IToolExecutor): PluginInstance {
    const instance: PluginInstance = {
      manifest,
      status: executor ? 'active' : 'configured',
      config: manifest.defaultConfig || {},
      executor,
      loadedAt: new Date(),
    };
    
    if (executor) {
      executorRegistry.register(executor);
    }
    
    this.plugins.set(manifest.id, instance);
    
    auditLog('PLUGIN_REGISTERED', { id: manifest.id });
    
    return instance;
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(id: string): PluginInstance | null {
    return this.plugins.get(id) || null;
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get active plugins
   */
  getActivePlugins(): PluginInstance[] {
    return this.getAllPlugins().filter(p => p.status === 'active');
  }

  /**
   * Get plugins by category
   */
  getPluginsByCategory(category: PluginManifest['category']): PluginInstance[] {
    return this.getAllPlugins().filter(p => p.manifest.category === category);
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    
    if (plugin.status === 'disabled') {
      plugin.status = plugin.executor ? 'active' : 'configured';
      auditLog('PLUGIN_ENABLED', { id });
      return true;
    }
    
    return false;
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    
    if (plugin.status === 'active' || plugin.status === 'configured') {
      plugin.status = 'disabled';
      auditLog('PLUGIN_DISABLED', { id });
      return true;
    }
    
    return false;
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    
    // Note: Would need to remove from executorRegistry too
    this.plugins.delete(id);
    
    auditLog('PLUGIN_UNLOADED', { id });
    return true;
  }

  /**
   * Get all capabilities from all active plugins
   */
  getAllCapabilities(): ToolCapability[] {
    const capabilities: ToolCapability[] = [];
    
    for (const plugin of this.getActivePlugins()) {
      if (plugin.executor) {
        capabilities.push(...plugin.executor.getCapabilities());
      }
    }
    
    return capabilities;
  }

  /**
   * Update plugin configuration
   */
  updateConfig(id: string, config: Record<string, any>): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    
    // Validate against schema if present
    if (plugin.manifest.configSchema) {
      const result = plugin.manifest.configSchema.safeParse(config);
      if (!result.success) {
        logger.error('Invalid plugin config', { id, errors: result.error.issues });
        return false;
      }
    }
    
    plugin.config = { ...plugin.config, ...config };
    
    auditLog('PLUGIN_CONFIG_UPDATED', { id });
    return true;
  }

  /**
   * Get plugin status summary
   */
  getStatusSummary(): Record<PluginStatus, number> {
    const summary: Record<PluginStatus, number> = {
      installed: 0,
      configured: 0,
      active: 0,
      disabled: 0,
      error: 0,
    };
    
    for (const plugin of this.plugins.values()) {
      summary[plugin.status]++;
    }
    
    return summary;
  }
}

// =============================================================================
// BUILT-IN PLUGIN MANIFESTS
// =============================================================================

export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: 'jarvis.timer',
    name: 'Timer & Alarms',
    version: '1.0.0',
    description: 'Set timers, alarms, and reminders',
    category: 'utility',
    permissions: [],
    capabilities: [
      {
        name: 'setTimer',
        description: 'Set a countdown timer',
        parameters: {
          type: 'object',
          properties: {
            duration: { type: 'number', description: 'Duration in seconds' },
            label: { type: 'string', description: 'Optional label' },
          },
          required: ['duration'],
        },
        riskLevel: 'none',
        reversible: true,
        supportsAutoApproval: true,
      },
      {
        name: 'setAlarm',
        description: 'Set an alarm for a specific time',
        parameters: {
          type: 'object',
          properties: {
            time: { type: 'string', description: 'Time in HH:MM format' },
            label: { type: 'string', description: 'Optional label' },
          },
          required: ['time'],
        },
        riskLevel: 'none',
        reversible: true,
        supportsAutoApproval: true,
      },
    ],
  },
  {
    id: 'jarvis.home-assistant',
    name: 'Home Assistant',
    version: '1.0.0',
    description: 'Control smart home devices through Home Assistant',
    category: 'device',
    permissions: ['home_assistant'],
    requiredEnv: ['HOME_ASSISTANT_URL', 'HOME_ASSISTANT_TOKEN'],
    capabilities: [
      {
        name: 'controlDevice',
        description: 'Control a smart home device',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Device entity ID' },
            action: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'] },
          },
          required: ['device', 'action'],
        },
        riskLevel: 'medium',
        reversible: true,
        externalImpact: true,
        confirmationThreshold: 0.8,
      },
    ],
  },
  {
    id: 'jarvis.lists',
    name: 'Lists & Notes',
    version: '1.0.0',
    description: 'Manage lists, notes, and memory',
    category: 'utility',
    permissions: [],
    capabilities: [
      {
        name: 'addToList',
        description: 'Add an item to a list',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string' },
            item: { type: 'string' },
          },
          required: ['listName', 'item'],
        },
        riskLevel: 'low',
        reversible: true,
        supportsAutoApproval: true,
      },
    ],
  },
];

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const pluginRegistry = new PluginRegistry();

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize plugin system with built-in plugins
 */
export async function initializePlugins(): Promise<void> {
  // Register built-in plugins
  for (const manifest of BUILTIN_PLUGINS) {
    pluginRegistry.registerPlugin(manifest);
  }
  
  // Load external plugins
  await pluginRegistry.loadPlugins();
  
  logger.info('Plugin system initialized', pluginRegistry.getStatusSummary());
}
