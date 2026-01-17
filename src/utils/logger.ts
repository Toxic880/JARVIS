/**
 * JARVIS Frontend Logger
 * 
 * Centralized logging that can be:
 * - Disabled in production
 * - Filtered by level
 * - Styled for better visibility
 * 
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('Component', 'Something happened');
 *   logger.warn('Auth', 'Token expiring');
 *   logger.error('API', 'Request failed', error);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  showTimestamp: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_STYLES: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #0891b2',
  warn: 'color: #ca8a04',
  error: 'color: #dc2626; font-weight: bold',
};

class Logger {
  private config: LoggerConfig = {
    enabled: process.env.NODE_ENV !== 'production',
    minLevel: 'debug',
    showTimestamp: false,
  };

  configure(options: Partial<LoggerConfig>) {
    this.config = { ...this.config, ...options };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, source: string, message: string): string {
    const timestamp = this.config.showTimestamp 
      ? `[${new Date().toISOString().split('T')[1].split('.')[0]}] `
      : '';
    return `${timestamp}[${source}] ${message}`;
  }

  debug(source: string, message: string, ...args: any[]) {
    if (!this.shouldLog('debug')) return;
    console.log(`%c${this.formatMessage('debug', source, message)}`, LOG_STYLES.debug, ...args);
  }

  info(source: string, message: string, ...args: any[]) {
    if (!this.shouldLog('info')) return;
    console.log(`%c${this.formatMessage('info', source, message)}`, LOG_STYLES.info, ...args);
  }

  warn(source: string, message: string, ...args: any[]) {
    if (!this.shouldLog('warn')) return;
    console.warn(`%c${this.formatMessage('warn', source, message)}`, LOG_STYLES.warn, ...args);
  }

  error(source: string, message: string, ...args: any[]) {
    if (!this.shouldLog('error')) return;
    console.error(`%c${this.formatMessage('error', source, message)}`, LOG_STYLES.error, ...args);
  }

  // Convenience method for tracing function calls (dev only)
  trace(source: string, fnName: string, ...args: any[]) {
    if (!this.shouldLog('debug')) return;
    console.log(`%c[${source}] → ${fnName}()`, 'color: #666', ...args);
  }

  // Group related logs
  group(label: string) {
    if (!this.config.enabled) return;
    console.group(label);
  }

  groupEnd() {
    if (!this.config.enabled) return;
    console.groupEnd();
  }
}

// Singleton instance
export const logger = new Logger();

// Disable in production automatically
if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
  logger.configure({ minLevel: 'warn' });
}

export default logger;
