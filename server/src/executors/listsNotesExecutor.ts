/**
 * Lists & Notes Executor
 * 
 * Persistent storage for lists, notes, and memory.
 * Uses SQLite for durability.
 */

import { z } from 'zod';
import { 
  IToolExecutor, 
  ToolCapability, 
  ExecutionResult, 
  ExecutionSideEffect 
} from './interface';
import { getDatabase } from '../db/init';
import { logger } from '../services/logger';

// =============================================================================
// DATABASE SCHEMA INITIALIZATION
// =============================================================================

function ensureTables(): void {
  const db = getDatabase();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      items TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS jarvis_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS jarvis_memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 5,
      decay_rate REAL DEFAULT 0.1,
      last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
      access_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_memory_keywords ON jarvis_memory(keywords);
    CREATE INDEX IF NOT EXISTS idx_memory_type ON jarvis_memory(type);
  `);
}

// Ensure tables exist on module load
let tablesInitialized = false;

function initTables() {
  if (!tablesInitialized) {
    try {
      ensureTables();
      tablesInitialized = true;
    } catch (e) {
      // Database might not be ready yet
    }
  }
}

// =============================================================================
// EXECUTOR IMPLEMENTATION
// =============================================================================

export class ListsNotesExecutor implements IToolExecutor {
  readonly id = 'lists-notes-executor';
  readonly name = 'Lists & Notes Executor';
  readonly category = 'list';

  constructor() {
    initTables();
  }

  getCapabilities(): ToolCapability[] {
    return [
      // LIST OPERATIONS
      {
        name: 'getList',
        description: 'Get contents of a list',
        schema: z.object({
          listName: z.string().max(100),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getAllLists',
        description: 'Get all list names',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'addToList',
        description: 'Add an item to a list (creates list if needed)',
        schema: z.object({
          listName: z.string().max(100),
          item: z.string().max(500),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'removeFromList',
        description: 'Remove an item from a list',
        schema: z.object({
          listName: z.string().max(100),
          item: z.string().max(500),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'clearList',
        description: 'Remove all items from a list',
        schema: z.object({
          listName: z.string().max(100),
        }),
        riskLevel: 'medium',
        reversible: false,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      
      // NOTE OPERATIONS
      {
        name: 'createNote',
        description: 'Create a new note',
        schema: z.object({
          title: z.string().max(200),
          content: z.string().max(50000),
          tags: z.array(z.string()).optional(),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getNote',
        description: 'Get a note by title',
        schema: z.object({
          title: z.string().max(200),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getAllNotes',
        description: 'Get all note titles',
        schema: z.object({
          tag: z.string().optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'deleteNote',
        description: 'Delete a note',
        schema: z.object({
          title: z.string().max(200),
        }),
        riskLevel: 'medium',
        reversible: false,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      
      // MEMORY OPERATIONS
      {
        name: 'remember',
        description: 'Store information in long-term memory',
        schema: z.object({
          information: z.string().max(2000),
          type: z.enum(['fact', 'preference', 'context', 'task']).optional(),
          importance: z.number().min(1).max(10).optional(),
        }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'recall',
        description: 'Search memory for relevant information',
        schema: z.object({
          query: z.string().max(500),
          type: z.string().optional(),
          limit: z.number().min(1).max(20).optional(),
        }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'forget',
        description: 'Remove information from memory',
        schema: z.object({
          query: z.string().max(500),
        }),
        riskLevel: 'high',
        reversible: false,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'getMemorySummary',
        description: 'Get summary of stored memories',
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
    const predictedSideEffects: ExecutionSideEffect[] = [];
    const warnings: string[] = [];

    switch (toolName) {
      case 'addToList':
        predictedSideEffects.push({
          type: 'state_change',
          target: `list:${params.listName}`,
          description: `Will add "${params.item}" to ${params.listName}`,
          reversible: true,
          rollbackAction: 'removeFromList',
        });
        break;

      case 'clearList':
        predictedSideEffects.push({
          type: 'state_change',
          target: `list:${params.listName}`,
          description: `Will remove ALL items from ${params.listName}`,
          reversible: false,
        });
        warnings.push('This action cannot be undone');
        break;

      case 'remember':
        predictedSideEffects.push({
          type: 'state_change',
          target: 'memory',
          description: 'Will store new information in memory',
          reversible: true,
          rollbackAction: 'forget',
        });
        break;

      case 'forget':
        predictedSideEffects.push({
          type: 'state_change',
          target: 'memory',
          description: 'Will permanently remove matching memories',
          reversible: false,
        });
        warnings.push('Forgotten information cannot be recovered');
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
    initTables();
    const db = getDatabase();

    try {
      let output: any;
      let message: string;
      const sideEffects: ExecutionSideEffect[] = [];

      switch (toolName) {
        // LIST OPERATIONS
        case 'getList': {
          const row = db.prepare('SELECT * FROM jarvis_lists WHERE name = ?').get(params.listName) as any;
          if (!row) {
            output = { listName: params.listName, items: [], exists: false };
            message = `List "${params.listName}" doesn't exist yet`;
          } else {
            const items = JSON.parse(row.items);
            output = { listName: params.listName, items, count: items.length };
            message = items.length === 0 
              ? `${params.listName} is empty`
              : `${params.listName} has ${items.length} item(s)`;
          }
          break;
        }

        case 'getAllLists': {
          const rows = db.prepare('SELECT name, items FROM jarvis_lists').all() as any[];
          const lists = rows.map(r => ({
            name: r.name,
            itemCount: JSON.parse(r.items).length,
          }));
          output = { lists };
          message = lists.length === 0 
            ? 'No lists created yet'
            : `${lists.length} list(s)`;
          break;
        }

        case 'addToList': {
          const id = `list_${Date.now()}`;
          let row = db.prepare('SELECT * FROM jarvis_lists WHERE name = ?').get(params.listName) as any;
          
          if (!row) {
            // Create new list
            db.prepare('INSERT INTO jarvis_lists (id, name, items) VALUES (?, ?, ?)').run(
              id, params.listName, JSON.stringify([params.item])
            );
            output = { listName: params.listName, item: params.item, created: true };
            message = `Created list "${params.listName}" with "${params.item}"`;
          } else {
            // Add to existing
            const items = JSON.parse(row.items);
            if (!items.includes(params.item)) {
              items.push(params.item);
              db.prepare('UPDATE jarvis_lists SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?').run(
                JSON.stringify(items), params.listName
              );
            }
            output = { listName: params.listName, item: params.item, count: items.length };
            message = `Added "${params.item}" to ${params.listName}`;
          }
          
          sideEffects.push({
            type: 'state_change',
            target: `list:${params.listName}`,
            description: `Added item`,
            reversible: true,
            rollbackAction: 'removeFromList',
          });
          break;
        }

        case 'removeFromList': {
          const row = db.prepare('SELECT * FROM jarvis_lists WHERE name = ?').get(params.listName) as any;
          if (!row) {
            throw new Error(`List "${params.listName}" not found`);
          }
          
          const items = JSON.parse(row.items);
          const index = items.findIndex((i: string) => 
            i.toLowerCase() === params.item.toLowerCase()
          );
          
          if (index === -1) {
            throw new Error(`Item "${params.item}" not in list`);
          }
          
          const removed = items.splice(index, 1)[0];
          db.prepare('UPDATE jarvis_lists SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?').run(
            JSON.stringify(items), params.listName
          );
          
          output = { listName: params.listName, removed, remaining: items.length };
          message = `Removed "${removed}" from ${params.listName}`;
          
          sideEffects.push({
            type: 'state_change',
            target: `list:${params.listName}`,
            description: `Removed "${removed}"`,
            reversible: true,
          });
          break;
        }

        case 'clearList': {
          const row = db.prepare('SELECT * FROM jarvis_lists WHERE name = ?').get(params.listName) as any;
          if (!row) {
            throw new Error(`List "${params.listName}" not found`);
          }
          
          const previousItems = JSON.parse(row.items);
          db.prepare('UPDATE jarvis_lists SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?').run(
            '[]', params.listName
          );
          
          output = { listName: params.listName, cleared: previousItems.length };
          message = `Cleared ${previousItems.length} items from ${params.listName}`;
          
          sideEffects.push({
            type: 'state_change',
            target: `list:${params.listName}`,
            description: `Cleared ${previousItems.length} items`,
            reversible: false,
          });
          break;
        }

        // NOTE OPERATIONS
        case 'createNote': {
          const id = `note_${Date.now()}`;
          const tags = params.tags || [];
          
          db.prepare('INSERT INTO jarvis_notes (id, title, content, tags) VALUES (?, ?, ?, ?)').run(
            id, params.title, params.content, JSON.stringify(tags)
          );
          
          output = { id, title: params.title, tags };
          message = `Created note "${params.title}"`;
          
          sideEffects.push({
            type: 'state_change',
            target: 'notes',
            description: `Created note: ${params.title}`,
            reversible: true,
            rollbackAction: 'deleteNote',
          });
          break;
        }

        case 'getNote': {
          const row = db.prepare('SELECT * FROM jarvis_notes WHERE title = ?').get(params.title) as any;
          if (!row) {
            throw new Error(`Note "${params.title}" not found`);
          }
          
          output = {
            title: row.title,
            content: row.content,
            tags: JSON.parse(row.tags),
            created: row.created_at,
            updated: row.updated_at,
          };
          message = `Note: ${params.title}`;
          break;
        }

        case 'getAllNotes': {
          let query = 'SELECT title, tags, created_at FROM jarvis_notes';
          const rows = db.prepare(query).all() as any[];
          
          let notes = rows.map(r => ({
            title: r.title,
            tags: JSON.parse(r.tags),
            created: r.created_at,
          }));
          
          if (params.tag) {
            notes = notes.filter(n => n.tags.includes(params.tag));
          }
          
          output = { notes, count: notes.length };
          message = notes.length === 0 
            ? 'No notes found'
            : `${notes.length} note(s)`;
          break;
        }

        case 'deleteNote': {
          const row = db.prepare('SELECT * FROM jarvis_notes WHERE title = ?').get(params.title) as any;
          if (!row) {
            throw new Error(`Note "${params.title}" not found`);
          }
          
          db.prepare('DELETE FROM jarvis_notes WHERE title = ?').run(params.title);
          
          output = { deleted: params.title };
          message = `Deleted note "${params.title}"`;
          
          sideEffects.push({
            type: 'state_change',
            target: 'notes',
            description: `Deleted note: ${params.title}`,
            reversible: false,
          });
          break;
        }

        // MEMORY OPERATIONS
        case 'remember': {
          const id = `mem_${Date.now()}`;
          const type = params.type || 'fact';
          const importance = params.importance || 5;
          
          // Extract keywords from information
          const keywords = this.extractKeywords(params.information);
          
          db.prepare(`
            INSERT INTO jarvis_memory (id, type, content, keywords, importance)
            VALUES (?, ?, ?, ?, ?)
          `).run(id, type, params.information, JSON.stringify(keywords), importance);
          
          output = { id, type, keywords };
          message = `Remembered: "${params.information.substring(0, 50)}..."`;
          
          sideEffects.push({
            type: 'state_change',
            target: 'memory',
            description: 'Stored new memory',
            reversible: true,
          });
          break;
        }

        case 'recall': {
          const keywords = this.extractKeywords(params.query);
          const limit = params.limit || 5;
          
          // Search by keywords and content
          const rows = db.prepare(`
            SELECT *, 
              (access_count * 0.3 + importance * 0.7) as relevance_score
            FROM jarvis_memory 
            WHERE content LIKE ? 
              ${params.type ? 'AND type = ?' : ''}
            ORDER BY relevance_score DESC, last_accessed DESC
            LIMIT ?
          `).all(
            `%${params.query}%`,
            ...(params.type ? [params.type] : []),
            limit
          ) as any[];
          
          // Update access count for retrieved memories
          for (const row of rows) {
            db.prepare(`
              UPDATE jarvis_memory 
              SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(row.id);
          }
          
          const memories = rows.map(r => ({
            content: r.content,
            type: r.type,
            importance: r.importance,
            created: r.created_at,
          }));
          
          output = { query: params.query, memories, count: memories.length };
          message = memories.length === 0
            ? 'No relevant memories found'
            : `Found ${memories.length} relevant memory/memories`;
          break;
        }

        case 'forget': {
          const result = db.prepare('DELETE FROM jarvis_memory WHERE content LIKE ?').run(
            `%${params.query}%`
          );
          
          output = { query: params.query, forgotten: result.changes };
          message = result.changes === 0
            ? 'No matching memories found'
            : `Forgot ${result.changes} memory/memories`;
          
          if (result.changes > 0) {
            sideEffects.push({
              type: 'state_change',
              target: 'memory',
              description: `Deleted ${result.changes} memories`,
              reversible: false,
            });
          }
          break;
        }

        case 'getMemorySummary': {
          const stats = db.prepare(`
            SELECT 
              type,
              COUNT(*) as count,
              AVG(importance) as avg_importance
            FROM jarvis_memory
            GROUP BY type
          `).all() as any[];
          
          const total = db.prepare('SELECT COUNT(*) as count FROM jarvis_memory').get() as any;
          
          output = {
            total: total.count,
            byType: stats.reduce((acc, s) => {
              acc[s.type] = { count: s.count, avgImportance: s.avg_importance };
              return acc;
            }, {}),
          };
          message = `${total.count} total memories`;
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
      logger.error('Lists/Notes execution failed', { toolName, params, error });
      
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

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
      'that', 'this', 'these', 'those', 'i', 'me', 'my', 'myself', 'we',
      'our', 'ours', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
      'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who',
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 10);
  }
}
