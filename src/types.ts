// ============================================================================
// JARVIS TYPE DEFINITIONS
// ============================================================================

// --- CORE STATE ---

// Overlay types for the holographic display system
export type HolographicOverlay = 'NONE' | 'WEATHER' | 'NEWS' | 'SYSTEM' | 'LISTS' | 'CALENDAR' | 'STOCKS' | 'MUSIC' | 'RADAR';

export interface JarvisState {
  status: 'OFFLINE' | 'STANDBY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'ERROR';
  userProfile: UserProfile | null;
  environment: EnvironmentState;
  
  // Features
  timers: SystemTimer[];
  alarms: Alarm[];
  reminders: Reminder[];
  lists: Record<string, ListItem[]>;
  notes: Record<string, Note>;
  smartHome: SmartDevice[];
  calendar: CalendarEvent[];
  
  // UI State
  lastTranscript: string;
  lastResponse: string;
  logs: LogEntry[];
  
  // News display (JARVIS controlled)
  currentNews?: any[];
  newsCategory?: string;
  
  // === HOLOGRAPHIC DISPLAY SYSTEM (Phase 2) ===
  // The Core controls what the UI shows
  activeOverlay: HolographicOverlay;
  visualData: any; // Flexible payload for the overlay (e.g., weather JSON, stocks, etc.)
  
  // Error handling
  lastError: string | null;
}

export interface EnvironmentState {
  location: string;
  temperature: number;
  weatherCondition: string;
  time: string;
  date: string;
  batteryLevel: number;
  online: boolean;
}

// --- USER PROFILE ---

export interface UserProfile {
  name: string;
  location: string;
  lat?: number;
  lng?: number;
  isConfigured: boolean;
  faceIdData?: string;
  permissions: PermissionLevel;
  preferences: UserPreferences;
}

export interface UserPreferences {
  tempUnit: 'celsius' | 'fahrenheit';
  musicService: 'spotify' | 'applemusic' | 'youtube' | 'default';
  newsSource: 'general' | 'tech' | 'business' | 'sports';
  wakeWord: string;
  wakeWordEnabled: boolean;
  voiceSpeed: 'normal' | 'fast' | 'slow';
  briefMode: boolean;
  
  // LM Studio
  lmStudioUrl: string;
  lmStudioModel: string;
  
  // Home Assistant
  homeAssistantUrl?: string;
  homeAssistantToken?: string;
  
  // Spotify (PKCE - no secret needed)
  spotifyClientId?: string;
  
  // Google (OAuth - requires secret)
  googleClientId?: string;
  googleClientSecret?: string;
  
  // Twilio SMS
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  
  // Whoop
  whoopClientId?: string;
  whoopClientSecret?: string;
  
  // Voice (ElevenLabs or browser TTS)
  voiceProvider: 'browser' | 'elevenlabs';
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  
  // Whisper Mode (quiet hours)
  whisperMode: boolean;
  whisperModeAuto: boolean;      // Auto-enable during quiet hours
  whisperModeStart?: string;     // "22:00"
  whisperModeEnd?: string;       // "07:00"
  
  // Push Notifications
  pushoverUserKey?: string;
  pushoverApiToken?: string;
  ntfyServerUrl?: string;
  ntfyTopic?: string;
  pushNotificationsEnabled: boolean;
  
  // Dashboard/Display
  wallDashboardEnabled: boolean;
  
  linkedAccounts: {
    googleCalendar: boolean;
    spotify: boolean;
    email: boolean;
    sms: boolean;
    whoop: boolean;
  };
  
  emergencyContact?: {
    name: string;
    phone: string;
  };
}

export type PermissionLevel = 'GUEST' | 'USER' | 'ADMIN' | 'ROOT';

// --- TIMERS ---

export interface SystemTimer {
  id: string;
  label: string;
  duration: number;    // Total duration in seconds
  remaining: number;   // Remaining time in seconds
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  createdAt: number;
}

// --- ALARMS ---

export interface Alarm {
  id: string;
  time: string;        // HH:MM format
  label: string;
  enabled: boolean;
  recurring: boolean;
  days: string[];      // ['monday', 'wednesday', 'friday']
  sound?: string;      // Sound file/name
  createdAt: number;
}

// --- REMINDERS ---

export interface Reminder {
  id: string;
  message: string;
  time: number;        // Unix timestamp
  recurring: boolean;
  recurringInterval?: number;  // Milliseconds
  triggered: boolean;
  createdAt: number;
}

// --- LISTS ---

export interface ListItem {
  id: string;
  content: string;
  completed: boolean;
  createdAt: number;
}

// --- NOTES ---

export interface Note {
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

// --- SMART HOME ---

export interface SmartDevice {
  id: string;
  name: string;
  type: 'light' | 'switch' | 'lock' | 'thermostat' | 'camera' | 'sensor' | 'blind' | 'fan';
  status: 'on' | 'off' | 'locked' | 'unlocked' | 'active' | 'inactive';
  value?: number | string;
  location: string;
  lastUpdated?: number;
}

// --- CALENDAR ---

export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  endTime?: string;
  description?: string;
  location?: string;
  recurring?: boolean;
}

// --- LOGGING ---

export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SYSTEM';
  message: string;
  source?: string;
}

// --- LLM & TOOLS ---

export interface JarvisTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// --- ROUTINES ---

export interface Routine {
  id: string;
  name: string;
  trigger: RoutineTrigger;
  actions: RoutineAction[];
  enabled: boolean;
  lastRun?: number;
}

export interface RoutineTrigger {
  type: 'voice' | 'time' | 'sunrise' | 'sunset' | 'device' | 'location';
  phrase?: string;      // For voice triggers
  time?: string;        // For time triggers (HH:MM)
  days?: string[];      // Days of week
  deviceId?: string;    // For device triggers
  deviceState?: string; // State that triggers
}

export interface RoutineAction {
  type: 'device' | 'speak' | 'wait' | 'notification' | 'weather' | 'calendar' | 'calendar_tomorrow' | 'news' | 'reminders' | 'timers' | 'stocks' | 'system_status' | 'traffic' | 'messages';
  deviceId?: string;
  action?: string;
  value?: any;
  message?: string;
  duration?: number;    // For wait actions (seconds)
}

// --- WEATHER ---

export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  location: string;
  forecast?: WeatherForecast[];
}

export interface WeatherForecast {
  date: string;
  high: number;
  low: number;
  condition: string;
}

// --- MEMORY SYSTEM ---

export interface MemoryFragment {
  id: string;
  type: 'EPISODIC' | 'FACTUAL' | 'PREFERENCE' | 'RULE';
  content: string;
  timestamp: number;
  tags: string[];
  salience: number;
  previousEventId?: string;
  outcome?: 'SUCCESS' | 'FAILURE' | 'NEUTRAL';
}

// --- UI COMPONENTS ---

export interface PanelProps {
  className?: string;
}

// --- EVENT CALLBACKS ---

export interface JarvisCallbacks {
  onStateChange: (state: JarvisState) => void;
  onLog: (entry: LogEntry) => void;
  onTimerComplete: (timer: SystemTimer) => void;
  onAlarmTrigger: (alarm: Alarm) => void;
  onReminderTrigger: (reminder: Reminder) => void;
  onSpeakStart: () => void;
  onSpeakEnd: () => void;
  onError: (error: string) => void;
}

// --- LEGACY COMPATIBILITY ---

export interface WorldState extends JarvisState {}

export interface TaskPlan {
  id: string;
  goal: string;
  rootTasks: Task[];
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'PAUSED';
  createdAt: number;
}

export interface Task {
  id: string;
  parentId?: string;
  description: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED';
  subtasks: Task[];
  dependencies: string[];
  toolCall?: string;
  output?: string;
}

export type ToolRiskLevel = 'SAFE' | 'MODERATE' | 'CRITICAL' | 'DESTRUCTIVE';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  requiredPermissions: PermissionLevel;
  riskLevel: ToolRiskLevel;
  execute: (args: any, context: JarvisState) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
  affectedSystem?: string;
  requiresConfirmation?: boolean;
}

export interface NewsItem {
  source: string;
  headline: string;
  summary: string;
  timestamp: string;
}
