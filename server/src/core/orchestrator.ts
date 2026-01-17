/**
 * JARVIS Orchestrator
 * 
 * The spine that connects perception, cognition, and action.
 * 
 * Three independent loops:
 * 1. PERCEPTION - Updates world state continuously
 * 2. COGNITION - Evaluates goals, memory, silence, decides whether to act
 * 3. ACTION - Executes when authorized, records outcomes
 * 
 * Flow:
 *   Perception → State → Memory
 *              ↓
 *   Cognition (goals + decay + silence)
 *              ↓
 *   Simulation (if risk ≥ medium)
 *              ↓
 *   Execution → Side Effects → Learning
 */

import { EventEmitter } from 'events';
import { logger, auditLog } from '../services/logger';

// Import singletons
import { perceptionAgent, PerceptionSnapshot } from './nativePerception';
import { snapshotManager, StateChange } from './stateSnapshots';
import { memoryManager } from './memoryWithDecay';
import { goalManager, Goal } from './goalTracker';
import { interruptionManager } from './interruptionManager';
import { trustSignals } from './trustSignals';
import { selfKnowledge } from './selfKnowledge';
import { preferenceManager } from './userPreferences';
import { actionSimulator, SimulationReport } from './actionSimulator';
import { executorRegistry, ExecutionResult } from '../executors/interface';

// =============================================================================
// TYPES
// =============================================================================

export interface OrchestratorIntent {
  id: string;
  userId: string;
  toolName: string;
  params: Record<string, any>;
  source: 'user' | 'goal' | 'proactive';
  priority: number;
  createdAt: Date;
  expiresAt?: Date;
  requiresSimulation: boolean;
  requiresConfirmation: boolean;
}

export interface ActionOutcome {
  intent: OrchestratorIntent;
  simulation?: SimulationReport;
  result?: ExecutionResult;
  stateChanges?: StateChange[];
  learned?: string[];
}

export type OrchestratorState = 'stopped' | 'starting' | 'running' | 'paused' | 'stopping';

export interface LoopHealth {
  perception: { running: boolean; lastTick: Date | null; tickCount: number; errors: number };
  cognition: { running: boolean; lastTick: Date | null; tickCount: number; errors: number };
  action: { running: boolean; lastTick: Date | null; tickCount: number; errors: number };
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export class JarvisOrchestrator extends EventEmitter {
  private state: OrchestratorState = 'stopped';
  private userId: string = 'default';
  
  // Loop intervals (ms)
  private readonly PERCEPTION_INTERVAL = 500;
  private readonly COGNITION_INTERVAL = 1000;
  private readonly ACTION_INTERVAL = 100;
  
  // Loop handles
  private perceptionLoop: NodeJS.Timeout | null = null;
  private cognitionLoop: NodeJS.Timeout | null = null;
  private actionLoop: NodeJS.Timeout | null = null;
  
  // Queues
  private intentQueue: OrchestratorIntent[] = [];
  private pendingConfirmations: Map<string, OrchestratorIntent> = new Map();
  
  // Health
  private health: LoopHealth = {
    perception: { running: false, lastTick: null, tickCount: 0, errors: 0 },
    cognition: { running: false, lastTick: null, tickCount: 0, errors: 0 },
    action: { running: false, lastTick: null, tickCount: 0, errors: 0 },
  };
  
  // Last perception
  private lastPerception: PerceptionSnapshot | null = null;

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  async start(userId: string): Promise<void> {
    if (this.state === 'running') return;
    
    this.state = 'starting';
    this.userId = userId;
    
    logger.info('Starting JARVIS orchestrator', { userId });
    
    perceptionAgent.start();
    
    // Take initial snapshot
    snapshotManager.createSnapshot({}, { type: 'system', description: 'orchestrator_start' });
    
    // Start loops
    this.startPerceptionLoop();
    this.startCognitionLoop();
    this.startActionLoop();
    
    this.state = 'running';
    auditLog('ORCHESTRATOR_START', { userId });
    this.emit('started', { userId });
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    
    this.state = 'stopping';
    logger.info('Stopping JARVIS orchestrator');
    
    if (this.perceptionLoop) clearInterval(this.perceptionLoop);
    if (this.cognitionLoop) clearInterval(this.cognitionLoop);
    if (this.actionLoop) clearInterval(this.actionLoop);
    
    this.perceptionLoop = null;
    this.cognitionLoop = null;
    this.actionLoop = null;
    
    perceptionAgent.stop();
    
    this.health.perception.running = false;
    this.health.cognition.running = false;
    this.health.action.running = false;
    
    this.state = 'stopped';
    auditLog('ORCHESTRATOR_STOP', { userId: this.userId });
    this.emit('stopped');
  }

  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emit('paused');
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.state = 'running';
      this.emit('resumed');
    }
  }

  // =========================================================================
  // PERCEPTION LOOP
  // =========================================================================

  private startPerceptionLoop(): void {
    this.health.perception.running = true;
    
    this.perceptionLoop = setInterval(() => {
      this.tickPerception();
    }, this.PERCEPTION_INTERVAL);
    
    this.tickPerception();
  }

  private tickPerception(): void {
    if (this.state !== 'running') return;
    
    try {
      this.lastPerception = perceptionAgent.getSnapshot();
      
      // Record in memory if user is active
      if (this.lastPerception.window) {
        memoryManager.remember(this.userId, 
          `User focused on ${this.lastPerception.window.app}: ${this.lastPerception.window.title}`,
          { type: 'ephemeral', category: 'context' }
        );
      }
      
      this.health.perception.lastTick = new Date();
      this.health.perception.tickCount++;
    } catch (error) {
      this.health.perception.errors++;
      logger.error('Perception tick error', { error });
    }
  }

  // =========================================================================
  // COGNITION LOOP
  // =========================================================================

  private startCognitionLoop(): void {
    this.health.cognition.running = true;
    
    this.cognitionLoop = setInterval(() => {
      this.tickCognition();
    }, this.COGNITION_INTERVAL);
  }

  private async tickCognition(): Promise<void> {
    if (this.state !== 'running') return;
    
    try {
      // Apply decay
      await goalManager.applyDecay();
      await memoryManager.applyDecay();
      
      // Check proactive opportunities
      await this.checkProactiveActions();
      
      this.health.cognition.lastTick = new Date();
      this.health.cognition.tickCount++;
    } catch (error) {
      this.health.cognition.errors++;
      logger.error('Cognition tick error', { error });
    }
  }

  private async checkProactiveActions(): Promise<void> {
    const prefs = preferenceManager.getPreferences(this.userId);
    
    if (!prefs.autonomy.enabled || prefs.communication.proactivity === 'reactive') {
      return;
    }
    
    const goals = await goalManager.getActiveGoals(this.userId);
    
    for (const goal of goals) {
      if (goal.nextActions.length > 0) {
        const action = goal.nextActions[0];
        const capability = executorRegistry.getCapability(action);
        
        if (capability) {
          const autoApprove = preferenceManager.shouldAutoApprove(this.userId, {
            riskLevel: capability.riskLevel,
            hasExternalImpact: capability.externalImpact,
            isReversible: capability.reversible,
          });
          
          if (autoApprove.approved) {
            this.queueIntent({
              id: `intent_${Date.now()}`,
              userId: this.userId,
              toolName: action,
              params: {},
              source: 'goal',
              priority: 5,
              createdAt: new Date(),
              requiresSimulation: capability.riskLevel !== 'none' && capability.riskLevel !== 'low',
              requiresConfirmation: false,
            });
          }
        }
      }
    }
  }

  // =========================================================================
  // ACTION LOOP
  // =========================================================================

  private startActionLoop(): void {
    this.health.action.running = true;
    
    this.actionLoop = setInterval(() => {
      this.tickAction();
    }, this.ACTION_INTERVAL);
  }

  private async tickAction(): Promise<void> {
    if (this.state !== 'running' || this.intentQueue.length === 0) return;
    
    try {
      const intent = this.intentQueue.shift()!;
      
      if (intent.expiresAt && intent.expiresAt < new Date()) {
        return;
      }
      
      const outcome = await this.processIntent(intent);
      this.emit('actionComplete', outcome);
      
      this.health.action.lastTick = new Date();
      this.health.action.tickCount++;
    } catch (error) {
      this.health.action.errors++;
      logger.error('Action tick error', { error });
    }
  }

  private async processIntent(intent: OrchestratorIntent): Promise<ActionOutcome> {
    const outcome: ActionOutcome = { intent };
    
    // Before snapshot
    snapshotManager.createSnapshot({}, {
      type: 'action',
      actionId: intent.id,
      description: `before_${intent.toolName}`,
    });
    
    // Start activity indicator
    const activityId = `activity_${intent.id}`;
    trustSignals.startActivity(activityId, 'action_execute', `Executing ${intent.toolName}`);
    
    // Simulate if needed
    if (intent.requiresSimulation) {
      const simulation = await actionSimulator.simulate(intent.toolName, intent.params);
      outcome.simulation = simulation;
      
      if (simulation.recommendation === 'abort') {
        trustSignals.stopActivity(activityId);
        return outcome;
      }
      
      if (intent.requiresConfirmation || simulation.recommendation === 'reconsider') {
        this.pendingConfirmations.set(intent.id, intent);
        this.emit('confirmationRequired', { intent, simulation });
        return outcome;
      }
    }
    
    // Execute
    try {
      const result = await executorRegistry.execute(intent.toolName, intent.params);
      outcome.result = result;
      
      // Record action
      trustSignals.recordAction(this.userId, intent.toolName, intent.params, {
        initiatedBy: intent.source === 'user' ? 'user' : 'jarvis',
      });
      
      // After snapshot
      snapshotManager.createSnapshot({}, {
        type: 'action',
        actionId: intent.id,
        description: `after_${intent.toolName}`,
      });
      
      // Learn from success
      if (result.success) {
        await memoryManager.remember(this.userId,
          `Successfully executed ${intent.toolName}`,
          { type: 'working', category: 'context' }
        );
        outcome.learned = [`${intent.toolName} succeeded`];
      }
      
    } catch (error) {
      logger.error('Execution failed', { intentId: intent.id, error });
      outcome.result = {
        success: false,
        output: null,
        message: 'Execution failed',
        sideEffects: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
        meta: {
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
          executor: 'orchestrator',
          sandboxed: false,
        },
      };
    }
    
    trustSignals.stopActivity(activityId);
    return outcome;
  }

  // =========================================================================
  // EXTERNAL API
  // =========================================================================

  async submitRequest(
    toolName: string,
    params: Record<string, any>,
    options: { immediate?: boolean; priority?: number } = {}
  ): Promise<string> {
    const capability = executorRegistry.getCapability(toolName);
    if (!capability) throw new Error(`Unknown tool: ${toolName}`);
    
    const autoApprove = preferenceManager.shouldAutoApprove(this.userId, {
      riskLevel: capability.riskLevel,
      hasExternalImpact: capability.externalImpact,
      isReversible: capability.reversible,
    });
    
    const intent: OrchestratorIntent = {
      id: `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: this.userId,
      toolName,
      params,
      source: 'user',
      priority: options.priority ?? 5,
      createdAt: new Date(),
      requiresSimulation: capability.riskLevel !== 'none' && capability.riskLevel !== 'low',
      requiresConfirmation: !autoApprove.approved && !options.immediate,
    };
    
    if (options.immediate) {
      const outcome = await this.processIntent(intent);
      this.emit('actionComplete', outcome);
    } else {
      this.queueIntent(intent);
    }
    
    return intent.id;
  }

  async confirmAction(intentId: string): Promise<ActionOutcome | null> {
    const intent = this.pendingConfirmations.get(intentId);
    if (!intent) return null;
    
    this.pendingConfirmations.delete(intentId);
    intent.requiresConfirmation = false;
    return this.processIntent(intent);
  }

  rejectAction(intentId: string, reason?: string): void {
    const intent = this.pendingConfirmations.get(intentId);
    if (intent) {
      this.pendingConfirmations.delete(intentId);
      memoryManager.remember(this.userId, `Rejected action: ${intent.toolName} - ${reason}`, {
        type: 'working',
        category: 'context',
      });
      this.emit('actionRejected', { intent, reason });
    }
  }

  async createGoal(description: string, options: { priority?: number; steps?: string[] } = {}): Promise<string> {
    const priorityMap: Record<number, 'low' | 'medium' | 'high' | 'critical'> = {
      1: 'low', 2: 'low', 3: 'low',
      4: 'medium', 5: 'medium', 6: 'medium',
      7: 'high', 8: 'high',
      9: 'critical', 10: 'critical',
    };
    
    const goal = await goalManager.createGoal(this.userId, description, {
      priority: priorityMap[options.priority ?? 5] || 'medium',
      nextActions: options.steps,
    });
    
    return goal.id;
  }

  getStatus(): {
    state: OrchestratorState;
    health: LoopHealth;
    queueDepth: number;
    pendingConfirmations: number;
    perception: PerceptionSnapshot | null;
  } {
    return {
      state: this.state,
      health: this.health,
      queueDepth: this.intentQueue.length,
      pendingConfirmations: this.pendingConfirmations.size,
      perception: this.lastPerception,
    };
  }

  getSelfKnowledge(): { capabilities: any[]; system: any } {
    return {
      capabilities: selfKnowledge.getCapabilities(),
      system: selfKnowledge.getSystemState(),
    };
  }

  private queueIntent(intent: OrchestratorIntent): void {
    const idx = this.intentQueue.findIndex(i => i.priority < intent.priority);
    if (idx === -1) {
      this.intentQueue.push(intent);
    } else {
      this.intentQueue.splice(idx, 0, intent);
    }
    this.emit('intentQueued', intent);
  }
}

export const orchestrator = new JarvisOrchestrator();
