/**
 * JARVIS Core Module
 * 
 * The complete brain architecture:
 * 
 * FOUNDATION
 * - Structured intent schemas (schemas.ts)
 * - Intent parsing with injection detection (intentParser.ts)
 * - System prompt generation (systemPrompt.ts)
 * 
 * DECISION MAKING
 * - Autonomy decision engine (autonomyEngine.ts)
 * - Execution pipeline orchestration (executionPipeline.ts)
 * - Interruption & silence budgeting (interruptionManager.ts, silenceManager.ts)
 * - Action simulation / dry-run (actionSimulator.ts)
 * 
 * PERCEPTION & STATE
 * - Real-time perception layer (perception.ts)
 * - Native OS-level perception (nativePerception.ts)
 * - World state snapshots & diffs (stateSnapshots.ts)
 * 
 * MEMORY & LEARNING
 * - Goal tracking with attention decay (goalTracker.ts)
 * - Persistent memory with decay (memoryWithDecay.ts)
 * 
 * SECURITY
 * - Embedding-based injection detection (injectionDetector.ts)
 * 
 * TRANSPARENCY
 * - Self-knowledge & introspection (selfKnowledge.ts)
 * - User-visible trust signals (trustSignals.ts)
 * 
 * EXTENSIBILITY
 * - Plugin-based capability system (pluginSystem.ts)
 */

// Foundation
export * from './schemas';
export * from './intentParser';
export * from './systemPrompt';

// Decision Making
export * from './autonomyEngine';
export * from './executionPipeline';
export * from './interruptionManager';
export * from './actionSimulator';

// Perception & State
export * from './perception';
export * from './nativePerception';
export * from './stateSnapshots';

// Memory & Learning
export * from './goalTracker';
export * from './memoryWithDecay';
export * from './userPreferences';

// Orchestrator (the spine)
export * from './orchestrator';

// Security
export * from './injectionDetector';

// Transparency
export * from './selfKnowledge';
export * from './trustSignals';

// Extensibility
export * from './pluginSystem';
