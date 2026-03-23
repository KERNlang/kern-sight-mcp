/**
 * Config Guardian — scans MCP configuration files for security issues.
 *
 * Watches: claude_desktop_config.json, .cursor/mcp.json, .vscode/mcp.json
 * Detects: hardcoded secrets, unscanned paths, missing version pins
 * Trust levels: verified (green), unknown (yellow), risky (red)
 *
 * Opt-in feature, findings are SEPARATE from repo score.
 * Secrets are REDACTED in UI output.
 */

import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Types ─────────────────────────────────────────────────────────────

export interface ConfigIssue {
  type: 'hardcoded-secret' | 'unscanned-path' | 'missing-version-pin' | 'wide-permission';
  message: string;
  severity: 'error' | 'warning' | 'info';
  detail?: string;
}

export type TrustLevel = 'verified' | 'unknown' | 'risky';

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: 'claude' | 'cursor' | 'vscode';
  configPath: string;
  issues: ConfigIssue[];
  trust: TrustLevel;
}

// ── Secret detection patterns ─────────────────────────────────────────

const SECRET_PREFIXES = /^(sk-|ghp_|gho_|github_pat_|xox[bpas]-|AKIA|AIza|Bearer\s|glpat-|npm_|pypi-)/;
const SECRET_KEY_NAMES = /^(api[_-]?key|secret[_-]?key|password|token|private[_-]?key|auth[_-]?token|access[_-]?key|client[_-]?secret|database[_-]?url)$/i;

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isLikelySecret(key: string, value: string): boolean {
  if (SECRET_PREFIXES.test(value)) return true;
  if (SECRET_KEY_NAMES.test(key)) return true;
  if (value.length > 16 && shannonEntropy(value) > 4.5) return true;
  return false;
}

function redact(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

// ── Config file paths ─────────────────────────────────────────────────

function getClaudeDesktopConfigPath(): string {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config', 'claude', 'claude_desktop_config.json');
}

// ── Parsing ───────────────────────────────────────────────────────────

interface RawMcpConfig {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

function parseConfigFile(raw: string, source: 'claude' | 'cursor' | 'vscode', configPath: string): McpServerEntry[] {
  const entries: McpServerEntry[] = [];
  try {
    const parsed = JSON.parse(raw) as RawMcpConfig;
    const servers = parsed.mcpServers ?? {};

    for (const [name, config] of Object.entries(servers)) {
      const command = config.command ?? '';
      const args = config.args ?? [];
      const env = config.env ?? {};
      const issues: ConfigIssue[] = [];

      // Check env for hardcoded secrets
      for (const [key, value] of Object.entries(env)) {
        if (isLikelySecret(key, value)) {
          issues.push({
            type: 'hardcoded-secret',
            severity: 'error',
            message: `Hardcoded secret in env.${key}: ${redact(value)}`,
            detail: `Move to a .env file or system keychain. Never commit secrets in MCP configs.`,
          });
        }
      }

      // Check for missing version pinning
      if (/\bnpx\b/.test(command) || args.some(a => /\bnpx\b/.test(a))) {
        const fullCmd = [command, ...args].join(' ');
        if (!/@\d/.test(fullCmd) && !/@latest/.test(fullCmd)) {
          issues.push({
            type: 'missing-version-pin',
            severity: 'warning',
            message: `npx package without version pin — supply chain risk`,
            detail: `Use npx package@1.2.3 instead of npx package`,
          });
        }
      }
      if (/\buvx\b/.test(command) || args.some(a => /\buvx\b/.test(a))) {
        const fullCmd = [command, ...args].join(' ');
        if (!/==/.test(fullCmd) && !/@/.test(fullCmd)) {
          issues.push({
            type: 'missing-version-pin',
            severity: 'warning',
            message: `uvx package without version pin — supply chain risk`,
            detail: `Use uvx package==1.2.3 instead of uvx package`,
          });
        }
      }

      // Check for wide permissions in args
      const fullArgs = args.join(' ');
      if (/--allow-all|--no-sandbox|--disable-security/.test(fullArgs)) {
        issues.push({
          type: 'wide-permission',
          severity: 'error',
          message: `Wide permission flag detected: disables security restrictions`,
        });
      }

      // Check if command path is resolvable
      const isLocalPath = command.startsWith('/') || command.startsWith('./') || command.startsWith('~');
      if (isLocalPath) {
        const resolved = command.startsWith('~') ? command.replace('~', os.homedir()) : command;
        if (!existsSync(resolved)) {
          issues.push({
            type: 'unscanned-path',
            severity: 'warning',
            message: `Command path not found: ${command}`,
          });
        }
      }

      // Determine trust level
      let trust: TrustLevel = 'verified';
      if (issues.some(i => i.severity === 'error')) {
        trust = 'risky';
      } else if (issues.length > 0 || !isLocalPath) {
        trust = 'unknown';
      }

      entries.push({ name, command, args, env, source, configPath, issues, trust });
    }
  } catch {
    // Invalid JSON — skip
  }
  return entries;
}

// ── Guardian class ────────────────────────────────────────────────────

export class ConfigGuardian {
  private _servers: McpServerEntry[] = [];
  private _watchers: vscode.Disposable[] = [];
  private _onUpdate: ((servers: McpServerEntry[]) => void) | null = null;

  get servers(): McpServerEntry[] {
    return this._servers;
  }

  set onUpdate(handler: (servers: McpServerEntry[]) => void) {
    this._onUpdate = handler;
  }

  async init(context: vscode.ExtensionContext): Promise<void> {
    // Scan all known config paths
    await this._scanAll();

    // Watch workspace-relative configs
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const root = workspaceFolders[0];

      for (const relPath of ['.cursor/mcp.json', '.vscode/mcp.json']) {
        const pattern = new vscode.RelativePattern(root, relPath);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(() => void this._scanAll());
        watcher.onDidCreate(() => void this._scanAll());
        watcher.onDidDelete(() => void this._scanAll());
        this._watchers.push(watcher);
        context.subscriptions.push(watcher);
      }
    }

    // Watch Claude Desktop config (outside workspace — use polling)
    const claudePath = getClaudeDesktopConfigPath();
    if (existsSync(claudePath)) {
      const { watchFile, unwatchFile } = require('fs');
      watchFile(claudePath, { interval: 5000 }, () => void this._scanAll());
      context.subscriptions.push({ dispose: () => unwatchFile(claudePath) });
    }
  }

  private async _scanAll(): Promise<void> {
    const servers: McpServerEntry[] = [];

    // Claude Desktop
    const claudePath = getClaudeDesktopConfigPath();
    try {
      const raw = await readFile(claudePath, 'utf-8');
      servers.push(...parseConfigFile(raw, 'claude', claudePath));
    } catch { /* not found */ }

    // Workspace configs
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const root = workspaceFolders[0].uri.fsPath;
      for (const [relPath, source] of [
        ['.cursor/mcp.json', 'cursor'],
        ['.vscode/mcp.json', 'vscode'],
      ] as const) {
        const fullPath = path.join(root, relPath);
        try {
          const raw = await readFile(fullPath, 'utf-8');
          servers.push(...parseConfigFile(raw, source, fullPath));
        } catch { /* not found */ }
      }
    }

    this._servers = servers;
    this._onUpdate?.(servers);
  }

  dispose(): void {
    for (const w of this._watchers) w.dispose();
    this._watchers = [];
  }
}
