# T3 titles, diagnosed with Pydantic

This demo starts in T3 Code with eight conversations and real Luna-generated
titles. Three unrelated threads are named “Open the PR.” Requests succeeded and
format checks passed; the useful subject disappeared.

The conversations are constructed fixtures. The branch deliberately supplies a
weak title prompt that prioritizes the latest action. The saved outputs in
`baseline.json` came from real `gpt-6-luna` calls through T3, not handwritten bad
titles. This is a reproducible prompt-debugging exercise, not evidence that the
production T3 prompt has this defect.

## Start

Use Node 24, `vp`, `uv`, and an authenticated Codex CLI with Luna and Astra access.
From this branch's checkout:

```sh
vp i
cp docs/operations/logfire-demo.env.example .env.local
# Put your Logfire project's write token in .env.local.
node demos/logfire-titles/start.mjs
```

Open the pairing URL printed in the terminal. The eight saved titles are already
in the sidebar. State stays inside this checkout's `.t3`; restarting preserves
changes. The runner records its selected ports, so the commands below need no
hardcoded localhost settings.

In a second terminal, generate fresh evidence in **your** Logfire project:

```sh
uv run demos/logfire-titles/evaluate.py --name baseline
```

This regenerates all eight titles through the running T3 server, exports the
actual model inputs and raw/final outputs, and prints a native Pydantic Evals link.
Each evaluation result has the T3 thread and request IDs. Only agent activity and
title calls export; background HTTP, VCS, and browser activity stay out of Logfire.

## Give it to an agent

Connect the [Logfire MCP](https://pydantic.dev/docs/logfire/guides/mcp-server/) to
Codex and complete the browser login before starting a fresh investigator thread:

```sh
codex mcp add logfire --url https://logfire-us.pydantic.dev/mcp
# If it is already configured but needs authentication: codex mcp login logfire
T3_DEMO_LOGFIRE_PROJECT=YOUR_ORG/YOUR_PROJECT node apps/server/scripts/logfire-title-demo.mjs investigate
```

The second command opens a new Astra Medium thread in T3 and sends
[`investigate.md`](investigate.md). You can also paste that handoff into a new T3
thread yourself. Native calls appear in T3 with the Pydantic mark, the Logfire MCP
name, tool name, and call status. Expand a call to inspect its arguments and result.
Keep the investigator thread beside Logfire's trace or experiment view while filming.

The earlier rehearsals used the official Logfire CLI's hosted `mcp query` commands.
Those remain ordinary shell activity in T3. Use the native connection above when
demonstrating visible MCP tool usage.

The agent must inspect failing calls and controls through MCP, change only
`title-prompt.txt`, and run Pydantic Evals again. The server rereads the prompt on
each request; no restart is needed. The CI case checks that workflow terminology
is retained when it is the actual subject. The topic-change case checks that a
fix follows a real pivot instead of always naming the first message.

Show the bad sidebar, the agent's trace-based diagnosis, the changed sidebar,
and **identifies_subject** in Logfire's experiment comparison. Aggregate
scores hide the problem: the recorded baseline passes 19/24 assertions, yet only
3/8 titles identify their subject. The subject evaluator uses visible vocabulary
groups, so inspect the actual titles alongside its score.

## Replay

After saving any prompt changes you want to keep:

```sh
git restore demos/logfire-titles/title-prompt.txt
node apps/server/scripts/logfire-title-demo.mjs reset
uv run demos/logfire-titles/evaluate.py --name baseline-take-2
```

Reset restores the recorded titles without pretending to make new model calls.
Evaluation makes fresh calls, so exact wording can vary. Run names must be unique.
The short corpus tests this scenario, not general title quality or a guaranteed
agent repair rate. Credentials and generated run artifacts remain untracked.
