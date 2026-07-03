# Security Policy

OpenBench runs entirely client-side (no accounts, no server-side data), which keeps
the attack surface small — but registry sim-model templates, imported `.kicad_sch`
files, and `.openbench.json` bundles are untrusted input and are validated/sandboxed
(see `.claude/agents/registry-curator.md` and the adapter error contracts).

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/shuvamk/openbench/security/advisories/new)
rather than a public issue. You should get a response within a week. Please include a
proof of concept if you can.

## Scope notes

- The MCP servers (`packages/mcp-*`) execute locally on a user's machine; report
  anything that lets a crafted IR document or native file escape their sandboxes
  (e.g. SPICE control-card injection through sim templates — templates are plain
  token substitution by design, `.control`/`.include` are rejected).
