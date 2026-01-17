/**
 * CALENDAR HOLOGRAM - SCHEDULE DISPLAY
 * 
 * A tactical schedule display showing today's events in a 
 * timeline format. Projects when JARVIS checks the calendar.
 */

import React from 'react';
import { CalendarEvent } from '../../types';

interface CalendarHoloProps {
  events: CalendarEvent[];
  onClose?: () => void;
}

export const CalendarHolo: React.FC<CalendarHoloProps> = ({ events, onClose }) => {
  const now = new Date();
  const currentHour = now.getHours();

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => {
    const timeA = a.time ? new Date(a.time).getTime() : 0;
    const timeB = b.time ? new Date(b.time).getTime() : 0;
    return timeA - timeB;
  });

  const formatTime = (timeStr: string): string => {
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    } catch {
      return timeStr;
    }
  };

  const isUpcoming = (timeStr: string): boolean => {
    try {
      return new Date(timeStr).getTime() > now.getTime();
    } catch {
      return false;
    }
  };

  return (
    <div className="relative bg-black/90 backdrop-blur-md border border-cyan-500/40 p-6 w-[450px] rounded-xl shadow-[0_0_60px_rgba(0,255,255,0.15)]">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400" />

      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-cyan-800/50 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm">
            SCHEDULE MATRIX
          </h2>
        </div>
        <div className="text-cyan-600/60 font-mono text-xs">
          {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[60px] top-0 bottom-0 w-0.5 bg-cyan-900/50" />

        {/* Events */}
        <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
          {sortedEvents.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-cyan-600/50 font-mono text-sm">NO EVENTS SCHEDULED</div>
              <div className="text-cyan-800/50 font-mono text-xs mt-2">CALENDAR CLEAR</div>
            </div>
          ) : (
            sortedEvents.map((event, i) => {
              const upcoming = event.time ? isUpcoming(event.time) : false;
              
              return (
                <div key={event.id || i} className="flex items-start gap-4 group">
                  {/* Time */}
                  <div className="w-14 text-right">
                    <span className={`font-mono text-xs ${upcoming ? 'text-cyan-400' : 'text-cyan-700'}`}>
                      {event.time ? formatTime(event.time) : '--:--'}
                    </span>
                  </div>
                  
                  {/* Dot on timeline */}
                  <div className={`relative z-10 w-3 h-3 rounded-full border-2 ${
                    upcoming 
                      ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_10px_#22d3ee]' 
                      : 'bg-cyan-900 border-cyan-700'
                  }`} />
                  
                  {/* Event Card */}
                  <div className={`flex-1 p-3 rounded border transition-all ${
                    upcoming 
                      ? 'bg-cyan-900/20 border-cyan-500/40 group-hover:border-cyan-400' 
                      : 'bg-cyan-900/10 border-cyan-800/30'
                  }`}>
                    <div className={`font-rajdhani text-sm ${upcoming ? 'text-white' : 'text-cyan-600'}`}>
                      {event.title}
                    </div>
                    {event.location && (
                      <div className="text-cyan-600/50 font-mono text-[10px] mt-1 flex items-center gap-1">
                        <span>📍</span>
                        {event.location}
                      </div>
                    )}
                    {event.description && (
                      <div className="text-cyan-700/60 font-mono text-[10px] mt-1 line-clamp-2">
                        {event.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Summary Footer */}
      <div className="mt-4 pt-3 border-t border-cyan-800/30 flex justify-between items-center">
        <span className="text-cyan-600/60 font-mono text-[10px]">
          {sortedEvents.length} EVENT{sortedEvents.length !== 1 ? 'S' : ''} TODAY
        </span>
        <span className="text-cyan-600/60 font-mono text-[10px]">
          {sortedEvents.filter(e => e.time && isUpcoming(e.time)).length} UPCOMING
        </span>
      </div>

      {/* Close Button */}
      {onClose && (
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 text-cyan-600 hover:text-white transition-colors"
        >
          <span className="font-mono text-xs">[×]</span>
        </button>
      )}
    </div>
  );
};

export default CalendarHolo;
