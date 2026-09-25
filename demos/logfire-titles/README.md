# Investigate T3 titles with Pydantic

Ten constructed conversations exercise T3's real title-generation pipeline with
Luna and the built-in title instructions. The saved baseline has seven titles
that fail the subject check and three healthy controls. This corpus was chosen
to make the problem easy to see; its failure rate describes this demo, not Luna
in general. Titles and evaluation results come from real model calls.

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
```

Open this checkout in a fresh Astra Medium thread in your regular T3 Code
installation and ask:

> These thread titles are bad. Can you use Logfire to figure out why and fix it?

Keep the demo app and Logfire beside it. Use the regular T3 host because changes
to demo server code restart the development server. If your MCP account has
multiple projects, name the project that receives this demo's telemetry.
Native MCP calls show the Pydantic mark, tool name, status, and expandable details.
The agent discovers the cause and decides how to fix and verify it.

For a separate recording desktop containing just the ten examples and an empty
Astra Medium investigation thread, keep `start.mjs` running and use a second terminal:

```sh
vp run build:desktop
node demos/logfire-titles/desktop.mjs
```

The recording desktop uses `.t3/recording-desktop` and ports 14242/6202. Its built
backend stays running while the agent edits the checkout. Evaluations run against
the editable server started above and copy their actual title results into the
recording desktop. Show the before/after measurements in Logfire Evals. Subsequent
launches retain the recording threads; they do not reset an investigation.

## What to inspect

Start with an unhelpful title, open its conversation, then follow the investigator's
MCP calls. Ask it to explain its evidence and show whether its fix improved the
titles. The recorded data includes supplied inputs, outputs, source conversation,
and actual CLI tool events and aggregate token usage. The CLI does not expose its
complete system context or individual model requests; the telemetry labels those limits.

Pydantic Evals publishes to the **T3 title pipeline** dataset. Compare runs with
the same corpus hash and evaluator definitions. `identifies_subject` is a vocabulary-based
signal, not a semantic verdict. Read the titles, including controls and format
failures, alongside the score. Use `--repeat 2` to measure output variation.

`title-prompt.txt` starts empty, which selects the built-in instructions. An
optional prompt experiment can fill it; the server rereads it on each call.
Source hashes in each evaluation identify the prompt and context-builder versions.
Only title and agent activity export. Background HTTP, VCS, and browser traces stay off.

## Replay

Save any investigator changes you want to keep, then restore the files it changed
to this branch's baseline. Reset titles and generate fresh evidence:

```sh
node apps/server/scripts/logfire-title-demo.mjs reset
uv run demos/logfire-titles/evaluate.py --name baseline-take-2
```

Run names must be unique. Reset restores saved titles; evaluation makes fresh calls
and exact wording can vary. The earlier eight-case "T3 sidebar titles" dataset used
a deliberately bad prompt and is not comparable to this scenario. Credentials and
local run artifacts stay untracked.
