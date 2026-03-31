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
let compiledUris = new Set<string>(); // URIs of compiled output docs — skip auto-review
let scannedContext: ContextItem[] = [];
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

## KERN MCP Syntax
\`\`\`kern
mcp name=ServerName version=1.0

  tool name=toolName
    description text="What the tool does"
    param name=paramName type=string required=true
    param name=optionalParam type=number default=50
    guard type=sanitize param=paramName
    guard type=pathContainment param=filePath allowlist=/data,/home
    guard type=validate param=count min=1 max=100
    guard type=auth env=API_KEY
    guard type=rateLimit window=60000 requests=100
    guard type=sizeLimit param=data max=1048576
    handler <<<
      // handler code here
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

## Rules
- Indent: 2 spaces (strict)
- Every tool MUST have at least one guard (sanitize, validate, pathContainment, auth, rateLimit, or sizeLimit)
- Every tool MUST have a description
- Handlers use <<< >>> delimiters
- Handler code runs inside an async function with \`args\` (validated params) available
- Return MCP-format results: { content: [{ type: "text", text: "..." }] }
- For path params, ALWAYS add guard type=pathContainment
- For string params, ALWAYS add guard type=sanitize
- Add guard type=auth for sensitive operations
- Add guard type=rateLimit for public-facing tools

## Output
Return ONLY the .kern code. No explanation, no markdown fences, no preamble, no commentary, no confidence notes. Just the .kern source. NOTHING outside valid .kern syntax.`;

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

const IMPORT_SYSTEM_PROMPT = `You convert existing MCP server code (TypeScript or Python) into KERN (.kern) format.

## KERN MCP Syntax
\`\`\`kern
mcp name=ServerName version=1.0

  tool name=toolName
    description text="What the tool does"
    param name=paramName type=string required=true
    guard type=sanitize param=paramName
    guard type=validate param=count min=1 max=100
    guard type=auth env=API_KEY
    guard type=rateLimit window=60000 requests=100
    handler <<<
      // handler code
      return { content: [{ type: "text", text: "result" }] };
    >>>

  resource name=resourceName uri="scheme://path"
    description text="Description"
    handler <<<
      return { contents: [{ uri: uri.href, text: "content" }] };
    >>>

  prompt name=promptName
    description text="Description"
    param name=arg type=string required=true
    handler <<<
      return { messages: [{ role: "user", content: { type: "text", text: args.arg } }] };
    >>>
\`\`\`

## Rules
- Indent: 2 spaces (strict)
- Extract ALL tools, resources, and prompts from the source code
- Add guards: sanitize for strings, validate for numbers, pathContainment for paths, auth where applicable
- If the source has no guards, ADD appropriate ones — this is the whole point of importing
- INLINE all helper functions, utilities, and external references directly into each handler. Do NOT reference functions defined outside the handler block — the compiled output will not have them. If the original code calls a helper like loadDocument(), readFile(), fetchData(), etc., put that logic directly inside the handler <<<>>>
- INLINE all data structures (objects, arrays, maps, configs) that handlers reference. If a handler uses a DOCUMENTS object, define it inside the handler
- Handlers use <<< >>> delimiters, code has \`args\` available for validated params
- Handler code is JavaScript/TypeScript — use Node.js APIs (fs, path, fetch) directly
- Return ONLY .kern code. No explanation, no markdown fences, no commentary, no confidence notes. NOTHING outside valid .kern syntax.`;

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
      parse(cleaned);
      sidebarProvider.showBuildMode(`${fileName} → .kern`, true);
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

  const pick = await vscode.window.showQuickPick(
    [`Convert to ${targetLabel}`, 'Import to .kern first'],
    { placeHolder: `Convert this ${isPython ? 'Python' : 'TypeScript'} MCP server` },
  );

  if (!pick) return;

  if (pick.startsWith('Import')) {
    return importToKern();
  }

  // Direct AI translation — no .kern middle step
  const source = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  if (!detectedEngines.length) detectedEngines = await detectEngines();
  const engine = detectedEngines.find(e => e.available)?.id || 'api';

  sidebarProvider.showGenerating();
  updateStatusBar('building', 0);

  try {
    const targetLangFull = isPython ? 'TypeScript' : 'Python';
    const sourceLangFull = isPython ? 'Python' : 'TypeScript';

    const convertPrompt = `You convert MCP servers between languages. Convert this ${sourceLangFull} MCP server to ${targetLangFull}.

Rules:
- Translate ALL code — handler logic, data structures, helper functions — to idiomatic ${targetLangFull}
- ${isPython ? 'Use @modelcontextprotocol/sdk with McpServer, StdioServerTransport, and zod for validation' : 'Use mcp.server.fastmcp with FastMCP, @mcp.tool() decorators, and Python type hints'}
- Keep the same tool names, descriptions, and parameter schemas
- Add input sanitization and validation
- Add structured JSON logging
- Add error handling with try/catch${isPython ? '' : '/except'}
- Return ONLY the ${targetLangFull} code. No explanation, no markdown fences, no commentary, no confidence notes, no summaries. If you want to add notes, use code comments (# for Python, // for TypeScript). NOTHING outside valid ${targetLangFull} syntax.`;

    const userPrompt = `Convert this ${sourceLangFull} MCP server to ${targetLangFull}:\n\n${source}`;
    const generated = await generateWithEngine(engine, convertPrompt, userPrompt, (msg) => outputChannel.appendLine(msg));
    const cleaned = generated.replace(/^```(?:typescript|python|ts|py)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

    const compiledLang = isPython ? 'typescript' : 'python';
    const compiledFileName = isPython
      ? fileName.replace(/\.py$/, '-converted.ts')
      : fileName.replace(/\.ts$|\.js$/, '-converted.py');

    const compiledDoc = await vscode.workspace.openTextDocument({ content: cleaned, language: compiledLang });
    compiledUris.add(compiledDoc.uri.toString());
    await vscode.window.showTextDocument(compiledDoc, vscode.ViewColumn.Beside, true);

    // Auto-review
    const findings = reviewMCPSource(cleaned, compiledFileName);
    const diagnostics = findings.map((f) => findingToDiagnostic(f, compiledDoc));
    diagnosticCollection.set(compiledDoc.uri, diagnostics);

    outputChannel.appendLine(`[Convert] ${fileName} → ${compiledFileName} (${findings.length} findings)`);
    updateStatusBar('built', findings.length);

    const buildResult: import('./review-panel').McpReviewResult = {
      fileName: compiledFileName,
      filePath: compiledDoc.uri.toString(),
      findings,
      irNodes: [],
      lang: compiledLang === 'python' ? 'python' : 'typescript',
    };
    sidebarProvider.showBuildResult(buildResult, fileName);

    if (findings.length === 0) {
      vscode.window.showInformationMessage(`${fileName} converted to ${targetLabel} — no security findings`);
    } else {
      vscode.window.showWarningMessage(`${fileName} converted — ${findings.length} finding(s)`);
    }
  } catch (err) {
    updateStatusBar('error', 0);
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Convert] Failed: ${msg}`);
    const engineLabel = detectedEngines.find(e => e.id === engine)?.label ?? engine;
    sidebarProvider.showGenerateError(msg, engineLabel);
  }
}

async function createKernTemplate(): Promise<void> {
  const template = `mcp name=MyServer version=1.0

  tool name=hello
    description text="Say hello"
    param name=name type=string required=true
    guard type=sanitize param=name
    handler <<<
      return { content: [{ type: "text", text: \`Hello, \${args.name}!\` }] };
    >>>
`;

  const doc = await vscode.workspace.openTextDocument({
    content: template,
    language: 'kern',
  });
  await vscode.window.showTextDocument(doc);
}

// ── .kern Validation ──────────────────────────────────────────────────

function scheduleKernValidation(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    void validateKernDocument(document);
  }, 800));
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
    compiledUris.add(doc.uri.toString());
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);

    outputChannel.appendLine(`[Build] ${fileName} → ${compiledFileName} (${result.tsTokenCount} tokens, ${target})`);

    // Auto-review the compiled output
    const findings = reviewMCPSource(result.code, compiledFileName);
    const diagnostics = findings.map((f) => findingToDiagnostic(f, doc));
    diagnosticCollection.set(doc.uri, diagnostics);

    outputChannel.appendLine(`[Build] Auto-review: ${findings.length} finding(s)`);

    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    updateStatusBar('built', findings.length);

    // Update sidebar with build result + breadcrumb
    const buildResult: import('./review-panel').McpReviewResult = {
      fileName: compiledFileName,
      filePath: doc.uri.toString(),
      findings,
      irNodes: [],
      lang: target === 'python' ? 'python' : 'typescript',
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
  mcpClient?.stop();
}
