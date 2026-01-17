/**
 * World State Snapshots & Diffs
 * 
 * Tracks what changed and why:
 * - Before/after state for each action
 * - Causal attribution
 * - Rollback capability
 * - Learning from consequences
 */

import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// STATE SNAPSHOT
// =============================================================================

export interface StateSnapshot {
  id: string;
  timestamp: Date;
  state: Record<string, any>;
  trigger: {
    type: 'action' | 'user' | 'system' | 'external';
    actionId?: string;
    userId?: string;
    description: string;
  };
}

export interface StateDiff {
  path: string[];
  before: any;
  after: any;
  changeType: 'added' | 'modified' | 'removed';
}

export interface StateChange {
  id: string;
  snapshotBefore: string;
  snapshotAfter: string;
  diffs: StateDiff[];
  action: {
    name: string;
    params: Record<string, any>;
  };
  timestamp: Date;
  reversible: boolean;
  rolledBack: boolean;
}

// =============================================================================
// SNAPSHOT STORAGE
// =============================================================================

const snapshots: Map<string, StateSnapshot> = new Map();
const changes: Map<string, StateChange> = new Map();

// Keep last N snapshots in memory
const MAX_SNAPSHOTS = 100;
const MAX_CHANGES = 500;

function cleanupOldSnapshots(): void {
  if (snapshots.size > MAX_SNAPSHOTS) {
    const sorted = Array.from(snapshots.entries())
      .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
    
    const toRemove = sorted.slice(0, sorted.length - MAX_SNAPSHOTS);
    for (const [id] of toRemove) {
      snapshots.delete(id);
    }
  }
}

function cleanupOldChanges(): void {
  if (changes.size > MAX_CHANGES) {
    const sorted = Array.from(changes.entries())
      .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
    
    const toRemove = sorted.slice(0, sorted.length - MAX_CHANGES);
    for (const [id] of toRemove) {
      changes.delete(id);
    }
  }
}

// =============================================================================
// DIFF COMPUTATION
// =============================================================================

/**
 * Compute differences between two state objects
 */
export function computeDiff(before: Record<string, any>, after: Record<string, any>): StateDiff[] {
  const diffs: StateDiff[] = [];
  
  function compare(path: string[], obj1: any, obj2: any): void {
    // Get all keys from both objects
    const allKeys = new Set([
      ...Object.keys(obj1 || {}),
      ...Object.keys(obj2 || {}),
    ]);
    
    for (const key of allKeys) {
      const newPath = [...path, key];
      const val1 = obj1?.[key];
      const val2 = obj2?.[key];
      
      if (val1 === undefined && val2 !== undefined) {
        diffs.push({
          path: newPath,
          before: undefined,
          after: val2,
          changeType: 'added',
        });
      } else if (val1 !== undefined && val2 === undefined) {
        diffs.push({
          path: newPath,
          before: val1,
          after: undefined,
          changeType: 'removed',
        });
      } else if (typeof val1 === 'object' && typeof val2 === 'object' && val1 !== null && val2 !== null) {
        // Recursively compare nested objects
        if (Array.isArray(val1) && Array.isArray(val2)) {
          // For arrays, check if they're different
          if (JSON.stringify(val1) !== JSON.stringify(val2)) {
            diffs.push({
              path: newPath,
              before: val1,
              after: val2,
              changeType: 'modified',
            });
          }
        } else {
          compare(newPath, val1, val2);
        }
      } else if (val1 !== val2) {
        diffs.push({
          path: newPath,
          before: val1,
          after: val2,
          changeType: 'modified',
        });
      }
    }
  }
  
  compare([], before, after);
  return diffs;
}

// =============================================================================
// SNAPSHOT MANAGER
// =============================================================================

export class SnapshotManager {
  /**
   * Create a snapshot of current state
   */
  createSnapshot(
    state: Record<string, any>,
    trigger: StateSnapshot['trigger']
  ): StateSnapshot {
    const id = `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const snapshot: StateSnapshot = {
      id,
      timestamp: new Date(),
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      trigger,
    };
    
    snapshots.set(id, snapshot);
    cleanupOldSnapshots();
    
    return snapshot;
  }

  /**
   * Record a state change from an action
   */
  recordChange(
    beforeState: Record<string, any>,
    afterState: Record<string, any>,
    action: { name: string; params: Record<string, any> },
    userId?: string,
    reversible = true
  ): StateChange {
    // Create before snapshot
    const beforeSnapshot = this.createSnapshot(beforeState, {
      type: 'action',
      userId,
      description: `Before ${action.name}`,
    });
    
    // Create after snapshot
    const afterSnapshot = this.createSnapshot(afterState, {
      type: 'action',
      userId,
      description: `After ${action.name}`,
    });
    
    // Compute diffs
    const diffs = computeDiff(beforeState, afterState);
    
    const changeId = `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const change: StateChange = {
      id: changeId,
      snapshotBefore: beforeSnapshot.id,
      snapshotAfter: afterSnapshot.id,
      diffs,
      action,
      timestamp: new Date(),
      reversible,
      rolledBack: false,
    };
    
    changes.set(changeId, change);
    cleanupOldChanges();
    
    // Log significant changes
    if (diffs.length > 0) {
      auditLog('STATE_CHANGE', {
        changeId,
        action: action.name,
        diffCount: diffs.length,
        reversible,
      });
    }
    
    return change;
  }

  /**
   * Get a snapshot by ID
   */
  getSnapshot(id: string): StateSnapshot | null {
    return snapshots.get(id) || null;
  }

  /**
   * Get a change record by ID
   */
  getChange(id: string): StateChange | null {
    return changes.get(id) || null;
  }

  /**
   * Get recent changes
   */
  getRecentChanges(limit = 10): StateChange[] {
    return Array.from(changes.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get changes for a specific action
   */
  getChangesForAction(actionName: string): StateChange[] {
    return Array.from(changes.values())
      .filter(c => c.action.name === actionName)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Describe what changed in human-readable format
   */
  describeChange(change: StateChange): string {
    const descriptions: string[] = [];
    
    for (const diff of change.diffs) {
      const pathStr = diff.path.join('.');
      
      switch (diff.changeType) {
        case 'added':
          descriptions.push(`Added ${pathStr}: ${JSON.stringify(diff.after)}`);
          break;
        case 'removed':
          descriptions.push(`Removed ${pathStr}`);
          break;
        case 'modified':
          descriptions.push(`Changed ${pathStr} from ${JSON.stringify(diff.before)} to ${JSON.stringify(diff.after)}`);
          break;
      }
    }
    
    return descriptions.length > 0 
      ? descriptions.join('; ')
      : 'No observable changes';
  }

  /**
   * Get state at a specific point in time
   */
  getStateAt(timestamp: Date): Record<string, any> | null {
    // Find the most recent snapshot before the timestamp
    let closest: StateSnapshot | null = null;
    
    for (const snapshot of snapshots.values()) {
      if (snapshot.timestamp <= timestamp) {
        if (!closest || snapshot.timestamp > closest.timestamp) {
          closest = snapshot;
        }
      }
    }
    
    return closest?.state || null;
  }

  /**
   * Check if a change can be rolled back
   */
  canRollback(changeId: string): boolean {
    const change = changes.get(changeId);
    return change ? change.reversible && !change.rolledBack : false;
  }

  /**
   * Mark a change as rolled back
   */
  markRolledBack(changeId: string): void {
    const change = changes.get(changeId);
    if (change) {
      change.rolledBack = true;
      auditLog('STATE_ROLLBACK', { changeId, action: change.action.name });
    }
  }

  /**
   * Get changes that affected a specific path
   */
  getChangesAffectingPath(path: string[]): StateChange[] {
    const pathStr = path.join('.');
    
    return Array.from(changes.values())
      .filter(change => 
        change.diffs.some(d => d.path.join('.').startsWith(pathStr))
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get statistics about state changes
   */
  getStats(): {
    totalSnapshots: number;
    totalChanges: number;
    changesByAction: Record<string, number>;
    averageDiffsPerChange: number;
  } {
    const changesByAction: Record<string, number> = {};
    let totalDiffs = 0;
    
    for (const change of changes.values()) {
      changesByAction[change.action.name] = (changesByAction[change.action.name] || 0) + 1;
      totalDiffs += change.diffs.length;
    }
    
    return {
      totalSnapshots: snapshots.size,
      totalChanges: changes.size,
      changesByAction,
      averageDiffsPerChange: changes.size > 0 ? totalDiffs / changes.size : 0,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const snapshotManager = new SnapshotManager();
