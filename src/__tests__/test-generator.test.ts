import { describe, it, expect } from 'vitest';
import { generateTestSuites, renderTestFile } from '../test-generator';

describe('generateTestSuites', () => {
  it('returns empty for no tools', () => {
    const result = generateTestSuites({ type: 'mcp', props: {} });
    expect(result).toEqual([]);
  });

  it('generates valid input test for basic tool', () => {
    const ast = {
      type: 'mcp',
      children: [
        {
          type: 'tool',
          props: { name: 'hello' },
          children: [
            { type: 'param', props: { name: 'name', type: 'string', required: 'true' } },
            { type: 'guard', props: { type: 'sanitize', param: 'name' } },
            { type: 'handler', props: { code: 'return args.name;' } },
          ],
        },
      ],
    };
    const suites = generateTestSuites(ast);
    expect(suites).toHaveLength(1);
    expect(suites[0].toolName).toBe('hello');
    // Should have: 1 valid + 4 sanitize malicious
    expect(suites[0].cases.length).toBeGreaterThanOrEqual(5);
    expect(suites[0].cases[0].expectBlocked).toBe(false); // valid
    expect(suites[0].cases[1].expectBlocked).toBe(true);  // malicious
  });

  it('generates path traversal tests for pathContainment guard', () => {
    const ast = {
      type: 'mcp',
      children: [
        {
          type: 'tool',
          props: { name: 'readFile' },
          children: [
            { type: 'param', props: { name: 'path', type: 'string' } },
            { type: 'guard', props: { type: 'pathContainment', param: 'path' } },
          ],
        },
      ],
    };
    const suites = generateTestSuites(ast);
    const pathCases = suites[0].cases.filter(c => c.name.includes('pathContainment'));
    expect(pathCases.length).toBeGreaterThanOrEqual(4);
    expect(pathCases.every(c => c.expectBlocked)).toBe(true);
  });

  it('generates min/max tests for validate guard', () => {
    const ast = {
      type: 'mcp',
      children: [
        {
          type: 'tool',
          props: { name: 'search' },
          children: [
            { type: 'param', props: { name: 'limit', type: 'number', default: '10' } },
            { type: 'guard', props: { type: 'validate', param: 'limit', min: '1', max: '100' } },
          ],
        },
      ],
    };
    const suites = generateTestSuites(ast);
    const minCase = suites[0].cases.find(c => c.name.includes('below min'));
    const maxCase = suites[0].cases.find(c => c.name.includes('above max'));
    expect(minCase).toBeDefined();
    expect(minCase!.input.limit).toBe(0); // min - 1
    expect(maxCase).toBeDefined();
    expect(maxCase!.input.limit).toBe(101); // max + 1
  });
});

describe('renderTestFile', () => {
  it('generates valid TypeScript test file', () => {
    const suites = [
      {
        toolName: 'hello',
        cases: [
          { name: 'valid', description: 'test', input: { name: 'world' }, expectBlocked: false },
          { name: 'xss', description: 'test', input: { name: '<script>' }, expectBlocked: true },
        ],
      },
    ];
    const output = renderTestFile(suites, './hello');
    expect(output).toContain("describe('hello'");
    expect(output).toContain("it('valid'");
    expect(output).toContain("it('xss'");
    expect(output).toContain("import { describe, it, expect } from 'vitest'");
  });
});
