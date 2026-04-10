# Security Policy

## Reporting a Vulnerability

If you discover a vulnerability in the toolkit or its scanner, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer or open a private security advisory at [github.com/barleviatias/toolkit-ai/security](https://github.com/barleviatias/toolkit-ai/security)
3. Include steps to reproduce and any relevant details
4. We aim to acknowledge reports within 48 hours

## What We Scan

Every skill, agent, and MCP is scanned before installation:

- **Remote code execution** patterns (`curl | bash`, reverse shells, encoded PowerShell)
- **Unicode steganography** (zero-width characters, bidirectional overrides)
- **Path traversal** attempts (`../` sequences, absolute paths)
- **Symlink escapes** (links pointing outside the resource directory)
- **Size limits** (500 KB per file, 10 MB per directory, 200 files max)
- **MCP-specific checks** (`file://`/`data://` protocols, private IPs, command injection chars)

## Trust Model

- Resources from external sources are **untrusted by default** and always scanned
- Scan results are shown as `ok`, `warn`, or `block` before installation
- Blocking findings prevent installation unless `--force` is used
- The scanner is pattern-based; it does **not**:
  - Execute code in a sandbox
  - Verify cryptographic signatures
  - Detect obfuscated or novel attack patterns

**Always review resources from unknown sources before installing.**

## Supported Versions

Security fixes are applied to the latest release only.
