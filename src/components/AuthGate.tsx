/**
 * Authentication & Onboarding Component
 * 
 * Handles:
 * - Initial setup (create admin account)
 * - Login
 * - Server URL configuration
 * - Security warnings
 */

import React, { useState, useEffect } from 'react';
import { apiClient } from '../services/APIClient';

interface AuthGateProps {
  children: React.ReactNode;
  onAuthenticated: () => void;
}

type AuthState = 'loading' | 'setup' | 'login' | 'authenticated' | 'offline';

export const AuthGate: React.FC<AuthGateProps> = ({ children, onAuthenticated }) => {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [serverUrl, setServerUrl] = useState(apiClient.getServerUrl());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      // First check if we already have a valid token
      if (apiClient.isAuthenticated()) {
        const user = await apiClient.getCurrentUser();
        if (user) {
          setAuthState('authenticated');
          onAuthenticated();
          return;
        }
      }

      // Check server status
      const status = await apiClient.checkAuthStatus();
      
      if (status.setupRequired) {
        setAuthState('setup');
      } else {
        setAuthState('login');
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      setAuthState('offline');
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await apiClient.setup(username, password);
      setAuthState('authenticated');
      onAuthenticated();
    } catch (error: any) {
      setError(error.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiClient.login(username, password);
      setAuthState('authenticated');
      onAuthenticated();
    } catch (error: any) {
      setError(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleServerUrlChange = () => {
    apiClient.setServerUrl(serverUrl);
    checkAuthStatus();
  };

  // Loading state
  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
          <p className="text-cyan-500 font-mono">INITIALIZING JARVIS...</p>
        </div>
      </div>
    );
  }

  // Authenticated - render children
  if (authState === 'authenticated') {
    return <>{children}</>;
  }

  // Offline state
  if (authState === 'offline') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-900 border border-red-500/50 rounded-lg p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-3xl">⚠️</span>
            </div>
            <h1 className="text-xl font-bold text-red-400">Server Unavailable</h1>
            <p className="text-gray-400 mt-2">Cannot connect to JARVIS server</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Server URL</label>
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm"
                placeholder="http://localhost:3001"
              />
            </div>
            <button
              onClick={handleServerUrlChange}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-2 rounded font-medium transition-colors"
            >
              Retry Connection
            </button>
          </div>

          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-600/30 rounded">
            <p className="text-yellow-500 text-sm">
              <strong>Troubleshooting:</strong>
            </p>
            <ul className="text-yellow-400/80 text-xs mt-2 space-y-1 list-disc list-inside">
              <li>Ensure the JARVIS server is running</li>
              <li>Check the server URL is correct</li>
              <li>Verify network connectivity</li>
              <li>Check server logs for errors</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Setup / Login UI
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center border border-cyan-500/50">
            <span className="text-4xl">🤖</span>
          </div>
          <h1 className="text-2xl font-bold text-cyan-400 font-mono">J.A.R.V.I.S.</h1>
          <p className="text-gray-500 text-sm mt-1">Just A Rather Very Intelligent System</p>
        </div>

        {/* Security Warning Banner */}
        <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <p className="text-red-400 font-medium">Security Notice</p>
              <p className="text-red-300/70 text-sm mt-1">
                JARVIS controls your home devices. Use a strong password and never expose this system to the public internet without proper security measures.
              </p>
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-gray-900 border border-cyan-500/30 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            {authState === 'setup' ? '🛠️ Initial Setup' : '🔐 Login'}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={authState === 'setup' ? handleSetup : handleLogin}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black border border-gray-700 focus:border-cyan-500 rounded px-3 py-2 text-white outline-none transition-colors"
                  placeholder={authState === 'setup' ? 'Choose a username' : 'Enter username'}
                  required
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black border border-gray-700 focus:border-cyan-500 rounded px-3 py-2 text-white outline-none transition-colors"
                  placeholder={authState === 'setup' ? 'Choose a strong password' : 'Enter password'}
                  required
                  autoComplete={authState === 'setup' ? 'new-password' : 'current-password'}
                  minLength={8}
                />
              </div>

              {authState === 'setup' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-black border border-gray-700 focus:border-cyan-500 rounded px-3 py-2 text-white outline-none transition-colors"
                    placeholder="Confirm password"
                    required
                    autoComplete="new-password"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2.5 rounded font-medium transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    {authState === 'setup' ? 'Creating Account...' : 'Logging in...'}
                  </span>
                ) : (
                  authState === 'setup' ? 'Create Admin Account' : 'Login'
                )}
              </button>
            </div>
          </form>

          {/* Advanced Settings */}
          <div className="mt-6 pt-4 border-t border-gray-800">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-500 hover:text-gray-400 flex items-center gap-1"
            >
              <span>{showAdvanced ? '▼' : '▶'}</span>
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Server URL</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm"
                      placeholder="http://localhost:3001"
                    />
                    <button
                      onClick={handleServerUrlChange}
                      className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Setup Help */}
        {authState === 'setup' && (
          <div className="mt-6 p-4 bg-cyan-900/20 border border-cyan-500/30 rounded-lg">
            <p className="text-cyan-400 font-medium text-sm">First Time Setup</p>
            <p className="text-cyan-300/70 text-xs mt-2">
              You're creating the administrator account for JARVIS. This account has full control over the system. Choose a strong, unique password.
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs mt-6">
          JARVIS v1.0.0 • Secure Backend Mode
        </p>
      </div>
    </div>
  );
};

/**
 * Development Warning Banner
 */
export const DevWarningBanner: React.FC = () => {
  const isDev = import.meta.env?.DEV || process.env.NODE_ENV === 'development';
  const [dismissed, setDismissed] = useState(false);

  if (!isDev || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span>⚠️</span>
        <span>
          <strong>DEVELOPMENT MODE</strong> — Do not expose this instance to the public internet. 
          Use proper authentication and HTTPS in production.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="px-2 py-1 bg-red-700 hover:bg-red-800 rounded text-xs"
      >
        Dismiss
      </button>
    </div>
  );
};

/**
 * Logout Button Component
 */
export const LogoutButton: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const handleLogout = async () => {
    await apiClient.logout();
    onLogout();
  };

  return (
    <button
      onClick={handleLogout}
      className="text-xs text-gray-500 hover:text-red-400 transition-colors"
    >
      [LOGOUT]
    </button>
  );
};
