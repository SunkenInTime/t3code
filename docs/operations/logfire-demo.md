# Logfire agent demo

Use `demo/logfire-live` with Node 24, `vp`, and an authenticated Codex or Claude CLI.
This branch records agent turns, model responses, tool calls, and subagents. It does
not record or export background server/browser traces, write a local trace file,
or export application metrics and logs. Server diagnostics still print to stdout.
No Logfire SQL filter is needed.

## Start

From a fresh checkout of the branch:

```sh
vp i
cp docs/operations/logfire-demo.env.example .env.local
```

Replace `<write token>` in `.env.local` with a write token for your Logfire project.
The template uses the US region. Use your project's regional trace endpoint if it
is elsewhere. Message and tool content capture is enabled so the demo includes
prompts, responses, arguments, and results. Keep `.env.local` private; it is ignored
by Git.

```sh
vp run dev
```

Open the full pairing URL printed by the runner, then open the same Logfire project
in another tab. The runner creates a project and an empty thread for this checkout.
In a linked worktree, data stays under `.t3/userdata`; a main checkout uses the dev
home described in [Development](development.md#state-and-ports).

## Exercise the trace

Start a new Codex or Claude thread in T3 Code and send:

> Run `git status --short --branch`, then read `package.json` and summarize the
> available development commands. Do not modify files.

Watch Logfire Live or Agents. Expect an agent run with model responses and tool
calls beneath it. Long operations appear before they finish. A fresh Codex thread
provides the richest model/tool detail; resumed Codex threads have less timing
information. See [Agent runs](observability.md#agent-runs-genai-spans).

The view is empty while idle. Old background records already in the Logfire project
remain in history; move the time range past the restart or use a fresh project.
Restarting with `vp run dev` reuses your local project, thread history, and config.
To repeat the demo, start another new thread rather than deleting the database.
