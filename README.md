# OpenBench

**The open workbench for electronics.** Design schematics, simulate circuits, build and flash firmware — all in the browser, all open source, all driven through one canonical interchange format.

OpenBench orchestrates existing best-in-class open engines — **KiCad** (schematic/EDA), **ngspice** (analog simulation), **Renode/QEMU** (MCU emulation), **PlatformIO/Zephyr** (firmware build) — behind a common, versioned intermediate representation (IR), exposed to AI agents via [MCP](https://modelcontextprotocol.io) servers and to humans via a Figma-grade browser UI.

## Mission

Make embedded/electronics development as fluid and collaborative as modern design tools made graphics: **schematic → simulation → firmware → (virtual) hardware** in one continuous, browser-based loop, with no proprietary lock-in at any layer.

## Non-goals

- Re-implementing EDA/simulation/emulation engines from scratch — we orchestrate proven open engines, we don't replace them.
- Proprietary file formats — engine-native formats are translation targets; the [IR](.context/interchange-format.md) is canonical.
- PCB fabrication/CAM (deferred; schematic → sim → firmware is the current loop).

## Architecture (short version)

```
                 ┌────────────────────────────────────────────┐
                 │  apps/web — browser UI (Next.js + Astryx)  │
                 └─────────────────────┬──────────────────────┘
                                       │  IR documents (JSON, versioned)
      ┌──────────────┬─────────────────┼──────────────────┬──────────────┐
      │              │                 │                  │              │
┌─────┴─────┐  ┌─────┴──────┐  ┌───────┴────────┐  ┌──────┴───────┐ ┌────┴─────┐
│ ir-schema │  │ mcp-kicad  │  │ mcp-sim-ngspice│  │ mcp-firmware │ │ registry │
│ (canon)   │  │ (import/   │  │ (netlist→sim)  │  │ -platformio  │ │ (parts)  │
│           │  │  export)   │  │                │  │ (build/flash)│ │          │
└───────────┘  └────────────┘  └────────────────┘  └──────────────┘ └──────────┘
```

Full detail: [.context/architecture.md](.context/architecture.md). The single most important document in this repo is the interchange format: [.context/interchange-format.md](.context/interchange-format.md).

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/web` | Browser app (Next.js App Router + [Astryx](https://github.com/facebook/astryx) design system) — UI and API routes |
| `packages/ir-schema` | The canonical IR: schemas, validation, versioning |
| `packages/netlist-compiler` | Schematic IR → engine-agnostic netlist IR |
| `packages/mcp-kicad` | MCP server wrapping KiCad import/export |
| `packages/mcp-sim-ngspice` | MCP server wrapping ngspice simulation |
| `packages/mcp-firmware-platformio` | MCP server wrapping PlatformIO builds |
| `docs/` | Long-form docs |
| `.context/` | The living brain — architecture, decisions, engine status (read before acting) |
| `.claude/` | Agent skills, hooks, and roles that run this repo |
| `.github/` | CI, label taxonomy, automation |

## How this repo is built

OpenBench is built **fully autonomously by AI agents**. There is no human PR review; the pipeline is:

`planner → tdd-implementer → reviewer (sole merge gate) → auto-merge → Vercel deploy → deploy-sanity`

driven entirely by GitHub issue status transitions ([.github/LABELS.md](.github/LABELS.md)). Every source change lands with a failing test committed first — see the TDD contract in [CLAUDE.md](CLAUDE.md).

## Getting started (humans and agents alike)

```bash
npm install          # npm workspaces — installs everything
npm test             # full test suite
npm run dev          # apps/web on http://localhost:3000
```

## License

[Apache-2.0](LICENSE) — the patent grant matters for hardware IP.
