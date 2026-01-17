/**
 * Action Simulation / Dry-Run
 * 
 * Before risky actions:
 * 1. Simulate
 * 2. Explain outcome
 * 3. Then ask permission
 * 
 * This feels very Jarvis and builds trust.
 */

import { logger, auditLog } from '../services/logger';
import { executorRegistry, ToolCapability, ExecutionSideEffect } from '../executors/interface';
import { snapshotManager, StateDiff } from './stateSnapshots';

// =============================================================================
// SIMULATION TYPES
// =============================================================================

export interface SimulationResult {
  // Would the action succeed?
  wouldSucceed: boolean;
  // Predicted output
  predictedOutput: any;
  // What would change
  predictedEffects: ExecutionSideEffect[];
  // State changes (diffs)
  stateDiffs: StateDiff[];
  // Warnings about the action
  warnings: string[];
  // Risk assessment
  risk: {
    level: 'none' | 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    mitigations: string[];
  };
  // Can this be undone?
  reversibility: {
    reversible: boolean;
    rollbackMethod?: string;
    dataLoss: boolean;
  };
  // Time estimate
  estimatedDuration: {
    min: number;
    max: number;
    unit: 'ms' | 's' | 'm';
  };
  // Confidence in prediction
  confidence: number;
}

export interface SimulationReport {
  action: string;
  params: Record<string, any>;
  simulation: SimulationResult;
  // Human-readable summary
  summary: string;
  // Detailed explanation
  explanation: string[];
  // Recommendation
  recommendation: 'proceed' | 'caution' | 'reconsider' | 'abort';
  // Questions for user
  clarifyingQuestions?: string[];
}

// =============================================================================
// ACTION SIMULATOR
// =============================================================================

export class ActionSimulator {
  /**
   * Simulate an action before execution
   */
  async simulate(
    action: string,
    params: Record<string, any>,
    currentState?: Record<string, any>
  ): Promise<SimulationReport> {
    const startTime = Date.now();
    
    // Get capability info
    const capability = executorRegistry.getCapability(action);
    const executor = executorRegistry.getExecutor(action);
    
    if (!executor || !capability) {
      return this.buildUnknownActionReport(action, params);
    }

    // Run executor's simulation
    let executorSimulation = {
      wouldSucceed: true,
      predictedOutput: null,
      predictedSideEffects: [] as ExecutionSideEffect[],
      warnings: [] as string[],
    };

    if (capability.supportsSimulation) {
      try {
        executorSimulation = await executor.simulate(action, params);
      } catch (error) {
        executorSimulation.wouldSucceed = false;
        executorSimulation.warnings.push(`Simulation error: ${error}`);
      }
    }

    // Analyze risk
    const risk = this.analyzeRisk(capability, params, executorSimulation);
    
    // Analyze reversibility
    const reversibility = this.analyzeReversibility(capability, executorSimulation.predictedSideEffects);
    
    // Predict state changes
    const stateDiffs = this.predictStateDiffs(action, params, currentState);
    
    // Estimate duration
    const estimatedDuration = this.estimateDuration(action, capability);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(capability, executorSimulation);

    const simulation: SimulationResult = {
      wouldSucceed: executorSimulation.wouldSucceed,
      predictedOutput: executorSimulation.predictedOutput,
      predictedEffects: executorSimulation.predictedSideEffects,
      stateDiffs,
      warnings: executorSimulation.warnings,
      risk,
      reversibility,
      estimatedDuration,
      confidence,
    };

    // Build report
    const report = this.buildReport(action, params, simulation, capability);
    
    auditLog('ACTION_SIMULATED', {
      action,
      wouldSucceed: simulation.wouldSucceed,
      riskLevel: simulation.risk.level,
      recommendation: report.recommendation,
      durationMs: Date.now() - startTime,
    });

    return report;
  }

  /**
   * Analyze risk factors
   */
  private analyzeRisk(
    capability: ToolCapability,
    params: Record<string, any>,
    simulation: { warnings: string[] }
  ): SimulationResult['risk'] {
    const factors: string[] = [];
    const mitigations: string[] = [];
    
    // Base risk from capability
    let level = capability.riskLevel;
    
    // External impact
    if (capability.externalImpact) {
      factors.push('Affects external systems');
      mitigations.push('Verify external system state first');
    }
    
    // Blast radius
    if (capability.blastRadius === 'network') {
      factors.push('May affect multiple network devices');
      mitigations.push('Consider limiting scope');
    } else if (capability.blastRadius === 'external') {
      factors.push('Affects systems outside your control');
      level = this.escalateRisk(level);
    }
    
    // Reversibility
    if (!capability.reversible) {
      factors.push('Cannot be undone');
      mitigations.push('Double-check parameters before proceeding');
    }
    
    // Warnings from simulation
    if (simulation.warnings.length > 0) {
      factors.push(...simulation.warnings);
    }
    
    // Check for dangerous parameter patterns
    const paramStr = JSON.stringify(params).toLowerCase();
    if (paramStr.includes('delete') || paramStr.includes('remove all')) {
      factors.push('Destructive operation detected');
      level = this.escalateRisk(level);
    }
    
    return { level, factors, mitigations };
  }

  /**
   * Analyze reversibility
   */
  private analyzeReversibility(
    capability: ToolCapability,
    effects: ExecutionSideEffect[]
  ): SimulationResult['reversibility'] {
    const reversibleEffects = effects.filter(e => e.reversible);
    const irreversibleEffects = effects.filter(e => !e.reversible);
    
    const reversible = capability.reversible && irreversibleEffects.length === 0;
    
    let rollbackMethod: string | undefined;
    if (reversible && reversibleEffects.length > 0) {
      rollbackMethod = reversibleEffects
        .map(e => e.rollbackAction)
        .filter(Boolean)
        .join(', ');
    }
    
    const dataLoss = irreversibleEffects.some(e => 
      e.description.toLowerCase().includes('delete') ||
      e.description.toLowerCase().includes('remove') ||
      e.description.toLowerCase().includes('clear')
    );
    
    return { reversible, rollbackMethod, dataLoss };
  }

  /**
   * Predict state diffs
   */
  private predictStateDiffs(
    action: string,
    params: Record<string, any>,
    currentState?: Record<string, any>
  ): StateDiff[] {
    const diffs: StateDiff[] = [];
    
    // Simple heuristic-based prediction
    // In production, this would use more sophisticated prediction
    
    if (action.includes('set') || action.includes('update')) {
      for (const [key, value] of Object.entries(params)) {
        diffs.push({
          path: [action.replace(/^(set|update)/, '').toLowerCase(), key],
          before: currentState?.[key] ?? 'unknown',
          after: value,
          changeType: 'modified',
        });
      }
    }
    
    if (action.includes('create') || action.includes('add')) {
      diffs.push({
        path: [action.replace(/^(create|add)/, '').toLowerCase()],
        before: undefined,
        after: params,
        changeType: 'added',
      });
    }
    
    if (action.includes('delete') || action.includes('remove')) {
      diffs.push({
        path: [action.replace(/^(delete|remove)/, '').toLowerCase()],
        before: 'existing item',
        after: undefined,
        changeType: 'removed',
      });
    }
    
    return diffs;
  }

  /**
   * Estimate execution duration
   */
  private estimateDuration(
    action: string,
    capability: ToolCapability
  ): SimulationResult['estimatedDuration'] {
    // Heuristic estimates
    const actionLower = action.toLowerCase();
    
    // Instant actions
    if (['getTime', 'getDate', 'getMode'].includes(action)) {
      return { min: 1, max: 10, unit: 'ms' };
    }
    
    // Fast actions
    if (actionLower.includes('get') || actionLower.includes('list')) {
      return { min: 10, max: 100, unit: 'ms' };
    }
    
    // Network actions
    if (capability.externalImpact || capability.blastRadius !== 'local') {
      return { min: 100, max: 2000, unit: 'ms' };
    }
    
    // Default
    return { min: 50, max: 500, unit: 'ms' };
  }

  /**
   * Calculate confidence in simulation
   */
  private calculateConfidence(
    capability: ToolCapability,
    simulation: { wouldSucceed: boolean; warnings: string[] }
  ): number {
    let confidence = 0.8; // Base confidence
    
    // Higher confidence if simulation is supported
    if (capability.supportsSimulation) {
      confidence += 0.1;
    }
    
    // Lower if there are warnings
    confidence -= simulation.warnings.length * 0.1;
    
    // Lower if action has external impact
    if (capability.externalImpact) {
      confidence -= 0.15;
    }
    
    // Lower if not reversible
    if (!capability.reversible) {
      confidence -= 0.1;
    }
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  /**
   * Escalate risk level
   */
  private escalateRisk(level: string): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    const levels = ['none', 'low', 'medium', 'high', 'critical'];
    const currentIndex = levels.indexOf(level);
    const newIndex = Math.min(currentIndex + 1, levels.length - 1);
    return levels[newIndex] as any;
  }

  /**
   * Build simulation report
   */
  private buildReport(
    action: string,
    params: Record<string, any>,
    simulation: SimulationResult,
    capability: ToolCapability
  ): SimulationReport {
    const explanation: string[] = [];
    const clarifyingQuestions: string[] = [];
    
    // Build explanation
    if (simulation.wouldSucceed) {
      explanation.push(`This action should succeed.`);
    } else {
      explanation.push(`This action may fail.`);
    }
    
    if (simulation.predictedEffects.length > 0) {
      explanation.push(`Effects: ${simulation.predictedEffects.map(e => e.description).join('; ')}`);
    }
    
    if (simulation.risk.factors.length > 0) {
      explanation.push(`Risk factors: ${simulation.risk.factors.join(', ')}`);
    }
    
    if (simulation.reversibility.reversible) {
      explanation.push(`This can be undone${simulation.reversibility.rollbackMethod ? ` via ${simulation.reversibility.rollbackMethod}` : ''}.`);
    } else {
      explanation.push(`⚠️ This cannot be undone.`);
    }
    
    if (simulation.reversibility.dataLoss) {
      explanation.push(`⚠️ This may result in data loss.`);
    }
    
    // Determine recommendation
    let recommendation: SimulationReport['recommendation'] = 'proceed';
    
    if (simulation.risk.level === 'critical') {
      recommendation = 'abort';
      clarifyingQuestions.push('Are you absolutely sure you want to proceed with this high-risk action?');
    } else if (simulation.risk.level === 'high') {
      recommendation = 'reconsider';
      clarifyingQuestions.push('This is a high-risk action. Can you confirm the parameters are correct?');
    } else if (simulation.risk.level === 'medium' || !simulation.reversibility.reversible) {
      recommendation = 'caution';
    }
    
    if (!simulation.wouldSucceed) {
      recommendation = 'reconsider';
      clarifyingQuestions.push('The simulation suggests this may fail. Would you like to try different parameters?');
    }
    
    // Build summary
    const summary = this.buildSummary(action, params, simulation, recommendation);
    
    return {
      action,
      params,
      simulation,
      summary,
      explanation,
      recommendation,
      clarifyingQuestions: clarifyingQuestions.length > 0 ? clarifyingQuestions : undefined,
    };
  }

  /**
   * Build human-readable summary
   */
  private buildSummary(
    action: string,
    params: Record<string, any>,
    simulation: SimulationResult,
    recommendation: SimulationReport['recommendation']
  ): string {
    const parts: string[] = [];
    
    // Action description
    parts.push(`I'm about to ${this.humanizeAction(action, params)}.`);
    
    // Effects
    if (simulation.predictedEffects.length > 0) {
      parts.push(`This will ${simulation.predictedEffects.map(e => e.description.toLowerCase()).join(' and ')}.`);
    }
    
    // Risk warning
    if (simulation.risk.level !== 'none' && simulation.risk.level !== 'low') {
      parts.push(`Risk level: ${simulation.risk.level}.`);
    }
    
    // Reversibility
    if (!simulation.reversibility.reversible) {
      parts.push(`Note: This action cannot be undone.`);
    }
    
    // Recommendation
    switch (recommendation) {
      case 'proceed':
        parts.push(`Ready to proceed when you are.`);
        break;
      case 'caution':
        parts.push(`Please confirm you'd like to proceed.`);
        break;
      case 'reconsider':
        parts.push(`I'd recommend reconsidering this action.`);
        break;
      case 'abort':
        parts.push(`I strongly advise against this action.`);
        break;
    }
    
    return parts.join(' ');
  }

  /**
   * Convert action to human-readable description
   */
  private humanizeAction(action: string, params: Record<string, any>): string {
    // Convert camelCase to words
    const words = action.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    
    // Add relevant params
    const paramStr = Object.entries(params)
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${JSON.stringify(v).substring(0, 30)}`)
      .join(', ');
    
    return paramStr ? `${words} (${paramStr})` : words;
  }

  /**
   * Build report for unknown action
   */
  private buildUnknownActionReport(action: string, params: Record<string, any>): SimulationReport {
    return {
      action,
      params,
      simulation: {
        wouldSucceed: false,
        predictedOutput: null,
        predictedEffects: [],
        stateDiffs: [],
        warnings: [`Unknown action: ${action}`],
        risk: {
          level: 'high',
          factors: ['Unknown action cannot be simulated'],
          mitigations: ['Verify the action name is correct'],
        },
        reversibility: {
          reversible: false,
          dataLoss: false,
        },
        estimatedDuration: { min: 0, max: 0, unit: 'ms' },
        confidence: 0,
      },
      summary: `I don't recognize the action "${action}". Please verify this is a valid command.`,
      explanation: ['This action is not registered in my capabilities.'],
      recommendation: 'abort',
      clarifyingQuestions: ['Did you mean a different action?'],
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const actionSimulator = new ActionSimulator();

// =============================================================================
// HELPER: Format simulation for user
// =============================================================================

export function formatSimulationForUser(report: SimulationReport): string {
  const lines: string[] = [];
  
  lines.push(`**Simulation Preview**`);
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  
  if (report.simulation.predictedEffects.length > 0) {
    lines.push('**What will happen:**');
    for (const effect of report.simulation.predictedEffects) {
      const icon = effect.reversible ? '↩️' : '⚠️';
      lines.push(`${icon} ${effect.description}`);
    }
    lines.push('');
  }
  
  if (report.simulation.risk.factors.length > 0) {
    lines.push('**Risk factors:**');
    for (const factor of report.simulation.risk.factors) {
      lines.push(`• ${factor}`);
    }
    lines.push('');
  }
  
  if (report.clarifyingQuestions) {
    for (const q of report.clarifyingQuestions) {
      lines.push(`❓ ${q}`);
    }
  }
  
  return lines.join('\n');
}
