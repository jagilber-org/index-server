# Schemas

Authoritative JSON Schemas for persisted and exchanged objects.

| Schema | Description |
|--------|-------------|
| `instruction.schema.json` | Canonical instruction entry persisted on disk. |
| `feedback-entry.schema.json` | Feedback subsystem persistent record. |
| `usage-event.schema.json` | Single instruction usage event (pre-aggregation). |
| `usage-batch.schema.json` | Batch of usage events flushed together. |
| `usage-buckets.schema.json` | Rotating temporal usage counters container. |

All schemas draft-07. Internal references use relative `$ref` where applicable.
