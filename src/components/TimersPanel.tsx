import React from 'react';
import { SystemTimer, Alarm } from '../types';

interface TimersPanelProps {
  timers: SystemTimer[];
  alarms: Alarm[];
}

export const TimersPanel: React.FC<TimersPanelProps> = ({ timers, alarms }) => {
  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const getProgress = (timer: SystemTimer): number => {
    return ((timer.duration - timer.remaining) / timer.duration) * 100;
  };

  const activeTimers = timers.filter(t => t.status !== 'COMPLETED');
  const enabledAlarms = alarms.filter(a => a.enabled);

  return (
    <div className="glass-panel stark-corner p-4">
      <h3 className="text-cyan-400 font-orbitron text-xs tracking-widest mb-3 border-b border-cyan-800 pb-1 flex justify-between">
        <span>TIMERS & ALARMS</span>
        <span className="text-[9px] opacity-50">
          {activeTimers.length + enabledAlarms.length} ACTIVE
        </span>
      </h3>

      <div className="space-y-3 max-h-40 overflow-y-auto custom-scrollbar">
        {/* Active Timers */}
        {activeTimers.map(timer => (
          <div key={timer.id} className="relative">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-mono text-cyan-300 truncate max-w-[120px]">
                {timer.label}
              </span>
              <span className={`text-sm font-orbitron tabular-nums ${
                timer.remaining <= 10 ? 'text-red-400 animate-pulse' :
                timer.remaining <= 60 ? 'text-yellow-400' :
                'text-white'
              }`}>
                {formatTime(timer.remaining)}
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="h-1 bg-cyan-900/30 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${
                  timer.status === 'PAUSED' ? 'bg-yellow-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${getProgress(timer)}%` }}
              />
            </div>
            
            {timer.status === 'PAUSED' && (
              <span className="absolute right-0 top-0 text-[8px] text-yellow-500 font-mono">
                PAUSED
              </span>
            )}
          </div>
        ))}

        {/* Alarms */}
        {enabledAlarms.map(alarm => (
          <div key={alarm.id} className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-yellow-500">⏰</span>
              <span className="text-xs font-mono text-cyan-300 truncate max-w-[100px]">
                {alarm.label}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-orbitron text-white">
                {alarm.time}
              </span>
              {alarm.days && alarm.days.length > 0 && (
                <div className="text-[8px] text-cyan-700 font-mono">
                  {alarm.days.map(d => d.slice(0, 2).toUpperCase()).join(' ')}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {activeTimers.length === 0 && enabledAlarms.length === 0 && (
          <div className="text-center py-4">
            <div className="text-cyan-800/50 text-xs font-mono">
              No active timers or alarms
            </div>
            <div className="text-[9px] text-cyan-900 mt-1">
              Say "Set a timer for 5 minutes"
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
