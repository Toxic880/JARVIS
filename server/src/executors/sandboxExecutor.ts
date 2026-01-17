/**
 * Sandbox Executor
 * 
 * Executes tools in isolated environments:
 * - Docker containers for shell/script execution
 * - Process isolation for local tools
 * - Resource limits (CPU, memory, time)
 * - Network restrictions
 * 
 * This is the security boundary between "thinking" and "doing".
 */

import { spawn, ChildProcess } from 'child_process';
import { logger, auditLog } from '../services/logger';

// =============================================================================
// SANDBOX CONFIGURATION
// =============================================================================

export interface SandboxConfig {
  // Enable Docker-based sandboxing (requires Docker)
  useDocker: boolean;
  // Docker image to use
  dockerImage: string;
  // Maximum execution time in milliseconds
  timeoutMs: number;
  // Maximum memory in MB
  memoryLimitMb: number;
  // Maximum CPU cores
  cpuLimit: number;
  // Network access
  networkEnabled: boolean;
  // Allowed network domains (if network enabled)
  allowedDomains: string[];
  // Read-only filesystem
  readOnlyFs: boolean;
  // Allowed write paths
  writePaths: string[];
}

const DEFAULT_CONFIG: SandboxConfig = {
  useDocker: false, // Fallback to process isolation
  dockerImage: 'jarvis-sandbox:latest',
  timeoutMs: 30000, // 30 seconds
  memoryLimitMb: 256,
  cpuLimit: 1,
  networkEnabled: false,
  allowedDomains: [],
  readOnlyFs: true,
  writePaths: ['/tmp'],
};

// =============================================================================
// EXECUTION RESULT
// =============================================================================

export interface SandboxResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killedByLimit: boolean;
  durationMs: number;
}

// =============================================================================
// SANDBOX EXECUTOR
// =============================================================================

export class SandboxExecutor {
  private config: SandboxConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(
    command: string,
    args: string[] = [],
    options: {
      input?: string;
      env?: Record<string, string>;
      cwd?: string;
      timeout?: number;
    } = {}
  ): Promise<SandboxResult> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const timeout = options.timeout || this.config.timeoutMs;

    auditLog('SANDBOX_EXECUTE', {
      executionId,
      command,
      args: args.slice(0, 5), // Log first 5 args only
      useDocker: this.config.useDocker,
    });

    try {
      if (this.config.useDocker) {
        return await this.executeInDocker(executionId, command, args, options, timeout);
      } else {
        return await this.executeInProcess(executionId, command, args, options, timeout);
      }
    } finally {
      this.activeProcesses.delete(executionId);
    }
  }

  /**
   * Execute in Docker container
   */
  private async executeInDocker(
    executionId: string,
    command: string,
    args: string[],
    options: {
      input?: string;
      env?: Record<string, string>;
      cwd?: string;
    },
    timeout: number
  ): Promise<SandboxResult> {
    const dockerArgs = [
      'run',
      '--rm',
      '--network', this.config.networkEnabled ? 'bridge' : 'none',
      '--memory', `${this.config.memoryLimitMb}m`,
      '--cpus', String(this.config.cpuLimit),
      '--read-only',
      '--tmpfs', '/tmp:size=64m',
      '--security-opt', 'no-new-privileges',
      '--cap-drop', 'ALL',
    ];

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        dockerArgs.push('-e', `${key}=${value}`);
      }
    }

    // Add the image and command
    dockerArgs.push(this.config.dockerImage, command, ...args);

    return this.spawnAndWait(executionId, 'docker', dockerArgs, options.input, timeout);
  }

  /**
   * Execute in isolated process (fallback when Docker not available)
   */
  private async executeInProcess(
    executionId: string,
    command: string,
    args: string[],
    options: {
      input?: string;
      env?: Record<string, string>;
      cwd?: string;
    },
    timeout: number
  ): Promise<SandboxResult> {
    // Security: Only allow specific commands
    const ALLOWED_COMMANDS = [
      'node', 'python3', 'python', 'bash', 'sh',
      'cat', 'echo', 'date', 'whoami', 'pwd',
    ];

    const baseCommand = command.split('/').pop() || command;
    if (!ALLOWED_COMMANDS.includes(baseCommand)) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `Command not allowed: ${command}`,
        timedOut: false,
        killedByLimit: false,
        durationMs: 0,
      };
    }

    // Create restricted environment
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: '/tmp',
      TMPDIR: '/tmp',
      ...options.env,
    };

    return this.spawnAndWait(executionId, command, args, options.input, timeout, {
      env,
      cwd: options.cwd || '/tmp',
    });
  }

  /**
   * Spawn process and wait for completion
   */
  private spawnAndWait(
    executionId: string,
    command: string,
    args: string[],
    input?: string,
    timeout = 30000,
    spawnOptions: any = {}
  ): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killedByLimit = false;

      const proc = spawn(command, args, {
        ...spawnOptions,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(executionId, proc);

      // Timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
        logger.warn('Sandbox execution timed out', { executionId, timeout });
      }, timeout);

      // Collect stdout
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 1024 * 1024) {
          killedByLimit = true;
          proc.kill('SIGKILL');
        }
      });

      // Collect stderr
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          killedByLimit = true;
          proc.kill('SIGKILL');
        }
      });

      // Send input if provided
      if (input && proc.stdin) {
        proc.stdin.write(input);
        proc.stdin.end();
      }

      // Handle completion
      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        resolve({
          success: code === 0 && !timedOut && !killedByLimit,
          exitCode: code || 0,
          stdout: stdout.substring(0, 100000), // Limit to 100KB
          stderr: stderr.substring(0, 100000),
          timedOut,
          killedByLimit,
          durationMs,
        });
      });

      // Handle errors
      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: error.message,
          timedOut: false,
          killedByLimit: false,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Kill all active processes
   */
  killAll(): void {
    for (const [id, proc] of this.activeProcesses) {
      try {
        proc.kill('SIGKILL');
        logger.info('Killed sandbox process', { id });
      } catch (e) {
        // Process may already be dead
      }
    }
    this.activeProcesses.clear();
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      const result = await this.spawnAndWait('docker-check', 'docker', ['--version'], undefined, 5000);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Build the sandbox Docker image
   */
  async buildSandboxImage(): Promise<boolean> {
    const dockerfile = `
FROM node:20-alpine

# Security: Run as non-root user
RUN adduser -D -u 1000 sandbox
USER sandbox
WORKDIR /home/sandbox

# No additional packages needed for basic sandbox
`;

    // Write Dockerfile to temp location
    const fs = await import('fs/promises');
    const path = await import('path');
    const tmpDir = '/tmp/jarvis-sandbox-build';
    
    try {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'Dockerfile'), dockerfile);
      
      const result = await this.spawnAndWait(
        'docker-build',
        'docker',
        ['build', '-t', this.config.dockerImage, tmpDir],
        undefined,
        120000 // 2 minute timeout for build
      );
      
      return result.success;
    } catch (error) {
      logger.error('Failed to build sandbox image', { error });
      return false;
    }
  }
}

// =============================================================================
// SCRIPT EXECUTOR (for trusted internal scripts)
// =============================================================================

export class ScriptExecutor {
  private sandbox: SandboxExecutor;

  constructor(config?: Partial<SandboxConfig>) {
    this.sandbox = new SandboxExecutor({
      ...config,
      networkEnabled: false,
      readOnlyFs: true,
    });
  }

  /**
   * Execute a JavaScript/Node.js script
   */
  async executeJS(script: string, timeout = 10000): Promise<SandboxResult> {
    // Wrap script in a safe evaluation context
    const wrappedScript = `
      'use strict';
      const result = (function() {
        ${script}
      })();
      console.log(JSON.stringify(result));
    `;
    
    return this.sandbox.execute('node', ['-e', wrappedScript], { timeout });
  }

  /**
   * Execute a Python script
   */
  async executePython(script: string, timeout = 10000): Promise<SandboxResult> {
    return this.sandbox.execute('python3', ['-c', script], { timeout });
  }

  /**
   * Execute a shell command
   */
  async executeShell(command: string, timeout = 10000): Promise<SandboxResult> {
    return this.sandbox.execute('sh', ['-c', command], { timeout });
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const sandboxExecutor = new SandboxExecutor();
export const scriptExecutor = new ScriptExecutor();
