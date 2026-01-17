/**
 * ServiceStatus Component
 * 
 * Shows what services are connected/available.
 * Graceful degradation - JARVIS works without everything configured.
 */

import React, { useState, useEffect } from 'react';

interface Service {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  optional: boolean;
  capabilities: string[];
}

interface ServiceStatusProps {
  apiUrl?: string;
  compact?: boolean;
}

export function ServiceStatus({ apiUrl = 'http://localhost:3001', compact = false }: ServiceStatusProps) {
  const [services, setServices] = useState<Service[]>([
    { id: 'server', name: 'JARVIS Server', icon: '🖥️', connected: false, optional: false, capabilities: ['chat', 'voice'] },
    { id: 'llm', name: 'AI Brain', icon: '🧠', connected: false, optional: false, capabilities: ['understanding'] },
    { id: 'tts', name: 'Voice Output', icon: '🔊', connected: false, optional: true, capabilities: ['speak'] },
    { id: 'spotify', name: 'Spotify', icon: '🎵', connected: false, optional: true, capabilities: ['music'] },
    { id: 'google', name: 'Google', icon: '📅', connected: false, optional: true, capabilities: ['calendar', 'email'] },
    { id: 'homeassistant', name: 'Smart Home', icon: '🏠', connected: false, optional: true, capabilities: ['lights', 'thermostat'] },
  ]);
  
  const [checking, setChecking] = useState(true);
  
  useEffect(() => {
    checkServices();
    
    // Re-check periodically
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [apiUrl]);
  
  const checkServices = async () => {
    setChecking(true);
    
    const updated = [...services];
    
    // Check server health
    try {
      const response = await fetch(`${apiUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const health = await response.json();
        
        // Update based on health response
        for (const s of updated) {
          if (s.id === 'server') s.connected = true;
          if (s.id === 'llm') s.connected = health.llm?.available ?? false;
          if (s.id === 'tts') s.connected = health.tts?.available ?? false;
          if (s.id === 'homeassistant') s.connected = health.homeAssistant?.connected ?? false;
        }
      }
    } catch {
      // Server not available
      updated.find(s => s.id === 'server')!.connected = false;
    }
    
    // Check OAuth tokens
    updated.find(s => s.id === 'spotify')!.connected = !!localStorage.getItem('spotify_access_token');
    updated.find(s => s.id === 'google')!.connected = !!localStorage.getItem('google_access_token');
    
    setServices(updated);
    setChecking(false);
  };
  
  const connected = services.filter(s => s.connected).length;
  const required = services.filter(s => !s.optional);
  const requiredConnected = required.filter(s => s.connected).length;
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Services:</span>
        <div className="flex gap-1">
          {services.map(s => (
            <span 
              key={s.id} 
              title={`${s.name}: ${s.connected ? 'Connected' : 'Not connected'}`}
              className={s.connected ? 'opacity-100' : 'opacity-30'}
            >
              {s.icon}
            </span>
          ))}
        </div>
        <span className="text-gray-600">
          {connected}/{services.length}
        </span>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Service Status</h3>
        <button 
          onClick={checkServices}
          disabled={checking}
          className="text-xs text-cyan-500 hover:text-cyan-400 disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      
      {/* Required services warning */}
      {requiredConnected < required.length && (
        <div className="mb-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-400 text-xs">
          ⚠️ {required.length - requiredConnected} required service(s) not connected
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-2">
        {services.map(service => (
          <div
            key={service.id}
            className={`
              flex items-center gap-2 p-2 rounded-lg text-sm
              ${service.connected 
                ? 'bg-gray-800/50 text-gray-300' 
                : 'bg-gray-800/30 text-gray-500'
              }
            `}
          >
            <span className="text-lg">{service.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs">{service.name}</div>
              <div className={`text-xs ${service.connected ? 'text-green-500' : 'text-gray-600'}`}>
                {service.connected ? '● Online' : service.optional ? '○ Optional' : '○ Needed'}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* What works without services */}
      <div className="mt-3 pt-3 border-t border-gray-800">
        <div className="text-xs text-gray-500">
          {requiredConnected === required.length ? (
            <span className="text-green-500">✓ Core features available</span>
          ) : (
            <span>Basic chat requires server + AI brain</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Hook for checking if a capability is available
export function useServiceCapability(capability: string): boolean {
  const [available, setAvailable] = useState(false);
  
  useEffect(() => {
    // Simple checks based on localStorage/health
    const checkCapability = () => {
      switch (capability) {
        case 'music':
          setAvailable(!!localStorage.getItem('spotify_access_token'));
          break;
        case 'calendar':
        case 'email':
          setAvailable(!!localStorage.getItem('google_access_token'));
          break;
        default:
          setAvailable(true); // Assume available
      }
    };
    
    checkCapability();
    
    // Re-check on storage changes
    window.addEventListener('storage', checkCapability);
    return () => window.removeEventListener('storage', checkCapability);
  }, [capability]);
  
  return available;
}
