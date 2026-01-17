/**
 * Tool Confirmation Dialog
 * 
 * Displays confirmation prompt for dangerous tool actions.
 * Required before executing tools like:
 * - controlDevice (smart home)
 * - sendEmail
 * - sendSMS
 * - createEvent / deleteEvent
 * - forget (memory)
 * - clearList
 */

import React, { useEffect, useState, useRef } from 'react';

export interface PendingConfirmation {
  confirmationId: string;
  toolName: string;
  parameters: Record<string, any>;
  expiresAt: number;
}

interface ToolConfirmationDialogProps {
  pending: PendingConfirmation | null;
  onConfirm: (confirmationId: string) => void;
  onCancel: (confirmationId: string) => void;
}

const ToolConfirmationDialog: React.FC<ToolConfirmationDialogProps> = ({
  pending,
  onConfirm,
  onCancel,
}) => {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Update countdown
  useEffect(() => {
    if (!pending) return;

    const updateTime = () => {
      const remaining = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
      setTimeRemaining(remaining);
      
      if (remaining === 0) {
        onCancel(pending.confirmationId);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [pending, onCancel]);

  // Focus confirm button on open
  useEffect(() => {
    if (pending && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [pending]);

  // Handle keyboard
  useEffect(() => {
    if (!pending) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel(pending.confirmationId);
      } else if (e.key === 'Enter') {
        onConfirm(pending.confirmationId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pending, onConfirm, onCancel]);

  if (!pending) return null;

  // Format tool name for display
  const formatToolName = (name: string) => {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  };

  // Get appropriate icon and color for tool type
  const getToolStyle = (toolName: string) => {
    const styles: Record<string, { icon: string; color: string; bgColor: string }> = {
      controlDevice: { icon: '🏠', color: 'text-yellow-400', bgColor: 'bg-yellow-900/20' },
      sendEmail: { icon: '📧', color: 'text-blue-400', bgColor: 'bg-blue-900/20' },
      sendSMS: { icon: '📱', color: 'text-green-400', bgColor: 'bg-green-900/20' },
      createEvent: { icon: '📅', color: 'text-purple-400', bgColor: 'bg-purple-900/20' },
      deleteEvent: { icon: '🗑️', color: 'text-red-400', bgColor: 'bg-red-900/20' },
      forget: { icon: '🧠', color: 'text-red-400', bgColor: 'bg-red-900/20' },
      clearList: { icon: '📋', color: 'text-orange-400', bgColor: 'bg-orange-900/20' },
    };
    return styles[toolName] || { icon: '⚠️', color: 'text-yellow-400', bgColor: 'bg-yellow-900/20' };
  };

  // Format parameters for display
  const formatParameters = (params: Record<string, any>) => {
    return Object.entries(params)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ({
        key: key.replace(/([A-Z])/g, ' $1').toLowerCase(),
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      }));
  };

  const style = getToolStyle(pending.toolName);
  const formattedParams = formatParameters(pending.parameters);

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-description"
    >
      <div className={`max-w-md w-full rounded-lg border ${style.bgColor} border-current/30 p-6`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{style.icon}</span>
          <div>
            <h2 id="confirm-title" className={`text-lg font-bold ${style.color}`}>
              Confirm Action
            </h2>
            <p className="text-gray-400 text-sm">
              {formatToolName(pending.toolName)}
            </p>
          </div>
        </div>

        {/* Description */}
        <p id="confirm-description" className="text-gray-300 mb-4">
          JARVIS wants to perform this action. Do you want to proceed?
        </p>

        {/* Parameters */}
        {formattedParams.length > 0 && (
          <div className="bg-black/30 rounded p-3 mb-4 space-y-2">
            {formattedParams.map(({ key, value }) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-gray-500 capitalize">{key}:</span>
                <span className="text-gray-300 text-right max-w-[200px] truncate" title={value}>
                  {value.length > 50 ? value.substring(0, 50) + '...' : value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Timer */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full ${timeRemaining < 30 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
          <span className={`text-sm font-mono ${timeRemaining < 30 ? 'text-red-400' : 'text-gray-400'}`}>
            Expires in {timeRemaining}s
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => onCancel(pending.confirmationId)}
            className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={() => onConfirm(pending.confirmationId)}
            className={`flex-1 px-4 py-3 ${style.color.replace('text-', 'bg-').replace('-400', '-600')} hover:opacity-90 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-current`}
          >
            Confirm
          </button>
        </div>

        {/* Keyboard hints */}
        <p className="text-center text-gray-600 text-xs mt-3">
          Press <kbd className="px-1 bg-gray-800 rounded">Enter</kbd> to confirm or <kbd className="px-1 bg-gray-800 rounded">Esc</kbd> to cancel
        </p>
      </div>
    </div>
  );
};

export default ToolConfirmationDialog;
