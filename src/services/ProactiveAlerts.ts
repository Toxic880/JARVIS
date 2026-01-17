/**
 * PROACTIVE ALERTS SYSTEM
 * Monitors various sources and alerts the user proactively
 * "Sir, you have a meeting in 15 minutes"
 */

import { CalendarEvent, GoogleTask } from './GoogleService';
import { SystemTimer, Alarm, Reminder } from '../types';

export interface ProactiveAlert {
  id: string;
  type: 'CALENDAR' | 'REMINDER' | 'TIMER' | 'WEATHER' | 'BATTERY' | 'CUSTOM';
  message: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  triggerTime: number;
  triggered: boolean;
  data?: any;
}

export interface AlertCallbacks {
  onAlert: (alert: ProactiveAlert) => void;
  getCalendarEvents: () => Promise<CalendarEvent[]>;
  getBatteryLevel: () => Promise<number>;
  getWeather: () => Promise<{ temp: number; condition: string } | null>;
}

export class ProactiveAlertsSystem {
  private alerts: ProactiveAlert[] = [];
  private callbacks: AlertCallbacks;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private lastWeatherAlert: number = 0;
  private lastBatteryAlert: number = 0;
  
  // Alert timing configuration (in minutes before event)
  private readonly CALENDAR_ALERT_TIMES = [15, 5]; // Alert 15 min and 5 min before
  private readonly BATTERY_THRESHOLD = 20; // Alert when below 20%
  
  constructor(callbacks: AlertCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start monitoring
   */
  public start(): void {
    if (this.checkInterval) return;
    
    // Check every minute
    this.checkInterval = setInterval(() => this.checkAlerts(), 60000);
    
    // Initial check
    this.checkAlerts();
    
    // Check calendar events periodically
    this.scheduleCalendarCheck();
    
    console.log('[Proactive] Alert system started');
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check all alert sources
   */
  private async checkAlerts(): Promise<void> {
    const now = Date.now();
    
    // Check pending alerts
    for (const alert of this.alerts) {
      if (!alert.triggered && alert.triggerTime <= now) {
        alert.triggered = true;
        this.callbacks.onAlert(alert);
      }
    }

    // Clean up old triggered alerts
    this.alerts = this.alerts.filter(a => !a.triggered || a.triggerTime > now - 3600000);

    // Check battery
    await this.checkBattery();
  }

  /**
   * Schedule calendar event checks
   */
  private async scheduleCalendarCheck(): Promise<void> {
    try {
      const events = await this.callbacks.getCalendarEvents();
      
      for (const event of events) {
        const eventTime = event.start.getTime();
        
        // Create alerts for each timing
        for (const minutesBefore of this.CALENDAR_ALERT_TIMES) {
          const alertTime = eventTime - (minutesBefore * 60 * 1000);
          
          // Only create alert if it's in the future
          if (alertTime > Date.now()) {
            const existingAlert = this.alerts.find(
              a => a.type === 'CALENDAR' && a.data?.eventId === event.id && a.triggerTime === alertTime
            );
            
            if (!existingAlert) {
              const timeDesc = minutesBefore >= 60 
                ? `${Math.round(minutesBefore / 60)} hour${minutesBefore >= 120 ? 's' : ''}`
                : `${minutesBefore} minutes`;
              
              this.addAlert({
                type: 'CALENDAR',
                message: `Sir, you have "${event.title}" in ${timeDesc}.${event.location ? ` Location: ${event.location}.` : ''}`,
                priority: minutesBefore <= 5 ? 'HIGH' : 'MEDIUM',
                triggerTime: alertTime,
                data: { eventId: event.id, event },
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[Proactive] Calendar check failed:', error);
    }
    
    // Check again in 5 minutes
    setTimeout(() => this.scheduleCalendarCheck(), 5 * 60 * 1000);
  }

  /**
   * Check battery level
   */
  private async checkBattery(): Promise<void> {
    try {
      const level = await this.callbacks.getBatteryLevel();
      const now = Date.now();
      
      // Only alert once per hour for battery
      if (level <= this.BATTERY_THRESHOLD && now - this.lastBatteryAlert > 3600000) {
        this.lastBatteryAlert = now;
        
        this.callbacks.onAlert({
          id: crypto.randomUUID(),
          type: 'BATTERY',
          message: `Sir, device battery is at ${level}%. You may want to find a charger.`,
          priority: level <= 10 ? 'URGENT' : 'MEDIUM',
          triggerTime: now,
          triggered: true,
        });
      }
    } catch (error) {
      // Battery API not available
    }
  }

  /**
   * Add a custom alert
   */
  public addAlert(alert: Omit<ProactiveAlert, 'id' | 'triggered'>): ProactiveAlert {
    const newAlert: ProactiveAlert = {
      ...alert,
      id: crypto.randomUUID(),
      triggered: false,
    };
    
    this.alerts.push(newAlert);
    return newAlert;
  }

  /**
   * Cancel an alert
   */
  public cancelAlert(id: string): boolean {
    const index = this.alerts.findIndex(a => a.id === id);
    if (index === -1) return false;
    
    this.alerts.splice(index, 1);
    return true;
  }

  /**
   * Get pending alerts
   */
  public getPendingAlerts(): ProactiveAlert[] {
    return this.alerts.filter(a => !a.triggered);
  }

  /**
   * Create weather alert
   */
  public async checkWeather(): Promise<void> {
    const now = Date.now();
    
    // Only check weather once per hour
    if (now - this.lastWeatherAlert < 3600000) return;
    
    try {
      const weather = await this.callbacks.getWeather();
      if (!weather) return;
      
      const condition = weather.condition.toLowerCase();
      
      // Alert for notable weather
      if (condition.includes('rain') || condition.includes('storm') || 
          condition.includes('snow') || weather.temp > 95 || weather.temp < 32) {
        
        this.lastWeatherAlert = now;
        
        let message = '';
        if (condition.includes('rain')) {
          message = `Sir, it appears it will rain today. You may want to bring an umbrella.`;
        } else if (condition.includes('storm')) {
          message = `Sir, there are storms in the forecast. Please exercise caution if traveling.`;
        } else if (condition.includes('snow')) {
          message = `Sir, snow is expected today. Roads may be affected.`;
        } else if (weather.temp > 95) {
          message = `Sir, it's quite hot today at ${weather.temp}°. Stay hydrated.`;
        } else if (weather.temp < 32) {
          message = `Sir, it's below freezing at ${weather.temp}°. Bundle up if you're heading out.`;
        }
        
        if (message) {
          this.callbacks.onAlert({
            id: crypto.randomUUID(),
            type: 'WEATHER',
            message,
            priority: 'LOW',
            triggerTime: now,
            triggered: true,
          });
        }
      }
    } catch (error) {
      console.error('[Proactive] Weather check failed:', error);
    }
  }

  /**
   * Morning briefing check - determines what to include
   */
  public async getMorningBriefingItems(): Promise<string[]> {
    const items: string[] = [];
    
    try {
      // Calendar
      const events = await this.callbacks.getCalendarEvents();
      if (events.length > 0) {
        items.push(`You have ${events.length} event${events.length > 1 ? 's' : ''} today.`);
      }
      
      // Weather
      const weather = await this.callbacks.getWeather();
      if (weather) {
        items.push(`It's currently ${weather.temp}° and ${weather.condition.toLowerCase()}.`);
      }
      
      // Battery
      const battery = await this.callbacks.getBatteryLevel();
      if (battery < 50) {
        items.push(`Device battery is at ${battery}%.`);
      }
    } catch (error) {
      console.error('[Proactive] Briefing preparation failed:', error);
    }
    
    return items;
  }
}
