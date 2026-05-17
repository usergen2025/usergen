-- Idempotent: rewrite prizePoolJson from legacy band shapes to canonical tiers[].
-- Skips rows that already have a valid tiers array with rankCutoff/bps.

UPDATE "Campaign"
SET "prizePoolJson" = jsonb_build_object(
  'templateKey', COALESCE("prizePoolJson"->>'templateKey', 'BALANCED'),
  'tieBreaker', COALESCE("prizePoolJson"->>'tieBreaker', 'EARLIER_VERIFIED_POST'),
  'minViewsToQualify', COALESCE(("prizePoolJson"->>'minViewsToQualify')::int, 0),
  'gracePeriodHours', COALESCE(("prizePoolJson"->>'gracePeriodHours')::int, 24),
  'frozenAt', "prizePoolJson"->>'frozenAt',
  'frozenBy', "prizePoolJson"->>'frozenBy',
  'tiers', CASE COALESCE("prizePoolJson"->>'templateKey', 'BALANCED')
    WHEN 'WINNER_HEAVY' THEN '[
      {"rankCutoff":1,"bps":3000,"label":"Rank 1"},
      {"rankCutoff":2,"bps":1800,"label":"Rank 2"},
      {"rankCutoff":3,"bps":1200,"label":"Rank 3"},
      {"rankCutoff":10,"bps":2000,"label":"Rank 4–10"},
      {"rankCutoff":100,"bps":1300,"label":"Rank 11–100"},
      {"rankCutoff":1000,"bps":500,"label":"Rank 101–1000"},
      {"rankCutoff":null,"bps":200,"label":"Rank 1001+"}
    ]'::jsonb
    WHEN 'WIDE_REACH' THEN '[
      {"rankCutoff":1,"bps":1000,"label":"Rank 1"},
      {"rankCutoff":2,"bps":700,"label":"Rank 2"},
      {"rankCutoff":3,"bps":500,"label":"Rank 3"},
      {"rankCutoff":10,"bps":1800,"label":"Rank 4–10"},
      {"rankCutoff":100,"bps":2400,"label":"Rank 11–100"},
      {"rankCutoff":1000,"bps":2200,"label":"Rank 101–1000"},
      {"rankCutoff":null,"bps":1400,"label":"Rank 1001+"}
    ]'::jsonb
    ELSE '[
      {"rankCutoff":1,"bps":1800,"label":"Rank 1"},
      {"rankCutoff":2,"bps":1200,"label":"Rank 2"},
      {"rankCutoff":3,"bps":800,"label":"Rank 3"},
      {"rankCutoff":10,"bps":2400,"label":"Rank 4–10"},
      {"rankCutoff":100,"bps":2200,"label":"Rank 11–100"},
      {"rankCutoff":1000,"bps":1200,"label":"Rank 101–1000"},
      {"rankCutoff":null,"bps":400,"label":"Rank 1001+"}
    ]'::jsonb
  END
)
WHERE "prizePoolJson" IS NOT NULL
  AND "payoutModel" = 'POOL'
  AND NOT (
    jsonb_typeof("prizePoolJson"->'tiers') = 'array'
    AND jsonb_array_length("prizePoolJson"->'tiers') > 0
    AND ("prizePoolJson"->'tiers'->0 ? 'rankCutoff')
  );
