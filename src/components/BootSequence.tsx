import React, { useEffect, useState } from 'react';

interface Props {
  onComplete: () => void;
}

export const BootSequence: React.FC<Props> = ({ onComplete }) => {
  const [lines, setLines] = useState<string[]>([]);
  
  const BOOT_LOGS = [
    "INITIALIZING KERNEL...",
    "LOADING NEURAL CORE MODULES... [OK]",
    "CONNECTING TO LOCAL LLM... [OK]",
    "INITIALIZING SPEECH SYNTHESIS... [OK]",
    "CALIBRATING VOICE RECOGNITION... [OK]",
    "LOADING TOOL REGISTRY... [OK]",
    "RESTORING PERSISTENT MEMORY... [OK]",
    "ALL SYSTEMS NOMINAL.",
    "J.A.R.V.I.S. ONLINE."
  ];

  useEffect(() => {
    let delay = 0;
    BOOT_LOGS.forEach((log, index) => {
      delay += Math.random() * 400 + 100;
      setTimeout(() => {
        setLines(prev => [...prev, log]);
        if (index === BOOT_LOGS.length - 1) {
          setTimeout(onComplete, 800);
        }
      }, delay);
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-8 text-cyan-500 font-mono uppercase tracking-widest text-sm">
      <div className="w-full max-w-lg">
        {lines.map((l, i) => (
          <div key={i} className="mb-1 border-l-2 border-cyan-800 pl-2 animate-pulse">
            {`> ${l}`}
          </div>
        ))}
        <div className="mt-2 w-3 h-5 bg-cyan-400 animate-bounce inline-block"></div>
      </div>
    </div>
  );
};