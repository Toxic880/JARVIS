import React, { useState, useEffect, useRef, useCallback } from 'react';

interface WallDashboardProps {
  weather?: {
    temp: number;
    condition: string;
    high: number;
    low: number;
  };
  calendar?: {
    title: string;
    time: string;
    isNext?: boolean;
  }[];
  isEnabled: boolean;
  onExit: () => void;
  userName?: string;
}

/**
 * WALL DASHBOARD - Always-On Display Mode
 * 
 * Designed for a dedicated display (tablet, old monitor, etc.)
 * Shows at-a-glance information:
 * - Large clock
 * - Weather
 * - Today's calendar
 * - Active timers
 * - Quick status
 * 
 * Auto-dims after inactivity
 * Tap anywhere to wake JARVIS
 * 
 * Accessibility:
 * - Escape key to show exit dialog
 * - ARIA labels for screen readers
 * - Live regions for time updates
 */
export const WallDashboard: React.FC<WallDashboardProps> = ({
  weather,
  calendar = [],
  isEnabled,
  onExit,
  userName = 'Sir',
}) => {
  const [time, setTime] = useState(new Date());
  const [isDimmed, setIsDimmed] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const dimTimerRef = useRef<NodeJS.Timeout>();
  const exitClicksRef = useRef(0);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-dim after 2 minutes of inactivity
  useEffect(() => {
    const resetDimTimer = () => {
      setIsDimmed(false);
      if (dimTimerRef.current) {
        clearTimeout(dimTimerRef.current);
      }
      dimTimerRef.current = setTimeout(() => {
        setIsDimmed(true);
      }, 120000); // 2 minutes
    };

    resetDimTimer();

    // Reset on any interaction
    const handleInteraction = () => resetDimTimer();
    window.addEventListener('mousemove', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('keydown', handleInteraction);

    return () => {
      if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
      window.removeEventListener('mousemove', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Escape to show exit confirmation
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowExitConfirm(true);
    }
  }, []);

  // Add keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Focus management for modal
  useEffect(() => {
    if (showExitConfirm && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [showExitConfirm]);

  // Triple-click to exit
  const handleScreenClick = () => {
    exitClicksRef.current++;
    
    if (exitClicksRef.current >= 3) {
      setShowExitConfirm(true);
      exitClicksRef.current = 0;
    }

    // Reset clicks after 1 second
    setTimeout(() => {
      exitClicksRef.current = 0;
    }, 1000);
  };

  if (!isEnabled) return null;

  const hours = time.getHours();
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  
  const dateString = time.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const getGreeting = () => {
    if (hours < 12) return 'Good Morning';
    if (hours < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getWeatherIcon = (condition: string) => {
    const c = condition.toLowerCase();
    if (c.includes('sun') || c.includes('clear')) return '☀️';
    if (c.includes('cloud') && c.includes('part')) return '⛅';
    if (c.includes('cloud')) return '☁️';
    if (c.includes('rain')) return '🌧️';
    if (c.includes('storm') || c.includes('thunder')) return '⛈️';
    if (c.includes('snow')) return '❄️';
    if (c.includes('fog') || c.includes('mist')) return '🌫️';
    return '🌤️';
  };

  return (
    <div 
      className={`
        fixed inset-0 z-50 bg-black overflow-hidden cursor-default
        transition-opacity duration-1000
        ${isDimmed ? 'opacity-30' : 'opacity-100'}
      `}
      onClick={handleScreenClick}
      role="main"
      aria-label="JARVIS Wall Dashboard - Press Escape to exit"
    >
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-black to-slate-950" aria-hidden="true" />
      
      {/* Animated background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div 
          className="absolute w-[800px] h-[800px] rounded-full opacity-5"
          style={{
            background: 'radial-gradient(circle, rgba(0,212,255,0.3) 0%, transparent 70%)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            animation: 'breathe 8s ease-in-out infinite',
          }}
        />
      </div>

      {/* Main Content */}
      <div className="relative h-full flex flex-col items-center justify-center p-8">
        
        {/* Greeting */}
        <div 
          className="text-cyan-500/60 text-2xl font-light tracking-[0.3em] mb-4 uppercase"
          role="status"
          aria-live="polite"
        >
          {getGreeting()}, {userName}
        </div>

        {/* Time - BIG */}
        <div className="flex items-baseline mb-2" role="timer" aria-label={`Current time: ${displayHours}:${minutes}:${seconds} ${ampm}`}>
          <span className="text-[180px] font-thin text-white tracking-tight leading-none" aria-hidden="true">
            {displayHours}:{minutes}
          </span>
          <span className="text-4xl text-cyan-500/80 ml-4 font-light" aria-hidden="true">
            {seconds}
          </span>
          <span className="text-3xl text-cyan-500/40 ml-2 font-light" aria-hidden="true">
            {ampm}
          </span>
        </div>

        {/* Screen reader time announcement (updates every minute) */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {time.getMinutes() !== new Date().getMinutes() ? `Time is ${displayHours}:${minutes} ${ampm}` : ''}
        </div>

        {/* Date */}
        <div className="text-cyan-300/50 text-3xl font-light tracking-wider mb-16" aria-label={`Date: ${dateString}`}>
          {dateString}
        </div>

        {/* Info Cards Row */}
        <div className="flex gap-8 items-start">
          
          {/* Weather Card */}
          {weather && (
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 min-w-[250px] border border-cyan-500/10">
              <div className="flex items-center gap-4 mb-4">
                <span className="text-6xl">{getWeatherIcon(weather.condition)}</span>
                <div>
                  <div className="text-5xl font-light text-white">
                    {Math.round(weather.temp)}°
                  </div>
                  <div className="text-cyan-400/60 text-sm uppercase tracking-wider">
                    {weather.condition}
                  </div>
                </div>
              </div>
              <div className="flex gap-4 text-cyan-400/40 text-sm">
                <span>H: {Math.round(weather.high)}°</span>
                <span>L: {Math.round(weather.low)}°</span>
              </div>
            </div>
          )}

          {/* Calendar Card */}
          {calendar.length > 0 && (
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 min-w-[300px] border border-cyan-500/10">
              <div className="text-cyan-400/60 text-xs uppercase tracking-[0.2em] mb-4">
                Today's Schedule
              </div>
              <div className="space-y-4">
                {calendar.slice(0, 4).map((event, i) => (
                  <div 
                    key={i}
                    className={`flex items-center gap-4 ${event.isNext ? 'text-white' : 'text-cyan-300/40'}`}
                  >
                    <div className={`
                      w-1 h-8 rounded-full
                      ${event.isNext ? 'bg-cyan-400' : 'bg-cyan-700/30'}
                    `} />
                    <div>
                      <div className={`text-lg ${event.isNext ? 'font-medium' : 'font-light'}`}>
                        {event.title}
                      </div>
                      <div className="text-sm text-cyan-500/50">
                        {event.time}
                      </div>
                    </div>
                    {event.isNext && (
                      <span className="ml-auto text-xs text-cyan-400 uppercase tracking-wider">
                        Next
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {calendar.length === 0 && (
                <div className="text-cyan-500/30 text-lg">No events today</div>
              )}
            </div>
          )}

          {/* Quick Status Card */}
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 min-w-[200px] border border-cyan-500/10">
            <div className="text-cyan-400/60 text-xs uppercase tracking-[0.2em] mb-4">
              Status
            </div>
            <div className="space-y-3">
              <StatusItem label="System" value="Online" status="good" />
              <StatusItem label="Home" value="Secure" status="good" />
              <StatusItem label="Network" value="Connected" status="good" />
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
          <div className="text-cyan-700/30 text-xs tracking-[0.3em] uppercase">
            J.A.R.V.I.S. Wall Display • Triple-tap to exit
          </div>
        </div>
      </div>

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-dialog-title"
          aria-describedby="exit-dialog-description"
        >
          <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-8 max-w-md">
            <h3 id="exit-dialog-title" className="text-white text-xl mb-4">Exit Wall Display?</h3>
            <p id="exit-dialog-description" className="text-cyan-400/60 mb-6">
              Return to the main JARVIS interface?
            </p>
            <div className="flex gap-4">
              <button
                ref={cancelButtonRef}
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 px-6 py-3 bg-slate-800 text-cyan-400 rounded-lg hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                aria-label="Cancel and stay on wall display"
              >
                Cancel
              </button>
              <button
                ref={exitButtonRef}
                onClick={onExit}
                className="flex-1 px-6 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                aria-label="Exit wall display and return to main interface"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.05; }
          50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.08; }
        }
      `}</style>
    </div>
  );
};

// Status item component
function StatusItem({ 
  label, 
  value, 
  status 
}: { 
  label: string; 
  value: string; 
  status: 'good' | 'warning' | 'error'; 
}) {
  const colors = {
    good: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-cyan-400/40 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-white/80 text-sm">{value}</span>
        <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
      </div>
    </div>
  );
}

export default WallDashboard;
