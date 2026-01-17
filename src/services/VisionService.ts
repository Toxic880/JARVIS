/**
 * VISION SERVICE
 * 
 * Gives JARVIS eyes - camera integration for:
 * - Seeing the user
 * - Face detection/recognition
 * - Observing the environment
 * - Reading expressions/mood
 * 
 * Uses browser getUserMedia + sends frames to vision-capable LLM
 */

export interface VisionObservation {
  timestamp: Date;
  description: string;
  people: number;
  mood?: 'happy' | 'neutral' | 'tired' | 'stressed' | 'focused';
  activity?: string;
  confidence: number;
}

export interface FaceData {
  name?: string;
  isKnown: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export class VisionService {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private isActive: boolean = false;
  private lastObservation: VisionObservation | null = null;
  private observationInterval: ReturnType<typeof setInterval> | null = null;
  
  // LLM endpoint for vision analysis
  private visionEndpoint: string = '';
  private visionModel: string = '';
  
  // Callbacks
  private onObservation?: (observation: VisionObservation) => void;
  private onFaceDetected?: (face: FaceData) => void;

  constructor(config?: {
    visionEndpoint?: string;
    visionModel?: string;
    onObservation?: (observation: VisionObservation) => void;
    onFaceDetected?: (face: FaceData) => void;
  }) {
    this.visionEndpoint = config?.visionEndpoint || '';
    this.visionModel = config?.visionModel || 'gpt-4-vision-preview';
    this.onObservation = config?.onObservation;
    this.onFaceDetected = config?.onFaceDetected;
    
    // Create hidden video and canvas elements
    this.setupElements();
  }

  private setupElements() {
    // Video element to receive camera stream
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', 'true');
    this.video.setAttribute('autoplay', 'true');
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    // Canvas for capturing frames
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Start the camera
   */
  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      if (this.video) {
        this.video.srcObject = this.stream;
        await this.video.play();
      }

      this.isActive = true;
      console.log('[Vision] Camera started');
      return true;
    } catch (error) {
      console.error('[Vision] Failed to start camera:', error);
      return false;
    }
  }

  /**
   * Stop the camera
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
    }
    
    this.isActive = false;
    console.log('[Vision] Camera stopped');
  }

  /**
   * Capture current frame as base64
   */
  captureFrame(): string | null {
    if (!this.video || !this.canvas || !this.ctx || !this.isActive) {
      return null;
    }

    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/jpeg', 0.8);
  }

  /**
   * Get a description of what JARVIS sees (for including in prompts)
   */
  async analyzeScene(customPrompt?: string): Promise<string> {
    const frame = this.captureFrame();
    if (!frame) {
      return "I don't have visual access at the moment.";
    }

    // If we have a vision endpoint configured, use it
    if (this.visionEndpoint) {
      return this.analyzeWithLLM(frame, customPrompt);
    }

    // Otherwise return a basic message
    return "I can see you, Sir, though my visual analysis capabilities are limited without a vision model configured.";
  }

  /**
   * Analyze frame with vision-capable LLM
   */
  private async analyzeWithLLM(frameBase64: string, customPrompt?: string): Promise<string> {
    const prompt = customPrompt || `You are JARVIS observing through a camera. Briefly describe what you see in a natural, JARVIS-like way. Focus on:
- The person (if visible): their apparent mood, what they're doing, how they look
- The environment
- Anything notable

Be concise and natural, like JARVIS would speak. Don't be robotic.`;

    try {
      // Try OpenAI-compatible endpoint first
      const response = await fetch(this.visionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.visionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { 
                  type: 'image_url', 
                  image_url: { 
                    url: frameBase64,
                    detail: 'low'
                  } 
                }
              ]
            }
          ],
          max_tokens: 150,
        }),
      });

      if (!response.ok) {
        throw new Error(`Vision API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "I'm having trouble processing what I see.";
    } catch (error) {
      console.error('[Vision] Analysis failed:', error);
      return "My visual processing encountered an issue, Sir.";
    }
  }

  /**
   * Quick check - is someone there?
   */
  async detectPresence(): Promise<boolean> {
    const frame = this.captureFrame();
    if (!frame) return false;

    // Simple presence detection could use face-api.js or similar
    // For now, we'll assume if camera is active and we can capture, someone might be there
    return true;
  }

  /**
   * Start periodic observation (for proactive comments)
   */
  startPeriodicObservation(intervalMs: number = 60000) {
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
    }

    this.observationInterval = setInterval(async () => {
      if (!this.isActive) return;

      const description = await this.analyzeScene();
      
      const observation: VisionObservation = {
        timestamp: new Date(),
        description,
        people: 1, // Simplified for now
        confidence: 0.7,
      };

      this.lastObservation = observation;
      this.onObservation?.(observation);
    }, intervalMs);
  }

  /**
   * Get the last observation
   */
  getLastObservation(): VisionObservation | null {
    return this.lastObservation;
  }

  /**
   * Check if camera is active
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Set vision endpoint
   */
  setVisionEndpoint(endpoint: string, model: string = 'gpt-4-vision-preview') {
    this.visionEndpoint = endpoint;
    this.visionModel = model;
  }

  /**
   * Get current frame for display (e.g., in UI)
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /**
   * Take a snapshot and return as blob
   */
  async takeSnapshot(): Promise<Blob | null> {
    const frame = this.captureFrame();
    if (!frame) return null;

    const response = await fetch(frame);
    return response.blob();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stop();
    
    if (this.video) {
      this.video.remove();
      this.video = null;
    }
    
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
  }
}
