Eight conversations in T3's “Title generation demo” project have generated titles that make the sidebar hard to navigate. Diagnose and fix title generation, keeping Luna as the model.

Start with Logfire MCP evidence before editing. Use the connected native Logfire MCP tools so each call is visible in T3's activity. Select the supplied project and region. If the tools are unavailable or authentication fails, report that the operator must connect Logfire before continuing. Keep credentials private and leave auth files untouched.

Find recent `generate thread title` spans for `t3.thread.id` starting with `logfire-title-`. Compare at least two bad titles and the CI/topic-change controls. Inspect the actual model input, raw response, displayed title, model, and prompt hash. Explain what the traces establish about model behavior versus context loss or output cleanup. Cite trace IDs or links.

Make the smallest general prompt fix in `demos/logfire-titles/title-prompt.txt`. T3 rereads it on every title request. Do not change the model, dataset, saved baseline, evaluation checks, or server code, and do not special-case corpus subjects. The goal is titles that identify the work while still following genuine topic changes.

Verify through the running T3 instance:

```sh
T3_DEMO_ORIGIN=<supplied API origin> uv run demos/logfire-titles/evaluate.py --name <supplied run name>
```

This uses T3's real regeneration path and records a Pydantic Evals experiment. If a check fails, inspect its title and trace, improve the general prompt, and rerun with a new run name. Do not claim success from valid JSON or HTTP success alone. Finish with the cause, changed prompt behavior, measured subject pass count, and native Logfire evaluation link. Do not commit or push.
