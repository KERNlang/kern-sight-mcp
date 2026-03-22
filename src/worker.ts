import { parentPort, workerData } from 'worker_threads';
import { reviewMCPSource, inferMCP, detectMCPServer } from '@kernlang/review-mcp';

interface WorkerInput {
  source: string;
  filePath: string;
}

const { source, filePath } = workerData as WorkerInput;

try {
  const lang = detectMCPServer(source, filePath);
  const findings = reviewMCPSource(source, filePath);
  const irNodes = inferMCP(source, filePath);
  parentPort?.postMessage({ type: 'result', findings, irNodes, lang });
} catch (err) {
  parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  });
}
