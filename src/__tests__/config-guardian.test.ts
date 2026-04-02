import { describe, it, expect } from 'vitest';
import { shannonEntropy, isLikelySecret, parseConfigFile } from '../config-guardian';

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single repeated char', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
  });

  it('returns high entropy for random-looking strings', () => {
    expect(shannonEntropy('aB3$xZ9!kL2@pQ7&')).toBeGreaterThanOrEqual(4);
  });

  it('returns low entropy for simple strings', () => {
    expect(shannonEntropy('hello')).toBeLessThan(3);
  });
});

describe('isLikelySecret', () => {
  it('detects sk- prefix', () => {
    expect(isLikelySecret('key', 'sk-abc123def456')).toBe(true);
  });

  it('detects ghp_ prefix', () => {
    expect(isLikelySecret('token', 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ')).toBe(true);
  });

  it('detects AKIA prefix (AWS)', () => {
    expect(isLikelySecret('id', 'AKIA1234567890ABCDEF')).toBe(true);
  });

  it('detects secret key names', () => {
    expect(isLikelySecret('api_key', 'some-value')).toBe(true);
    expect(isLikelySecret('SECRET_KEY', 'some-value')).toBe(true);
    expect(isLikelySecret('password', 'some-value')).toBe(true);
    expect(isLikelySecret('auth-token', 'some-value')).toBe(true);
  });

  it('detects high-entropy long strings', () => {
    expect(isLikelySecret('data', 'aB3$xZ9!kL2@pQ7&mN5^jR8*')).toBe(true);
  });

  it('does not flag normal short values', () => {
    expect(isLikelySecret('name', 'hello')).toBe(false);
  });

  it('does not flag normal key names with normal values', () => {
    expect(isLikelySecret('host', 'localhost')).toBe(false);
  });
});

describe('parseConfigFile', () => {
  it('parses valid config with servers', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'vscode', '/test/.vscode/mcp.json');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('myServer');
    expect(entries[0].command).toBe('node');
    expect(entries[0].source).toBe('vscode');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseConfigFile('not json', 'vscode', '/test')).toEqual([]);
  });

  it('returns empty array for missing mcpServers', () => {
    expect(parseConfigFile('{}', 'vscode', '/test')).toEqual([]);
  });

  it('detects hardcoded secrets in env', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'node',
          args: [],
          env: { API_KEY: 'sk-secret123456789' },
        },
      },
    });
    const entries = parseConfigFile(config, 'vscode', '/test');
    expect(entries[0].issues).toHaveLength(1);
    expect(entries[0].issues[0].type).toBe('hardcoded-secret');
    expect(entries[0].issues[0].severity).toBe('error');
    expect(entries[0].trust).toBe('risky');
  });

  it('detects missing version pin on npx', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'npx',
          args: ['some-package'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'cursor', '/test');
    expect(entries[0].issues).toHaveLength(1);
    expect(entries[0].issues[0].type).toBe('missing-version-pin');
    expect(entries[0].issues[0].severity).toBe('warning');
  });

  it('does not flag npx with version pin', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'npx',
          args: ['some-package@1.2.3'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'cursor', '/test');
    const pinIssues = entries[0].issues.filter(i => i.type === 'missing-version-pin');
    expect(pinIssues).toHaveLength(0);
  });

  it('flags @latest as error — not a real version pin', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'npx',
          args: ['some-package@latest'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'vscode', '/test');
    const pinIssues = entries[0].issues.filter(i => i.type === 'missing-version-pin');
    expect(pinIssues).toHaveLength(1);
    expect(pinIssues[0].severity).toBe('error');
    expect(pinIssues[0].message).toContain('@latest');
  });

  it('flags @latest on uvx too', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'uvx',
          args: ['some-package@latest'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'vscode', '/test');
    const pinIssues = entries[0].issues.filter(i => i.type === 'missing-version-pin');
    expect(pinIssues).toHaveLength(1);
    expect(pinIssues[0].severity).toBe('error');
  });

  it('detects wide permissions', () => {
    const config = JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js', '--allow-all'],
          env: {},
        },
      },
    });
    const entries = parseConfigFile(config, 'vscode', '/test');
    expect(entries[0].issues.some(i => i.type === 'wide-permission')).toBe(true);
  });

  it('handles windsurf source correctly', () => {
    const config = JSON.stringify({
      mcpServers: {
        test: { command: 'node', args: [], env: {} },
      },
    });
    const entries = parseConfigFile(config, 'windsurf', '/test/.windsurf/mcp.json');
    expect(entries[0].source).toBe('windsurf');
  });
});
