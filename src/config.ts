import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import * as path from 'path';

export interface McpSecurityConfig {
  enabled: boolean;
  severity: 'all' | 'errors' | 'warnings';
}

const DEFAULTS: McpSecurityConfig = {
  enabled: true,
  severity: 'all',
};

const CONFIG_FILE = '.mcpsecurityrc.json';

let projectConfig: Partial<McpSecurityConfig> | null = null;
let configWatcher: vscode.FileSystemWatcher | undefined;

export function initConfig(context: vscode.ExtensionContext): void {
  void loadProjectConfig();

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    const pattern = new vscode.RelativePattern(workspaceFolders[0], CONFIG_FILE);
    configWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    configWatcher.onDidChange(() => void loadProjectConfig());
    configWatcher.onDidCreate(() => void loadProjectConfig());
    configWatcher.onDidDelete(() => { projectConfig = null; });
    context.subscriptions.push(configWatcher);
  }
}

async function loadProjectConfig(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) { projectConfig = null; return; }

  const configPath = path.join(workspaceFolders[0].uri.fsPath, CONFIG_FILE);
  try {
    const raw = await readFile(configPath, 'utf-8');
    projectConfig = JSON.parse(raw);
  } catch {
    projectConfig = null;
  }
}

export function getConfig(): McpSecurityConfig {
  const vs = vscode.workspace.getConfiguration('kernMcpSecurity');

  return {
    enabled: projectConfig?.enabled ?? vs.get<boolean>('enabled', DEFAULTS.enabled),
    severity: projectConfig?.severity ?? validateSeverity(vs.get<string>('severity', DEFAULTS.severity)),
  };
}

function validateSeverity(value: string | undefined): McpSecurityConfig['severity'] {
  if (value === 'all' || value === 'errors' || value === 'warnings') return value;
  return 'all';
}
