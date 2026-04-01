import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface AIEngine {
  id: string;
  label: string;
  available: boolean;
  type: 'cli' | 'api';
}

interface LLMApiConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'custom';
  apiKey: string;
  model: string;
  endpoint?: string;
}

// ── Engine Detection ──────────────────────────────────────────────────

async function commandExists(cmd: string): Promise<boolean> {
  const isWin = process.platform === 'win32';
  try {
    // Use shell: true on Windows to resolve .cmd/.bat wrappers in PATH.
    await execFileAsync(cmd, ['--version'], {
      timeout: 3000,
      shell: isWin,
    });
    return true;
  } catch (err: any) {
    // ENOENT = command not found (works on macOS/Linux; also on Windows without shell).
    if (err?.code === 'ENOENT') return false;

    // On Windows with shell: true, cmd.exe itself is found so Node won't throw
    // ENOENT. Instead cmd.exe exits with code 1 and stderr contains "is not
    // recognized" (English) or a localized equivalent. Check both the English
    // message and the exit-code-with-stderr heuristic for non-English locales.
    if (isWin && err?.code !== 'ETIMEDOUT' && err?.stderr &&
        (/is not recognized/i.test(err.stderr) || /nicht gefunden|n'est pas reconnu|no se reconoce/i.test(err.stderr))) return false;
    if (isWin && err?.status === 1 && err?.stderr && !err?.stdout) return false;

    // Any other error (non-zero exit, timeout) means the binary exists but
    // didn't like --version — that's fine, it's still available.
    return true;
  }
}

export async function detectEngines(): Promise<AIEngine[]> {
  const engines: AIEngine[] = [];

  const checks = await Promise.all([
    commandExists('claude'),
    commandExists('ollama'),
    commandExists('codex'),
    commandExists('gemini'),
    commandExists('aider'),
    commandExists('opencode'),
  ]);

  if (checks[0]) engines.push({ id: 'claude-cli', label: 'Claude', available: true, type: 'cli' });
  if (checks[1]) engines.push({ id: 'ollama', label: 'Ollama', available: true, type: 'cli' });
  if (checks[2]) engines.push({ id: 'codex-cli', label: 'Codex', available: true, type: 'cli' });
  if (checks[3]) engines.push({ id: 'gemini-cli', label: 'Gemini', available: true, type: 'cli' });
  if (checks[4]) engines.push({ id: 'aider', label: 'Aider', available: true, type: 'cli' });
  if (checks[5]) engines.push({ id: 'opencode', label: 'OpenCode', available: true, type: 'cli' });

  // Always show API option
  const vs = vscode.workspace.getConfiguration('kernMcpSecurity');
  const apiKey = vs.get<string>('ai.apiKey', '');
  const apiModel = vs.get<string>('ai.model', '') || 'custom';
  engines.push({
    id: 'api',
    label: apiKey ? `API (${apiModel})` : 'API Key (settings)',
    available: !!apiKey,
    type: 'api',
  });

  return engines;
}

// ── Generation ────────────────────────────────────────────────────────

export async function generateWithEngine(
  engineId: string,
  systemPrompt: string,
  userPrompt: string,
  log: (msg: string) => void,
): Promise<string> {
  if (engineId === 'api') {
    return generateWithAPI(systemPrompt, userPrompt, log);
  }
  return generateWithCLI(engineId, systemPrompt, userPrompt, log);
}

function spawnWithStdin(cmd: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Match commandExists(): use shell on Windows to resolve .cmd/.bat wrappers.
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`${cmd} timed out`)); }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.trim());
      }
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function generateWithCLI(
  engineId: string,
  systemPrompt: string,
  userPrompt: string,
  log: (msg: string) => void,
): Promise<string> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  let output: string;

  switch (engineId) {
    case 'claude-cli':
      log('[AI] Running claude...');
      output = await spawnWithStdin('claude', ['-p'], fullPrompt, 120_000);
      break;
    case 'ollama': {
      const model = vscode.workspace.getConfiguration('kernMcpSecurity').get<string>('ai.model', '') || 'llama3.1';
      log(`[AI] Running ollama (${model})...`);
      output = await spawnWithStdin('ollama', ['run', model], fullPrompt, 120_000);
      break;
    }
    case 'codex-cli':
      log('[AI] Running codex...');
      output = await spawnWithStdin('codex', ['-q'], fullPrompt, 120_000);
      break;
    case 'gemini-cli':
      log('[AI] Running gemini...');
      output = await spawnWithStdin('gemini', ['-p'], fullPrompt, 120_000);
      break;
    case 'aider':
      log('[AI] Running aider...');
      output = await spawnWithStdin('aider', ['--no-git', '--yes', '--message-file', '-'], fullPrompt, 120_000);
      break;
    case 'opencode':
      log('[AI] Running opencode...');
      output = await spawnWithStdin('opencode', ['-p'], fullPrompt, 120_000);
      break;
    default:
      throw new Error(`Unknown engine: ${engineId}`);
  }

  if (!output) throw new Error('Empty response from CLI');
  log(`[AI] Got ${output.length} chars`);
  return output;
}

// ── API fallback ──────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ProviderConfig {
  url: string;
  headers: Record<string, string>;
  body: (messages: ChatMessage[], model: string) => unknown;
  extractContent: (data: unknown) => string;
}

const PROVIDERS: Record<string, (config: LLMApiConfig) => ProviderConfig> = {
  openai: (c) => ({
    url: c.endpoint || 'https://api.openai.com/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
    body: (msgs, model) => ({ model, messages: msgs, temperature: 0.3 }),
    extractContent: (d: any) => d.choices?.[0]?.message?.content ?? '',
  }),

  anthropic: (c) => ({
    url: c.endpoint || 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: (msgs, model) => {
      const system = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const messages = msgs.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
      return { model, system, messages, max_tokens: 8192 };
    },
    extractContent: (d: any) => d.content?.[0]?.text ?? '',
  }),

  gemini: (c) => ({
    url: c.endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`,
    headers: { 'x-goog-api-key': c.apiKey, 'Content-Type': 'application/json' },
    body: (msgs, _model) => {
      const system = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const contents = msgs.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      return { system_instruction: { parts: [{ text: system }] }, contents };
    },
    extractContent: (d: any) => d.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
  }),

  custom: (c) => ({
    url: c.endpoint || '',
    headers: { 'Authorization': `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
    body: (msgs, model) => ({ model, messages: msgs, temperature: 0.3 }),
    extractContent: (d: any) => d.choices?.[0]?.message?.content ?? '',
  }),
};

async function generateWithAPI(
  systemPrompt: string,
  userPrompt: string,
  log: (msg: string) => void,
): Promise<string> {
  const vs = vscode.workspace.getConfiguration('kernMcpSecurity');
  const config: LLMApiConfig = {
    provider: vs.get<string>('ai.provider', 'openai') as LLMApiConfig['provider'],
    apiKey: vs.get<string>('ai.apiKey', ''),
    model: vs.get<string>('ai.model', 'gpt-4o'),
    endpoint: vs.get<string>('ai.endpoint', ''),
  };

  if (!config.apiKey) {
    throw new Error('No API key configured. Set kernMcpSecurity.ai.apiKey in settings.');
  }

  const provider = PROVIDERS[config.provider]?.(config);
  if (!provider) throw new Error(`Unknown provider: ${config.provider}`);
  if (!provider.url) throw new Error('No endpoint URL configured.');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  log(`[AI] Calling ${config.provider} API (${config.model})...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  let resp: Response;
  try {
    resp = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify(provider.body(messages, config.model)),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') throw new Error('API request timed out (120s)');
    throw err;
  }
  clearTimeout(timeout);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const content = provider.extractContent(data);
  if (!content) throw new Error('Empty response from API');

  log(`[AI] Got ${content.length} chars`);
  return content;
}
