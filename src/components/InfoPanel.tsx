import React from 'react';

interface InfoPanelProps {
  weather: {
    temp: number;
    condition: string;
    humidity: number;
    windSpeed: number;
    location: string;
  };
  time: string;
  date: string;
  battery: number;
  online: boolean;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ 
  weather, 
  time, 
  date, 
  battery, 
  online 
}) => {
  const getWeatherIcon = (condition: string): string => {
    const c = condition.toLowerCase();
    if (c.includes('clear') || c.includes('sunny')) return '☀️';
    if (c.includes('cloud')) return '☁️';
    if (c.includes('rain')) return '🌧️';
    if (c.includes('snow')) return '❄️';
    if (c.includes('thunder') || c.includes('storm')) return '⛈️';
    if (c.includes('fog') || c.includes('mist')) return '🌫️';
    return '🌡️';
  };

  const getBatteryIcon = (level: number): string => {
    if (level > 80) return '🔋';
    if (level > 50) return '🔋';
    if (level > 20) return '🪫';
    return '⚠️';
  };

  return (
    <div className="glass-panel stark-corner p-4">
      <h3 className="text-cyan-400 font-orbitron text-xs tracking-widest mb-3 border-b border-cyan-800 pb-1 flex justify-between">
        <span>ENVIRONMENT</span>
        <span className="text-[9px] opacity-50">{weather.location}</span>
      </h3>

      {/* Time & Date */}
      <div className="mb-4 text-center">
        <div className="text-3xl font-orbitron text-white text-glow tabular-nums">
          {time}
        </div>
        <div className="text-xs font-mono text-cyan-500 mt-1">
          {date}
        </div>
      </div>

      {/* Weather */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-cyan-900/50">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{getWeatherIcon(weather.condition)}</span>
          <div>
            <div className="text-2xl font-orbitron text-white">
              {weather.temp}°
            </div>
            <div className="text-[10px] font-mono text-cyan-600 uppercase">
              {weather.condition}
            </div>
          </div>
        </div>
        
        {weather.humidity > 0 && (
          <div className="text-right text-[10px] font-mono text-cyan-700">
            <div>💧 {weather.humidity}%</div>
            <div>💨 {weather.windSpeed} mph</div>
          </div>
        )}
      </div>

      {/* System Status */}
      <div className="grid grid-cols-2 gap-2">
        {/* Battery */}
        <div className="flex items-center gap-2">
          <span>{getBatteryIcon(battery)}</span>
          <div>
            <div className={`text-sm font-mono ${
              battery < 20 ? 'text-red-400' : 
              battery < 50 ? 'text-yellow-400' : 
              'text-green-400'
            }`}>
              {battery}%
            </div>
            <div className="text-[8px] text-cyan-800">POWER</div>
          </div>
        </div>

        {/* Network */}
        <div className="flex items-center gap-2">
          <span>{online ? '📶' : '📵'}</span>
          <div>
            <div className={`text-sm font-mono ${online ? 'text-green-400' : 'text-red-400'}`}>
              {online ? 'ONLINE' : 'OFFLINE'}
            </div>
            <div className="text-[8px] text-cyan-800">NETWORK</div>
          </div>
        </div>
      </div>
    </div>
  );
};
