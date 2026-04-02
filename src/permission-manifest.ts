interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

export type EffectKind = 'file-read' | 'file-write' | 'shell-exec' | 'network-fetch' | 'database-query' | string;

export interface PermissionEntry {
  kind: EffectKind;
  toolName: string;
  guarded: boolean;
}

export interface PermissionManifest {
  entries: PermissionEntry[];
  byKind: Record<string, { guarded: number; unguarded: number }>;
}

export function buildPermissionManifest(irNodes: IRNode[]): PermissionManifest {
  const entries: PermissionEntry[] = [];

  for (const node of irNodes) {
    if (node.type !== 'action') continue;
    const toolName = (node.props?.name as string) || 'unknown';
    const children = node.children ?? [];
    const guards = children.filter(c => c.type === 'guard');
    const effects = children.filter(c => c.type === 'effect');

    for (const effect of effects) {
      const kind = (effect.props?.kind as string) || 'unknown';
      const guarded = guards.some(g => {
        const gKind = (g.props?.kind as string) || '';
        return gKind === kind || guards.length >= effects.length;
      });
      entries.push({ kind, toolName, guarded });
    }
  }

  const byKind: Record<string, { guarded: number; unguarded: number }> = {};
  for (const e of entries) {
    if (!byKind[e.kind]) byKind[e.kind] = { guarded: 0, unguarded: 0 };
    if (e.guarded) byKind[e.kind].guarded++;
    else byKind[e.kind].unguarded++;
  }

  return { entries, byKind };
}
