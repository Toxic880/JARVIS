import React, { useState, useRef, useEffect } from 'react';

interface TextInputProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const TextInput: React.FC<TextInputProps> = ({ 
  onSubmit, 
  placeholder = 'Type a command...', 
  disabled = false 
}) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setValue('');
      inputRef.current?.blur();
    }
  };

  // Focus on / key press
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full px-4 py-3 
            bg-cyan-950/30 
            border border-cyan-800/50 
            rounded-none
            font-mono text-sm text-cyan-100
            placeholder:text-cyan-800
            focus:outline-none focus:border-cyan-500 focus:bg-cyan-950/50
            transition-all duration-300
            disabled:opacity-50 disabled:cursor-not-allowed
            stark-corner
          `}
        />
        
        {/* Submit button */}
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className={`
            absolute right-2 top-1/2 -translate-y-1/2
            px-3 py-1
            font-mono text-xs
            transition-all duration-200
            ${value.trim() && !disabled
              ? 'text-cyan-400 hover:text-cyan-300'
              : 'text-cyan-900 cursor-not-allowed'
            }
          `}
        >
          SEND
        </button>

        {/* Keyboard shortcut hint */}
        <div className="absolute left-4 -bottom-5 text-[9px] font-mono text-cyan-900">
          Press <span className="text-cyan-700">/</span> to focus • <span className="text-cyan-700">ESC</span> to clear
        </div>
      </div>
    </form>
  );
};
