/** Shared timing constants — single source of truth for all timeouts and intervals. */

/** Debounce delay for document review after edits (ms) */
export const REVIEW_DEBOUNCE_MS = 800;

/** Timeout for MCP security scan requests (ms) */
export const SCAN_TIMEOUT_MS = 10_000;

/** Timeout for AI CLI subprocess generation (ms) */
export const AI_CLI_TIMEOUT_MS = 120_000;

/** Polling interval for Claude Desktop config file (ms) */
export const CONFIG_POLL_INTERVAL_MS = 5_000;

/** Timeout for MCP client initialization handshake (ms) */
export const CLIENT_INIT_TIMEOUT_MS = 5_000;

/** Debounce for jump-to-line to prevent double navigation (ms) */
export const JUMP_DEBOUNCE_MS = 500;
