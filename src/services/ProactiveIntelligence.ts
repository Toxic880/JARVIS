/**
 * ENHANCED PROACTIVE INTELLIGENCE
 * 
 * Smart, contextual alerts that combine multiple data sources:
 * - Calendar + Traffic = "Leave now to make your meeting"
 * - Weather + Calendar = "Bring umbrella for outdoor event"
 * - Health + Schedule = "Low recovery, consider rescheduling workout"
 * - Patterns + Time = "You usually order coffee around now"
 * - Email urgency + Context = "3 urgent emails from boss, you haven't responded"
 * 
 * This is what makes JARVIS actually useful vs basic alerts.
 */

import { HealthSummary } from './HealthService';

export interface SmartAlert {
  id: string;
  type: SmartAlertType;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  context: Record<string, any>; // Data that triggered the alert
  suggestedActions?: string[];
  expiresAt?: Date;
  dismissed: boolean;
  createdAt: Date;
}

export type SmartAlertType =
  | 'leave_now'           // Time to leave for appointment
  | 'weather_prep'        // Weather-related preparation
  | 'health_insight'      // Health/recovery based
  | 'email_urgent'        // Urgent emails need attention
  | 'pattern_reminder'    // Based on learned patterns
  | 'commute_update'      // Traffic/commute changes
  | 'meeting_prep'        // Upcoming meeting preparation
  | 'schedule_conflict'   // Calendar conflicts
  | 'low_battery'         // Device battery
  | 'home_security'       // Security alerts
  | 'package_arriving'    // Delivery updates
  | 'bill_due'            // Payment reminders
  | 'habit_streak'        // Habit tracking
  | 'social_reminder'     // "Haven't talked to X in a while"
  | 'custom';

export interface DataContext {
  calendar?: {
    nextEvent?: { title: string; startTime: Date; location?: string };
    todayEvents?: { title: string; startTime: Date }[];
  };
  weather?: {
    current: string;
    temperature: number;
    willRain: boolean;
    rainTime?: string;
    alerts?: string[];
  };
  health?: HealthSummary;
  traffic?: {
    homeToWork: number; // minutes
    currentDelay: number;
  };
  email?: {
    unreadCount: number;
    urgentCount: number;
    needsResponse: { from: string; subject: string; waitingDays: number }[];
  };
  patterns?: UserPattern[];
  location?: {
    isHome: boolean;
    isWork: boolean;
    current?: string;
  };
}

export interface UserPattern {
  type: 'time_based' | 'location_based' | 'sequence';
  description: string;
  trigger: string;
  action: string;
  confidence: number;
  lastTriggered?: Date;
}

export interface IntelligenceConfig {
  enableLeaveReminders: boolean;
  enableWeatherAlerts: boolean;
  enableHealthInsights: boolean;
  enableEmailDigest: boolean;
  enablePatternLearning: boolean;
  commutePrepTime: number; // minutes before event to alert
  morningBriefingTime: string; // HH:MM
  eveningReviewTime: string;
}

const DEFAULT_CONFIG: IntelligenceConfig = {
  enableLeaveReminders: true,
  enableWeatherAlerts: true,
  enableHealthInsights: true,
  enableEmailDigest: true,
  enablePatternLearning: true,
  commutePrepTime: 15, // Alert 15 min before you need to leave
  morningBriefingTime: '07:30',
  eveningReviewTime: '21:00',
};

export class ProactiveIntelligence {
  private config: IntelligenceConfig;
  private alerts: Map<string, SmartAlert> = new Map();
  private patterns: UserPattern[] = [];
  private lastContext: DataContext = {};
  private onAlert?: (alert: SmartAlert) => void;
  private checkInterval?: NodeJS.Timeout;
  private dataProviders: {
    getCalendar?: () => Promise<DataContext['calendar']>;
    getWeather?: () => Promise<DataContext['weather']>;
    getHealth?: () => Promise<HealthSummary | null>;
    getTraffic?: (origin: string, dest: string) => Promise<number>;
    getEmail?: () => Promise<DataContext['email']>;
    getLocation?: () => Promise<DataContext['location']>;
  } = {};

  constructor(
    config?: Partial<IntelligenceConfig>,
    onAlert?: (alert: SmartAlert) => void
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onAlert = onAlert;
    this.loadState();
  }

  private loadState() {
    const saved = localStorage.getItem('jarvis_intelligence');
    if (saved) {
      const state = JSON.parse(saved);
      this.patterns = state.patterns || [];
      this.config = { ...this.config, ...state.config };
    }
  }

  private saveState() {
    localStorage.setItem('jarvis_intelligence', JSON.stringify({
      patterns: this.patterns,
      config: this.config,
    }));
  }

  /**
   * Register data providers
   */
  setDataProviders(providers: typeof this.dataProviders) {
    this.dataProviders = { ...this.dataProviders, ...providers };
  }

  /**
   * Start the intelligence engine
   */
  start(): void {
    // Run analysis every 5 minutes
    this.checkInterval = setInterval(() => {
      this.analyze();
    }, 5 * 60 * 1000);

    // Run initial analysis
    setTimeout(() => this.analyze(), 5000);
  }

  /**
   * Stop the engine
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Main analysis function - runs periodically
   */
  async analyze(): Promise<void> {
    try {
      // Gather context
      const context = await this.gatherContext();
      this.lastContext = context;

      // Run all analyzers
      const newAlerts: SmartAlert[] = [];

      if (this.config.enableLeaveReminders) {
        newAlerts.push(...this.analyzeLeaveTime(context));
      }

      if (this.config.enableWeatherAlerts) {
        newAlerts.push(...this.analyzeWeather(context));
      }

      if (this.config.enableHealthInsights) {
        newAlerts.push(...this.analyzeHealth(context));
      }

      if (this.config.enableEmailDigest) {
        newAlerts.push(...this.analyzeEmail(context));
      }

      newAlerts.push(...this.analyzeMeetingPrep(context));
      newAlerts.push(...this.analyzePatterns(context));

      // Dedupe and emit
      for (const alert of newAlerts) {
        if (!this.alerts.has(alert.id)) {
          this.alerts.set(alert.id, alert);
          this.onAlert?.(alert);
        }
      }

      // Clean expired alerts
      this.cleanExpiredAlerts();

    } catch (e) {
      console.error('[Intelligence] Analysis failed:', e);
    }
  }

  /**
   * Gather all context data
   */
  private async gatherContext(): Promise<DataContext> {
    const context: DataContext = {};

    if (this.dataProviders.getCalendar) {
      context.calendar = await this.dataProviders.getCalendar();
    }

    if (this.dataProviders.getWeather) {
      context.weather = await this.dataProviders.getWeather();
    }

    if (this.dataProviders.getHealth) {
      const health = await this.dataProviders.getHealth();
      if (health) context.health = health;
    }

    if (this.dataProviders.getEmail) {
      context.email = await this.dataProviders.getEmail();
    }

    if (this.dataProviders.getLocation) {
      context.location = await this.dataProviders.getLocation();
    }

    context.patterns = this.patterns;

    return context;
  }

  // ==========================================================================
  // ANALYZERS
  // ==========================================================================

  /**
   * Analyze leave time for upcoming events
   */
  private analyzeLeaveTime(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    
    if (!context.calendar?.nextEvent) return alerts;

    const event = context.calendar.nextEvent;
    const now = new Date();
    const eventTime = new Date(event.startTime);
    const minutesUntil = (eventTime.getTime() - now.getTime()) / 60000;

    // If event has location, calculate travel time
    if (event.location) {
      // Default to 30 min travel if no traffic data
      const travelTime = context.traffic?.homeToWork || 30;
      const prepTime = this.config.commutePrepTime;
      const leaveIn = minutesUntil - travelTime - prepTime;

      if (leaveIn > 0 && leaveIn <= 15) {
        alerts.push({
          id: `leave-${event.title}-${eventTime.getTime()}`,
          type: 'leave_now',
          title: 'Time to Leave',
          message: `Leave in ${Math.round(leaveIn)} minutes to arrive on time for "${event.title}". ${travelTime > 30 ? `Traffic is ${context.traffic?.currentDelay || 0} minutes heavier than usual.` : ''}`,
          priority: leaveIn <= 5 ? 'high' : 'medium',
          context: { event, travelTime, leaveIn },
          suggestedActions: ['Get directions', 'Notify running late'],
          expiresAt: eventTime,
          dismissed: false,
          createdAt: now,
        });
      }
    }

    return alerts;
  }

  /**
   * Analyze weather for upcoming events
   */
  private analyzeWeather(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    
    if (!context.weather) return alerts;
    
    const now = new Date();

    // Rain alert
    if (context.weather.willRain && context.calendar?.todayEvents?.length) {
      alerts.push({
        id: `weather-rain-${now.toDateString()}`,
        type: 'weather_prep',
        title: 'Rain Expected',
        message: `Rain expected ${context.weather.rainTime || 'later today'}. You have ${context.calendar.todayEvents.length} events - consider bringing an umbrella.`,
        priority: 'medium',
        context: { weather: context.weather, events: context.calendar.todayEvents },
        suggestedActions: ['Check full forecast'],
        expiresAt: new Date(now.getTime() + 12 * 3600000),
        dismissed: false,
        createdAt: now,
      });
    }

    // Severe weather
    if (context.weather.alerts?.length) {
      alerts.push({
        id: `weather-alert-${now.getTime()}`,
        type: 'weather_prep',
        title: 'Weather Alert',
        message: context.weather.alerts.join('. '),
        priority: 'high',
        context: { alerts: context.weather.alerts },
        dismissed: false,
        createdAt: now,
      });
    }

    // Temperature extremes
    if (context.weather.temperature > 35) {
      alerts.push({
        id: `weather-hot-${now.toDateString()}`,
        type: 'weather_prep',
        title: 'Extreme Heat',
        message: `Temperature reaching ${context.weather.temperature}°C today. Stay hydrated and avoid prolonged outdoor exposure.`,
        priority: 'medium',
        context: { temperature: context.weather.temperature },
        dismissed: false,
        createdAt: now,
      });
    } else if (context.weather.temperature < 0) {
      alerts.push({
        id: `weather-cold-${now.toDateString()}`,
        type: 'weather_prep',
        title: 'Freezing Conditions',
        message: `Temperature at ${context.weather.temperature}°C. Bundle up and watch for ice.`,
        priority: 'medium',
        context: { temperature: context.weather.temperature },
        dismissed: false,
        createdAt: now,
      });
    }

    return alerts;
  }

  /**
   * Analyze health data for insights
   */
  private analyzeHealth(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    
    if (!context.health) return alerts;

    const now = new Date();
    const health = context.health;

    // Low recovery warning
    if (health.recovery && health.recovery.score < 34) {
      alerts.push({
        id: `health-recovery-${now.toDateString()}`,
        type: 'health_insight',
        title: 'Low Recovery',
        message: `Your recovery score is ${health.recovery.score}%. Consider taking it easy today. ${health.recovery.recommendation}`,
        priority: 'medium',
        context: { recovery: health.recovery },
        suggestedActions: ['Reschedule workout', 'Review sleep tips'],
        dismissed: false,
        createdAt: now,
      });
    }

    // Poor sleep
    if (health.sleep && health.sleep.duration < 360) { // Less than 6 hours
      const hours = Math.floor(health.sleep.duration / 60);
      alerts.push({
        id: `health-sleep-${now.toDateString()}`,
        type: 'health_insight',
        title: 'Sleep Deficit',
        message: `You only slept ${hours} hours last night. Consider an earlier bedtime tonight.`,
        priority: 'low',
        context: { sleep: health.sleep },
        suggestedActions: ['Set bedtime reminder'],
        dismissed: false,
        createdAt: now,
      });
    }

    // High strain yesterday, need rest
    if (health.activity?.strain && health.activity.strain > 18 && health.recovery?.score && health.recovery.score < 50) {
      alerts.push({
        id: `health-strain-${now.toDateString()}`,
        type: 'health_insight',
        title: 'Recovery Day Recommended',
        message: `High strain (${health.activity.strain.toFixed(1)}) yesterday with low recovery (${health.recovery.score}%). Active recovery or rest recommended.`,
        priority: 'medium',
        context: { strain: health.activity.strain, recovery: health.recovery.score },
        dismissed: false,
        createdAt: now,
      });
    }

    return alerts;
  }

  /**
   * Analyze email for urgent items
   */
  private analyzeEmail(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    
    if (!context.email) return alerts;

    const now = new Date();

    // Urgent unread emails
    if (context.email.urgentCount > 0) {
      alerts.push({
        id: `email-urgent-${now.toDateString()}-${context.email.urgentCount}`,
        type: 'email_urgent',
        title: 'Urgent Emails',
        message: `You have ${context.email.urgentCount} urgent email${context.email.urgentCount > 1 ? 's' : ''} requiring attention.`,
        priority: 'high',
        context: { urgentCount: context.email.urgentCount },
        suggestedActions: ['Open email'],
        dismissed: false,
        createdAt: now,
      });
    }

    // Emails waiting for response
    if (context.email.needsResponse?.length) {
      const longWaiting = context.email.needsResponse.filter(e => e.waitingDays >= 3);
      if (longWaiting.length > 0) {
        alerts.push({
          id: `email-waiting-${now.toDateString()}`,
          type: 'email_urgent',
          title: 'Emails Awaiting Response',
          message: `${longWaiting.length} email${longWaiting.length > 1 ? 's have' : ' has'} been waiting for your response for 3+ days.`,
          priority: 'medium',
          context: { emails: longWaiting },
          suggestedActions: ['Review emails'],
          dismissed: false,
          createdAt: now,
        });
      }
    }

    return alerts;
  }

  /**
   * Analyze meeting preparation needs
   */
  private analyzeMeetingPrep(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    
    if (!context.calendar?.nextEvent) return alerts;

    const event = context.calendar.nextEvent;
    const now = new Date();
    const eventTime = new Date(event.startTime);
    const minutesUntil = (eventTime.getTime() - now.getTime()) / 60000;

    // 30-60 min before important meeting
    if (minutesUntil > 30 && minutesUntil <= 60) {
      const title = event.title.toLowerCase();
      const isImportant = title.includes('interview') || 
                          title.includes('board') || 
                          title.includes('review') ||
                          title.includes('presentation');

      if (isImportant) {
        alerts.push({
          id: `meeting-prep-${eventTime.getTime()}`,
          type: 'meeting_prep',
          title: 'Meeting Preparation',
          message: `"${event.title}" starts in ${Math.round(minutesUntil)} minutes. Have you prepared?`,
          priority: 'medium',
          context: { event },
          suggestedActions: ['Review materials', 'Test video/audio'],
          expiresAt: eventTime,
          dismissed: false,
          createdAt: now,
        });
      }
    }

    return alerts;
  }

  /**
   * Analyze patterns for suggestions
   */
  private analyzePatterns(context: DataContext): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    for (const pattern of this.patterns) {
      if (pattern.type === 'time_based' && pattern.confidence > 0.7) {
        // Check if trigger matches current time
        const triggerMatch = pattern.trigger.includes(`${currentHour}:`) ||
                            pattern.trigger.includes(`day:${currentDay}`);
        
        if (triggerMatch && (!pattern.lastTriggered || 
            now.getTime() - new Date(pattern.lastTriggered).getTime() > 20 * 3600000)) {
          alerts.push({
            id: `pattern-${pattern.description}-${now.toDateString()}`,
            type: 'pattern_reminder',
            title: 'Suggestion',
            message: pattern.description,
            priority: 'low',
            context: { pattern },
            suggestedActions: [pattern.action],
            dismissed: false,
            createdAt: now,
          });

          pattern.lastTriggered = now;
          this.saveState();
        }
      }
    }

    return alerts;
  }

  /**
   * Clean expired alerts
   */
  private cleanExpiredAlerts(): void {
    const now = new Date();
    for (const [id, alert] of this.alerts) {
      if (alert.expiresAt && new Date(alert.expiresAt) < now) {
        this.alerts.delete(id);
      }
    }
  }

  // ==========================================================================
  // PATTERN LEARNING
  // ==========================================================================

  /**
   * Record an action for pattern learning
   */
  recordAction(action: string, context?: Record<string, any>): void {
    // This would be more sophisticated in production
    // For now, just log for future implementation
    console.log('[Intelligence] Recorded action:', action, context);
  }

  /**
   * Add a pattern manually
   */
  addPattern(pattern: Omit<UserPattern, 'confidence' | 'lastTriggered'>): void {
    this.patterns.push({
      ...pattern,
      confidence: 0.8, // Manual patterns start with high confidence
    });
    this.saveState();
  }

  // ==========================================================================
  // ALERT MANAGEMENT
  // ==========================================================================

  /**
   * Get all active alerts
   */
  getActiveAlerts(): SmartAlert[] {
    return Array.from(this.alerts.values()).filter(a => !a.dismissed);
  }

  /**
   * Dismiss an alert
   */
  dismissAlert(id: string): void {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.dismissed = true;
    }
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts.clear();
  }

  // ==========================================================================
  // MORNING/EVENING BRIEFING
  // ==========================================================================

  /**
   * Generate morning briefing
   */
  async generateMorningBriefing(): Promise<string> {
    const context = await this.gatherContext();
    const parts: string[] = [];

    // Greeting
    parts.push("Good morning, sir.");

    // Weather
    if (context.weather) {
      parts.push(`It's currently ${context.weather.temperature}°C and ${context.weather.current}.`);
      if (context.weather.willRain) {
        parts.push(`Rain expected ${context.weather.rainTime || 'later'}.`);
      }
    }

    // Health
    if (context.health?.recovery) {
      const rec = context.health.recovery;
      parts.push(`Your recovery score is ${rec.score}%. ${rec.recommendation}`);
    }

    // Calendar
    if (context.calendar?.todayEvents?.length) {
      const count = context.calendar.todayEvents.length;
      parts.push(`You have ${count} event${count > 1 ? 's' : ''} today.`);
      if (context.calendar.nextEvent) {
        const next = context.calendar.nextEvent;
        const time = new Date(next.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        parts.push(`First up: "${next.title}" at ${time}.`);
      }
    } else {
      parts.push("Your calendar is clear today.");
    }

    // Email
    if (context.email && context.email.unreadCount > 0) {
      parts.push(`You have ${context.email.unreadCount} unread email${context.email.unreadCount > 1 ? 's' : ''}.`);
      if (context.email.urgentCount > 0) {
        parts.push(`${context.email.urgentCount} marked urgent.`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Generate evening review
   */
  async generateEveningReview(): Promise<string> {
    const context = await this.gatherContext();
    const parts: string[] = [];

    parts.push("Here's your evening summary, sir.");

    // Activity
    if (context.health?.activity) {
      const activity = context.health.activity;
      if (activity.strain) {
        parts.push(`Today's strain: ${activity.strain.toFixed(1)}.`);
      }
      if (activity.steps > 0) {
        parts.push(`${activity.steps.toLocaleString()} steps, ${activity.activeCalories} calories burned.`);
      }
    }

    // Tomorrow preview
    // Would need tomorrow's calendar data

    // Sleep recommendation
    if (context.health?.recovery?.score && context.health.recovery.score < 50) {
      parts.push("Consider an early night for better recovery.");
    }

    return parts.join(' ');
  }
}
