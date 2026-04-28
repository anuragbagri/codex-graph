# codex-graph

`codex-graph` is a public Codex skill plus a local JavaScript/TypeScript codebase
knowledge graph engine.

It is inspired by Graphify's installable skill plus graph architecture, but scoped
to OpenAI Codex workflows and JS/TS repositories. The goal is simple: let Codex
query a compact, deterministic graph before spending time reading raw files.

## Install

```bash
npm install -g codex-graph
codex-graph install --platform codex
```

No global install:

```bash
npx codex-graph install --platform codex
```

Codex may need to be restarted after installing the skill.

## Why Graph-First Context?

Codex often needs to answer questions like "where is auth handled?", "what tests
cover this service?", or "what breaks if I change this file?". Reading the repo
from scratch each time wastes context and time.

`codex-graph` builds a local graph of files, symbols, imports, exports, tests,
routes, configs, and module relationships. Codex can query that graph first,
then inspect only the raw files that matter.

## How This Differs From Memory and Vector RAG

- It is not conversation memory.
- It is not vector search.
- It does not store user preferences or chat history.
- It is an auditable codebase graph with deterministic local queries.
- It does not call an LLM or require API keys in v1.

## Commands

```bash
codex-graph init
codex-graph build [path]
codex-graph update
codex-graph query "where is the user service?"
codex-graph explain UserService
codex-graph deps src/services/user-service.ts
codex-graph path src/main.ts UserService
codex-graph impact UserService
codex-graph visualize
codex-graph serve
```

## Codex Usage

Install the Codex skill:

```bash
codex-graph install --platform codex
```

Inside a repository:

```bash
codex-graph init
codex-graph codex install
codex-graph build .
```

The generated `AGENTS.md` tells Codex to run graph queries before answering
architecture, dependency, flow, symbol, route, test, or impact questions.

## MCP Setup

```bash
codex-graph mcp install
codex-graph serve
```

The MCP server exposes compact graph tools for Codex-compatible clients.

## Outputs

`codex-graph` writes local project artifacts under `.codex-graph/`:

- `graph.json`
- `CODEX_GRAPH_REPORT.md`
- `graph.html`
- `stats.json`
- `warnings.json`
- `cache/`

Teams can commit graph artifacts if they want shared Codex context. Local cache
files should usually remain ignored.

## Limitations

- V1 supports JavaScript and TypeScript repositories only.
- Runtime behavior, dynamic imports, decorators, and metaprogramming are partial.
- The graph narrows context; it does not replace raw file reading.
- No embeddings or LLM summaries are implemented in v1.
- It is codebase knowledge, not user memory.

## Public Release

Before publishing:

```bash
pnpm build
pnpm test
npm pack --dry-run
```

Publish:

```bash
npm publish
```
