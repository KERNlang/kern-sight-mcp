/**
 * KERN MCP Security — MCP Client.
 *
 * Spawns the MCP server as a child process and communicates via JSON-RPC 2.0
 * over stdio. Used by the VS Code extension to decouple the analysis engine.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { ReviewFinding } from '@kernlang/review-mcp';
import type { SecurityScore } from '@kernlang/review-mcp';

// ── Types ────────────────────────────────────────────────────────────

export interface ScanResult {
  lang: 'typescript' | 'python' | null;
  findings: ReviewFinding[];
  irNodes: unknown[];
  score: SecurityScore;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── McpClient ────────────────────────────────────────────────────────

export class McpClient {
  private _process: ChildProcess | null = null;
  private _pending = new Map<number, PendingRequest>();
  private _nextId = 1;
  private _buffer = '';
  private _running = false;
  private _readyResolve?: () => void;
  private _readyPromise: Promise<void>;
  private _log: (msg: string) => void;

  constructor(
    private _serverPath: string,
    log?: (msg: string) => void,
  ) {
    this._log = log ?? (() => {});
    this._readyPromise = new Promise((r) => { this._readyResolve = r; });
  }

  /** Spawn server process and complete MCP initialize handshake. */
  async start(): Promise<void> {
    if (this._running) return;

    this._readyPromise = new Promise((r) => { this._readyResolve = r; });

    const child = spawn('node', [this._serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._process = child;
    this._running = true;
    this._buffer = '';

    child.stdout!.on('data', (chunk: Buffer) => this._onData(chunk.toString()));

    child.stderr!.on('data', (chunk: Buffer) => {
      this._log(`[mcp-server] ${chunk.toString().trimEnd()}`);
    });

    child.on('close', (code) => {
      this._running = false;
      this._log(`[mcp-server] Exited with code ${code}`);
      // Reject all pending requests
      for (const [id, pending] of this._pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Server exited with code ${code}`));
      }
      this._pending.clear();
    });

    // Send initialize handshake
    const initResult = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kern-mcp-security-extension', version: '1.0.0' },
    }, 5000);

    // Send initialized notification (no response expected)
    this._send('notifications/initialized', {});

    this._readyResolve?.();
    this._log(`[mcp-server] Initialized: ${JSON.stringify(initResult?.serverInfo ?? {})}`);
  }

  /** Kill the server process. */
  stop(): void {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
    this._running = false;
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client stopped'));
    }
    this._pending.clear();
  }

  /** Stop + start. */
  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  isRunning(): boolean {
    return this._running;
  }

  /** Get the next request ID (for external tracking before calling). */
  peekNextId(): number {
    return this._nextId;
  }

  /** Call the scan_mcp_server tool. Waits for server ready. */
  async callTool(source: string, filePath: string, timeoutMs = 10000): Promise<ScanResult> {
    await this._readyPromise;

    const result = await this._request('tools/call', {
      name: 'scan_mcp_server',
      arguments: { source, filePath },
    }, timeoutMs);

    // Parse the MCP tool response
    const content = result?.content;
    if (!content || !Array.isArray(content) || content.length === 0) {
      throw new Error('Empty tool response');
    }

    if (result.isError) {
      throw new Error(content[0]?.text ?? 'Tool error');
    }

    const parsed = JSON.parse(content[0].text);
    return parsed as ScanResult;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private _send(method: string, params: any, id?: number): void {
    if (!this._process?.stdin?.writable) return;
    const msg: any = { jsonrpc: '2.0', method, params };
    if (id != null) msg.id = id;
    this._process.stdin.write(JSON.stringify(msg) + '\n');
  }

  private _request(method: string, params: any, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      this._send(method, params, id);
    });
  }

  private _onData(chunk: string): void {
    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop()!; // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._onMessage(msg);
      } catch {
        this._log(`[mcp-server] Invalid JSON: ${line.slice(0, 100)}`);
      }
    }
  }

  private _onMessage(msg: any): void {
    const id = msg.id;
    if (id == null) return; // notification — ignore

    const pending = this._pending.get(id);
    if (!pending) return; // stale or unknown — ignore

    this._pending.delete(id);
    clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(msg.error.message ?? 'JSON-RPC error'));
    } else {
      pending.resolve(msg.result);
    }
  }
}
