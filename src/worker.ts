import { parentPort, workerData } from 'worker_threads';
import { reviewMCPSource, inferMCP, detectMCPServer } from '@kernlang/review-mcp';
import type { ReviewFinding } from '@kernlang/review-mcp';

interface WorkerInput {
  source: string;
  filePath: string;
}

const { source, filePath } = workerData as WorkerInput;

// Each call isolated — ts-morph crash in inferMCP must not kill detection + findings
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

try {
  irNodes = inferMCP(source, filePath);
} catch {
  // ts-morph IR inference is best-effort — don't crash the whole worker
  irNodes = [];
}

parentPort?.postMessage({ type: 'result', findings, irNodes, lang });
