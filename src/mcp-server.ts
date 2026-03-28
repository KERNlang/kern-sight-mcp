/**
 * KERN MCP Security — MCP Server.
 *
 * Long-lived subprocess that wraps @kernlang/review-mcp as an MCP tool.
 * Communicates via JSON-RPC 2.0 over stdio (stdin/stdout).
 * Logs go to stderr (not stdout — that's the protocol channel).
 */

import * as readline from 'readline';
import type { ReviewFinding } from '@kernlang/review-mcp';

// ── Lazy-load @kernlang/review-mcp (same two-stage strategy as old worker.ts) ──

let detectMCPServer: typeof import('@kernlang/review-mcp').detectMCPServer;
let reviewMCPSource: typeof import('@kernlang/review-mcp').reviewMCPSource;
let inferMCP: typeof import('@kernlang/review-mcp').inferMCP | null = null;
let computeSecurityScore: typeof import('@kernlang/review-mcp').computeSecurityScore;
let runPostScan: typeof import('@kernlang/review-mcp').runPostScan;

try {
  const mod = require('@kernlang/review-mcp');
  detectMCPServer = mod.detectMCPServer;
  reviewMCPSource = mod.reviewMCPSource;
  inferMCP = mod.inferMCP;
  computeSecurityScore = mod.computeSecurityScore;
  runPostScan = mod.runPostScan;
} catch {
  try {
    const mod = require('@kernlang/review-mcp');
    detectMCPServer = mod.detectMCPServer;
    reviewMCPSource = mod.reviewMCPSource;
    computeSecurityScore = mod.computeSecurityScore;
    runPostScan = mod.runPostScan;
  } catch (err) {
    process.stderr.write(`[mcp-server] Fatal: cannot load @kernlang/review-mcp: ${err}\n`);
    process.exit(1);
  }
}

// ── JSON-RPC helpers ────────────────────────────────────────────────

function send(msg: object): void {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

function sendResult(id: number, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id: number | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Tool: scan_mcp_server ───────────────────────────────────────────

function scanMcpServer(source: string, filePath: string): object {
  let lang: 'typescript' | 'python' | null = null;
  let findings: ReviewFinding[] = [];
  let irNodes: unknown[] = [];

  try {
    lang = detectMCPServer(source, filePath);
  } catch (err) {
    process.stderr.write(`[mcp-server] detectMCPServer failed: ${err}\n`);
  }

  if (lang) {
    try {
      findings = reviewMCPSource(source, filePath);
    } catch (err) {
      process.stderr.write(`[mcp-server] reviewMCPSource failed: ${err}\n`);
    }

    if (inferMCP && lang !== 'python') {
      try {
        irNodes = inferMCP(source, filePath);
      } catch {
        irNodes = [];
      }
    }
  }

  // Post-scan: catch patterns that regex rules miss (base64, SSRF, unsanitized, obfuscation)
  const postFindings = runPostScan(source, filePath) as unknown as ReviewFinding[];
  findings.push(...postFindings);

  const score = computeSecurityScore(irNodes as any[], findings);
  return { lang, findings, irNodes, score };
}

// ── Message dispatch ────────────────────────────────────────────────

function dispatch(method: string, params: any, id?: number): void {
  switch (method) {
    case 'initialize':
      sendResult(id!, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'kern-mcp-security-server', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // No response for notifications
      break;

    case 'tools/list':
      sendResult(id!, {
        tools: [{
          name: 'scan_mcp_server',
          description: 'Scan an MCP server source file for security vulnerabilities',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Source code to analyze' },
              filePath: { type: 'string', description: 'File path for language detection' },
            },
            required: ['source', 'filePath'],
          },
        }],
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      if (toolName !== 'scan_mcp_server') {
        sendResult(id!, { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true });
        return;
      }
      const args = params?.arguments ?? {};
      try {
        const result = scanMcpServer(args.source ?? '', args.filePath ?? '');
        sendResult(id!, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (err) {
        sendResult(id!, {
          content: [{ type: 'text', text: `Analysis failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id != null) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ── Stdin reader ────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    dispatch(msg.method, msg.params, msg.id);
  } catch {
    sendError(null, -32700, 'Parse error');
  }
});

// Exit when parent dies (stdin closes)
process.stdin.on('end', () => process.exit(0));
rl.on('close', () => process.exit(0));

process.stderr.write('[mcp-server] Started\n');
