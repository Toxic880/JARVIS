/**
 * JARVIS APP - THE STAGE MANAGER
 * 
 * This is the new clean root component. It replaces the old "God Component"
 * with a simple router that delegates to the right view based on setup state.
 * 
 * Architecture:
 * - JarvisProvider: Manages all state (replaces 20+ useState hooks)
 * - StageManager: Routes to the right view
 * - AutoSetup: The "Iron Man" boot sequence for first-time users
 * - AmbientInterface: The main "holographic" interface
 */

import React from 'react';
import { JarvisProvider, useJarvis } from './store/JarvisContext';
import { AutoSetup } from './components/AutoSetup';
import { AmbientInterface } from './components/AmbientInterface';
import { ToastProvider } from './components/ui/Toast';

// =============================================================================
// STAGE MANAGER - Routes to the correct view based on state
// =============================================================================

const StageManager: React.FC = () => {
  const { ui } = useJarvis();

  // If not setup complete, show the "Boot Sequence"
  if (!ui.isSetupComplete) {
    return <AutoSetup />;
  }

  // Otherwise, show the main ambient interface
  return <AmbientInterface />;
};

// =============================================================================
// APP ROOT
// =============================================================================

export default function App() {
  return (
    <ToastProvider>
      <JarvisProvider>
        <div className="antialiased text-slate-500 dark:text-slate-400 bg-black min-h-screen">
          <StageManager />
        </div>
      </JarvisProvider>
    </ToastProvider>
  );
}
