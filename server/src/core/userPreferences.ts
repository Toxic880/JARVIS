/**
 * User Preferences & Risk Tolerance
 * 
 * Users have different comfort levels with autonomy.
 * Jarvis should learn and respect these preferences.
 */

import { getDatabase } from '../db/init';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface UserPreferences {
  userId: string;
  
  // Risk tolerance (0-100)
  // 0 = always ask, 100 = full autonomy
  riskTolerance: number;
  
  // Per-category overrides
  categoryTolerances: {
    deviceControl: number;
    fileOperations: number;
    networkRequests: number;
    notifications: number;
    dataModification: number;
  };
  
  // Autonomy settings
  autonomy: {
    // Allow autonomous actions at all?
    enabled: boolean;
    // Max risk level for auto-execution
    maxAutoRisk: 'none' | 'low' | 'medium';
    // Require confirmation for external impact?
    confirmExternal: boolean;
    // Require confirmation for irreversible actions?
    confirmIrreversible: boolean;
  };
  
  // Interruption preferences
  interruptions: {
    // Quiet hours
    quietHoursStart: number; // 0-23
    quietHoursEnd: number;
    // Focus mode apps (don't interrupt when using these)
    focusApps: string[];
    // Max interruptions per hour
    maxPerHour: number;
  };
  
  // Voice/communication style
  communication: {
    verbosity: 'minimal' | 'normal' | 'detailed';
    formality: 'casual' | 'neutral' | 'formal';
    proactivity: 'reactive' | 'balanced' | 'proactive';
  };
  
  // Learning
  learning: {
    // Track patterns for personalization?
    trackPatterns: boolean;
    // Remember preferences?
    rememberPreferences: boolean;
    // Suggest based on history?
    enableSuggestions: boolean;
  };
}

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'userId'> = {
  riskTolerance: 30, // Conservative by default
  
  categoryTolerances: {
    deviceControl: 40,
    fileOperations: 20,
    networkRequests: 30,
    notifications: 80,
    dataModification: 25,
  },
  
  autonomy: {
    enabled: true,
    maxAutoRisk: 'low',
    confirmExternal: true,
    confirmIrreversible: true,
  },
  
  interruptions: {
    quietHoursStart: 22,
    quietHoursEnd: 7,
    focusApps: ['code', 'vscode', 'intellij', 'ableton', 'pro tools'],
    maxPerHour: 15,
  },
  
  communication: {
    verbosity: 'normal',
    formality: 'neutral',
    proactivity: 'balanced',
  },
  
  learning: {
    trackPatterns: true,
    rememberPreferences: true,
    enableSuggestions: true,
  },
};

// =============================================================================
// DATABASE
// =============================================================================

function ensureTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS jarvis_user_preferences (
      user_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

let tableInitialized = false;

// =============================================================================
// PREFERENCE MANAGER
// =============================================================================

export class PreferenceManager {
  private cache: Map<string, UserPreferences> = new Map();

  constructor() {
    if (!tableInitialized) {
      try {
        ensureTable();
        tableInitialized = true;
      } catch (e) {
        // DB might not be ready
      }
    }
  }

  /**
   * Get user preferences
   */
  getPreferences(userId: string): UserPreferences {
    // Check cache
    if (this.cache.has(userId)) {
      return this.cache.get(userId)!;
    }

    const db = getDatabase();
    const row = db.prepare(
      'SELECT preferences FROM jarvis_user_preferences WHERE user_id = ?'
    ).get(userId) as { preferences: string } | undefined;

    let prefs: UserPreferences;
    
    if (row) {
      prefs = { ...DEFAULT_PREFERENCES, ...JSON.parse(row.preferences), userId };
    } else {
      prefs = { ...DEFAULT_PREFERENCES, userId };
    }

    this.cache.set(userId, prefs);
    return prefs;
  }

  /**
   * Update user preferences
   */
  updatePreferences(userId: string, updates: Partial<Omit<UserPreferences, 'userId'>>): UserPreferences {
    const current = this.getPreferences(userId);
    const updated = this.deepMerge(current, updates) as UserPreferences;
    
    const db = getDatabase();
    const { userId: _, ...prefsWithoutId } = updated;
    
    db.prepare(`
      INSERT INTO jarvis_user_preferences (user_id, preferences, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET 
        preferences = excluded.preferences,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, JSON.stringify(prefsWithoutId));

    this.cache.set(userId, updated);
    
    auditLog('PREFERENCES_UPDATED', { userId, updates: Object.keys(updates) });
    
    return updated;
  }

  /**
   * Check if action should be auto-approved based on preferences
   */
  shouldAutoApprove(
    userId: string,
    action: {
      riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
      category?: keyof UserPreferences['categoryTolerances'];
      hasExternalImpact: boolean;
      isReversible: boolean;
    }
  ): { approved: boolean; reason: string } {
    const prefs = this.getPreferences(userId);

    // Autonomy disabled
    if (!prefs.autonomy.enabled) {
      return { approved: false, reason: 'Autonomy is disabled' };
    }

    // Risk level check
    const riskLevels = ['none', 'low', 'medium', 'high', 'critical'];
    const maxAutoIndex = riskLevels.indexOf(prefs.autonomy.maxAutoRisk);
    const actionIndex = riskLevels.indexOf(action.riskLevel);
    
    if (actionIndex > maxAutoIndex) {
      return { 
        approved: false, 
        reason: `Risk level ${action.riskLevel} exceeds max auto-approve level ${prefs.autonomy.maxAutoRisk}` 
      };
    }

    // External impact check
    if (action.hasExternalImpact && prefs.autonomy.confirmExternal) {
      return { approved: false, reason: 'External impact requires confirmation' };
    }

    // Reversibility check
    if (!action.isReversible && prefs.autonomy.confirmIrreversible) {
      return { approved: false, reason: 'Irreversible action requires confirmation' };
    }

    // Category-specific tolerance
    if (action.category) {
      const tolerance = prefs.categoryTolerances[action.category];
      const riskScore = actionIndex * 25; // 0, 25, 50, 75, 100
      
      if (riskScore > tolerance) {
        return { 
          approved: false, 
          reason: `Category ${action.category} risk (${riskScore}) exceeds tolerance (${tolerance})` 
        };
      }
    }

    return { approved: true, reason: 'Within user tolerance' };
  }

  /**
   * Get interruption allowance
   */
  canInterrupt(
    userId: string,
    context: { currentApp?: string; urgency: number }
  ): { allowed: boolean; reason: string } {
    const prefs = this.getPreferences(userId);
    
    // Check quiet hours
    const now = new Date();
    const hour = now.getHours();
    const { quietHoursStart, quietHoursEnd } = prefs.interruptions;
    
    const inQuietHours = quietHoursStart < quietHoursEnd
      ? hour >= quietHoursStart && hour < quietHoursEnd
      : hour >= quietHoursStart || hour < quietHoursEnd;
    
    if (inQuietHours && context.urgency < 8) {
      return { allowed: false, reason: 'Quiet hours active' };
    }

    // Check focus apps
    if (context.currentApp) {
      const appLower = context.currentApp.toLowerCase();
      const inFocusApp = prefs.interruptions.focusApps.some(
        app => appLower.includes(app.toLowerCase())
      );
      
      if (inFocusApp && context.urgency < 7) {
        return { allowed: false, reason: `Focus app detected: ${context.currentApp}` };
      }
    }

    return { allowed: true, reason: 'Interruption allowed' };
  }

  /**
   * Record user feedback to adjust tolerance
   */
  recordFeedback(
    userId: string,
    feedback: {
      actionType: string;
      wasHelpful: boolean;
      wasIntrusive: boolean;
      category?: keyof UserPreferences['categoryTolerances'];
    }
  ): void {
    const prefs = this.getPreferences(userId);
    
    // Adjust tolerance based on feedback
    if (feedback.category) {
      const current = prefs.categoryTolerances[feedback.category];
      let adjustment = 0;
      
      if (feedback.wasHelpful && !feedback.wasIntrusive) {
        adjustment = 2; // Increase tolerance
      } else if (feedback.wasIntrusive) {
        adjustment = -5; // Decrease tolerance more aggressively
      }
      
      if (adjustment !== 0) {
        const newTolerance = Math.max(0, Math.min(100, current + adjustment));
        this.updatePreferences(userId, {
          categoryTolerances: {
            ...prefs.categoryTolerances,
            [feedback.category]: newTolerance,
          },
        });
        
        logger.debug('Tolerance adjusted', {
          userId,
          category: feedback.category,
          from: current,
          to: newTolerance,
        });
      }
    }
  }

  /**
   * Get communication style settings
   */
  getCommunicationStyle(userId: string): UserPreferences['communication'] {
    return this.getPreferences(userId).communication;
  }

  /**
   * Reset to defaults
   */
  resetToDefaults(userId: string): UserPreferences {
    const prefs = { ...DEFAULT_PREFERENCES, userId };
    
    const db = getDatabase();
    db.prepare('DELETE FROM jarvis_user_preferences WHERE user_id = ?').run(userId);
    
    this.cache.delete(userId);
    
    auditLog('PREFERENCES_RESET', { userId });
    
    return prefs;
  }

  /**
   * Deep merge helper
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const preferenceManager = new PreferenceManager();
