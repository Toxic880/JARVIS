/**
 * Self-Knowledge & Introspection
 * 
 * Jarvis should know and explain:
 * - What tools it has
 * - What permissions are active
 * - Why it refused or asked
 * - Current state and capabilities
 * 
 * Without this, it feels opaque and untrustworthy.
 */

import { getAllCapabilities, ToolCapability } from '../executors';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// CAPABILITY REGISTRY
// =============================================================================

export interface CapabilityStatus {
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  riskLevel: string;
  lastUsed?: Date;
  useCount: number;
  requiresPermission: string[];
}

export interface PermissionStatus {
  name: string;
  granted: boolean;
  grantedAt?: Date;
  expiresAt?: Date;
  scope: string;
}

export interface SystemState {
  // Overall health
  healthy: boolean;
  uptime: number;
  // Connected services
  services: {
    name: string;
    status: 'online' | 'offline' | 'degraded' | 'not_configured';
    lastCheck?: Date;
  }[];
  // Current mode
  mode: string;
  // Active constraints
  constraints: string[];
}

// =============================================================================
// DECISION TRACKING
// =============================================================================

interface DecisionRecord {
  id: string;
  timestamp: Date;
  type: 'action' | 'refusal' | 'clarification' | 'escalation';
  context: string;
  reasoning: string[];
  factors: Record<string, any>;
  outcome: string;
}

const decisionHistory: DecisionRecord[] = [];
const MAX_DECISION_HISTORY = 100;

// Usage statistics
const usageStats: Map<string, { count: number; lastUsed: Date }> = new Map();

// =============================================================================
// SELF-KNOWLEDGE SYSTEM
// =============================================================================

export class SelfKnowledge {
  /**
   * Get all capabilities with their current status
   */
  getCapabilities(): CapabilityStatus[] {
    const capabilities = getAllCapabilities();
    
    return capabilities.map(cap => {
      const stats = usageStats.get(cap.name);
      
      return {
        name: cap.name,
        description: cap.description,
        enabled: true, // Would check against user permissions
        configured: true, // Would check if required services are configured
        riskLevel: cap.riskLevel,
        lastUsed: stats?.lastUsed,
        useCount: stats?.count || 0,
        requiresPermission: cap.requiredPermissions,
      };
    });
  }

  /**
   * Get capabilities by category
   */
  getCapabilitiesByCategory(): Record<string, CapabilityStatus[]> {
    const capabilities = this.getCapabilities();
    const grouped: Record<string, CapabilityStatus[]> = {};
    
    for (const cap of capabilities) {
      const category = this.inferCategory(cap.name);
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(cap);
    }
    
    return grouped;
  }

  /**
   * Explain what Jarvis can do
   */
  explainCapabilities(): string {
    const byCategory = this.getCapabilitiesByCategory();
    const parts: string[] = ['I can help you with:'];
    
    for (const [category, caps] of Object.entries(byCategory)) {
      const enabled = caps.filter(c => c.enabled);
      if (enabled.length > 0) {
        const names = enabled.slice(0, 5).map(c => c.name);
        const more = enabled.length > 5 ? ` and ${enabled.length - 5} more` : '';
        parts.push(`• **${category}**: ${names.join(', ')}${more}`);
      }
    }
    
    return parts.join('\n');
  }

  /**
   * Get current permissions
   */
  getPermissions(userId: string): PermissionStatus[] {
    // Would integrate with actual permission system
    return [
      {
        name: 'home_assistant',
        granted: !!process.env.HOME_ASSISTANT_URL,
        scope: 'device control',
      },
      {
        name: 'spotify',
        granted: !!process.env.SPOTIFY_CLIENT_ID,
        scope: 'music playback',
      },
      {
        name: 'calendar',
        granted: false,
        scope: 'event management',
      },
      {
        name: 'email',
        granted: false,
        scope: 'send/receive email',
      },
    ];
  }

  /**
   * Get system state
   */
  getSystemState(): SystemState {
    return {
      healthy: true,
      uptime: process.uptime(),
      services: [
        {
          name: 'LLM Backend',
          status: process.env.LLM_BASE_URL ? 'online' : 'not_configured',
        },
        {
          name: 'Home Assistant',
          status: process.env.HOME_ASSISTANT_URL ? 'online' : 'not_configured',
        },
        {
          name: 'Text-to-Speech',
          status: process.env.ELEVENLABS_API_KEY ? 'online' : 'not_configured',
        },
      ],
      mode: 'normal',
      constraints: [],
    };
  }

  /**
   * Record a decision for later explanation
   */
  recordDecision(
    type: DecisionRecord['type'],
    context: string,
    reasoning: string[],
    factors: Record<string, any>,
    outcome: string
  ): string {
    const id = `dec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const record: DecisionRecord = {
      id,
      timestamp: new Date(),
      type,
      context,
      reasoning,
      factors,
      outcome,
    };
    
    decisionHistory.push(record);
    
    // Limit history size
    if (decisionHistory.length > MAX_DECISION_HISTORY) {
      decisionHistory.shift();
    }
    
    return id;
  }

  /**
   * Explain a past decision
   */
  explainDecision(decisionId: string): string | null {
    const decision = decisionHistory.find(d => d.id === decisionId);
    if (!decision) return null;
    
    const parts = [
      `**Decision**: ${decision.outcome}`,
      `**Type**: ${decision.type}`,
      `**Context**: ${decision.context}`,
      '',
      '**Reasoning**:',
      ...decision.reasoning.map(r => `• ${r}`),
    ];
    
    if (Object.keys(decision.factors).length > 0) {
      parts.push('', '**Factors considered**:');
      for (const [key, value] of Object.entries(decision.factors)) {
        parts.push(`• ${key}: ${JSON.stringify(value)}`);
      }
    }
    
    return parts.join('\n');
  }

  /**
   * Explain why an action was refused
   */
  explainRefusal(reason: string, factors: Record<string, any>): string {
    const decisionId = this.recordDecision(
      'refusal',
      'User request was refused',
      [reason],
      factors,
      'Request denied'
    );
    
    // Build explanation
    const parts = [`I can't do that because ${reason.toLowerCase()}.`];
    
    if (factors.riskLevel) {
      parts.push(`This action has a ${factors.riskLevel} risk level.`);
    }
    
    if (factors.missingPermission) {
      parts.push(`I would need ${factors.missingPermission} permission.`);
    }
    
    if (factors.alternative) {
      parts.push(`However, I can ${factors.alternative}.`);
    }
    
    return parts.join(' ');
  }

  /**
   * Explain why clarification is needed
   */
  explainClarification(ambiguity: string, options: string[]): string {
    this.recordDecision(
      'clarification',
      'Clarification requested',
      [`Ambiguous: ${ambiguity}`],
      { options },
      'Asked for clarification'
    );
    
    return `I want to make sure I do the right thing. ${ambiguity}`;
  }

  /**
   * Record tool usage
   */
  recordUsage(toolName: string): void {
    const existing = usageStats.get(toolName) || { count: 0, lastUsed: new Date() };
    usageStats.set(toolName, {
      count: existing.count + 1,
      lastUsed: new Date(),
    });
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit = 10): DecisionRecord[] {
    return decisionHistory.slice(-limit).reverse();
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { tool: string; count: number; lastUsed: Date }[] {
    return Array.from(usageStats.entries())
      .map(([tool, stats]) => ({ tool, ...stats }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Explain current constraints/limitations
   */
  explainLimitations(): string {
    const parts = ['Here are my current limitations:'];
    
    // Check service availability
    if (!process.env.HOME_ASSISTANT_URL) {
      parts.push('• Smart home control is not configured');
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      parts.push('• Voice output is not available');
    }
    if (!process.env.SPOTIFY_CLIENT_ID) {
      parts.push('• Spotify integration is not set up');
    }
    
    // General limitations
    parts.push('• I cannot access the internet for real-time information without web search');
    parts.push('• I cannot execute arbitrary code on your system');
    parts.push('• High-risk actions require your confirmation');
    
    return parts.join('\n');
  }

  /**
   * Infer category from tool name
   */
  private inferCategory(toolName: string): string {
    const name = toolName.toLowerCase();
    
    if (name.includes('timer') || name.includes('alarm') || name.includes('reminder')) {
      return 'Time Management';
    }
    if (name.includes('list') || name.includes('note')) {
      return 'Notes & Lists';
    }
    if (name.includes('device') || name.includes('scene') || name.includes('climate')) {
      return 'Smart Home';
    }
    if (name.includes('music') || name.includes('track') || name.includes('volume')) {
      return 'Music';
    }
    if (name.includes('memory') || name.includes('remember') || name.includes('recall')) {
      return 'Memory';
    }
    if (name.includes('time') || name.includes('date') || name.includes('weather')) {
      return 'Information';
    }
    if (name.includes('calculate') || name.includes('convert')) {
      return 'Utilities';
    }
    
    return 'General';
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const selfKnowledge = new SelfKnowledge();

// =============================================================================
// INTROSPECTION HELPERS
// =============================================================================

/**
 * Generate self-description for LLM context
 */
export function generateSelfDescription(): string {
  const caps = selfKnowledge.getCapabilities();
  const state = selfKnowledge.getSystemState();
  
  const parts = [
    `I am JARVIS, running in ${state.mode} mode.`,
    `I have ${caps.length} capabilities available.`,
  ];
  
  const online = state.services.filter(s => s.status === 'online');
  if (online.length > 0) {
    parts.push(`Connected services: ${online.map(s => s.name).join(', ')}.`);
  }
  
  const notConfigured = state.services.filter(s => s.status === 'not_configured');
  if (notConfigured.length > 0) {
    parts.push(`Not configured: ${notConfigured.map(s => s.name).join(', ')}.`);
  }
  
  return parts.join(' ');
}
