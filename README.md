# KERN MCP — Build, Review & Secure MCP Servers

**Write .kern, compile to secure MCP servers, auto-review with 13 OWASP rules.**

Build and secure [Model Context Protocol](https://modelcontextprotocol.io) servers. Write `.kern` and compile to TypeScript or Python with security guards auto-injected. Scan existing MCP servers with 13 rules mapped to the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/). Extension for VS Code and compatible editors (Cursor, Windsurf, Antigravity) + CLI + GitHub Action.

Powered by [KERN](https://kernlang.dev) — the structural language for AI-generated code.

![MCP Security Scanner — VS Code sidebar with security score, KERN IR tree, and vulnerability findings](media/screenshot.png)

## Why

Every AI tool is adding MCP support. Security scanning hasn't kept up. MCP servers handle file I/O, shell commands, network requests, and database queries — all triggered by LLM tool calls. One missing input validation and your agent becomes an attack surface.

KERN MCP takes two approaches:
1. **Review** — scan existing MCP servers and find vulnerabilities at development time
2. **Build** — write `.kern` and compile to MCP servers with security guards injected by construction

## Build MCP Servers

### Write .kern, compile to secure MCP servers

```kern
mcp name=MyAPI version=1.0

  tool name=search
    description text="Search for items"
    param name=query type=string required=true
    param name=limit type=number default=10
    guard type=sanitize param=query
    guard type=validate param=limit min=1 max=100
    guard type=rateLimit window=60000 requests=100
    handler <<<
      const results = await db.search(args.query, args.limit);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    >>>
```

Click **Compile -> TypeScript** or **Compile -> Python** in the sidebar. The transpiler auto-injects:
- Zod validation from `param` definitions
- 7 security guards: `sanitize`, `pathContainment`, `validate`, `auth`, `rateLimit`, `sizeLimit`, `sanitizeOutput`
- Structured JSON logging on every call
- Error handling with `isError` responses

Compiled output is auto-reviewed with the 13 OWASP rules.

### AI-Powered Generation (Beta)

Describe what you want, pick your AI engine, get a production `.kern` server:

1. Click the **BUILD** tab in the sidebar
2. The extension auto-detects installed AI CLIs (Claude, Ollama, Codex, Gemini, Aider, OpenCode)
3. Select context from your workspace (package.json, database schemas, API routes, OpenAPI specs)
4. Describe your server — "Postgres CRUD for users and posts, with JWT auth and rate limiting"
5. Click **Generate .kern** — AI writes the server with guards
6. Review, edit, compile, done

Also supports:
- **Import to .kern** — convert existing TS/Python MCP servers to `.kern` with guards added
- **Convert TS <-> Python** — direct AI translation between languages

### .kern Language Support

- Syntax highlighting (TextMate grammar)
- Validation-on-save with inline error diagnostics
- Right-click context menu for compile/validate

## Review MCP Servers

### Security Score (0-100)

Every MCP server gets a security score based on four weighted metrics:

| Metric | Weight | What it measures |
|--------|--------|-----------------|
| Guard Coverage | 40% | % of effects with preceding guards |
| Input Validation | 25% | % of tool handlers with validation |
| Rule Compliance | 20% | Penalty per critical/warning finding |
| Auth Posture | 15% | Auth guards on HTTP/SSE transport |

Grades: **A** (90+), **B** (75+), **C** (60+), **D** (40+), **F** (<40)

### 13 Security Rules (OWASP MCP Top 10)

| Rule | OWASP | What it catches |
|------|-------|-----------------|
| `mcp-command-injection` | #04 | User params flowing to shell commands |
| `mcp-path-traversal` | #02 | File ops with unvalidated paths |
| `mcp-tool-poisoning` | #03 | Hidden instructions in tool descriptions |
| `mcp-secrets-exposure` | #04 | Hardcoded keys/tokens in server code |
| `mcp-unsanitized-response` | #05 | Raw external data / XML returned to LLM |
| `mcp-missing-validation` | #06 | Tool params used without validation |
| `mcp-missing-auth` | #07 | HTTP/SSE server without auth |
| `mcp-typosquatting` | #08 | Suspicious package name similarity |
| `mcp-data-injection` | #09 | Hidden instructions in string literals |
| `mcp-ssrf` | #02 | Server-side request forgery via unvalidated URLs |
| `mcp-secret-leakage` | #04 | Secrets, system info, IP disclosure in responses |
| `mcp-ir-unguarded-effect` | Structural | Effects without guards (KERN IR) |
| `mcp-ir-low-confidence` | Structural | Low guard/effect ratio |

### KERN IR Visualization

The sidebar renders your MCP server's security structure as a tree:

- **Actions** — each `server.tool()` or `@mcp.tool()` handler
- **Effects** — dangerous operations (shell exec, file I/O, network, database)
- **Guards** — validation, path containment, auth checks
- Color-coded: **GUARDED** (green) vs **UNGUARDED** (red)

### Autofixes (TypeScript + Python)

6 one-click fixes for both languages:
- `eval()` to `JSON.parse()` (TS) / `ast.literal_eval()` (Python)
- Path traversal guard insertion
- Input validation scaffolding (Zod / Pydantic)
- Auth middleware stub
- Response sanitization
- Secrets to env vars

### Config Guardian

Scans your MCP configuration files (`claude_desktop_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.windsurf/mcp.json`) for:
- Hardcoded secrets (Shannon entropy + pattern detection)
- Missing version pins on `npx`/`uvx` packages (supply chain risk)
- `@latest` treated as error — it's NOT a version pin
- Wide permission flags (`--allow-all`, `--no-sandbox`)
- Unresolvable command paths

Shows a "My MCP Servers" section in the sidebar with trust indicators.

### Tool Pinning (Rug-Pull Detection)

Pin your MCP server's tool schemas to detect unauthorized changes:

```bash
kern-mcp-security --lock ./src/server.ts     # generate lockfile
kern-mcp-security --verify ./src/server.ts   # check for drift
```

Detects: removed tools, new tools, description changes (tool poisoning), schema changes.

### Badge + README Integration

Generate a Shields.io security badge for your project:

```
KERN: Generate MCP Security Badge
```

Writes a badge, per-tool score table, and JSON report to your README between `<!-- kern-mcp-security-start/end -->` markers.

## Usage

Works in VS Code, Cursor, Windsurf, Antigravity, and other compatible editors.

### Review Mode
1. Install the extension
2. Open an MCP server file (TypeScript, JavaScript, or Python)
3. The sidebar shows score, IR tree, and findings
4. Click any finding to jump to the line
5. Use `Cmd+Shift+M` / `Ctrl+Shift+M` to scan manually

### Build Mode
1. Click the **BUILD** tab in the sidebar
2. Open or create a `.kern` file
3. Click **Compile -> TypeScript** or **Compile -> Python**
4. Compiled output opens beside with auto-review results

### AI-Assisted Authoring (Beta)
1. Click **BUILD** tab -> **Generate .kern**
2. Select AI engine from the dropdown (auto-detects installed CLIs)
3. Describe your server, select workspace context
4. Review and compile the generated `.kern`

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `kernMcpSecurity.enabled` | `true` | Enable/disable scanning |
| `kernMcpSecurity.severity` | `"all"` | Filter: `all`, `errors`, `warnings` |
| `kernMcpSecurity.animations` | `true` | Enable sidebar animations |
| `kernMcpSecurity.ai.provider` | `"openai"` | LLM provider for AI features (openai, anthropic, gemini, custom) |
| `kernMcpSecurity.ai.apiKey` | `""` | API key (only for API mode, CLIs use their own auth) |
| `kernMcpSecurity.ai.model` | `""` | Model ID (only for API/Ollama) |
| `kernMcpSecurity.ai.endpoint` | `""` | Custom endpoint URL |

Project-level config via `.mcpsecurityrc.json`:

```json
{
  "enabled": true,
  "severity": "errors"
}
```

## CLI

```bash
npx @kernlang/review-mcp ./src/server.ts
```

Options: `--format json|sarif|text`, `--threshold 60` (fail if below), `--quiet`, `--output report.json`.

See [@kernlang/review-mcp](https://github.com/KERNlang/kern-lang/tree/main/packages/review-mcp) for full CLI docs.

## GitHub Action

Add to `.github/workflows/mcp-security.yml`:

```yaml
name: MCP Security
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: KERNlang/kern-lang/packages/review-mcp/ci@main
        with:
          threshold: 60        # fail if score < 60
          sarif: true          # upload to GitHub Code Scanning
          comment: true        # post score + findings to PR
```

## Architecture

The extension spawns a lightweight MCP subprocess for analysis — the editor stays fast. The engine combines three layers:

1. **Legacy regex rules** — fast pattern matching for known vulnerability patterns
2. **Compiled `.kern` rules** — declarative, human-auditable rules with taint tracking and guard dependencies
3. **KERN IR inference** — translates MCP server code to KERN's intermediate representation, checks structural invariants (effects must have guards)

The build pipeline uses `@kernlang/core` (parser) and `@kernlang/mcp` (transpiler) to compile `.kern` to MCP servers. 112 tests, 7 security guard types, both TypeScript and Python targets runtime-verified.

Scan and compile run 100% locally — no network calls, no telemetry. AI-assisted authoring (Generate, Import, Convert — Beta) optionally uses local CLI tools or remote APIs, configured by the user.

## Real-World Results

Tested against the [official MCP servers](https://github.com/modelcontextprotocol/servers) and the [vulnerable-mcp-servers-lab](https://github.com/ApseccoApps/vulnerable-mcp-servers-lab):

| Test Suite | Servers | Findings |
|------------|---------|----------|
| Official MCP (filesystem, git, memory, fetch, time) | 7 | 37 |
| Vulnerable MCP lab (7 intentional vuln servers) | 7 | 50 |

All 7 lab servers detected. Catches command injection (eval), hardcoded secrets, prompt injection, data injection markers, SSRF, unsanitized external data, missing auth on remote servers, system info disclosure, typosquatting, and rug-pull patterns.

## Requirements

- VS Code 1.85+ or compatible editor (Cursor, Windsurf, Antigravity)
- Node.js 18+ (for the CLI)
- MCP servers using `@modelcontextprotocol/sdk` (TypeScript) or `mcp.server` / `FastMCP` (Python)

## Links

- [KERN Language](https://kernlang.dev) — the structural language powering the analysis and compilation
- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) — the security framework we map to
- [Contact](mailto:hello@kernlang.dev) — bug reports, feature requests, commercial licensing

## License

Part of the [KERN](https://github.com/KERNlang/kern) project. AGPL-3.0 — free for individuals and open-source projects. Commercial use requires a license. See [LICENSE](https://github.com/KERNlang/kern/blob/main/LICENSE).
