import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'warn' | 'block';

export interface ScanFinding {
  rule: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
}

export interface ScanReport {
  item: string;
  source: string;
  findings: ScanFinding[];
  passed: boolean;
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

const INTERPRETERS = '(?:bash|sh|zsh|fish|ksh|csh|dash|python[23]?|perl|ruby|node|php|lua|tclsh)';

const SUSPICIOUS_PATTERNS: { pattern: RegExp; message: string; severity: Severity }[] = [
  // Remote code execution — piping remote content to any interpreter
  { pattern: new RegExp(`\\bcurl\\b[^\\n]*\\|\\s*${INTERPRETERS}\\b`, 'i'), message: 'Remote code execution: curl piped to shell/interpreter', severity: 'block' },
  { pattern: new RegExp(`\\bwget\\b[^\\n]*\\|\\s*${INTERPRETERS}\\b`, 'i'), message: 'Remote code execution: wget piped to shell/interpreter', severity: 'block' },
  { pattern: new RegExp(`\\bfetch\\b[^\\n]*\\|\\s*${INTERPRETERS}\\b`, 'i'), message: 'Remote code execution: fetch piped to shell/interpreter', severity: 'block' },

  // Inline interpreter execution with arbitrary strings
  { pattern: /\bpython[23]?\s+-c\s+["']/, message: 'Inline python -c execution', severity: 'block' },
  { pattern: /\bperl\s+-e\s+["']/, message: 'Inline perl -e execution', severity: 'block' },
  { pattern: /\bruby\s+-e\s+["']/, message: 'Inline ruby -e execution', severity: 'block' },
  { pattern: /\bnode\s+(?:--eval|-e|-p|--print)\s+["']/, message: 'Inline node -e/-p execution', severity: 'block' },
  { pattern: /\bphp\s+-r\s+["']/, message: 'Inline php -r execution', severity: 'block' },
  { pattern: /\bbash\s+-c\s+["']/, message: 'Inline bash -c execution', severity: 'warn' },

  // Base64-decoded execution
  { pattern: /base64\s+(?:-d|--decode|-D)[^\n]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node|php)\b/i, message: 'Base64-decoded content piped to interpreter', severity: 'block' },
  { pattern: /\$\(\s*(?:echo|printf)\b[^)]*\|\s*base64\s+(?:-d|--decode|-D)/i, message: 'Base64 decode in command substitution', severity: 'block' },

  // Reverse shells
  { pattern: /\bnc\s+-[elp]/, message: 'Netcat reverse shell pattern', severity: 'block' },
  { pattern: /\bncat\s+(?:-e|--exec|--sh-exec|-[elp])/, message: 'Ncat reverse shell pattern', severity: 'block' },
  { pattern: /\bsocat\b[^\n]*(?:EXEC:|SYSTEM:)/i, message: 'Socat EXEC/SYSTEM reverse shell', severity: 'block' },
  { pattern: /\/dev\/tcp\//, message: '/dev/tcp reverse shell connection', severity: 'block' },
  { pattern: /\/dev\/udp\//, message: '/dev/udp reverse shell connection', severity: 'block' },
  { pattern: /\bpowershell\b.*-enc/i, message: 'Encoded PowerShell command', severity: 'block' },
  { pattern: /\bpowershell\b.*-(?:e|ec|encodedcommand)\b/i, message: 'Encoded PowerShell command (short flag)', severity: 'block' },
  { pattern: /\bIEX\s*\(\s*New-Object\s+Net\.WebClient\b/i, message: 'PowerShell Invoke-Expression remote download', severity: 'block' },

  // Hidden unicode (invisible prompt injection)
  { pattern: /[\u200B\u200C\u200D\uFEFF]/, message: 'Zero-width Unicode characters (invisible text injection)', severity: 'block' },
  { pattern: /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/, message: 'Bidirectional text override (text direction manipulation)', severity: 'block' },
];

const PRIVATE_IP_PATTERNS = [
  /^https?:\/\/10\.\d+\.\d+\.\d+/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,
  /^https?:\/\/192\.168\.\d+\.\d+/,
  /^https?:\/\/127\.\d+\.\d+\.\d+/,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/localhost/i,
];

const MAX_FILE_SIZE = 500 * 1024;     // 500KB
const MAX_DIR_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_COUNT = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkDir(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function scanTextContent(content: string, relFile: string, findings: ScanFinding[]): void {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, message, severity } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ rule: 'suspicious-pattern', severity, message, file: relFile, line: i + 1 });
      }
    }
  }
}

function checkPathTraversal(filePath: string, baseDir: string, findings: ScanFinding[]): void {
  const rel = path.relative(baseDir, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    findings.push({
      rule: 'path-traversal',
      severity: 'block',
      message: `Path escapes skill directory: ${rel}`,
      file: rel,
    });
  }
}

function checkSymlink(filePath: string, baseDir: string, findings: ScanFinding[]): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(filePath);
      const rel = path.relative(baseDir, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        findings.push({
          rule: 'symlink-escape',
          severity: 'block',
          message: `Symlink points outside skill directory: ${path.relative(baseDir, filePath)} -> ${target}`,
          file: path.relative(baseDir, filePath),
        });
      }
    }
  } catch {
    // broken symlink — flag it
    findings.push({
      rule: 'broken-symlink',
      severity: 'warn',
      message: `Broken symlink: ${path.relative(baseDir, filePath)}`,
      file: path.relative(baseDir, filePath),
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Trusted sources downgrade 'block' findings to 'warn' */
  trusted?: boolean;
}

/** Scan a skill directory for security issues (RCE patterns, symlink escapes, size limits). */
export function scanSkillDir(skillDir: string, name: string, source: string, opts: ScanOptions = {}): ScanReport {
  const findings: ScanFinding[] = [];
  const files = walkDir(skillDir);

  // Size & complexity checks
  let totalSize = 0;
  for (const f of files) {
    const stat = fs.statSync(f);
    totalSize += stat.size;
    if (stat.size > MAX_FILE_SIZE) {
      findings.push({
        rule: 'large-file',
        severity: 'warn',
        message: `File exceeds ${MAX_FILE_SIZE / 1024}KB: ${path.relative(skillDir, f)} (${Math.round(stat.size / 1024)}KB)`,
        file: path.relative(skillDir, f),
      });
    }
  }
  if (totalSize > MAX_DIR_SIZE) {
    findings.push({
      rule: 'large-skill',
      severity: 'warn',
      message: `Skill directory exceeds ${MAX_DIR_SIZE / 1024 / 1024}MB (${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
    });
  }
  if (files.length > MAX_FILE_COUNT) {
    findings.push({
      rule: 'too-many-files',
      severity: 'warn',
      message: `Skill has ${files.length} files (limit: ${MAX_FILE_COUNT})`,
    });
  }

  for (const filePath of files) {
    const rel = path.relative(skillDir, filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Path traversal
    checkPathTraversal(filePath, skillDir, findings);

    // Symlink escape
    checkSymlink(filePath, skillDir, findings);

    // Text content scanning for text-based files AND executable scripts
    const textExts = new Set([
      '.md', '.txt', '.json', '.yaml', '.yml',
      '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.html',
      // Executable scripts — must be scanned, not copied unchecked
      '.sh', '.bash', '.zsh', '.fish', '.ksh',
      '.py', '.rb', '.pl', '.php', '.lua',
      '.ps1', '.psm1', '.bat', '.cmd',
    ]);
    if (textExts.has(ext)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        scanTextContent(content, rel, findings);
      } catch {
        // skip unreadable files
      }
    }
  }

  // Trusted sources: downgrade blocks to warnings
  if (opts.trusted) {
    for (const f of findings) {
      if (f.severity === 'block') f.severity = 'warn';
    }
  }

  return {
    item: `skill:${name}`,
    source,
    findings,
    passed: !findings.some(f => f.severity === 'block'),
    scannedAt: new Date().toISOString(),
  };
}

/** Scan a single agent file for security issues. */
export function scanAgentFile(agentPath: string, name: string, source: string, opts: ScanOptions = {}): ScanReport {
  const findings: ScanFinding[] = [];

  if (!fs.existsSync(agentPath)) {
    return { item: `agent:${name}`, source, findings, passed: true, scannedAt: new Date().toISOString() };
  }

  const stat = fs.statSync(agentPath);
  if (stat.size > MAX_FILE_SIZE) {
    findings.push({
      rule: 'large-file',
      severity: 'warn',
      message: `Agent file exceeds ${MAX_FILE_SIZE / 1024}KB (${Math.round(stat.size / 1024)}KB)`,
    });
  }

  try {
    const content = fs.readFileSync(agentPath, 'utf-8');
    scanTextContent(content, path.basename(agentPath), findings);
  } catch {
    // skip unreadable
  }

  if (opts.trusted) {
    for (const f of findings) {
      if (f.severity === 'block') f.severity = 'warn';
    }
  }

  return {
    item: `agent:${name}`,
    source,
    findings,
    passed: !findings.some(f => f.severity === 'block'),
    scannedAt: new Date().toISOString(),
  };
}

export interface McpConfigInput {
  name: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envVars?: string[];
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
}

/** Scan an MCP server config for dangerous URLs, private IPs, and injection patterns. */
export function scanMcpConfig(config: McpConfigInput, source: string): ScanReport {
  const findings: ScanFinding[] = [];
  const { name, url, command, args, env, envVars, httpHeaders, envHttpHeaders } = config;

  if (url) {
    // Protocol check
    if (url.startsWith('file://') || url.startsWith('data://')) {
      findings.push({
        rule: 'mcp-protocol',
        severity: 'block',
        message: `Blocked protocol in MCP URL: ${url.split('://')[0]}://`,
      });
    }

    // Private IP check
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(url)) {
        findings.push({
          rule: 'mcp-private-ip',
          severity: 'block',
          message: `MCP URL points to private/internal address: ${url}`,
        });
        break;
      }
    }

    // Command injection in URL
    if (/[;&|`$()]/.test(url)) {
      findings.push({
        rule: 'mcp-injection',
        severity: 'block',
        message: `Possible command injection characters in MCP URL: ${url}`,
      });
    }

    // HTTP warning
    if (url.startsWith('http://') && !url.startsWith('http://localhost')) {
      findings.push({
        rule: 'mcp-insecure',
        severity: 'warn',
        message: `MCP URL uses http:// instead of https://`,
      });
    }
  }

  // Flag stdio MCPs so the UI surfaces the exec intent — install gates on user consent.
  if (command) {
    const preview = [command, ...(args || []).slice(0, 4)].join(' ');
    const truncated = preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
    findings.push({
      rule: 'mcp-stdio-exec',
      severity: 'warn',
      message: `Stdio MCP will execute on every agent session: ${truncated}`,
    });
  }

  const suspiciousText = [
    command,
    ...(args || []),
    ...Object.values(env || {}),
    ...(envVars || []),
    ...Object.values(httpHeaders || {}),
    ...Object.keys(httpHeaders || {}),
    ...Object.values(envHttpHeaders || {}),
    ...Object.keys(envHttpHeaders || {}),
  ]
    .filter(Boolean)
    .join('\n');
  if (suspiciousText) scanTextContent(suspiciousText, `${name}.mcp`, findings);

  return {
    item: `mcp:${name}`,
    source,
    findings,
    passed: !findings.some(f => f.severity === 'block'),
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const DIM    = '\x1b[2m';

/** Format a scan report as a colored terminal string. */
export function formatReport(report: ScanReport): string {
  if (report.findings.length === 0) {
    return `  ${GREEN}[OK]${RESET} ${report.item}`;
  }

  const lines: string[] = [];
  const icon = report.passed ? `${YELLOW}[!]${RESET}` : `${RED}[BLOCKED]${RESET}`;
  lines.push(`  ${icon} ${BOLD}${report.item}${RESET}`);

  for (const f of report.findings) {
    const sev = f.severity === 'block' ? `${RED}block${RESET}` : `${YELLOW}warn${RESET}`;
    const loc = f.file ? ` ${DIM}${f.file}${f.line ? `:${f.line}` : ''}${RESET}` : '';
    lines.push(`      ${sev} ${f.message}${loc}`);
  }

  return lines.join('\n');
}
