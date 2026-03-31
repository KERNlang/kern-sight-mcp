import * as vscode from 'vscode';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export interface ContextItem {
  id: string;
  label: string;
  category: 'project' | 'schema' | 'api' | 'env' | 'kern' | 'spec';
  preview: string;
  content: string;
  filePath?: string;
}

const MAX_FILE_SIZE = 50_000; // 50KB max per file

async function tryRead(filePath: string): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null;
    const content = await readFile(filePath, 'utf-8');
    return content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)' : content;
  } catch {
    return null;
  }
}

export async function scanWorkspaceContext(): Promise<ContextItem[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];

  const root = folders[0].uri.fsPath;
  const items: ContextItem[] = [];

  // ── Package.json (deps, scripts) ────────────────────────────────────
  const pkg = await tryRead(path.join(root, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const summary = {
        name: parsed.name,
        dependencies: Object.keys(parsed.dependencies ?? {}),
        devDependencies: Object.keys(parsed.devDependencies ?? {}),
        scripts: Object.keys(parsed.scripts ?? {}),
      };
      items.push({
        id: 'package-json',
        label: 'package.json',
        category: 'project',
        preview: `${summary.dependencies.length} deps, ${summary.scripts.length} scripts`,
        content: JSON.stringify(summary, null, 2),
      });
    } catch { /* skip invalid json */ }
  }

  // ── Database schemas ────────────────────────────────────────────────
  const schemaPatterns = [
    { glob: '**/prisma/schema.prisma', label: 'Prisma Schema' },
    { glob: '**/drizzle/**/*.ts', label: 'Drizzle Schema' },
    { glob: '**/schema.sql', label: 'SQL Schema' },
    { glob: '**/migrations/*.sql', label: 'SQL Migration' },
  ];

  for (const { glob: pattern, label } of schemaPatterns) {
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 3);
    for (const file of files) {
      const content = await tryRead(file.fsPath);
      if (content) {
        items.push({
          id: `schema-${path.basename(file.fsPath)}`,
          label: `${label}: ${path.basename(file.fsPath)}`,
          category: 'schema',
          preview: `${content.split('\n').length} lines`,
          content,
          filePath: file.fsPath,
        });
      }
    }
  }

  // ── API routes ──────────────────────────────────────────────────────
  const routePatterns = [
    '**/routes/**/*.ts',
    '**/api/**/*.ts',
    '**/app/api/**/route.ts',
    '**/controllers/**/*.ts',
  ];

  for (const pattern of routePatterns) {
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 5);
    for (const file of files) {
      const content = await tryRead(file.fsPath);
      if (content) {
        const rel = path.relative(root, file.fsPath);
        items.push({
          id: `api-${rel}`,
          label: rel,
          category: 'api',
          preview: `${content.split('\n').length} lines`,
          content,
          filePath: file.fsPath,
        });
      }
    }
  }

  // ── OpenAPI / Swagger specs ─────────────────────────────────────────
  const specPatterns = ['**/openapi.{yaml,yml,json}', '**/swagger.{yaml,yml,json}', '**/api-spec.{yaml,yml,json}'];
  for (const pattern of specPatterns) {
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 2);
    for (const file of files) {
      const content = await tryRead(file.fsPath);
      if (content) {
        items.push({
          id: `spec-${path.basename(file.fsPath)}`,
          label: `API Spec: ${path.basename(file.fsPath)}`,
          category: 'spec',
          preview: `${content.split('\n').length} lines`,
          content,
          filePath: file.fsPath,
        });
      }
    }
  }

  // ── .env (variable names only — never values) ──────────────────────
  const envFiles = ['.env', '.env.example', '.env.local'];
  for (const envFile of envFiles) {
    const content = await tryRead(path.join(root, envFile));
    if (content) {
      const varNames = content
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('#'))
        .map(l => l.split('=')[0]?.trim())
        .filter(Boolean);

      if (varNames.length > 0) {
        items.push({
          id: `env-${envFile}`,
          label: envFile,
          category: 'env',
          preview: `${varNames.length} variables`,
          content: `Environment variables (names only):\n${varNames.join('\n')}`,
        });
      }
    }
  }

  // ── Existing .kern files ────────────────────────────────────────────
  const kernFiles = await vscode.workspace.findFiles('**/*.kern', '**/node_modules/**', 5);
  for (const file of kernFiles) {
    const content = await tryRead(file.fsPath);
    if (content) {
      const rel = path.relative(root, file.fsPath);
      items.push({
        id: `kern-${rel}`,
        label: rel,
        category: 'kern',
        preview: `${content.split('\n').length} lines`,
        content,
        filePath: file.fsPath,
      });
    }
  }

  return items;
}
