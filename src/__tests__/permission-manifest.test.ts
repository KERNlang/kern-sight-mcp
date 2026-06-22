import { describe, it, expect } from 'vitest';
import { buildPermissionManifest } from '../permission-manifest';

describe('buildPermissionManifest', () => {
  it('returns empty manifest for no IR nodes', () => {
    const result = buildPermissionManifest([]);
    expect(result.entries).toEqual([]);
    expect(result.byKind).toEqual({});
  });

  it('returns empty manifest for non-action nodes', () => {
    const result = buildPermissionManifest([
      { type: 'config', props: { name: 'test' } },
    ]);
    expect(result.entries).toEqual([]);
  });

  it('extracts effects from action nodes', () => {
    const result = buildPermissionManifest([
      {
        type: 'action',
        props: { name: 'readFile' },
        children: [
          { type: 'effect', props: { kind: 'file-read' } },
        ],
      },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].kind).toBe('file-read');
    expect(result.entries[0].toolName).toBe('readFile');
  });

  it('marks effect as guarded when matching guard exists', () => {
    const result = buildPermissionManifest([
      {
        type: 'action',
        props: { name: 'readFile' },
        children: [
          { type: 'guard', props: { kind: 'file-read' } },
          { type: 'effect', props: { kind: 'file-read' } },
        ],
      },
    ]);
    expect(result.entries[0].guarded).toBe(true);
  });

  it('marks effect as unguarded when no matching guard', () => {
    const result = buildPermissionManifest([
      {
        type: 'action',
        props: { name: 'runCmd' },
        children: [
          { type: 'effect', props: { kind: 'shell-exec' } },
        ],
      },
    ]);
    expect(result.entries[0].guarded).toBe(false);
  });

  it('groups by kind correctly', () => {
    const result = buildPermissionManifest([
      {
        type: 'action',
        props: { name: 'tool1' },
        children: [
          { type: 'guard', props: { kind: 'file-read' } },
          { type: 'effect', props: { kind: 'file-read' } },
          { type: 'effect', props: { kind: 'shell-exec' } },
        ],
      },
      {
        type: 'action',
        props: { name: 'tool2' },
        children: [
          { type: 'effect', props: { kind: 'file-read' } },
        ],
      },
    ]);

    expect(result.byKind['file-read']).toEqual({ guarded: 1, unguarded: 1 });
    expect(result.byKind['shell-exec']).toEqual({ guarded: 0, unguarded: 1 });
  });

  it('handles multiple effect kinds in one tool', () => {
    const result = buildPermissionManifest([
      {
        type: 'action',
        props: { name: 'syncData' },
        children: [
          { type: 'guard', props: { kind: 'network-fetch' } },
          { type: 'guard', props: { kind: 'database-query' } },
          { type: 'effect', props: { kind: 'network-fetch' } },
          { type: 'effect', props: { kind: 'database-query' } },
        ],
      },
    ]);

    expect(result.entries).toHaveLength(2);
    expect(result.entries.every(e => e.guarded)).toBe(true);
  });
});
