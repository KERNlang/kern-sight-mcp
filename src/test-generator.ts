/**
 * Auto-generates security test cases from .kern AST.
 * For each tool and guard, generates valid + malicious inputs to verify guards work.
 */

interface KernNode {
  type: string;
  props?: Record<string, unknown>;
  children?: KernNode[];
}

interface TestCase {
  name: string;
  description: string;
  input: Record<string, unknown>;
  expectBlocked: boolean;
}

interface ToolTestSuite {
  toolName: string;
  cases: TestCase[];
}

const MALICIOUS_PAYLOADS: Record<string, { value: unknown; label: string }[]> = {
  sanitize: [
    { value: '<script>alert(1)</script>', label: 'XSS payload' },
    { value: '"; DROP TABLE users; --', label: 'SQL injection' },
    { value: '$(whoami)', label: 'command substitution' },
    { value: '{{7*7}}', label: 'template injection' },
  ],
  pathContainment: [
    { value: '../../../etc/passwd', label: 'path traversal (unix)' },
    { value: '..\\..\\..\\windows\\system32\\config\\sam', label: 'path traversal (windows)' },
    { value: '/etc/shadow', label: 'absolute path escape' },
    { value: 'data/../../../etc/hosts', label: 'nested traversal' },
  ],
  validate: [
    { value: -999999, label: 'extreme negative number' },
    { value: 999999999, label: 'extreme large number' },
    { value: '', label: 'empty string' },
  ],
  sizeLimit: [
    { value: 'x'.repeat(2_000_000), label: '2MB payload' },
  ],
  rateLimit: [],
  auth: [],
  sanitizeOutput: [],
};

function getChildren(node: KernNode, type: string): KernNode[] {
  return (node.children ?? []).filter(c => c.type === type);
}

function str(val: unknown): string | undefined {
  return val === undefined || val === null ? undefined : String(val);
}

export function generateTestSuites(ast: KernNode): ToolTestSuite[] {
  const mcpNode = ast.type === 'mcp' ? ast : (ast.children ?? []).find(c => c.type === 'mcp') ?? ast;
  const tools = getChildren(mcpNode, 'tool');
  const suites: ToolTestSuite[] = [];

  for (const tool of tools) {
    const toolName = str(tool.props?.name) || 'tool';
    const params = getChildren(tool, 'param');
    const guards = getChildren(tool, 'guard');
    const cases: TestCase[] = [];

    // Build valid input from param defaults
    const validInput: Record<string, unknown> = {};
    for (const p of params) {
      const name = str(p.props?.name) || 'input';
      const type = str(p.props?.type) || 'string';
      const defaultVal = str(p.props?.default);
      validInput[name] = defaultVal ?? (type === 'number' ? 1 : type === 'boolean' ? true : 'test-value');
    }

    // Valid input should pass
    cases.push({
      name: `${toolName} — valid input passes`,
      description: 'All parameters within bounds, should succeed',
      input: { ...validInput },
      expectBlocked: false,
    });

    // For each guard, generate malicious inputs
    for (const guard of guards) {
      const kind = str(guard.props?.type) || str(guard.props?.kind) || str(guard.props?.name) || '';
      const target = str(guard.props?.param) || str(guard.props?.target);
      const payloads = MALICIOUS_PAYLOADS[kind] || [];

      for (const payload of payloads) {
        const maliciousInput = { ...validInput };
        if (target) {
          maliciousInput[target] = payload.value;
        } else {
          // Apply to first string param
          const firstString = params.find(p => (str(p.props?.type) || 'string') === 'string');
          if (firstString) maliciousInput[str(firstString.props?.name) || 'input'] = payload.value;
        }

        cases.push({
          name: `${toolName} — ${kind} blocks ${payload.label}`,
          description: `Guard type=${kind} should reject: ${payload.label}`,
          input: maliciousInput,
          expectBlocked: true,
        });
      }

      // Validate guard with min/max
      if (kind === 'validate' && target) {
        const min = str(guard.props?.min);
        const max = str(guard.props?.max);
        if (min) {
          cases.push({
            name: `${toolName} — validate rejects below min (${min})`,
            description: `Value below minimum ${min} should be rejected`,
            input: { ...validInput, [target]: Number(min) - 1 },
            expectBlocked: true,
          });
        }
        if (max) {
          cases.push({
            name: `${toolName} — validate rejects above max (${max})`,
            description: `Value above maximum ${max} should be rejected`,
            input: { ...validInput, [target]: Number(max) + 1 },
            expectBlocked: true,
          });
        }
      }
    }

    // Param-level guards
    for (const p of params) {
      const paramGuards = getChildren(p, 'guard');
      const paramName = str(p.props?.name) || 'input';
      for (const guard of paramGuards) {
        const kind = str(guard.props?.type) || str(guard.props?.kind) || '';
        const payloads = MALICIOUS_PAYLOADS[kind] || [];
        for (const payload of payloads) {
          cases.push({
            name: `${toolName} — ${paramName} ${kind} blocks ${payload.label}`,
            description: `Param-level guard type=${kind} on ${paramName}`,
            input: { ...validInput, [paramName]: payload.value },
            expectBlocked: true,
          });
        }
      }
    }

    suites.push({ toolName, cases });
  }

  return suites;
}

export function renderTestFile(suites: ToolTestSuite[], serverPath: string): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated security test SCAFFOLD from .kern definition`);
  lines.push(`// Wire up your compiled server's tool handlers to complete these tests`);
  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(``);
  lines.push(`// TODO: Import your compiled MCP server's tool handlers`);
  lines.push(`// import { callTool } from '${serverPath}';`);
  lines.push(``);

  for (const suite of suites) {
    lines.push(`describe('${suite.toolName}', () => {`);
    for (const tc of suite.cases) {
      const inputStr = JSON.stringify(tc.input, null, 2).replace(/\n/g, '\n    ');
      if (tc.expectBlocked) {
        lines.push(`  it('${tc.name}', async () => {`);
        lines.push(`    const input = ${inputStr};`);
        lines.push(`    // ${tc.description}`);
        lines.push(`    // await expect(callTool('${suite.toolName}', input)).rejects.toThrow();`);
        lines.push(`    expect(true).toBe(true); // TODO: wire up tool call`);
        lines.push(`  });`);
      } else {
        lines.push(`  it('${tc.name}', async () => {`);
        lines.push(`    const input = ${inputStr};`);
        lines.push(`    // ${tc.description}`);
        lines.push(`    // const result = await callTool('${suite.toolName}', input);`);
        lines.push(`    // expect(result.isError).toBeFalsy();`);
        lines.push(`    expect(true).toBe(true); // TODO: wire up tool call`);
        lines.push(`  });`);
      }
      lines.push(``);
    }
    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}
