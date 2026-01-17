/**
 * INTERCOM/BROADCAST SERVICE
 * 
 * Make announcements throughout the house:
 * - Broadcast to all speakers
 * - Send to specific rooms
 * - Intercom between rooms
 * - Scheduled announcements
 * 
 * Integrates with:
 * - Home Assistant media players
 * - Sonos speakers
 * - Google Home devices
 * - Amazon Echo devices (via HA)
 */

export interface Speaker {
  id: string;
  name: string;
  room: string;
  type: 'home_assistant' | 'sonos' | 'google' | 'alexa' | 'browser';
  entityId?: string; // For HA integration
  isOnline: boolean;
  volume: number;
}

export interface Announcement {
  id: string;
  message: string;
  targetSpeakers: string[]; // Speaker IDs, empty = all
  targetRooms: string[]; // Room names, empty = all
  priority: 'low' | 'normal' | 'high' | 'urgent';
  timestamp: Date;
  status: 'pending' | 'playing' | 'completed' | 'failed';
  ttsVoice?: string;
}

export interface ScheduledAnnouncement {
  id: string;
  message: string;
  targetRooms: string[];
  time: string; // HH:MM
  days: number[]; // 0=Sunday
  enabled: boolean;
  lastTriggered?: Date;
}

export interface IntercomSession {
  id: string;
  sourceRoom: string;
  targetRoom: string;
  startTime: Date;
  active: boolean;
}

export class IntercomService {
  private speakers: Map<string, Speaker> = new Map();
  private rooms: Set<string> = new Set();
  private announcementQueue: Announcement[] = [];
  private scheduledAnnouncements: ScheduledAnnouncement[] = [];
  private activeIntercom: IntercomSession | null = null;
  private homeAssistantUrl?: string;
  private homeAssistantToken?: string;
  private scheduleChecker?: NodeJS.Timeout;
  private onAnnouncement?: (announcement: Announcement) => void;

  constructor(config?: {
    homeAssistantUrl?: string;
    homeAssistantToken?: string;
    onAnnouncement?: (announcement: Announcement) => void;
  }) {
    this.homeAssistantUrl = config?.homeAssistantUrl;
    this.homeAssistantToken = config?.homeAssistantToken;
    this.onAnnouncement = config?.onAnnouncement;
    this.loadState();
    this.startScheduleChecker();
    
    // Add browser as default speaker
    this.addSpeaker({
      id: 'browser',
      name: 'This Device',
      room: 'current',
      type: 'browser',
      isOnline: true,
      volume: 1.0,
    });
  }

  private loadState() {
    const saved = localStorage.getItem('jarvis_intercom');
    if (saved) {
      const state = JSON.parse(saved);
      this.scheduledAnnouncements = state.scheduledAnnouncements || [];
      if (state.speakers) {
        state.speakers.forEach((s: Speaker) => {
          this.speakers.set(s.id, s);
          this.rooms.add(s.room);
        });
      }
    }
  }

  private saveState() {
    localStorage.setItem('jarvis_intercom', JSON.stringify({
      speakers: Array.from(this.speakers.values()),
      scheduledAnnouncements: this.scheduledAnnouncements,
    }));
  }

  // ==========================================================================
  // SPEAKER MANAGEMENT
  // ==========================================================================

  /**
   * Add a speaker
   */
  addSpeaker(speaker: Speaker): void {
    this.speakers.set(speaker.id, speaker);
    this.rooms.add(speaker.room);
    this.saveState();
  }

  /**
   * Remove a speaker
   */
  removeSpeaker(id: string): void {
    this.speakers.delete(id);
    this.saveState();
  }

  /**
   * Get all speakers
   */
  getSpeakers(): Speaker[] {
    return Array.from(this.speakers.values());
  }

  /**
   * Get speakers in a room
   */
  getSpeakersInRoom(room: string): Speaker[] {
    return Array.from(this.speakers.values()).filter(s => 
      s.room.toLowerCase() === room.toLowerCase()
    );
  }

  /**
   * Get all rooms
   */
  getRooms(): string[] {
    return Array.from(this.rooms);
  }

  /**
   * Discover speakers from Home Assistant
   */
  async discoverSpeakers(): Promise<Speaker[]> {
    if (!this.homeAssistantUrl || !this.homeAssistantToken) {
      console.log('[Intercom] Home Assistant not configured');
      return [];
    }

    try {
      const response = await fetch(`${this.homeAssistantUrl}/api/states`, {
        headers: {
          'Authorization': `Bearer ${this.homeAssistantToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch HA states');

      const states = await response.json();
      const mediaPlayers = states.filter((s: any) => 
        s.entity_id.startsWith('media_player.')
      );

      const discovered: Speaker[] = [];
      for (const player of mediaPlayers) {
        const speaker: Speaker = {
          id: player.entity_id,
          name: player.attributes.friendly_name || player.entity_id,
          room: player.attributes.room || 'Unknown',
          type: 'home_assistant',
          entityId: player.entity_id,
          isOnline: player.state !== 'unavailable',
          volume: player.attributes.volume_level || 0.5,
        };
        discovered.push(speaker);
        this.addSpeaker(speaker);
      }

      return discovered;
    } catch (e) {
      console.error('[Intercom] Failed to discover speakers:', e);
      return [];
    }
  }

  // ==========================================================================
  // ANNOUNCEMENTS
  // ==========================================================================

  /**
   * Make an announcement
   */
  async announce(
    message: string,
    options?: {
      rooms?: string[];
      speakers?: string[];
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      voice?: string;
    }
  ): Promise<Announcement> {
    const announcement: Announcement = {
      id: crypto.randomUUID(),
      message,
      targetSpeakers: options?.speakers || [],
      targetRooms: options?.rooms || [],
      priority: options?.priority || 'normal',
      timestamp: new Date(),
      status: 'pending',
      ttsVoice: options?.voice,
    };

    this.announcementQueue.push(announcement);
    this.onAnnouncement?.(announcement);

    // Determine which speakers to use
    let targetSpeakers: Speaker[] = [];

    if (options?.speakers?.length) {
      // Specific speakers
      targetSpeakers = options.speakers
        .map(id => this.speakers.get(id))
        .filter((s): s is Speaker => s !== undefined && s.isOnline);
    } else if (options?.rooms?.length) {
      // Speakers in specific rooms
      for (const room of options.rooms) {
        targetSpeakers.push(...this.getSpeakersInRoom(room));
      }
    } else {
      // All speakers
      targetSpeakers = Array.from(this.speakers.values()).filter(s => s.isOnline);
    }

    if (targetSpeakers.length === 0) {
      // Fallback to browser
      targetSpeakers = [this.speakers.get('browser')!].filter(Boolean);
    }

    // Play on each speaker
    announcement.status = 'playing';
    
    try {
      await Promise.all(targetSpeakers.map(speaker => 
        this.playOnSpeaker(speaker, message, announcement.priority)
      ));
      announcement.status = 'completed';
    } catch (e) {
      console.error('[Intercom] Announcement failed:', e);
      announcement.status = 'failed';
    }

    return announcement;
  }

  /**
   * Play message on a specific speaker
   */
  private async playOnSpeaker(
    speaker: Speaker, 
    message: string,
    priority: 'low' | 'normal' | 'high' | 'urgent'
  ): Promise<void> {
    switch (speaker.type) {
      case 'browser':
        await this.playBrowserTTS(message, priority);
        break;
      case 'home_assistant':
        await this.playHomeAssistantTTS(speaker, message);
        break;
      case 'sonos':
        // Would integrate with Sonos API
        break;
      case 'google':
        // Would use Google Cast
        break;
    }
  }

  /**
   * Play using browser TTS
   */
  private async playBrowserTTS(message: string, priority: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Speech synthesis not available'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(message);
      
      // Adjust based on priority
      if (priority === 'urgent') {
        utterance.rate = 1.1;
        utterance.volume = 1.0;
      } else if (priority === 'low') {
        utterance.rate = 0.9;
        utterance.volume = 0.7;
      }

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Play using Home Assistant TTS
   */
  private async playHomeAssistantTTS(speaker: Speaker, message: string): Promise<void> {
    if (!this.homeAssistantUrl || !this.homeAssistantToken || !speaker.entityId) {
      throw new Error('Home Assistant not configured');
    }

    const response = await fetch(`${this.homeAssistantUrl}/api/services/tts/speak`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.homeAssistantToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entity_id: speaker.entityId,
        message: message,
        language: 'en',
      }),
    });

    if (!response.ok) {
      throw new Error(`HA TTS failed: ${response.status}`);
    }
  }

  /**
   * Broadcast to all speakers
   */
  async broadcast(message: string, priority: 'normal' | 'high' | 'urgent' = 'normal'): Promise<void> {
    await this.announce(message, { priority });
  }

  /**
   * Announce in specific room(s)
   */
  async announceInRoom(message: string, room: string | string[]): Promise<void> {
    const rooms = Array.isArray(room) ? room : [room];
    await this.announce(message, { rooms });
  }

  // ==========================================================================
  // SCHEDULED ANNOUNCEMENTS
  // ==========================================================================

  /**
   * Add a scheduled announcement
   */
  addScheduledAnnouncement(announcement: Omit<ScheduledAnnouncement, 'id'>): ScheduledAnnouncement {
    const scheduled: ScheduledAnnouncement = {
      ...announcement,
      id: crypto.randomUUID(),
    };
    this.scheduledAnnouncements.push(scheduled);
    this.saveState();
    return scheduled;
  }

  /**
   * Remove a scheduled announcement
   */
  removeScheduledAnnouncement(id: string): void {
    this.scheduledAnnouncements = this.scheduledAnnouncements.filter(a => a.id !== id);
    this.saveState();
  }

  /**
   * Get all scheduled announcements
   */
  getScheduledAnnouncements(): ScheduledAnnouncement[] {
    return this.scheduledAnnouncements;
  }

  /**
   * Start the schedule checker
   */
  private startScheduleChecker(): void {
    this.scheduleChecker = setInterval(() => {
      this.checkScheduledAnnouncements();
    }, 60000); // Check every minute
  }

  /**
   * Check and trigger scheduled announcements
   */
  private checkScheduledAnnouncements(): void {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay();

    for (const scheduled of this.scheduledAnnouncements) {
      if (!scheduled.enabled) continue;
      if (!scheduled.days.includes(currentDay)) continue;
      if (scheduled.time !== currentTime) continue;

      // Check if already triggered this minute
      if (scheduled.lastTriggered) {
        const lastTriggered = new Date(scheduled.lastTriggered);
        if (now.getTime() - lastTriggered.getTime() < 60000) continue;
      }

      // Trigger the announcement
      this.announce(scheduled.message, { rooms: scheduled.targetRooms });
      scheduled.lastTriggered = now;
      this.saveState();
    }
  }

  // ==========================================================================
  // INTERCOM
  // ==========================================================================

  /**
   * Start intercom session between rooms
   */
  startIntercom(sourceRoom: string, targetRoom: string): IntercomSession {
    // End any existing session
    if (this.activeIntercom) {
      this.endIntercom();
    }

    this.activeIntercom = {
      id: crypto.randomUUID(),
      sourceRoom,
      targetRoom,
      startTime: new Date(),
      active: true,
    };

    // Announce on target
    this.announceInRoom(`Intercom from ${sourceRoom}`, targetRoom);

    return this.activeIntercom;
  }

  /**
   * End active intercom session
   */
  endIntercom(): void {
    if (this.activeIntercom) {
      this.activeIntercom.active = false;
      this.activeIntercom = null;
    }
  }

  /**
   * Send intercom message
   */
  async sendIntercomMessage(message: string): Promise<void> {
    if (!this.activeIntercom) {
      throw new Error('No active intercom session');
    }

    await this.announceInRoom(message, this.activeIntercom.targetRoom);
  }

  // ==========================================================================
  // QUICK ANNOUNCEMENTS
  // ==========================================================================

  /**
   * Dinner announcement
   */
  async announceDinner(): Promise<void> {
    await this.broadcast("Dinner is ready. Please come to the dining room.", 'high');
  }

  /**
   * Custom call
   */
  async callFamily(message: string = "Your attention please."): Promise<void> {
    await this.broadcast(message, 'normal');
  }

  /**
   * Emergency announcement
   */
  async emergencyAnnouncement(message: string): Promise<void> {
    await this.broadcast(`Attention! ${message}`, 'urgent');
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  destroy(): void {
    if (this.scheduleChecker) {
      clearInterval(this.scheduleChecker);
    }
  }

  // ==========================================================================
  // FORMATTING FOR SPEECH
  // ==========================================================================

  formatAnnouncementConfirmation(announcement: Announcement): string {
    if (announcement.targetRooms.length > 0) {
      return `Announced in ${announcement.targetRooms.join(' and ')}.`;
    }
    return "Broadcast sent to all speakers.";
  }
}
