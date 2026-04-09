import { PANEL_CSS } from '../panel-styles';
import { escapeHTML } from './shared';
import type { McpServerEntry } from '../config-guardian';
import { buildConfigGuardianSection } from './guardian';

export { escapeHTML };

export function buildShell(content: string, options?: { animations?: boolean; activeMode?: 'review' | 'build' }): string {
  const noAnim = options?.animations === false;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${PANEL_CSS}</style>
</head>
<body class="${noAnim ? 'no-animations' : ''}">

<div class="mode-tabs">
  <button class="mode-tab ${options?.activeMode !== 'build' ? 'active' : ''}" data-mode="review">REVIEW</button>
  <button class="mode-tab ${options?.activeMode === 'build' ? 'active' : ''}" data-mode="build">BUILD</button>
</div>

<div class="flow-rail"><div class="flow-rail-bg"></div><div class="flow-rail-energy"></div></div>

${options?.activeMode !== 'build' ? `<div class="filter-bar">
  <button class="filter-btn active" data-filter="all">ALL</button>
  <button class="filter-btn" data-filter="error">BUGS</button>
  <button class="filter-btn" data-filter="warning">WARNINGS</button>
  <button class="filter-btn" data-filter="info">INFO</button>
</div>` : ''}

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

    // Engine picker
    const engineOpt = e.target.closest('.engine-option:not(.settings)');
    if (engineOpt) {
      document.querySelectorAll('.engine-option').forEach(o => o.classList.remove('active'));
      engineOpt.classList.add('active');
      const badge = document.getElementById('engine-badge');
      const hidden = document.getElementById('selected-engine');
      if (badge) badge.innerHTML = engineOpt.textContent + ' <span class="engine-caret">&#9662;</span>';
      if (hidden) hidden.value = engineOpt.dataset.engine;
      document.getElementById('engine-dropdown')?.classList.remove('open');
      return;
    }

    // Close dropdown on outside click
    if (!e.target.closest('.engine-picker')) {
      document.getElementById('engine-dropdown')?.classList.remove('open');
    }

    const modeTab = e.target.closest('.mode-tab');
    if (modeTab) {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      modeTab.classList.add('active');
      vscode.postMessage({ type: 'switchMode', mode: modeTab.dataset.mode });
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

export function buildLoadingHTML(animations = true): string {
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

export function buildNotMcpHTML(configServers?: McpServerEntry[], animations = true, inspection?: import('./guardian').InspectionDisplay[], pinStatus?: import('./guardian').PinStatus): string {
  return buildShell(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 16px;text-align:center;gap:16px;">
      <div class="header-brand"><span class="kern">KE<span class="kern-underline"></span>RN</span> <span class="mcp">MCP</span></div>
      <p style="font-size:12px;color:var(--text-secondary);line-height:1.6;max-width:260px;">This file is not an MCP server.<br><br>Open a file that imports<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">@modelcontextprotocol/sdk</code><br>or<br><code style="font-size:11px;color:var(--kern-orange);background:rgba(249,115,22,0.1);padding:2px 6px;border-radius:3px;">mcp.server</code></p>
      <a class="create-kern-link" onclick="vscode.postMessage({type:'createKern'})">or generate a .kern server with AI &rarr;</a>
    </div>
    ${configServers && configServers.length > 0 ? buildConfigGuardianSection(configServers, inspection, pinStatus) : ''}
  `, { animations });
}
