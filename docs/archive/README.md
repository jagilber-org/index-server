# Documentation Archive

This directory contains historical, point-in-time or temporal analysis artifacts that are
no longer part of the active governance & implementation set, but are preserved for
traceability and forensic reference.

Retention policy (initial draft):

- Checkpoints / health snapshots: keep last 3 months, then prune quarterly.
- Feedback analysis reports: retain while related issue is open + 1 release after closure.
- Agent state JSON snapshots: keep most recent per week (older collapsed to weekly).
- Empty / placeholder reports (size = 0) may be deleted at any time.

Active documents (authoritative) live in the parent `docs/` folder and are indexed in
`../DOCS-INDEX.md`.

Subfolders are organized by year for scalability.
