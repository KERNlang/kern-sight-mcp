import type { ReviewFinding, SecurityScore } from '@kernlang/review-mcp';

export type { ReviewFinding, SecurityScore };

export interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

export interface McpReviewResult {
  fileName: string;
  filePath: string;
  findings: ReviewFinding[];
  irNodes: IRNode[];
  lang: 'typescript' | 'python' | null;
  score?: SecurityScore;
}

export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
