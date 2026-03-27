import * as vscode from 'vscode';
import * as path from 'path';
import type { ReviewFinding } from '@kernlang/review-mcp';
import { McpSecuritySidebarProvider } from './review-panel';
import type { McpReviewResult } from './review-panel';
import { McpSecurityCodeActionProvider, SAFE_AUTOFIXES, PYTHON_AUTOFIXES, ALL_AUTOFIX_RULES } from './code-actions';
import { initConfig, getConfig } from './config';
import type { SecurityScore } from './score';
import { ConfigGuardian } from './config-guardian';
import { McpClient } from './mcp-client';

const SUPPORTED_LANGUAGES = new Set([
  'typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python',
]);

interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: McpSecuritySidebarProvider;
let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let activeRequests = new Map<string, number>(); // URI key → JSON-RPC request ID
let mcpClient: McpClient;

export function activate(context: vscode.ExtensionContext): void {
  try {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('kernMcpSecurity');
    outputChannel = vscode.window.createOutputChannel('KERN MCP Security');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusBarItem.command = 'kernMcpSecurity.showOutput';
    statusBarItem.show();
    updateStatusBar('idle', 0);

    // Start MCP server
    const serverPath = path.join(__dirname, 'mcp-server.js');
    mcpClient = new McpClient(serverPath, (msg) => outputChannel.appendLine(msg));
    mcpClient.start().catch((err) => {
      outputChannel.appendLine(`[MCP Server] Start failed: ${err.message}`);
    });

    // Register sidebar
    sidebarProvider = new McpSecuritySidebarProvider(context);
    sidebarProvider.safeFixRules = ALL_AUTOFIX_RULES;
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(McpSecuritySidebarProvider.viewType, sidebarProvider),
    );

    sidebarProvider.onScanRequested = () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
        void reviewDocument(editor.document);
      }
    };

    sidebarProvider.onCopySuggestionRequested = (suggestion) => {
      vscode.env.clipboard.writeText(suggestion);
      vscode.window.showInformationMessage('Fix suggestion copied to clipboard');
    };

    sidebarProvider.onApplyFixRequested = (filePath, line, ruleId) => {
      void (async () => {
        const isPy = filePath.endsWith('.py');
        const fixFn = isPy ? PYTHON_AUTOFIXES[ruleId] : SAFE_AUTOFIXES[ruleId];
        if (!fixFn) return;
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = fixFn(doc, line);
        if (edit) {
          await vscode.workspace.applyEdit(edit);
          outputChannel.appendLine(`[Fix] Applied autofix: ${ruleId} in ${path.basename(filePath)}`);
        }
      })();
    };

    // Update sidebar when switching files — but not when jumping to a finding
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (sidebarProvider.isJumping) return;
        if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
          void reviewDocument(editor.document);
        }
      }),
    );

    // Init project config (.mcpsecurityrc.json)
    initConfig(context);

    // Config Guardian — scans MCP config files for secrets/supply-chain issues
    const configGuardian = new ConfigGuardian();
    configGuardian.onUpdate = (servers) => {
      sidebarProvider.updateConfigGuardian(servers);
    };
    void configGuardian.init(context);
    context.subscriptions.push(configGuardian);

    // Code actions (quick fixes)
    const codeActionProvider = new McpSecurityCodeActionProvider();
    for (const lang of SUPPORTED_LANGUAGES) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({ language: lang }, codeActionProvider, {
          providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
      );
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.copySuggestion', (suggestion: string) => {
        vscode.env.clipboard.writeText(suggestion);
        vscode.window.showInformationMessage('Fix suggestion copied to clipboard');
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.scanFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) void reviewDocument(editor.document);
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.showOutput', () => {
        outputChannel.show();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'kernMcpSecurity');
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.generateBadge', () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          vscode.window.showWarningMessage('No workspace folder open');
          return;
        }
        // Lazy imports — these pull in @kernlang/review-mcp (ts-morph) which must NOT load at activation
        const { scanWorkspace } = require('./workspace-scan') as typeof import('./workspace-scan');
        const { generateReportJSON, updateReadme } = require('./badge') as typeof import('./badge');
        const fs = require('fs') as typeof import('fs');

        const root = folder.uri.fsPath;
        outputChannel.appendLine('[Badge] Scanning workspace...');
        const { score, files } = scanWorkspace(root);
        outputChannel.appendLine(`[Badge] Found ${files.length} MCP server file(s), score: ${score.total} (${score.grade})`);

        const reportPath = path.join(root, 'kern-mcp-security.json');
        const aggregate: import('./review-panel').McpReviewResult = {
          fileName: 'workspace',
          filePath: root,
          findings: files.flatMap(f => f.findings),
          irNodes: files.flatMap(f => f.irNodes),
          lang: 'typescript',
          score,
        };
        const report = generateReportJSON(aggregate, score);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
        outputChannel.appendLine(`[Badge] Wrote ${reportPath}`);

        updateReadme(root, score, aggregate);
        outputChannel.appendLine(`[Badge] Updated README.md`);

        vscode.window.showInformationMessage(
          `MCP Security: ${score.grade} (${score.total}/100) — badge + report written`,
        );
      }),
    );

    context.subscriptions.push(diagnosticCollection, outputChannel, statusBarItem);

    // Auto-scan on open, change, save
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => scheduleReview(doc)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => scheduleReview(e.document)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => void reviewDocument(doc)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        diagnosticCollection.delete(doc.uri);
        const key = doc.uri.toString();
        activeRequests.delete(key);
        const timer = debounceTimers.get(key);
        if (timer) clearTimeout(timer);
        debounceTimers.delete(key);
      }),
    );

    // Prime the sidebar for active editor
    const primeEditor = vscode.window.activeTextEditor;
    if (primeEditor && SUPPORTED_LANGUAGES.has(primeEditor.document.languageId)) {
      void reviewDocument(primeEditor.document);
    }

    outputChannel.appendLine('KERN MCP Security activated');
  } catch (err) {
    console.error('KERN MCP Security activation failed:', err);
    outputChannel?.appendLine(`Activation failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    void vscode.window.showErrorMessage('KERN MCP Security activation failed. Check the output channel.');
  }
}

function scheduleReview(document: vscode.TextDocument): void {
  if (!SUPPORTED_LANGUAGES.has(document.languageId)) return;

  const config = getConfig();
  if (!config.enabled) return;

  const key = document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    void reviewDocument(document);
  }, 800));
}

function isActiveDocument(key: string): boolean {
  return vscode.window.activeTextEditor?.document.uri.toString() === key;
}

async function reviewDocument(document: vscode.TextDocument): Promise<void> {
  if (!SUPPORTED_LANGUAGES.has(document.languageId)) return;

  const config = getConfig();
  if (!config.enabled) return;

  const key = document.uri.toString();
  const version = document.version;
  const source = document.getText();
  const filePath = document.uri.fsPath;
  const uri = document.uri;
  const fileName = path.basename(filePath);

  // Track this request for superseding
  const requestId = mcpClient.peekNextId();
  activeRequests.set(key, requestId);

  if (isActiveDocument(key)) {
    updateStatusBar('analyzing', 0);
    sidebarProvider.showLoading();
  }

  try {
    const result = await mcpClient.callTool(source, filePath, 10000);

    // Check if superseded by a newer request for the same file
    if (activeRequests.get(key) !== requestId) {
      outputChannel.appendLine(`[${fileName}] Discarded superseded result`);
      return;
    }

    // Check if document changed while we were scanning
    const currentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (!currentDoc || currentDoc.version !== version) {
      outputChannel.appendLine(`[${fileName}] Discarded stale result`);
      return;
    }

    const activeDoc = isActiveDocument(key);
    const lang = result.lang;

    if (!lang) {
      diagnosticCollection.set(uri, []);
      if (activeDoc) {
        updateStatusBar('idle', 0);
        sidebarProvider.showNotMcp();
      }
      return;
    }

    const findings = filterFindings(result.findings, config.severity);
    const diagnostics = findings.map((f) => findingToDiagnostic(f, currentDoc));
    diagnosticCollection.set(uri, diagnostics);
    outputChannel.appendLine(`[${fileName}] ${findings.length} finding(s), ${(result.irNodes ?? []).length} IR nodes (${lang})`);

    const reviewResult: McpReviewResult = {
      fileName,
      filePath,
      findings,
      irNodes: result.irNodes as IRNode[],
      lang,
      score: result.score,
    };

    if (activeDoc) {
      const scoreGrade = result.score ? `${result.score.grade}` : '';
      updateStatusBar('done', findings.length, scoreGrade);
      sidebarProvider.update(reviewResult);
    }
  } catch (err) {
    // If superseded, silently ignore
    if (activeRequests.get(key) !== requestId) return;

    if (isActiveDocument(key)) {
      updateStatusBar('error', 0);
    }
    outputChannel.appendLine(`[${fileName}] Analysis failed: ${err instanceof Error ? err.message : String(err)}`);

    // Restart server if it crashed
    if (!mcpClient.isRunning()) {
      outputChannel.appendLine('[MCP Server] Crashed — restarting...');
      try {
        await mcpClient.restart();
        outputChannel.appendLine('[MCP Server] Restarted successfully');
      } catch (restartErr) {
        outputChannel.appendLine(`[MCP Server] Restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`);
      }
    }
  }
}

function updateStatusBar(state: 'idle' | 'analyzing' | 'done' | 'error', count: number, grade?: string): void {
  switch (state) {
    case 'idle':
      statusBarItem.text = 'KERN MCP';
      statusBarItem.tooltip = 'Click to show output';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'analyzing':
      statusBarItem.text = '$(sync~spin) KERN MCP';
      statusBarItem.tooltip = 'Analyzing...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'done':
      statusBarItem.text = grade
        ? `$(shield) KERN MCP: ${grade}`
        : count > 0 ? `$(warning) KERN MCP: ${count}` : '$(check) KERN MCP';
      statusBarItem.tooltip = grade
        ? `Score: ${grade} — ${count} finding(s)`
        : count > 0 ? `${count} finding(s) — click to view` : 'No findings';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = '$(error) KERN MCP';
      statusBarItem.tooltip = 'Analysis failed — click to view logs';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}

function filterFindings(findings: ReviewFinding[], filter: string): ReviewFinding[] {
  if (filter === 'errors') return findings.filter((f) => f.severity === 'error');
  if (filter === 'warnings') return findings.filter((f) => f.severity !== 'info');
  return findings;
}

function findingToDiagnostic(finding: ReviewFinding, document: vscode.TextDocument): vscode.Diagnostic {
  const line = Math.max(0, finding.primarySpan.startLine - 1);
  const endLine = Math.max(0, finding.primarySpan.endLine - 1);
  const startCol = Math.max(0, finding.primarySpan.startCol - 1);
  const endCol = Math.max(0, finding.primarySpan.endCol - 1);

  const range = new vscode.Range(
    new vscode.Position(line, startCol),
    new vscode.Position(endLine, endCol || document.lineAt(endLine).text.length),
  );

  const severity = finding.severity === 'error'
    ? vscode.DiagnosticSeverity.Error
    : finding.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

  const diagnostic = new vscode.Diagnostic(range, finding.message, severity);
  diagnostic.source = 'KERN MCP';
  diagnostic.code = finding.ruleId;

  if (finding.suggestion) {
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, range),
        `Fix: ${finding.suggestion}`,
      ),
    ];
  }

  return diagnostic;
}

export function deactivate(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  activeRequests.clear();
  mcpClient?.stop();
}
