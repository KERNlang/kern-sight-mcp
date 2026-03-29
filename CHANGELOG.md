# Changelog

## 1.0.0 (2026-03-27)

First stable release.

### Security Scanner
- **13 security rules** mapped to OWASP MCP Top 10
- Per-finding confidence scores
- TypeScript + Python support
- Automatic MCP server detection

### Security Score (0-100)
- 4-metric formula: Guard Coverage (40%), Input Validation (25%), Rule Compliance (20%), Auth Posture (15%)
- Grades: A (90+), B (75+), C (60+), D (40+), F (<40)
- Per-tool scores and grades

### VS Code Extension
- Sidebar with score hero, KERN IR tree, findings list
- Inline diagnostics with quick-fix suggestions
- 6 one-click autofixes for TypeScript + Python
- Config Guardian: scans MCP config files for hardcoded secrets, missing version pins, wide permissions
- Badge command for README integration
- Animation toggle setting (`kernMcpSecurity.animations`)
- Correct language badges (JavaScript vs TypeScript)

### CLI
- `npx @kernlang/review-mcp` — scan from command line
- Output formats: text, JSON, SARIF 2.1.0
- `--threshold N` — CI quality gate
- `--scan-config` — scan MCP configuration files
- `--lock` / `--verify` — tool pinning for rug-pull detection
- `--help`, `--version` flags

### GitHub Action
- `ci/action.yml` — composite action for CI pipelines
- SARIF upload to GitHub Code Scanning
- Auto-updating PR comments with score badge

### Security Fixes
- `@latest` correctly flagged as NOT a version pin
- Lockfile verification hardened against corrupted/tampered files
- SARIF reports include actual scanner version

### Build
- Minified production bundles (~6.4MB per entry)
- npm package 4.6MB (was 17MB)
- VSIX 4.5MB (was 16MB)
- 56 tests across 3 test suites

### License
- AGPL-3.0 with commercial clause

---

## 0.2.0 (2026-03-20)

- 13 security rules mapped to OWASP MCP Top 10
- Per-finding confidence scores
- SSRF and secret-leakage autofixes
- Security Score engine with 4 weighted metrics
- VS Code sidebar with score hero, IR tree, findings
- Config Guardian UI
- Python autofixes
- Badge command + README integration

## 0.1.0 (2026-03-15)

- Initial release
- 6 security rules
- VS Code extension with diagnostics
- Basic autofix support
