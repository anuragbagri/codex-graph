# Troubleshooting

- If queries say no graph exists, run `codex-graph build .` from the project root.
- If Codex does not discover the skill, restart Codex after `codex-graph install --platform codex`.
- If a JS/TS import is missing, check `.codexgraphignore` and parser warnings in `.codex-graph/warnings.json`.
- V1 is deterministic and local-only; it does not use embeddings, API keys, or LLM summaries.
