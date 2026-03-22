import * as vscode from 'vscode';
import type { ReviewFinding } from '@kernlang/review-mcp';

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
}

export class McpSecuritySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kernMcpSecurity.sidebar';
  private _view?: vscode.WebviewView;
  private _current: McpReviewResult | null = null;
  private _jumping = false;
  public onScanRequested?: () => void;
  public onCopySuggestionRequested?: (suggestion: string) => void;

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
      }
    });
  }

  showLoading(): void {
    if (!this._view) return;
    // Don't clear sidebar if we already have results — avoids flicker on re-scan
    if (this._current) return;
    this._view.webview.html = buildLoadingHTML();
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

  private _render(): void {
    if (!this._view) return;
    if (this._current) {
      this._view.webview.html = buildReviewHTML(this._current);
    } else {
      this._view.webview.html = buildNotMcpHTML();
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
    vscode.window.showTextDocument(uri, {
      selection: range,
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
  }
}

// ── HTML builders ─────────────────────────────────────────────────────

function buildReviewHTML(result: McpReviewResult): string {
  const { fileName, findings, irNodes, lang } = result;
  const bugs = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  const langBadge = lang === 'typescript'
    ? '<span class="lang-badge ts">TypeScript</span>'
    : lang === 'python'
      ? '<span class="lang-badge py">Python</span>'
      : '';

  const serverName = extractServerName(result);

  return buildShell(`
    <div class="server-header">
      <div class="server-name">${escapeHTML(serverName)}</div>
      ${langBadge}
    </div>

    <div class="summary">
      ${bugs.length > 0 ? `<div class="stat"><span class="stat-num bugs">${bugs.length}</span><span class="stat-label">Bug${bugs.length > 1 ? 's' : ''}</span></div>` : ''}
      ${warnings.length > 0 ? `${bugs.length > 0 ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num warns">${warnings.length}</span><span class="stat-label">Warning${warnings.length > 1 ? 's' : ''}</span></div>` : ''}
      ${info.length > 0 ? `${(bugs.length > 0 || warnings.length > 0) ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num infos">${info.length}</span><span class="stat-label">Note${info.length > 1 ? 's' : ''}</span></div>` : ''}
      ${findings.length === 0 ? '<div class="stat"><span class="stat-num clean">0</span><span class="stat-label">Issues</span></div>' : ''}
    </div>

    ${irNodes.length > 0 ? buildIRSection(irNodes) : ''}

    ${findings.length === 0 ? '<div class="clean-state"><div class="check">&#10003;</div><p>No vulnerabilities found.</p></div>' : ''}

    ${bugs.length > 0 ? '<div class="section-label" data-severity-section="error">Bugs</div>' : ''}
    ${bugs.map((f, i) => buildFindingHTML(f, i, result)).join('')}

    ${warnings.length > 0 ? '<div class="section-label" data-severity-section="warning">Warnings</div>' : ''}
    ${warnings.map((f, i) => buildFindingHTML(f, i + bugs.length, result)).join('')}

    ${info.length > 0 ? '<div class="section-label" data-severity-section="info">Notes</div>' : ''}
    ${info.map((f, i) => buildFindingHTML(f, i + bugs.length + warnings.length, result)).join('')}

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `);
}

function buildIRSection(irNodes: IRNode[]): string {
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

    return `
      <div class="ir-action">
        <div class="ir-action-header">
          ${statusDot}
          <span class="ir-action-name">${escapeHTML(name)}</span>
          <span class="ir-confidence ${confClass}">${confidencePercent}%</span>
        </div>
        <div class="ir-children">${childrenHTML}</div>
      </div>`;
  }).join('');

  return `
    <div class="section-label">KERN IR</div>
    <div class="ir-tree">${actionCards}</div>`;
}

function buildFindingHTML(f: ReviewFinding, index: number, result: McpReviewResult): string {
  const line = f.primarySpan.startLine;
  const col = f.primarySpan.startCol;
  const fp = result.filePath;
  const severityClass = f.severity === 'error' ? 'bug' : f.severity === 'warning' ? 'warn' : 'info';
  const severityLabel = f.severity === 'error' ? 'BUG' : f.severity === 'warning' ? 'WARN' : 'INFO';
  const delay = index * 0.12;

  const actionBtns: string[] = [];
  if (f.suggestion) {
    actionBtns.push(`<button class="finding-action-btn" data-action="copySuggestion" data-suggestion="${escapeHTML(f.suggestion)}">COPY FIX</button>`);
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

function buildLoadingHTML(): string {
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
  `);
}

function buildNotMcpHTML(): string {
  return buildShell(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px;text-align:center;gap:16px;">
      <div class="header-brand"><span class="kern">KE<span class="kern-underline"></span>RN</span> <span class="mcp">MCP</span></div>
      <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;max-width:260px;">This file is not an MCP server.<br><br>Open a file that imports<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">@modelcontextprotocol/sdk</code><br>or<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">mcp.server</code></p>
    </div>
  `);
}

function buildShell(content: string): string {
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
</style>
</head>
<body>

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
      if (action === 'copySuggestion') {
        vscode.postMessage({ type: 'copySuggestion', suggestion: actionBtn.dataset.suggestion });
        actionBtn.textContent = 'Copied';
        setTimeout(() => { actionBtn.textContent = 'COPY FIX'; }, 1500);
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
