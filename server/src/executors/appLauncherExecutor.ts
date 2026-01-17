/**
 * App Launcher Executor - Launch and control Windows applications
 */

import { z } from 'zod';
import { IToolExecutor, ToolCapability, ExecutionResult, createSideEffect } from './interface';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const APP_ALIASES: Record<string, string> = {
  'chrome': 'chrome', 'google chrome': 'chrome', 'firefox': 'firefox',
  'edge': 'msedge', 'word': 'winword', 'excel': 'excel', 'powerpoint': 'powerpnt',
  'outlook': 'outlook', 'teams': 'teams', 'vscode': 'code', 'vs code': 'code',
  'terminal': 'wt', 'cmd': 'cmd', 'powershell': 'powershell', 'notepad': 'notepad',
  'spotify': 'spotify', 'discord': 'discord', 'slack': 'slack', 'zoom': 'zoom',
  'calculator': 'calc', 'calc': 'calc', 'explorer': 'explorer', 'settings': 'ms-settings:',
};

async function runPowerShell(command: string): Promise<string> {
  const { stdout } = await execAsync(`powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`, { timeout: 10000 });
  return stdout.trim();
}

export class AppLauncherExecutor implements IToolExecutor {
  id = 'appLauncher';
  name = 'App Launcher';
  category = 'system';
  description = 'Launch and control applications';

  getCapabilities(): ToolCapability[] {
    return [
      {
        name: 'launchApp',
        description: 'Open/launch an application by name. Examples: "open chrome", "launch spotify", "start notepad", "open word"',
        schema: z.object({ app: z.string(), args: z.string().optional() }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'openUrl',
        description: 'Open a URL/website in the default browser',
        schema: z.object({ url: z.string() }),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'closeApp',
        description: 'Close an application',
        schema: z.object({ app: z.string(), force: z.boolean().optional().default(false) }),
        riskLevel: 'medium',
        reversible: false,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'listRunningApps',
        description: 'List running applications',
        schema: z.object({}),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'local',
        requiredPermissions: [],
        supportsSimulation: false,
      },
      {
        name: 'focusApp',
        description: 'Bring app to foreground',
        schema: z.object({ app: z.string() }),
        riskLevel: 'none',
        reversible: true,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'minimizeAll',
        description: 'Minimize all windows',
        schema: z.object({}),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
      {
        name: 'lockScreen',
        description: 'Lock the computer',
        schema: z.object({}),
        riskLevel: 'low',
        reversible: true,
        externalImpact: false,
        blastRadius: 'device',
        requiredPermissions: [],
        supportsSimulation: true,
      },
    ];
  }

  async execute(toolName: string, params: Record<string, any>): Promise<ExecutionResult> {
    const startedAt = new Date();
    try {
      let output: any, message: string;
      const sideEffects: any[] = [];
      const resolveApp = (app: string) => APP_ALIASES[app.toLowerCase()] || app;

      switch (toolName) {
        case 'launchApp': {
          const app = resolveApp(params.app);
          if (app.includes(':')) {
            await runPowerShell(`Start-Process "${app}"`);
          } else if (params.args) {
            await runPowerShell(`Start-Process "${app}" -ArgumentList "${params.args}"`);
          } else {
            await runPowerShell(`Start-Process "${app}"`);
          }
          output = { app, launched: true };
          message = `Launched ${params.app}`;
          sideEffects.push(createSideEffect('process_spawn', app, message, { reversible: true }));
          break;
        }
        case 'openUrl': {
          await runPowerShell(`Start-Process "${params.url}"`);
          output = { url: params.url, opened: true };
          message = `Opened ${params.url}`;
          sideEffects.push(createSideEffect('process_spawn', 'browser', message, { reversible: true }));
          break;
        }
        case 'closeApp': {
          const app = resolveApp(params.app);
          const cmd = params.force
            ? `Stop-Process -Name "${app}" -Force -ErrorAction SilentlyContinue`
            : `Get-Process -Name "${app}" -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() }`;
          await runPowerShell(cmd);
          output = { app, closed: true };
          message = `Closed ${params.app}`;
          sideEffects.push(createSideEffect('process_kill', app, message, { reversible: false }));
          break;
        }
        case 'listRunningApps': {
          const result = await runPowerShell(`Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -Property Name, MainWindowTitle | ConvertTo-Json`);
          let apps: any[] = [];
          try {
            const parsed = JSON.parse(result);
            apps = (Array.isArray(parsed) ? parsed : [parsed]).map(a => ({ name: a.Name, title: a.MainWindowTitle }));
          } catch {}
          output = { apps };
          message = apps.length ? `${apps.length} apps running` : 'No apps with windows found';
          break;
        }
        case 'focusApp': {
          const app = resolveApp(params.app);
          await runPowerShell(`
            $p = Get-Process -Name "${app}" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($p) {
              $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
              Add-Type -MemberDefinition $sig -Name WinAPI -Namespace Win32
              [Win32.WinAPI]::SetForegroundWindow($p.MainWindowHandle)
            }
          `);
          output = { app, focused: true };
          message = `Switched to ${params.app}`;
          sideEffects.push(createSideEffect('ui_displayed', app, message, { reversible: true }));
          break;
        }
        case 'minimizeAll': {
          await runPowerShell(`(New-Object -ComObject Shell.Application).MinimizeAll()`);
          output = { minimized: true };
          message = 'Minimized all windows';
          sideEffects.push(createSideEffect('ui_displayed', 'desktop', message, { reversible: true }));
          break;
        }
        case 'lockScreen': {
          await runPowerShell('rundll32.exe user32.dll,LockWorkStation');
          output = { locked: true };
          message = 'Locked the computer';
          sideEffects.push(createSideEffect('device_control', 'workstation', message, { reversible: true }));
          break;
        }
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      return { success: true, output, message, sideEffects, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    } catch (error: any) {
      return { success: false, output: null, message: error.message, sideEffects: [], error: { code: 'LAUNCHER_ERROR', message: error.message, recoverable: true }, meta: { startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), executor: this.id, sandboxed: false } };
    }
  }

  async simulate(toolName: string, params: Record<string, any>) {
    const warnings = toolName === 'closeApp' && params.force ? ['Force close may cause data loss'] : [];
    return { wouldSucceed: true, predictedOutput: { simulated: true }, predictedSideEffects: [], warnings };
  }

  validate(toolName: string, params: Record<string, any>) {
    const cap = this.getCapabilities().find(c => c.name === toolName);
    if (!cap) return { valid: false, errors: ['Unknown tool'] };
    const result = cap.schema.safeParse(params);
    return result.success ? { valid: true, sanitizedParams: result.data } : { valid: false, errors: result.error.issues.map(i => i.message) };
  }

  canExecute(toolName: string): boolean { return this.getCapabilities().some(c => c.name === toolName); }
}

export const appLauncherExecutor = new AppLauncherExecutor();
