/**
 * System Prompt Generator
 * 
 * Generates the system prompt that instructs the LLM to:
 * 1. Output ONLY in structured formats (response, action, clarify, plan)
 * 2. Never execute tools through free-form text
 * 3. Ask for clarification when confidence is low
 * 4. Explain actions before executing
 * 
 * This is the key to making the LLM a PLANNER, not an EXECUTOR.
 */

import { ToolDefinitionType, WorldStateType } from './schemas';

// =============================================================================
// PROMPT COMPONENTS
// =============================================================================

const PERSONA = `You are JARVIS, an intelligent personal assistant. You are calm, confident, helpful, and occasionally witty. You speak naturally but concisely.

You have two capabilities:
1. RESPOND to the user with information or conversation
2. PLAN and REQUEST actions that will be executed by secure systems

CRITICAL: You are a PLANNER, not an EXECUTOR. You emit INTENT. Actual execution happens in a sandboxed environment after validation.`;

const OUTPUT_FORMAT = `## OUTPUT FORMAT

You MUST output in one of these formats:

### 1. RESPONSE (just talking, no action)
Simply respond in natural language. No JSON needed.

### 2. ACTION (single tool execution)
First, briefly explain what you'll do. Then output a JSON code block:

I'll [brief explanation of what you're about to do].

\`\`\`json
{
  "type": "action",
  "action": "toolName",
  "params": { ... },
  "confidence": 0.0-1.0,
  "reasoning": "why this is the right action"
}
\`\`\`

### 3. CLARIFY (need more info)
\`\`\`json
{
  "type": "clarify",
  "question": "What do you need to know?",
  "options": [
    {"label": "Option A", "value": "a"},
    {"label": "Option B", "value": "b"}
  ],
  "pendingAction": "what you'll do once clarified"
}
\`\`\`

### 4. PLAN (multi-step sequence)
\`\`\`json
{
  "type": "plan",
  "goal": "What user asked for",
  "summary": "Here's what I'll do: step 1, step 2, step 3",
  "confidence": 0.0-1.0,
  "steps": [
    {"action": "tool1", "params": {...}, "reasoning": "..."},
    {"action": "tool2", "params": {...}, "reasoning": "..."}
  ]
}
\`\`\``;

const RULES = `## RULES

1. NEVER embed tool calls in plain text responses. If you want to execute something, use the JSON format.

2. If your confidence is below 0.7, use CLARIFY instead of ACTION.

3. For dangerous actions (sending messages, controlling devices, deleting data), ALWAYS explain what you're about to do before the JSON block.

4. NEVER output raw shell commands, file paths with "../", or code that could be executed.

5. When uncertain between multiple interpretations, ask - don't guess.

6. Keep responses concise. You're an assistant, not a lecturer.

7. Match the user's energy. Casual question = casual response.`;

const AUTONOMY_GUIDANCE = `## AUTONOMY LEVELS

Based on the action's risk level, I will either:
- **Auto-approve**: Safe, read-only actions (get time, check weather)
- **Announce & act**: Low-risk, reversible (switch audio, open app)
- **Request confirmation**: Medium-risk (control devices, play music)
- **Require explicit confirmation**: High-risk (send email, delete data)

Your job is to emit the intent. The confirmation system handles the rest.`;

// =============================================================================
// TOOL FORMATTING
// =============================================================================

function formatToolsForPrompt(tools: ToolDefinitionType[]): string {
  const grouped = tools.reduce((acc, tool) => {
    const cat = tool.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tool);
    return acc;
  }, {} as Record<string, ToolDefinitionType[]>);
  
  let output = '## AVAILABLE TOOLS\n\n';
  
  for (const [category, categoryTools] of Object.entries(grouped)) {
    output += `### ${category.toUpperCase()}\n`;
    for (const tool of categoryTools) {
      const riskLabel = tool.safetyLevel === 'safe' ? '' : 
                       tool.safetyLevel === 'critical' ? ' ⚠️ CRITICAL' :
                       tool.safetyLevel === 'high_risk' ? ' ⚠️ HIGH RISK' : '';
      output += `- **${tool.name}**${riskLabel}: ${tool.description}\n`;
      
      // Show required params
      const props = tool.parameters.properties;
      const required = tool.parameters.required || [];
      const paramList = Object.entries(props)
        .map(([name, schema]: [string, any]) => {
          const isRequired = required.includes(name);
          return `  - ${name}${isRequired ? ' (required)' : ''}: ${schema.description || schema.type}`;
        })
        .join('\n');
      
      if (paramList) {
        output += paramList + '\n';
      }
    }
    output += '\n';
  }
  
  return output;
}

// =============================================================================
// WORLD STATE FORMATTING
// =============================================================================

function formatWorldStateForPrompt(state: WorldStateType): string {
  const lines: string[] = ['## CURRENT CONTEXT'];
  
  // Time
  lines.push(`Time: ${state.time.current} (${state.time.dayOfWeek}, ${state.time.timeOfDay})`);
  
  // User
  if (state.user.name) {
    lines.push(`User: ${state.user.name}`);
  }
  lines.push(`Mode: ${state.user.mode}`);
  
  // Desktop
  if (state.desktop?.activeApp) {
    lines.push(`Active app: ${state.desktop.activeApp}${state.desktop.activeWindow ? ` - "${state.desktop.activeWindow}"` : ''}`);
    if (state.desktop.focusDuration && state.desktop.focusDuration > 300) {
      lines.push(`  (focused for ${Math.round(state.desktop.focusDuration / 60)} minutes)`);
    }
  }
  
  // Home
  if (state.home?.audioOutput) {
    lines.push(`Audio output: ${state.home.audioOutput}`);
  }
  if (state.home?.currentScene) {
    lines.push(`Scene: ${state.home.currentScene}`);
  }
  
  // Music
  if (state.music?.isPlaying && state.music.currentTrack) {
    lines.push(`Now playing: ${state.music.currentTrack}`);
  }
  
  // Patterns (important for anticipation)
  if (state.patterns?.repeatedAction) {
    lines.push(`Pattern detected: ${state.patterns.repeatedAction.action} (${state.patterns.repeatedAction.count}x)`);
  }
  if (state.patterns?.possibleFrustration) {
    lines.push(`⚠️ Possible frustration: ${state.patterns.possibleFrustration.indicator}`);
  }
  
  // Pending
  if (state.pending?.timers?.length) {
    const timerStr = state.pending.timers
      .map(t => `${t.label} (${Math.round(t.remainingSeconds / 60)}m left)`)
      .join(', ');
    lines.push(`Active timers: ${timerStr}`);
  }
  
  return lines.join('\n');
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

export interface SystemPromptOptions {
  tools: ToolDefinitionType[];
  worldState: WorldStateType;
  userName?: string;
  customInstructions?: string;
  // Enable/disable certain capabilities
  enableVision?: boolean;
  enableProactive?: boolean;
}

/**
 * Generate the complete system prompt
 */
export function generateSystemPrompt(options: SystemPromptOptions): string {
  const { tools, worldState, userName, customInstructions, enableVision, enableProactive } = options;
  
  const parts: string[] = [
    PERSONA,
    '',
    OUTPUT_FORMAT,
    '',
    RULES,
    '',
    AUTONOMY_GUIDANCE,
    '',
    formatToolsForPrompt(tools),
    '',
    formatWorldStateForPrompt(worldState),
  ];
  
  // Add custom instructions if provided
  if (customInstructions) {
    parts.push('', '## CUSTOM INSTRUCTIONS', customInstructions);
  }
  
  // Add vision guidance if enabled
  if (enableVision) {
    parts.push('', `## VISION
You have access to the user's screen through the analyzeImage tool. Use this when:
- User says "look at this", "what's on my screen", etc.
- You need to understand what app/content they're viewing
- User seems stuck and you want to offer help

NEVER capture screen without clear user intent or relevance.`);
  }
  
  // Add proactive guidance if enabled
  if (enableProactive) {
    parts.push('', `## PROACTIVE ASSISTANCE
You may notice patterns and offer suggestions. When doing so:
- Be brief and non-intrusive
- Frame as suggestions, not commands
- Respect "no" gracefully
- Don't repeat rejected suggestions`);
  }
  
  return parts.join('\n');
}

/**
 * Generate a minimal system prompt for quick interactions
 */
export function generateMinimalPrompt(tools: ToolDefinitionType[]): string {
  const toolNames = tools.map(t => `${t.name}: ${t.description}`).join('\n');
  
  return `You are JARVIS. Output either plain text (response) or JSON:
\`\`\`json
{"type":"action","action":"toolName","params":{...},"confidence":0.9}
\`\`\`

Tools: ${toolNames}

If uncertain, ask. Never embed actions in plain text.`;
}
