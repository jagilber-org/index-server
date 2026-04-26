# Instructions Panel

The Instructions panel provides a management interface for the instruction index.

## instruction index

Browse, search, create, edit, and delete instructions directly from the dashboard.

### Toolbar

- **Refresh** — reload the instruction list from the server
- **Create** — open the instruction editor to add a new entry
- **Filter** — search instructions by name (supports regex patterns)

### Instruction List

Each instruction entry displays:

- **ID** — unique instruction identifier (matches the JSON filename)
- **Title** — human-readable title
- **Categories** — assigned category tags
- **Priority** — priority tier (p0–p3)
- **Status** — governance status (approved, draft, deprecated)
- **Updated** — last modification timestamp

### Actions Per Instruction

- **View** — expand to see the full instruction body
- **Edit** — open the instruction editor with current values
- **Delete** — remove the instruction (disabled only when `INDEX_SERVER_MUTATION=0`)

### Creating Instructions

Required fields:

| Field | Description |
| ----- | ----------- |
| id | Unique identifier (kebab-case, used as filename) |
| title | Descriptive title |
| body | Instruction content (markdown supported, max 1MB) |
| audience | Target audience (agents, humans, all) |
| requirement | Requirement level (mandatory, recommended, optional) |
| priority | Priority number (1–100) |
| categories | Category tags (array, max 50) |

### MCP Tools

The instructions panel uses these MCP tools:

- `index_dispatch` with `action: "list"` — list all instructions
- `index_dispatch` with `action: "get"` — get instruction details
- `index_add` — create or update an instruction
- `index_remove` — delete instructions
- `index_search` — keyword search

### Bulk Operations

- **Import** — use `index_import` to bulk-add entries from JSON array or directory
- **Export** — use `index_dispatch` with `action: "export"` for full Index export

---

**Note:** Write operations are enabled by default. Set `INDEX_SERVER_MUTATION=0` in the server environment when you want an explicit read-only runtime.
