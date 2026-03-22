import * as vscode from 'vscode';

export class McpSecurityCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'KERN MCP') continue;

      if (diagnostic.relatedInformation?.length) {
        const fixInfo = diagnostic.relatedInformation.find((r) => r.message.startsWith('Fix:'));
        if (fixInfo) {
          const suggestion = fixInfo.message.replace(/^Fix:\s*/, '');
          const copyAction = new vscode.CodeAction(
            `Copy fix: ${suggestion.slice(0, 60)}`,
            vscode.CodeActionKind.QuickFix,
          );
          copyAction.command = {
            command: 'kernMcpSecurity.copySuggestion',
            title: 'Copy suggestion',
            arguments: [suggestion],
          };
          copyAction.diagnostics = [diagnostic];
          actions.push(copyAction);
        }
      }
    }

    return actions;
  }
}
