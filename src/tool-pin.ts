/**
 * Tool Pinning / Lockfile for KERN MCP Security.
 *
 * On first scan, `--lock` generates `.kern-mcp-lock.json` with a hash of each
 * MCP tool's schema and description. On subsequent runs, `--verify` compares
 * against the lockfile and flags changes (tool behavior drift / rug-pull detection).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────

interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

export interface ToolPin {
  name: string;
  descriptionHash: string;  // sha256 of tool description
  schemaHash: string;       // sha256 of JSON-stringified input schema
  timestamp: string;        // ISO date when pinned
}

export interface LockFile {
  version: 1;
  generated: string;  // ISO date
  serverFile: string; // path to the scanned MCP server file
  tools: ToolPin[];
}

export interface PinDrift {
  toolName: string;
  field: 'description' | 'schema' | 'new' | 'removed';
  message: string;
  severity: 'error' | 'warning';
}

// ── Helpers ──────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function extractTools(irNodes: IRNode[]): Array<{ name: string; description: string; schemaJson: string }> {
  const actions = irNodes.filter(n => n.type === 'action');
  return actions.map(action => {
    const name = (action.props?.name as string) || 'unknown';
    const description = (action.props?.description as string) || '';
    // Schema = stringified children that represent the tool's input parameters
    const children = action.children ?? [];
    const schemaJson = JSON.stringify(children);
    return { name, description, schemaJson };
  });
}

// ── Public API ───────────────────────────────────────────────────────

/** Generate lockfile from current scan results. */
export function generateLockFile(serverFile: string, irNodes: IRNode[]): LockFile {
  const now = new Date().toISOString();
  const tools = extractTools(irNodes);

  return {
    version: 1,
    generated: now,
    serverFile,
    tools: tools.map(t => ({
      name: t.name,
      descriptionHash: sha256(t.description),
      schemaHash: sha256(t.schemaJson),
      timestamp: now,
    })),
  };
}

/** Compare current state against existing lockfile. */
export function verifyLockFile(lockPath: string, serverFile: string, irNodes: IRNode[]): PinDrift[] {
  const raw = fs.readFileSync(lockPath, 'utf-8');
  const lockFile: LockFile = JSON.parse(raw);
  const drifts: PinDrift[] = [];

  const currentTools = extractTools(irNodes);
  const pinnedByName = new Map(lockFile.tools.map(t => [t.name, t]));
  const currentByName = new Map(currentTools.map(t => [t.name, t]));

  // Check each pinned tool against current state
  for (const [name, pinned] of pinnedByName) {
    const current = currentByName.get(name);
    if (!current) {
      drifts.push({
        toolName: name,
        field: 'removed',
        message: `Tool '${name}': removed since lockfile was generated`,
        severity: 'error',
      });
      continue;
    }

    const currentDescHash = sha256(current.description);
    if (currentDescHash !== pinned.descriptionHash) {
      drifts.push({
        toolName: name,
        field: 'description',
        message: `Tool '${name}': description changed (possible tool poisoning)`,
        severity: 'error',
      });
    }

    const currentSchemaHash = sha256(current.schemaJson);
    if (currentSchemaHash !== pinned.schemaHash) {
      drifts.push({
        toolName: name,
        field: 'schema',
        message: `Tool '${name}': schema changed (input parameters modified)`,
        severity: 'error',
      });
    }
  }

  // Check for new tools not in lockfile
  for (const [name] of currentByName) {
    if (!pinnedByName.has(name)) {
      drifts.push({
        toolName: name,
        field: 'new',
        message: `Tool '${name}': new tool not in lockfile`,
        severity: 'warning',
      });
    }
  }

  return drifts;
}
