/**
 * Memory Routes
 * 
 * Server-side persistent memory storage:
 * - CRUD operations for memory entries
 * - Sync endpoint for client cache
 * - Export/import for backup
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

export const memoryRouter = Router();

// Require authentication
memoryRouter.use(requireAuth);

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const memoryEntrySchema = z.object({
  type: z.enum(['fact', 'preference', 'context', 'conversation', 'note']),
  content: z.string().min(1).max(10000),
  keywords: z.array(z.string()).optional(),
  source: z.string().optional(),
});

const syncRequestSchema = z.object({
  lastSyncTime: z.string().datetime().optional(),
  localChanges: z.array(z.object({
    id: z.string(),
    type: z.string(),
    content: z.string(),
    keywords: z.array(z.string()).optional(),
    source: z.string().optional(),
    deleted: z.boolean().optional(),
    updated_at: z.string(),
  })).optional(),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/v1/memory
 * List all memory entries
 */
memoryRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as string;
    const search = req.query.search as string;

    let query = 'SELECT * FROM memory WHERE 1=1';
    const params: any[] = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (search) {
      query += ' AND (content LIKE ? OR keywords LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const entries = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM memory WHERE 1=1';
    const countParams: any[] = [];
    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }
    if (search) {
      countQuery += ' AND (content LIKE ? OR keywords LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    const total = (db.prepare(countQuery).get(...countParams) as { count: number }).count;

    // Parse keywords from JSON string
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      keywords: e.keywords ? JSON.parse(e.keywords) : [],
    }));

    res.json({
      entries: parsedEntries,
      total,
      limit,
      offset,
    });

  } catch (error) {
    logger.error('Memory list error', { error });
    res.status(500).json({ error: 'Failed to list memories' });
  }
});

/**
 * GET /api/v1/memory/:id
 * Get single memory entry
 */
memoryRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const entry = db.prepare('SELECT * FROM memory WHERE id = ?').get(req.params.id) as any;

    if (!entry) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({
      ...entry,
      keywords: entry.keywords ? JSON.parse(entry.keywords) : [],
    });

  } catch (error) {
    logger.error('Memory get error', { error });
    res.status(500).json({ error: 'Failed to get memory' });
  }
});

/**
 * POST /api/v1/memory
 * Create new memory entry
 */
memoryRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = memoryEntrySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid input', details: result.error.issues });
    }

    const { type, content, keywords, source } = result.data;
    const db = getDatabase();

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO memory (id, type, content, keywords, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, content, JSON.stringify(keywords || []), source || 'user', now, now);

    auditLog('MEMORY_CREATE', { userId: req.user!.userId, memoryId: id, type });

    res.status(201).json({
      id,
      type,
      content,
      keywords: keywords || [],
      source: source || 'user',
      created_at: now,
      updated_at: now,
    });

  } catch (error) {
    logger.error('Memory create error', { error });
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

/**
 * PUT /api/v1/memory/:id
 * Update memory entry
 */
memoryRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = memoryEntrySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid input', details: result.error.issues });
    }

    const { type, content, keywords, source } = result.data;
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM memory WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE memory 
      SET type = ?, content = ?, keywords = ?, source = ?, updated_at = ?
      WHERE id = ?
    `).run(type, content, JSON.stringify(keywords || []), source, now, req.params.id);

    auditLog('MEMORY_UPDATE', { userId: req.user!.userId, memoryId: req.params.id });

    res.json({
      id: req.params.id,
      type,
      content,
      keywords: keywords || [],
      source,
      updated_at: now,
    });

  } catch (error) {
    logger.error('Memory update error', { error });
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

/**
 * DELETE /api/v1/memory/:id
 * Delete memory entry
 */
memoryRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM memory WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    db.prepare('DELETE FROM memory WHERE id = ?').run(req.params.id);

    auditLog('MEMORY_DELETE', { userId: req.user!.userId, memoryId: req.params.id });

    res.json({ message: 'Memory deleted' });

  } catch (error) {
    logger.error('Memory delete error', { error });
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

/**
 * POST /api/v1/memory/sync
 * Sync memory between client and server
 * 
 * Client sends:
 * - lastSyncTime: when it last synced
 * - localChanges: any changes made locally
 * 
 * Server returns:
 * - serverChanges: changes since lastSyncTime
 * - conflicts: any entries that conflict
 */
memoryRouter.post('/sync', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = syncRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid input', details: result.error.issues });
    }

    const { lastSyncTime, localChanges } = result.data;
    const db = getDatabase();
    const now = new Date().toISOString();

    // Get server changes since last sync
    let serverChanges: any[] = [];
    if (lastSyncTime) {
      serverChanges = db.prepare(`
        SELECT * FROM memory WHERE updated_at > ?
      `).all(lastSyncTime);
    } else {
      // First sync - send all
      serverChanges = db.prepare('SELECT * FROM memory').all();
    }

    // Process local changes
    const conflicts: any[] = [];
    
    if (localChanges && localChanges.length > 0) {
      const upsertStmt = db.prepare(`
        INSERT INTO memory (id, type, content, keywords, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          content = excluded.content,
          keywords = excluded.keywords,
          source = excluded.source,
          updated_at = excluded.updated_at
        WHERE memory.updated_at < excluded.updated_at
      `);

      const deleteStmt = db.prepare('DELETE FROM memory WHERE id = ?');

      for (const change of localChanges) {
        if (change.deleted) {
          deleteStmt.run(change.id);
        } else {
          // Check for conflicts (server updated after client's version)
          const existing = db.prepare('SELECT * FROM memory WHERE id = ?').get(change.id) as any;
          
          if (existing && existing.updated_at > change.updated_at) {
            // Conflict - server wins, but report it
            conflicts.push({
              clientVersion: change,
              serverVersion: existing,
            });
          } else {
            // No conflict - apply change
            upsertStmt.run(
              change.id,
              change.type,
              change.content,
              JSON.stringify(change.keywords || []),
              change.source || 'sync',
              existing?.created_at || now,
              now
            );
          }
        }
      }
    }

    // Parse keywords in server changes
    const parsedServerChanges = serverChanges.map((e: any) => ({
      ...e,
      keywords: e.keywords ? JSON.parse(e.keywords) : [],
    }));

    auditLog('MEMORY_SYNC', {
      userId: req.user!.userId,
      serverChanges: serverChanges.length,
      localChanges: localChanges?.length || 0,
      conflicts: conflicts.length,
    });

    res.json({
      serverChanges: parsedServerChanges,
      conflicts,
      syncTime: now,
    });

  } catch (error) {
    logger.error('Memory sync error', { error });
    res.status(500).json({ error: 'Sync failed' });
  }
});

/**
 * GET /api/v1/memory/export
 * Export all memories as JSON
 */
memoryRouter.get('/export/all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const entries = db.prepare('SELECT * FROM memory ORDER BY created_at').all();

    const parsed = entries.map((e: any) => ({
      ...e,
      keywords: e.keywords ? JSON.parse(e.keywords) : [],
    }));

    auditLog('MEMORY_EXPORT', { userId: req.user!.userId, count: entries.length });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=jarvis-memory-${new Date().toISOString().split('T')[0]}.json`);
    res.json({
      exportedAt: new Date().toISOString(),
      version: '1.0',
      entries: parsed,
    });

  } catch (error) {
    logger.error('Memory export error', { error });
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * POST /api/v1/memory/import
 * Import memories from JSON
 */
memoryRouter.post('/import', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { entries, overwrite } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Invalid import format' });
    }

    const db = getDatabase();
    const now = new Date().toISOString();

    let imported = 0;
    let skipped = 0;

    const insertStmt = db.prepare(`
      INSERT INTO memory (id, type, content, keywords, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO ${overwrite ? 'UPDATE SET type = excluded.type, content = excluded.content, keywords = excluded.keywords, source = excluded.source, updated_at = excluded.updated_at' : 'NOTHING'}
    `);

    for (const entry of entries) {
      if (!entry.type || !entry.content) {
        skipped++;
        continue;
      }

      const result = insertStmt.run(
        entry.id || uuidv4(),
        entry.type,
        entry.content,
        JSON.stringify(entry.keywords || []),
        entry.source || 'import',
        entry.created_at || now,
        now
      );

      if (result.changes > 0) {
        imported++;
      } else {
        skipped++;
      }
    }

    auditLog('MEMORY_IMPORT', { userId: req.user!.userId, imported, skipped, overwrite: !!overwrite });

    res.json({
      message: `Imported ${imported} entries, skipped ${skipped}`,
      imported,
      skipped,
    });

  } catch (error) {
    logger.error('Memory import error', { error });
    res.status(500).json({ error: 'Import failed' });
  }
});

/**
 * DELETE /api/v1/memory/all
 * Clear all memories (admin only)
 */
memoryRouter.delete('/all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Require confirmation
    if (req.query.confirm !== 'true') {
      return res.status(400).json({ 
        error: 'Confirmation required', 
        message: 'Add ?confirm=true to confirm deletion' 
      });
    }

    const db = getDatabase();
    const count = (db.prepare('SELECT COUNT(*) as count FROM memory').get() as { count: number }).count;
    
    db.prepare('DELETE FROM memory').run();

    auditLog('MEMORY_CLEAR_ALL', { userId: req.user!.userId, entriesDeleted: count });

    res.json({ message: `Deleted ${count} memories` });

  } catch (error) {
    logger.error('Memory clear error', { error });
    res.status(500).json({ error: 'Clear failed' });
  }
});
