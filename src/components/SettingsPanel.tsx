import React, { useState, useEffect } from 'react';
import { UserProfile, UserPreferences } from '../types';
import { useToast, useToastHelpers } from './ui/Toast';

interface SettingsPanelProps {
  profile: UserProfile;
  onSave: (profile: UserProfile) => void;
  onClose: () => void;
  onSpotifyAuth?: () => void;
  onGoogleAuth?: () => void;
  onWhoopAuth?: () => void;
  spotifyConnected?: boolean;
  googleConnected?: boolean;
  whoopConnected?: boolean;
  garminConnected?: boolean;
}

type SettingsSection = 'general' | 'voice' | 'notifications' | 'smartHome' | 'integrations' | 'health' | 'modes' | 'advanced';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  profile,
  onSave,
  onClose,
  onSpotifyAuth,
  onGoogleAuth,
  onWhoopAuth,
  spotifyConnected = false,
  googleConnected = false,
  whoopConnected = false,
  garminConnected = false,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [prefs, setPrefs] = useState<UserPreferences>({ ...profile.preferences });
  const [name, setName] = useState(profile.name);
  const [location, setLocation] = useState(profile.location);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Toast notifications (replaces alert())
  const toast = useToastHelpers();

  useEffect(() => {
    setHasChanges(true);
  }, [prefs, name, location]);

  const handleSave = () => {
    onSave({
      ...profile,
      name,
      location,
      preferences: prefs,
    });
    setHasChanges(false);
  };

  const updatePref = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  const sections: { id: SettingsSection; label: string; icon: string }[] = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'voice', label: 'Voice & Audio', icon: '🎤' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'smartHome', label: 'Smart Home', icon: '🏠' },
    { id: 'integrations', label: 'Integrations', icon: '🔗' },
    { id: 'health', label: 'Health', icon: '❤️' },
    { id: 'modes', label: 'Modes', icon: '🌙' },
    { id: 'advanced', label: 'Advanced', icon: '🔧' },
  ];

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-cyan-700 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex">
        
        {/* Sidebar */}
        <div className="w-56 bg-slate-950 border-r border-cyan-900/50 p-4 flex flex-col">
          <h2 className="text-cyan-400 text-lg font-mono tracking-wider mb-6">SETTINGS</h2>
          
          <nav className="space-y-1 flex-1">
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`
                  w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-all
                  ${activeSection === section.id 
                    ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/50' 
                    : 'text-cyan-600 hover:bg-slate-800 hover:text-cyan-400'}
                `}
              >
                <span className="text-lg">{section.icon}</span>
                <span className="text-sm font-medium">{section.label}</span>
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-cyan-900/50 space-y-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`
                w-full py-2 rounded font-medium transition-all
                ${hasChanges 
                  ? 'bg-cyan-600 text-white hover:bg-cyan-500' 
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'}
              `}
            >
              Save Changes
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 bg-slate-800 text-cyan-500 rounded hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* General Settings */}
          {activeSection === 'general' && (
            <div className="space-y-6">
              <SectionTitle>General Settings</SectionTitle>
              
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Your Name"
                  value={name}
                  onChange={setName}
                  placeholder="Sir"
                />
                <InputField
                  label="Location"
                  value={location}
                  onChange={setLocation}
                  placeholder="New York, NY"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <SelectField
                  label="Temperature Unit"
                  value={prefs.tempUnit}
                  onChange={(v) => updatePref('tempUnit', v as 'celsius' | 'fahrenheit')}
                  options={[
                    { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
                    { value: 'celsius', label: 'Celsius (°C)' },
                  ]}
                />
                <SelectField
                  label="News Source"
                  value={prefs.newsSource}
                  onChange={(v) => updatePref('newsSource', v as any)}
                  options={[
                    { value: 'general', label: 'General News' },
                    { value: 'tech', label: 'Technology' },
                    { value: 'business', label: 'Business' },
                    { value: 'sports', label: 'Sports' },
                  ]}
                />
              </div>

              <ToggleField
                label="Brief Mode"
                description="Shorter, more concise responses"
                checked={prefs.briefMode}
                onChange={(v) => updatePref('briefMode', v)}
              />
            </div>
          )}

          {/* Voice & Audio */}
          {activeSection === 'voice' && (
            <div className="space-y-6">
              <SectionTitle>Voice & Audio</SectionTitle>
              
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Wake Word"
                  value={prefs.wakeWord}
                  onChange={(v) => updatePref('wakeWord', v)}
                  placeholder="jarvis"
                />
                <SelectField
                  label="Voice Speed"
                  value={prefs.voiceSpeed}
                  onChange={(v) => updatePref('voiceSpeed', v as any)}
                  options={[
                    { value: 'slow', label: 'Slow' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'fast', label: 'Fast' },
                  ]}
                />
              </div>

              <ToggleField
                label="Wake Word Detection"
                description='Say the wake word to activate JARVIS'
                checked={prefs.wakeWordEnabled}
                onChange={(v) => updatePref('wakeWordEnabled', v)}
              />

              <Divider />
              
              <SubsectionTitle>Voice Provider</SubsectionTitle>
              
              <SelectField
                label="TTS Provider"
                value={prefs.voiceProvider}
                onChange={(v) => updatePref('voiceProvider', v as 'browser' | 'elevenlabs')}
                options={[
                  { value: 'browser', label: 'Browser TTS (Free)' },
                  { value: 'elevenlabs', label: 'ElevenLabs (Better Quality)' },
                ]}
              />

              {prefs.voiceProvider === 'elevenlabs' && (
                <div className="grid grid-cols-2 gap-6 animate-fadeIn">
                  <InputField
                    label="ElevenLabs API Key"
                    value={prefs.elevenLabsApiKey || ''}
                    onChange={(v) => updatePref('elevenLabsApiKey', v)}
                    type="password"
                    placeholder="xi_..."
                  />
                  <InputField
                    label="Voice ID"
                    value={prefs.elevenLabsVoiceId || ''}
                    onChange={(v) => updatePref('elevenLabsVoiceId', v)}
                    placeholder="Voice ID from ElevenLabs"
                  />
                </div>
              )}
              {prefs.voiceProvider === 'elevenlabs' && (
                <InfoBox>
                  Get your API key from elevenlabs.io → Profile → API Keys. 
                  Find Voice IDs in the Voice Lab. Recommended: "Daniel" (21m00Tcm4TlvDq8ikWAM) for a JARVIS-like voice.
                </InfoBox>
              )}

              <Divider />

              {/* Whisper Mode */}
              <SubsectionTitle>Whisper Mode (Quiet Hours)</SubsectionTitle>
              
              <ToggleField
                label="Whisper Mode"
                description="Reduce volume for quieter responses (great for night time)"
                checked={prefs.whisperMode || false}
                onChange={(v) => updatePref('whisperMode', v)}
              />

              <ToggleField
                label="Auto Whisper Mode"
                description="Automatically enable whisper mode during quiet hours"
                checked={prefs.whisperModeAuto || false}
                onChange={(v) => updatePref('whisperModeAuto', v)}
              />

              {prefs.whisperModeAuto && (
                <div className="grid grid-cols-2 gap-6">
                  <InputField
                    label="Quiet Hours Start"
                    value={prefs.whisperModeStart || '22:00'}
                    onChange={(v) => updatePref('whisperModeStart', v)}
                    placeholder="22:00"
                  />
                  <InputField
                    label="Quiet Hours End"
                    value={prefs.whisperModeEnd || '07:00'}
                    onChange={(v) => updatePref('whisperModeEnd', v)}
                    placeholder="07:00"
                  />
                </div>
              )}
            </div>
          )}

          {/* Notifications */}
          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <SectionTitle>Push Notifications</SectionTitle>
              
              <InfoBox>
                Get alerts on your phone when JARVIS needs to reach you - timers, reminders, calendar events, and more.
              </InfoBox>

              <ToggleField
                label="Enable Push Notifications"
                description="Send notifications to your phone when you're away"
                checked={prefs.pushNotificationsEnabled || false}
                onChange={(v) => updatePref('pushNotificationsEnabled', v)}
              />

              {prefs.pushNotificationsEnabled && (
                <>
                  <Divider />
                  
                  {/* Pushover */}
                  <SubsectionTitle>Pushover (Recommended)</SubsectionTitle>
                  <div className="grid grid-cols-2 gap-6">
                    <InputField
                      label="User Key"
                      value={prefs.pushoverUserKey || ''}
                      onChange={(v) => updatePref('pushoverUserKey', v)}
                      placeholder="Your Pushover user key"
                    />
                    <InputField
                      label="API Token"
                      value={prefs.pushoverApiToken || ''}
                      onChange={(v) => updatePref('pushoverApiToken', v)}
                      type="password"
                      placeholder="Your app API token"
                    />
                  </div>
                  <InfoBox>
                    Get Pushover at pushover.net ($5 one-time for mobile app). Create an app in your dashboard to get the API token.
                  </InfoBox>

                  {prefs.pushoverUserKey && prefs.pushoverApiToken && (
                    <button
                      style={{
                        background: '#7c3aed',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                      }}
                      onClick={async () => {
                        try {
                          const formData = new FormData();
                          formData.append('token', prefs.pushoverApiToken!);
                          formData.append('user', prefs.pushoverUserKey!);
                          formData.append('title', 'JARVIS Test');
                          formData.append('message', 'Push notifications are working!');
                          
                          const response = await fetch('https://api.pushover.net/1/messages.json', {
                            method: 'POST',
                            body: formData,
                          });
                          
                          if (response.ok) {
                            toast.success('Notification Sent', 'Check your phone for the test message');
                          } else {
                            toast.error('Notification Failed', 'Check your credentials and try again');
                          }
                        } catch (e: any) {
                          toast.error('Connection Error', e.message);
                        }
                      }}
                    >
                      Send Test Notification
                    </button>
                  )}

                  <Divider />

                  {/* ntfy - free alternative */}
                  <SubsectionTitle>ntfy (Free Alternative)</SubsectionTitle>
                  <div className="grid grid-cols-2 gap-6">
                    <InputField
                      label="Server URL"
                      value={prefs.ntfyServerUrl || 'https://ntfy.sh'}
                      onChange={(v) => updatePref('ntfyServerUrl', v)}
                      placeholder="https://ntfy.sh"
                    />
                    <InputField
                      label="Topic"
                      value={prefs.ntfyTopic || ''}
                      onChange={(v) => updatePref('ntfyTopic', v)}
                      placeholder="your-unique-topic-name"
                    />
                  </div>
                  <InfoBox>
                    ntfy is free and open source. Download the app and subscribe to your topic. Use a unique topic name only you know.
                  </InfoBox>
                </>
              )}
            </div>
          )}

          {/* Smart Home */}
          {activeSection === 'smartHome' && (
            <div className="space-y-6">
              <SectionTitle>Smart Home</SectionTitle>
              
              <SubsectionTitle>Home Assistant</SubsectionTitle>
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Home Assistant URL"
                  value={prefs.homeAssistantUrl || ''}
                  onChange={(v) => updatePref('homeAssistantUrl', v)}
                  placeholder="http://homeassistant.local:8123"
                />
                <InputField
                  label="Long-Lived Access Token"
                  value={prefs.homeAssistantToken || ''}
                  onChange={(v) => updatePref('homeAssistantToken', v)}
                  type="password"
                  placeholder="Token from HA profile"
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  style={{
                    background: '#0891b2',
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                  onClick={async () => {
                    console.log('[HA] Test button clicked');
                    if (!prefs.homeAssistantUrl || !prefs.homeAssistantToken) {
                      toast.warning('Missing Configuration', 'Please enter Home Assistant URL and Token first');
                      return;
                    }
                    try {
                      console.log('[HA] Testing connection to:', prefs.homeAssistantUrl);
                      const response = await fetch(`${prefs.homeAssistantUrl}/api/`, {
                        headers: { 'Authorization': `Bearer ${prefs.homeAssistantToken}` },
                      });
                      console.log('[HA] Response status:', response.status);
                      if (response.ok) {
                        toast.success('Connected', 'Successfully connected to Home Assistant');
                      } else {
                        toast.error('Connection Failed', `HTTP ${response.status}: ${response.statusText}`);
                      }
                    } catch (e: any) {
                      console.error('[HA] Error:', e);
                      toast.error('Connection Failed', e.message);
                    }
                  }}
                >
                  Test Connection
                </button>
              </div>
              
              <InfoBox>
                Get your token from Home Assistant → Profile → Long-Lived Access Tokens → Create Token.
                The URL should include the port (usually 8123).
              </InfoBox>
            </div>
          )}

          {/* Integrations */}
          {activeSection === 'integrations' && (
            <div className="space-y-6">
              <SectionTitle>Integrations</SectionTitle>
              
              {/* LLM Configuration */}
              <SubsectionTitle>AI Backend (LM Studio / OpenAI)</SubsectionTitle>
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="API URL"
                  value={prefs.lmStudioUrl}
                  onChange={(v) => updatePref('lmStudioUrl', v)}
                  placeholder="http://127.0.0.1:1234"
                />
                <InputField
                  label="Model Name"
                  value={prefs.lmStudioModel}
                  onChange={(v) => updatePref('lmStudioModel', v)}
                  placeholder="gpt-oss-20b or model name"
                />
              </div>
              
              {(prefs.lmStudioUrl?.includes('127.0.0.1') || prefs.lmStudioUrl?.includes('localhost')) && (
                <WarningBox>
                  ⚠️ <strong>For phone/remote access:</strong> Change <code>127.0.0.1</code> to your PC's actual IP address (e.g., <code>http://192.168.1.100:1234</code>). 
                  Run <code>ipconfig</code> (Windows) or <code>ifconfig</code> (Mac/Linux) to find your IP.
                  Also make sure LM Studio is set to listen on all interfaces (0.0.0.0).
                </WarningBox>
              )}

              <Divider />

              {/* Spotify */}
              <SubsectionTitle>Spotify</SubsectionTitle>
              <div className="flex items-center gap-4">
                <InputField
                  label="Client ID"
                  value={prefs.spotifyClientId || ''}
                  onChange={(v) => updatePref('spotifyClientId', v)}
                  placeholder="From developer.spotify.com"
                  className="flex-1"
                />
                <div className="pt-6">
                  <StatusBadge connected={spotifyConnected} />
                </div>
              </div>
              {spotifyConnected ? null : (
                <button
                  style={{
                    background: '#16a34a',
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                  onClick={() => {
                    console.log('[SPOTIFY] Button clicked at', new Date().toISOString());
                    
                    if (!onSpotifyAuth) {
                      toast.error('Configuration Error', 'Spotify auth handler not available');
                      return;
                    }
                    
                    if (!prefs.spotifyClientId) {
                      toast.warning('Missing Client ID', 'Please enter Spotify Client ID first, then Save Changes');
                      return;
                    }
                    
                    console.log('[SPOTIFY] Calling onSpotifyAuth()...');
                    onSpotifyAuth();
                  }}
                >
                  Connect Spotify
                </button>
              )}
              <InfoBox>
                Uses PKCE flow - no client secret needed. Redirect URI: {window.location.origin}/callback
              </InfoBox>

              <Divider />

              {/* Google */}
              <SubsectionTitle>Google (Calendar, Tasks, Email)</SubsectionTitle>
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Client ID"
                  value={prefs.googleClientId || ''}
                  onChange={(v) => updatePref('googleClientId', v)}
                  placeholder="From Google Cloud Console"
                />
                <InputField
                  label="Client Secret"
                  value={prefs.googleClientSecret || ''}
                  onChange={(v) => updatePref('googleClientSecret', v)}
                  type="password"
                  placeholder="Required for Google OAuth"
                />
              </div>
              <div className="flex items-center gap-4">
                {googleConnected ? (
                  <StatusBadge connected={true} />
                ) : (
                  <>
                    <button
                      style={{
                        background: '#2563eb',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold',
                      }}
                      onClick={() => {
                        console.log('[GOOGLE] Button clicked at', new Date().toISOString());
                        
                        if (!onGoogleAuth) {
                          toast.error('Configuration Error', 'Google auth handler not available');
                          return;
                        }
                        
                        if (!prefs.googleClientId || !prefs.googleClientSecret) {
                          toast.warning('Missing Credentials', 'Please enter both Google Client ID and Secret first, then Save Changes');
                          return;
                        }
                        
                        console.log('[GOOGLE] Calling onGoogleAuth()...');
                        onGoogleAuth();
                      }}
                    >
                      Connect Google
                    </button>
                    <StatusBadge connected={false} />
                  </>
                )}
              </div>
              <WarningBox>
                ⚠️ Google requires BOTH Client ID and Client Secret (unlike Spotify)
              </WarningBox>

              <Divider />

              {/* Twilio SMS */}
              <SubsectionTitle>SMS (Twilio)</SubsectionTitle>
              <div className="grid grid-cols-3 gap-4">
                <InputField
                  label="Account SID"
                  value={prefs.twilioAccountSid || ''}
                  onChange={(v) => updatePref('twilioAccountSid', v)}
                  placeholder="AC..."
                />
                <InputField
                  label="Auth Token"
                  value={prefs.twilioAuthToken || ''}
                  onChange={(v) => updatePref('twilioAuthToken', v)}
                  type="password"
                  placeholder="Auth token"
                />
                <InputField
                  label="Phone Number"
                  value={prefs.twilioPhoneNumber || ''}
                  onChange={(v) => updatePref('twilioPhoneNumber', v)}
                  placeholder="+1234567890"
                />
              </div>
              <InfoBox>
                Get credentials from twilio.com/console. Buy a phone number to send SMS.
              </InfoBox>
            </div>
          )}

          {/* Health */}
          {activeSection === 'health' && (
            <div className="space-y-6">
              <SectionTitle>Health Tracking</SectionTitle>
              
              {/* Whoop */}
              <SubsectionTitle>Whoop</SubsectionTitle>
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Client ID"
                  value={prefs.whoopClientId || ''}
                  onChange={(v) => updatePref('whoopClientId', v)}
                  placeholder="From developer.whoop.com"
                />
                <InputField
                  label="Client Secret"
                  value={prefs.whoopClientSecret || ''}
                  onChange={(v) => updatePref('whoopClientSecret', v)}
                  type="password"
                />
              </div>
              
              {/* Whoop Connect Button - Completely rewritten */}
              <div style={{ marginTop: '16px' }}>
                {whoopConnected ? (
                  <span style={{ color: 'lime', fontWeight: 'bold' }}>✓ WHOOP CONNECTED</span>
                ) : (
                  <button
                    style={{
                      background: '#ca8a04',
                      color: 'white',
                      padding: '12px 24px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: 'bold',
                    }}
                    onClick={() => {
                      console.log('[WHOOP] Button clicked at', new Date().toISOString());
                      
                      if (!onWhoopAuth) {
                        toast.error('Configuration Error', 'Whoop auth handler not available');
                        return;
                      }
                      
                      if (!prefs.whoopClientId || !prefs.whoopClientSecret) {
                        toast.warning('Missing Credentials', 'Please enter Whoop Client ID and Secret first, then Save Changes');
                        return;
                      }
                      
                      console.log('[WHOOP] Calling onWhoopAuth()...');
                      onWhoopAuth();
                    }}
                  >
                    Connect Whoop
                  </button>
                )}
                <span style={{ marginLeft: '12px', color: whoopConnected ? 'lime' : 'gray' }}>
                  {whoopConnected ? 'Connected' : 'Not Connected'}
                </span>
              </div>
              
              <InfoBox>
                Provides recovery score, sleep analysis, strain, and HRV data. Get your Client ID and Secret from developer.whoop.com
              </InfoBox>
            </div>
          )}

          {/* Modes */}
          {activeSection === 'modes' && (
            <div className="space-y-6">
              <SectionTitle>JARVIS Modes</SectionTitle>
              
              <div className="grid grid-cols-2 gap-4">
                <ModeCard
                  icon="🌙"
                  name="Do Not Disturb"
                  command='"Enable DND"'
                  description="No interruptions except emergencies"
                />
                <ModeCard
                  icon="😴"
                  name="Sleep Mode"
                  command='"Goodnight JARVIS"'
                  description="Silent operation, emergency only"
                />
                <ModeCard
                  icon="👥"
                  name="Guest Mode"
                  command='"We have guests"'
                  description="Hides personal info from responses"
                />
                <ModeCard
                  icon="🎉"
                  name="Party Mode"
                  command='"Party mode"'
                  description="Fun responses, focus on music"
                />
                <ModeCard
                  icon="✈️"
                  name="Away Mode"
                  command={`"I'm leaving"`}
                  description="Security monitoring, silent"
                />
                <ModeCard
                  icon="🎯"
                  name="Focus Mode"
                  command='"Focus mode"'
                  description="Minimal interruptions"
                />
              </div>

              <InfoBox>
                Say "Normal mode" or "Back to normal" to exit any special mode.
              </InfoBox>
            </div>
          )}

          {/* Advanced */}
          {activeSection === 'advanced' && (
            <div className="space-y-6">
              <SectionTitle>Advanced Settings</SectionTitle>
              
              <ToggleField
                label="Wall Dashboard Mode"
                description="Enable for always-on display on a dedicated screen"
                checked={prefs.wallDashboardEnabled}
                onChange={(v) => updatePref('wallDashboardEnabled', v)}
              />

              <Divider />

              <SubsectionTitle>Emergency Contact</SubsectionTitle>
              <div className="grid grid-cols-2 gap-6">
                <InputField
                  label="Contact Name"
                  value={prefs.emergencyContact?.name || ''}
                  onChange={(v) => updatePref('emergencyContact', { ...prefs.emergencyContact, name: v, phone: prefs.emergencyContact?.phone || '' })}
                  placeholder="Mom, Partner, etc."
                />
                <InputField
                  label="Phone Number"
                  value={prefs.emergencyContact?.phone || ''}
                  onChange={(v) => updatePref('emergencyContact', { ...prefs.emergencyContact, phone: v, name: prefs.emergencyContact?.name || '' })}
                  placeholder="+1234567890"
                />
              </div>

              <Divider />

              <SubsectionTitle>Debug</SubsectionTitle>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-4 py-2 bg-red-700 text-white rounded hover:bg-red-600"
              >
                Clear All Data & Reset
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper Components

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xl text-white font-medium border-b border-cyan-800 pb-2 mb-4">
    {children}
  </h3>
);

const SubsectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-sm text-cyan-400 uppercase tracking-wider font-medium">
    {children}
  </h4>
);

const Divider = () => (
  <div className="border-t border-cyan-900/50 my-6" />
);

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  className?: string;
}> = ({ label, value, onChange, placeholder, type = 'text', className }) => (
  <div className={className}>
    <label className="block text-sm text-cyan-400 mb-2">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-slate-800 border border-cyan-800 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
    />
  </div>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-sm text-cyan-400 mb-2">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-800 border border-cyan-800 rounded px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

const ToggleField: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
    <div>
      <div className="text-white font-medium">{label}</div>
      {description && <div className="text-sm text-cyan-600">{description}</div>}
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`
        w-12 h-6 rounded-full transition-colors relative
        ${checked ? 'bg-cyan-600' : 'bg-slate-700'}
      `}
    >
      <span
        className={`
          absolute top-1 w-4 h-4 rounded-full bg-white transition-transform
          ${checked ? 'translate-x-7' : 'translate-x-1'}
        `}
      />
    </button>
  </div>
);

const StatusBadge: React.FC<{ connected: boolean }> = ({ connected }) => (
  <span className={`
    px-3 py-1 rounded text-xs font-medium
    ${connected 
      ? 'bg-green-900/50 text-green-400 border border-green-700' 
      : 'bg-slate-800 text-slate-500 border border-slate-700'}
  `}>
    {connected ? '✓ Connected' : 'Not Connected'}
  </span>
);

const InfoBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-cyan-900/20 border border-cyan-800/50 rounded p-3 text-sm text-cyan-300">
    {children}
  </div>
);

const WarningBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-yellow-900/20 border border-yellow-800/50 rounded p-3 text-sm text-yellow-300">
    {children}
  </div>
);

const ModeCard: React.FC<{
  icon: string;
  name: string;
  command: string;
  description: string;
}> = ({ icon, name, command, description }) => (
  <div className="bg-slate-800/50 border border-cyan-900/50 rounded-lg p-4">
    <div className="flex items-center gap-3 mb-2">
      <span className="text-2xl">{icon}</span>
      <span className="text-white font-medium">{name}</span>
    </div>
    <p className="text-cyan-600 text-sm mb-2">{description}</p>
    <code className="text-xs bg-slate-900 px-2 py-1 rounded text-cyan-400">{command}</code>
  </div>
);

export default SettingsPanel;
