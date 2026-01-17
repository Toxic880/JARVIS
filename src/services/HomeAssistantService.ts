/**
 * HOME ASSISTANT SERVICE
 * 
 * Proper REST API integration with Home Assistant.
 * 
 * SETUP:
 * 1. In Home Assistant: Profile → Long-Lived Access Tokens → Create Token
 * 2. Copy the token to JARVIS settings
 * 3. Set URL to your HA instance (e.g., http://homeassistant.local:8123)
 */

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    [key: string]: any;
  };
  last_changed: string;
  last_updated: string;
}

export interface HAService {
  domain: string;
  service: string;
  name?: string;
  description?: string;
}

export class HomeAssistantService {
  private baseUrl: string;
  private token: string;
  private entities: Map<string, HAEntity> = new Map();
  private connected: boolean = false;

  constructor(baseUrl: string, token: string) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Test connection to Home Assistant
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        headers: this.headers,
      });
      this.connected = response.ok;
      return this.connected;
    } catch (e) {
      console.error('[HA] Connection test failed:', e);
      this.connected = false;
      return false;
    }
  }

  /**
   * Get all entities from Home Assistant
   */
  async getEntities(): Promise<HAEntity[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/states`, {
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(`HA API error: ${response.status}`);
      }

      const entities: HAEntity[] = await response.json();
      
      // Cache entities
      entities.forEach(e => this.entities.set(e.entity_id, e));
      
      return entities;
    } catch (e) {
      console.error('[HA] Failed to get entities:', e);
      return [];
    }
  }

  /**
   * Get entity state
   */
  async getEntityState(entityId: string): Promise<HAEntity | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/states/${entityId}`, {
        headers: this.headers,
      });

      if (!response.ok) return null;

      const entity: HAEntity = await response.json();
      this.entities.set(entity.entity_id, entity);
      return entity;
    } catch (e) {
      console.error('[HA] Failed to get entity state:', e);
      return null;
    }
  }

  /**
   * Call a Home Assistant service
   */
  async callService(
    domain: string,
    service: string,
    data?: Record<string, any>
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/services/${domain}/${service}`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(data || {}),
        }
      );

      return response.ok;
    } catch (e) {
      console.error('[HA] Service call failed:', e);
      return false;
    }
  }

  // =========================================================================
  // CONVENIENCE METHODS
  // =========================================================================

  /**
   * Turn on a light
   */
  async turnOnLight(entityId: string, brightness?: number, color?: string): Promise<boolean> {
    const data: any = { entity_id: entityId };
    
    if (brightness !== undefined) {
      data.brightness_pct = brightness;
    }
    
    if (color) {
      // Parse color name to RGB if needed
      data.color_name = color;
    }
    
    return this.callService('light', 'turn_on', data);
  }

  /**
   * Turn off a light
   */
  async turnOffLight(entityId: string): Promise<boolean> {
    return this.callService('light', 'turn_off', { entity_id: entityId });
  }

  /**
   * Toggle a light
   */
  async toggleLight(entityId: string): Promise<boolean> {
    return this.callService('light', 'toggle', { entity_id: entityId });
  }

  /**
   * Turn on/off a switch
   */
  async setSwitch(entityId: string, on: boolean): Promise<boolean> {
    return this.callService('switch', on ? 'turn_on' : 'turn_off', { 
      entity_id: entityId 
    });
  }

  /**
   * Lock/unlock a lock
   */
  async setLock(entityId: string, locked: boolean): Promise<boolean> {
    return this.callService('lock', locked ? 'lock' : 'unlock', { 
      entity_id: entityId 
    });
  }

  /**
   * Set thermostat temperature
   */
  async setThermostat(entityId: string, temperature: number): Promise<boolean> {
    return this.callService('climate', 'set_temperature', {
      entity_id: entityId,
      temperature,
    });
  }

  /**
   * Set thermostat mode
   */
  async setThermostatMode(entityId: string, mode: 'heat' | 'cool' | 'auto' | 'off'): Promise<boolean> {
    return this.callService('climate', 'set_hvac_mode', {
      entity_id: entityId,
      hvac_mode: mode,
    });
  }

  /**
   * Open/close a cover (blinds, garage door, etc.)
   */
  async setCover(entityId: string, open: boolean): Promise<boolean> {
    return this.callService('cover', open ? 'open_cover' : 'close_cover', {
      entity_id: entityId,
    });
  }

  /**
   * Set cover position (0-100)
   */
  async setCoverPosition(entityId: string, position: number): Promise<boolean> {
    return this.callService('cover', 'set_cover_position', {
      entity_id: entityId,
      position,
    });
  }

  /**
   * Activate a scene
   */
  async activateScene(sceneId: string): Promise<boolean> {
    return this.callService('scene', 'turn_on', { entity_id: sceneId });
  }

  /**
   * Run a script
   */
  async runScript(scriptId: string): Promise<boolean> {
    return this.callService('script', 'turn_on', { entity_id: scriptId });
  }

  /**
   * Send TTS to a media player
   */
  async speak(entityId: string, message: string, language: string = 'en'): Promise<boolean> {
    return this.callService('tts', 'speak', {
      entity_id: entityId,
      message,
      language,
    });
  }

  /**
   * Play media on a media player
   */
  async playMedia(entityId: string, mediaUrl: string, mediaType: string = 'music'): Promise<boolean> {
    return this.callService('media_player', 'play_media', {
      entity_id: entityId,
      media_content_id: mediaUrl,
      media_content_type: mediaType,
    });
  }

  /**
   * Control media player (play, pause, stop, etc.)
   */
  async mediaControl(entityId: string, action: 'play' | 'pause' | 'stop' | 'next' | 'previous'): Promise<boolean> {
    const serviceMap = {
      play: 'media_play',
      pause: 'media_pause',
      stop: 'media_stop',
      next: 'media_next_track',
      previous: 'media_previous_track',
    };
    
    return this.callService('media_player', serviceMap[action], { entity_id: entityId });
  }

  /**
   * Set media player volume
   */
  async setVolume(entityId: string, volumeLevel: number): Promise<boolean> {
    return this.callService('media_player', 'volume_set', {
      entity_id: entityId,
      volume_level: volumeLevel / 100, // HA uses 0-1
    });
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  /**
   * Find entity by friendly name
   */
  findEntityByName(name: string): HAEntity | undefined {
    const nameLower = name.toLowerCase();
    
    for (const entity of this.entities.values()) {
      const friendlyName = entity.attributes.friendly_name?.toLowerCase() || '';
      if (friendlyName.includes(nameLower) || entity.entity_id.includes(nameLower)) {
        return entity;
      }
    }
    
    return undefined;
  }

  /**
   * Get all lights
   */
  getLights(): HAEntity[] {
    return Array.from(this.entities.values())
      .filter(e => e.entity_id.startsWith('light.'));
  }

  /**
   * Get all switches
   */
  getSwitches(): HAEntity[] {
    return Array.from(this.entities.values())
      .filter(e => e.entity_id.startsWith('switch.'));
  }

  /**
   * Get all sensors
   */
  getSensors(): HAEntity[] {
    return Array.from(this.entities.values())
      .filter(e => e.entity_id.startsWith('sensor.'));
  }

  /**
   * Get all media players
   */
  getMediaPlayers(): HAEntity[] {
    return Array.from(this.entities.values())
      .filter(e => e.entity_id.startsWith('media_player.'));
  }

  /**
   * Get all scenes
   */
  getScenes(): HAEntity[] {
    return Array.from(this.entities.values())
      .filter(e => e.entity_id.startsWith('scene.'));
  }
}
