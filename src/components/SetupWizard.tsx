import React, { useState, useRef, useEffect } from 'react';
import { SmartDevice, UserProfile } from '../types';
import { BrowserHardware } from '../services/DeviceInterface';

interface SetupWizardProps {
  onComplete: (profile: UserProfile, devices: SmartDevice[]) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  
  // Step 1: Identity
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  // Step 2: LM Studio Configuration
  const [lmStudioUrl, setLmStudioUrl] = useState('http://127.0.0.1:1234');
  const [lmStudioModel, setLmStudioModel] = useState('qwen/qwen3-14b');
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'testing' | 'success' | 'failed'>('untested');

  // Step 3: Home Automation
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');

  // Step 4: Voice Settings
  const [wakeWord, setWakeWord] = useState('jarvis');
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const [voiceSpeed, setVoiceSpeed] = useState<'normal' | 'fast' | 'slow'>('normal');
  const [briefMode, setBriefMode] = useState(false);
  const [tempUnit, setTempUnit] = useState<'celsius' | 'fahrenheit'>('fahrenheit');

  // Step 5: Smart Home Devices (manual entry)
  const [devices, setDevices] = useState<SmartDevice[]>([]);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceType, setNewDeviceType] = useState<SmartDevice['type']>('light');
  const [newDeviceLocation, setNewDeviceLocation] = useState('');

  const handleNext = () => {
    if (step < 5) setStep(prev => (prev + 1) as any);
  };

  const handleBack = () => {
    if (step > 1) setStep(prev => (prev - 1) as any);
  };

  // Test LM Studio Connection
  const testConnection = async () => {
    setConnectionStatus('testing');
    try {
      // Use no-cors mode for initial check, then try actual request
      // First, just see if the server responds at all
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${lmStudioUrl}/v1/models`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        try {
          const data = await response.json();
          // If models are available, try to get the first one as default
          if (data.data && data.data.length > 0 && !lmStudioModel) {
            setLmStudioModel(data.data[0].id);
          }
        } catch {
          // JSON parse failed but connection worked
        }
        setConnectionStatus('success');
      } else {
        // Even a non-200 response means the server is reachable
        // LM Studio returns 200 for OPTIONS anyway
        setConnectionStatus('success');
      }
    } catch (err) {
      // Check if it's a CORS error vs actual connection failure
      // CORS errors still mean the server is running
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        // Could be CORS or actual connection failure
        // Try an alternative approach - just assume it works if we got OPTIONS errors in LM Studio
        // The user can verify by checking LM Studio logs
        setConnectionStatus('failed');
      } else {
        setConnectionStatus('failed');
      }
    }
  };

  // Add device
  const addDevice = () => {
    if (newDeviceName && newDeviceLocation) {
      const device: SmartDevice = {
        id: `${newDeviceType}.${newDeviceName.toLowerCase().replace(/\s/g, '_')}`,
        name: newDeviceName,
        type: newDeviceType,
        status: newDeviceType === 'lock' ? 'locked' : 'off',
        location: newDeviceLocation,
      };
      setDevices([...devices, device]);
      setNewDeviceName('');
      setNewDeviceLocation('');
    }
  };

  // Finish setup
  const finishSetup = async () => {
    const coords = await BrowserHardware.getLocation();

    const profile: UserProfile = {
      name,
      location,
      lat: coords?.lat,
      lng: coords?.lng,
      isConfigured: true,
      permissions: 'USER',
      preferences: {
        tempUnit,
        musicService: 'default',
        newsSource: 'general',
        wakeWord,
        wakeWordEnabled,
        voiceSpeed,
        briefMode,
        homeAssistantUrl: haUrl || undefined,
        homeAssistantToken: haToken || undefined,
        lmStudioUrl,
        lmStudioModel,
        spotifyClientId: undefined, // Can be configured in settings later
        googleClientId: undefined,  // Can be configured in settings later
        googleClientSecret: undefined, // Google requires this unlike Spotify
        linkedAccounts: {
          googleCalendar: false,
          spotify: false,
        },
      },
    };

    onComplete(profile, devices);
  };

  const canProceed = () => {
    switch (step) {
      case 1: return name.trim().length > 0 && location.trim().length > 0;
      case 2: return connectionStatus === 'success';
      case 3: return true; // Optional
      case 4: return true;
      case 5: return true;
      default: return true;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-2xl p-8 relative overflow-hidden flex flex-col min-h-[500px]">
        
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 h-1 bg-cyan-900 w-full">
          <div 
            className="h-full bg-cyan-400 transition-all duration-500 ease-out" 
            style={{ width: `${(step / 5) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-orbitron text-cyan-400 tracking-widest">
            JARVIS SETUP
          </h1>
          <div className="font-mono text-cyan-600 text-xs">STEP {step} / 5</div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col justify-center">
          
          {/* STEP 1: Identity */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-rajdhani text-white border-b border-cyan-900 pb-2">
                IDENTITY PROTOCOL
              </h2>
              <p className="text-cyan-600 text-sm font-mono">
                I need to know who I'm working with.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-cyan-500 text-xs block mb-1 font-mono">YOUR NAME</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-cyan-900/10 border border-cyan-700 text-white p-3 font-orbitron focus:border-cyan-400 focus:outline-none"
                    placeholder="e.g., Tony"
                  />
                </div>
                <div>
                  <label className="text-cyan-500 text-xs block mb-1 font-mono">LOCATION</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-cyan-900/10 border border-cyan-700 text-white p-3 font-orbitron focus:border-cyan-400 focus:outline-none"
                    placeholder="e.g., Malibu"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: LM Studio Configuration */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-rajdhani text-white border-b border-cyan-900 pb-2">
                NEURAL CORE CONNECTION
              </h2>
              <p className="text-cyan-600 text-sm font-mono">
                Configure connection to your local LM Studio instance.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-cyan-500 text-xs block mb-1 font-mono">LM STUDIO URL</label>
                  <input
                    type="text"
                    value={lmStudioUrl}
                    onChange={(e) => {
                      setLmStudioUrl(e.target.value);
                      setConnectionStatus('untested');
                    }}
                    className="w-full bg-cyan-900/10 border border-cyan-700 text-white p-3 font-mono text-sm focus:border-cyan-400 focus:outline-none"
                    placeholder="http://127.0.0.1:1234"
                  />
                </div>

                <div>
                  <label className="text-cyan-500 text-xs block mb-1 font-mono">MODEL NAME</label>
                  <input
                    type="text"
                    value={lmStudioModel}
                    onChange={(e) => setLmStudioModel(e.target.value)}
                    className="w-full bg-cyan-900/10 border border-cyan-700 text-white p-3 font-mono text-sm focus:border-cyan-400 focus:outline-none"
                    placeholder="qwen/qwen3-14b"
                  />
                  <p className="text-[10px] text-cyan-800 mt-1">
                    This should match the model loaded in LM Studio
                  </p>
                </div>

                <button
                  onClick={testConnection}
                  disabled={connectionStatus === 'testing'}
                  className={`w-full py-3 font-orbitron text-sm transition-all ${
                    connectionStatus === 'success'
                      ? 'bg-green-900/40 border border-green-500 text-green-400'
                      : connectionStatus === 'failed'
                      ? 'bg-red-900/40 border border-red-500 text-red-400'
                      : 'bg-cyan-900/40 border border-cyan-600 text-cyan-100 hover:bg-cyan-800/40'
                  }`}
                >
                  {connectionStatus === 'testing' && '⏳ TESTING CONNECTION...'}
                  {connectionStatus === 'success' && '✓ CONNECTION VERIFIED'}
                  {connectionStatus === 'failed' && '✗ CONNECTION FAILED - RETRY'}
                  {connectionStatus === 'untested' && 'TEST CONNECTION'}
                </button>

                {connectionStatus === 'failed' && (
                  <div className="text-red-400 text-xs font-mono p-3 bg-red-900/20 border border-red-900">
                    Unable to reach LM Studio. Make sure:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>LM Studio is running</li>
                      <li>A model is loaded</li>
                      <li>Local server is enabled (Settings → Local Server)</li>
                      <li>The URL is correct</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Home Automation */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-rajdhani text-white border-b border-cyan-900 pb-2">
                HOME AUTOMATION BRIDGE
              </h2>
              <p className="text-cyan-600 text-sm font-mono">
                Optional: Connect to Home Assistant or other webhook-based automation.
              </p>
              
              <div className="bg-cyan-900/10 p-4 border border-cyan-800 rounded">
                <div className="space-y-4">
                  <div>
                    <label className="text-cyan-500 text-xs block mb-1">API ENDPOINT (URL)</label>
                    <input
                      type="text"
                      value={haUrl}
                      onChange={(e) => setHaUrl(e.target.value)}
                      className="w-full bg-black border border-cyan-700 text-white p-2 font-mono text-sm"
                      placeholder="http://192.168.1.10:8123/api/services"
                    />
                  </div>
                  <div>
                    <label className="text-cyan-500 text-xs block mb-1">AUTH TOKEN (OPTIONAL)</label>
                    <input
                      type="password"
                      value={haToken}
                      onChange={(e) => setHaToken(e.target.value)}
                      className="w-full bg-black border border-cyan-700 text-white p-2 font-mono text-sm"
                      placeholder="Bearer eyJhbGciOi..."
                    />
                  </div>
                </div>
                <p className="text-[10px] text-cyan-800 mt-3">
                  Leave blank to skip smart home integration. You can configure this later.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: Voice Settings */}
          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-xl font-rajdhani text-white border-b border-cyan-900 pb-2">
                VOICE INTERFACE
              </h2>
              
              <div className="space-y-4">
                {/* Wake Word */}
                <div>
                  <label className="text-cyan-500 font-mono text-xs block mb-2">WAKE WORD</label>
                  <div className="flex gap-2">
                    {['jarvis', 'friday', 'computer', 'hey jarvis'].map((w) => (
                      <button
                        key={w}
                        onClick={() => setWakeWord(w)}
                        className={`flex-1 py-2 font-orbitron text-xs border transition-all ${
                          wakeWord === w
                            ? 'bg-cyan-500/20 border-cyan-400 text-white'
                            : 'border-cyan-900 text-cyan-700 hover:border-cyan-700'
                        }`}
                      >
                        {w.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Wake Word Toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-cyan-500 text-xs font-mono">REQUIRE WAKE WORD</span>
                  <button
                    onClick={() => setWakeWordEnabled(!wakeWordEnabled)}
                    className={`w-12 h-6 rounded-full transition-all ${
                      wakeWordEnabled ? 'bg-cyan-500' : 'bg-cyan-900'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transform transition-all ${
                      wakeWordEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {/* Voice Speed */}
                <div>
                  <label className="text-cyan-500 font-mono text-xs block mb-2">VOICE SPEED</label>
                  <div className="flex gap-2">
                    {(['slow', 'normal', 'fast'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setVoiceSpeed(s)}
                        className={`flex-1 py-2 font-orbitron text-xs border transition-all ${
                          voiceSpeed === s
                            ? 'bg-cyan-500/20 border-cyan-400 text-white'
                            : 'border-cyan-900 text-cyan-700 hover:border-cyan-700'
                        }`}
                      >
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Brief Mode */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-cyan-500 text-xs font-mono">BRIEF MODE</span>
                    <p className="text-[9px] text-cyan-800">Shorter responses</p>
                  </div>
                  <button
                    onClick={() => setBriefMode(!briefMode)}
                    className={`w-12 h-6 rounded-full transition-all ${
                      briefMode ? 'bg-cyan-500' : 'bg-cyan-900'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transform transition-all ${
                      briefMode ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {/* Temperature Unit */}
                <div>
                  <label className="text-cyan-500 font-mono text-xs block mb-2">TEMPERATURE UNIT</label>
                  <div className="flex gap-2">
                    {(['fahrenheit', 'celsius'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTempUnit(t)}
                        className={`flex-1 py-2 font-orbitron text-xs border transition-all ${
                          tempUnit === t
                            ? 'bg-cyan-500/20 border-cyan-400 text-white'
                            : 'border-cyan-900 text-cyan-700 hover:border-cyan-700'
                        }`}
                      >
                        {t === 'fahrenheit' ? '°F' : '°C'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Devices */}
          {step === 5 && (
            <div className="space-y-6">
              <h2 className="text-xl font-rajdhani text-white border-b border-cyan-900 pb-2">
                HARDWARE REGISTRY
              </h2>
              <p className="text-cyan-600 text-sm font-mono">
                Optional: Register smart home devices for display and voice control.
              </p>

              {/* Add Device Form */}
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="bg-cyan-900/10 border border-cyan-700 text-white p-2 font-mono text-sm"
                  placeholder="Device Name"
                />
                <select
                  value={newDeviceType}
                  onChange={(e) => setNewDeviceType(e.target.value as SmartDevice['type'])}
                  className="bg-cyan-900/10 border border-cyan-700 text-white p-2 font-mono text-sm"
                >
                  <option value="light">Light</option>
                  <option value="switch">Switch</option>
                  <option value="lock">Lock</option>
                  <option value="thermostat">Thermostat</option>
                  <option value="fan">Fan</option>
                  <option value="blind">Blind</option>
                </select>
                <input
                  type="text"
                  value={newDeviceLocation}
                  onChange={(e) => setNewDeviceLocation(e.target.value)}
                  className="bg-cyan-900/10 border border-cyan-700 text-white p-2 font-mono text-sm"
                  placeholder="Room"
                />
              </div>
              <button
                onClick={addDevice}
                className="w-full py-2 bg-cyan-900/30 border border-cyan-800 text-cyan-400 font-mono text-sm hover:bg-cyan-800/30"
              >
                + ADD DEVICE
              </button>

              {/* Device List */}
              <div className="max-h-32 overflow-y-auto space-y-1">
                {devices.map((d, i) => (
                  <div key={i} className="flex justify-between items-center text-xs font-mono py-1 px-2 bg-cyan-900/10">
                    <span className="text-cyan-300">{d.name}</span>
                    <span className="text-cyan-700">{d.type} • {d.location}</span>
                    <button
                      onClick={() => setDevices(devices.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {devices.length === 0 && (
                  <div className="text-cyan-800 text-xs text-center py-4">
                    No devices registered yet
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          {step > 1 ? (
            <button
              onClick={handleBack}
              className="text-cyan-700 font-mono hover:text-cyan-500"
            >
              [ BACK ]
            </button>
          ) : (
            <div />
          )}

          {step < 5 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className={`px-8 py-2 font-orbitron transition-all ${
                canProceed()
                  ? 'bg-cyan-900/40 border border-cyan-600 text-cyan-100 hover:bg-cyan-800/40'
                  : 'bg-cyan-900/20 border border-cyan-900 text-cyan-900 cursor-not-allowed'
              }`}
            >
              NEXT_STEP &gt;&gt;
            </button>
          ) : (
            <button
              onClick={finishSetup}
              className="px-8 py-3 bg-cyan-400 text-black font-bold font-orbitron tracking-widest hover:bg-cyan-300 transition-all"
            >
              INITIALIZE JARVIS
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
