/**
 * SPEECH SERVICE - REWRITTEN FOR NATURAL CONVERSATION
 * 
 * Fixes:
 * - Self-hearing prevention (ignores own voice after speaking)
 * - Natural pause detection (waits for you to finish speaking)
 * - Cooldown period after JARVIS speaks
 * - Debounced transcript handling
 */

export type SpeechStatus = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'COOLDOWN';

export interface SpeechConfig {
  wakeWord: string;
  wakeWordEnabled: boolean;
  continuous: boolean;
  language: string;
  voiceName?: string;
  voiceRate?: number;
  voicePitch?: number;
  // TTS config
  ttsProvider?: 'browser' | 'elevenlabs' | 'server';  // 'server' uses proxy
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  // Conversation tuning
  silenceTimeout?: number;      // How long to wait for more speech (ms)
  cooldownDuration?: number;    // How long to ignore input after speaking (ms)
  whisperMode?: boolean;        // Quiet mode for night time
}

export interface SpeechCallbacks {
  onStatusChange: (status: SpeechStatus) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onWakeWord: () => void;
  onError: (error: string) => void;
  onSpeakStart: () => void;
  onSpeakEnd: () => void;
}

// Phrases JARVIS might say that we should ignore if heard back
const SELF_PHRASES = [
  'yes sir', 'yes, sir', 'certainly', 'of course', 'right away',
  'understood', 'very well', 'at once', 'good morning', 'good afternoon',
  'good evening', 'how may i assist', 'how can i help', 'sir',
];

export class SpeechService {
  private recognition: SpeechRecognition | null = null;
  private synthesis: SpeechSynthesis;
  private config: SpeechConfig;
  private callbacks: SpeechCallbacks;
  private status: SpeechStatus = 'IDLE';
  private isAwake: boolean = false;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  
  // Anti-self-hearing
  private lastSpokeAt: number = 0;
  private lastSpokenText: string = '';
  private inCooldown: boolean = false;
  
  // Natural conversation timing
  private transcriptBuffer: string = '';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpeechAt: number = 0;
  
  // Auto-sleep
  private autoSleepTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<SpeechConfig>, callbacks: SpeechCallbacks) {
    this.config = {
      wakeWord: config.wakeWord || 'jarvis',
      wakeWordEnabled: config.wakeWordEnabled ?? true,
      continuous: config.continuous ?? true,
      language: config.language || 'en-US',
      voiceName: config.voiceName,
      voiceRate: config.voiceRate ?? 1.0,
      voicePitch: config.voicePitch ?? 1.0,
      ttsProvider: config.ttsProvider || 'browser',
      elevenLabsApiKey: config.elevenLabsApiKey,
      elevenLabsVoiceId: config.elevenLabsVoiceId,
      silenceTimeout: config.silenceTimeout ?? 1500,    // Wait 1.5s of silence
      cooldownDuration: config.cooldownDuration ?? 800, // Ignore input for 800ms after speaking
      whisperMode: config.whisperMode ?? false,
    };
    this.callbacks = callbacks;
    this.synthesis = window.speechSynthesis;
    
    this.initRecognition();
    this.initVoice();
  }

  // ===========================================================================
  // CONFIGURATION UPDATES
  // ===========================================================================

  public setElevenLabsConfig(apiKey: string, voiceId: string) {
    this.config.elevenLabsApiKey = apiKey;
    this.config.elevenLabsVoiceId = voiceId;
    this.config.ttsProvider = 'elevenlabs';
    console.log('[Speech] ElevenLabs configured');
  }

  public setTTSProvider(provider: 'browser' | 'elevenlabs' | 'server') {
    this.config.ttsProvider = provider;
    console.log('[Speech] TTS provider set to:', provider);
  }

  public setWhisperMode(enabled: boolean) {
    this.config.whisperMode = enabled;
    console.log('[Speech] Whisper mode:', enabled);
  }

  public setSilenceTimeout(ms: number) {
    this.config.silenceTimeout = ms;
  }

  // ===========================================================================
  // SPEECH RECOGNITION
  // ===========================================================================

  private initRecognition(): void {
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      this.callbacks.onError('Speech Recognition not supported in this browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.config.continuous;
    this.recognition.interimResults = true;
    this.recognition.lang = this.config.language;

    this.recognition.onstart = () => {
      if (!this.inCooldown) {
        this.setStatus('LISTENING');
      }
      console.log('[Speech] Recognition started, wake word:', this.config.wakeWordEnabled ? 'ENABLED' : 'DISABLED');
    };

    this.recognition.onresult = (event) => {
      // CRITICAL: Ignore input during cooldown (prevents self-hearing)
      if (this.inCooldown) {
        console.log('[Speech] Ignoring input during cooldown');
        return;
      }

      // Check if we're too close to when we last spoke
      const timeSinceSpoke = Date.now() - this.lastSpokeAt;
      if (timeSinceSpoke < this.config.cooldownDuration!) {
        console.log('[Speech] Ignoring input, too soon after speaking:', timeSinceSpoke, 'ms');
        return;
      }

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const currentText = (finalTranscript || interimTranscript).trim().toLowerCase();
      
      // Check if this sounds like JARVIS talking (self-hearing prevention)
      if (this.isSelfHearing(currentText)) {
        console.log('[Speech] Ignoring self-heard phrase:', currentText);
        return;
      }

      // Record that we heard speech
      this.lastSpeechAt = Date.now();

      // Handle wake word detection
      if (this.config.wakeWordEnabled && !this.isAwake) {
        if (currentText.includes(this.config.wakeWord.toLowerCase())) {
          console.log('[Speech] Wake word detected!');
          this.isAwake = true;
          this.callbacks.onWakeWord();
          
          // Extract text after wake word
          const wakeWordIndex = currentText.indexOf(this.config.wakeWord.toLowerCase());
          const afterWakeWord = currentText.slice(wakeWordIndex + this.config.wakeWord.length).trim();
          
          // If there's meaningful text after wake word, buffer it
          if (afterWakeWord && afterWakeWord.length > 2 && finalTranscript) {
            this.transcriptBuffer = afterWakeWord;
            this.startSilenceTimer();
          }
        }
        return;
      }

      // Normal transcript handling (awake or wake word disabled)
      if (interimTranscript) {
        // Show interim results but don't act on them
        this.callbacks.onTranscript(interimTranscript, false);
        
        // Reset silence timer - user is still speaking
        this.resetSilenceTimer();
      }
      
      if (finalTranscript) {
        // Add to buffer instead of sending immediately
        this.transcriptBuffer += ' ' + finalTranscript.trim();
        this.transcriptBuffer = this.transcriptBuffer.trim();
        
        // Start/reset silence timer
        this.startSilenceTimer();
      }
    };

    this.recognition.onerror = (event) => {
      console.log('[Speech] Recognition error:', event.error);
      
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.callbacks.onError(`Speech recognition error: ${event.error}`);
      }
      
      // Auto-restart on recoverable errors
      if (event.error === 'no-speech' || event.error === 'network') {
        this.scheduleRestart();
      }
    };

    this.recognition.onend = () => {
      console.log('[Speech] Recognition ended, continuous:', this.config.continuous, 'status:', this.status);
      
      // Auto-restart if we should be listening
      if (this.config.continuous && this.status !== 'SPEAKING' && this.status !== 'COOLDOWN') {
        this.scheduleRestart();
      }
    };
  }

  /**
   * Check if the transcript sounds like JARVIS's own voice
   */
  private isSelfHearing(text: string): boolean {
    const cleanText = text.toLowerCase().trim();
    
    // Check against common JARVIS phrases
    for (const phrase of SELF_PHRASES) {
      if (cleanText === phrase || cleanText.startsWith(phrase)) {
        return true;
      }
    }
    
    // Check if it's similar to what we just said
    if (this.lastSpokenText) {
      const lastSpoken = this.lastSpokenText.toLowerCase();
      // If the heard text is contained in what we just said, ignore it
      if (lastSpoken.includes(cleanText) || cleanText.includes(lastSpoken.slice(0, 20))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Start timer to send transcript after silence
   */
  private startSilenceTimer(): void {
    this.resetSilenceTimer();
    
    this.silenceTimer = setTimeout(() => {
      if (this.transcriptBuffer.trim()) {
        console.log('[Speech] Silence detected, sending transcript:', this.transcriptBuffer);
        this.callbacks.onTranscript(this.transcriptBuffer.trim(), true);
        this.transcriptBuffer = '';
        
        // Auto-sleep after processing (if wake word enabled)
        if (this.config.wakeWordEnabled) {
          this.scheduleAutoSleep();
        }
      }
    }, this.config.silenceTimeout);
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimeout) return;
    
    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      if (this.status !== 'SPEAKING' && this.status !== 'COOLDOWN') {
        this.startListening();
      }
    }, 100);
  }

  private scheduleAutoSleep(): void {
    if (this.autoSleepTimer) {
      clearTimeout(this.autoSleepTimer);
    }
    
    // Go back to sleep after 30 seconds of no interaction
    this.autoSleepTimer = setTimeout(() => {
      if (this.isAwake) {
        console.log('[Speech] Auto-sleep after inactivity');
        this.isAwake = false;
      }
    }, 30000);
  }

  // ===========================================================================
  // VOICE INITIALIZATION
  // ===========================================================================

  private initVoice(): void {
    const setVoice = () => {
      const voices = this.synthesis.getVoices();
      
      // Prefer configured voice, then Google UK English Female, then any English
      if (this.config.voiceName) {
        this.selectedVoice = voices.find(v => v.name.includes(this.config.voiceName!)) || null;
      }
      
      if (!this.selectedVoice) {
        this.selectedVoice = voices.find(v => v.name.includes('Google UK English Female')) ||
                            voices.find(v => v.name.includes('Google UK English')) ||
                            voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                            voices.find(v => v.lang.startsWith('en')) ||
                            null;
      }
      
      if (this.selectedVoice) {
        console.log('[Speech] Selected voice:', this.selectedVoice.name);
      }
    };

    if (this.synthesis.getVoices().length > 0) {
      setVoice();
    } else {
      this.synthesis.onvoiceschanged = setVoice;
    }
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  public startListening(): void {
    if (this.recognition && this.status !== 'SPEAKING' && this.status !== 'COOLDOWN') {
      try {
        this.recognition.start();
      } catch (e) {
        // Already started, ignore
      }
    }
  }

  public stopListening(): void {
    this.resetSilenceTimer();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Not running, ignore
      }
    }
    this.setStatus('IDLE');
  }

  public wake(): void {
    this.isAwake = true;
    if (this.autoSleepTimer) {
      clearTimeout(this.autoSleepTimer);
    }
    this.scheduleAutoSleep();
  }

  // ===========================================================================
  // TEXT TO SPEECH
  // ===========================================================================

  public speak(text: string): Promise<void> {
    // Record what we're about to say (for self-hearing prevention)
    this.lastSpokenText = text;
    
    // Use server TTS if configured (key is on server side)
    if (this.config.ttsProvider === 'server') {
      return this.speakElevenLabs(text);
    }
    
    // Use direct ElevenLabs if configured with client-side key
    if (this.config.ttsProvider === 'elevenlabs' && 
        this.config.elevenLabsApiKey && 
        this.config.elevenLabsVoiceId) {
      return this.speakElevenLabs(text);
    }
    
    return this.speakBrowser(text);
  }

  /**
   * Enter cooldown mode - ignore all input
   */
  private enterCooldown(): void {
    this.inCooldown = true;
    this.setStatus('COOLDOWN');
    console.log('[Speech] Entering cooldown for', this.config.cooldownDuration, 'ms');
  }

  /**
   * Exit cooldown mode and resume listening
   */
  private exitCooldown(): void {
    setTimeout(() => {
      this.inCooldown = false;
      this.lastSpokeAt = Date.now();
      console.log('[Speech] Exiting cooldown, resuming listening');
      
      if (this.config.continuous) {
        this.setStatus('LISTENING');
        this.startListening();
      } else {
        this.setStatus('IDLE');
      }
    }, this.config.cooldownDuration);
  }

  private async speakElevenLabs(text: string): Promise<void> {
    if (!text || text.trim().length === 0) return;

    // Stop listening and enter pre-speak state
    this.stopListening();
    this.setStatus('SPEAKING');
    this.callbacks.onSpeakStart();

    try {
      let audioBlob: Blob;

      // Use server proxy if in server mode, otherwise direct ElevenLabs
      if (this.config.ttsProvider === 'server') {
        // Server TTS proxy (secure - API key stays server-side)
        const { apiClient } = await import('./APIClient');
        const audioBuffer = await apiClient.speak(text, this.config.elevenLabsVoiceId);
        audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      } else {
        // Direct ElevenLabs (dev mode only - requires client-side API key)
        if (!this.config.elevenLabsApiKey || !this.config.elevenLabsVoiceId) {
          throw new Error('ElevenLabs API key and voice ID required for direct mode');
        }

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${this.config.elevenLabsVoiceId}`,
          {
            method: 'POST',
            headers: {
              'Accept': 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': this.config.elevenLabsApiKey,
            },
            body: JSON.stringify({
              text,
              model_id: 'eleven_monolingual_v1',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        audioBlob = await response.blob();
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      
      return new Promise((resolve, reject) => {
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;
        
        // Apply whisper mode
        audio.volume = this.config.whisperMode ? 0.3 : 1.0;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          this.callbacks.onSpeakEnd();
          
          // Enter cooldown before resuming listening
          this.enterCooldown();
          this.exitCooldown();
          
          resolve();
        };

        audio.onerror = (e) => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          console.error('[Speech] TTS audio error:', e);
          this.callbacks.onSpeakEnd();
          this.enterCooldown();
          this.exitCooldown();
          reject(new Error('Audio playback failed'));
        };

        audio.play().catch(reject);
      });
    } catch (error) {
      console.error('[Speech] TTS error:', error);
      this.callbacks.onSpeakEnd();
      
      // Fall back to browser TTS
      console.log('[Speech] Falling back to browser TTS');
      return this.speakBrowser(text);
    }
  }

  private speakBrowser(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!text || text.trim().length === 0) {
        resolve();
        return;
      }

      // Stop listening while speaking
      this.stopListening();
      this.setStatus('SPEAKING');
      this.callbacks.onSpeakStart();

      const utterance = new SpeechSynthesisUtterance(text);
      
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }
      
      utterance.rate = this.config.voiceRate || 1.0;
      utterance.pitch = this.config.voicePitch || 1.0;
      utterance.volume = this.config.whisperMode ? 0.3 : 1.0;

      utterance.onend = () => {
        this.callbacks.onSpeakEnd();
        
        // Enter cooldown before resuming listening
        this.enterCooldown();
        this.exitCooldown();
        
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('[Speech] TTS error:', event);
        this.callbacks.onSpeakEnd();
        this.enterCooldown();
        this.exitCooldown();
        reject(new Error(`TTS error: ${event.error}`));
      };

      // Chrome bug workaround
      this.synthesis.cancel();
      
      setTimeout(() => {
        this.synthesis.speak(utterance);
      }, 50);
    });
  }

  public async speakSequence(texts: string[]): Promise<void> {
    for (const text of texts) {
      await this.speak(text);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  public interrupt(): void {
    this.synthesis.cancel();
    
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    
    this.inCooldown = false;
    this.setStatus('IDLE');
    this.callbacks.onSpeakEnd();
  }

  public destroy(): void {
    this.stopListening();
    this.interrupt();
    this.resetSilenceTimer();
    
    if (this.autoSleepTimer) {
      clearTimeout(this.autoSleepTimer);
    }
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
  }

  // ===========================================================================
  // STATE
  // ===========================================================================

  private setStatus(status: SpeechStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onStatusChange(status);
    }
  }

  public getStatus(): SpeechStatus {
    return this.status;
  }

  public isListening(): boolean {
    return this.status === 'LISTENING';
  }

  public isCurrentlyAwake(): boolean {
    return this.isAwake;
  }
}
