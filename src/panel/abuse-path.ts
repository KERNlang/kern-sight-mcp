import type { IRNode } from './shared';
import { escapeHTML } from './shared';

export interface AbusePath {
  toolName: string;
  effectKind: string;
  effectLine?: number;
  missingGuards: string[];
  severity: 'critical' | 'high' | 'medium';
}

const EFFECT_GUARD_MAP: Record<string, string[]> = {
  'fs': ['pathContainment'],
  'file-read': ['pathContainment'],
  'file-write': ['pathContainment'],
  'shell-exec': ['sanitize'],
  'network': ['sanitizeOutput'],
  'db': ['sanitize'],
};

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium'> = {
  'shell-exec': 'critical',
  'fs': 'high',
  'file-read': 'high',
  'file-write': 'high',
  'network': 'medium',
  'db': 'high',
};

const KIND_LABELS: Record<string, string> = {
  'fs': 'File System',
  'file-read': 'File Read',
  'file-write': 'File Write',
  'shell-exec': 'Shell Execution',
  'network': 'Network Request',
  'db': 'Database Query',
};

const KIND_ICONS: Record<string, string> = {
  'fs': '&#9112;',
  'file-read': '&#9112;',
  'file-write': '&#9998;',
  'shell-exec': '&#9656;',
  'network': '&#8645;',
  'db': '&#9638;',
};

export function computeAbusePaths(irNodes: IRNode[]): AbusePath[] {
  const paths: AbusePath[] = [];

  for (const node of irNodes) {
    if (node.type !== 'action') continue;
    const toolName = (node.props?.name as string) || 'unknown';
    const children = node.children ?? [];
    const guards = children.filter(c => c.type === 'guard');
    const effects = children.filter(c => c.type === 'effect');
    const guardKinds = new Set(guards.map(g => (g.props?.kind as string) || ''));

    for (const effect of effects) {
      const effectKind = (effect.props?.kind as string) || 'unknown';
      const requiredGuards = EFFECT_GUARD_MAP[effectKind] || [];
      const missing = requiredGuards.filter(g => !guardKinds.has(g));

      if (missing.length > 0) {
        paths.push({
          toolName,
          effectKind,
          effectLine: effect.loc?.line,
          missingGuards: missing,
          severity: SEVERITY_MAP[effectKind] || 'medium',
        });
      }
    }
  }

  // Sort: critical first, then high, then medium
  const order = { critical: 0, high: 1, medium: 2 };
  paths.sort((a, b) => order[a.severity] - order[b.severity]);
  return paths;
}

export function buildAbusePathSection(irNodes: IRNode[], filePath?: string): string {
  const paths = computeAbusePaths(irNodes);
  if (paths.length === 0) return '';

  const fp = filePath ? escapeHTML(filePath) : '';

  const cards = paths.map(p => {
    const icon = KIND_ICONS[p.effectKind] ?? '&#9679;';
    const label = KIND_LABELS[p.effectKind] ?? p.effectKind;
    const sevClass = p.severity === 'critical' ? 'bug' : p.severity === 'high' ? 'warn' : 'info';
    const guardList = p.missingGuards.map(g => `<code>${escapeHTML(g)}</code>`).join(', ');
    const line = p.effectLine ?? 1;
    const lineRef = p.effectLine ? ` <span class="abuse-line">L${p.effectLine}</span>` : '';
    const clickAttr = fp ? `class="abuse-card finding ${sevClass}" data-line="${line}" data-col="1" data-filepath="${fp}" style="cursor:pointer"` : `class="abuse-card ${sevClass}"`;

    return `<div ${clickAttr}>
      <div class="abuse-header">
        <span class="abuse-icon">${icon}</span>
        <span class="abuse-tool">${escapeHTML(p.toolName)}</span>${lineRef}
      </div>
      <div class="abuse-flow">
        <span class="abuse-step param">input</span>
        <span class="abuse-arrow">&#8594;</span>
        <span class="abuse-step effect">${escapeHTML(label)}</span>
        <span class="abuse-arrow">&#8594;</span>
        <span class="abuse-step missing">no ${guardList}</span>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="section-label">ABUSE PATHS</div>
    <div class="abuse-summary">${paths.length} unprotected path${paths.length !== 1 ? 's' : ''}</div>
    <div class="abuse-list">${cards}</div>`;
}
