/**
 * WEATHER HOLOGRAM - ATMOSPHERIC SENSORS DISPLAY
 * 
 * A tactical weather display with wind vectors, temperature gradients,
 * and that "Iron Man HUD" aesthetic. Projects automatically when
 * JARVIS fetches weather data.
 */

import React from 'react';

interface WeatherData {
  temp?: number;
  condition?: string;
  humidity?: number;
  wind?: number;
  windSpeed?: number;
  location?: string;
  feelsLike?: number;
  visibility?: number;
  uvIndex?: number;
  pressure?: number;
}

interface WeatherHoloProps {
  data: WeatherData | null;
  onClose?: () => void;
}

// Weather condition to icon mapping
const getWeatherIcon = (condition: string = ''): string => {
  const c = condition.toLowerCase();
  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('rain') || c.includes('drizzle')) return '🌧️';
  if (c.includes('snow') || c.includes('sleet')) return '🌨️';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return '🌫️';
  if (c.includes('cloud') || c.includes('overcast')) return '☁️';
  if (c.includes('partly')) return '⛅';
  if (c.includes('clear') || c.includes('sunny')) return '☀️';
  if (c.includes('wind')) return '💨';
  return '🌡️';
};

// Get threat level color based on conditions
const getThreatLevel = (data: WeatherData): { level: string; color: string } => {
  const temp = data.temp || 0;
  const wind = data.wind || data.windSpeed || 0;
  const condition = (data.condition || '').toLowerCase();
  
  if (condition.includes('thunder') || condition.includes('storm') || wind > 40) {
    return { level: 'ELEVATED', color: 'text-red-400' };
  }
  if (condition.includes('rain') || condition.includes('snow') || wind > 25) {
    return { level: 'MODERATE', color: 'text-yellow-400' };
  }
  if (temp > 95 || temp < 20) {
    return { level: 'ADVISORY', color: 'text-orange-400' };
  }
  return { level: 'NOMINAL', color: 'text-green-400' };
};

export const WeatherHolo: React.FC<WeatherHoloProps> = ({ data, onClose }) => {
  if (!data) return null;

  const threat = getThreatLevel(data);
  const windValue = data.wind || data.windSpeed || 0;

  return (
    <div className="relative bg-black/90 backdrop-blur-md border border-cyan-500/40 p-8 rounded-xl max-w-2xl w-full shadow-[0_0_60px_rgba(0,255,255,0.15)]">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400" />

      {/* Header */}
      <div className="flex justify-between items-start border-b border-cyan-800/50 pb-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm">
              ATMOSPHERIC SENSORS
            </h2>
          </div>
          <div className="text-cyan-600/60 font-mono text-xs mt-2 ml-5">
            LOC: {data.location?.toUpperCase() || 'CURRENT POSITION'}
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-5xl text-white font-thin font-rajdhani">
            {data.temp || '--'}°
          </div>
          {data.feelsLike && (
            <div className="text-cyan-600/60 font-mono text-xs">
              FEELS: {data.feelsLike}°
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left: Main Condition Display */}
        <div className="flex flex-col items-center justify-center p-6 border border-cyan-500/20 bg-cyan-900/10 rounded-lg relative overflow-hidden">
          {/* Scanning effect */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent animate-scan opacity-50" />
          
          <div className="text-7xl mb-3 relative z-10">
            {getWeatherIcon(data.condition)}
          </div>
          <div className="text-cyan-300 font-orbitron tracking-wider text-lg relative z-10">
            {data.condition?.toUpperCase() || 'UNKNOWN'}
          </div>
          
          {/* Threat Level */}
          <div className={`mt-4 px-3 py-1 border ${threat.color.replace('text-', 'border-')} bg-black/50 rounded`}>
            <span className={`font-mono text-xs ${threat.color}`}>
              THREAT: {threat.level}
            </span>
          </div>
        </div>

        {/* Right: Tactical Data Grid */}
        <div className="grid grid-cols-2 gap-3">
          <DataCell label="HUMIDITY" value={`${data.humidity || '--'}%`} />
          <DataCell label="WIND" value={`${windValue} MPH`} />
          <DataCell label="VISIBILITY" value={data.visibility ? `${data.visibility}%` : '100%'} />
          <DataCell label="UV INDEX" value={data.uvIndex?.toString() || '--'} />
          <DataCell label="PRESSURE" value={data.pressure ? `${data.pressure} hPa` : '--'} />
          <DataCell label="DEW POINT" value="--" />
        </div>
      </div>

      {/* Wind Vector Visualization */}
      <div className="mt-6 p-4 border border-cyan-500/20 bg-cyan-900/5 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-cyan-600 font-mono text-xs">WIND VECTOR ANALYSIS</span>
          <span className="text-cyan-400 font-mono text-xs">{windValue} MPH</span>
        </div>
        <div className="flex gap-1">
          {[...Array(20)].map((_, i) => {
            const active = i < (windValue / 5);
            return (
              <div 
                key={i} 
                className={`flex-1 h-2 rounded-sm transition-all duration-300 ${
                  active 
                    ? windValue > 30 ? 'bg-red-500' : windValue > 15 ? 'bg-yellow-500' : 'bg-cyan-400'
                    : 'bg-cyan-900/30'
                }`}
                style={{ 
                  animationDelay: `${i * 0.05}s`,
                  opacity: active ? 1 : 0.3,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Close Button */}
      {onClose && (
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-600 hover:text-white transition-colors"
        >
          <span className="font-mono text-xs">[CLOSE]</span>
        </button>
      )}

      {/* Decorative Footer Scan Line */}
      <div className="mt-6 flex gap-1">
        {[...Array(30)].map((_, i) => (
          <div 
            key={i} 
            className="h-0.5 bg-cyan-500/40 flex-1 animate-pulse" 
            style={{ animationDelay: `${i * 0.05}s` }} 
          />
        ))}
      </div>
    </div>
  );
};

// Sub-component for data cells
const DataCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-cyan-900/20 p-3 border-l-2 border-cyan-500/50 hover:border-cyan-400 transition-colors">
    <div className="text-cyan-600/80 font-mono text-[10px] tracking-wider">{label}</div>
    <div className="text-white text-lg font-rajdhani mt-1">{value}</div>
  </div>
);

export default WeatherHolo;
