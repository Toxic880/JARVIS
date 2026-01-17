/**
 * Goal Tracking System
 * 
 * Manages long-lived goals and intents:
 * - Goals with sub-goals
 * - Progress tracking
 * - Attention decay
 * - Soft abandonment
 * 
 * "Help me release this track" becomes a living thing,
 * not a one-off command.
 */

import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// GOAL TYPES
// =============================================================================

export type GoalStatus = 
  | 'active'      // Currently being worked on
  | 'paused'      // User requested pause
  | 'blocked'     // Waiting on something
  | 'completed'   // Successfully achieved
  | 'abandoned'   // User gave up or lost interest
  | 'expired';    // TTL exceeded without interaction

export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Goal {
  id: string;
  // What the user wants to achieve
  description: string;
  // Context and details
  context: string;
  // Current status
  status: GoalStatus;
  // Priority level
  priority: GoalPriority;
  // Parent goal (for sub-goals)
  parentId?: string;
  // Sub-goal IDs
  childIds: string[];
  // Progress percentage (0-100)
  progress: number;
  // What's needed to make progress
  nextActions: string[];
  // What's blocking progress
  blockers: string[];
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastInteractionAt: Date;
  completedAt?: Date;
  // Attention tracking
  attentionScore: number; // 0-1, decays over time
  interactionCount: number;
  // TTL before auto-abandonment (in hours)
  ttlHours: number;
  // Tags for categorization
  tags: string[];
  // User ID
  userId: string;
}

export interface GoalUpdate {
  description?: string;
  status?: GoalStatus;
  priority?: GoalPriority;
  progress?: number;
  nextActions?: string[];
  blockers?: string[];
  tags?: string[];
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

function ensureGoalTables(): void {
  const db = getDatabase();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      context TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'medium',
      parent_id TEXT,
      child_ids TEXT DEFAULT '[]',
      progress INTEGER DEFAULT 0,
      next_actions TEXT DEFAULT '[]',
      blockers TEXT DEFAULT '[]',
      attention_score REAL DEFAULT 1.0,
      interaction_count INTEGER DEFAULT 0,
      ttl_hours INTEGER DEFAULT 168,
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_interaction_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (parent_id) REFERENCES jarvis_goals(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_goals_user ON jarvis_goals(user_id);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON jarvis_goals(status);
    CREATE INDEX IF NOT EXISTS idx_goals_parent ON jarvis_goals(parent_id);
  `);
}

let tablesInitialized = false;
function initTables() {
  if (!tablesInitialized) {
    try {
      ensureGoalTables();
      tablesInitialized = true;
    } catch (e) {
      // Database might not be ready
    }
  }
}

// =============================================================================
// GOAL MANAGER
// =============================================================================

export class GoalManager {
  // Attention decay rate per hour (0.1 = 10% decay per hour)
  private decayRate = 0.05;
  
  constructor() {
    initTables();
  }

  /**
   * Create a new goal
   */
  async createGoal(
    userId: string,
    description: string,
    options: {
      context?: string;
      priority?: GoalPriority;
      parentId?: string;
      nextActions?: string[];
      tags?: string[];
      ttlHours?: number;
    } = {}
  ): Promise<Goal> {
    const db = getDatabase();
    const id = `goal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const goal: Goal = {
      id,
      userId,
      description,
      context: options.context || '',
      status: 'active',
      priority: options.priority || 'medium',
      parentId: options.parentId,
      childIds: [],
      progress: 0,
      nextActions: options.nextActions || [],
      blockers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastInteractionAt: new Date(),
      attentionScore: 1.0,
      interactionCount: 1,
      ttlHours: options.ttlHours || 168, // 1 week default
      tags: options.tags || [],
    };
    
    db.prepare(`
      INSERT INTO jarvis_goals (
        id, user_id, description, context, status, priority,
        parent_id, child_ids, progress, next_actions, blockers,
        attention_score, interaction_count, ttl_hours, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, description, goal.context, goal.status, goal.priority,
      options.parentId || null, '[]', 0, JSON.stringify(goal.nextActions),
      '[]', 1.0, 1, goal.ttlHours, JSON.stringify(goal.tags)
    );
    
    // If this is a sub-goal, update parent
    if (options.parentId) {
      await this.addChildGoal(options.parentId, id);
    }
    
    auditLog('GOAL_CREATED', { goalId: id, userId, description: description.substring(0, 50) });
    
    return goal;
  }

  /**
   * Get a goal by ID
   */
  async getGoal(goalId: string): Promise<Goal | null> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM jarvis_goals WHERE id = ?').get(goalId) as any;
    
    if (!row) return null;
    
    return this.rowToGoal(row);
  }

  /**
   * Get all active goals for a user
   */
  async getActiveGoals(userId: string): Promise<Goal[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_goals 
      WHERE user_id = ? AND status = 'active'
      ORDER BY priority DESC, attention_score DESC
    `).all(userId) as any[];
    
    return rows.map(row => this.rowToGoal(row));
  }

  /**
   * Get top-level goals (no parent)
   */
  async getTopLevelGoals(userId: string): Promise<Goal[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_goals 
      WHERE user_id = ? AND parent_id IS NULL AND status = 'active'
      ORDER BY priority DESC, attention_score DESC
    `).all(userId) as any[];
    
    return rows.map(row => this.rowToGoal(row));
  }

  /**
   * Get sub-goals of a goal
   */
  async getSubGoals(goalId: string): Promise<Goal[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_goals WHERE parent_id = ?
    `).all(goalId) as any[];
    
    return rows.map(row => this.rowToGoal(row));
  }

  /**
   * Update a goal
   */
  async updateGoal(goalId: string, update: GoalUpdate): Promise<Goal | null> {
    const db = getDatabase();
    const current = await this.getGoal(goalId);
    if (!current) return null;
    
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [];
    
    if (update.description !== undefined) {
      updates.push('description = ?');
      params.push(update.description);
    }
    if (update.status !== undefined) {
      updates.push('status = ?');
      params.push(update.status);
      if (update.status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }
    }
    if (update.priority !== undefined) {
      updates.push('priority = ?');
      params.push(update.priority);
    }
    if (update.progress !== undefined) {
      updates.push('progress = ?');
      params.push(Math.min(100, Math.max(0, update.progress)));
    }
    if (update.nextActions !== undefined) {
      updates.push('next_actions = ?');
      params.push(JSON.stringify(update.nextActions));
    }
    if (update.blockers !== undefined) {
      updates.push('blockers = ?');
      params.push(JSON.stringify(update.blockers));
    }
    if (update.tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(update.tags));
    }
    
    params.push(goalId);
    
    db.prepare(`UPDATE jarvis_goals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    auditLog('GOAL_UPDATED', { goalId, updates: Object.keys(update) });
    
    return this.getGoal(goalId);
  }

  /**
   * Record interaction with a goal (refreshes attention)
   */
  async recordInteraction(goalId: string): Promise<void> {
    const db = getDatabase();
    
    db.prepare(`
      UPDATE jarvis_goals SET
        last_interaction_at = CURRENT_TIMESTAMP,
        attention_score = 1.0,
        interaction_count = interaction_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(goalId);
  }

  /**
   * Add a blocker to a goal
   */
  async addBlocker(goalId: string, blocker: string): Promise<void> {
    const goal = await this.getGoal(goalId);
    if (!goal) return;
    
    const blockers = [...goal.blockers, blocker];
    await this.updateGoal(goalId, { 
      blockers,
      status: 'blocked',
    });
  }

  /**
   * Remove a blocker from a goal
   */
  async removeBlocker(goalId: string, blocker: string): Promise<void> {
    const goal = await this.getGoal(goalId);
    if (!goal) return;
    
    const blockers = goal.blockers.filter(b => b !== blocker);
    await this.updateGoal(goalId, { 
      blockers,
      status: blockers.length === 0 ? 'active' : 'blocked',
    });
  }

  /**
   * Add a sub-goal
   */
  private async addChildGoal(parentId: string, childId: string): Promise<void> {
    const parent = await this.getGoal(parentId);
    if (!parent) return;
    
    const childIds = [...parent.childIds, childId];
    const db = getDatabase();
    
    db.prepare('UPDATE jarvis_goals SET child_ids = ? WHERE id = ?').run(
      JSON.stringify(childIds), parentId
    );
  }

  /**
   * Apply attention decay to all goals
   */
  async applyDecay(): Promise<number> {
    const db = getDatabase();
    
    // Calculate decay based on hours since last interaction
    const result = db.prepare(`
      UPDATE jarvis_goals SET
        attention_score = MAX(0, attention_score - (
          (julianday('now') - julianday(last_interaction_at)) * 24 * ?
        ))
      WHERE status = 'active' AND attention_score > 0
    `).run(this.decayRate);
    
    // Check for goals that should be auto-abandoned
    const expired = db.prepare(`
      UPDATE jarvis_goals SET
        status = 'expired',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active' 
        AND (julianday('now') - julianday(last_interaction_at)) * 24 > ttl_hours
    `).run();
    
    if (expired.changes > 0) {
      auditLog('GOALS_EXPIRED', { count: expired.changes });
    }
    
    return result.changes;
  }

  /**
   * Get goals that need attention (low attention score)
   */
  async getGoalsNeedingAttention(userId: string, threshold = 0.3): Promise<Goal[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_goals 
      WHERE user_id = ? AND status = 'active' AND attention_score < ?
      ORDER BY attention_score ASC
    `).all(userId, threshold) as any[];
    
    return rows.map(row => this.rowToGoal(row));
  }

  /**
   * Suggest next action for a goal
   */
  async suggestNextAction(goalId: string): Promise<string | null> {
    const goal = await this.getGoal(goalId);
    if (!goal) return null;
    
    // If there are explicit next actions, return the first one
    if (goal.nextActions.length > 0) {
      return goal.nextActions[0];
    }
    
    // If blocked, suggest addressing the blocker
    if (goal.blockers.length > 0) {
      return `Address blocker: ${goal.blockers[0]}`;
    }
    
    // If has sub-goals, suggest working on the most urgent one
    if (goal.childIds.length > 0) {
      const subGoals = await this.getSubGoals(goalId);
      const active = subGoals.filter(g => g.status === 'active');
      if (active.length > 0) {
        const mostUrgent = active.sort((a, b) => b.priority.localeCompare(a.priority))[0];
        return `Work on sub-goal: ${mostUrgent.description}`;
      }
    }
    
    return null;
  }

  /**
   * Complete a goal and update parent progress
   */
  async completeGoal(goalId: string): Promise<void> {
    await this.updateGoal(goalId, { 
      status: 'completed',
      progress: 100,
    });
    
    const goal = await this.getGoal(goalId);
    if (!goal?.parentId) return;
    
    // Update parent progress based on completed children
    const parent = await this.getGoal(goal.parentId);
    if (!parent) return;
    
    const subGoals = await this.getSubGoals(goal.parentId);
    const completed = subGoals.filter(g => g.status === 'completed').length;
    const progress = Math.round((completed / subGoals.length) * 100);
    
    await this.updateGoal(goal.parentId, { progress });
    
    // If all sub-goals completed, complete parent
    if (completed === subGoals.length) {
      await this.completeGoal(goal.parentId);
    }
  }

  /**
   * Get goal summary for LLM context
   */
  async getGoalSummary(userId: string): Promise<string> {
    const goals = await this.getTopLevelGoals(userId);
    
    if (goals.length === 0) {
      return 'No active goals.';
    }
    
    const summaries = goals.map(g => {
      let summary = `• ${g.description} (${g.progress}%)`;
      if (g.blockers.length > 0) {
        summary += ` [BLOCKED: ${g.blockers[0]}]`;
      }
      if (g.nextActions.length > 0) {
        summary += ` → Next: ${g.nextActions[0]}`;
      }
      return summary;
    });
    
    return `Active goals:\n${summaries.join('\n')}`;
  }

  /**
   * Convert database row to Goal object
   */
  private rowToGoal(row: any): Goal {
    return {
      id: row.id,
      userId: row.user_id,
      description: row.description,
      context: row.context,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id || undefined,
      childIds: JSON.parse(row.child_ids),
      progress: row.progress,
      nextActions: JSON.parse(row.next_actions),
      blockers: JSON.parse(row.blockers),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastInteractionAt: new Date(row.last_interaction_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      attentionScore: row.attention_score,
      interactionCount: row.interaction_count,
      ttlHours: row.ttl_hours,
      tags: JSON.parse(row.tags),
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const goalManager = new GoalManager();
