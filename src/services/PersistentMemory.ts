/**
 * PERSISTENT MEMORY SYSTEM
 * Long-term memory that persists across sessions
 * 
 * Architecture:
 * - Primary storage: Server-side SQLite (when available)
 * - Local cache: localStorage (offline fallback)
 * - Sync: Bi-directional with last-writer-wins conflict resolution
 */

import { apiClient } from './APIClient';

const STORAGE_KEY = 'jarvis_memory';
const SYNC_KEY = 'jarvis_memory_sync';

export type MemoryType = 
  | 'FACT'           // "My wife's name is Sarah"
  | 'PREFERENCE'     // "I like my coffee black"
  | 'RELATIONSHIP'   // "John is my boss"
  | 'PROJECT'        // "I'm working on the Smith proposal"
  | 'HABIT'          // "I usually wake up at 7am"
  | 'LOCATION'       // "My office is at 123 Main St"
  | 'SCHEDULE'       // "I have meetings every Monday at 10am"
  | 'HEALTH'         // "I'm allergic to peanuts"
  | 'IMPORTANT';     // Important dates, events

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  keywords: string[];
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  importance: number; // 1-10
  relatedMemories?: string[]; // IDs of related memories
  updatedAt?: string;  // ISO string for sync
  deleted?: boolean;   // Soft delete for sync
  synced?: boolean;    // Has been synced to server
}

export interface MemorySearchResult {
  memory: Memory;
  relevance: number;
}

interface SyncState {
  lastSyncTime: string | null;
  pendingChanges: string[]; // IDs of memories changed since last sync
}

export class PersistentMemory {
  private memories: Memory[] = [];
  private syncState: SyncState = { lastSyncTime: null, pendingChanges: [] };
  private syncInProgress: boolean = false;

  constructor() {
    this.load();
    // Attempt server sync on init
    this.syncWithServer().catch(console.error);
  }

  private load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.memories = JSON.parse(saved);
      }
      
      const syncSaved = localStorage.getItem(SYNC_KEY);
      if (syncSaved) {
        this.syncState = JSON.parse(syncSaved);
      }
    } catch (error) {
      console.error('[Memory] Failed to load:', error);
      this.memories = [];
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memories));
      localStorage.setItem(SYNC_KEY, JSON.stringify(this.syncState));
    } catch (error) {
      console.error('[Memory] Failed to save:', error);
    }
  }

  /**
   * Sync with server (bi-directional)
   */
  public async syncWithServer(): Promise<{ synced: number; conflicts: number }> {
    if (this.syncInProgress || !apiClient.isAuthenticated()) {
      return { synced: 0, conflicts: 0 };
    }

    this.syncInProgress = true;

    try {
      // Prepare local changes to send
      const localChanges = this.memories
        .filter(m => this.syncState.pendingChanges.includes(m.id))
        .map(m => ({
          id: m.id,
          type: m.type.toLowerCase(),
          content: m.content,
          keywords: m.keywords,
          source: 'client',
          deleted: m.deleted,
          updated_at: m.updatedAt || new Date().toISOString(),
        }));

      // Request sync
      const response = await apiClient.syncMemory(
        this.syncState.lastSyncTime || undefined,
        localChanges.length > 0 ? localChanges : undefined
      );

      // Apply server changes
      let synced = 0;
      for (const serverMemory of response.serverChanges) {
        const existing = this.memories.find(m => m.id === serverMemory.id);
        
        if (existing) {
          // Update existing
          existing.content = serverMemory.content;
          existing.type = serverMemory.type.toUpperCase() as MemoryType;
          existing.keywords = serverMemory.keywords || [];
          existing.updatedAt = serverMemory.updated_at;
          existing.synced = true;
        } else {
          // Add new from server
          this.memories.push({
            id: serverMemory.id,
            type: serverMemory.type.toUpperCase() as MemoryType,
            content: serverMemory.content,
            keywords: serverMemory.keywords || [],
            createdAt: new Date(serverMemory.created_at).getTime(),
            lastAccessed: Date.now(),
            accessCount: 1,
            importance: 5,
            updatedAt: serverMemory.updated_at,
            synced: true,
          });
        }
        synced++;
      }

      // Clear pending changes for successfully synced items
      this.syncState.pendingChanges = this.syncState.pendingChanges.filter(
        id => !localChanges.some(c => c.id === id)
      );
      this.syncState.lastSyncTime = response.syncTime;

      this.save();

      console.log(`[Memory] Synced ${synced} changes, ${response.conflicts.length} conflicts`);
      return { synced, conflicts: response.conflicts.length };

    } catch (error) {
      console.error('[Memory] Sync failed:', error);
      return { synced: 0, conflicts: 0 };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Mark memory as changed (needs sync)
   */
  private markChanged(id: string) {
    if (!this.syncState.pendingChanges.includes(id)) {
      this.syncState.pendingChanges.push(id);
    }
  }

  /**
   * Extract keywords from content
   */
  private extractKeywords(content: string): string[] {
    // Remove common words and extract meaningful keywords
    const stopWords = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'yours',
      'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them',
      'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
      'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as',
      'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about',
      'against', 'between', 'into', 'through', 'during', 'before',
      'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
      'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'called',
      'named', 'like', 'usually', 'always', 'never', 'sometimes'
    ]);

    const words = content.toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Get unique words
    return [...new Set(words)];
  }

  /**
   * Detect memory type from content
   */
  private detectType(content: string): MemoryType {
    const lower = content.toLowerCase();
    
    if (lower.includes('wife') || lower.includes('husband') || lower.includes('boss') || 
        lower.includes('friend') || lower.includes('brother') || lower.includes('sister') ||
        lower.includes('mother') || lower.includes('father') || lower.includes('colleague')) {
      return 'RELATIONSHIP';
    }
    
    if (lower.includes('like') || lower.includes('prefer') || lower.includes('favorite') ||
        lower.includes('hate') || lower.includes('love')) {
      return 'PREFERENCE';
    }
    
    if (lower.includes('project') || lower.includes('working on') || lower.includes('deadline')) {
      return 'PROJECT';
    }
    
    if (lower.includes('usually') || lower.includes('always') || lower.includes('every day') ||
        lower.includes('routine') || lower.includes('habit')) {
      return 'HABIT';
    }
    
    if (lower.includes('address') || lower.includes('office') || lower.includes('live') ||
        lower.includes('located') || lower.includes('street')) {
      return 'LOCATION';
    }
    
    if (lower.includes('meeting') || lower.includes('every monday') || lower.includes('schedule') ||
        lower.includes('weekly') || lower.includes('monthly')) {
      return 'SCHEDULE';
    }
    
    if (lower.includes('allergic') || lower.includes('allergy') || lower.includes('condition') ||
        lower.includes('medication') || lower.includes('doctor')) {
      return 'HEALTH';
    }
    
    if (lower.includes('birthday') || lower.includes('anniversary') || lower.includes('important')) {
      return 'IMPORTANT';
    }
    
    return 'FACT';
  }

  /**
   * Remember something
   */
  public remember(content: string, type?: MemoryType, importance: number = 5): Memory {
    const keywords = this.extractKeywords(content);
    const detectedType = type || this.detectType(content);
    
    // Check if similar memory exists
    const existing = this.findSimilar(content);
    if (existing) {
      // Update existing memory
      existing.content = content;
      existing.lastAccessed = Date.now();
      existing.accessCount++;
      existing.importance = Math.max(existing.importance, importance);
      existing.updatedAt = new Date().toISOString();
      existing.synced = false;
      this.markChanged(existing.id);
      this.save();
      
      // Trigger background sync
      this.syncWithServer().catch(console.error);
      
      return existing;
    }

    const memory: Memory = {
      id: crypto.randomUUID(),
      type: detectedType,
      content,
      keywords,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
      importance,
      updatedAt: new Date().toISOString(),
      synced: false,
    };

    this.memories.push(memory);
    this.markChanged(memory.id);
    this.save();
    
    // Trigger background sync
    this.syncWithServer().catch(console.error);
    
    return memory;
  }

  /**
   * Find similar existing memory
   */
  private findSimilar(content: string): Memory | null {
    const keywords = this.extractKeywords(content);
    if (keywords.length === 0) return null;

    for (const memory of this.memories) {
      const overlap = memory.keywords.filter(k => keywords.includes(k));
      // If more than 60% keywords overlap, consider it similar
      if (overlap.length >= keywords.length * 0.6) {
        return memory;
      }
    }

    return null;
  }

  /**
   * Search memories by query
   */
  public search(query: string, limit: number = 5): MemorySearchResult[] {
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return [];

    const results: MemorySearchResult[] = [];

    for (const memory of this.memories) {
      // Calculate relevance based on keyword match
      const matchedKeywords = memory.keywords.filter(k => 
        keywords.some(qk => k.includes(qk) || qk.includes(k))
      );
      
      if (matchedKeywords.length > 0) {
        const keywordScore = matchedKeywords.length / keywords.length;
        const recencyScore = Math.min(1, (Date.now() - memory.lastAccessed) / (30 * 24 * 60 * 60 * 1000));
        const importanceScore = memory.importance / 10;
        
        // Combined relevance score
        const relevance = (keywordScore * 0.5) + (importanceScore * 0.3) + ((1 - recencyScore) * 0.2);
        
        results.push({ memory, relevance });
        
        // Update access stats
        memory.lastAccessed = Date.now();
        memory.accessCount++;
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);
    
    if (results.length > 0) {
      this.save(); // Save updated access stats
    }

    return results.slice(0, limit);
  }

  /**
   * Get memories by type
   */
  public getByType(type: MemoryType): Memory[] {
    return this.memories.filter(m => m.type === type);
  }

  /**
   * Get all memories
   */
  public getAll(): Memory[] {
    return [...this.memories];
  }

  /**
   * Get important memories
   */
  public getImportant(minImportance: number = 7): Memory[] {
    return this.memories.filter(m => m.importance >= minImportance);
  }

  /**
   * Forget a specific memory
   */
  public forget(id: string): boolean {
    const memory = this.memories.find(m => m.id === id);
    if (!memory) return false;
    
    // Soft delete for sync, then remove locally
    memory.deleted = true;
    memory.updatedAt = new Date().toISOString();
    memory.synced = false;
    this.markChanged(memory.id);
    
    // Remove from local array
    this.memories = this.memories.filter(m => m.id !== id);
    this.save();
    
    // Trigger sync to propagate delete
    this.syncWithServer().catch(console.error);
    
    return true;
  }

  /**
   * Forget memories matching a query
   */
  public forgetByQuery(query: string): number {
    const results = this.search(query, 100);
    let forgotten = 0;
    
    for (const { memory } of results) {
      if (this.forget(memory.id)) {
        forgotten++;
      }
    }
    
    return forgotten;
  }

  /**
   * Clear all memories
   */
  public clearAll(): void {
    this.memories = [];
    this.save();
  }

  /**
   * Get memory context for LLM
   * Returns relevant memories formatted for injection into system prompt
   */
  public getContextForQuery(query: string): string {
    const relevant = this.search(query, 5);
    
    if (relevant.length === 0) return '';

    const memoryStrings = relevant.map(r => `- ${r.memory.content}`);
    
    return `Relevant information about the user:\n${memoryStrings.join('\n')}`;
  }

  /**
   * Get summary of all memories for system prompt
   */
  public getSummary(): string {
    if (this.memories.length === 0) return '';

    const byType: Record<string, string[]> = {};
    
    for (const memory of this.memories) {
      if (!byType[memory.type]) {
        byType[memory.type] = [];
      }
      byType[memory.type].push(memory.content);
    }

    const sections: string[] = [];
    
    if (byType['RELATIONSHIP']?.length) {
      sections.push(`Relationships: ${byType['RELATIONSHIP'].slice(0, 3).join('; ')}`);
    }
    if (byType['PREFERENCE']?.length) {
      sections.push(`Preferences: ${byType['PREFERENCE'].slice(0, 3).join('; ')}`);
    }
    if (byType['FACT']?.length) {
      sections.push(`Facts: ${byType['FACT'].slice(0, 3).join('; ')}`);
    }
    if (byType['PROJECT']?.length) {
      sections.push(`Current projects: ${byType['PROJECT'].slice(0, 2).join('; ')}`);
    }
    if (byType['HEALTH']?.length) {
      sections.push(`Health notes: ${byType['HEALTH'].join('; ')}`);
    }

    return sections.join('\n');
  }

  /**
   * Export memories
   */
  public export(): string {
    return JSON.stringify(this.memories, null, 2);
  }

  /**
   * Import memories
   */
  public import(json: string): boolean {
    try {
      const imported = JSON.parse(json);
      if (Array.isArray(imported)) {
        this.memories = imported;
        this.save();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
