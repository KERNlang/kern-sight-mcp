import { describe, it, expect } from 'vitest';
import { computeAbusePaths } from '../panel/abuse-path';

describe('computeAbusePaths', () => {
  it('returns empty for no IR nodes', () => {
    expect(computeAbusePaths([])).toEqual([]);
  });

  it('returns empty when all effects are guarded', () => {
    const result = computeAbusePaths([
      {
        type: 'action',
        props: { name: 'readFile' },
        children: [
          { type: 'guard', props: { kind: 'pathContainment' } },
          { type: 'effect', props: { kind: 'fs' } },
        ],
      },
    ]);
    expect(result).toEqual([]);
  });

  it('detects file system effect without pathContainment', () => {
    const result = computeAbusePaths([
      {
        type: 'action',
        props: { name: 'readFile' },
        children: [
          { type: 'guard', props: { kind: 'sanitize' } },
          { type: 'effect', props: { kind: 'fs' } },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('readFile');
    expect(result[0].effectKind).toBe('fs');
    expect(result[0].missingGuards).toContain('pathContainment');
    expect(result[0].severity).toBe('high');
  });

  it('detects shell-exec without sanitize', () => {
    const result = computeAbusePaths([
      {
        type: 'action',
        props: { name: 'runCmd' },
        children: [
          { type: 'effect', props: { kind: 'shell-exec' } },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
    expect(result[0].missingGuards).toContain('sanitize');
  });

  it('detects network without sanitizeOutput', () => {
    const result = computeAbusePaths([
      {
        type: 'action',
        props: { name: 'fetchData' },
        children: [
          { type: 'effect', props: { kind: 'network' } },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].missingGuards).toContain('sanitizeOutput');
  });

  it('sorts critical before high before medium', () => {
    const result = computeAbusePaths([
      {
        type: 'action',
        props: { name: 'tool1' },
        children: [{ type: 'effect', props: { kind: 'network' } }],
      },
      {
        type: 'action',
        props: { name: 'tool2' },
        children: [{ type: 'effect', props: { kind: 'shell-exec' } }],
      },
      {
        type: 'action',
        props: { name: 'tool3' },
        children: [{ type: 'effect', props: { kind: 'fs' } }],
      },
    ]);
    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('high');
    expect(result[2].severity).toBe('medium');
  });

  it('ignores non-action nodes', () => {
    const result = computeAbusePaths([
      { type: 'config', props: { name: 'test' } },
    ]);
    expect(result).toEqual([]);
  });
});
