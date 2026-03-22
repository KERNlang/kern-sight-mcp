import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import * as path from 'path';
import type { ReviewFinding } from '@kernlang/review-mcp';
import { McpSecuritySidebarProvider } from './review-panel';
import type { McpReviewResult } from './review-panel';
import { McpSecurityCodeActionProvider } from './code-actions';
import { initConfig, getConfig } from './config';

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
let activeWorkers = new Map<string, Worker>();
const MAX_CONCURRENT_WORKERS = 3;

export function activate(context: vscode.ExtensionContext): void {
  try {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('kernMcpSecurity');
    outputChannel = vscode.window.createOutputChannel('KERN MCP Security');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusBarItem.command = 'kernMcpSecurity.showOutput';
    statusBarItem.show();
    updateStatusBar('idle', 0);

    // Register sidebar
    sidebarProvider = new McpSecuritySidebarProvider(context);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(McpSecuritySidebarProvider.viewType, sidebarProvider),
    );

    sidebarProvider.onScanRequested = () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
        reviewDocument(editor.document);
      }
    };

    sidebarProvider.onCopySuggestionRequested = (suggestion) => {
      vscode.env.clipboard.writeText(suggestion);
      vscode.window.showInformationMessage('Fix suggestion copied to clipboard');
    };

    // Update sidebar when switching files
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
          reviewDocument(editor.document);
        }
      }),
    );

    // Init project config (.mcpsecurityrc.json)
    initConfig(context);

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
        if (editor) reviewDocument(editor.document);
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

    context.subscriptions.push(diagnosticCollection, outputChannel, statusBarItem);

    // Auto-scan on open, change, save
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => scheduleReview(doc)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => scheduleReview(e.document)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => reviewDocument(doc)),
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        diagnosticCollection.delete(doc.uri);
        cancelWorker(doc.uri.toString());
        const timer = debounceTimers.get(doc.uri.toString());
        if (timer) clearTimeout(timer);
        debounceTimers.delete(doc.uri.toString());
      }),
    );

    // Prime the sidebar for active editor
    const primeEditor = vscode.window.activeTextEditor;
    if (primeEditor && SUPPORTED_LANGUAGES.has(primeEditor.document.languageId)) {
      reviewDocument(primeEditor.document);
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
    reviewDocument(document);
  }, 800));
}

function cancelWorker(key: string): void {
  const existing = activeWorkers.get(key);
  if (existing) {
    existing.terminate();
    activeWorkers.delete(key);
  }
}

function reviewDocument(document: vscode.TextDocument): void {
  if (!SUPPORTED_LANGUAGES.has(document.languageId)) return;

  const config = getConfig();
  if (!config.enabled) return;

  const key = document.uri.toString();
  if (activeWorkers.size >= MAX_CONCURRENT_WORKERS && !activeWorkers.has(key)) return;

  const source = document.getText();
  const filePath = document.uri.fsPath;
  const uri = document.uri;
  const version = document.version;
  const fileName = path.basename(filePath);

  // Cancel any in-flight worker for this file
  cancelWorker(key);

  updateStatusBar('analyzing', 0);
  sidebarProvider.showLoading();

  const workerPath = path.join(__dirname, 'worker.js');
  const worker = new Worker(workerPath, {
    workerData: { source, filePath },
  });
  activeWorkers.set(key, worker);

  // 10-second timeout
  const timeout = setTimeout(() => {
    worker.terminate();
    activeWorkers.delete(key);
    updateStatusBar('error', 0);
    outputChannel.appendLine(`[${fileName}] Worker timeout (10s)`);
  }, 10000);

  worker.on('message', (msg: {
    type: string;
    findings?: ReviewFinding[];
    irNodes?: IRNode[];
    lang?: 'typescript' | 'python' | null;
    message?: string;
  }) => {
    clearTimeout(timeout);
    activeWorkers.delete(key);

    // Stale result check
    const currentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (!currentDoc || currentDoc.version !== version) {
      outputChannel.appendLine(`[${fileName}] Discarded stale result`);
      return;
    }

    if (msg.type === 'result' && msg.findings) {
      const lang = msg.lang ?? null;

      if (!lang) {
        // Not an MCP server — clear diagnostics, show "not MCP"
        diagnosticCollection.set(uri, []);
        updateStatusBar('idle', 0);
        sidebarProvider.showNotMcp();
        return;
      }

      const findings = filterFindings(msg.findings, config.severity);
      const diagnostics = findings.map((f) => findingToDiagnostic(f, currentDoc));
      diagnosticCollection.set(uri, diagnostics);
      updateStatusBar('done', findings.length);
      outputChannel.appendLine(`[${fileName}] ${findings.length} finding(s), ${(msg.irNodes ?? []).length} IR nodes (${lang})`);

      const result: McpReviewResult = {
        fileName,
        filePath,
        findings,
        irNodes: msg.irNodes ?? [],
        lang,
      };
      sidebarProvider.update(result);
    } else if (msg.type === 'error') {
      // Log error but don't show "not MCP" — worker may still send a result after partial errors
      outputChannel.appendLine(`[${fileName}] Analysis warning: ${msg.message}`);
    }
  });

  worker.on('error', (err) => {
    clearTimeout(timeout);
    activeWorkers.delete(key);
    updateStatusBar('error', 0);
    outputChannel.appendLine(`[${fileName}] Worker crash: ${err.message}`);
    outputChannel.show();
  });
}

function updateStatusBar(state: 'idle' | 'analyzing' | 'done' | 'error', count: number): void {
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
      statusBarItem.text = count > 0 ? `$(warning) KERN MCP: ${count}` : '$(check) KERN MCP';
      statusBarItem.tooltip = count > 0 ? `${count} finding(s) — click to view` : 'No findings';
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
  for (const worker of activeWorkers.values()) {
    worker.terminate();
  }
  activeWorkers.clear();
}
