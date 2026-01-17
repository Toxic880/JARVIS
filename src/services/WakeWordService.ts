/**
 * Wake Word Service
 * 
 * Simple wake word detection using Web Speech API.
 * Listens for "Jarvis", "Hey Jarvis", "Ok Jarvis" etc.
 * 
 * Falls back gracefully if speech recognition isn't available.
 */

export type WakeWordCallback = () => void;
export type WakeWordState = 'inactive' | 'listening' | 'error' | 'unsupported';

export class WakeWordService {
  private recognition: SpeechRecognition | null = null;
  private callback: WakeWordCallback | null = null;
  private state: WakeWordState = 'inactive';
  private onStateChange: ((state: WakeWordState) => void) | null = null;
  private isRunning = false;
  
  // Wake word variations to detect
  private wakeWords = [
    'jarvis',
    'hey jarvis', 
    'ok jarvis',
    'yo jarvis',
    'hey travis',  // Common mishearing
    'hey jarv',
    'jarv',
  ];
  
  constructor() {
    // Check support
    const SpeechRecognition = (window as any).SpeechRecognition || 
                              (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn('[WakeWord] Speech recognition not supported');
      this.state = 'unsupported';
      return;
    }
    
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 3;
    
    this.recognition.onresult = this.handleResult.bind(this);
    this.recognition.onerror = this.handleError.bind(this);
    this.recognition.onend = this.handleEnd.bind(this);
  }
  
  private handleResult(event: SpeechRecognitionEvent) {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      // Check all alternatives for wake word
      for (let j = 0; j < event.results[i].length; j++) {
        const transcript = event.results[i][j].transcript.toLowerCase().trim();
        
        for (const wake of this.wakeWords) {
          if (transcript.includes(wake)) {
            console.log('[WakeWord] Detected:', transcript);
            this.callback?.();
            return;
          }
        }
      }
    }
  }
  
  private handleError(event: SpeechRecognitionErrorEvent) {
    // Ignore common non-errors
    if (event.error === 'no-speech' || event.error === 'aborted') {
      return;
    }
    
    console.error('[WakeWord] Error:', event.error);
    
    if (event.error === 'not-allowed') {
      this.setState('error');
      this.isRunning = false;
    }
  }
  
  private handleEnd() {
    // Restart if still supposed to be listening
    if (this.isRunning && this.recognition) {
      setTimeout(() => {
        try {
          this.recognition?.start();
        } catch (e) {
          // Ignore - might already be starting
        }
      }, 100);
    }
  }
  
  private setState(state: WakeWordState) {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }
  
  // PUBLIC API
  
  start(callback: WakeWordCallback, onStateChange?: (state: WakeWordState) => void): boolean {
    if (this.state === 'unsupported') {
      console.warn('[WakeWord] Cannot start - not supported');
      return false;
    }
    
    if (this.isRunning) {
      return true;
    }
    
    this.callback = callback;
    this.onStateChange = onStateChange || null;
    
    try {
      this.recognition?.start();
      this.isRunning = true;
      this.setState('listening');
      console.log('[WakeWord] Started listening');
      return true;
    } catch (e) {
      console.error('[WakeWord] Failed to start:', e);
      this.setState('error');
      return false;
    }
  }
  
  stop(): void {
    this.isRunning = false;
    
    try {
      this.recognition?.stop();
    } catch (e) {
      // Ignore
    }
    
    this.setState('inactive');
    console.log('[WakeWord] Stopped');
  }
  
  isSupported(): boolean {
    return this.state !== 'unsupported';
  }
  
  getState(): WakeWordState {
    return this.state;
  }
}

// Singleton for easy use
let instance: WakeWordService | null = null;

export function getWakeWordService(): WakeWordService {
  if (!instance) {
    instance = new WakeWordService();
  }
  return instance;
}
