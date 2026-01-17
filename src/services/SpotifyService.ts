/**
 * SPOTIFY SERVICE
 * Handles Spotify Web API integration for music control
 * Uses PKCE flow - NO client secret needed!
 * 
 * SETUP REQUIRED:
 * 1. Go to https://developer.spotify.com/dashboard
 * 2. Create an app
 * 3. Add redirect URI: http://localhost:3000/callback (or your URL)
 * 4. Copy Client ID to JARVIS settings
 * 5. User authenticates via OAuth
 */

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-top-read',
].join(' ');

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  duration: number;
  isPlaying: boolean;
  progress: number;
  albumArt?: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number;
}

export class SpotifyService {
  private clientId: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;
  private redirectUri: string;

  constructor(clientId: string, redirectUri: string = `${window.location.origin}/callback`) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.loadTokens();
  }

  private loadTokens() {
    this.accessToken = localStorage.getItem('spotify_access_token');
    this.refreshToken = localStorage.getItem('spotify_refresh_token');
    this.tokenExpiry = parseInt(localStorage.getItem('spotify_token_expiry') || '0');
  }

  private saveTokens(accessToken: string, refreshToken: string | null, expiresIn: number) {
    this.accessToken = accessToken;
    if (refreshToken) this.refreshToken = refreshToken;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);
    
    localStorage.setItem('spotify_access_token', accessToken);
    if (refreshToken) localStorage.setItem('spotify_refresh_token', refreshToken);
    localStorage.setItem('spotify_token_expiry', this.tokenExpiry.toString());
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.accessToken && Date.now() < this.tokenExpiry;
  }

  // ==========================================================================
  // PKCE HELPERS
  // ==========================================================================

  /**
   * Generate a random code verifier for PKCE
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate code challenge from verifier using SHA-256
   */
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate the authorization URL for OAuth with PKCE
   */
  public async getAuthUrl(): Promise<string> {
    const state = crypto.randomUUID();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
    // Store for later use
    localStorage.setItem('spotify_auth_state', state);
    localStorage.setItem('spotify_code_verifier', codeVerifier);

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      state: state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });

    return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens using PKCE (no client secret!)
   */
  public async handleCallback(code: string): Promise<boolean> {
    try {
      const codeVerifier = localStorage.getItem('spotify_code_verifier');
      
      if (!codeVerifier) {
        console.error('[Spotify] No code verifier found');
        return false;
      }

      const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: this.redirectUri,
          client_id: this.clientId,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Spotify] Token exchange failed:', error);
        return false;
      }

      const data = await response.json();
      this.saveTokens(data.access_token, data.refresh_token, data.expires_in);
      
      // Clean up
      localStorage.removeItem('spotify_code_verifier');
      localStorage.removeItem('spotify_auth_state');
      
      return true;
    } catch (error) {
      console.error('[Spotify] Auth error:', error);
      return false;
    }
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Spotify');
    }

    // Check if token needs refresh
    if (Date.now() >= this.tokenExpiry - 60000 && this.refreshToken) {
      await this.refreshAccessToken();
    }

    const response = await fetch(`${SPOTIFY_API_URL}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return null; // No content
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Spotify API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Refresh the access token using PKCE (no client secret!)
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) return;

    try {
      const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        this.saveTokens(data.access_token, data.refresh_token || null, data.expires_in);
      }
    } catch (error) {
      console.error('[Spotify] Token refresh failed:', error);
    }
  }

  // ===========================================================================
  // PLAYBACK CONTROLS
  // ===========================================================================

  /**
   * Get current playback state
   */
  async getCurrentlyPlaying(): Promise<SpotifyTrack | null> {
    try {
      const data = await this.apiRequest('/me/player/currently-playing');
      if (!data || !data.item) return null;

      return {
        name: data.item.name,
        artist: data.item.artists.map((a: any) => a.name).join(', '),
        album: data.item.album.name,
        duration: data.item.duration_ms,
        isPlaying: data.is_playing,
        progress: data.progress_ms,
        albumArt: data.item.album.images?.[0]?.url,
      };
    } catch {
      return null;
    }
  }

  /**
   * Play/Resume playback
   */
  async play(uri?: string, contextUri?: string): Promise<boolean> {
    try {
      const body: any = {};
      if (contextUri) {
        body.context_uri = contextUri; // Album, playlist, or artist URI
      }
      if (uri) {
        body.uris = [uri]; // Specific track
      }

      await this.apiRequest('/me/player/play', 'PUT', Object.keys(body).length > 0 ? body : undefined);
      return true;
    } catch (error) {
      console.error('[Spotify] Play failed:', error);
      return false;
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<boolean> {
    try {
      await this.apiRequest('/me/player/pause', 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Skip to next track
   */
  async next(): Promise<boolean> {
    try {
      await this.apiRequest('/me/player/next', 'POST');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Go to previous track
   */
  async previous(): Promise<boolean> {
    try {
      await this.apiRequest('/me/player/previous', 'POST');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(percent: number): Promise<boolean> {
    try {
      await this.apiRequest(`/me/player/volume?volume_percent=${Math.min(100, Math.max(0, percent))}`, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Seek to position in track
   */
  async seek(positionMs: number): Promise<boolean> {
    try {
      await this.apiRequest(`/me/player/seek?position_ms=${positionMs}`, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Toggle shuffle
   */
  async setShuffle(state: boolean): Promise<boolean> {
    try {
      await this.apiRequest(`/me/player/shuffle?state=${state}`, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set repeat mode
   */
  async setRepeat(mode: 'off' | 'track' | 'context'): Promise<boolean> {
    try {
      await this.apiRequest(`/me/player/repeat?state=${mode}`, 'PUT');
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // SEARCH & PLAYBACK
  // ===========================================================================

  /**
   * Search for tracks, albums, artists, or playlists
   */
  async search(query: string, types: string[] = ['track', 'album', 'artist', 'playlist'], limit: number = 5): Promise<any> {
    try {
      const typeStr = types.join(',');
      const data = await this.apiRequest(`/search?q=${encodeURIComponent(query)}&type=${typeStr}&limit=${limit}`);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Play music by search query
   */
  async playByQuery(query: string): Promise<string> {
    const results = await this.search(query, ['track', 'playlist', 'album'], 1);
    
    if (!results) {
      return "I couldn't search Spotify at the moment.";
    }

    // Try to play a track first
    if (results.tracks?.items?.length > 0) {
      const track = results.tracks.items[0];
      const success = await this.play(track.uri);
      if (success) {
        return `Playing "${track.name}" by ${track.artists[0].name}.`;
      }
    }

    // Try playlist
    if (results.playlists?.items?.length > 0) {
      const playlist = results.playlists.items[0];
      const success = await this.play(undefined, playlist.uri);
      if (success) {
        return `Playing playlist "${playlist.name}".`;
      }
    }

    // Try album
    if (results.albums?.items?.length > 0) {
      const album = results.albums.items[0];
      const success = await this.play(undefined, album.uri);
      if (success) {
        return `Playing album "${album.name}" by ${album.artists[0].name}.`;
      }
    }

    return `I couldn't find anything matching "${query}" on Spotify.`;
  }

  /**
   * Get available devices
   */
  async getDevices(): Promise<SpotifyDevice[]> {
    try {
      const data = await this.apiRequest('/me/player/devices');
      return data.devices.map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        isActive: d.is_active,
        volume: d.volume_percent,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Transfer playback to a device
   */
  async transferPlayback(deviceId: string): Promise<boolean> {
    try {
      await this.apiRequest('/me/player', 'PUT', {
        device_ids: [deviceId],
        play: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get user's playlists
   */
  async getPlaylists(limit: number = 20): Promise<any[]> {
    try {
      const data = await this.apiRequest(`/me/playlists?limit=${limit}`);
      return data.items || [];
    } catch {
      return [];
    }
  }

  /**
   * Format current track for speech
   */
  formatTrackForSpeech(track: SpotifyTrack): string {
    if (track.isPlaying) {
      return `Now playing "${track.name}" by ${track.artist} from the album "${track.album}".`;
    } else {
      return `Paused on "${track.name}" by ${track.artist}.`;
    }
  }

  /**
   * Disconnect/logout
   */
  public logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_token_expiry');
  }
}
