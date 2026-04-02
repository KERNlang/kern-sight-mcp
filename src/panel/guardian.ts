import type { McpServerEntry } from '../config-guardian';
import { escapeHTML } from './shared';

export function buildConfigGuardianSection(servers: McpServerEntry[]): string {
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
