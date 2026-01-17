/**
 * Voice Service
 * 
 * Handles all voice-related functionality:
 * - Speech-to-Text (STT) via Whisper API or local
 * - Wake word detection ("Hey Jarvis")
 * - Text-to-Speech (TTS) via ElevenLabs
 * - Continuous listening mode
 * - Voice activity detection
 */

import { EventEmitter } from 'events';
import { logger, auditLog } from './logger';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface VoiceConfig {
  // Wake word
  wakeWord: string;
  wakeWordSensitivity: number; // 0-1
  
  // STT
  sttProvider: 'whisper' | 'whisper-local' | 'azure' | 'google';
  whisperModel: 'whisper-1' | 'base' | 'small' | 'medium' | 'large';
  language: string;
  
  // TTS
  ttsProvider: 'elevenlabs' | 'azure' | 'local';
  elevenLabsVoiceId: string;
  voiceStability: number;
  voiceSimilarityBoost: number;
  
  // Listening
  continuousListening: boolean;
  silenceThreshold: number; // dB
  silenceTimeout: number; // ms
  maxRecordingDuration: number; // ms
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
  duration?: number;
}

export interface WakeWordEvent {
  detected: boolean;
  confidence: number;
  timestamp: Date;
}

export type VoiceState = 
  | 'idle'
  | 'listening_wake_word'
  | 'listening_command'
  | 'processing'
  | 'speaking'
  | 'error';

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: VoiceConfig = {
  wakeWord: 'jarvis',
  wakeWordSensitivity: 0.7,
  
  sttProvider: 'whisper',
  whisperModel: 'whisper-1',
  language: 'en',
  
  ttsProvider: 'elevenlabs',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam
  voiceStability: 0.5,
  voiceSimilarityBoost: 0.75,
  
  continuousListening: true,
  silenceThreshold: -40,
  silenceTimeout: 1500,
  maxRecordingDuration: 30000,
};

// =============================================================================
// WAKE WORD PATTERNS
// =============================================================================

const WAKE_WORD_PATTERNS = [
  // Exact matches
  /^hey jarvis$/i,
  /^jarvis$/i,
  /^ok jarvis$/i,
  /^yo jarvis$/i,
  
  // Start of sentence
  /^hey jarvis[,.]?\s/i,
  /^jarvis[,.]?\s/i,
  /^ok jarvis[,.]?\s/i,
  
  // Common mishearings
  /^hey jervis$/i,
  /^hey jarvas$/i,
  /^hey travis$/i,
  /^a jarvis$/i,
];

// =============================================================================
// VOICE SERVICE CLASS
// =============================================================================

export class VoiceService extends EventEmitter {
  private config: VoiceConfig;
  private state: VoiceState = 'idle';
  private isListening: boolean = false;
  private audioBuffer: Buffer[] = [];
  
  constructor(config: Partial<VoiceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // =========================================================================
  // STATE
  // =========================================================================

  getState(): VoiceState {
    return this.state;
  }

  private setState(newState: VoiceState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit('stateChange', { from: oldState, to: newState });
  }

  // =========================================================================
  // SPEECH-TO-TEXT
  // =========================================================================

  /**
   * Transcribe audio to text
   */
  async transcribe(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    try {
      this.setState('processing');
      
      let result: TranscriptionResult;
      
      switch (this.config.sttProvider) {
        case 'whisper':
          result = await this.transcribeWithWhisperAPI(audioBuffer, mimeType);
          break;
        case 'whisper-local':
          result = await this.transcribeWithWhisperLocal(audioBuffer);
          break;
        default:
          throw new Error(`Unsupported STT provider: ${this.config.sttProvider}`);
      }
      
      const duration = Date.now() - startTime;
      logger.debug('Transcription complete', { 
        textLength: result.text.length, 
        confidence: result.confidence,
        durationMs: duration,
      });
      
      auditLog('VOICE_TRANSCRIBE', {
        textLength: result.text.length,
        provider: this.config.sttProvider,
        durationMs: duration,
      });
      
      return result;
      
    } catch (error) {
      logger.error('Transcription failed', { error: String(error) });
      this.setState('error');
      throw error;
    } finally {
      if (this.state === 'processing') {
        this.setState('idle');
      }
    }
  }

  private async transcribeWithWhisperAPI(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for Whisper');
    }
    
    // Create form data
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('wav') ? 'wav' : 'mp3';
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model', this.config.whisperModel);
    formData.append('language', this.config.language);
    formData.append('response_format', 'verbose_json');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
    }
    
    const data = await response.json() as any;
    
    return {
      text: data.text?.trim() || '',
      confidence: 0.95, // Whisper doesn't return confidence, assume high
      language: data.language,
      duration: data.duration,
    };
  }

  private async transcribeWithWhisperLocal(audioBuffer: Buffer): Promise<TranscriptionResult> {
    // For local Whisper, we'd need to call a local server or use whisper.cpp
    // This is a placeholder for when running locally
    const localUrl = process.env.WHISPER_LOCAL_URL || 'http://localhost:8080/transcribe';
    
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), 'audio.wav');
    
    const response = await fetch(localUrl, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Local Whisper error: ${response.status}`);
    }
    
    const data = await response.json() as any;
    
    return {
      text: data.text?.trim() || '',
      confidence: data.confidence || 0.9,
    };
  }

  // =========================================================================
  // WAKE WORD DETECTION
  // =========================================================================

  /**
   * Check if text contains wake word
   */
  detectWakeWord(text: string): WakeWordEvent {
    const normalizedText = text.toLowerCase().trim();
    
    for (const pattern of WAKE_WORD_PATTERNS) {
      if (pattern.test(normalizedText)) {
        return {
          detected: true,
          confidence: 0.95,
          timestamp: new Date(),
        };
      }
    }
    
    // Fuzzy match for the wake word
    const words = normalizedText.split(/\s+/);
    for (const word of words.slice(0, 3)) { // Check first 3 words
      if (this.fuzzyMatch(word, this.config.wakeWord)) {
        return {
          detected: true,
          confidence: 0.7,
          timestamp: new Date(),
        };
      }
    }
    
    return {
      detected: false,
      confidence: 0,
      timestamp: new Date(),
    };
  }

  /**
   * Extract command after wake word
   */
  extractCommand(text: string): string | null {
    const normalizedText = text.toLowerCase().trim();
    
    for (const pattern of WAKE_WORD_PATTERNS) {
      const match = normalizedText.match(pattern);
      if (match) {
        // Remove the wake word portion
        const afterWakeWord = normalizedText.replace(pattern, '').trim();
        if (afterWakeWord.length > 0) {
          // Restore original case from input
          const startIndex = text.toLowerCase().indexOf(afterWakeWord);
          if (startIndex !== -1) {
            return text.substring(startIndex).trim();
          }
          return afterWakeWord;
        }
        return null; // Wake word only, no command
      }
    }
    
    return text; // No wake word found, return full text
  }

  private fuzzyMatch(input: string, target: string): boolean {
    // Levenshtein distance check
    const distance = this.levenshteinDistance(input, target);
    const threshold = Math.floor(target.length * 0.3); // Allow 30% difference
    return distance <= threshold;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }

  // =========================================================================
  // TEXT-TO-SPEECH
  // =========================================================================

  /**
   * Convert text to speech audio
   */
  async synthesize(text: string): Promise<Buffer> {
    const startTime = Date.now();
    
    try {
      this.setState('speaking');
      
      let audioBuffer: Buffer;
      
      switch (this.config.ttsProvider) {
        case 'elevenlabs':
          audioBuffer = await this.synthesizeWithElevenLabs(text);
          break;
        default:
          throw new Error(`Unsupported TTS provider: ${this.config.ttsProvider}`);
      }
      
      const duration = Date.now() - startTime;
      logger.debug('Speech synthesis complete', { 
        textLength: text.length,
        audioSize: audioBuffer.length,
        durationMs: duration,
      });
      
      auditLog('VOICE_SYNTHESIZE', {
        textLength: text.length,
        provider: this.config.ttsProvider,
        durationMs: duration,
      });
      
      return audioBuffer;
      
    } catch (error) {
      logger.error('Speech synthesis failed', { error: String(error) });
      this.setState('error');
      throw error;
    } finally {
      if (this.state === 'speaking') {
        this.setState('idle');
      }
    }
  }

  private async synthesizeWithElevenLabs(text: string): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      logger.warn('ElevenLabs API key missing');
      throw new Error('ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to your .env file.');
    }
    
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.elevenLabsVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2', // Faster, low latency (JARVIS-like)
            voice_settings: {
              stability: this.config.voiceStability,
              similarity_boost: this.config.voiceSimilarityBoost,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('ElevenLabs API Error', { status: response.status, body: errorText });

        let errorMessage = `ElevenLabs API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.detail?.message) errorMessage = errorJson.detail.message;
          else if (errorJson.detail) errorMessage = JSON.stringify(errorJson.detail);
        } catch (e) {
          // Use raw text if JSON parse fails
          if (errorText.length < 200) errorMessage += ` - ${errorText}`;
        }

        throw new Error(errorMessage);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error('ElevenLabs synthesis failed', { error });
      throw error;
    }
  }

  // =========================================================================
  // AUDIO STREAMING
  // =========================================================================

  /**
   * Start continuous listening mode
   */
  startListening(): void {
    if (this.isListening) return;
    
    this.isListening = true;
    this.setState('listening_wake_word');
    this.emit('listeningStarted');
    
    logger.info('Voice listening started');
  }

  /**
   * Stop listening
   */
  stopListening(): void {
    if (!this.isListening) return;
    
    this.isListening = false;
    this.setState('idle');
    this.audioBuffer = [];
    this.emit('listeningStopped');
    
    logger.info('Voice listening stopped');
  }

  /**
   * Process incoming audio chunk
   */
  async processAudioChunk(chunk: Buffer): Promise<void> {
    if (!this.isListening) return;
    
    this.audioBuffer.push(chunk);
    
    // Check if we have enough audio for processing
    const totalSize = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
    
    // Process when we have ~2 seconds of audio (assuming 16kHz, 16-bit mono)
    if (totalSize >= 64000) {
      await this.processBufferedAudio();
    }
  }

  /**
   * Process buffered audio
   */
  async processBufferedAudio(): Promise<void> {
    if (this.audioBuffer.length === 0) return;
    
    const audioData = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    
    try {
      // Transcribe
      const result = await this.transcribe(audioData, 'audio/wav');
      
      if (!result.text || result.text.length < 2) {
        return;
      }
      
      // Check for wake word
      const wakeEvent = this.detectWakeWord(result.text);
      
      if (wakeEvent.detected) {
        this.emit('wakeWordDetected', wakeEvent);
        
        // Extract command if present
        const command = this.extractCommand(result.text);
        
        if (command && command.length > 0) {
          this.emit('commandDetected', { text: command, confidence: result.confidence });
        } else {
          // Wake word only - wait for command
          this.setState('listening_command');
          this.emit('awaitingCommand');
        }
      } else if (this.state === 'listening_command') {
        // We're waiting for a command after wake word
        this.emit('commandDetected', { text: result.text, confidence: result.confidence });
        this.setState('listening_wake_word');
      }
      
    } catch (error) {
      logger.error('Audio processing failed', { error: String(error) });
    }
  }

  /**
   * Force process remaining buffer (on silence detection)
   */
  async flushBuffer(): Promise<void> {
    await this.processBufferedAudio();
  }

  // =========================================================================
  // CONFIGURATION
  // =========================================================================

  updateConfig(updates: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Voice config updated', { updates: Object.keys(updates) });
  }

  getConfig(): VoiceConfig {
    return { ...this.config };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

export const voiceService = new VoiceService();
