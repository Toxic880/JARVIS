/**
 * LISTS HOLOGRAM - INVENTORY DISPLAY
 * 
 * A tactical display for shopping lists, todo lists, and other
 * item collections. Projects when JARVIS reads a list.
 */

import React from 'react';
import { ListItem } from '../../types';

interface ListsHoloProps {
  listName: string;
  items: ListItem[];
  onClose?: () => void;
}

export const ListsHolo: React.FC<ListsHoloProps> = ({ listName, items, onClose }) => {
  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="relative bg-black/90 backdrop-blur-md border border-cyan-500/40 p-6 w-[400px] rounded-xl shadow-[0_0_60px_rgba(0,255,255,0.15)]">
      {/* Corner Brackets */}
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400" />

      {/* Header */}
      <div className="flex justify-between items-center mb-4 border-b border-cyan-800/50 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          <h2 className="text-cyan-400 font-orbitron tracking-[0.2em] text-sm">
            INVENTORY: {listName.toUpperCase()}
          </h2>
        </div>
        <div className="text-cyan-600/60 font-mono text-xs">
          {completedCount}/{totalCount}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="h-1 bg-cyan-900/30 rounded overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-right text-cyan-600/50 font-mono text-[10px] mt-1">
          {Math.round(progress)}% COMPLETE
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
        {items.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-cyan-600/50 font-mono text-sm">LIST EMPTY</div>
            <div className="text-cyan-800/50 font-mono text-xs mt-1">NO ITEMS REGISTERED</div>
          </div>
        ) : (
          items.map((item, i) => (
            <div 
              key={item.id || i}
              className={`flex items-center gap-3 p-3 rounded border transition-all ${
                item.completed 
                  ? 'bg-green-900/10 border-green-800/30' 
                  : 'bg-cyan-900/10 border-cyan-500/20 hover:border-cyan-500/40'
              }`}
            >
              {/* Checkbox indicator */}
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                item.completed 
                  ? 'bg-green-500 border-green-500' 
                  : 'border-cyan-500/50'
              }`}>
                {item.completed && (
                  <span className="text-black text-xs">✓</span>
                )}
              </div>
              
              {/* Item content */}
              <span className={`flex-1 font-rajdhani ${
                item.completed 
                  ? 'text-green-600/60 line-through' 
                  : 'text-white'
              }`}>
                {item.content}
              </span>
              
              {/* Index number */}
              <span className="text-cyan-800/50 font-mono text-[10px]">
                #{String(i + 1).padStart(2, '0')}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Footer Stats */}
      <div className="mt-4 pt-3 border-t border-cyan-800/30 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-cyan-400 font-mono text-lg">{totalCount}</div>
          <div className="text-cyan-700/60 font-mono text-[9px]">TOTAL</div>
        </div>
        <div>
          <div className="text-green-400 font-mono text-lg">{completedCount}</div>
          <div className="text-cyan-700/60 font-mono text-[9px]">DONE</div>
        </div>
        <div>
          <div className="text-yellow-400 font-mono text-lg">{totalCount - completedCount}</div>
          <div className="text-cyan-700/60 font-mono text-[9px]">PENDING</div>
        </div>
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

export default ListsHolo;
