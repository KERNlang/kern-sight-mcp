# KERN MCP Security

**Security scanner for MCP (Model Context Protocol) servers** — find vulnerabilities before your AI agent goes live.

11 rules mapped to the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/). Supports TypeScript and Python MCP servers.

<!-- ![KERN MCP Security Screenshot](media/screenshot.png) -->

## Features

### Automatic MCP Server Detection

Open any file that imports `@modelcontextprotocol/sdk` (TypeScript) or `mcp.server` (Python) — the extension activates automatically. Non-MCP files are silently ignored.

### KERN IR Visualization

The sidebar shows your MCP server's security structure as a KERN IR tree:

- **Actions** — each `server.tool()` or `@mcp.tool()` handler
- **Effects** — dangerous operations (shell exec, file I/O, network, database)
- **Guards** — validation, path containment, auth checks

Actions are color-coded:
- **GUARDED** (green) — effects have preceding guards
- **UNGUARDED** (red) — effects with no guards = vulnerability

Each action shows a confidence score based on its guard/effect ratio.

### 11 Security Rules (OWASP MCP Top 10)

| Rule | OWASP | What it catches |
|------|-------|-----------------|
| `mcp-command-injection` | MCP01 | User params flowing to shell commands |
| `mcp-path-traversal` | MCP02 | File ops with unvalidated paths |
| `mcp-tool-poisoning` | MCP03 | Hidden instructions in tool descriptions |
| `mcp-secrets-exposure` | MCP04 | Hardcoded keys/tokens in server code |
| `mcp-unsanitized-response` | MCP05 | Raw external data returned to LLM |
| `mcp-missing-validation` | MCP06 | Tool params used without validation |
| `mcp-missing-auth` | MCP07 | HTTP/SSE server without auth |
| `mcp-typosquatting` | MCP08 | Suspicious package name similarity |
| `mcp-data-injection` | MCP09 | Hidden instructions in string literals |
| `mcp-ir-unguarded-effect` | Structural | Effects without guards (KERN IR) |
| `mcp-ir-low-confidence` | Structural | Low guard/effect ratio |

### Inline Diagnostics

Findings appear as VS Code diagnostics with severity levels, quick-fix suggestions, and jump-to-line from the sidebar.

### Zero Config

No setup required. Install and open an MCP server file. That's it.

## Usage

1. Install the extension
2. Open an MCP server file (TypeScript or Python)
3. The sidebar shows findings and the KERN IR tree
4. Click any finding to jump to the line
5. Use `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux) to scan manually

Right-click in any TS/JS/Python file for "KERN: Scan MCP Server" in the context menu.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `kernMcpSecurity.enabled` | `true` | Enable/disable scanning |
| `kernMcpSecurity.severity` | `"all"` | Filter: `all`, `errors`, `warnings` |

Project-level config via `.mcpsecurityrc.json`:

```json
{
  "enabled": true,
  "severity": "errors"
}
```

## Architecture

All analysis runs in **worker threads** — the editor stays fast. The extension bundles `@kernlang/review-mcp` which combines:

- **Regex-based rules** — fast pattern matching for known vulnerability patterns
- **KERN IR inference** — translates MCP server code to KERN's intermediate representation, then checks structural invariants (effects must have guards)

No network calls. No telemetry. Everything runs locally.

## Requirements

- VS Code 1.85+
- MCP server files using `@modelcontextprotocol/sdk` (TypeScript) or `mcp.server` / `FastMCP` (Python)

## Links

- [KERN Language](https://kernlang.dev)
- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
- [Report Issues](https://github.com/KERNlang/kern-sight-mcp/issues)

## License

MIT
