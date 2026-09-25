# Investigate T3 titles with Pydantic

Ten constructed conversations exercise T3's real title-generation pipeline with
Luna and the built-in title instructions. The corpus includes short controls,
genuine topic changes, and longer conversations with pasted test output. Titles
and evaluation results come from real model calls. There is no deliberately
incorrect system prompt.

## Start

Use Node 24, `vp`, `uv`, and an authenticated Codex CLI with Luna and Astra access:

```sh
vp i
cp docs/operations/logfire-demo.env.example .env.local
# Add your Logfire project's write token to .env.local.
node demos/logfire-titles/start.mjs
```

Open the printed pairing URL. The isolated state stays in this checkout's `.t3`.
Saved titles appear immediately; generate fresh evidence in your Logfire project:

```sh
uv run demos/logfire-titles/evaluate.py --name baseline
codex mcp add logfire --url https://logfire-us.pydantic.dev/mcp
# If configured but unauthenticated: codex mcp login logfire
T3_DEMO_LOGFIRE_PROJECT=YOUR_ORG/YOUR_PROJECT node apps/server/scripts/logfire-title-demo.mjs investigate
```

The last command prints [the investigation prompt](investigate.md) with the latest
completed evaluation filled in. Paste it into a fresh Astra Medium thread in your
regular T3 Code installation, with this checkout open. Keep the demo app and
Logfire beside it. The investigator must run on the regular host: changes to demo
server code restart the development server.
Native MCP calls show the Pydantic mark, tool name, status, and expandable details.
The agent can inspect and fix the pipeline; its answer is not prescribed.

## What to inspect

Start with an unhelpful title, open its conversation, then follow the investigator's
MCP calls. In Logfire, compare the original messages with the input T3 supplied,
the raw response, and the final title. The context-selection metadata identifies
omitted and shortened messages. Provider child spans record actual CLI tool events
and aggregate token usage. The CLI does not expose its complete system context or
individual model requests; the telemetry labels those limits.

Pydantic Evals publishes to the **T3 title pipeline** dataset. Evaluation spans and
title spans share `t3.request.id`; the evaluated log contains the title, checks,
and expected vocabulary groups, so an MCP investigator can join outcomes to traces.
Compare runs with the same corpus hash. `identifies_subject` is a vocabulary-based
signal, not a semantic verdict. Read the titles, including controls and format
failures, alongside the score. Use `--repeat 2` to measure output variation.

`title-prompt.txt` starts empty, which selects the built-in instructions. An
optional prompt experiment can fill it; the server rereads it on each call.
Source hashes in each evaluation identify the prompt and context-builder versions.
Only title and agent activity export. Background HTTP, VCS, and browser traces stay off.

## Replay

Save any investigator changes you want to keep, then restore the affected source
files to this branch's baseline. For the context-budget repair, reset with:

```sh
git restore apps/server/src/textGeneration/ThreadTitleContext.ts \
  apps/server/src/textGeneration/ThreadTitleContext.test.ts \
  demos/logfire-titles/title-prompt.txt
node apps/server/scripts/logfire-title-demo.mjs reset
uv run demos/logfire-titles/evaluate.py --name baseline-take-2
```

Run names must be unique. Reset restores saved titles; evaluation makes fresh calls
and exact wording can vary. The earlier eight-case "T3 sidebar titles" dataset used
a deliberately bad prompt and is not comparable to this scenario. Credentials and
local run artifacts stay untracked.
