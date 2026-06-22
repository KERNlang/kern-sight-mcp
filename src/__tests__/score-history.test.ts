import { describe, it, expect, beforeEach } from 'vitest';
import { recordScore, getLastScore } from '../score-history';

/** Minimal mock of vscode.Memento for testing. */
function createMockMemento(): import('vscode').Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get<T>(key: string, defaultValue?: T): T {
      return (store.get(key) as T) ?? defaultValue!;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('recordScore', () => {
  let state: import('vscode').Memento;

  beforeEach(() => {
    state = createMockMemento();
  });

  it('returns null on first scan (no previous score)', () => {
    const score = { total: 85, grade: 'B', guardCoverage: 0.8, inputValidation: 0.7, ruleCompliance: 0.9, authPosture: 0.6 } as any;
    const diff = recordScore(state, '/test/server.ts', score);
    expect(diff).toBeNull();
  });

  it('returns delta on second scan', () => {
    const score1 = { total: 70, grade: 'C' } as any;
    const score2 = { total: 85, grade: 'B' } as any;

    recordScore(state, '/test/server.ts', score1);
    const diff = recordScore(state, '/test/server.ts', score2);

    expect(diff).not.toBeNull();
    expect(diff!.delta).toBe(15);
    expect(diff!.previousTotal).toBe(70);
  });

  it('tracks scores per file independently', () => {
    const score1 = { total: 90, grade: 'A' } as any;
    const score2 = { total: 50, grade: 'D' } as any;

    recordScore(state, '/test/a.ts', score1);
    recordScore(state, '/test/b.ts', score2);

    const diff = recordScore(state, '/test/a.ts', { total: 80, grade: 'B' } as any);
    expect(diff!.delta).toBe(-10);
    expect(diff!.previousTotal).toBe(90);
  });

  it('returns negative delta when score drops', () => {
    recordScore(state, '/test/server.ts', { total: 90, grade: 'A' } as any);
    const diff = recordScore(state, '/test/server.ts', { total: 60, grade: 'C' } as any);
    expect(diff!.delta).toBe(-30);
  });
});

describe('getLastScore', () => {
  let state: import('vscode').Memento;

  beforeEach(() => {
    state = createMockMemento();
  });

  it('returns null for unknown file', () => {
    expect(getLastScore(state, '/test/unknown.ts')).toBeNull();
  });

  it('returns last recorded score', () => {
    recordScore(state, '/test/server.ts', { total: 85, grade: 'B' } as any);
    const last = getLastScore(state, '/test/server.ts');
    expect(last).not.toBeNull();
    expect(last!.total).toBe(85);
    expect(last!.grade).toBe('B');
    expect(last!.timestamp).toBeGreaterThan(0);
  });
});
