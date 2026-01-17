/**
 * TOAST NOTIFICATION SYSTEM
 * 
 * Professional toast notifications to replace all alert() calls.
 * Supports multiple notification types, auto-dismiss, and stacking.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

// =============================================================================
// CONTEXT
// =============================================================================

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Convenience hooks
export const useToastHelpers = () => {
  const { addToast } = useToast();

  return {
    success: (title: string, message?: string) => 
      addToast({ type: 'success', title, message }),
    error: (title: string, message?: string) => 
      addToast({ type: 'error', title, message, duration: 6000 }),
    warning: (title: string, message?: string) => 
      addToast({ type: 'warning', title, message }),
    info: (title: string, message?: string) => 
      addToast({ type: 'info', title, message }),
  };
};

// =============================================================================
// PROVIDER
// =============================================================================

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = { ...toast, id };
    
    setToasts(prev => [...prev, newToast]);
    
    // Auto-dismiss after duration (default 4 seconds)
    const duration = toast.duration ?? 4000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearAll }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};

// =============================================================================
// TOAST CONTAINER & COMPONENTS
// =============================================================================

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    if (duration <= 0) return;
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 200);
  };

  const typeStyles: Record<ToastType, { bg: string; border: string; icon: string; progressBg: string }> = {
    success: {
      bg: 'bg-green-900/90',
      border: 'border-green-500',
      icon: '✓',
      progressBg: 'bg-green-500',
    },
    error: {
      bg: 'bg-red-900/90',
      border: 'border-red-500',
      icon: '✗',
      progressBg: 'bg-red-500',
    },
    warning: {
      bg: 'bg-yellow-900/90',
      border: 'border-yellow-500',
      icon: '⚠',
      progressBg: 'bg-yellow-500',
    },
    info: {
      bg: 'bg-cyan-900/90',
      border: 'border-cyan-500',
      icon: 'ℹ',
      progressBg: 'bg-cyan-500',
    },
  };

  const style = typeStyles[toast.type];

  return (
    <div
      className={`
        ${style.bg} ${style.border}
        border rounded-lg shadow-xl backdrop-blur-sm
        transform transition-all duration-200 pointer-events-auto
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="text-lg flex-shrink-0 mt-0.5">{style.icon}</span>
        
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm">{toast.title}</p>
          {toast.message && (
            <p className="text-gray-300 text-xs mt-1">{toast.message}</p>
          )}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-white flex-shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Progress bar */}
      {duration > 0 && (
        <div className="h-0.5 bg-gray-700/50 rounded-b-lg overflow-hidden">
          <div
            className={`h-full ${style.progressBg} transition-all ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default ToastProvider;
