import { gradeColor } from '@kernlang/review-mcp';
import type { IRNode, McpReviewResult, SecurityScore } from './shared';
import { escapeHTML } from './shared';
import type { ScoreDiff } from '../score-history';
import type { McpServerEntry } from '../config-guardian';
import { buildPermissionManifest } from '../permission-manifest';
import { buildShell } from './shell';
import { buildConfigGuardianSection } from './guardian';
import { buildAbusePathSection } from './abuse-path';

export function buildReviewHTML(result: McpReviewResult, safeFixRules?: Set<string>, configServers?: McpServerEntry[], animations = true, scoreDiff?: ScoreDiff | null): string {
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

    ${result.score ? buildScoreHero(result.score, scoreDiff) : ''}

    <div class="summary">
      ${bugs.length > 0 ? `<div class="stat"><span class="stat-num bugs">${bugs.length}</span><span class="stat-label">Bug${bugs.length > 1 ? 's' : ''}</span></div>` : ''}
      ${warnings.length > 0 ? `${bugs.length > 0 ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num warns">${warnings.length}</span><span class="stat-label">Warning${warnings.length > 1 ? 's' : ''}</span></div>` : ''}
      ${info.length > 0 ? `${(bugs.length > 0 || warnings.length > 0) ? '<div class="divider"></div>' : ''}<div class="stat"><span class="stat-num infos">${info.length}</span><span class="stat-label">Note${info.length > 1 ? 's' : ''}</span></div>` : ''}
      ${findings.length === 0 ? '<div class="stat"><span class="stat-num clean">0</span><span class="stat-label">Issues</span></div>' : ''}
    </div>

    ${irNodes.length > 0 ? buildIRSection(irNodes, result.score) : ''}

    ${irNodes.length > 0 ? buildPermissionSection(irNodes) : ''}

    ${irNodes.length > 0 ? buildAbusePathSection(irNodes, result.filePath) : ''}

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

export function buildScoreHero(score: SecurityScore, scoreDiff?: ScoreDiff | null): string {
  const color = gradeColor(score.grade);
  const circumference = 2 * Math.PI * 34;
  const dashLength = (score.total / 100) * circumference;

  let diffBadge = '';
  if (scoreDiff && scoreDiff.delta !== 0) {
    const sign = scoreDiff.delta > 0 ? '+' : '';
    const cls = scoreDiff.delta > 0 ? 'positive' : 'negative';
    diffBadge = `<span class="score-diff ${cls}">${sign}${scoreDiff.delta}</span>`;
  }

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
        ${diffBadge}
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

function buildFindingHTML(f: import('./shared').ReviewFinding, index: number, result: McpReviewResult, safeFixRules?: Set<string>): string {
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
  for (const node of result.irNodes) {
    if (node.type === 'action' && node.props?.name) {
      break;
    }
  }
  return result.fileName;
}

function buildPermissionSection(irNodes: IRNode[]): string {
  const manifest = buildPermissionManifest(irNodes);
  const kinds = Object.keys(manifest.byKind);
  if (kinds.length === 0) return '';

  const kindIcons: Record<string, string> = {
    'file-read': '&#128196;', 'file-write': '&#9997;', 'shell-exec': '&#9000;',
    'network-fetch': '&#127760;', 'database-query': '&#128451;',
  };

  const cards = kinds.map(kind => {
    const { guarded, unguarded } = manifest.byKind[kind];
    const total = guarded + unguarded;
    const icon = kindIcons[kind] ?? '&#9889;';
    const cls = unguarded > 0 ? 'unguarded' : 'guarded';
    return `<div class="perm-card ${cls}">
      <span class="perm-icon">${icon}</span>
      <span class="perm-kind">${escapeHTML(kind)}</span>
      <span class="perm-count">${guarded}/${total}</span>
    </div>`;
  }).join('');

  return `
    <div class="section-label">PERMISSIONS</div>
    <div class="perm-grid">${cards}</div>`;
}
