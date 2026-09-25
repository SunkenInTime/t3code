I've been trying to get title generation working. Several conversations have titles that don't identify what the user actually wanted. Use Logfire to investigate the title-generation pipeline, see what calls and tools are involved, and find the cause.

Start with the connected native Logfire MCP tools. Inspect the supplied evaluation run, then correlate its cases with title traces using `t3.request.id`. Compare failing cases with successful controls. Query attributes selectively rather than dumping entire conversations. Follow the evidence into the code when useful, and cite traces that support your diagnosis. Distinguish recorded facts from hypotheses and visibility gaps. If MCP is unavailable, report the connection issue before proceeding.

Make the smallest general fix supported by the evidence. You can change title prompts or pipeline code as needed. Keep the model, corpus, saved baseline, and evaluation checks fixed. Don't special-case subjects or manually rename threads. Preserve unrelated work, keep credentials private, and do not launch other agents or commit/push.

Verify through the running T3 server with Pydantic Evals:

```sh
T3_DEMO_ORIGIN=<supplied API origin> uv run demos/logfire-titles/evaluate.py --name <supplied run name>
```

Review the actual titles alongside the subject and format checks. The subject evaluator uses vocabulary hints, so report borderline judgments honestly. Inspect the new traces to check that the proposed cause changed, rather than claiming a higher score proves the mechanism. If needed, iterate with a unique run name. Finish with the cause, trace evidence, measured before/after results, and the native Logfire comparison link.
