# Local Instructions

This repository keeps two different instruction surfaces on purpose.

- `.instructions/` contains repo-local guidance that should travel with the codebase.
- `instructions/` contains the checked-in runtime instruction catalog used by the server bootstrap and lifecycle flow.

Use the local-first retrieval order:

1. nearby code, tests, and repo docs
2. `.instructions/local/`
3. `.instructions/shared/`
4. index-server
5. external documentation

Start new durable learnings in `.instructions/` first. Promote them later through `.specify/config/promotion-map.json` after they prove stable.
