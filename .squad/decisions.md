# Decisions

> Canonical decision ledger. Append-only. Scribe merges from `.squad/decisions/inbox/`.

---

### 2026-02-26T15:20:00Z: Team formation
**By:** Squad (Coordinator)
**What:** Team formed with Matrix casting: Morpheus (Lead), Trinity (Backend), Tank (Tester), Oracle (DevRel), Scribe, Ralph.
**Why:** Index Server is a protocol-heavy backend system. Needs architecture oversight, implementation muscle, test discipline, and documentation for 50-tool surface.

### 2026-02-26T15:21:00Z: Model policy — sonnet/opus 4.6 only
**By:** Jason Gilbertson (via Copilot)
**What:** All agents must use claude-sonnet-4.5 or claude-opus-4.6. No haiku. Morpheus gets opus (premium — architecture + review gates). Trinity, Tank, Oracle, Scribe get sonnet.
**Why:** User directive — quality over cost.

### 2026-02-26T15:20:00Z: Constitution adopted
**By:** Squad (Coordinator)
**What:** Project governed by constitution.json — Q1-Q8 (quality), S1-S4 (security), A1-A5 (architecture), G1-G5 (governance), PB1-PB5 (publishing). All agents must comply.
**Why:** Pre-existing governance. TDD required, strict mode, conventional commits, no auto-push, dual-repo publishing.
