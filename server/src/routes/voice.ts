/**
 * Voice API Routes
 * 
 * Endpoints for voice functionality:
 * - POST /voice/transcribe - Convert audio to text
 * - POST /voice/synthesize - Convert text to audio
 * - POST /voice/process - Full voice pipeline (STT → LLM → TTS)
 * - WebSocket /voice/stream - Real-time voice streaming
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { voiceService } from '../services/voice';
import { processPipeline } from '../core/executionPipeline';
import { logger, auditLog } from '../services/logger';

export const voiceRouter = Router();

// =============================================================================
// SCHEMAS
// =============================================================================

const synthesizeSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

const configSchema = z.object({
  wakeWord: z.string().optional(),
  wakeWordSensitivity: z.number().min(0).max(1).optional(),
  sttProvider: z.enum(['whisper', 'whisper-local', 'azure', 'google']).optional(),
  language: z.string().optional(),
  continuousListening: z.boolean().optional(),
});

// =============================================================================
// MIDDLEWARE
// =============================================================================

voiceRouter.use(requireAuth);

// =============================================================================
// TRANSCRIPTION (STT)
// =============================================================================

/**
 * POST /voice/transcribe
 * Convert audio to text
 */
voiceRouter.post('/transcribe', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Check for audio data
    if (!req.body || !Buffer.isBuffer(req.body)) {
      // Check for base64 encoded audio
      if (req.body?.audio) {
        const audioBuffer = Buffer.from(req.body.audio, 'base64');
        const mimeType = req.body.mimeType || 'audio/webm';
        
        const result = await voiceService.transcribe(audioBuffer, mimeType);
        
        // Check for wake word
        const wakeWord = voiceService.detectWakeWord(result.text);
        const command = voiceService.extractCommand(result.text);
        
        return res.json({
          success: true,
          text: result.text,
          confidence: result.confidence,
          language: result.language,
          duration: result.duration,
          wakeWord: wakeWord.detected ? {
            detected: true,
            confidence: wakeWord.confidence,
            command,
          } : null,
        });
      }
      
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    // Raw audio buffer in body
    const contentType = req.get('content-type') || 'audio/webm';
    const result = await voiceService.transcribe(req.body, contentType);
    
    const wakeWord = voiceService.detectWakeWord(result.text);
    const command = voiceService.extractCommand(result.text);
    
    res.json({
      success: true,
      text: result.text,
      confidence: result.confidence,
      language: result.language,
      wakeWord: wakeWord.detected ? {
        detected: true,
        confidence: wakeWord.confidence,
        command,
      } : null,
    });
    
  } catch (error: any) {
    logger.error('Transcription failed', { error });
    res.status(500).json({ 
      error: 'Transcription failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =============================================================================
// SYNTHESIS (TTS)
// =============================================================================

/**
 * POST /voice/synthesize
 * Convert text to audio
 */
voiceRouter.post('/synthesize', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = synthesizeSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: 'Invalid request', 
        details: parsed.error.issues,
      });
    }
    
    const { text, voiceId, stability, similarityBoost } = parsed.data;
    
    // Update config if parameters provided
    if (voiceId || stability !== undefined || similarityBoost !== undefined) {
      voiceService.updateConfig({
        ...(voiceId && { elevenLabsVoiceId: voiceId }),
        ...(stability !== undefined && { voiceStability: stability }),
        ...(similarityBoost !== undefined && { voiceSimilarityBoost: similarityBoost }),
      });
    }
    
    const audioBuffer = await voiceService.synthesize(text);
    
    // Return as audio file
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': 'inline; filename="speech.mp3"',
    });
    
    res.send(audioBuffer);
    
  } catch (error: any) {
    logger.error('Synthesis failed', { error });
    res.status(500).json({ 
      error: 'Synthesis failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =============================================================================
// FULL VOICE PIPELINE
// =============================================================================

/**
 * POST /voice/process
 * Full voice pipeline: Audio → Text → LLM → Audio
 */
voiceRouter.post('/process', async (req: AuthenticatedRequest, res: Response) => {
  try {
    let audioBuffer: Buffer;
    let mimeType: string;
    
    // Parse audio input
    if (req.body?.audio) {
      audioBuffer = Buffer.from(req.body.audio, 'base64');
      mimeType = req.body.mimeType || 'audio/webm';
    } else if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
      mimeType = req.get('content-type') || 'audio/webm';
    } else {
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    // Step 1: Transcribe
    const transcription = await voiceService.transcribe(audioBuffer, mimeType);
    
    if (!transcription.text || transcription.text.length < 2) {
      return res.json({
        success: true,
        transcription: { text: '', confidence: 0 },
        response: null,
        audio: null,
        message: 'No speech detected',
      });
    }
    
    // Step 2: Check for wake word and extract command
    const wakeWord = voiceService.detectWakeWord(transcription.text);
    const command = voiceService.extractCommand(transcription.text);
    
    // If wake word detection is required and not found
    if (req.body.requireWakeWord && !wakeWord.detected) {
      return res.json({
        success: true,
        transcription,
        wakeWordRequired: true,
        wakeWordDetected: false,
        response: null,
        audio: null,
      });
    }
    
    const textToProcess = command || transcription.text;
    
    // Step 3: Process through LLM pipeline
    const pipelineResponse = await processPipeline({
      userId: req.user!.userId,
      message: textToProcess,
      conversationHistory: req.body.conversationHistory || [],
      worldState: req.body.worldState,
    });
    
    // Step 4: Synthesize response
    let responseAudio: Buffer | null = null;
    const responseText = pipelineResponse.response;
    
    if (responseText && req.body.synthesizeResponse !== false) {
      try {
        responseAudio = await voiceService.synthesize(responseText);
      } catch (synthError) {
        logger.error('Response synthesis failed', { error: synthError });
        // Continue without audio
      }
    }
    
    res.json({
      success: true,
      transcription: {
        text: transcription.text,
        confidence: transcription.confidence,
        language: transcription.language,
      },
      wakeWord: wakeWord.detected ? {
        detected: true,
        confidence: wakeWord.confidence,
        command,
      } : null,
      response: {
        text: responseText,
        intent: pipelineResponse.intent,
        executionResult: pipelineResponse.executionResult,
        pendingConfirmation: pipelineResponse.pendingConfirmation,
      },
      audio: responseAudio ? responseAudio.toString('base64') : null,
    });
    
  } catch (error: any) {
    logger.error('Voice processing failed', { error });
    res.status(500).json({ 
      error: 'Voice processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * GET /voice/config
 * Get voice configuration
 */
voiceRouter.get('/config', async (req: AuthenticatedRequest, res: Response) => {
  const config = voiceService.getConfig();
  res.json({
    wakeWord: config.wakeWord,
    sttProvider: config.sttProvider,
    ttsProvider: config.ttsProvider,
    language: config.language,
    continuousListening: config.continuousListening,
  });
});

/**
 * PUT /voice/config
 * Update voice configuration
 */
voiceRouter.put('/config', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = configSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ 
        error: 'Invalid configuration', 
        details: parsed.error.issues,
      });
    }
    
    voiceService.updateConfig(parsed.data);
    
    auditLog('VOICE_CONFIG_UPDATE', { 
      userId: req.user!.userId,
      updates: Object.keys(parsed.data),
    });
    
    res.json({ success: true, config: voiceService.getConfig() });
    
  } catch (error: any) {
    logger.error('Config update failed', { error });
    res.status(500).json({ error: 'Config update failed' });
  }
});

// =============================================================================
// STATE
// =============================================================================

/**
 * GET /voice/state
 * Get current voice state
 */
voiceRouter.get('/state', async (req: AuthenticatedRequest, res: Response) => {
  res.json({
    state: voiceService.getState(),
    config: voiceService.getConfig(),
  });
});

/**
 * POST /voice/listen/start
 * Start continuous listening
 */
voiceRouter.post('/listen/start', async (req: AuthenticatedRequest, res: Response) => {
  voiceService.startListening();
  res.json({ success: true, state: voiceService.getState() });
});

/**
 * POST /voice/listen/stop
 * Stop continuous listening
 */
voiceRouter.post('/listen/stop', async (req: AuthenticatedRequest, res: Response) => {
  voiceService.stopListening();
  res.json({ success: true, state: voiceService.getState() });
});

// =============================================================================
// WEBSOCKET STREAMING
// =============================================================================

/**
 * Setup WebSocket server for real-time voice streaming
 */
export function setupVoiceWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: any) => {
    logger.info('Voice WebSocket connected');
    
    let audioChunks: Buffer[] = [];
    let isProcessing = false;
    
    ws.on('message', async (data: Buffer) => {
      try {
        // Check if it's a control message (JSON)
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'start') {
            audioChunks = [];
            ws.send(JSON.stringify({ type: 'listening', state: 'started' }));
            return;
          }
          
          if (message.type === 'stop' || message.type === 'end') {
            if (audioChunks.length > 0 && !isProcessing) {
              isProcessing = true;
              
              const fullAudio = Buffer.concat(audioChunks);
              audioChunks = [];
              
              try {
                const result = await voiceService.transcribe(fullAudio, 'audio/webm');
                
                const wakeWord = voiceService.detectWakeWord(result.text);
                const command = voiceService.extractCommand(result.text);
                
                ws.send(JSON.stringify({
                  type: 'transcription',
                  text: result.text,
                  confidence: result.confidence,
                  wakeWord: wakeWord.detected,
                  command,
                }));
              } catch (err) {
                ws.send(JSON.stringify({ type: 'error', error: 'Transcription failed' }));
              }
              
              isProcessing = false;
            }
            return;
          }
          
          if (message.type === 'config') {
            voiceService.updateConfig(message.config);
            ws.send(JSON.stringify({ type: 'config', config: voiceService.getConfig() }));
            return;
          }
          
        } catch {
          // Not JSON, treat as audio data
        }
        
        // Audio data
        audioChunks.push(data);
        
        // Send acknowledgment
        ws.send(JSON.stringify({ 
          type: 'chunk_received', 
          size: data.length,
          totalSize: audioChunks.reduce((sum, b) => sum + b.length, 0),
        }));
        
      } catch (error: any) {
        logger.error('WebSocket message error', { error });
        ws.send(JSON.stringify({ type: 'error', error: 'Processing failed' }));
      }
    });
    
    ws.on('close', () => {
      logger.info('Voice WebSocket disconnected');
      audioChunks = [];
    });
    
    ws.on('error', (error) => {
      logger.error('Voice WebSocket error', { error });
    });
    
    // Send initial state
    ws.send(JSON.stringify({
      type: 'connected',
      state: voiceService.getState(),
      config: {
        wakeWord: voiceService.getConfig().wakeWord,
      },
    }));
  });
}
