/**
 * HEALTH SERVICE - Whoop & Garmin Integration
 * 
 * Sync health and fitness data:
 * - Sleep tracking
 * - Recovery scores
 * - Strain/activity
 * - Heart rate
 * - Steps, calories
 * 
 * WHOOP SETUP:
 * 1. Create app at developer.whoop.com
 * 2. Get OAuth credentials
 * 3. Authorize with Whoop account
 * 
 * GARMIN SETUP:
 * 1. Register at developer.garmin.com
 * 2. Get Consumer Key and Secret
 * 3. Connect Garmin account
 */

// =============================================================================
// TYPES
// =============================================================================

export interface SleepData {
  date: string;
  startTime: Date;
  endTime: Date;
  duration: number; // minutes
  efficiency: number; // percentage
  stages: {
    awake: number;
    light: number;
    deep: number;
    rem: number;
  };
  score?: number; // 0-100
  source: 'whoop' | 'garmin';
}

export interface RecoveryData {
  date: string;
  score: number; // 0-100
  hrv: number; // ms
  restingHeartRate: number;
  respiratoryRate?: number;
  skinTemp?: number;
  bloodOxygen?: number;
  recommendation: 'rest' | 'light' | 'moderate' | 'intense';
  source: 'whoop' | 'garmin';
}

export interface ActivityData {
  date: string;
  strain?: number; // Whoop strain 0-21
  calories: number;
  activeCalories: number;
  steps: number;
  distance: number; // meters
  floorsClimbed?: number;
  activeMinutes: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  workouts: WorkoutData[];
  source: 'whoop' | 'garmin';
}

export interface WorkoutData {
  id: string;
  type: string;
  startTime: Date;
  endTime: Date;
  duration: number; // minutes
  calories: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  distance?: number;
  strain?: number;
  source: 'whoop' | 'garmin';
}

export interface HealthSummary {
  date: string;
  sleep: SleepData | null;
  recovery: RecoveryData | null;
  activity: ActivityData | null;
  overallScore: number; // 0-100 composite score
  recommendation: string;
}

// =============================================================================
// WHOOP API (v2)
// =============================================================================

const WHOOP_API_URL = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

export class WhoopService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string = `${window.location.origin}/whoop-callback`) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.loadTokens();
  }

  private loadTokens() {
    const saved = localStorage.getItem('whoop_tokens');
    if (saved) {
      const tokens = JSON.parse(saved);
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
    }
  }

  private saveTokens() {
    localStorage.setItem('whoop_tokens', JSON.stringify({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
    }));
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Get OAuth URL - redirects user to WHOOP login
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement offline',
      state: crypto.randomUUID(),
    });
    return `${WHOOP_AUTH_URL}?${params}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleCallback(code: string): Promise<boolean> {
    try {
      const response = await fetch(WHOOP_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }),
      });

      if (!response.ok) {
        console.error('[Whoop] Token exchange failed:', await response.text());
        return false;
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      this.saveTokens();
      console.log('[Whoop] Successfully authenticated!');
      return true;
    } catch (e) {
      console.error('[Whoop] Auth error:', e);
      return false;
    }
  }

  private async apiRequest(endpoint: string): Promise<any> {
    if (!this.accessToken) throw new Error('Not authenticated with Whoop');

    const response = await fetch(`${WHOOP_API_URL}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
    });

    if (response.status === 401 && this.refreshToken) {
      // Try to refresh token
      await this.refreshAccessToken();
      return this.apiRequest(endpoint);
    }

    if (!response.ok) {
      throw new Error(`Whoop API error: ${response.status}`);
    }

    return response.json();
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) throw new Error('No refresh token');

    const response = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) throw new Error('Failed to refresh Whoop token');

    const data = await response.json();
    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.saveTokens();
  }

  /**
   * Get most recent recovery data
   */
  async getRecovery(date?: string): Promise<RecoveryData | null> {
    try {
      const result = await this.apiRequest('/recovery?limit=1');
      
      if (!result.records?.length) return null;

      const recovery = result.records[0];
      const score = recovery.score?.recovery_score || 0;
      
      let recommendation: RecoveryData['recommendation'] = 'moderate';
      if (score < 34) recommendation = 'rest';
      else if (score < 67) recommendation = 'light';
      else if (score < 85) recommendation = 'moderate';
      else recommendation = 'intense';

      return {
        date: new Date().toISOString().split('T')[0],
        score,
        hrv: recovery.score?.hrv_rmssd_milli || 0,
        restingHeartRate: recovery.score?.resting_heart_rate || 0,
        respiratoryRate: undefined,
        skinTemp: recovery.score?.skin_temp_celsius,
        bloodOxygen: recovery.score?.spo2_percentage,
        recommendation,
        source: 'whoop',
      };
    } catch (e) {
      console.error('[Whoop] Failed to get recovery:', e);
      return null;
    }
  }

  /**
   * Get most recent sleep data
   */
  async getSleep(date?: string): Promise<SleepData | null> {
    try {
      const result = await this.apiRequest('/activity/sleep?limit=1');
      
      if (!result.records?.length) return null;

      const sleep = result.records[0];
      const score = sleep.score;
      
      return {
        date: new Date(sleep.start).toISOString().split('T')[0],
        startTime: new Date(sleep.start),
        endTime: new Date(sleep.end),
        duration: Math.round((new Date(sleep.end).getTime() - new Date(sleep.start).getTime()) / 60000),
        efficiency: score?.sleep_efficiency_percentage || 0,
        stages: {
          awake: (score?.stage_summary?.total_awake_time_milli || 0) / 60000,
          light: (score?.stage_summary?.total_light_sleep_time_milli || 0) / 60000,
          deep: (score?.stage_summary?.total_slow_wave_sleep_time_milli || 0) / 60000,
          rem: (score?.stage_summary?.total_rem_sleep_time_milli || 0) / 60000,
        },
        score: score?.sleep_performance_percentage,
        source: 'whoop',
      };
    } catch (e) {
      console.error('[Whoop] Failed to get sleep:', e);
      return null;
    }
  }

  /**
   * Get most recent cycle (daily strain/activity)
   */
  async getActivity(date?: string): Promise<ActivityData | null> {
    try {
      const result = await this.apiRequest('/cycle?limit=1');
      
      if (!result.records?.length) return null;

      const cycle = result.records[0];
      
      // Get workouts for today
      const workoutsResult = await this.apiRequest('/activity/workout?limit=10');
      const workouts: WorkoutData[] = (workoutsResult.records || []).map((w: any) => ({
        id: w.id,
        type: w.sport_name || 'Unknown',
        startTime: new Date(w.start),
        endTime: new Date(w.end),
        duration: Math.round((new Date(w.end).getTime() - new Date(w.start).getTime()) / 60000),
        calories: w.score?.kilojoule ? Math.round(w.score.kilojoule / 4.184) : 0,
        avgHeartRate: w.score?.average_heart_rate,
        maxHeartRate: w.score?.max_heart_rate,
        distance: w.score?.distance_meter,
        strain: w.score?.strain,
        source: 'whoop' as const,
      }));

      return {
        date: new Date(cycle.start).toISOString().split('T')[0],
        strain: cycle.score?.strain,
        calories: cycle.score?.kilojoule ? Math.round(cycle.score.kilojoule / 4.184) : 0,
        activeCalories: cycle.score?.kilojoule ? Math.round(cycle.score.kilojoule / 4.184 * 0.7) : 0,
        steps: 0, // Whoop doesn't track steps
        distance: 0,
        activeMinutes: 0,
        avgHeartRate: cycle.score?.average_heart_rate,
        maxHeartRate: cycle.score?.max_heart_rate,
        workouts,
        source: 'whoop',
      };
    } catch (e) {
      console.error('[Whoop] Failed to get activity:', e);
      return null;
    }
  }
}

// =============================================================================
// GARMIN API
// =============================================================================

const GARMIN_API_URL = 'https://apis.garmin.com/wellness-api/rest';

export class GarminService {
  private accessToken: string | null = null;
  private accessTokenSecret: string | null = null;
  private consumerKey: string;
  private consumerSecret: string;

  constructor(consumerKey: string, consumerSecret: string) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.loadTokens();
  }

  private loadTokens() {
    const saved = localStorage.getItem('garmin_tokens');
    if (saved) {
      const tokens = JSON.parse(saved);
      this.accessToken = tokens.accessToken;
      this.accessTokenSecret = tokens.accessTokenSecret;
    }
  }

  private saveTokens() {
    localStorage.setItem('garmin_tokens', JSON.stringify({
      accessToken: this.accessToken,
      accessTokenSecret: this.accessTokenSecret,
    }));
  }

  setTokens(accessToken: string, accessTokenSecret: string) {
    this.accessToken = accessToken;
    this.accessTokenSecret = accessTokenSecret;
    this.saveTokens();
  }

  isAuthenticated(): boolean {
    return !!this.accessToken && !!this.accessTokenSecret;
  }

  // Note: Garmin uses OAuth 1.0a which is complex. 
  // For simplicity, we'll use Garmin Connect's unofficial API patterns
  // In production, you'd implement proper OAuth 1.0a

  /**
   * Get daily summary
   * NOTE: Garmin Health API requires OAuth 1.0a and enterprise licensing.
   * This is a placeholder - full implementation requires Garmin partnership.
   */
  async getDailySummary(date?: string): Promise<ActivityData | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    // Garmin Health API is not publicly available without enterprise agreement
    // Return null to indicate no data available
    // TODO: Implement when Garmin partnership is established
    return null;
  }

  /**
   * Get sleep data
   * NOTE: Requires Garmin Health API enterprise access
   */
  async getSleep(date?: string): Promise<SleepData | null> {
    if (!this.isAuthenticated()) {
      return null;
    }
    // Not implemented - requires enterprise Garmin API access
    return null;
  }

  /**
   * Get activities/workouts
   * NOTE: Requires Garmin Health API enterprise access
   */
  async getActivities(date?: string): Promise<WorkoutData[]> {
    if (!this.isAuthenticated()) {
      return [];
    }
    // Not implemented - requires enterprise Garmin API access
    return [];
  }
}

// =============================================================================
// UNIFIED HEALTH SERVICE
// =============================================================================

export class HealthService {
  private whoop: WhoopService | null = null;
  private garmin: GarminService | null = null;
  private cachedSummary: HealthSummary | null = null;
  private cacheDate: string = '';

  constructor(config?: {
    whoopClientId?: string;
    whoopClientSecret?: string;
    garminConsumerKey?: string;
    garminConsumerSecret?: string;
  }) {
    if (config?.whoopClientId && config?.whoopClientSecret) {
      this.whoop = new WhoopService(config.whoopClientId, config.whoopClientSecret);
    }
    if (config?.garminConsumerKey && config?.garminConsumerSecret) {
      this.garmin = new GarminService(config.garminConsumerKey, config.garminConsumerSecret);
    }
  }

  /**
   * Get Whoop service for direct access
   */
  getWhoop(): WhoopService | null {
    return this.whoop;
  }

  /**
   * Get Garmin service for direct access
   */
  getGarmin(): GarminService | null {
    return this.garmin;
  }

  /**
   * Check if any health service is connected
   */
  isConnected(): boolean {
    return (this.whoop?.isAuthenticated() || this.garmin?.isAuthenticated()) || false;
  }

  /**
   * Get today's health summary
   */
  async getTodaySummary(): Promise<HealthSummary> {
    const today = new Date().toISOString().split('T')[0];
    
    // Return cache if same day
    if (this.cachedSummary && this.cacheDate === today) {
      return this.cachedSummary;
    }

    let sleep: SleepData | null = null;
    let recovery: RecoveryData | null = null;
    let activity: ActivityData | null = null;

    // Try Whoop first (more detailed)
    if (this.whoop?.isAuthenticated()) {
      sleep = await this.whoop.getSleep();
      recovery = await this.whoop.getRecovery();
      activity = await this.whoop.getActivity();
    }

    // Fill gaps with Garmin if available
    if (this.garmin?.isAuthenticated()) {
      if (!sleep) sleep = await this.garmin.getSleep();
      if (!activity) {
        const garminActivity = await this.garmin.getDailySummary();
        if (garminActivity) activity = garminActivity;
      }
    }

    // Calculate overall score
    let overallScore = 50; // Default
    let scoreCount = 0;

    if (sleep?.score) {
      overallScore += sleep.score;
      scoreCount++;
    }
    if (recovery?.score) {
      overallScore += recovery.score;
      scoreCount++;
    }
    if (scoreCount > 0) {
      overallScore = Math.round(overallScore / (scoreCount + 1));
    }

    // Generate recommendation
    let recommendation = "Have a balanced day.";
    if (recovery) {
      switch (recovery.recommendation) {
        case 'rest':
          recommendation = "Your body needs rest today. Take it easy and focus on recovery.";
          break;
        case 'light':
          recommendation = "Light activity recommended. A walk or gentle yoga would be ideal.";
          break;
        case 'moderate':
          recommendation = "You're recovered well. Moderate exercise is a good choice.";
          break;
        case 'intense':
          recommendation = "You're primed for peak performance. Push yourself if you want!";
          break;
      }
    }

    this.cachedSummary = {
      date: today,
      sleep,
      recovery,
      activity,
      overallScore,
      recommendation,
    };
    this.cacheDate = today;

    return this.cachedSummary;
  }

  /**
   * Format health summary for JARVIS to speak
   */
  formatSummaryForSpeech(summary: HealthSummary): string {
    const parts: string[] = [];

    // Sleep
    if (summary.sleep) {
      const hours = Math.floor(summary.sleep.duration / 60);
      const mins = summary.sleep.duration % 60;
      parts.push(`You slept ${hours} hours and ${mins} minutes last night`);
      if (summary.sleep.score) {
        parts.push(`with a sleep score of ${summary.sleep.score}%`);
      }
      parts[parts.length - 1] += '.';
    }

    // Recovery
    if (summary.recovery) {
      parts.push(`Your recovery score is ${summary.recovery.score}%.`);
      parts.push(`Resting heart rate was ${summary.recovery.restingHeartRate} BPM`);
      if (summary.recovery.hrv) {
        parts.push(`and HRV at ${Math.round(summary.recovery.hrv)} milliseconds`);
      }
      parts[parts.length - 1] += '.';
    }

    // Activity (if past data)
    if (summary.activity && summary.activity.strain) {
      parts.push(`Yesterday's strain was ${summary.activity.strain.toFixed(1)}.`);
    }

    // Recommendation
    parts.push(summary.recommendation);

    return parts.join(' ');
  }

  /**
   * Quick status for brief response
   */
  formatQuickStatus(summary: HealthSummary): string {
    const parts: string[] = [];
    
    if (summary.recovery) {
      parts.push(`Recovery: ${summary.recovery.score}%`);
    }
    if (summary.sleep?.score) {
      parts.push(`Sleep: ${summary.sleep.score}%`);
    }
    if (summary.activity?.strain) {
      parts.push(`Strain: ${summary.activity.strain.toFixed(1)}`);
    }

    return parts.join(', ') || 'No health data available.';
  }
}
