/**
 * Goals Executor - Natural goal tracking from conversation
 * 
 * Recognizes patterns like:
 * - "I want to learn Spanish"
 * - "Remind me to follow up on the proposal next week"
 * - "I'm working on losing 10 pounds"
 * - "Help me stay on track with my exercise routine"
 * 
 * Creates trackable goals with progress and check-ins.
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// DATABASE SETUP
// =============================================================================

function ensureGoalsTable(): void {
  const db = getDatabase();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      target_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      progress INTEGER DEFAULT 0,
      milestones TEXT DEFAULT '[]',
      check_ins TEXT DEFAULT '[]',
      notes TEXT DEFAULT ''
    );
    
    CREATE INDEX IF NOT EXISTS idx_goals_user ON user_goals(user_id);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON user_goals(status);
  `);
}

// =============================================================================
// TYPES
// =============================================================================

interface Goal {
  id: string;
  userId: string;
  description: string;
  category: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'paused' | 'abandoned';
  progress: number;
  milestones: { text: string; completed: boolean; completedAt?: string }[];
  checkIns: { date: string; note: string; progress: number }[];
  notes: string;
}

// =============================================================================
// GOAL MANAGEMENT
// =============================================================================

function generateGoalId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function getGoal(goalId: string): Goal | null {
  ensureGoalsTable();
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM user_goals WHERE id = ?').get(goalId) as any;
  
  if (!row) return null;
  
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    category: row.category,
    targetDate: row.target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    progress: row.progress,
    milestones: JSON.parse(row.milestones || '[]'),
    checkIns: JSON.parse(row.check_ins || '[]'),
    notes: row.notes,
  };
}

function getUserGoals(userId: string, status?: string): Goal[] {
  ensureGoalsTable();
  const db = getDatabase();
  
  let query = 'SELECT * FROM user_goals WHERE user_id = ?';
  const params: any[] = [userId];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY updated_at DESC';
  
  const rows = db.prepare(query).all(...params) as any[];
  
  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    description: row.description,
    category: row.category,
    targetDate: row.target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    progress: row.progress,
    milestones: JSON.parse(row.milestones || '[]'),
    checkIns: JSON.parse(row.check_ins || '[]'),
    notes: row.notes,
  }));
}

function createGoal(userId: string, data: Partial<Goal>): Goal {
  ensureGoalsTable();
  const db = getDatabase();
  
  const id = generateGoalId();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO user_goals (id, user_id, description, category, target_date, created_at, updated_at, status, progress, milestones, check_ins, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    data.description || '',
    data.category || 'general',
    data.targetDate || null,
    now,
    now,
    'active',
    0,
    JSON.stringify(data.milestones || []),
    '[]',
    data.notes || ''
  );
  
  return getGoal(id)!;
}

function updateGoal(goalId: string, updates: Partial<Goal>): Goal | null {
  ensureGoalsTable();
  const db = getDatabase();
  
  const goal = getGoal(goalId);
  if (!goal) return null;
  
  const now = new Date().toISOString();
  
  db.prepare(`
    UPDATE user_goals 
    SET description = ?, category = ?, target_date = ?, updated_at = ?, status = ?, progress = ?, milestones = ?, notes = ?
    WHERE id = ?
  `).run(
    updates.description ?? goal.description,
    updates.category ?? goal.category,
    updates.targetDate ?? goal.targetDate,
    now,
    updates.status ?? goal.status,
    updates.progress ?? goal.progress,
    JSON.stringify(updates.milestones ?? goal.milestones),
    updates.notes ?? goal.notes,
    goalId
  );
  
  return getGoal(goalId);
}

function addCheckIn(goalId: string, note: string, progress: number): Goal | null {
  ensureGoalsTable();
  const db = getDatabase();
  
  const goal = getGoal(goalId);
  if (!goal) return null;
  
  const checkIn = {
    date: new Date().toISOString(),
    note,
    progress,
  };
  
  const checkIns = [...goal.checkIns, checkIn];
  
  db.prepare(`
    UPDATE user_goals 
    SET check_ins = ?, progress = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(checkIns),
    progress,
    new Date().toISOString(),
    goalId
  );
  
  return getGoal(goalId);
}

// =============================================================================
// CATEGORY DETECTION
// =============================================================================

function detectCategory(description: string): string {
  const lower = description.toLowerCase();
  
  const categories: Record<string, string[]> = {
    'health': ['weight', 'exercise', 'workout', 'gym', 'run', 'walk', 'diet', 'eat', 'sleep', 'health', 'fitness'],
    'learning': ['learn', 'study', 'read', 'book', 'course', 'skill', 'language', 'practice'],
    'career': ['work', 'job', 'career', 'project', 'deadline', 'meeting', 'presentation', 'promotion'],
    'finance': ['save', 'money', 'budget', 'invest', 'debt', 'pay off', 'financial'],
    'personal': ['habit', 'routine', 'meditate', 'journal', 'organize', 'clean', 'declutter'],
    'social': ['friend', 'family', 'relationship', 'call', 'visit', 'connect'],
    'creative': ['write', 'paint', 'music', 'art', 'create', 'design', 'build'],
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  
  return 'general';
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class GoalsExecutor implements IToolExecutor {
  id = 'goals';
  name = 'Goals & Progress Tracking';
  category = 'productivity';
  description = 'Track personal goals and progress';
  
  private userId: string = 'default';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'createGoal',
        description: 'Create a new goal to track. Use this when user expresses intent like "I want to...", "I\'m working on...", "Help me..."',
        schema: z.object({
          description: z.string().describe('What the user wants to achieve'),
          targetDate: z.string().optional().describe('Target completion date if mentioned'),
          milestones: z.array(z.string()).optional().describe('Key milestones to track'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'listGoals',
        description: 'List user\'s goals',
        schema: z.object({
          status: z.enum(['active', 'completed', 'paused', 'all']).optional().default('active'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'updateProgress',
        description: 'Update progress on a goal',
        schema: z.object({
          goalId: z.string().describe('Goal ID'),
          progress: z.number().min(0).max(100).describe('Progress percentage'),
          note: z.string().optional().describe('Progress note'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'checkIn',
        description: 'Record a check-in on a goal',
        schema: z.object({
          goalId: z.string().describe('Goal ID'),
          note: z.string().describe('Check-in note'),
          progress: z.number().min(0).max(100).optional().describe('Updated progress'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'completeGoal',
        description: 'Mark a goal as completed',
        schema: z.object({
          goalId: z.string().describe('Goal ID'),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'pauseGoal',
        description: 'Pause a goal',
        schema: z.object({
          goalId: z.string().describe('Goal ID'),
          reason: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'getGoalSummary',
        description: 'Get a summary of goal progress for motivation',
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
      let message: string;
      const sideEffects: any[] = [];

      switch (toolName) {
        case 'createGoal': {
          const { description, targetDate, milestones } = params;
          
          const category = detectCategory(description);
          
          const goal = createGoal(this.userId, {
            description,
            category,
            targetDate,
            milestones: milestones?.map((m: string) => ({ text: m, completed: false })) || [],
          });
          
          output = { goal };
          message = `I'll help you track that! Created goal: "${description}"`;
          
          if (category !== 'general') {
            message += ` (${category})`;
          }
          
          if (targetDate) {
            message += `. Target date: ${targetDate}`;
          }
          
          message += `. I'll check in with you periodically to see how you're doing.`;
          
          sideEffects.push(createSideEffect(
            'data_created',
            'goals',
            `Created goal: ${description}`,
            { reversible: true }
          ));
          
          auditLog('GOAL_CREATED', { goalId: goal.id, description, category });
          break;
        }

        case 'listGoals': {
          const { status } = params;
          
          const goals = status === 'all' 
            ? getUserGoals(this.userId)
            : getUserGoals(this.userId, status);
          
          output = { goals, count: goals.length };
          
          if (goals.length === 0) {
            message = status === 'active' 
              ? "You don't have any active goals. Tell me something you want to work on!"
              : `No ${status} goals found.`;
          } else {
            message = `You have ${goals.length} ${status === 'all' ? '' : status + ' '}goal(s):\n\n` +
              goals.map((g, i) => {
                let line = `${i + 1}. ${g.description}`;
                if (g.progress > 0) line += ` (${g.progress}% complete)`;
                if (g.status !== 'active') line += ` [${g.status}]`;
                return line;
              }).join('\n');
          }
          break;
        }

        case 'updateProgress': {
          const { goalId, progress, note } = params;
          
          const goal = updateGoal(goalId, { progress });
          
          if (!goal) {
            throw new Error('Goal not found');
          }
          
          if (note) {
            addCheckIn(goalId, note, progress);
          }
          
          output = { goal, previousProgress: goal.progress };
          
          if (progress >= 100) {
            message = `🎉 Congratulations! You've completed your goal: "${goal.description}"!`;
            updateGoal(goalId, { status: 'completed' });
          } else if (progress >= 75) {
            message = `Great progress! You're ${progress}% there on "${goal.description}". Almost done!`;
          } else if (progress >= 50) {
            message = `Nice work! You're halfway there (${progress}%) on "${goal.description}".`;
          } else {
            message = `Progress updated to ${progress}% on "${goal.description}". Keep going!`;
          }
          break;
        }

        case 'checkIn': {
          const { goalId, note, progress } = params;
          
          const goal = getGoal(goalId);
          if (!goal) {
            throw new Error('Goal not found');
          }
          
          const updatedGoal = addCheckIn(goalId, note, progress ?? goal.progress);
          
          output = { goal: updatedGoal, checkIn: { note, progress } };
          message = `Check-in recorded for "${goal.description}". ${note}`;
          
          sideEffects.push(createSideEffect(
            'data_modified',
            'goals',
            'Recorded goal check-in',
            { reversible: true }
          ));
          break;
        }

        case 'completeGoal': {
          const { goalId } = params;
          
          const goal = updateGoal(goalId, { status: 'completed', progress: 100 });
          
          if (!goal) {
            throw new Error('Goal not found');
          }
          
          output = { goal };
          message = `🎉 Congratulations on completing "${goal.description}"! That's a great achievement!`;
          
          auditLog('GOAL_COMPLETED', { goalId, description: goal.description });
          break;
        }

        case 'pauseGoal': {
          const { goalId, reason } = params;
          
          const goal = updateGoal(goalId, { 
            status: 'paused',
            notes: reason ? `Paused: ${reason}` : 'Paused',
          });
          
          if (!goal) {
            throw new Error('Goal not found');
          }
          
          output = { goal };
          message = `Paused goal: "${goal.description}". I'll keep it saved for when you're ready to continue.`;
          break;
        }

        case 'getGoalSummary': {
          const activeGoals = getUserGoals(this.userId, 'active');
          const completedGoals = getUserGoals(this.userId, 'completed');
          
          const totalActive = activeGoals.length;
          const avgProgress = totalActive > 0 
            ? Math.round(activeGoals.reduce((sum, g) => sum + g.progress, 0) / totalActive)
            : 0;
          
          output = {
            activeCount: totalActive,
            completedCount: completedGoals.length,
            averageProgress: avgProgress,
            goals: activeGoals,
          };
          
          if (totalActive === 0 && completedGoals.length === 0) {
            message = "You haven't set any goals yet. What would you like to work on?";
          } else if (totalActive === 0) {
            message = `You've completed ${completedGoals.length} goal(s)! Ready to set a new one?`;
          } else {
            message = `📊 Goal Summary:\n` +
              `• ${totalActive} active goal(s)\n` +
              `• ${completedGoals.length} completed\n` +
              `• Average progress: ${avgProgress}%\n\n` +
              `Active goals:\n` +
              activeGoals.map(g => `• ${g.description} - ${g.progress}%`).join('\n');
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
      logger.error('Goals execution failed', { toolName, error: error.message });
      
      return {
        success: false,
        output: null,
        message: error.message,
        sideEffects: [],
        error: {
          code: 'GOALS_ERROR',
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

  setUserId(userId: string): void {
    this.userId = userId;
  }
}

export const goalsExecutor = new GoalsExecutor();
