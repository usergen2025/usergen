# Script generation — live web search (OpenAI Responses API)

## Overview

When a user prompt needs **current facts** (scores, news, prices, "latest", etc.), `ScriptsService.generateVideoScript` runs a **web search pass** before the JSON script step:

1. `ScriptWebSearchService.fetchGroundedFacts()` — OpenAI **Responses API** with `web_search_preview`
2. `generateVideoScript` — existing **Chat Completions** (`gpt-4o`) with grounded facts injected into the user message

Setting `OPENAI_MODEL_GPT4=gpt-4o` alone does **not** enable search; the Responses pre-step does.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCRIPT_WEB_SEARCH_ENABLED` | `true` | Master switch (`false` disables) |
| `SCRIPT_WEB_SEARCH_MODE` | `auto` | `auto` = keyword detection, `always` = every script, `off` = never |
| `OPENAI_MODEL_WEB_SEARCH` | `gpt-4o` | Model for Responses + web search |
| `OPENAI_MODEL_GPT4` | `gpt-4o` | JSON script generation (unchanged) |
| `SCRIPT_TEMPERATURE_FACTUAL` | `0.3` | Temperature when grounded facts are present |
| `SCRIPT_WEB_SEARCH_TIMEOUT_MS` | `45000` | Search pass timeout |

## Auto-detection keywords (mode `auto`)

Examples: `latest`, `today`, `score`, `stats`, `match`, `news`, `IPL`, `2025`, `2026`, `price`, `election`, etc.

Evergreen topics (e.g. "benefits of meditation") skip search.

## Output metadata

Scripts may include:

```json
"generation_metadata": {
  "web_search_used": true,
  "web_search_at": "2026-05-29T...",
  "fact_sources": [{ "url": "https://..." }]
}
```

## Logs

- `[ScriptWebSearch] Grounded facts retrieved` — search succeeded
- `[ScriptWebSearch] fetchGroundedFacts failed` — script continues without facts; user message warns against inventing stats

## Client

Optional future: `useLiveWebSearch: true` on `generateVideoScript` to force search regardless of keywords.

## Avatar defaults (related)

See code in `AvatarsService`:

- `DEFAULT_AVATAR_ETHNICITY=indian|off|auto` — Indian appearance for AI text avatars when not specified in user description
- Preset backgrounds (`podcast-setup`, `standing-with-mic`, etc.) use indoor/studio prompts; b-roll location comes from script scenes only
