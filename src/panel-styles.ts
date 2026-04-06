export const PANEL_CSS = `
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

  /* -- Score diff badge -- */

  .score-diff {
    position: absolute;
    bottom: -2px;
    right: -4px;
    font-size: 9px;
    font-weight: 800;
    font-family: 'SF Mono', monospace;
    padding: 1px 5px;
    border-radius: 8px;
    line-height: 1.4;
  }

  .score-diff.positive { background: rgba(34, 197, 94, 0.15); color: var(--kern-green); }
  .score-diff.negative { background: rgba(239, 68, 68, 0.15); color: var(--kern-red); }

  /* -- Permission manifest -- */

  .perm-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
  }

  .perm-card {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 10px;
    font-family: 'SF Mono', monospace;
    animation: fadeSlideIn 0.4s ease-out both;
  }

  .perm-card.guarded { border-color: rgba(34, 197, 94, 0.2); }
  .perm-card.unguarded { border-color: rgba(239, 68, 68, 0.2); }

  .perm-icon { font-size: 11px; }
  .perm-kind { color: var(--text-secondary); }

  .perm-count {
    margin-left: auto;
    font-weight: 700;
    font-size: 9px;
  }

  .perm-card.guarded .perm-count { color: var(--kern-green); }
  .perm-card.unguarded .perm-count { color: var(--kern-red); }

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
    word-break: break-word;
    overflow-wrap: break-word;
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
    word-break: break-word;
    overflow-wrap: break-word;
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

  /* -- Build Mode -- */

  .build-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    font-family: 'SF Mono', monospace;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }

  .build-status.valid {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: var(--kern-green);
  }

  .build-status.error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--kern-red);
  }

  .build-status-icon { font-size: 13px; }

  .build-error {
    font-size: 10px;
    color: var(--kern-red);
    background: rgba(239, 68, 68, 0.06);
    padding: 8px 10px;
    border-radius: 4px;
    margin-bottom: 12px;
    font-family: 'SF Mono', monospace;
    line-height: 1.5;
    word-break: break-word;
  }

  .build-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .build-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 6px;
    border: 1px solid rgba(249, 115, 22, 0.3);
    background: rgba(249, 115, 22, 0.06);
    color: var(--kern-orange);
    font-size: 12px;
    font-weight: 600;
    font-family: 'SF Mono', monospace;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.2s;
  }

  .build-btn:hover:not(:disabled) {
    background: rgba(249, 115, 22, 0.12);
    border-color: var(--kern-orange);
  }

  .build-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .build-btn-icon { font-size: 10px; }

  .build-hint {
    text-align: center;
    margin-bottom: 16px;
  }

  .lang-badge.build {
    background: rgba(249, 115, 22, 0.15);
    color: var(--kern-orange);
  }

  .create-kern-link {
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px solid var(--border);
    transition: color 0.2s;
  }

  .create-kern-link:hover {
    color: var(--kern-orange);
    border-bottom-color: var(--kern-orange);
  }

  /* -- Build Result Breadcrumb -- */

  .build-breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    margin-bottom: 12px;
    font-size: 11px;
    font-family: 'SF Mono', monospace;
  }

  .breadcrumb-source {
    color: var(--text-muted);
  }

  .breadcrumb-arrow {
    color: var(--kern-orange);
    font-size: 12px;
  }

  .breadcrumb-target {
    color: var(--text);
    font-weight: 600;
  }

  /* -- Mode Tabs -- */

  .mode-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    margin: -16px -16px 12px -16px;
    padding: 0 16px;
    background: var(--surface);
  }

  .mode-tab {
    flex: 1;
    padding: 10px 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-family: 'SF Mono', monospace;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .mode-tab:hover {
    color: var(--text-secondary);
  }

  .mode-tab.active {
    color: var(--kern-orange);
    border-bottom-color: var(--kern-orange);
  }

  /* -- Beta Tag -- */

  .beta-tag {
    font-size: 7px;
    font-weight: 800;
    letter-spacing: 0.1em;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(249, 115, 22, 0.15);
    color: var(--kern-orange);
    vertical-align: middle;
    margin-left: 4px;
  }

  /* -- Engine Picker -- */

  .engine-picker {
    position: relative;
  }

  .engine-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(249, 115, 22, 0.15);
    color: var(--kern-orange);
    font-size: 10px;
    font-weight: 700;
    font-family: 'SF Mono', monospace;
    letter-spacing: 0.03em;
    border: 1px solid rgba(249, 115, 22, 0.25);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .engine-badge:hover {
    background: rgba(249, 115, 22, 0.25);
    border-color: var(--kern-orange);
  }

  .engine-caret {
    font-size: 8px;
    opacity: 0.7;
  }

  .engine-dropdown {
    display: none;
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .engine-dropdown.open {
    display: block;
  }

  .engine-option {
    padding: 7px 10px;
    font-size: 11px;
    font-family: 'SF Mono', monospace;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .engine-option:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .engine-option.active {
    color: var(--kern-orange);
  }

  .engine-option.settings {
    color: var(--text-muted);
    font-size: 10px;
  }

  .engine-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  /* -- Generate Error -- */

  .gen-error-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 32px 16px;
    gap: 8px;
  }

  .gen-error-icon {
    font-size: 28px;
    color: var(--kern-red);
    margin-bottom: 4px;
  }

  .gen-error-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }

  .gen-error-msg {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
    max-width: 260px;
    word-break: break-word;
  }

  /* -- Generate Mode -- */

  .context-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.15s;
  }

  .context-item:hover { background: var(--surface); }

  .context-check {
    accent-color: var(--kern-orange);
    margin: 0;
  }

  .context-icon { font-size: 12px; flex-shrink: 0; }

  .context-label {
    color: var(--text);
    font-family: 'SF Mono', monospace;
    font-size: 10px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-preview {
    color: var(--text-muted);
    font-size: 9px;
    flex-shrink: 0;
  }

  .gen-textarea {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px;
    padding: 10px;
    resize: vertical;
    line-height: 1.5;
    outline: none;
    transition: border-color 0.2s;
  }

  .gen-textarea:focus {
    border-color: var(--kern-orange);
  }

  .gen-textarea::placeholder {
    color: var(--text-muted);
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

  /* -- Prompt suggestions -- */
  .suggestion-chips { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
  .suggestion-chip { background: var(--kern-surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 11px; color: var(--foreground); cursor: pointer; text-align: left; line-height: 1.4; transition: border-color 0.15s; }
  .suggestion-chip:hover { border-color: var(--kern-orange); }

  /* -- Scanned files -- */
  .scanned-list { display: flex; flex-direction: column; gap: 2px; }
  .scanned-file { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .scanned-file:hover { background: var(--kern-surface); }
  .scanned-file.current { background: rgba(96, 165, 250, 0.1); border-left: 2px solid var(--kern-blue); }
  .scanned-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 10px; }
  .scanned-grade { font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: var(--kern-surface); }
  .scanned-count { font-size: 10px; font-weight: 600; min-width: 16px; text-align: right; }
  .scanned-count.clean { color: var(--kern-green); }
  .scanned-count.warns { color: var(--kern-yellow); }

  /* -- Abuse paths -- */
  .abuse-summary { color: var(--kern-muted); font-size: 11px; margin: 4px 0 8px; }
  .abuse-list { display: flex; flex-direction: column; gap: 8px; }
  .abuse-card { background: var(--kern-surface); border-radius: 8px; padding: 10px 12px; border-left: 3px solid var(--kern-muted); }
  .abuse-card.bug { border-left-color: var(--kern-red); }
  .abuse-card.warn { border-left-color: var(--kern-yellow); }
  .abuse-card.info { border-left-color: var(--kern-blue); }
  .abuse-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .abuse-icon { font-size: 14px; }
  .abuse-tool { font-weight: 600; font-size: 12px; }
  .abuse-line { color: var(--kern-muted); font-size: 10px; }
  .abuse-flow { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 11px; }
  .abuse-step { padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 10px; }
  .abuse-step.param { background: rgba(96, 165, 250, 0.15); color: var(--kern-blue); }
  .abuse-step.effect { background: rgba(251, 191, 36, 0.15); color: var(--kern-yellow); }
  .abuse-step.missing { background: rgba(239, 68, 68, 0.15); color: var(--kern-red); font-weight: 600; }
  .abuse-arrow { color: var(--kern-muted); font-size: 12px; }

  /* -- No-animation mode -- */
  .no-animations,
  .no-animations * {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
  }
  .no-animations .flow-rail-energy { display: none; }
  .no-animations .pulse-ring { display: none; }
`;
