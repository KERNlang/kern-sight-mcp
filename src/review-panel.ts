import * as vscode from 'vscode';
import type { ReviewFinding } from '@kernlang/review-mcp';
import type { SecurityScore } from '@kernlang/review-mcp';
import { gradeColor } from '@kernlang/review-mcp';

interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

export interface McpReviewResult {
  fileName: string;
  filePath: string;
  findings: ReviewFinding[];
  irNodes: IRNode[];
  lang: 'typescript' | 'python' | null;
  score?: SecurityScore;
}

export class McpSecuritySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kernMcpSecurity.sidebar';
  private _view?: vscode.WebviewView;
  private _current: McpReviewResult | null = null;
  private _jumping = false;
  private _configServers: import('./config-guardian').McpServerEntry[] = [];
  public safeFixRules: Set<string> = new Set();
  public onScanRequested?: () => void;
  public onCopySuggestionRequested?: (suggestion: string) => void;
  public onApplyFixRequested?: (filePath: string, line: number, ruleId: string) => void;

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
      }
    });
  }

  showLoading(): void {
    if (!this._view) return;
    // Don't clear sidebar if we already have results — avoids flicker on re-scan
    if (this._current) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    this._view.webview.html = buildLoadingHTML(animations);
  }

  update(result: McpReviewResult): void {
    this._current = result;
    this._render();
  }

  showNotMcp(): void {
    this._current = null;
    if (!this._view) return;
    this._view.webview.html = buildNotMcpHTML();
  }

  updateConfigGuardian(servers: import('./config-guardian').McpServerEntry[]): void {
    this._configServers = servers;
    this._render();
  }

  private _render(): void {
    if (!this._view) return;
    const animations = vscode.workspace.getConfiguration('kernMcpSecurity').get<boolean>('animations', true);
    if (this._current) {
      this._view.webview.html = buildReviewHTML(this._current, this.safeFixRules, this._configServers, animations);
    } else {
      this._view.webview.html = buildNotMcpHTML(this._configServers, animations);
    }
    this._view.show?.(true);
  }

  private _jumpToFile(filePath: string, line: number, col: number): void {
    // Set flag so extension skips the editor change event caused by this jump
    this._jumping = true;
    setTimeout(() => { this._jumping = false; }, 500);

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

// ── HTML builders ─────────────────────────────────────────────────────

function buildReviewHTML(result: McpReviewResult, safeFixRules?: Set<string>, configServers?: import('./config-guardian').McpServerEntry[], animations = true): string {
  const { fileName, findings, irNodes, lang } = result;
  const bugs = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  const isJS = fileName.endsWith('.js') || fileName.endsWith('.jsx');
  const langLabel = lang === 'typescript'
    ? (isJS ? 'JavaScript' : 'TypeScript')
    : lang === 'python' ? 'Python' : '';
  const langClass = lang === 'python' ? 'py' : 'ts';
  const langBadge = langLabel
    ? `<span class="lang-badge ${langClass}">${langLabel}</span>`
    : '';

  const serverName = extractServerName(result);

  return buildShell(`
    <div class="server-header">
      <div class="server-name">${escapeHTML(serverName)}</div>
      ${langBadge}
    </div>

    ${result.score ? buildScoreHero(result.score) : ''}

    <div class="summary">
      ${bugs.length > 0 ? `<div class="stat"><span class="stat-num bugs">${bugs.length}</span><span class="stat-label">Bug${bugs.length > 1 ? 's' : ''}</span></div>` : ''}
      ${warnings.length > 0 ? `${bugs.length > 0 ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num warns">${warnings.length}</span><span class="stat-label">Warning${warnings.length > 1 ? 's' : ''}</span></div>` : ''}
      ${info.length > 0 ? `${(bugs.length > 0 || warnings.length > 0) ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num infos">${info.length}</span><span class="stat-label">Note${info.length > 1 ? 's' : ''}</span></div>` : ''}
      ${findings.length === 0 ? '<div class="stat"><span class="stat-num clean">0</span><span class="stat-label">Issues</span></div>' : ''}
    </div>

    ${irNodes.length > 0 ? buildIRSection(irNodes, result.score) : ''}

    ${findings.length === 0 ? '<div class="clean-state"><div class="check">&#10003;</div><p>No vulnerabilities found.</p></div>' : ''}

    ${bugs.length > 0 ? '<div class="section-label" data-severity-section="error">Bugs</div>' : ''}
    ${bugs.map((f, i) => buildFindingHTML(f, i, result, safeFixRules)).join('')}

    ${warnings.length > 0 ? '<div class="section-label" data-severity-section="warning">Warnings</div>' : ''}
    ${warnings.map((f, i) => buildFindingHTML(f, i + bugs.length, result)).join('')}

    ${info.length > 0 ? '<div class="section-label" data-severity-section="info">Notes</div>' : ''}
    ${info.map((f, i) => buildFindingHTML(f, i + bugs.length + warnings.length, result)).join('')}

    ${configServers && configServers.length > 0 ? buildConfigGuardianSection(configServers) : ''}

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations });
}

function buildScoreHero(score: SecurityScore): string {
  const color = gradeColor(score.grade);
  const circumference = 2 * Math.PI * 34;
  const dashLength = (score.total / 100) * circumference;

  return `
    <div class="score-hero">
      <div class="score-ring-container">
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle cx="38" cy="38" r="34" fill="none" stroke="var(--border)" stroke-width="3.5"/>
          <circle cx="38" cy="38" r="34" fill="none" stroke="${color}" stroke-width="3.5"
            stroke-dasharray="${dashLength} ${circumference}"
            stroke-linecap="round" transform="rotate(-90 38 38)"
            class="score-arc"/>
        </svg>
        <div class="score-number" style="color:${color}">${score.total}</div>
      </div>
      <div class="score-details">
        <div class="grade-badge" style="background:${color}">${score.grade}</div>
        <div class="score-metrics">
          ${buildMetricBar('Guards', score.guardCoverage, '40%')}
          ${buildMetricBar('Validation', score.inputValidation, '25%')}
          ${buildMetricBar('Compliance', score.ruleCompliance, '20%')}
          ${buildMetricBar('Auth', score.authPosture, '15%')}
        </div>
      </div>
    </div>`;
}

function buildMetricBar(label: string, value: number, weight: string): string {
  const color = value >= 80 ? 'var(--kern-green)' : value >= 50 ? 'var(--kern-orange)' : 'var(--kern-red)';
  return `
    <div class="metric-row">
      <span class="metric-label">${label}</span>
      <span class="metric-weight">${weight}</span>
      <div class="metric-bar"><div class="metric-fill" style="width:${value}%;background:${color}"></div></div>
      <span class="metric-value">${value}</span>
    </div>`;
}

function buildIRSection(irNodes: IRNode[], score?: SecurityScore): string {
  const actions = irNodes.filter(n => n.type === 'action');
  if (actions.length === 0) return '';

  const actionCards = actions.map((action) => {
    const name = (action.props?.name as string) || 'unknown';
    const confidence = (action.props?.confidence as number) ?? 0;
    const children = action.children ?? [];
    const effects = children.filter(c => c.type === 'effect');
    const guards = children.filter(c => c.type === 'guard');
    const isGuarded = guards.length > 0 && guards.length >= effects.length;
    const hasEffects = effects.length > 0;

    const statusDot = !hasEffects
      ? '<span class="ir-dot safe"></span><span class="ir-status safe">SAFE</span>'
      : isGuarded
        ? '<span class="ir-dot guarded"></span><span class="ir-status guarded">GUARDED</span>'
        : '<span class="ir-dot unguarded"></span><span class="ir-status unguarded">UNGUARDED</span>';

    const childrenHTML = children
      .filter(c => c.type === 'effect' || c.type === 'guard')
      .map((c) => {
        const kind = (c.props?.kind as string) || '';
        const icon = c.type === 'effect' ? '&#9889;' : '&#9989;';
        const cls = c.type === 'effect' ? 'ir-child-effect' : 'ir-child-guard';
        return `<div class="ir-child ${cls}"><span class="ir-child-icon">${icon}</span><span class="ir-child-type">${c.type}</span><span class="ir-child-kind">${escapeHTML(kind)}</span></div>`;
      }).join('');

    const confidencePercent = Math.round(confidence * 100);
    const confClass = confidencePercent >= 80 ? 'high' : confidencePercent >= 50 ? 'mid' : 'low';

    // Per-tool score badge from SecurityScore
    const toolScore = score?.perTool.find(t => t.toolName === name);
    const toolScoreBadge = toolScore
      ? `<span class="ir-tool-score" style="color:${gradeColor(toolScore.grade)}">${toolScore.grade}</span>`
      : '';

    return `
      <div class="ir-action">
        <div class="ir-action-header">
          ${statusDot}
          <span class="ir-action-name">${escapeHTML(name)}</span>
          ${toolScoreBadge}
          <span class="ir-confidence ${confClass}">${confidencePercent}%</span>
        </div>
        <div class="ir-children">${childrenHTML}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label">KERN IR</div>
    <div class="ir-tree">${actionCards}</div>`;
}

function buildFindingHTML(f: ReviewFinding, index: number, result: McpReviewResult, safeFixRules?: Set<string>): string {
  const line = f.primarySpan.startLine;
  const col = f.primarySpan.startCol;
  const fp = result.filePath;
  const severityClass = f.severity === 'error' ? 'bug' : f.severity === 'warning' ? 'warn' : 'info';
  const severityLabel = f.severity === 'error' ? 'BUG' : f.severity === 'warning' ? 'WARN' : 'INFO';
  const delay = index * 0.12;
  const conf = (f as any).confidence as number | undefined;
  const confPercent = conf != null ? Math.round(conf * 100) : null;
  const confClass = confPercent != null ? (confPercent >= 80 ? 'high' : confPercent >= 50 ? 'mid' : 'low') : '';

  const actionBtns: string[] = [];
  const hasSafeFix = safeFixRules?.has(f.ruleId);
  if (hasSafeFix) {
    actionBtns.push(`<button class="finding-action-btn fix-btn" data-action="applyFix" data-filepath="${escapeHTML(fp)}" data-line="${line}" data-ruleid="${escapeHTML(f.ruleId)}">&#9889; FIX</button>`);
  }
  if (f.suggestion) {
    actionBtns.push(`<button class="finding-action-btn" data-action="copySuggestion" data-suggestion="${escapeHTML(f.suggestion)}">COPY</button>`);
  }
  const actionsHtml = actionBtns.length > 0 ? `<div class="finding-actions">${actionBtns.join('')}</div>` : '';

  return `
    <div class="finding" data-line="${line}" data-col="${col}" data-filepath="${escapeHTML(fp)}" data-severity="${f.severity}" style="animation-delay: ${delay}s">
      <div class="finding-header">
        <div class="finding-dot-wrapper">
          <span class="pulse-dot ${severityClass}"></span>
          <span class="pulse-ring ${severityClass}"></span>
        </div>
        <span class="severity-badge ${severityClass}">${severityLabel}</span>
        <span class="rule-id">${escapeHTML(f.ruleId)}</span>
        <span class="line-ref">L${line}</span>
        ${confPercent != null ? `<span class="finding-confidence ${confClass}">${confPercent}%</span>` : ''}
        <span class="jump-hint">&#8599;</span>
      </div>
      <p class="finding-message">${escapeHTML(f.message)}</p>
      ${f.suggestion ? `<div class="fix-suggestion"><span class="fix-label">FIX</span> ${escapeHTML(f.suggestion)}</div>` : ''}
      ${actionsHtml}
    </div>`;
}

function extractServerName(result: McpReviewResult): string {
  // Try to extract from IR nodes or fall back to filename
  for (const node of result.irNodes) {
    if (node.type === 'action' && node.props?.name) {
      // Return the filename — individual tools are shown in IR section
      break;
    }
  }
  return result.fileName;
}

function buildLoadingHTML(animations = true): string {
  return buildShell(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:20px;">
      <div class="scanner">
        <div class="scanner-ring"></div>
        <div class="scanner-ring scanner-ring-1"></div>
        <div class="scanner-ring scanner-ring-2"></div>
        <div class="scanner-ring scanner-ring-3"></div>
        <div class="scanner-core"></div>
        <div class="scanner-sweep"></div>
      </div>
      <div style="font-size:11px;color:#525252;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;font-family:'SF Mono',monospace;">Scanning<span class="scan-dots"></span></div>
    </div>
  `, { animations });
}

function buildNotMcpHTML(configServers?: import('./config-guardian').McpServerEntry[], animations = true): string {
  return buildShell(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px;text-align:center;gap:16px;">
      <div class="header-brand"><span class="kern">KE<span class="kern-underline"></span>RN</span> <span class="mcp">MCP</span></div>
      <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;max-width:260px;">This file is not an MCP server.<br><br>Open a file that imports<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">@modelcontextprotocol/sdk</code><br>or<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">mcp.server</code></p>
    </div>
    ${configServers && configServers.length > 0 ? buildConfigGuardianSection(configServers) : ''}
  `, { animations });
}

function buildConfigGuardianSection(servers: import('./config-guardian').McpServerEntry[]): string {
  const trustIcon = (trust: string) => {
    if (trust === 'verified') return '<span class="guardian-trust verified">&#9679;</span>';
    if (trust === 'risky') return '<span class="guardian-trust risky">&#9679;</span>';
    return '<span class="guardian-trust unknown">&#9679;</span>';
  };

  const sourceLabel = (source: string) => {
    if (source === 'claude') return 'Claude Desktop';
    if (source === 'cursor') return 'Cursor';
    return 'VS Code';
  };

  const serverCards = servers.map((s) => {
    const issueList = s.issues.map((issue) => {
      const sevClass = issue.severity === 'error' ? 'bug' : issue.severity === 'warning' ? 'warn' : 'info';
      return `<div class="guardian-issue ${sevClass}"><span class="guardian-issue-icon">${issue.severity === 'error' ? '&#9888;' : '&#9432;'}</span>${escapeHTML(issue.message)}</div>`;
    }).join('');

    return `
      <div class="guardian-server">
        <div class="guardian-server-header">
          ${trustIcon(s.trust)}
          <span class="guardian-server-name">${escapeHTML(s.name)}</span>
          <span class="guardian-source">${sourceLabel(s.source)}</span>
        </div>
        <div class="guardian-cmd">${escapeHTML(s.command)} ${s.args.map(a => escapeHTML(a)).join(' ')}</div>
        ${issueList ? `<div class="guardian-issues">${issueList}</div>` : '<div class="guardian-clean">No issues</div>'}
      </div>`;
  }).join('');

  const issueCount = servers.reduce((sum, s) => sum + s.issues.length, 0);
  const riskyCount = servers.filter(s => s.trust === 'risky').length;

  return `
    <div class="section-label" style="margin-top:24px;">MY MCP SERVERS</div>
    <div class="guardian-summary">
      <span class="guardian-stat">${servers.length} server${servers.length !== 1 ? 's' : ''}</span>
      ${issueCount > 0 ? `<span class="guardian-stat warn">${issueCount} issue${issueCount !== 1 ? 's' : ''}</span>` : ''}
      ${riskyCount > 0 ? `<span class="guardian-stat risky">${riskyCount} risky</span>` : ''}
    </div>
    <div class="guardian-list">${serverCards}</div>`;
}

function buildShell(content: string, options?: { animations?: boolean }): string {
  const noAnim = options?.animations === false;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-hover: #1c2128;
    --text: #ededed;
    --text-secondary: #a1a1a1;
    --text-muted: #525252;
    --border: rgba(255, 255, 255, 0.08);
    --accent: #a1a1aa;
    --kern-orange: #f97316;
    --kern-red: #ef4444;
    --kern-green: #22c55e;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 16px;
    line-height: 1.6;
  }

  /* -- Header brand -- */

  .header-brand {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.03em;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  .kern {
    color: var(--text);
    position: relative;
    display: inline-block;
  }

  .kern-underline {
    position: absolute;
    bottom: 1px;
    left: 0;
    width: 45%;
    height: 2px;
    background: var(--kern-red);
    border-radius: 1px;
  }

  .mcp {
    background: linear-gradient(135deg, var(--kern-orange), var(--kern-red));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* -- Server header -- */

  .server-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    animation: fadeSlideIn 0.3s ease-out both;
  }

  .server-name {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
  }

  /* -- Score hero -- */

  .score-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    margin-bottom: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    animation: fadeSlideIn 0.5s ease-out both;
  }

  .score-ring-container {
    position: relative;
    width: 76px;
    height: 76px;
    flex-shrink: 0;
  }

  .score-arc {
    transition: stroke-dasharray 1s ease-out;
  }

  .no-animations .score-arc {
    transition: none;
  }

  .score-number {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 24px;
    font-weight: 900;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-variant-numeric: tabular-nums;
  }

  .score-details {
    flex: 1;
    min-width: 0;
  }

  .grade-badge {
    display: inline-block;
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 0.05em;
    padding: 2px 10px;
    border-radius: 4px;
    color: #fff;
    font-family: 'SF Mono', monospace;
    margin-bottom: 10px;
  }

  .score-metrics {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    font-family: 'SF Mono', monospace;
  }

  .metric-label {
    width: 52px;
    color: var(--text-secondary);
    font-weight: 600;
    flex-shrink: 0;
  }

  .metric-weight {
    width: 20px;
    color: var(--text-muted);
    font-size: 8px;
    flex-shrink: 0;
  }

  .metric-bar {
    flex: 1;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .metric-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.8s ease-out;
  }

  .metric-value {
    width: 22px;
    text-align: right;
    color: var(--text-muted);
    font-weight: 700;
    flex-shrink: 0;
  }

  /* -- Tool score badge in IR tree -- */

  .ir-tool-score {
    font-size: 10px;
    font-weight: 900;
    font-family: 'SF Mono', monospace;
    margin-left: auto;
    padding: 0 4px;
  }

  .lang-badge {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
    text-transform: uppercase;
    margin-left: auto;
  }

  .lang-badge.ts { background: rgba(49, 120, 198, 0.15); color: #3178c6; }
  .lang-badge.py { background: rgba(55, 118, 171, 0.15); color: #3776ab; }

  /* -- Summary strip -- */

  .summary {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    animation: fadeSlideIn 0.5s ease-out both;
    flex-wrap: wrap;
  }

  .stat { display: flex; align-items: center; gap: 6px; }

  .stat-num {
    font-size: 22px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .stat-num.bugs { background: linear-gradient(135deg, var(--kern-orange), var(--kern-red)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .stat-num.warns { color: var(--kern-orange); }
  .stat-num.infos { color: var(--text-muted); }
  .stat-num.clean { color: var(--kern-green); }

  .stat-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .divider { width: 1px; background: var(--border); }

  /* -- IR tree -- */

  .ir-tree {
    margin-bottom: 20px;
  }

  .ir-action {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
    animation: fadeSlideIn 0.4s ease-out both;
  }

  .ir-action-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .ir-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ir-dot.guarded { background: var(--kern-green); box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
  .ir-dot.unguarded { background: var(--kern-red); box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); animation: pulse 2s ease-in-out infinite; }
  .ir-dot.safe { background: var(--kern-green); }

  .ir-status {
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.12em;
    font-family: 'SF Mono', monospace;
  }

  .ir-status.guarded { color: var(--kern-green); }
  .ir-status.unguarded { color: var(--kern-red); }
  .ir-status.safe { color: var(--kern-green); }

  .ir-action-name {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
  }

  .ir-confidence {
    margin-left: auto;
    font-family: 'SF Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .ir-confidence.high { background: rgba(34, 197, 94, 0.1); color: var(--kern-green); }
  .ir-confidence.mid { background: rgba(249, 115, 22, 0.1); color: var(--kern-orange); }
  .ir-confidence.low { background: rgba(239, 68, 68, 0.1); color: var(--kern-red); }

  .ir-children {
    padding-left: 14px;
    border-left: 1px solid var(--border);
    margin-left: 3px;
  }

  .ir-child {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 10px;
    font-family: 'SF Mono', monospace;
  }

  .ir-child-icon { font-size: 10px; }
  .ir-child-effect .ir-child-type { color: var(--kern-orange); }
  .ir-child-guard .ir-child-type { color: var(--kern-green); }
  .ir-child-kind { color: var(--text-muted); }

  /* -- Findings -- */

  .finding {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 10px;
    animation: fadeSlideIn 0.5s ease-out both;
    transition: border-color 0.2s ease, background 0.2s ease;
    cursor: pointer;
  }

  .finding:hover {
    border-color: rgba(255, 255, 255, 0.15);
    background: var(--surface-hover);
  }

  .finding:active { background: rgba(249, 115, 22, 0.06); }

  .finding-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .finding-dot-wrapper {
    position: relative;
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  .pulse-dot {
    position: absolute;
    top: 2.5px; left: 2.5px;
    width: 5px; height: 5px;
    border-radius: 50%;
  }

  .pulse-ring {
    position: absolute;
    top: 0; left: 0;
    width: 10px; height: 10px;
    border-radius: 50%;
    border: 1px solid;
    animation: pulseRing 2.5s ease-in-out infinite;
  }

  .pulse-dot.bug, .pulse-ring.bug { background: var(--kern-red); border-color: var(--kern-red); }
  .pulse-dot.warn, .pulse-ring.warn { background: var(--kern-orange); border-color: var(--kern-orange); }
  .pulse-dot.info, .pulse-ring.info { background: var(--accent); border-color: var(--accent); }

  .severity-badge {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;
  }

  .severity-badge.bug { background: rgba(239, 68, 68, 0.15); color: var(--kern-red); }
  .severity-badge.warn { background: rgba(249, 115, 22, 0.15); color: var(--kern-orange); }
  .severity-badge.info { background: rgba(161, 161, 170, 0.1); color: var(--accent); }

  .rule-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line-ref {
    margin-left: auto;
    font-family: monospace;
    font-size: 10px;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .finding-confidence {
    font-family: 'SF Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .finding-confidence.high { background: rgba(34, 197, 94, 0.1); color: var(--kern-green); }
  .finding-confidence.mid { background: rgba(249, 115, 22, 0.1); color: var(--kern-orange); }
  .finding-confidence.low { background: rgba(239, 68, 68, 0.1); color: var(--kern-red); }

  .jump-hint {
    font-size: 9px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.2s;
    margin-left: 4px;
  }

  .finding:hover .jump-hint { opacity: 1; }

  .finding-message {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 10px;
    line-height: 1.5;
  }

  /* -- Fix suggestion -- */

  .fix-suggestion {
    margin-top: 8px;
    padding: 8px 10px;
    background: rgba(34, 197, 94, 0.06);
    border: 1px solid rgba(34, 197, 94, 0.12);
    border-radius: 5px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .fix-label {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--kern-green);
    margin-right: 6px;
    font-family: monospace;
  }

  /* -- Finding action buttons -- */

  .finding-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }

  .finding-action-btn {
    padding: 3px 8px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'SF Mono', monospace;
    transition: all 0.2s;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
  }

  .finding-action-btn:hover {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.2);
    background: var(--surface-hover);
  }

  .finding-action-btn.fix-btn {
    color: var(--kern-green);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .finding-action-btn.fix-btn:hover {
    background: rgba(34, 197, 94, 0.1);
    border-color: var(--kern-green);
  }

  .finding-action-btn.applied {
    color: var(--kern-green);
    border-color: rgba(34, 197, 94, 0.3);
    pointer-events: none;
  }

  /* -- Clean state -- */

  .clean-state {
    text-align: center;
    padding: 40px 16px;
    animation: fadeSlideIn 0.5s ease-out both;
  }

  .clean-state .check {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.1);
    border: 2px solid var(--kern-green);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 12px;
    font-size: 20px;
    animation: pulseRing 2s ease-in-out infinite;
    border-color: var(--kern-green);
  }

  .clean-state p {
    color: var(--text-secondary);
    font-size: 13px;
  }

  /* -- Section labels -- */

  .section-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 20px 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* -- Flow rail -- */

  .flow-rail {
    position: fixed;
    left: 0; top: 0;
    width: 3px;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  }

  .flow-rail-bg {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 0%, var(--border) 5%, var(--border) 95%, transparent 100%);
  }

  .flow-rail-energy {
    position: absolute;
    left: 0;
    width: 3px;
    height: 50px;
    background: linear-gradient(180deg, transparent, var(--kern-red), transparent);
    border-radius: 3px;
    animation: flowDown 4s linear infinite;
    opacity: 0.5;
  }

  /* -- Config Guardian -- */

  .guardian-summary {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 10px;
    font-family: 'SF Mono', monospace;
  }

  .guardian-stat {
    color: var(--text-muted);
    font-weight: 600;
  }

  .guardian-stat.warn { color: var(--kern-orange); }
  .guardian-stat.risky { color: var(--kern-red); }

  .guardian-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .guardian-server {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    animation: fadeSlideIn 0.4s ease-out both;
  }

  .guardian-server-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .guardian-trust {
    font-size: 8px;
    line-height: 1;
  }

  .guardian-trust.verified { color: var(--kern-green); }
  .guardian-trust.unknown { color: var(--kern-orange); }
  .guardian-trust.risky { color: var(--kern-red); }

  .guardian-server-name {
    font-family: 'SF Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
  }

  .guardian-source {
    margin-left: auto;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    text-transform: uppercase;
    background: rgba(255,255,255,0.04);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .guardian-cmd {
    font-family: 'SF Mono', monospace;
    font-size: 9px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }

  .guardian-issues {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 6px;
  }

  .guardian-issue {
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 4px;
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }

  .guardian-issue.bug {
    background: rgba(239, 68, 68, 0.08);
    color: var(--kern-red);
  }

  .guardian-issue.warn {
    background: rgba(249, 115, 22, 0.08);
    color: var(--kern-orange);
  }

  .guardian-issue.info {
    background: rgba(161, 161, 170, 0.06);
    color: var(--text-muted);
  }

  .guardian-issue-icon {
    flex-shrink: 0;
    font-size: 10px;
  }

  .guardian-clean {
    font-size: 9px;
    color: var(--kern-green);
    margin-top: 4px;
  }

  /* -- Footer -- */

  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    text-align: center;
    color: var(--text-muted);
    font-size: 10px;
    letter-spacing: 0.05em;
    animation: fadeSlideIn 0.8s ease-out 0.5s both;
  }

  .brand-kern-sm, .brand-mcp-sm {
    font-weight: 900;
    letter-spacing: -0.03em;
    font-family: 'SF Mono', monospace;
    font-size: 10px;
  }

  .brand-kern-sm { color: var(--text-secondary); }

  .brand-mcp-sm {
    background: linear-gradient(135deg, var(--kern-orange), var(--kern-red));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* -- Filter bar -- */

  .filter-bar {
    display: flex;
    gap: 0;
    margin-bottom: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .filter-btn {
    flex: 1;
    padding: 5px 0;
    text-align: center;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    font-family: 'SF Mono', monospace;
  }

  .filter-btn:hover { color: var(--text-secondary); background: var(--surface); }
  .filter-btn.active { color: var(--text); background: var(--surface); }
  .filter-btn + .filter-btn { border-left: 1px solid var(--border); }

  /* -- Scanner (loading) -- */

  .scanner { position: relative; width: 64px; height: 64px; }
  .scanner-ring { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.06); }
  .scanner-ring-1 { inset: 6px; border-color: rgba(249,115,22,0.15); animation: scanPulse 2s ease-in-out infinite; }
  .scanner-ring-2 { inset: 14px; border-color: rgba(239,68,68,0.2); animation: scanPulse 2s ease-in-out 0.3s infinite; }
  .scanner-ring-3 { inset: 22px; border-color: rgba(239,68,68,0.3); animation: scanPulse 2s ease-in-out 0.6s infinite; }
  .scanner-core { position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #ef4444; animation: corePulse 1.5s ease-in-out infinite; box-shadow: 0 0 10px rgba(239,68,68,0.4); }
  .scanner-sweep { position: absolute; top: 50%; left: 50%; width: 32px; height: 1.5px; transform-origin: left center; background: linear-gradient(90deg, rgba(239,68,68,0.6), transparent); animation: sweep 2s linear infinite; }
  .scan-dots::after { content: ''; animation: dots 1.5s steps(3) infinite; }

  /* -- Animations -- */

  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulseRing { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.3); } }
  @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
  @keyframes flowDown { from { top: -50px; } to { top: 100%; } }
  @keyframes scanPulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.08); opacity: 1; } }
  @keyframes corePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.4); } }
  @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes dots { 0% { content: ''; } 33% { content: '.'; } 66% { content: '..'; } 100% { content: '...'; } }

  /* -- No-animation mode -- */
  .no-animations,
  .no-animations * {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
  }
  .no-animations .flow-rail-energy { display: none; }
  .no-animations .pulse-ring { display: none; }
</style>
</head>
<body class="${noAnim ? 'no-animations' : ''}">

<div class="flow-rail"><div class="flow-rail-bg"></div><div class="flow-rail-energy"></div></div>

<div class="filter-bar">
  <button class="filter-btn active" data-filter="all">ALL</button>
  <button class="filter-btn" data-filter="error">BUGS</button>
  <button class="filter-btn" data-filter="warning">WARNINGS</button>
  <button class="filter-btn" data-filter="info">INFO</button>
</div>

<div id="content-container">
${content}
</div>

<script>
  const vscode = acquireVsCodeApi();

  document.body.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      if (action === 'applyFix') {
        vscode.postMessage({
          type: 'applyFix',
          filePath: actionBtn.dataset.filepath,
          line: parseInt(actionBtn.dataset.line, 10),
          ruleId: actionBtn.dataset.ruleid,
        });
        actionBtn.textContent = 'Applied';
        actionBtn.classList.add('applied');
        return;
      }
      if (action === 'copySuggestion') {
        vscode.postMessage({ type: 'copySuggestion', suggestion: actionBtn.dataset.suggestion });
        actionBtn.textContent = 'Copied';
        setTimeout(() => { actionBtn.textContent = 'COPY'; }, 1500);
      }
      return;
    }

    const finding = e.target.closest('.finding');
    if (finding) {
      const line = parseInt(finding.dataset.line, 10);
      const col = parseInt(finding.dataset.col, 10) || 1;
      const filePath = finding.dataset.filepath || '';
      vscode.postMessage({ type: 'jumpToLine', line, col, filePath });
      return;
    }

    const filterBtn = e.target.closest('.filter-btn');
    if (filterBtn) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      filterBtn.classList.add('active');
      const filter = filterBtn.dataset.filter;
      document.querySelectorAll('.finding').forEach(el => {
        el.style.display = (filter === 'all' || el.dataset.severity === filter) ? '' : 'none';
      });
      document.querySelectorAll('.section-label[data-severity-section]').forEach(el => {
        el.style.display = (filter === 'all' || el.dataset.severitySection === filter) ? '' : 'none';
      });
      return;
    }
  });
</script>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
