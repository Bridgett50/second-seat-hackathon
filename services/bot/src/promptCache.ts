// One stable prompt-cache key per call family (one key per shared prefix);
// see meta-docs/general/prompt-caching.md:66. Stable constants only,
// never per-user/per-request/per-meeting values.
export const PROMPT_CACHE_KEYS = {
  brief: "second-seat-brief",
  shield: "second-seat-shield",
  support: "second-seat-support",
} as const;
