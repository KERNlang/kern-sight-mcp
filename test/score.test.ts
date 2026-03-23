/**
 * Unit tests for the Security Score Engine.
 *
 * Uses node:test — no extra dependencies. Run with:
 *   npx tsx test/score.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSecurityScore, gradeColor } from '../src/score';
import type { SecurityScore, Grade } from '../src/score';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAction(name: string, effects: { kind: string }[], guards: { kind?: string }[] = []) {
  return {
    type: 'action',
    props: { name, confidence: 0.9 },
    children: [
      ...effects.map(e => ({ type: 'effect', props: { kind: e.kind } })),
      ...guards.map(g => ({ type: 'guard', props: { kind: g.kind ?? 'validation' } })),
    ],
  };
}

function makeFinding(ruleId: string, severity: 'error' | 'warning' | 'info') {
  return { ruleId, severity };
}

// ── Grade thresholds ─────────────────────────────────────────────────

describe('grade thresholds', () => {
  it('returns A for score >= 90', () => {
    const score = computeSecurityScore([], []);
    assert.equal(score.grade, 'A');
    assert.ok(score.total >= 90);
  });

  it('returns F for many criticals', () => {
    const actions = [makeAction('tool1', [{ kind: 'file' }])]; // 1 unguarded effect
    const findings = Array.from({ length: 10 }, () => makeFinding('mcp-command-injection', 'error'));
    const score = computeSecurityScore(actions, findings);
    assert.equal(score.grade, 'F');
    assert.ok(score.total < 40);
  });
});

// ── Guard coverage (40% weight) ──────────────────────────────────────

describe('guard coverage', () => {
  it('100% when no effects exist', () => {
    const actions = [makeAction('safe-tool', [], [])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.guardCoverage, 100);
  });

  it('0% when effects have no guards', () => {
    const actions = [makeAction('risky', [{ kind: 'file' }, { kind: 'network' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.guardCoverage, 0);
  });

  it('100% when guards >= effects', () => {
    const actions = [makeAction('guarded', [{ kind: 'file' }], [{ kind: 'validation' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.guardCoverage, 100);
  });

  it('50% when 1 of 2 effects guarded', () => {
    const actions = [makeAction('half', [{ kind: 'file' }, { kind: 'network' }], [{ kind: 'validation' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.guardCoverage, 50);
  });
});

// ── Input validation (25% weight) ────────────────────────────────────

describe('input validation', () => {
  it('100% when no actions with effects', () => {
    const score = computeSecurityScore([], []);
    assert.equal(score.inputValidation, 100);
  });

  it('100% when all actions with effects have validation guards', () => {
    const actions = [
      makeAction('t1', [{ kind: 'file' }], [{ kind: 'validation' }]),
      makeAction('t2', [{ kind: 'network' }], [{ kind: 'validation' }]),
    ];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.inputValidation, 100);
  });

  it('0% when no validation guards on effect-bearing actions', () => {
    const actions = [
      makeAction('t1', [{ kind: 'file' }], [{ kind: 'auth' }]),
    ];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.inputValidation, 0);
  });
});

// ── Rule compliance (20% weight) ─────────────────────────────────────

describe('rule compliance', () => {
  it('100 when no findings', () => {
    const score = computeSecurityScore([], []);
    assert.equal(score.ruleCompliance, 100);
  });

  it('subtracts 10 per critical, 5 per warning', () => {
    const findings = [
      makeFinding('r1', 'error'),
      makeFinding('r2', 'error'),
      makeFinding('r3', 'warning'),
    ];
    const score = computeSecurityScore([], findings);
    // 100 - 10 - 10 - 5 = 75
    assert.equal(score.ruleCompliance, 75);
  });

  it('floors at 0', () => {
    const findings = Array.from({ length: 15 }, () => makeFinding('r', 'error'));
    const score = computeSecurityScore([], findings);
    assert.equal(score.ruleCompliance, 0);
  });

  it('info findings do not reduce compliance', () => {
    const findings = [makeFinding('r1', 'info'), makeFinding('r2', 'info')];
    const score = computeSecurityScore([], findings);
    assert.equal(score.ruleCompliance, 100);
  });
});

// ── Auth posture (15% weight) ────────────────────────────────────────

describe('auth posture', () => {
  it('100 when no network effects', () => {
    const actions = [makeAction('local', [{ kind: 'file' }], [{ kind: 'validation' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.authPosture, 100);
  });

  it('0 when network effect but no auth guard', () => {
    const actions = [makeAction('remote', [{ kind: 'network' }], [{ kind: 'validation' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.authPosture, 0);
  });

  it('100 when network effect WITH auth guard and no missing-auth finding', () => {
    const actions = [makeAction('remote', [{ kind: 'network' }], [{ kind: 'auth' }, { kind: 'validation' }])];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.authPosture, 100);
  });

  it('0 when auth guard present but mcp-missing-auth finding exists', () => {
    const actions = [makeAction('remote', [{ kind: 'network' }], [{ kind: 'auth' }])];
    const findings = [makeFinding('mcp-missing-auth', 'error')];
    const score = computeSecurityScore(actions, findings);
    assert.equal(score.authPosture, 0);
  });
});

// ── Total score formula ──────────────────────────────────────────────

describe('total score', () => {
  it('perfect score when fully guarded, validated, compliant, and authed', () => {
    const actions = [
      makeAction('t1', [{ kind: 'network' }], [{ kind: 'validation' }, { kind: 'auth' }]),
    ];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.total, 100);
    assert.equal(score.grade, 'A');
  });

  it('formula: 0.4*guard + 0.25*validation + 0.2*compliance + 0.15*auth', () => {
    // Guard: 50%, Validation: 0%, Compliance: 80%, Auth: 0%
    const actions = [
      makeAction('t1', [{ kind: 'file' }, { kind: 'network' }], [{ kind: 'auth' }]),
      // auth guard doesn't count for validation — need kind=validation
    ];
    const findings = [
      makeFinding('r1', 'error'),
      makeFinding('r2', 'error'),
    ];
    const score = computeSecurityScore(actions, findings);

    // Guard: 1 guard / 2 effects = 50%, Validation: 0% (no validation guard), Compliance: 100-20=80%, Auth: has auth guard + no missing-auth finding = 100%
    assert.equal(score.guardCoverage, 50);
    assert.equal(score.inputValidation, 0);
    assert.equal(score.ruleCompliance, 80);
    assert.equal(score.authPosture, 100);
    // 50*0.4 + 0*0.25 + 80*0.2 + 100*0.15 = 20+0+16+15 = 51
    assert.equal(score.total, 51);
    assert.equal(score.grade, 'D');
  });

  it('empty codebase gets perfect score', () => {
    const score = computeSecurityScore([], []);
    assert.equal(score.total, 100);
    assert.equal(score.grade, 'A');
  });
});

// ── Per-tool scores ──────────────────────────────────────────────────

describe('per-tool scores', () => {
  it('generates one entry per action', () => {
    const actions = [
      makeAction('read_file', [{ kind: 'file' }], [{ kind: 'validation' }]),
      makeAction('send_email', [{ kind: 'network' }]),
    ];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.perTool.length, 2);
    assert.equal(score.perTool[0].toolName, 'read_file');
    assert.equal(score.perTool[1].toolName, 'send_email');
  });

  it('per-tool grade reflects guard coverage', () => {
    const actions = [
      makeAction('guarded', [{ kind: 'file' }], [{ kind: 'validation' }, { kind: 'auth' }]),
      makeAction('bare', [{ kind: 'file' }, { kind: 'network' }]),
    ];
    const score = computeSecurityScore(actions, []);
    assert.equal(score.perTool[0].grade, 'A');
    assert.equal(score.perTool[1].grade, 'F');
  });
});

// ── gradeColor ───────────────────────────────────────────────────────

describe('gradeColor', () => {
  it('returns correct colors for each grade', () => {
    assert.equal(gradeColor('A'), '#22c55e');
    assert.equal(gradeColor('B'), '#84cc16');
    assert.equal(gradeColor('C'), '#f97316');
    assert.equal(gradeColor('D'), '#f59e0b');
    assert.equal(gradeColor('F'), '#ef4444');
  });
});
