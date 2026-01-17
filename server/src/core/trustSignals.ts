/**
 * User-Visible Trust Signals
 * 
 * Trust isn't optional. Users need to see:
 * - "Jarvis is viewing your screen" indicator
 * - Clear permission boundaries
 * - Full action history
 * - What's happening and why
 * 
 * This module manages trust indicators and transparency.
 */

import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// TYPES
// =============================================================================

export type ActivityType = 
  | 'screen_view'      // Viewing screen content
  | 'audio_listen'     // Listening to audio
  | 'action_execute'   // Executing an action
  | 'data_access'      // Accessing user data
  | 'external_call'    // Making external API call
  | 'learning';        // Learning from interaction

export interface ActiveIndicator {
  type: ActivityType;
  description: string;
  startedAt: Date;
  target?: string;
  sensitive: boolean;
}

export interface PermissionBoundary {
  permission: string;
  granted: boolean;
  scope: string;
  grantedAt?: Date;
  grantedBy?: string;
  expiresAt?: Date;
  usageCount: number;
  lastUsed?: Date;
}

export interface ActionHistoryEntry {
  id: string;
  timestamp: Date;
  action: string;
  params: Record<string, any>;
  result: 'success' | 'failure' | 'pending' | 'cancelled';
  initiatedBy: 'user' | 'jarvis' | 'automation';
  approved: boolean;
  approvalMethod?: 'explicit' | 'pattern' | 'auto';
  duration: number;
  sideEffects: string[];
}

export interface TrustDashboard {
  // What Jarvis is actively doing
  activeIndicators: ActiveIndicator[];
  // Permission status
  permissions: PermissionBoundary[];
  // Recent actions
  recentActions: ActionHistoryEntry[];
  // Trust metrics
  metrics: {
    totalActions: number;
    successRate: number;
    autoApprovedRate: number;
    averageConfirmationTime: number;
  };
  // Active sessions
  activeSessions: {
    type: string;
    startedAt: Date;
  }[];
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

function ensureTrustTables(): void {
  const db = getDatabase();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_action_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      action TEXT NOT NULL,
      params TEXT DEFAULT '{}',
      result TEXT DEFAULT 'pending',
      initiated_by TEXT DEFAULT 'user',
      approved INTEGER DEFAULT 0,
      approval_method TEXT,
      duration_ms INTEGER DEFAULT 0,
      side_effects TEXT DEFAULT '[]'
    );
    
    CREATE TABLE IF NOT EXISTS jarvis_permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted INTEGER DEFAULT 0,
      scope TEXT DEFAULT '',
      granted_at DATETIME,
      granted_by TEXT,
      expires_at DATETIME,
      usage_count INTEGER DEFAULT 0,
      last_used DATETIME
    );
    
    CREATE INDEX IF NOT EXISTS idx_action_history_user ON jarvis_action_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_action_history_timestamp ON jarvis_action_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_permissions_user ON jarvis_permissions(user_id);
  `);
}

let tablesInitialized = false;
function initTables() {
  if (!tablesInitialized) {
    try {
      ensureTrustTables();
      tablesInitialized = true;
    } catch (e) {
      // Database might not be ready
    }
  }
}

// =============================================================================
// TRUST SIGNAL MANAGER
// =============================================================================

class TrustSignalManager {
  private activeIndicators: Map<string, ActiveIndicator> = new Map();
  
  constructor() {
    initTables();
  }

  // ===========================================================================
  // ACTIVITY INDICATORS
  // ===========================================================================

  /**
   * Start showing an activity indicator
   */
  startActivity(
    id: string,
    type: ActivityType,
    description: string,
    options: { target?: string; sensitive?: boolean } = {}
  ): void {
    const indicator: ActiveIndicator = {
      type,
      description,
      startedAt: new Date(),
      target: options.target,
      sensitive: options.sensitive || false,
    };
    
    this.activeIndicators.set(id, indicator);
    
    auditLog('ACTIVITY_START', { id, type, description });
    
    // Emit event for UI
    this.emitIndicatorChange();
  }

  /**
   * Stop an activity indicator
   */
  stopActivity(id: string): void {
    if (this.activeIndicators.has(id)) {
      const indicator = this.activeIndicators.get(id)!;
      this.activeIndicators.delete(id);
      
      auditLog('ACTIVITY_STOP', { 
        id, 
        type: indicator.type, 
        duration: Date.now() - indicator.startedAt.getTime() 
      });
      
      this.emitIndicatorChange();
    }
  }

  /**
   * Get all active indicators
   */
  getActiveIndicators(): ActiveIndicator[] {
    return Array.from(this.activeIndicators.values());
  }

  /**
   * Check if any sensitive activity is active
   */
  hasSensitiveActivity(): boolean {
    for (const indicator of this.activeIndicators.values()) {
      if (indicator.sensitive) return true;
    }
    return false;
  }

  // ===========================================================================
  // ACTION HISTORY
  // ===========================================================================

  /**
   * Record an action in history
   */
  recordAction(
    userId: string,
    action: string,
    params: Record<string, any>,
    options: {
      initiatedBy?: 'user' | 'jarvis' | 'automation';
      approved?: boolean;
      approvalMethod?: 'explicit' | 'pattern' | 'auto';
    } = {}
  ): string {
    const db = getDatabase();
    const id = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    db.prepare(`
      INSERT INTO jarvis_action_history (
        id, user_id, action, params, initiated_by, approved, approval_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      action,
      JSON.stringify(params),
      options.initiatedBy || 'user',
      options.approved ? 1 : 0,
      options.approvalMethod || null
    );
    
    return id;
  }

  /**
   * Update action result
   */
  completeAction(
    actionId: string,
    result: 'success' | 'failure' | 'cancelled',
    duration: number,
    sideEffects: string[] = []
  ): void {
    const db = getDatabase();
    
    db.prepare(`
      UPDATE jarvis_action_history SET
        result = ?,
        duration_ms = ?,
        side_effects = ?
      WHERE id = ?
    `).run(result, duration, JSON.stringify(sideEffects), actionId);
  }

  /**
   * Get recent action history
   */
  getActionHistory(userId: string, limit = 50): ActionHistoryEntry[] {
    const db = getDatabase();
    
    const rows = db.prepare(`
      SELECT * FROM jarvis_action_history 
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(userId, limit) as any[];
    
    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      action: row.action,
      params: JSON.parse(row.params),
      result: row.result,
      initiatedBy: row.initiated_by,
      approved: row.approved === 1,
      approvalMethod: row.approval_method,
      duration: row.duration_ms,
      sideEffects: JSON.parse(row.side_effects),
    }));
  }

  /**
   * Get action by ID
   */
  getAction(actionId: string): ActionHistoryEntry | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM jarvis_action_history WHERE id = ?').get(actionId) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      action: row.action,
      params: JSON.parse(row.params),
      result: row.result,
      initiatedBy: row.initiated_by,
      approved: row.approved === 1,
      approvalMethod: row.approval_method,
      duration: row.duration_ms,
      sideEffects: JSON.parse(row.side_effects),
    };
  }

  // ===========================================================================
  // PERMISSIONS
  // ===========================================================================

  /**
   * Set permission status
   */
  setPermission(
    userId: string,
    permission: string,
    granted: boolean,
    options: {
      scope?: string;
      grantedBy?: string;
      expiresAt?: Date;
    } = {}
  ): void {
    const db = getDatabase();
    const id = `perm_${userId}_${permission}`;
    
    db.prepare(`
      INSERT OR REPLACE INTO jarvis_permissions (
        id, user_id, permission, granted, scope, granted_at, granted_by, expires_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `).run(
      id,
      userId,
      permission,
      granted ? 1 : 0,
      options.scope || '',
      options.grantedBy || null,
      options.expiresAt?.toISOString() || null
    );
    
    auditLog('PERMISSION_SET', { userId, permission, granted });
  }

  /**
   * Record permission usage
   */
  recordPermissionUsage(userId: string, permission: string): void {
    const db = getDatabase();
    
    db.prepare(`
      UPDATE jarvis_permissions SET
        usage_count = usage_count + 1,
        last_used = CURRENT_TIMESTAMP
      WHERE user_id = ? AND permission = ?
    `).run(userId, permission);
  }

  /**
   * Get permissions for user
   */
  getPermissions(userId: string): PermissionBoundary[] {
    const db = getDatabase();
    
    const rows = db.prepare(`
      SELECT * FROM jarvis_permissions WHERE user_id = ?
    `).all(userId) as any[];
    
    return rows.map(row => ({
      permission: row.permission,
      granted: row.granted === 1,
      scope: row.scope,
      grantedAt: row.granted_at ? new Date(row.granted_at) : undefined,
      grantedBy: row.granted_by,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      usageCount: row.usage_count,
      lastUsed: row.last_used ? new Date(row.last_used) : undefined,
    }));
  }

  /**
   * Check if permission is granted
   */
  hasPermission(userId: string, permission: string): boolean {
    const db = getDatabase();
    
    const row = db.prepare(`
      SELECT granted, expires_at FROM jarvis_permissions 
      WHERE user_id = ? AND permission = ?
    `).get(userId, permission) as any;
    
    if (!row || !row.granted) return false;
    
    // Check expiry
    if (row.expires_at) {
      const expiry = new Date(row.expires_at);
      if (expiry < new Date()) return false;
    }
    
    return true;
  }

  // ===========================================================================
  // TRUST DASHBOARD
  // ===========================================================================

  /**
   * Get complete trust dashboard
   */
  getTrustDashboard(userId: string): TrustDashboard {
    const db = getDatabase();
    
    // Get metrics
    const totalRow = db.prepare(`
      SELECT COUNT(*) as total FROM jarvis_action_history WHERE user_id = ?
    `).get(userId) as any;
    
    const successRow = db.prepare(`
      SELECT COUNT(*) as count FROM jarvis_action_history 
      WHERE user_id = ? AND result = 'success'
    `).get(userId) as any;
    
    const autoApprovedRow = db.prepare(`
      SELECT COUNT(*) as count FROM jarvis_action_history 
      WHERE user_id = ? AND approval_method IN ('auto', 'pattern')
    `).get(userId) as any;
    
    const total = totalRow?.total || 0;
    const successRate = total > 0 ? (successRow?.count || 0) / total : 0;
    const autoApprovedRate = total > 0 ? (autoApprovedRow?.count || 0) / total : 0;
    
    return {
      activeIndicators: this.getActiveIndicators(),
      permissions: this.getPermissions(userId),
      recentActions: this.getActionHistory(userId, 20),
      metrics: {
        totalActions: total,
        successRate,
        autoApprovedRate,
        averageConfirmationTime: 0, // Would need to track this
      },
      activeSessions: [],
    };
  }

  /**
   * Get human-readable activity status
   */
  getActivityStatus(): string {
    const indicators = this.getActiveIndicators();
    
    if (indicators.length === 0) {
      return 'Jarvis is idle';
    }
    
    const descriptions = indicators.map(i => i.description);
    return `Jarvis is: ${descriptions.join(', ')}`;
  }

  /**
   * Generate privacy notice
   */
  getPrivacyNotice(): string[] {
    const indicators = this.getActiveIndicators();
    const notices: string[] = [];
    
    for (const indicator of indicators) {
      switch (indicator.type) {
        case 'screen_view':
          notices.push(`🔍 Viewing: ${indicator.target || 'your screen'}`);
          break;
        case 'audio_listen':
          notices.push('🎤 Listening to audio');
          break;
        case 'data_access':
          notices.push(`📁 Accessing: ${indicator.target || 'data'}`);
          break;
        case 'external_call':
          notices.push(`🌐 Calling: ${indicator.target || 'external service'}`);
          break;
      }
    }
    
    return notices;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private emitIndicatorChange(): void {
    // Would emit WebSocket event to connected clients
    // For now, just log
    logger.debug('Indicators changed', { 
      count: this.activeIndicators.size,
      types: Array.from(this.activeIndicators.values()).map(i => i.type),
    });
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const trustSignals = new TrustSignalManager();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Wrap an activity with indicators
 */
export async function withActivityIndicator<T>(
  type: ActivityType,
  description: string,
  fn: () => Promise<T>,
  options: { target?: string; sensitive?: boolean } = {}
): Promise<T> {
  const id = `activity_${Date.now()}`;
  
  trustSignals.startActivity(id, type, description, options);
  
  try {
    return await fn();
  } finally {
    trustSignals.stopActivity(id);
  }
}

/**
 * Record and track an action
 */
export async function withActionTracking<T>(
  userId: string,
  action: string,
  params: Record<string, any>,
  fn: () => Promise<T>,
  options: {
    initiatedBy?: 'user' | 'jarvis' | 'automation';
    approved?: boolean;
    approvalMethod?: 'explicit' | 'pattern' | 'auto';
  } = {}
): Promise<T> {
  const actionId = trustSignals.recordAction(userId, action, params, options);
  const startTime = Date.now();
  
  try {
    const result = await fn();
    trustSignals.completeAction(actionId, 'success', Date.now() - startTime);
    return result;
  } catch (error) {
    trustSignals.completeAction(actionId, 'failure', Date.now() - startTime);
    throw error;
  }
}
