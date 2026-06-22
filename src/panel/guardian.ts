import type { McpServerEntry } from '../config-guardian';
import { escapeHTML } from './shared';

export interface InspectionDisplay {
  serverName: string;
  status: 'ok' | 'error' | 'timeout';
  toolCount: number;
  findingCount: number;
  tools: string[];
  findings: { pattern: string; toolName: string; message: string; severity: 'error' | 'warning' }[];
}

export interface PinStatus {
  pinned: boolean;
  driftCount: number;
  drifts: { serverName: string; toolName: string; field: string; message: string; severity: 'error' | 'warning' }[];
}

export function buildConfigGuardianSection(servers: McpServerEntry[], inspection?: InspectionDisplay[], pinStatus?: PinStatus): string {
  const trustIcon = (trust: string) => {
    if (trust === 'verified') return '<span class="guardian-trust verified">&#9679;</span>';
    if (trust === 'risky') return '<span class="guardian-trust risky">&#9679;</span>';
    return '<span class="guardian-trust unknown">&#9679;</span>';
  };

  const sourceLabel = (source: string) => {
    if (source === 'claude') return 'Claude Desktop';
    if (source === 'cursor') return 'Cursor';
    if (source === 'windsurf') return 'Windsurf';
    return 'VS Code';
  };

  const inspectionByName = new Map((inspection ?? []).map(i => [i.serverName, i]));

  const serverCards = servers.map((s) => {
    const issueList = s.issues.map((issue) => {
      const sevClass = issue.severity === 'error' ? 'bug' : issue.severity === 'warning' ? 'warn' : 'info';
      return `<div class="guardian-issue ${sevClass}"><span class="guardian-issue-icon">${issue.severity === 'error' ? '&#9650;' : '&#9679;'}</span>${escapeHTML(issue.message)}</div>`;
    }).join('');

    // Inspection results for this server
    const insp = inspectionByName.get(s.name);
    let inspectionHtml = '';
    if (insp) {
      if (insp.status === 'ok') {
        const toolList = insp.tools.length > 0
          ? `<div class="guardian-tools">${insp.toolCount} tool${insp.toolCount !== 1 ? 's' : ''}: ${insp.tools.slice(0, 6).map(t => `<code>${escapeHTML(t)}</code>`).join(', ')}${insp.tools.length > 6 ? ', ...' : ''}</div>`
          : '';
        const findingList = insp.findings.map(f => {
          const sevClass = f.severity === 'error' ? 'bug' : 'warn';
          return `<div class="guardian-issue ${sevClass}"><span class="guardian-issue-icon">&#9888;</span>[${escapeHTML(f.pattern)}] ${escapeHTML(f.toolName)}: ${escapeHTML(f.message)}</div>`;
        }).join('');
        inspectionHtml = toolList + findingList;
      } else {
        inspectionHtml = `<div class="guardian-issue warn"><span class="guardian-issue-icon">&#9679;</span>Inspection ${insp.status}</div>`;
      }
    }

    return `
      <div class="guardian-server">
        <div class="guardian-server-header">
          ${trustIcon(s.trust)}
          <span class="guardian-server-name">${escapeHTML(s.name)}</span>
          <span class="guardian-source">${sourceLabel(s.source)}</span>
        </div>
        <div class="guardian-cmd">${escapeHTML(s.command)} ${s.args.map(a => escapeHTML(a)).join(' ')}</div>
        ${issueList ? `<div class="guardian-issues">${issueList}</div>` : ''}
        ${inspectionHtml}
        ${!issueList && !inspectionHtml ? '<div class="guardian-clean">No issues</div>' : ''}
      </div>`;
  }).join('');

  const issueCount = servers.reduce((sum, s) => sum + s.issues.length, 0);
  const riskyCount = servers.filter(s => s.trust === 'risky').length;
  const inspFindingCount = (inspection ?? []).reduce((sum, i) => sum + i.findingCount, 0);

  // Pin status section
  let pinHtml = '';
  if (pinStatus) {
    if (pinStatus.pinned && pinStatus.driftCount === 0) {
      pinHtml = '<div class="guardian-pin-ok" style="margin-top:8px;font-size:10px;color:var(--kern-green);">&#9632; Pinned — no drift</div>';
    } else if (pinStatus.pinned && pinStatus.driftCount > 0) {
      const driftItems = pinStatus.drifts.map(d => {
        const sevClass = d.severity === 'error' ? 'bug' : 'warn';
        return `<div class="guardian-issue ${sevClass}"><span class="guardian-issue-icon">&#9650;</span>${escapeHTML(d.serverName)}/${escapeHTML(d.toolName)}: ${escapeHTML(d.message)}</div>`;
      }).join('');
      pinHtml = `<div style="margin-top:8px;"><div class="guardian-issue bug"><span class="guardian-issue-icon">&#9650;</span>${pinStatus.driftCount} drift(s) — tools changed since pinned</div>${driftItems}</div>`;
    }
  }

  return `
    <div class="section-label" style="margin-top:24px;">MY MCP SERVERS</div>
    <div class="guardian-summary">
      <span class="guardian-stat">${servers.length} server${servers.length !== 1 ? 's' : ''}</span>
      ${issueCount > 0 ? `<span class="guardian-stat warn">${issueCount} config issue${issueCount !== 1 ? 's' : ''}</span>` : ''}
      ${inspFindingCount > 0 ? `<span class="guardian-stat risky">${inspFindingCount} poisoning finding${inspFindingCount !== 1 ? 's' : ''}</span>` : ''}
      ${riskyCount > 0 ? `<span class="guardian-stat risky">${riskyCount} risky</span>` : ''}
    </div>
    <div class="guardian-list">${serverCards}</div>
    ${pinHtml}
    <div class="guardian-actions" style="display:flex;gap:6px;margin-top:10px;">
      <button class="build-btn guardian-action-btn" id="inspect-btn" style="flex:1;font-size:10px;padding:5px 8px;background:var(--kern-surface);border:1px solid var(--border);" onclick="this.innerHTML='&#9676; Scanning...';this.disabled=true;vscode.postMessage({type:'inspectServers'})">
        &#9655; Inspect Servers
      </button>
      <button class="build-btn guardian-action-btn" id="pin-btn" style="flex:1;font-size:10px;padding:5px 8px;background:var(--kern-surface);border:1px solid var(--border);" onclick="this.innerHTML='&#9676; ${pinStatus?.pinned ? 'Verifying' : 'Pinning'}...';this.disabled=true;vscode.postMessage({type:'${pinStatus?.pinned ? 'verifyPins' : 'pinTools'}'})">
        ${pinStatus?.pinned ? '&#9632; Verify Pins' : '&#9654; Pin Tools'}
      </button>
    </div>
    <div class="guardian-hint" style="font-size:9px;color:var(--text-muted);margin-top:4px;line-height:1.4;">Inspect connects to your servers and checks for poisoning. Pin saves a snapshot to detect future changes.</div>`;
}
