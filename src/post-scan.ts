/**
 * Post-Scan Enhancements — catches patterns that require string-level analysis
 * beyond what structural KERN IR rules can do (e.g., decoding obfuscated strings).
 *
 * SSRF, unsanitized response, and tool poisoning detection belong in
 * @kernlang/review-mcp as KERN rules — they need structural code analysis,
 * not regex. Only base64 decoding lives here because it's a string transform
 * that KERN IR can't perform.
 */

export interface Finding {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  primarySpan: { file: string; startLine: number; endLine: number; startCol: number; endCol: number };
}

const SECRET_PREFIXES = /^(sk-|ghp_|gho_|github_pat_|xox[bpas]-|AKIA|AIza|Bearer\s|glpat-|npm_|pypi-)/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SENSITIVE_URL = /\b(api|secret|token|auth|key|password|credential)/i;
const BASE64_IN_SOURCE = /["'`]([A-Za-z0-9+/]{16,}={0,2})["'`]/g;

function isValidBase64(s: string): boolean {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return /^[\x20-\x7e\n\r\t]+$/.test(decoded) && decoded.length >= 4;
  } catch {
    return false;
  }
}

export function runPostScan(source: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    BASE64_IN_SOURCE.lastIndex = 0;

    while ((match = BASE64_IN_SOURCE.exec(line)) !== null) {
      const encoded = match[1];
      if (!isValidBase64(encoded)) continue;

      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const span = { file: filePath, startLine: i + 1, endLine: i + 1, startCol: match.index + 1, endCol: match.index + 1 + match[0].length };

      if (SECRET_PREFIXES.test(decoded)) {
        const redacted = decoded.slice(0, 6) + '...' + decoded.slice(-4);
        findings.push({ ruleId: 'mcp-secrets-exposure', severity: 'error', message: `Base64-encoded secret decoded to "${redacted}" — credential hiding via obfuscation`, suggestion: 'Use environment variables instead of obfuscated secrets. Base64 is not encryption.', primarySpan: span });
      } else if (EMAIL_PATTERN.test(decoded)) {
        findings.push({ ruleId: 'mcp-secret-leakage', severity: 'warning', message: `Base64-encoded email address: ${decoded} — PII exposure risk`, suggestion: 'Do not hardcode email addresses. Use configuration or environment variables.', primarySpan: span });
      } else if (SENSITIVE_URL.test(decoded)) {
        findings.push({ ruleId: 'mcp-secrets-exposure', severity: 'warning', message: `Base64-encoded sensitive URL: ${decoded.slice(0, 60)}${decoded.length > 60 ? '...' : ''} — possible credential or internal endpoint hiding`, suggestion: 'Obfuscating URLs with base64 provides no security. Use configuration files.', primarySpan: span });
      }
    }
  }

  return findings;
}
