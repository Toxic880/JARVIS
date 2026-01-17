#!/usr/bin/env node
/**
 * JARVIS Build & Run Script
 * 
 * Usage:
 *   node jarvis.cjs                  # Start in development mode
 *   node jarvis.cjs            # Start server + UI
 *   node jarvis.cjs build            # Build for production
 *   node jarvis.cjs build:electron   # Build desktop app
 *   node jarvis.cjs setup            # Interactive setup
 *   node jarvis.cjs doctor           # Diagnose issues
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

// =============================================================================
// CONFIGURATION
// =============================================================================

const ROOT = __dirname;
const SERVER_DIR = path.join(ROOT, 'server');
const ENV_FILE = path.join(ROOT, '.env');

// =============================================================================
// UTILITIES
// =============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const log = {
  info: (msg) => console.log(`${c.cyan}ℹ${c.reset} ${msg}`),
  success: (msg) => console.log(`${c.green}✓${c.reset} ${msg}`),
  warn: (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
  error: (msg) => console.log(`${c.red}✗${c.reset} ${msg}`),
  step: (msg) => console.log(`${c.blue}→${c.reset} ${msg}`),
};

function banner() {
  console.log(`
${c.cyan}     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝${c.reset}
  ${c.dim}Just A Rather Very Intelligent System${c.reset}
`);
}

function run(cmd, cwd = ROOT, silent = false) {
  try {
    execSync(cmd, { 
      cwd, 
      stdio: silent ? 'pipe' : 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    return true;
  } catch (e) {
    return false;
  }
}

function exists(p) {
  return fs.existsSync(p);
}

async function question(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadEnv() {
  if (!exists(ENV_FILE)) return {};
  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
      }
    }
  }
  return env;
}

function saveEnv(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n'));
}

// =============================================================================
// COMMANDS
// =============================================================================

async function cmdSetup() {
  banner();
  log.info('Welcome to JARVIS setup!\n');
  
  // Check prerequisites
  log.step('Checking prerequisites...');
  
  const hasNode = run('node --version', ROOT, true);
  const hasNpm = run('npm --version', ROOT, true);
  
  if (!hasNode || !hasNpm) {
    log.error('Node.js is required. Install from https://nodejs.org/');
    process.exit(1);
  }
  log.success('Node.js found');
  
  // Create .env if needed
  if (!exists(ENV_FILE)) {
    log.step('Creating configuration file...');
    if (exists(path.join(ROOT, '.env.example'))) {
      fs.copyFileSync(path.join(ROOT, '.env.example'), ENV_FILE);
    } else {
      fs.writeFileSync(ENV_FILE, '');
    }
  }
  
  let env = loadEnv();
  
  // Generate JWT secret
  if (!env.JWT_SECRET || env.JWT_SECRET.includes('change-this')) {
    const crypto = require('crypto');
    env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
    log.success('Generated security keys');
  }
  
  // LLM Configuration
  console.log('\n' + c.bold + 'AI Configuration' + c.reset);
  console.log(c.dim + 'JARVIS needs a language model to understand you.' + c.reset + '\n');
  
  console.log('  1. OpenAI API (recommended, ~$5/month)');
  console.log('  2. Local LLM via LM Studio (free, requires good hardware)');
  console.log('  3. Skip for now\n');
  
  const llmChoice = await question('Choose [1/2/3]: ');
  
  if (llmChoice === '1') {
    const key = await question('Enter OpenAI API key (sk-...): ');
    if (key && key.startsWith('sk-')) {
      env.OPENAI_API_KEY = key;
      log.success('OpenAI configured');
    }
  } else if (llmChoice === '2') {
    env.LLM_BASE_URL = 'http://localhost:1234';
    log.success('Local LLM configured (make sure LM Studio is running)');
  }
  
  // Voice Configuration
  console.log('\n' + c.bold + 'Voice Configuration (Optional)' + c.reset);
  console.log(c.dim + 'Let JARVIS speak responses aloud.' + c.reset + '\n');
  
  const addVoice = await question('Add voice output? [y/N]: ');
  
  if (addVoice.toLowerCase() === 'y') {
    console.log('\nGet a free API key from: https://elevenlabs.io/\n');
    const voiceKey = await question('Enter ElevenLabs API key: ');
    if (voiceKey) {
      env.ELEVENLABS_API_KEY = voiceKey;
      log.success('Voice configured');
    }
  }
  
  // Save configuration
  saveEnv(env);
  log.success('Configuration saved to .env');
  
  // Install dependencies
  console.log('\n' + c.bold + 'Installing dependencies...' + c.reset + '\n');
  
  log.step('Installing server dependencies...');
  if (!run('npm install', SERVER_DIR)) {
    log.error('Failed to install server dependencies');
    process.exit(1);
  }
  
  log.step('Building server...');
  if (!run('npm run build', SERVER_DIR)) {
    log.error('Failed to build server');
    process.exit(1);
  }
  
  log.step('Installing frontend dependencies...');
  if (!run('npm install', ROOT)) {
    log.warn('Frontend dependencies failed - you may need to install manually');
  }
  
  console.log('\n' + c.green + c.bold + '✓ Setup complete!' + c.reset);
  console.log('\nRun ' + c.cyan + 'node jarvis.cjs' + c.reset + ' to begin.\n');
}

async function cmdStart() {
  banner();
  
  // Check if setup is done
  if (!exists(path.join(SERVER_DIR, 'node_modules'))) {
    log.warn('Dependencies not installed. Running setup first...\n');
    await cmdSetup();
  }
  
  // Check if built
  if (!exists(path.join(SERVER_DIR, 'dist'))) {
    log.step('Building server...');
    run('npm run build', SERVER_DIR);
  }
  
  log.info('Starting JARVIS...\n');
  
  // Start backend server
  const env = loadEnv();
  const serverProc = spawn('node', ['dist/index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  
  serverProc.on('error', (err) => {
    log.error(`Server failed: ${err.message}`);
  });
  
  // Start frontend dev server
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  
  const frontendProc = spawn(npmCmd, ['run', 'dev'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: isWindows,
  });
  
  frontendProc.on('error', (err) => {
    log.error(`Frontend failed: ${err.message}`);
  });
  
  // Wait a moment then show info
  setTimeout(() => {
    console.log('\n' + c.green + '━━━ JARVIS is running! ━━━' + c.reset);
    console.log(`\n  ${c.cyan}Frontend:${c.reset}  http://localhost:3000`);
    console.log(`  ${c.cyan}API:${c.reset}       http://localhost:3001`);
    console.log(`  ${c.cyan}Health:${c.reset}    http://localhost:3001/api/v1/health`);
    console.log(`\n  ${c.bold}Open http://localhost:3000 in your browser${c.reset}`);
    console.log(`\n  Press ${c.yellow}Ctrl+C${c.reset} to stop\n`);
  }, 3000);
  
  process.on('SIGINT', () => {
    console.log('\n' + c.cyan + 'Shutting down...' + c.reset);
    serverProc.kill();
    frontendProc.kill();
    process.exit(0);
  });
}

async function cmdBuild() {
  banner();
  log.info('Building for production...\n');
  
  // Build server
  log.step('Building server...');
  if (!run('npm run build', SERVER_DIR)) {
    log.error('Server build failed');
    process.exit(1);
  }
  log.success('Server built');
  
  // Build frontend
  log.step('Building frontend...');
  if (!run('npm run build', ROOT)) {
    log.error('Frontend build failed');
    process.exit(1);
  }
  log.success('Frontend built');
  
  console.log('\n' + c.green + c.bold + '✓ Build complete!' + c.reset);
  console.log('\nOutput in: ' + c.cyan + 'dist/' + c.reset + '\n');
}

async function cmdDoctor() {
  banner();
  log.info('Running diagnostics...\n');
  
  const checks = [];
  
  // Node.js
  checks.push({
    name: 'Node.js',
    check: () => {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      const major = parseInt(version.slice(1));
      return { ok: major >= 18, message: version };
    },
  });
  
  // npm
  checks.push({
    name: 'npm',
    check: () => {
      const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
      return { ok: true, message: `v${version}` };
    },
  });
  
  // .env file
  checks.push({
    name: 'Configuration',
    check: () => {
      if (!exists(ENV_FILE)) return { ok: false, message: 'No .env file' };
      const env = loadEnv();
      if (!env.JWT_SECRET || env.JWT_SECRET.includes('change-this')) {
        return { ok: false, message: 'JWT_SECRET not set' };
      }
      return { ok: true, message: '.env configured' };
    },
  });
  
  // LLM
  checks.push({
    name: 'AI Brain',
    check: () => {
      const env = loadEnv();
      if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.startsWith('sk-')) {
        return { ok: true, message: 'OpenAI configured' };
      }
      if (env.LLM_BASE_URL) {
        return { ok: true, message: 'Local LLM configured' };
      }
      return { ok: false, message: 'No LLM configured' };
    },
  });
  
  // Server dependencies
  checks.push({
    name: 'Server dependencies',
    check: () => {
      if (exists(path.join(SERVER_DIR, 'node_modules'))) {
        return { ok: true, message: 'Installed' };
      }
      return { ok: false, message: 'Run: cd server && npm install' };
    },
  });
  
  // Server built
  checks.push({
    name: 'Server build',
    check: () => {
      if (exists(path.join(SERVER_DIR, 'dist', 'index.js'))) {
        return { ok: true, message: 'Built' };
      }
      return { ok: false, message: 'Run: cd server && npm run build' };
    },
  });
  
  // Voice (optional)
  checks.push({
    name: 'Voice output',
    check: () => {
      const env = loadEnv();
      if (env.ELEVENLABS_API_KEY) {
        return { ok: true, message: 'ElevenLabs configured' };
      }
      return { ok: true, message: 'Not configured (optional)' };
    },
  });
  
  // Run checks
  let allOk = true;
  
  for (const { name, check } of checks) {
    try {
      const result = check();
      if (result.ok) {
        console.log(`  ${c.green}✓${c.reset} ${name}: ${c.dim}${result.message}${c.reset}`);
      } else {
        console.log(`  ${c.red}✗${c.reset} ${name}: ${c.yellow}${result.message}${c.reset}`);
        allOk = false;
      }
    } catch (e) {
      console.log(`  ${c.red}✗${c.reset} ${name}: ${c.red}Error${c.reset}`);
      allOk = false;
    }
  }
  
  console.log();
  
  if (allOk) {
    log.success('All checks passed! Run ' + c.cyan + 'node jarvis.cjs' + c.reset);
  } else {
    log.warn('Some issues found. Run ' + c.cyan + 'node jarvis.cjs setup' + c.reset + ' to fix.');
  }
  
  console.log();
}

// =============================================================================
// MAIN
// =============================================================================

const command = process.argv[2] || 'start';

switch (command) {
  case 'setup':
    cmdSetup();
    break;
  case 'start':
  case 'run':
    cmdStart();
    break;
  case 'build':
    cmdBuild();
    break;
  case 'doctor':
  case 'check':
    cmdDoctor();
    break;
  case 'help':
  case '--help':
  case '-h':
    banner();
    console.log('Usage: node jarvis.cjs [command]\n');
    console.log('Commands:');
    console.log('  (none)    Start JARVIS (same as start)');
    console.log('  setup     Interactive setup wizard');
    console.log('  start     Start the server');
    console.log('  build     Build for production');
    console.log('  doctor    Diagnose issues');
    console.log('  help      Show this help');
    console.log();
    break;
  default:
    log.error(`Unknown command: ${command}`);
    console.log('Run ' + c.cyan + 'node jarvis.cjs help' + c.reset + ' for usage.');
    process.exit(1);
}
