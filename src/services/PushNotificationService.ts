/**
 * PUSH NOTIFICATION SERVICE
 * 
 * Send notifications to your phone when away from JARVIS.
 * Supports:
 * - Pushover (recommended - $5 one-time for app)
 * - ntfy (free, self-hostable)
 * - Browser Push (if on same device)
 */

export type NotificationPriority = 'lowest' | 'low' | 'normal' | 'high' | 'emergency';

export interface PushNotification {
  title: string;
  message: string;
  priority?: NotificationPriority;
  sound?: string;
  url?: string;
  urlTitle?: string;
}

export interface PushoverConfig {
  userKey: string;
  apiToken: string;
}

export interface NtfyConfig {
  serverUrl: string;  // https://ntfy.sh or your own server
  topic: string;      // Your unique topic name
}

export class PushNotificationService {
  private pushoverConfig?: PushoverConfig;
  private ntfyConfig?: NtfyConfig;
  private browserPushEnabled: boolean = false;
  
  // Rate limiting
  private lastNotification: number = 0;
  private minInterval: number = 5000; // 5 seconds between notifications

  constructor(config?: {
    pushover?: PushoverConfig;
    ntfy?: NtfyConfig;
  }) {
    if (config?.pushover) {
      this.pushoverConfig = config.pushover;
      console.log('[Push] Pushover configured');
    }
    
    if (config?.ntfy) {
      this.ntfyConfig = config.ntfy;
      console.log('[Push] ntfy configured');
    }
    
    // Check for browser push support
    if ('Notification' in window) {
      this.requestBrowserPermission();
    }
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  public configurePushover(userKey: string, apiToken: string): void {
    this.pushoverConfig = { userKey, apiToken };
    console.log('[Push] Pushover configured');
  }

  public configureNtfy(serverUrl: string, topic: string): void {
    this.ntfyConfig = { serverUrl: serverUrl.replace(/\/$/, ''), topic };
    console.log('[Push] ntfy configured');
  }

  private async requestBrowserPermission(): Promise<void> {
    if (Notification.permission === 'granted') {
      this.browserPushEnabled = true;
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      this.browserPushEnabled = permission === 'granted';
    }
  }

  // ===========================================================================
  // SEND NOTIFICATIONS
  // ===========================================================================

  /**
   * Send notification through all configured channels
   */
  public async send(notification: PushNotification): Promise<boolean> {
    // Rate limiting
    const now = Date.now();
    if (now - this.lastNotification < this.minInterval) {
      console.log('[Push] Rate limited, skipping notification');
      return false;
    }
    this.lastNotification = now;

    const results: boolean[] = [];

    // Try Pushover first (most reliable)
    if (this.pushoverConfig) {
      results.push(await this.sendPushover(notification));
    }

    // Try ntfy
    if (this.ntfyConfig) {
      results.push(await this.sendNtfy(notification));
    }

    // Browser notification as fallback
    if (this.browserPushEnabled) {
      results.push(this.sendBrowser(notification));
    }

    return results.some(r => r);
  }

  /**
   * Send via Pushover
   */
  private async sendPushover(notification: PushNotification): Promise<boolean> {
    if (!this.pushoverConfig) return false;

    const priorityMap: Record<NotificationPriority, number> = {
      'lowest': -2,
      'low': -1,
      'normal': 0,
      'high': 1,
      'emergency': 2,
    };

    try {
      const formData = new FormData();
      formData.append('token', this.pushoverConfig.apiToken);
      formData.append('user', this.pushoverConfig.userKey);
      formData.append('title', notification.title);
      formData.append('message', notification.message);
      formData.append('priority', String(priorityMap[notification.priority || 'normal']));
      
      if (notification.sound) {
        formData.append('sound', notification.sound);
      }
      if (notification.url) {
        formData.append('url', notification.url);
      }
      if (notification.urlTitle) {
        formData.append('url_title', notification.urlTitle);
      }

      // Emergency notifications require retry/expire
      if (notification.priority === 'emergency') {
        formData.append('retry', '60');
        formData.append('expire', '3600');
      }

      const response = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        console.error('[Push] Pushover error:', await response.text());
        return false;
      }

      console.log('[Push] Pushover notification sent:', notification.title);
      return true;
    } catch (error) {
      console.error('[Push] Pushover error:', error);
      return false;
    }
  }

  /**
   * Send via ntfy
   */
  private async sendNtfy(notification: PushNotification): Promise<boolean> {
    if (!this.ntfyConfig) return false;

    const priorityMap: Record<NotificationPriority, number> = {
      'lowest': 1,
      'low': 2,
      'normal': 3,
      'high': 4,
      'emergency': 5,
    };

    try {
      const response = await fetch(`${this.ntfyConfig.serverUrl}/${this.ntfyConfig.topic}`, {
        method: 'POST',
        headers: {
          'Title': notification.title,
          'Priority': String(priorityMap[notification.priority || 'normal']),
          'Tags': 'robot,jarvis',
        },
        body: notification.message,
      });

      if (!response.ok) {
        console.error('[Push] ntfy error:', await response.text());
        return false;
      }

      console.log('[Push] ntfy notification sent:', notification.title);
      return true;
    } catch (error) {
      console.error('[Push] ntfy error:', error);
      return false;
    }
  }

  /**
   * Send browser notification
   */
  private sendBrowser(notification: PushNotification): boolean {
    if (!this.browserPushEnabled) return false;

    try {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/icon-192.png',
        tag: 'jarvis',
      });
      console.log('[Push] Browser notification sent:', notification.title);
      return true;
    } catch (error) {
      console.error('[Push] Browser notification error:', error);
      return false;
    }
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Send timer complete notification
   */
  public async notifyTimerComplete(label: string): Promise<boolean> {
    return this.send({
      title: '⏰ Timer Complete',
      message: `Your ${label} timer has finished.`,
      priority: 'high',
      sound: 'cosmic',
    });
  }

  /**
   * Send reminder notification
   */
  public async notifyReminder(message: string): Promise<boolean> {
    return this.send({
      title: '📝 Reminder',
      message,
      priority: 'high',
    });
  }

  /**
   * Send calendar alert
   */
  public async notifyCalendarEvent(eventTitle: string, minutesUntil: number): Promise<boolean> {
    return this.send({
      title: '📅 Upcoming Event',
      message: `${eventTitle} in ${minutesUntil} minutes`,
      priority: minutesUntil <= 5 ? 'high' : 'normal',
    });
  }

  /**
   * Send smart home alert
   */
  public async notifySmartHome(device: string, event: string): Promise<boolean> {
    return this.send({
      title: '🏠 Smart Home Alert',
      message: `${device}: ${event}`,
      priority: 'normal',
    });
  }

  /**
   * Send weather alert
   */
  public async notifyWeather(alert: string): Promise<boolean> {
    return this.send({
      title: '🌤️ Weather Alert',
      message: alert,
      priority: 'normal',
    });
  }

  /**
   * Send emergency notification
   */
  public async notifyEmergency(message: string): Promise<boolean> {
    return this.send({
      title: '🚨 EMERGENCY',
      message,
      priority: 'emergency',
      sound: 'siren',
    });
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  public isConfigured(): boolean {
    return !!(this.pushoverConfig || this.ntfyConfig || this.browserPushEnabled);
  }

  public getConfiguredServices(): string[] {
    const services: string[] = [];
    if (this.pushoverConfig) services.push('Pushover');
    if (this.ntfyConfig) services.push('ntfy');
    if (this.browserPushEnabled) services.push('Browser');
    return services;
  }
}
