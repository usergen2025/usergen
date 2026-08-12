# Script generation — live web search (OpenAI Responses API)

## Overview

When a user prompt needs **current or real-world facts**, `ScriptsService.generateVideoScript` runs a **web search pass** before the JSON script step:

1. `ScriptWebSearchService.decideShouldSearch()` — keyword fast path **or** cheap classifier
2. `ScriptWebSearchService.fetchGroundedFacts()` — OpenAI **Responses API** with **forced** web search
3. `generateVideoScript` — existing **Chat Completions** with grounded facts injected (topic-binding rules)

Setting `OPENAI_MODEL_GPT4=gpt-4o` alone does **not** enable search; the Responses pre-step does.

## Forced tool use

Search requests set `tool_choice` so the model **must** call the hosted web-search tool (it cannot answer from priors alone). Default tool is `web_search` with `search_context_size: high`; set `SCRIPT_WEB_SEARCH_TOOL=web_search_preview` if needed for legacy compatibility.

## Auto decision (mode `auto`)

1. **Keyword / year fast path** — live-data keywords → search immediately.
2. **Classifier gate** — otherwise `gpt-4o-mini` returns `{ "needsSearch": boolean, "reason": "..." }`.
3. Named topics without keywords (e.g. `"cockroach janta party"`) rely on the classifier.
4. Classifier errors default to **search**.

## Quality gate + retry

After search, results are treated as **weak** when:

- summary is very short (< 280 chars), or
- no source URLs (text + annotations), or
- summary looks like a pun/joke brief with no news markers

A **stricter retry** runs once. Logs include a summary preview and source URLs.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCRIPT_WEB_SEARCH_ENABLED` | `true` | Master switch |
| `SCRIPT_WEB_SEARCH_MODE` | `auto` | `auto` / `always` / `off` |
| `SCRIPT_WEB_SEARCH_TOOL` | `web_search` | `web_search` or `web_search_preview` |
| `OPENAI_MODEL_WEB_SEARCH` | `gpt-4o` | Responses + web search model |
| `OPENAI_MODEL_WEB_SEARCH_CLASSIFIER` | `gpt-4o-mini` | Needs-search gate |
| `SCRIPT_WEB_SEARCH_TIMEOUT_MS` | `45000` | Search pass timeout |
| `SCRIPT_WEB_SEARCH_CLASSIFIER_TIMEOUT_MS` | `8000` | Classifier timeout |
| `SCRIPT_TEMPERATURE_FACTUAL` | `0.3` | Temperature when grounded facts present |

## Prompt binding

When grounded facts are present, the script user message requires:

- Video subject = real-world entity from the facts (no pun reinterpretation)
- Do not contradict the facts
- Use facts for names, orgs, places, dates, stats

## Logs

- `[ScriptWebSearch] Classifier → needsSearch=...`
- `[ScriptWebSearch] Grounded facts for … chars=… sources=… web_search_call=… preview="…"`
- `[ScriptWebSearch] Sources: …`
- `[ScriptWebSearch] Weak grounding …; retrying with stricter prompt`

## Client

AI client calls use a **180s** Axios timeout so mobile clients are not aborted while search + script generation run.

Optional: `useLiveWebSearch: true` on `generateVideoScript` to force search.
