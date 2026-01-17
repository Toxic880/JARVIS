/**
 * Memory with Decay
 * 
 * Intelligent memory system that:
 * - Remembers preferences, habits, and context
 * - Forgets noise and one-offs
 * - Reinforces frequently accessed memories
 * - Decays unused memories over time
 * 
 * Memory types:
 * - Ephemeral: Short-term context (hours)
 * - Working: Current session state (days)
 * - Long-term: Preferences and facts (weeks/months)
 * - Permanent: Critical information (never decays)
 */

import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';
import { LLMFactory } from './llm/factory';

// =============================================================================
// MEMORY TYPES
// =============================================================================

export type MemoryType = 
  | 'ephemeral'   // Decays in hours
  | 'working'     // Decays in days
  | 'long_term'   // Decays in weeks
  | 'permanent';  // Never decays

export type MemoryCategory =
  | 'preference'  // User likes/dislikes
  | 'fact'        // Factual information
  | 'habit'       // Behavioral pattern
  | 'context'     // Situational context
  | 'relationship' // Info about people/entities
  | 'skill'       // User's abilities/knowledge
  | 'goal';       // Objectives and aspirations

export interface Memory {
  id: string;
  userId: string;
  // What to remember
  content: string;
  // Memory classification
  type: MemoryType;
  category: MemoryCategory;
  // Importance (1-10, affects decay resistance)
  importance: number;
  // Current strength (0-1, decays over time)
  strength: number;
  // Keywords for retrieval
  keywords: string[];
  // Associated entities (people, places, things)
  entities: string[];
  // Source of this memory
  source: 'user' | 'inferred' | 'system';
  // Timestamps
  createdAt: Date;
  lastAccessed: Date;
  lastReinforced: Date;
  // Access statistics
  accessCount: number;
  reinforceCount: number;
  // Vector embedding (not returned to client usually)
  embedding?: number[];
}

// =============================================================================
// DECAY CONFIGURATION
// =============================================================================

const DECAY_RATES: Record<MemoryType, number> = {
  ephemeral: 0.2,    // 20% per hour
  working: 0.05,     // 5% per hour (~20 hours to halve)
  long_term: 0.002,  // 0.2% per hour (~2 weeks to halve)
  permanent: 0,      // Never decays
};

const REINFORCE_BOOST: Record<MemoryType, number> = {
  ephemeral: 0.3,
  working: 0.2,
  long_term: 0.1,
  permanent: 0,
};

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

function ensureMemoryTables(): void {
  const db = getDatabase();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_persistent_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'working',
      category TEXT DEFAULT 'fact',
      importance INTEGER DEFAULT 5,
      strength REAL DEFAULT 1.0,
      keywords TEXT DEFAULT '[]',
      entities TEXT DEFAULT '[]',
      source TEXT DEFAULT 'user',
      access_count INTEGER DEFAULT 0,
      reinforce_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_reinforced DATETIME DEFAULT CURRENT_TIMESTAMP,
      embedding BLOB
    );
    
    CREATE INDEX IF NOT EXISTS idx_memory_user ON jarvis_persistent_memory(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_type ON jarvis_persistent_memory(type);
    CREATE INDEX IF NOT EXISTS idx_memory_category ON jarvis_persistent_memory(category);
    CREATE INDEX IF NOT EXISTS idx_memory_strength ON jarvis_persistent_memory(strength);
  `);
}

let tablesInitialized = false;
function initTables() {
  if (!tablesInitialized) {
    try {
      ensureMemoryTables();
      tablesInitialized = true;
    } catch (e) {
      // Database might not be ready
    }
  }
}

// =============================================================================
// MEMORY MANAGER
// =============================================================================

export class MemoryManager {
  private minStrength = 0.1; // Memories below this are pruned
  
  constructor() {
    initTables();
  }

  /**
   * Store a new memory
   */
  async remember(
    userId: string,
    content: string,
    options: {
      type?: MemoryType;
      category?: MemoryCategory;
      importance?: number;
      keywords?: string[];
      entities?: string[];
      source?: Memory['source'];
    } = {}
  ): Promise<Memory> {
    const db = getDatabase();
    const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Extract keywords if not provided
    const keywords = options.keywords || this.extractKeywords(content);
    const entities = options.entities || this.extractEntities(content);
    
    // Generate embedding
    let embedding: number[] | undefined;
    try {
      const provider = await LLMFactory.getProvider();
      embedding = await provider.embed(content);
    } catch (e) {
      logger.error('Failed to generate embedding for memory', { error: e });
    }

    // Check for similar existing memories
    const similar = await this.findSimilar(userId, content, embedding);
    if (similar) {
      // Reinforce existing memory instead of creating duplicate
      await this.reinforce(similar.id);
      return similar;
    }
    
    const memory: Memory = {
      id,
      userId,
      content,
      type: options.type || 'working',
      category: options.category || 'fact',
      importance: options.importance || 5,
      strength: 1.0,
      keywords,
      entities,
      source: options.source || 'user',
      createdAt: new Date(),
      lastAccessed: new Date(),
      lastReinforced: new Date(),
      accessCount: 0,
      reinforceCount: 0,
      embedding,
    };
    
    // Store embedding as buffer if present
    const embeddingBuffer = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;

    db.prepare(`
      INSERT INTO jarvis_persistent_memory (
        id, user_id, content, type, category, importance,
        strength, keywords, entities, source, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, content, memory.type, memory.category, memory.importance,
      1.0, JSON.stringify(keywords), JSON.stringify(entities), memory.source,
      embeddingBuffer
    );
    
    auditLog('MEMORY_STORED', { 
      memoryId: id, 
      userId, 
      type: memory.type,
      category: memory.category,
    });
    
    return memory;
  }

  /**
   * Recall memories matching a query
   */
  async recall(
    userId: string,
    query: string,
    options: {
      category?: MemoryCategory;
      type?: MemoryType;
      minStrength?: number;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    const db = getDatabase();
    const minStrength = options.minStrength || this.minStrength;
    const limit = options.limit || 10;

    // Generate query embedding
    let queryEmbedding: number[] | undefined;
    try {
      const provider = await LLMFactory.getProvider();
      queryEmbedding = await provider.embed(query);
    } catch (e) {
      logger.warn('Failed to generate query embedding', { error: e });
    }
    
    // Retrieve candidates from DB (filter by type/category first)
    let sql = `
      SELECT * FROM jarvis_persistent_memory 
      WHERE user_id = ? AND strength >= ?
    `;
    const params: any[] = [userId, minStrength];
    
    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    
    const rows = db.prepare(sql).all(...params) as any[];
    
    // Calculate scores (Hybrid: Keyword + Semantic + Importance + Recency)
    const scored = rows.map(row => {
      const memory = this.rowToMemory(row);
      let score = 0;

      // 1. Semantic Similarity
      if (queryEmbedding && memory.embedding) {
        const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);
        score += similarity * 0.6; // 60% weight
      }

      // 2. Keyword Match
      const keywords = this.extractKeywords(query);
      const matches = keywords.filter(k => memory.content.toLowerCase().includes(k)).length;
      if (matches > 0) {
        score += (matches / keywords.length) * 0.2; // 20% weight
      }

      // 3. Importance & Strength
      score += (memory.importance / 10) * memory.strength * 0.1; // 10% weight

      // 4. Recency (boost if accessed recently)
      const hoursSinceAccess = (Date.now() - memory.lastAccessed.getTime()) / (1000 * 60 * 60);
      if (hoursSinceAccess < 24) {
        score += 0.1; // 10% boost
      }

      return { memory, score };
    });
    
    // Sort and limit
    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.memory);
    
    // Update access counts
    for (const mem of results) {
      db.prepare(`
        UPDATE jarvis_persistent_memory SET
          access_count = access_count + 1,
          last_accessed = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(mem.id);
    }
    
    return results;
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Reinforce a memory (strengthens it)
   */
  async reinforce(memoryId: string): Promise<void> {
    const db = getDatabase();
    const memory = await this.getById(memoryId);
    if (!memory) return;
    
    const boost = REINFORCE_BOOST[memory.type];
    const newStrength = Math.min(1.0, memory.strength + boost);
    
    db.prepare(`
      UPDATE jarvis_persistent_memory SET
        strength = ?,
        reinforce_count = reinforce_count + 1,
        last_reinforced = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStrength, memoryId);
    
    // If reinforced enough, promote to longer-term memory
    const row = db.prepare('SELECT reinforce_count, type FROM jarvis_persistent_memory WHERE id = ?').get(memoryId) as any;
    
    if (row && row.reinforce_count >= 5 && row.type === 'ephemeral') {
      await this.promoteMemory(memoryId, 'working');
    } else if (row && row.reinforce_count >= 10 && row.type === 'working') {
      await this.promoteMemory(memoryId, 'long_term');
    }
  }

  /**
   * Promote a memory to a longer-term type
   */
  async promoteMemory(memoryId: string, newType: MemoryType): Promise<void> {
    const db = getDatabase();
    db.prepare('UPDATE jarvis_persistent_memory SET type = ? WHERE id = ?').run(newType, memoryId);
    
    auditLog('MEMORY_PROMOTED', { memoryId, newType });
  }

  /**
   * Apply decay to all memories
   */
  async applyDecay(): Promise<{ decayed: number; pruned: number }> {
    const db = getDatabase();
    
    // Apply decay based on memory type
    let decayed = 0;
    for (const [type, rate] of Object.entries(DECAY_RATES)) {
      if (rate === 0) continue;
      
      const result = db.prepare(`
        UPDATE jarvis_persistent_memory SET
          strength = MAX(0, strength - (
            (julianday('now') - julianday(last_accessed)) * 24 * ?
          ))
        WHERE type = ? AND strength > 0
      `).run(rate, type);
      
      decayed += result.changes;
    }
    
    // Prune memories below minimum strength
    const pruned = db.prepare(`
      DELETE FROM jarvis_persistent_memory 
      WHERE strength < ? AND type != 'permanent'
    `).run(this.minStrength);
    
    if (pruned.changes > 0) {
      auditLog('MEMORIES_PRUNED', { count: pruned.changes });
    }
    
    return { decayed, pruned: pruned.changes };
  }

  /**
   * Forget a memory
   */
  async forget(memoryId: string): Promise<void> {
    const db = getDatabase();
    db.prepare('DELETE FROM jarvis_persistent_memory WHERE id = ?').run(memoryId);
    auditLog('MEMORY_FORGOTTEN', { memoryId });
  }

  /**
   * Forget memories matching a query
   */
  async forgetMatching(userId: string, query: string): Promise<number> {
    const db = getDatabase();
    const result = db.prepare(`
      DELETE FROM jarvis_persistent_memory 
      WHERE user_id = ? AND content LIKE ? AND type != 'permanent'
    `).run(userId, `%${query}%`);
    
    if (result.changes > 0) {
      auditLog('MEMORIES_FORGOTTEN', { userId, query, count: result.changes });
    }
    
    return result.changes;
  }

  /**
   * Get memory by ID
   */
  async getById(memoryId: string): Promise<Memory | null> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM jarvis_persistent_memory WHERE id = ?').get(memoryId) as any;
    return row ? this.rowToMemory(row) : null;
  }

  /**
   * Find similar existing memory
   */
  private async findSimilar(userId: string, content: string, embedding?: number[]): Promise<Memory | null> {
    const db = getDatabase();
    const normalized = content.toLowerCase().trim();
    
    // 1. Exact match
    const row = db.prepare(`
      SELECT * FROM jarvis_persistent_memory 
      WHERE user_id = ? AND LOWER(content) = ?
    `).get(userId, normalized) as any;
    
    if (row) return this.rowToMemory(row);

    // 2. High semantic similarity (deduplication)
    if (embedding) {
      const candidates = db.prepare(`
        SELECT * FROM jarvis_persistent_memory
        WHERE user_id = ? AND embedding IS NOT NULL
      `).all(userId) as any[];

      for (const candidate of candidates) {
        const mem = this.rowToMemory(candidate);
        if (mem.embedding) {
          const sim = this.cosineSimilarity(embedding, mem.embedding);
          if (sim > 0.95) { // Very high threshold for dedupe
            return mem;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get preferences for a user
   */
  async getPreferences(userId: string): Promise<Memory[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_persistent_memory 
      WHERE user_id = ? AND category = 'preference' AND strength >= ?
      ORDER BY importance DESC, strength DESC
    `).all(userId, this.minStrength) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Get habits for a user
   */
  async getHabits(userId: string): Promise<Memory[]> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jarvis_persistent_memory 
      WHERE user_id = ? AND category = 'habit' AND strength >= ?
      ORDER BY reinforce_count DESC
    `).all(userId, this.minStrength) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Get memory summary for LLM context
   */
  async getContextSummary(userId: string): Promise<string> {
    const preferences = await this.getPreferences(userId);
    const habits = await this.getHabits(userId);
    
    const parts: string[] = [];
    
    if (preferences.length > 0) {
      parts.push('Preferences: ' + preferences.slice(0, 5).map(p => p.content).join('; '));
    }
    
    if (habits.length > 0) {
      parts.push('Habits: ' + habits.slice(0, 5).map(h => h.content).join('; '));
    }
    
    return parts.join('\n') || 'No significant memories.';
  }

  /**
   * Get memory statistics
   */
  async getStats(userId: string): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
    byCategory: Record<MemoryCategory, number>;
    averageStrength: number;
  }> {
    const db = getDatabase();
    
    const total = (db.prepare(
      'SELECT COUNT(*) as count FROM jarvis_persistent_memory WHERE user_id = ?'
    ).get(userId) as any).count;
    
    const typeRows = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM jarvis_persistent_memory WHERE user_id = ? 
      GROUP BY type
    `).all(userId) as any[];
    
    const categoryRows = db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM jarvis_persistent_memory WHERE user_id = ? 
      GROUP BY category
    `).all(userId) as any[];
    
    const avgStrength = (db.prepare(`
      SELECT AVG(strength) as avg FROM jarvis_persistent_memory WHERE user_id = ?
    `).get(userId) as any).avg || 0;
    
    const byType: Record<string, number> = {};
    typeRows.forEach(r => byType[r.type] = r.count);
    
    const byCategory: Record<string, number> = {};
    categoryRows.forEach(r => byCategory[r.category] = r.count);
    
    return {
      total,
      byType: byType as Record<MemoryType, number>,
      byCategory: byCategory as Record<MemoryCategory, number>,
      averageStrength: avgStrength,
    };
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'to', 'of', 'in', 'for', 'on',
      'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'and', 'but', 'if', 'or', 'because', 'that', 'this', 'i', 'me',
      'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
    ]);
    
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
      .slice(0, 10);
  }

  /**
   * Extract entities from text
   */
  private extractEntities(text: string): string[] {
    // Simple proper noun extraction
    const words = text.split(/\s+/);
    const entities: string[] = [];
    
    for (const word of words) {
      // Check if word starts with capital (potential proper noun)
      if (/^[A-Z][a-z]+/.test(word)) {
        entities.push(word);
      }
    }
    
    return [...new Set(entities)].slice(0, 10);
  }

  /**
   * Convert database row to Memory object
   */
  private rowToMemory(row: any): Memory {
    let embedding: number[] | undefined;
    if (row.embedding) {
      // Decode BLOB to number array
      embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
    }

    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      type: row.type,
      category: row.category,
      importance: row.importance,
      strength: row.strength,
      keywords: JSON.parse(row.keywords),
      entities: JSON.parse(row.entities),
      source: row.source,
      createdAt: new Date(row.created_at),
      lastAccessed: new Date(row.last_accessed),
      lastReinforced: new Date(row.last_reinforced),
      accessCount: row.access_count,
      reinforceCount: row.reinforce_count,
      embedding,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const memoryManager = new MemoryManager();
