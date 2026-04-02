import type * as vscode from 'vscode';
import type { SecurityScore } from '@kernlang/review-mcp';

const STORE_KEY = 'kernMcp.scoreHistory';

export interface ScoreEntry {
  total: number;
  grade: string;
  timestamp: number;
}

export interface ScoreDiff {
  delta: number;
  previousTotal: number;
}

export function recordScore(state: vscode.Memento, filePath: string, score: SecurityScore): ScoreDiff | null {
  const history: Record<string, ScoreEntry> = state.get(STORE_KEY, {});
  const previous = history[filePath];
  const diff: ScoreDiff | null = previous ? { delta: score.total - previous.total, previousTotal: previous.total } : null;
  history[filePath] = { total: score.total, grade: score.grade, timestamp: Date.now() };
  void state.update(STORE_KEY, history);
  return diff;
}

export function getLastScore(state: vscode.Memento, filePath: string): ScoreEntry | null {
  const history: Record<string, ScoreEntry> = state.get(STORE_KEY, {});
  return history[filePath] ?? null;
}
