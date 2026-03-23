import * as vscode from 'vscode';

// ── Safe autofixes — deterministic, mechanical transforms ────────────

type AutofixFn = (document: vscode.TextDocument, line: number) => vscode.WorkspaceEdit | null;

export const SAFE_AUTOFIXES: Record<string, AutofixFn> = {

  // eval() → JSON.parse() for data, or flag for manual review
  'mcp-command-injection': (document, line) => {
    const lineText = document.lineAt(line).text;

    // eval(`...`) → replace with safer alternative
    if (/\beval\s*\(/.test(lineText)) {
      const edit = new vscode.WorkspaceEdit();
      const newText = lineText
        .replace(/\beval\s*\(\s*`/, 'JSON.parse(`')
        .replace(/\beval\s*\(\s*\(function/, '(function');
      if (newText !== lineText) {
        edit.replace(document.uri, document.lineAt(line).range, newText);
        return edit;
      }
    }

    // exec(string) → execFile with array args
    if (/\b(exec|execSync)\s*\(/.test(lineText)) {
      const edit = new vscode.WorkspaceEdit();
      // Insert a comment above the line
      edit.insert(
        document.uri,
        new vscode.Position(line, 0),
        `${getIndent(lineText)}// SECURITY: Replace exec() with execFile() and array arguments\n`,
      );
      return edit;
    }

    return null;
  },

  // Missing path validation → add resolve + startsWith guard
  'mcp-path-traversal': (document, line) => {
    const lineText = document.lineAt(line).text;
    const indent = getIndent(lineText);
    const edit = new vscode.WorkspaceEdit();

    // Detect the variable being used in the file operation
    const paramMatch = lineText.match(/\b(?:readFile|writeFile|readdir|unlink|open)\w*\s*\(\s*(\w+)/);
    const varName = paramMatch?.[1] || 'filePath';

    const guard = [
      `${indent}// SECURITY: Validate path is within allowed directory`,
      `${indent}const resolvedPath = require('path').resolve(${varName});`,
      `${indent}const allowedDir = require('path').resolve('./allowed');`,
      `${indent}if (!resolvedPath.startsWith(allowedDir)) {`,
      `${indent}  throw new Error('Path traversal blocked: ' + ${varName});`,
      `${indent}}`,
    ].join('\n') + '\n';

    edit.insert(document.uri, new vscode.Position(line, 0), guard);
    return edit;
  },

  // Missing input validation → add zod schema parse
  'mcp-missing-validation': (document, line) => {
    const lineText = document.lineAt(line).text;
    const indent = getIndent(lineText);
    const edit = new vscode.WorkspaceEdit();

    // Find what params are being accessed
    const paramMatch = lineText.match(/(?:arguments|params)\??\.\s*(\w+)/);
    const paramName = paramMatch?.[1] || 'input';

    const guard = [
      `${indent}// SECURITY: Validate input before use`,
      `${indent}// import { z } from 'zod';`,
      `${indent}// const ${paramName}Schema = z.string().max(1000);`,
      `${indent}// const validated${capitalize(paramName)} = ${paramName}Schema.parse(${paramName});`,
    ].join('\n') + '\n';

    edit.insert(document.uri, new vscode.Position(line, 0), guard);
    return edit;
  },

  // Missing auth on remote server → add auth middleware stub
  'mcp-missing-auth': (document, line) => {
    const lineText = document.lineAt(line).text;
    const indent = getIndent(lineText);
    const edit = new vscode.WorkspaceEdit();

    const guard = [
      `${indent}// SECURITY: Add authentication before exposing MCP server over HTTP`,
      `${indent}// function requireAuth(req, res, next) {`,
      `${indent}//   const token = req.headers.authorization?.replace('Bearer ', '');`,
      `${indent}//   if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });`,
      `${indent}//   next();`,
      `${indent}// }`,
    ].join('\n') + '\n';

    edit.insert(document.uri, new vscode.Position(line, 0), guard);
    return edit;
  },

  // Unsanitized response → add sanitization wrapper
  'mcp-unsanitized-response': (document, line) => {
    const lineText = document.lineAt(line).text;
    const indent = getIndent(lineText);
    const edit = new vscode.WorkspaceEdit();

    const guard = [
      `${indent}// SECURITY: Sanitize external data before returning to LLM`,
      `${indent}// function sanitize(data) { return JSON.stringify(data).replace(/[\\x00-\\x1f]/g, ''); }`,
    ].join('\n') + '\n';

    edit.insert(document.uri, new vscode.Position(line, 0), guard);
    return edit;
  },

  // Secrets exposure → replace with env var
  'mcp-secrets-exposure': (document, line) => {
    const lineText = document.lineAt(line).text;
    const edit = new vscode.WorkspaceEdit();

    // Replace hardcoded string value with process.env reference
    const keyMatch = lineText.match(/(['"])([^'"]{8,})\1/);
    if (keyMatch) {
      const envVar = 'API_KEY'; // generic; user should rename
      const newText = lineText.replace(keyMatch[0], `process.env.${envVar}`);
      if (newText !== lineText) {
        edit.replace(document.uri, document.lineAt(line).range, newText);
        return edit;
      }
    }

    return null;
  },
};

// Set of rule IDs that have safe autofixes
export const SAFE_AUTOFIX_RULES = new Set(Object.keys(SAFE_AUTOFIXES));

// ── Code action provider ─────────────────────────────────────────────

export class McpSecurityCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'KERN MCP') continue;

      const ruleId = typeof diagnostic.code === 'string' ? diagnostic.code : String(diagnostic.code);

      // Safe autofix — apply edit directly
      if (SAFE_AUTOFIXES[ruleId]) {
        const edit = SAFE_AUTOFIXES[ruleId](document, diagnostic.range.start.line);
        if (edit) {
          const action = new vscode.CodeAction(
            `Fix: ${diagnostic.message.split('—')[0].trim()}`,
            vscode.CodeActionKind.QuickFix,
          );
          action.edit = edit;
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
      }

      // Copy suggestion — for all findings with related info
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

// ── Helpers ──────────────────────────────────────────────────────────

function getIndent(line: string): string {
  return line.match(/^(\s*)/)?.[1] || '';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
