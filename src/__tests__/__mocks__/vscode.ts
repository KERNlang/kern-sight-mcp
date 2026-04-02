/** Minimal mock of the vscode module for unit testing pure functions. */

export const workspace = {
  workspaceFolders: [],
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  fs: { readFile: async () => Buffer.from('') },
};

export class RelativePattern {
  constructor(public base: unknown, public pattern: string) {}
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => path }),
  joinPath: (...parts: unknown[]) => ({ fsPath: String(parts.join('/')), toString: () => String(parts.join('/')) }),
};
