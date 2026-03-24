import { parentPort, workerData } from 'worker_threads';
import { computeSecurityScore } from './score';
import type { ReviewFinding } from '@kernlang/review-mcp';

interface WorkerInput {
  source: string;
  filePath: string;
}

const { source, filePath } = workerData as WorkerInput;

// Lazy-load @kernlang/review-mcp — ts-morph (used by inferMCP) can crash
// the worker at import time when bundled as CJS. Load in two stages:
// Stage 1: detect + review (regex-based, no ts-morph dependency)
// Stage 2: inferMCP (ts-morph, may fail in CJS worker context)

let detectMCPServer: typeof import('@kernlang/review-mcp').detectMCPServer;
let reviewMCPSource: typeof import('@kernlang/review-mcp').reviewMCPSource;
let inferMCP: typeof import('@kernlang/review-mcp').inferMCP | null = null;

try {
  const mod = require('@kernlang/review-mcp');
  detectMCPServer = mod.detectMCPServer;
  reviewMCPSource = mod.reviewMCPSource;
  inferMCP = mod.inferMCP;
} catch (err) {
  // ts-morph initialization crashed — try importing just the parts we need
  try {
    const mod = require('@kernlang/review-mcp');
    detectMCPServer = mod.detectMCPServer;
    reviewMCPSource = mod.reviewMCPSource;
  } catch (err2) {
    parentPort?.postMessage({ type: 'error', message: 'Module init failed: ' + (err2 instanceof Error ? err2.message : String(err2)) });
    process.exit(1);
  }
}

// Each call isolated — one failure must not kill the rest
let lang: 'typescript' | 'python' | null = null;
let findings: ReviewFinding[] = [];
let irNodes: unknown[] = [];

try {
  lang = detectMCPServer(source, filePath);
} catch (err) {
  parentPort?.postMessage({ type: 'error', message: 'detectMCPServer failed: ' + (err instanceof Error ? err.message : String(err)) });
  process.exit(0);
}

try {
  findings = reviewMCPSource(source, filePath);
} catch (err) {
  // Regex rules failed — still report detection + empty findings
  parentPort?.postMessage({ type: 'error', message: 'reviewMCPSource failed: ' + (err instanceof Error ? err.message : String(err)) });
}

// inferMCP uses ts-morph — skip for Python (ts-morph is TS/JS only) and if import failed
if (inferMCP && lang !== 'python') {
  try {
    irNodes = inferMCP(source, filePath);
  } catch {
    // ts-morph IR inference is best-effort
    irNodes = [];
  }
}

const score = computeSecurityScore(irNodes as any[], findings);
parentPort?.postMessage({ type: 'result', findings, irNodes, lang, score });
