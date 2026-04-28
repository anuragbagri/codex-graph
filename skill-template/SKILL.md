# codex-graph

Use this skill when working in JavaScript or TypeScript repositories and the user asks
about architecture, dependencies, impact, routes, tests, symbols, or where behavior
lives.

Before reading many raw files, query the local graph:

```bash
codex-graph query "<question>"
codex-graph explain <symbol-or-file>
codex-graph deps <file-or-symbol>
codex-graph path <from> <to>
codex-graph impact <file-or-symbol>
```

If `.codex-graph/graph.json` is missing or stale, run:

```bash
codex-graph build .
```

Treat graph output as a deterministic map. Inspect the suggested files directly
before editing or making final claims.
