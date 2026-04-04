import * as vscode from 'vscode';
import type { ScoreDiff } from './score-history';
import type { McpServerEntry } from './config-guardian';
import { JUMP_DEBOUNCE_MS } from './constants';

// Re-export shared types for extension.ts consumers
export type { McpReviewResult } from './panel/shared';
export type { IRNode } from './panel/shared';

// Import HTML builders from decomposed modules
import { buildReviewHTML } from './panel/review';
import { buildBuildModeHTML, buildCompilingHTML, buildBuildResultHTML } from './panel/build';
import { buildGenerateHTML, buildGeneratingHTML, buildImportModeHTML, buildGenerateErrorHTML } from './panel/generate';
import { buildLoadingHTML, buildNotMcpHTML } from './panel/shell';
import type { McpReviewResult } from './panel/shared';

export class McpSecuritySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kernMcpSecurity.sidebar';
  private _view?: vscode.WebviewView;
  private _current: McpReviewResult | null = null;
  private _scoreDiff: ScoreDiff | null = null;
  private _jumping = false;
  private _configServers: McpServerEntry[] = [];
  private _mode: 'review' | 'build' = 'review';
  public safeFixRules: Set<string> = new Set();
  public onScanRequested?: () => void;
  public onCopySuggestionRequested?: (suggestion: string) => void;
  public onApplyFixRequested?: (filePath: string, line: number, ruleId: string) => void;
  public onCompileRequested?: (target: 'typescript' | 'python') => void;
  public onValidateRequested?: () => void;
  public onCreateKernRequested?: () => void;
  public onNewFromTemplateRequested?: () => void;
  public onGenerateRequested?: (description: string, selectedContextIds: string[], engineId?: string) => void;
  public onScanContextRequested?: () => void;
  public onModeChanged?: (mode: 'review' | 'build') => void;
  public onImportToKernRequested?: () => void;
  public onConvertTargetRequested?: () => void;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  /** True if sidebar just triggered a jump — extension should skip the next editor change event */
  get isJumping(): boolean {
    return this._jumping;
  }

  /** Path of the currently displayed file */
  get currentFilePath(): string | null {
    return this._current?.filePath ?? null;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this._render();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'jumpToLine') {
        this._jumpToFile(msg.filePath, msg.line, msg.col);
      } else if (msg.type === 'triggerScan') {
        this.onScanRequested?.();
      } else if (msg.type === 'copySuggestion') {
        this.onCopySuggestionRequested?.(msg.suggestion);
      } else if (msg.type === 'applyFix') {
        this.onApplyFixRequested?.(msg.filePath, msg.line, msg.ruleId);
      } else if (msg.type === 'compileMCP') {
        this.onCompileRequested?.(msg.target);
      } else if (msg.type === 'validateKern') {
        this.onValidateRequested?.();
      } else if (msg.type === 'createKern') {
        this.onCreateKernRequested?.();
      } else if (msg.type === 'generate') {
        this.onGenerateRequested?.(msg.description, msg.contextIds, msg.engineId);
      } else if (msg.type === 'scanContext') {
        this.onScanContextRequested?.();
      } else if (msg.type === 'newFromTemplate') {
        this.onNewFromTemplateRequested?.();
      } else if (msg.type === 'importToKern') {
        this.onImportToKernRequested?.();
      } else if (msg.type === 'convertTarget') {
        this.onConvertTargetRequested?.();
      } else if (msg.type === 'generateTests') {
        vscode.commands.executeCommand('kernMcpSecurity.generateSecurityTests');
      } else if (msg.type === 'generateBadge') {
        vscode.commands.executeCommand('kernMcpSecurity.generateBadge');
      } else if (msg.type === 'openSettings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'kernMcpSecurity.ai');
      } else if (msg.type === 'switchMode') {
        this._mode = msg.mode;
        this.onModeChanged?.(msg.mode);
      }
    });
  }

  showLoading(): void {
    if (!this._view) return;
    if (this._current) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildLoadingHTML(animations);
  }

  update(result: McpReviewResult, scoreDiff?: ScoreDiff | null): void {
    this._current = result;
    this._scoreDiff = scoreDiff ?? null;
    this._mode = 'review';
    this._render();
  }

  showNotMcp(): void {
    this._current = null;
    this._mode = 'review';
    if (!this._view) return;
    this._view.webview.html = buildNotMcpHTML();
  }

  showBuildMode(fileName: string, syntaxValid: boolean, errorMessage?: string): void {
    this._current = null;
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildBuildModeHTML(fileName, syntaxValid, errorMessage, animations);
  }

  showBuildResult(result: McpReviewResult, sourceFileName: string): void {
    this._current = result;
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildBuildResultHTML(result, sourceFileName, this.safeFixRules, this._configServers, animations);
  }

  showGenerateMode(contextItems: { id: string; label: string; category: string; preview: string }[], engines: { id: string; label: string; available: boolean }[]): void {
    this._current = null;
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildGenerateHTML(contextItems, engines, animations);
  }

  showGenerating(): void {
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildGeneratingHTML(animations);
  }

  showImportMode(fileName: string, lang: 'typescript' | 'python'): void {
    this._current = null;
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildImportModeHTML(fileName, lang, animations);
  }

  showGenerateError(message: string, engineLabel: string): void {
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildGenerateErrorHTML(message, engineLabel, animations);
  }

  showCompiling(fileName: string, target: string): void {
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildCompilingHTML(fileName, target, animations);
  }

  updateConfigGuardian(servers: McpServerEntry[]): void {
    this._configServers = servers;
    // Don't re-render if we're in build mode — config updates shouldn't reset the BUILD screen
    if (this._mode !== 'build') {
      this._render();
    }
  }

  private _render(): void {
    if (!this._view) return;
    // Only render review mode content — build mode has its own explicit render calls
    if (this._mode === 'build') return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    if (this._current) {
      this._view.webview.html = buildReviewHTML(this._current, this.safeFixRules, this._configServers, animations, this._scoreDiff);
    } else {
      this._view.webview.html = buildNotMcpHTML(this._configServers, animations);
    }
  }

  private _jumpToFile(filePath: string, line: number, col: number): void {
    this._jumping = true;
    setTimeout(() => { this._jumping = false; }, JUMP_DEBOUNCE_MS);

    const uri = vscode.Uri.file(filePath);
    const pos = new vscode.Position(Math.max(0, line - 1), Math.max(0, col - 1));
    const range = new vscode.Range(pos, pos);
    const existingEditor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
    const options: vscode.TextDocumentShowOptions = {
      selection: range,
      viewColumn: existingEditor?.viewColumn ?? vscode.window.activeTextEditor?.viewColumn,
      preserveFocus: false,
    };

    if (existingEditor) {
      void vscode.window.showTextDocument(existingEditor.document, options);
    } else {
      void vscode.window.showTextDocument(uri, options);
    }
  }
}
