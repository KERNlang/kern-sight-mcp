import * as vscode from 'vscode';
import * as path from 'path';
import type { ReviewFinding } from '@kernlang/review-mcp';
import { McpSecuritySidebarProvider } from './review-panel';
import type { McpReviewResult } from './review-panel';
import { McpSecurityCodeActionProvider, SAFE_AUTOFIXES, PYTHON_AUTOFIXES, ALL_AUTOFIX_RULES } from './code-actions';
import { initConfig, getConfig } from './config';
import type { SecurityScore } from '@kernlang/review-mcp';
import { ConfigGuardian } from './config-guardian';
import { parse, resolveConfig, KernParseError } from '@kernlang/core';
import { transpileMCP, transpileMCPPython } from '@kernlang/mcp';
import { reviewMCPSource } from '@kernlang/review-mcp';
import { McpClient } from './mcp-client';
import { detectEngines, generateWithEngine } from './ai-provider';
import type { AIEngine } from './ai-provider';
import { scanWorkspaceContext } from './context-scanner';
import type { ContextItem } from './context-scanner';
import { REVIEW_DEBOUNCE_MS, SCAN_TIMEOUT_MS } from './constants';
import { recordScore } from './score-history';
import type { ScoreDiff } from './score-history';
import { generateTestSuites, renderTestFile } from './test-generator';

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
let compiledUris = new Set<string>(); // URIs of compiled output docs — skip auto-review (capped at 100)
const MAX_COMPILED_URIS = 100;
let mcpCrashCount = 0;

function trackCompiledUri(uri: string): void {
  if (compiledUris.size >= MAX_COMPILED_URIS) {
    // Evict oldest (first inserted) entry
    const first = compiledUris.values().next().value;
    if (first) compiledUris.delete(first);
  }
  compiledUris.add(uri);
}
let scannedContext: ContextItem[] = [];
let mcpClient: McpClient;
let workspaceState: vscode.Memento;

export function activate(context: vscode.ExtensionContext): void {
  try {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('kernMcpSecurity');
    outputChannel = vscode.window.createOutputChannel('KERN MCP Security');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    statusBarItem.command = 'kernMcpSecurity.showOutput';
    statusBarItem.show();
    updateStatusBar('idle', 0);
    workspaceState = context.workspaceState;

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

    sidebarProvider.onCompileRequested = (target) => {
      void compileKern(target);
    };

    sidebarProvider.onValidateRequested = () => {
      void validateKern();
    };

    sidebarProvider.onCreateKernRequested = () => {
      void showGenerateMode();
    };

    sidebarProvider.onScanContextRequested = () => {
      void showGenerateMode();
    };

    sidebarProvider.onImportToKernRequested = () => {
      void importToKern();
    };

    sidebarProvider.onConvertTargetRequested = () => {
      void convertMCPTarget();
    };

    sidebarProvider.onModeChanged = (mode) => {
      if (mode === 'build') {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'kern') {
          showBuildModeForEditor(editor);
        } else if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
          const lang = editor.document.languageId === 'python' ? 'python' as const : 'typescript' as const;
          sidebarProvider.showImportMode(path.basename(editor.document.fileName), lang);
        } else {
          void showGenerateMode();
        }
      } else {
        const editor = vscode.window.activeTextEditor;
        if (editor && SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
          void reviewDocument(editor.document);
        } else {
          sidebarProvider.showNotMcp();
        }
      }
    };

    sidebarProvider.onGenerateRequested = (description, contextIds, engineId) => {
      void generateKernServer(description, contextIds, engineId);
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
        if (!editor) return;
        if (editor.document.languageId === 'kern') {
          updateStatusBar('kern', 0);
          showBuildModeForEditor(editor);
        } else if (SUPPORTED_LANGUAGES.has(editor.document.languageId)) {
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
        const { scanWorkspace, generateReportJSON, updateReadme } = require('@kernlang/review-mcp') as typeof import('@kernlang/review-mcp');
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

    // ── .kern Build Commands ──────────────────────────────────────────────

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.compileMCP', () => {
        void compileKern('typescript');
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.compileMCPPython', () => {
        void compileKern('python');
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.validateKern', () => {
        void validateKern();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.generateMCP', () => {
        void showGenerateMode();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.importToKern', () => {
        void importToKern();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('kernMcpSecurity.convertTarget', () => {
        void convertMCPTarget();
      }),
      vscode.commands.registerCommand('kernMcpSecurity.newKernFromTemplate', () => {
        void createKernTemplate(context.extensionUri);
      }),
      vscode.commands.registerCommand('kernMcpSecurity.generateSecurityTests', () => {
        void generateSecurityTests();
      }),
    );

    context.subscriptions.push(diagnosticCollection, outputChannel, statusBarItem);

    // Auto-scan on open, change, save — skip compiled output docs
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (compiledUris.has(doc.uri.toString())) return;
        if (doc.languageId === 'kern') { scheduleKernValidation(doc); }
        else { scheduleReview(doc); }
      }),
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (compiledUris.has(e.document.uri.toString())) return;
        if (e.document.languageId === 'kern') { scheduleKernValidation(e.document); }
        else { scheduleReview(e.document); }
      }),
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (compiledUris.has(doc.uri.toString())) return;
        if (doc.languageId === 'kern') { void validateKernDocument(doc); }
        else { void reviewDocument(doc); }
      }),
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        diagnosticCollection.delete(doc.uri);
        const key = doc.uri.toString();
        activeRequests.delete(key);
        compiledUris.delete(key);
        const timer = debounceTimers.get(key);
        if (timer) clearTimeout(timer);
        debounceTimers.delete(key);
      }),
    );

    // Prime the sidebar for active editor
    const primeEditor = vscode.window.activeTextEditor;
    if (primeEditor) {
      if (primeEditor.document.languageId === 'kern') {
        showBuildModeForEditor(primeEditor);
      } else if (SUPPORTED_LANGUAGES.has(primeEditor.document.languageId)) {
        void reviewDocument(primeEditor.document);
      }
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
  }, REVIEW_DEBOUNCE_MS));
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

  // Skip files too large for review — prevents memory spikes and subprocess timeouts
  const MAX_REVIEW_BYTES = 500_000; // 500KB
  if (Buffer.byteLength(source) > MAX_REVIEW_BYTES) {
    outputChannel.appendLine(`[${path.basename(filePath)}] Skipped — file exceeds ${MAX_REVIEW_BYTES / 1000}KB review limit`);
    return;
  }
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
    const result = await mcpClient.callTool(source, filePath, SCAN_TIMEOUT_MS);

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
      const scoreDiff = result.score ? recordScore(workspaceState, filePath, result.score) : null;
      sidebarProvider.update(reviewResult, scoreDiff);
    }
  } catch (err) {
    // If superseded, silently ignore
    if (activeRequests.get(key) !== requestId) return;

    if (isActiveDocument(key)) {
      updateStatusBar('error', 0);
    }
    outputChannel.appendLine(`[${fileName}] Analysis failed: ${err instanceof Error ? err.message : String(err)}`);

    // Restart server if it crashed — with exponential backoff to prevent crash loops
    if (!mcpClient.isRunning()) {
      mcpCrashCount++;
      const maxRetries = 5;
      if (mcpCrashCount > maxRetries) {
        outputChannel.appendLine(`[MCP Server] Too many crashes (${mcpCrashCount}) — disabled. Reload window to retry.`);
      } else {
        const backoffMs = Math.min(1000 * Math.pow(2, mcpCrashCount - 1), 30_000);
        outputChannel.appendLine(`[MCP Server] Crashed (${mcpCrashCount}/${maxRetries}) — restarting in ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
        try {
          await mcpClient.restart();
          outputChannel.appendLine('[MCP Server] Restarted successfully');
          mcpCrashCount = 0; // Reset on successful restart
        } catch (restartErr) {
          outputChannel.appendLine(`[MCP Server] Restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`);
        }
      }
    }
  }
}

function updateStatusBar(state: 'idle' | 'analyzing' | 'done' | 'error' | 'kern' | 'building' | 'built', count: number, grade?: string): void {
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
    case 'kern':
      statusBarItem.text = '$(file-code) KERN Build';
      statusBarItem.tooltip = 'KERN file — right-click to compile';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'building':
      statusBarItem.text = '$(sync~spin) KERN Build';
      statusBarItem.tooltip = 'Compiling .kern...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'built':
      statusBarItem.text = grade
        ? `$(shield) KERN Built: ${grade}`
        : count > 0 ? `$(warning) KERN Built: ${count}` : '$(check) KERN Built';
      statusBarItem.tooltip = grade
        ? `Compiled — Score: ${grade} — ${count} finding(s)`
        : count > 0 ? `Compiled — ${count} finding(s)` : 'Compiled — no findings';
      statusBarItem.backgroundColor = undefined;
      break;
  }
}

function filterFindings(findings: ReviewFinding[], filter: string): ReviewFinding[] {
  if (filter === 'errors') return findings.filter((f) => f.severity === 'error');
  if (filter === 'warnings') return findings.filter((f) => f.severity !== 'info');
  return findings;
}

// ── Handler Safety Scan ────────────────────────────────────────────────
// Guards protect inputs, but handler code runs arbitrary logic. Warn about
// obvious dangerous patterns inside <<<>>> blocks.
const HANDLER_DANGER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(exec|execSync|spawn|spawnSync)\s*\(/, label: 'shell command execution' },
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bFunction\s*\(/, label: 'Function() constructor' },
  { pattern: /\bchild_process\b/, label: 'child_process import' },
  { pattern: /\bprocess\.env\b/, label: 'direct env access (use guard type=auth instead)' },
  { pattern: /\brm\s+-rf\b/, label: 'recursive delete' },
  { pattern: /\bos\.system\s*\(/, label: 'os.system() (Python)' },
  { pattern: /\bsubprocess\.(run|call|Popen)\s*\(/, label: 'subprocess call (Python)' },
];

function scanHandlerBlocks(source: string): string[] {
  const warnings: string[] = [];
  const handlerRegex = /<<<([\s\S]*?)>>>/g;
  let match: RegExpExecArray | null;
  while ((match = handlerRegex.exec(source)) !== null) {
    const handlerCode = match[1];
    for (const { pattern, label } of HANDLER_DANGER_PATTERNS) {
      if (pattern.test(handlerCode)) {
        const beforeHandler = source.slice(0, match.index);
        const line = beforeHandler.split('\n').length;
        warnings.push(`Line ~${line}: handler contains ${label} — guards cannot prevent this`);
      }
    }
  }
  return warnings;
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

// ── .kern Sidebar Integration ─────────────────────────────────────────

function showBuildModeForEditor(editor: vscode.TextEditor): void {
  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  try {
    parse(source);
    sidebarProvider.showBuildMode(fileName, true);
  } catch (err) {
    const msg = err instanceof KernParseError ? err.message : (err instanceof Error ? err.message : String(err));
    sidebarProvider.showBuildMode(fileName, false, msg);
  }
}

let detectedEngines: AIEngine[] = [];

async function showGenerateMode(): Promise<void> {
  scannedContext = await scanWorkspaceContext();
  detectedEngines = await detectEngines();
  sidebarProvider.showGenerateMode(
    scannedContext.map(c => ({ id: c.id, label: c.label, category: c.category, preview: c.preview })),
    detectedEngines,
  );
}

async function generateKernServer(description: string, selectedContextIds: string[], engineId?: string): Promise<void> {
  if (!description.trim()) {
    vscode.window.showWarningMessage('Describe what MCP server you want to build');
    return;
  }

  sidebarProvider.showGenerating();
  updateStatusBar('building', 0);

  const engine = engineId || detectedEngines.find(e => e.available)?.id || 'api';

  try {
    const selectedContext = scannedContext.filter(c => selectedContextIds.includes(c.id));
    const contextBlock = selectedContext.length > 0
      ? `\n\n## Project Context\n\n${selectedContext.map(c => `### ${c.label}\n\`\`\`\n${c.content}\n\`\`\``).join('\n\n')}`
      : '';

    const systemPrompt = `You are a KERN (.kern) MCP server generator. You write production-ready .kern code that compiles to secure MCP servers.

${KERN_MCP_SYNTAX}`;

    const userPrompt = `Build an MCP server for:\n\n${description}${contextBlock}`;

    const generated = await generateWithEngine(engine, systemPrompt, userPrompt, (msg) => outputChannel.appendLine(msg));

    // Clean up — remove markdown fences if the LLM wrapped them
    const cleaned = generated
      .replace(/^```(?:kern)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();

    // Open generated .kern in editor
    const doc = await vscode.workspace.openTextDocument({
      content: cleaned,
      language: 'kern',
    });
    await vscode.window.showTextDocument(doc);

    updateStatusBar('kern', 0);
    outputChannel.appendLine(`[AI] Generated .kern server (${cleaned.split('\n').length} lines)`);

    // Show build mode for the generated file
    try {
      parse(cleaned);
      sidebarProvider.showBuildMode(
        'Generated Server',
        true,
      );
    } catch {
      sidebarProvider.showBuildMode(
        'Generated Server',
        false,
        'Generated code has syntax errors — edit and fix, then compile',
      );
    }
  } catch (err) {
    updateStatusBar('error', 0);
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[AI] Generation failed: ${msg}`);
    const engineLabel = detectedEngines.find(e => e.id === engine)?.label ?? engine;
    sidebarProvider.showGenerateError(msg, engineLabel);
  }
}

// ── Shared .kern syntax reference (single source of truth for all AI prompts) ──
const KERN_MCP_SYNTAX = `## KERN MCP Syntax
\`\`\`kern
mcp name=ServerName version=1.0

  tool name=toolName
    description text="What the tool does"
    param name=paramName type=string required=true
    param name=optionalParam type=number default=50
    guard type=sanitize param=paramName
    guard type=pathContainment param=filePath allowlist=/data,/home
    guard type=validate param=count min=1 max=100
    guard type=auth envVar=API_KEY header=authorization
    guard type=rateLimit window=60000 requests=100
    guard type=sizeLimit param=data max=1048576
    handler <<<
      // handler code — runs inside async function with \`args\` (validated params)
      return { content: [{ type: "text", text: "result" }] };
    >>>

  resource name=resourceName uri="scheme://path"
    description text="What the resource provides"
    handler <<<
      return { contents: [{ uri: uri.href, text: "content" }] };
    >>>

  prompt name=promptName
    description text="What the prompt does"
    param name=arg type=string required=true
    handler <<<
      return { messages: [{ role: "user", content: { type: "text", text: args.arg } }] };
    >>>
\`\`\`

## Guard Types (7 available — compiler auto-injects these into compiled output)
- \`sanitize\` — strip dangerous characters from string params
- \`pathContainment\` — enforce file paths stay within allowlist directories
- \`validate\` — min/max/regex bounds on params
- \`auth\` — bootstrap check: verifies env var exists (add real token verification for production)
- \`rateLimit\` — limit calls per time window
- \`sizeLimit\` — cap input size in bytes
- \`sanitizeOutput\` — strip prompt-injection patterns from responses

## .kern Rules
- Indent: 2 spaces (strict)
- Every tool MUST have at least one guard
- Every tool MUST have a description
- Handlers use <<< >>> delimiters
- For path params, ALWAYS add guard type=pathContainment
- For string params, ALWAYS add guard type=sanitize
- Add guard type=auth for sensitive operations
- Add guard type=rateLimit for public-facing tools
- Return ONLY .kern code. No explanation, no markdown fences, no commentary. NOTHING outside valid .kern syntax.`;

const IMPORT_SYSTEM_PROMPT = `You convert existing MCP server code (TypeScript or Python) into KERN (.kern) format.

${KERN_MCP_SYNTAX}

## Import-Specific Rules
- Extract ALL tools, resources, and prompts from the source code
- INLINE all helper functions, utilities, and external references directly into each handler. Do NOT reference functions defined outside the handler block — the compiled output will not have them
- INLINE all data structures (objects, arrays, maps, configs) that handlers reference
- Handler code is JavaScript/TypeScript — use Node.js APIs (fs, path, fetch) directly

## CRITICAL: Guard Injection — Analyze Effects and Add Matching Guards
The ENTIRE POINT of importing to .kern is to ADD security guards. Analyze each handler's code for dangerous effects and add the correct guard type:
- File reads/writes (readFile, readFileSync, writeFile, readdir, etc.) → add \`guard type=pathContainment param=PARAM baseDir="./SAFE_DIR"\`
- Shell execution (exec, spawn, execSync, child_process) → add \`guard type=sanitize param=PARAM\` on ALL params flowing to the command
- Network requests (fetch, http.request, axios) → add \`guard type=validate param=PARAM pattern="^https://ALLOWED_DOMAIN/"\`
- Database queries (query, execute, run) → add \`guard type=sanitize param=PARAM\` on ALL params used in queries
- For ALL string params: add \`guard type=sanitize param=PARAM\`
- For ALL tools with external effects: add \`guard type=rateLimit window=60000 requests=100\`
- If the server uses HTTP/SSE transport: add \`guard type=auth\` on sensitive tools
- Add \`guard type=sanitizeOutput\` on tools that return external data to the LLM
Do NOT just add a single sanitize guard and call it done. Each effect type needs its specific guard.`;

async function importToKern(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open an MCP server file to import');
    return;
  }

  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);
  const lang = editor.document.languageId;

  if (!detectedEngines.length) detectedEngines = await detectEngines();
  const engine = detectedEngines.find(e => e.available)?.id || 'api';

  sidebarProvider.showGenerating();
  updateStatusBar('building', 0);

  try {
    const userPrompt = `Convert this ${lang === 'python' ? 'Python' : 'TypeScript'} MCP server to .kern:\n\n${source}`;
    const generated = await generateWithEngine(engine, IMPORT_SYSTEM_PROMPT, userPrompt, (msg) => outputChannel.appendLine(msg));

    const cleaned = generated.replace(/^```(?:kern)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

    const doc = await vscode.workspace.openTextDocument({ content: cleaned, language: 'kern' });
    await vscode.window.showTextDocument(doc);

    updateStatusBar('kern', 0);
    outputChannel.appendLine(`[Import] ${fileName} → .kern (${cleaned.split('\n').length} lines)`);

    try {
      const ast = parse(cleaned);
      const tools = (ast.children ?? []).filter(n => n.type === 'tool');
      const warnings: string[] = [];

      // Check each tool for: no guards at all, or file I/O without pathContainment
      for (const tool of tools) {
        const name = (tool.props?.name as string) || 'unnamed';
        const guards = (tool.children ?? []).filter(c => c.type === 'guard');
        const handler = (tool.children ?? []).find(c => c.type === 'handler');
        const handlerCode = (handler?.props?.code as string) || '';

        if (guards.length === 0) {
          warnings.push(`${name}: no guards`);
          continue;
        }

        const guardKinds = new Set(guards.map(g => (g.props?.type as string) || ''));
        const hasPathContainment = guardKinds.has('pathContainment');
        const hasSanitizeOutput = guardKinds.has('sanitizeOutput');

        const hasSanitize = guardKinds.has('sanitize');

        // Detect file I/O without pathContainment
        if (!hasPathContainment && /\b(readFile|readFileSync|writeFile|writeFileSync|readdir|readdirSync|unlink|unlinkSync|createReadStream|createWriteStream)\b/.test(handlerCode)) {
          warnings.push(`${name}: file I/O without pathContainment guard`);
        }

        // Detect shell execution without sanitize
        if (!hasSanitize && /\b(execSync|execFile|execFileSync|spawn|spawnSync|child_process)\b/.test(handlerCode)) {
          warnings.push(`${name}: shell execution without sanitize guard`);
        }

        // Detect database queries without sanitize
        if (!hasSanitize && /\b(\.query|\.execute|\.run)\s*\(/.test(handlerCode)) {
          warnings.push(`${name}: database query without sanitize guard`);
        }

        // Detect external data returned without sanitizeOutput
        if (!hasSanitizeOutput && /\b(fetch|http\.request|axios|got\.get|got\.post|got\.put)\b/.test(handlerCode)) {
          warnings.push(`${name}: returns external data without sanitizeOutput guard`);
        }
      }

      if (warnings.length > 0) {
        outputChannel.appendLine(`[Import] Guard warnings:\n  ${warnings.join('\n  ')}`);
        sidebarProvider.showBuildMode(`${fileName} → .kern`, true,
          `${warnings.length} guard issue(s) — review before compiling: ${warnings.join('; ')}`);
      } else {
        sidebarProvider.showBuildMode(`${fileName} → .kern`, true);
      }
    } catch {
      sidebarProvider.showBuildMode(`${fileName} → .kern`, false, 'Imported code has syntax issues — review and fix, then compile');
    }
  } catch (err) {
    updateStatusBar('error', 0);
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Import] Failed: ${msg}`);
    const engineLabel = detectedEngines.find(e => e.id === engine)?.label ?? engine;
    sidebarProvider.showGenerateError(msg, engineLabel);
  }
}

async function convertMCPTarget(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open an MCP server file to convert');
    return;
  }

  const lang = editor.document.languageId;
  const isPython = lang === 'python';
  const targetLabel = isPython ? 'TypeScript' : 'Python';
  const target: 'typescript' | 'python' = isPython ? 'typescript' : 'python';

  const pick = await vscode.window.showQuickPick(
    [`Convert to ${targetLabel} via .kern (Beta)`, 'Import to .kern only (Beta)'],
    { placeHolder: `Convert this ${isPython ? 'Python' : 'TypeScript'} MCP server — AI imports to .kern, compiler injects security guards` },
  );

  if (!pick) return;

  if (pick.startsWith('Import')) {
    return importToKern();
  }

  // Two-step conversion: AI → .kern → compile → secure target code
  // Step 1: Import to .kern with handlers written in the TARGET language
  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  if (!detectedEngines.length) detectedEngines = await detectEngines();
  const engine = detectedEngines.find(e => e.available)?.id || 'api';

  sidebarProvider.showGenerating();
  updateStatusBar('building', 0);

  try {
    const targetLangFull = isPython ? 'TypeScript' : 'Python';
    const sourceLangFull = isPython ? 'Python' : 'TypeScript';

    // Import prompt, but with instruction to write handlers in target language
    const convertImportPrompt = IMPORT_SYSTEM_PROMPT + `\n\nIMPORTANT: Write all handler code in ${targetLangFull}, NOT ${sourceLangFull}. ` +
      `Translate the handler logic to idiomatic ${targetLangFull} while extracting the .kern structure.` +
      (target === 'python' ? '\nTag each handler with lang=python.' : '');

    const userPrompt = `Convert this ${sourceLangFull} MCP server to .kern (with ${targetLangFull} handlers):\n\n${source}`;
    const generated = await generateWithEngine(engine, convertImportPrompt, userPrompt, (msg) => outputChannel.appendLine(msg));
    const kernCode = generated.replace(/^```(?:kern)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

    // Show .kern intermediate
    const kernDoc = await vscode.workspace.openTextDocument({ content: kernCode, language: 'kern' });
    await vscode.window.showTextDocument(kernDoc);

    outputChannel.appendLine(`[Convert] Step 1: ${fileName} → .kern (${kernCode.split('\n').length} lines)`);

    // Step 2: Compile .kern → target language with security guards
    const ast = parse(kernCode);

    // Verify Python handlers are tagged — AI may not consistently add lang=python
    if (target === 'python') {
      const tools = (ast.children ?? []).filter(n => n.type === 'tool');
      const handlers = tools.flatMap(t => (t.children ?? []).filter(c => c.type === 'handler'));
      const untagged = handlers.filter(h => {
        const lang = h.props?.lang as string | undefined;
        return !lang || (lang !== 'python' && lang !== 'py');
      });
      if (untagged.length > 0) {
        outputChannel.appendLine(`[Convert] Warning: ${untagged.length} handler(s) missing lang=python tag — Python transpiler may produce empty handlers. Review the .kern file.`);
      }
    }

    const config = resolveConfig({ target: 'mcp' });
    const result = target === 'python'
      ? transpileMCPPython(ast, config)
      : transpileMCP(ast, config);

    const compiledFileName = target === 'python'
      ? fileName.replace(/\.\w+$/, '-converted.py')
      : fileName.replace(/\.\w+$/, '-converted.ts');

    const compiledDoc = await vscode.workspace.openTextDocument({
      content: result.code,
      language: target === 'python' ? 'python' : 'typescript',
    });
    trackCompiledUri(compiledDoc.uri.toString());
    await vscode.window.showTextDocument(compiledDoc, vscode.ViewColumn.Beside, true);

    outputChannel.appendLine(`[Convert] Step 2: .kern → ${compiledFileName} (${result.tsTokenCount} tokens, compiled with security guards)`);

    // Auto-review using full pipeline
    let findings: ReviewFinding[] = [];
    let irNodes: IRNode[] = [];
    let score: SecurityScore | undefined;
    try {
      const reviewResult = await mcpClient.callTool(result.code, compiledFileName, 10000);
      findings = reviewResult.findings ?? [];
      irNodes = (reviewResult.irNodes ?? []) as IRNode[];
      score = reviewResult.score;
    } catch {
      findings = reviewMCPSource(result.code, compiledFileName);
    }

    const diagnostics = findings.map((f) => findingToDiagnostic(f, compiledDoc));
    diagnosticCollection.set(compiledDoc.uri, diagnostics);

    outputChannel.appendLine(`[Convert] Auto-review: ${findings.length} finding(s)${score ? `, score: ${score.total} (${score.grade})` : ''}`);
    updateStatusBar('built', findings.length, score?.grade);

    const buildResult: import('./review-panel').McpReviewResult = {
      fileName: compiledFileName,
      filePath: compiledDoc.uri.toString(),
      findings,
      irNodes,
      lang: target === 'python' ? 'python' : 'typescript',
      score,
    };
    sidebarProvider.showBuildResult(buildResult, fileName);

    if (findings.length === 0) {
      vscode.window.showInformationMessage(`${fileName} converted via .kern → ${targetLabel} — no security findings`);
    } else {
      const errors = findings.filter(f => f.severity === 'error').length;
      const warnings = findings.filter(f => f.severity === 'warning').length;
      vscode.window.showWarningMessage(`${fileName} converted — ${errors} error(s), ${warnings} warning(s)`);
    }
  } catch (err) {
    updateStatusBar('error', 0);
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof KernParseError) {
      outputChannel.appendLine(`[Convert] .kern parse error: ${msg} — review the .kern file and fix, then compile manually`);
      sidebarProvider.showBuildMode(`${fileName} → .kern`, false, 'AI-generated .kern has syntax issues — review and fix, then compile');
    } else {
      outputChannel.appendLine(`[Convert] Failed: ${msg}`);
      const engineLabel = detectedEngines.find(e => e.id === engine)?.label ?? engine;
      sidebarProvider.showGenerateError(msg, engineLabel);
    }
  }
}

const KERN_TEMPLATES: { label: string; description: string; file: string }[] = [
  { label: 'Minimal', description: 'Hello world — single tool with sanitize guard', file: 'minimal.kern' },
  { label: 'Database CRUD', description: 'List, get, create, delete with auth + rate limiting', file: 'crud-database.kern' },
  { label: 'File Server', description: 'Read, write, list with path containment guards', file: 'file-server.kern' },
  { label: 'API Proxy', description: 'Fetch + POST to allowed endpoints with SSRF protection', file: 'api-proxy.kern' },
  { label: 'Search', description: 'Paginated search with sanitization + rate limiting', file: 'search.kern' },
  { label: 'Webhook Receiver', description: 'Incoming webhooks with HMAC auth + size limits', file: 'webhook.kern' },
];

async function createKernTemplate(extensionUri: vscode.Uri): Promise<void> {
  const picked = await vscode.window.showQuickPick(KERN_TEMPLATES, {
    placeHolder: 'Choose a .kern template',
  });
  if (!picked) return;

  const templateUri = vscode.Uri.joinPath(extensionUri, 'templates', picked.file);
  try {
    const content = Buffer.from(await vscode.workspace.fs.readFile(templateUri)).toString('utf-8');
    const doc = await vscode.workspace.openTextDocument({ content, language: 'kern' });
    await vscode.window.showTextDocument(doc);
  } catch {
    // Fallback to inline minimal template if templates dir is missing
    const doc = await vscode.workspace.openTextDocument({
      content: 'mcp name=MyServer version=1.0\n\n  tool name=hello\n    description text="Say hello"\n    param name=name type=string required=true\n    guard type=sanitize param=name\n    handler <<<\n      return { content: [{ type: "text", text: `Hello, ${args.name}!` }] };\n    >>>\n',
      language: 'kern',
    });
    await vscode.window.showTextDocument(doc);
  }
}

// ── Security Test Generation ─────────────────────────────────────────

async function generateSecurityTests(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'kern') {
    vscode.window.showWarningMessage('Open a .kern file to generate security tests');
    return;
  }

  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName, '.kern');

  try {
    const ast = parse(source);
    const suites = generateTestSuites(ast);

    if (suites.length === 0) {
      vscode.window.showWarningMessage('No tools found in .kern file');
      return;
    }

    const totalCases = suites.reduce((sum, s) => sum + s.cases.length, 0);
    const testCode = renderTestFile(suites, `./${fileName}`);

    const doc = await vscode.workspace.openTextDocument({ content: testCode, language: 'typescript' });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

    outputChannel.appendLine(`[TestGen] Generated ${totalCases} test cases for ${suites.length} tool(s)`);
    vscode.window.showInformationMessage(`Generated ${totalCases} security tests for ${suites.length} tool(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[TestGen] Failed: ${msg}`);
    vscode.window.showErrorMessage(`Test generation failed: ${msg}`);
  }
}

// ── .kern Validation ──────────────────────────────────────────────────

function scheduleKernValidation(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    void validateKernDocument(document);
  }, REVIEW_DEBOUNCE_MS));
}

function validateKernDocument(document: vscode.TextDocument): void {
  const source = document.getText();
  const fileName = path.basename(document.uri.fsPath);

  try {
    parse(source);
    diagnosticCollection.set(document.uri, []);
    updateStatusBar('kern', 0);
    sidebarProvider.showBuildMode(fileName, true);
  } catch (err) {
    if (err instanceof KernParseError) {
      const line = Math.max(0, err.line - 1);
      const col = Math.max(0, err.col - 1);
      const range = new vscode.Range(line, col, line, document.lineAt(line).text.length);
      diagnosticCollection.set(document.uri, [
        new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error),
      ]);
      updateStatusBar('error', 1);
      sidebarProvider.showBuildMode(fileName, false, err.message);
      outputChannel.appendLine(`[Validate] ${fileName} — ${err.message}`);
    }
  }
}

// ── .kern Build Pipeline ──────────────────────────────────────────────

async function compileKern(target: 'typescript' | 'python'): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'kern') {
    vscode.window.showWarningMessage('Open a .kern file to compile');
    return;
  }

  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  updateStatusBar('building', 0);
  sidebarProvider.showCompiling(fileName, target === 'python' ? 'Python' : 'TypeScript');

  try {
    const ast = parse(source);

    // Warn about dangerous patterns in handler blocks — guards protect inputs,
    // but can't control what handler code does with them.
    const handlerWarnings = scanHandlerBlocks(source);
    if (handlerWarnings.length > 0) {
      for (const w of handlerWarnings) {
        outputChannel.appendLine(`[Build] Handler warning: ${w}`);
      }
      vscode.window.showWarningMessage(
        `${handlerWarnings.length} handler safety warning(s) — check output channel`,
      );
    }

    const config = resolveConfig({ target: 'mcp' });
    const result = target === 'python'
      ? transpileMCPPython(ast, config)
      : transpileMCP(ast, config);

    const lang = target === 'python' ? 'python' : 'typescript';
    const compiledFileName = target === 'python'
      ? fileName.replace(/\.kern$/, '-server.py')
      : fileName.replace(/\.kern$/, '-server.ts');

    // Show compiled output in side editor — track URI to prevent auto-review race
    const doc = await vscode.workspace.openTextDocument({
      content: result.code,
      language: lang,
    });
    trackCompiledUri(doc.uri.toString());
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);

    outputChannel.appendLine(`[Build] ${fileName} → ${compiledFileName} (${result.tsTokenCount} tokens, ${target})`);

    // Auto-review the compiled output using the same full pipeline as REVIEW mode
    // (detect → review → infer IR → compute score) for consistent findings.
    let findings: ReviewFinding[] = [];
    let irNodes: IRNode[] = [];
    let score: SecurityScore | undefined;
    try {
      const reviewResult = await mcpClient.callTool(result.code, compiledFileName, 10000);
      findings = reviewResult.findings ?? [];
      irNodes = (reviewResult.irNodes ?? []) as IRNode[];
      score = reviewResult.score;
    } catch {
      // Fallback to in-process review if subprocess unavailable
      findings = reviewMCPSource(result.code, compiledFileName);
    }

    const diagnostics = findings.map((f) => findingToDiagnostic(f, doc));
    diagnosticCollection.set(doc.uri, diagnostics);

    outputChannel.appendLine(`[Build] Auto-review: ${findings.length} finding(s)${score ? `, score: ${score.total} (${score.grade})` : ''}`);

    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    updateStatusBar('built', findings.length, score?.grade);

    // Update sidebar with build result + breadcrumb
    const buildResult: import('./review-panel').McpReviewResult = {
      fileName: compiledFileName,
      filePath: doc.uri.toString(),
      findings,
      irNodes,
      lang: target === 'python' ? 'python' : 'typescript',
      score,
    };
    sidebarProvider.showBuildResult(buildResult, fileName);

    if (findings.length === 0) {
      vscode.window.showInformationMessage(`${fileName} compiled — no security findings`);
    } else {
      vscode.window.showWarningMessage(
        `${fileName} compiled — ${errors} error(s), ${warnings} warning(s)`,
      );
    }
  } catch (err) {
    updateStatusBar('error', 0);
    if (err instanceof KernParseError) {
      outputChannel.appendLine(`[Build] Parse error: ${err.message}`);
      vscode.window.showErrorMessage(`Parse error: ${err.message}`);

      // Show parse error as diagnostic on the .kern file
      const line = Math.max(0, err.line - 1);
      const col = Math.max(0, err.col - 1);
      const range = new vscode.Range(line, col, line, editor.document.lineAt(line).text.length);
      diagnosticCollection.set(editor.document.uri, [
        new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error),
      ]);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[Build] Failed: ${msg}`);
      vscode.window.showErrorMessage(`Compile failed: ${msg}`);
    }
  }
}

async function validateKern(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'kern') {
    vscode.window.showWarningMessage('Open a .kern file to validate');
    return;
  }

  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  try {
    parse(source);
    diagnosticCollection.set(editor.document.uri, []);
    outputChannel.appendLine(`[Validate] ${fileName} — valid`);
    vscode.window.showInformationMessage(`${fileName} — valid .kern syntax`);
  } catch (err) {
    if (err instanceof KernParseError) {
      const line = Math.max(0, err.line - 1);
      const col = Math.max(0, err.col - 1);
      const range = new vscode.Range(line, col, line, editor.document.lineAt(line).text.length);
      diagnosticCollection.set(editor.document.uri, [
        new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error),
      ]);
      outputChannel.appendLine(`[Validate] ${fileName} — ${err.message}`);
      vscode.window.showErrorMessage(`${fileName}: ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[Validate] ${fileName} — ${msg}`);
      vscode.window.showErrorMessage(`Validation failed: ${msg}`);
    }
  }
}

export function deactivate(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  activeRequests.clear();
  compiledUris.clear();
  mcpClient?.stop();
}

/** Reset mutable extension state between test runs. */
export function _resetForTesting(): void {
  debounceTimers.clear();
  activeRequests.clear();
  compiledUris.clear();
  scannedContext = [];
}
