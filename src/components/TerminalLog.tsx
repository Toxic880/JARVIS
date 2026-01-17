import React, { useEffect, useRef, useState } from 'react';

interface Props {
  logs: string[];
}

// Sub-component for individual log lines with typewriter effect
const LogLine: React.FC<{ text: string }> = ({ text }) => {
    // Regex parsing for colors
    const parseText = (raw: string) => {
        const parts = raw.split(/(\[.*?\])/g); // Split by brackets
        return parts.map((part, i) => {
            if (part.startsWith('[ERR') || part.includes('FAILURE')) return <span key={i} className="text-red-500 font-bold text-glow-red">{part}</span>;
            if (part.startsWith('[SYS]') || part.startsWith('[NET]')) return <span key={i} className="text-green-400 font-bold">{part}</span>;
            if (part.startsWith('[CMD]')) return <span key={i} className="text-yellow-400">{part}</span>;
            if (part.startsWith('[VIS]')) return <span key={i} className="text-purple-400">{part}</span>;
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <div className="mb-1 border-l-2 border-cyan-800 pl-2 hover:bg-cyan-900/20 transition-colors animate-in fade-in slide-in-from-left-2 duration-300">
             <span className="opacity-50 mr-2 text-[8px]">{new Date().toISOString().split('T')[1].split('.')[0]}</span>
             <span className="typing-effect">{parseText(`> ${text}`)}</span>
        </div>
    );
};

export const TerminalLog: React.FC<Props> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="glass-panel stark-corner p-2 h-32 md:h-48 overflow-hidden flex flex-col relative">
      
      {/* Header */}
      <div className="bg-cyan-900/30 px-2 py-1 mb-1 flex justify-between items-center border-b border-cyan-800/50">
         <span className="font-mono text-[10px] text-cyan-400 uppercase tracking-widest">
            NEURAL_NET_LOG // TRACE_77
         </span>
         <div className="flex gap-1">
             <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></div>
         </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px] md:text-xs text-cyan-200/80 p-1 custom-scrollbar">
        {logs.length === 0 && <div className="text-cyan-900 italic">Waiting for system events...</div>}
        {logs.map((log, i) => (
            <LogLine key={i} text={log} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Decorative Bottom Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-900 to-transparent"></div>
    </div>
  );
};