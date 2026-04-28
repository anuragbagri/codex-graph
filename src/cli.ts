#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("codex-graph")
  .description("Codex skill and local JS/TS knowledge graph engine")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check codex-graph installation and project state")
  .action(() => {
    console.log("codex-graph doctor: implementation pending");
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
