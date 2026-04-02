import { escapeHTML } from './shared';
import { buildShell } from './shell';

export function buildGenerateHTML(contextItems: { id: string; label: string; category: string; preview: string }[], engines: { id: string; label: string; available: boolean }[], animations = true): string {
  const categoryIcons: Record<string, string> = {
    project: '&#128230;',
    schema: '&#128451;',
    api: '&#9889;',
    env: '&#128273;',
    kern: '&#9733;',
    spec: '&#128196;',
  };

  const selected = engines.find(e => e.available) ?? engines[0];
  const selectedLabel = selected?.label ?? 'No AI';

  const engineOptions = engines.filter(e => e.available).map(e =>
    `<div class="engine-option${e.id === selected?.id ? ' active' : ''}" data-engine="${escapeHTML(e.id)}">${escapeHTML(e.label)}</div>`
  ).join('');

  const contextList = contextItems.length > 0
    ? contextItems.map(item => `
        <label class="context-item">
          <input type="checkbox" class="context-check" data-id="${escapeHTML(item.id)}" checked>
          <span class="context-icon">${categoryIcons[item.category] ?? '&#128196;'}</span>
          <span class="context-label">${escapeHTML(item.label)}</span>
          <span class="context-preview">${escapeHTML(item.preview)}</span>
        </label>`).join('')
    : '<div style="color:var(--text-muted);font-size:11px;padding:8px 0;">No project context found. Describe your server below.</div>';

  return buildShell(`
    <div class="server-header">
      <div class="server-name">Generate MCP Server</div>
      <div class="engine-picker" id="engine-picker">
        <button class="engine-badge" id="engine-badge" onclick="document.getElementById('engine-dropdown').classList.toggle('open')">
          ${escapeHTML(selectedLabel)} <span class="engine-caret">&#9662;</span>
        </button>
        <div class="engine-dropdown" id="engine-dropdown">
          ${engineOptions}
          <div class="engine-divider"></div>
          <div class="engine-option settings" onclick="vscode.postMessage({type:'openSettings'})">&#9881; AI Settings</div>
        </div>
      </div>
    </div>

    <input type="hidden" id="selected-engine" value="${escapeHTML(selected?.id ?? '')}">

    <div class="section-label">PROJECT CONTEXT</div>
    <div class="context-list">${contextList}</div>

    <div class="section-label" style="margin-top:12px;">DESCRIBE YOUR SERVER</div>
    <textarea id="gen-description" class="gen-textarea" placeholder="e.g. A Postgres CRUD server for users and posts, with JWT auth, rate limiting, and structured logging..." rows="5"></textarea>

    <div class="build-actions" style="margin-top:12px;">
      <button class="build-btn" id="gen-btn" onclick="
        const desc = document.getElementById('gen-description').value;
        const checks = document.querySelectorAll('.context-check:checked');
        const ids = Array.from(checks).map(c => c.dataset.id);
        const engineId = document.getElementById('selected-engine').value;
        vscode.postMessage({type:'generate', description: desc, contextIds: ids, engineId: engineId});
      ">
        <span class="build-btn-icon">&#10024;</span> Generate .kern <span class="beta-tag">BETA</span>
      </button>
    </div>

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations, activeMode: 'build' });
}

export function buildGeneratingHTML(animations = true): string {
  return buildShell(`
    <div class="server-header">
      <div class="server-name">Generate MCP Server</div>
      <span class="lang-badge build">AI</span>
    </div>

    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:20px;">
      <div class="scanner">
        <div class="scanner-ring"></div>
        <div class="scanner-ring scanner-ring-1"></div>
        <div class="scanner-ring scanner-ring-2"></div>
        <div class="scanner-core"></div>
        <div class="scanner-sweep"></div>
      </div>
      <div style="font-size:11px;color:#525252;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;font-family:'SF Mono',monospace;">
        Generating<span class="scan-dots"></span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);max-width:200px;text-align:center;line-height:1.5;">
        AI is writing your .kern MCP server with security guards...
      </div>
    </div>
  `, { animations, activeMode: 'build' });
}

export function buildImportModeHTML(fileName: string, lang: 'typescript' | 'python', animations = true): string {
  const targetLabel = lang === 'python' ? 'TypeScript' : 'Python';

  return buildShell(`
    <div class="server-header">
      <div class="server-name">${escapeHTML(fileName)}</div>
      <span class="lang-badge ${lang === 'python' ? 'py' : 'ts'}">${lang === 'python' ? 'Python' : 'TypeScript'}</span>
    </div>

    <div class="build-actions">
      <button class="build-btn" onclick="vscode.postMessage({type:'importToKern'})">
        <span class="build-btn-icon">&#10024;</span> Import to .kern <span class="beta-tag">BETA</span>
      </button>
      <button class="build-btn" onclick="vscode.postMessage({type:'convertTarget'})">
        <span class="build-btn-icon">&#8644;</span> Convert to ${escapeHTML(targetLabel)} <span class="beta-tag">BETA</span>
      </button>
    </div>

    <div class="build-hint">
      <span style="color:var(--text-muted);font-size:10px;">AI-assisted — review output before shipping</span>
    </div>

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations, activeMode: 'build' });
}

export function buildGenerateErrorHTML(message: string, engineLabel: string, animations = true): string {
  return buildShell(`
    <div class="server-header">
      <div class="server-name">Generate MCP Server</div>
      <span class="lang-badge build">${escapeHTML(engineLabel)}</span>
    </div>

    <div class="gen-error-box">
      <div class="gen-error-icon">&#10007;</div>
      <div class="gen-error-title">Generation failed</div>
      <div class="gen-error-msg">${escapeHTML(message)}</div>
    </div>

    <div class="build-actions">
      <button class="build-btn" onclick="vscode.postMessage({type:'scanContext'})">
        <span class="build-btn-icon">&#8592;</span> Try again
      </button>
      <button class="build-btn" style="border-color:var(--border);color:var(--text-muted);" onclick="vscode.postMessage({type:'openSettings'})">
        <span class="build-btn-icon">&#9881;</span> AI Settings
      </button>
    </div>

    <div class="footer"><span class="brand-kern-sm">KERN</span> <span class="brand-mcp-sm">MCP</span> · <a href="https://kernlang.dev" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border);">kernlang.dev</a></div>
  `, { animations, activeMode: 'build' });
}
