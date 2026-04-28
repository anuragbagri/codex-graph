# codex-graph Commands

## Install

```bash
codex-graph install --platform codex
codex-graph uninstall --platform codex
codex-graph doctor
```

## Project

```bash
codex-graph init
codex-graph codex install
codex-graph codex status
codex-graph codex uninstall
```

## Graph

```bash
codex-graph build .
codex-graph update
codex-graph query "where is the user service?"
codex-graph explain UserService
codex-graph deps src/services/user-service.ts
codex-graph path src/main.ts UserService
codex-graph impact UserService
codex-graph visualize
codex-graph serve
```
