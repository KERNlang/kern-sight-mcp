#!/usr/bin/env node
/**
 * KERN MCP Security CLI — scan MCP server files from the command line.
 *
 * Usage:
 *   node dist/cli.js [options] [path]
 *
 * Options:
 *   --threshold N   Minimum score to pass (default: 0, exits 1 if below)
 *   --format fmt    Output format: json | sarif | text (default: text)
 *   --output file   Write report to file (default: stdout)
 *   --quiet         Only output score + exit code
 *
 * Examples:
 *   node dist/cli.js ./src/server.ts
 *   node dist/cli.js --threshold 70 --format sarif --output report.sarif .
 *   npx kern-mcp-security --threshold 60
 */

import { scanWorkspace, type WorkspaceScanResult } from './workspace-scan';
import { generateReportJSON } from './badge';
import type { SecurityScore } from './score';
import * as fs from 'fs';
import * as path from 'path';

// ── Arg parsing ──────────────────────────────────────────────────────

interface CliArgs {
  paths: string[];
  threshold: number;
  format: 'json' | 'sarif' | 'text';
  output: string | null;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    paths: [],
    threshold: 0,
    format: 'text',
    output: null,
    quiet: false,
  };

  let i = 2; // skip node + script
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--threshold' && argv[i + 1]) {
      args.threshold = parseInt(argv[++i], 10) || 0;
    } else if (arg === '--format' && argv[i + 1]) {
      const fmt = argv[++i];
      if (fmt === 'json' || fmt === 'sarif' || fmt === 'text') args.format = fmt;
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--quiet' || arg === '-q') {
      args.quiet = true;
    } else if (!arg.startsWith('-')) {
      args.paths.push(arg);
    }
    i++;
  }

  if (args.paths.length === 0) args.paths.push('.');
  return args;
}

// ── SARIF output ────────────────────────────────────────────────────

function toSARIF(result: WorkspaceScanResult): object {
  const runs = [{
    tool: {
      driver: {
        name: 'KERN MCP Security',
        version: '0.1.0',
        informationUri: 'https://github.com/KERNlang/kern-sight-mcp',
        rules: [] as object[],
      },
    },
    results: [] as object[],
  }];

  const ruleIds = new Set<string>();

  for (const file of result.files) {
    for (const f of file.findings) {
      if (!ruleIds.has(f.ruleId)) {
        ruleIds.add(f.ruleId);
        runs[0].tool.driver.rules.push({
          id: f.ruleId,
          shortDescription: { text: f.message.split('—')[0].trim() },
          defaultConfiguration: {
            level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
          },
        });
      }

      runs[0].results.push({
        ruleId: f.ruleId,
        level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
        message: { text: f.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: path.relative(process.cwd(), file.filePath) },
            region: {
              startLine: f.primarySpan.startLine,
              startColumn: f.primarySpan.startCol,
            },
          },
        }],
        ...(f.suggestion ? { fixes: [{ description: { text: f.suggestion } }] } : {}),
      });
    }
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs,
  };
}

// ── Text output ─────────────────────────────────────────────────────

function toText(result: WorkspaceScanResult): string {
  const lines: string[] = [];
  const { score } = result;

  lines.push(`KERN MCP Security Score: ${score.grade} (${score.total}/100)`);
  lines.push(`  Guard coverage:    ${score.guardCoverage}%`);
  lines.push(`  Input validation:  ${score.inputValidation}%`);
  lines.push(`  Rule compliance:   ${score.ruleCompliance}%`);
  lines.push(`  Auth posture:      ${score.authPosture}%`);
  lines.push('');

  if (result.files.length === 0) {
    lines.push('No MCP server files found.');
    return lines.join('\n');
  }

  lines.push(`${result.files.length} MCP server file(s) scanned:`);

  for (const file of result.files) {
    const findingCount = file.findings.length;
    const grade = file.score?.grade ?? '?';
    lines.push(`  ${file.fileName} — ${grade} (${findingCount} finding${findingCount !== 1 ? 's' : ''})`);

    for (const f of file.findings) {
      const sev = f.severity === 'error' ? 'BUG' : f.severity === 'warning' ? 'WARN' : 'INFO';
      lines.push(`    [${sev}] L${f.primarySpan.startLine} ${f.ruleId}: ${f.message.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);
  const scanPath = path.resolve(args.paths[0]);

  const result = scanWorkspace(scanPath);

  let output: string;
  if (args.format === 'sarif') {
    output = JSON.stringify(toSARIF(result), null, 2);
  } else if (args.format === 'json') {
    const aggregate = {
      fileName: 'workspace',
      filePath: scanPath,
      findings: result.files.flatMap(f => f.findings),
      irNodes: result.files.flatMap(f => f.irNodes),
      lang: 'typescript' as const,
      score: result.score,
    };
    output = JSON.stringify(generateReportJSON(aggregate, result.score), null, 2);
  } else {
    output = toText(result);
  }

  if (args.output) {
    fs.writeFileSync(args.output, output + '\n', 'utf-8');
    if (!args.quiet) {
      console.log(`Report written to ${args.output}`);
      console.log(`Score: ${result.score.grade} (${result.score.total}/100)`);
    }
  } else if (!args.quiet) {
    console.log(output);
  } else {
    console.log(`${result.score.grade} ${result.score.total}`);
  }

  if (args.threshold > 0 && result.score.total < args.threshold) {
    console.error(`Score ${result.score.total} below threshold ${args.threshold} — failing`);
    process.exit(1);
  }
}

main();
