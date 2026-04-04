import type { McpReviewResult } from './shared';
import { escapeHTML } from './shared';
import type { McpServerEntry } from '../config-guardian';
import { buildShell } from './shell';
import { buildScoreHero } from './review';
import { buildConfigGuardianSection } from './guardian';

export function buildBuildModeHTML(fileName: string, syntaxValid: boolean, errorMessage?: string, animations = true): string {
  const statusClass = syntaxValid ? 'valid' : 'error';
  const statusText = syntaxValid ? 'Syntax: Valid' : 'Syntax: Error';
  const statusIcon = syntaxValid ? '&#10003;' : '&#10007;';

  return buildShell(`
    <div class="server-header">
      <div class="server-name">${escapeHTML(fileName)}</div>
      <span class="lang-badge build">BUILD</span>
    </div>

    <div class="build-status ${statusClass}">
      <span class="build-status-icon">${statusIcon}</span>
      <span class="build-status-text">${statusText}</span>
    </div>
    ${errorMessage ? `<div class="build-error">${escapeHTML(errorMessage)}</div>` : ''}

    <div class="build-actions">
      <button class="build-btn" ${!syntaxValid ? 'disabled' : ''} onclick="vscode.postMessage({type:'compileMCP',target:'typescript'})">
        <span class="build-btn-icon">&#9654;</span> Compile &rarr; TypeScript
      </button>
      <button class="build-btn" ${!syntaxValid ? 'disabled' : ''} onclick="vscode.postMessage({type:'compileMCP',target:'python'})">
        <span class="build-btn-icon">&#9654;</span> Compile &rarr; Python
      </button>
    </div>

    <div class="build-actions" style="margin-top:8px;">
      <button class="build-btn" style="background:var(--kern-surface);border:1px solid var(--border);" onclick="vscode.postMessage({type:'generateTests'})">
        <span class="build-btn-icon">&#9881;</span> Generate Security Tests
      </button>
    </div>

    <div class="build-hint">
      <span style="color:var(--text-muted);font-size:10px;">Compiled output is auto-reviewed with 12 OWASP MCP rules</span>
    </div>

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations, activeMode: 'build' });
}

export function buildCompilingHTML(fileName: string, target: string, animations = true): string {
  return buildShell(`
    <div class="server-header">
      <div class="server-name">${escapeHTML(fileName)}</div>
      <span class="lang-badge build">BUILD</span>
    </div>

    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:20px;">
      <div class="scanner">
        <div class="scanner-ring"></div>
        <div class="scanner-ring scanner-ring-1"></div>
        <div class="scanner-core"></div>
        <div class="scanner-sweep"></div>
      </div>
      <div style="font-size:11px;color:#525252;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;font-family:'SF Mono',monospace;">
        Compiling &rarr; ${escapeHTML(target)}<span class="scan-dots"></span>
      </div>
    </div>
  `, { animations, activeMode: 'build' });
}

export function buildBuildResultHTML(result: McpReviewResult, sourceFileName: string, safeFixRules?: Set<string>, configServers?: McpServerEntry[], animations = true): string {
  const { findings } = result;
  const bugs = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  const targetLabel = result.lang === 'python' ? 'Python' : 'TypeScript';

  return buildShell(`
    <div class="build-breadcrumb">
      <span class="breadcrumb-source">${escapeHTML(sourceFileName)}</span>
      <span class="breadcrumb-arrow">&rarr;</span>
      <span class="breadcrumb-target">${escapeHTML(result.fileName)}</span>
      <span class="lang-badge ${result.lang === 'python' ? 'py' : 'ts'}">${targetLabel}</span>
    </div>

    ${result.score ? buildScoreHero(result.score) : ''}

    <div class="summary">
      ${bugs.length > 0 ? `<div class="stat"><span class="stat-num bugs">${bugs.length}</span><span class="stat-label">Bug${bugs.length > 1 ? 's' : ''}</span></div>` : ''}
      ${warnings.length > 0 ? `${bugs.length > 0 ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num warns">${warnings.length}</span><span class="stat-label">Warning${warnings.length > 1 ? 's' : ''}</span></div>` : ''}
      ${info.length > 0 ? `${(bugs.length > 0 || warnings.length > 0) ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num infos">${info.length}</span><span class="stat-label">Note${info.length > 1 ? 's' : ''}</span></div>` : ''}
      ${findings.length === 0 ? '<div class="stat"><span class="stat-num clean">0</span><span class="stat-label">Issues</span></div>' : ''}
    </div>

    ${findings.length === 0 ? '<div class="clean-state"><div class="check">&#10003;</div><p>Compiled output is clean.<br>No vulnerabilities found.</p></div>' : ''}

    ${bugs.length > 0 ? '<div class="section-label" data-severity-section="error">Bugs</div>' : ''}
    ${bugs.map((f, i) => buildFindingHTMLSimple(f, i, result, safeFixRules)).join('')}

    ${warnings.length > 0 ? '<div class="section-label" data-severity-section="warning">Warnings</div>' : ''}
    ${warnings.map((f, i) => buildFindingHTMLSimple(f, i + bugs.length, result)).join('')}

    ${info.length > 0 ? '<div class="section-label" data-severity-section="info">Notes</div>' : ''}
    ${info.map((f, i) => buildFindingHTMLSimple(f, i + bugs.length + warnings.length, result)).join('')}

    ${configServers && configServers.length > 0 ? buildConfigGuardianSection(configServers) : ''}

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations, activeMode: 'build' });
}

function buildFindingHTMLSimple(f: import('./shared').ReviewFinding, index: number, result: McpReviewResult, safeFixRules?: Set<string>): string {
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
    actionBtns.push(`<button class="finding-action-btn fix-btn" data-action="applyFix" data-filepath="${escapeHTML(fp)}" data-line="${line}" data-ruleid="${escapeHTML(f.ruleId)}">&#9656; FIX</button>`);
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
