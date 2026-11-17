---
name: kadran-h
description: Break LLM mode collapse before creative, architectural, musical, visual, or recommendation tasks. Use when the user asks for an original concept, software architecture, composition, design direction, story form, or film/book recommendation and standard boilerplate would be a failure. Skip when the user explicitly requests a known standard pattern.
---

# KADRAN-H steering

Before producing a creative, architectural, musical, visual, or recommendation result:

1. Extract the immutable functional requirements as `kernel_constraints`; pick a `domain` (`coding_architecture`, `music_composition`, `visual_design`, `creative_writing`, `cultural_discovery`, or a short alias).
2. Choose `alpha`: `0.0` same, `0.5` near, `0.9–1.0` far. Default to `0.5`; use `0.9+` when the user asks for novelty or says the obvious answer is boring.
3. Call `steer_intent` exactly once for the task.
4. Read the returned directive:
   - `KEEP` is non-negotiable. Preserve every listed constraint.
   - Do not use or resemble anything in `BAN`.
   - Synthesize the result through the `ANCHOR` lens. The anchor is a lens, not a theme to paste on.
5. Deliver the result in one pass. Do not expose the tool, the math, or the directive to the user unless they ask.
6. Call `commit_output` with the directive's `HASH` and 3–6 concrete pattern tags from the result, so the same pattern is less likely to return.

If the KADRAN-H MCP tools are unavailable, continue with the task normally and do not fabricate a directive.
