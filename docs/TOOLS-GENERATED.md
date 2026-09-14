# Generated Tool Registry

Registry Version: 2026-06-01

Tier: **admin** — the full declared surface, 65 tools (core 8, extended 26, admin 31).
A running server advertises fewer: `core` only, unless `INDEX_SERVER_FLAG_TOOLS_EXTENDED=1`
or `INDEX_SERVER_FLAG_TOOLS_ADMIN=1` is set. Tiers control what `tools/list` shows, not what
may be called. The `diagnostics_*` tools additionally require `INDEX_SERVER_STRESS_DIAG=1` or
`INDEX_SERVER_DEBUG=1`, and the `messaging_*` tools `INDEX_SERVER_MESSAGING_ENABLED=1`; without
those they are not registered at all, at any tier.

| Method | Tier | Stable | Mutation | Description |
|--------|------|--------|----------|-------------|
| bootstrap | core | yes |  | Unified bootstrap dispatcher. Actions: request, confirm, status. |
| bootstrap_confirmFinalize | admin |  | yes | Finalize bootstrap by submitting issued token; enables guarded mutations. |
| bootstrap_request | admin |  | yes | Request a human confirmation bootstrap token (hash persisted, raw returned once). |
| bootstrap_status | admin | yes |  | Return bootstrap gating status (referenceMode, confirmed, requireConfirmation). |
| dashboard_config | admin | yes |  | Deterministic snapshot of every recognized environment / feature flag with metadata (category, stability, default, reload behavior). Flags marked sensitive return only a present boolean, never the value. |
| diagnostics_block | admin |  | yes | Intentionally CPU blocks the event loop for N ms (diagnostic stress). |
| diagnostics_handshake | admin | yes |  | Return recent handshake events (ordering/ready/list_changed trace). |
| diagnostics_memoryPressure | admin |  | yes | Allocate &amp; release transient memory to induce GC / memory pressure. |
| diagnostics_microtaskFlood | admin |  | yes | Flood the microtask queue with many Promise resolutions to probe event loop starvation. |
| feature_status | admin | yes |  | Report active index feature flags and counters. |
| feedback_manage | extended |  | yes | Manage feedback entries through a single action dispatcher. Actions: submit, list, get, update, delete, stats. |
| feedback_submit | core | yes |  | Submit feedback entry (issue, status report, security alert, feature request, etc.). |
| gates_evaluate | extended | yes |  | Evaluate configured gating criteria over current index. |
| graph_export | extended | yes |  | Export instruction relationship graph (schema v1 minimal or v2 enriched). |
| health_check | core | yes |  | Returns server health status &amp; version. |
| help_overview | core | yes |  | Structured onboarding guidance for new agents (tool discovery, index lifecycle, promotion workflow). |
| index_add | extended |  | yes | Add a single instruction (lax mode fills defaults; overwrite optional). |
| index_archive | admin |  | yes | Archive one or more active instructions (move to archive store, atomically). Closed-enum reason taxonomy (deprecated\|superseded\|duplicate-merge\|manual\|legacy-scope). Restorable unless restoreEligible:false. Surfaced via index_dispatch action:"archive". |
| index_debug | admin | yes |  | Dump raw index state for debugging (entry count, keys, load status). |
| index_diagnostics | admin | yes |  | Summarize loader diagnostics: scanned vs accepted, skipped reasons, missing IDs, optional trace sample. |
| index_dispatch | core | yes |  | Unified dispatcher for instruction index operations. Required: "action". Key params by action: get/getEnhanced(id, bodyOffset?, bodyLimit?), search(q/searchString/keywords/fields, includeCategories, caseSensitive, limit, mode, includeBody?), query(text,categoriesAny,limit,offset), list(category, limit?, offset?, includeBody?), diff(clientHash), export(ids,metaOnly), patch(id, op:"splice"\|"append"\|"prepend"\|"replace", text?/find?/replaceWith?, bodyOffset?, bodyLength?, expectedSourceHash?, dryRun?), remove(id or ids, mode:"archive"\|"purge"), archive(ids, reason), restore(ids, restoreMode), listArchived/getArchived/purgeArchive. Use patch to edit an instruction body in place instead of resending the whole body via add+overwrite. list/search return body-light items by default (bodyPreview+bodyLength); pass includeBody:true for full bodies or use get (supports bodyOffset/bodyLimit pagination). list/search default to INDEX_SERVER_DEFAULT_PAGE_SIZE results (default 50) when limit is omitted; pass limit:0 on list to return all. Read actions accept includeArchived/onlyArchived flags (mutually exclusive). Use action="capabilities" to discover all supported actions. |
| index_enrich | admin |  | yes | Persist normalization of placeholder governance fields to disk. |
| index_getArchived | admin | yes |  | Read a single archived entry by id. Surfaced via index_dispatch action:"getArchived". Returns null when not present. |
| index_governanceHash | extended | yes |  | Return governance projection &amp; deterministic governance hash. |
| index_governanceUpdate | extended |  | yes | Patch governance fields (owner/status/review dates/riskScore/priority/priorityTier/requirement + optional version bump). |
| index_groom | admin |  | yes | Groom index: normalize, repair hashes, merge duplicates, ARCHIVE deprecated (was: remove), remap categories, apply usage signal feedback (outdated/not-relevant/helpful/applied) to instruction priority and requirement. Spec 006 Phase D: retirement paths now archive instead of permanently delete; pass mode.purgeArchive=true (mutually exclusive with retirement flags) to permanently purge archived entries. |
| index_health | admin | yes |  | Compare live index to canonical snapshot for drift. |
| index_import | extended |  | yes | Import instruction entries from: inline array (entries), stringified JSON array, file path to JSON array (entries as string), or directory of .json files (source). |
| index_inspect | admin | yes |  | Return raw instruction entry by ID for debugging (full JSON). |
| index_listArchived | admin | yes |  | List archived entries with optional filters (category, contentType, reason, source, archivedBy, restoreEligible). Set includeContent:true to include bodies. Surfaced via index_dispatch action:"listArchived". |
| index_normalize | admin |  | yes | Normalize instruction JSON files (hash repair, version hydrate, timestamps) with optional dryRun. |
| index_patch | extended |  | yes | Patch an instruction body in place (splice/append/prepend/replace) or update metadata fields (title/semanticSummary/categories/primaryCategory/contentType) via op:metadata without touching the body; supports an expectedSourceHash precondition for lost-update protection. |
| index_purgeArchive | admin |  | yes | Permanently delete archived entries. IRREVERSIBLE. Subject to bootstrap mutation gating, INDEX_SERVER_MAX_BULK_DELETE bulk limit, and auto-backup. Surfaced via index_dispatch action:"purgeArchive". |
| index_reload | extended |  | yes | Force reload of instruction index from disk. |
| index_remove | extended |  | yes | Delete one or more instruction entries by id. Bulk deletes exceeding INDEX_SERVER_MAX_BULK_DELETE (default 5) require force=true and auto-create a backup first. Use dryRun=true to preview. NOTE: spec 006-archive-lifecycle introduces a new mode parameter ("archive" \| "purge"). Today the omitted-mode default remains destructive ("purge") for backwards compatibility, but the response includes defaultBehaviorChangeWarning — pass mode:"archive" to opt into the upcoming default (move to archive store, restorable) or mode:"purge" (or purge:true alias) to keep destructive behavior. The default WILL change to "archive" in a future release. |
| index_repair | admin |  | yes | Repair out-of-sync sourceHash fields (noop if none drifted). |
| index_restore | admin |  | yes | Restore archived entries back to the active store. restoreMode:"reject" (default) fails on id collision; restoreMode:"overwrite" replaces the active entry. Entries marked restoreEligible:false cannot be restored. Surfaced via index_dispatch action:"restore". |
| index_schema | extended | yes |  | Return instruction JSON schema, examples, validation rules, and promotion workflow guidance for self-documentation. |
| index_search | core | yes |  | 🔍 PRIMARY: Search instructions by keywords, searchString phrase input, and/or structural fields — returns instruction IDs for targeted retrieval. Supports mode: "keyword" (substring match), "regex" (patterns like "deploy\|release"), or "semantic" (embedding similarity). Default mode is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Omit the mode parameter to let the server choose the best default. Use this FIRST to discover relevant instructions, then use index_dispatch get for details. |
| integrity_manifest | admin | yes |  | Verify integrity of index manifest entries against stored sourceHash values. |
| integrity_verify | extended | yes |  | Verify each instruction body hash against stored sourceHash. |
| manifest_refresh | admin |  | yes | Rewrite manifest from current index state. |
| manifest_repair | admin |  | yes | Repair manifest by reconciling drift with index. |
| manifest_status | admin | yes |  | Report index manifest presence and drift summary. |
| messaging_ack | extended |  | yes | Acknowledge (mark as read) one or more messages by ID. |
| messaging_get | extended | yes |  | Get a single message by ID with full details. |
| messaging_list_channels | extended | yes |  | List all active messaging channels with message counts and latest timestamps. |
| messaging_manage | extended |  | yes | Dispatcher consolidating all 10 messaging_&lt;action&gt; tools into a single MCP surface. Pick the underlying operation with action= (send/read/list_channels/ack/stats/get/update/purge/reply/thread). Mirrors the individual tools 1:1; the standalone messaging_&lt;action&gt; tools remain available but messaging_manage is the recommended entry-point (#373). |
| messaging_purge | extended |  | yes | Delete messages: all, by channel, or by specific IDs. |
| messaging_read | extended | yes |  | Read messages from a channel with visibility filtering. Supports unread-only, limit, mark-as-read, tag filtering, and sender filtering. |
| messaging_reply | extended |  | yes | Reply to a message with auto-populated channel and parentId. Supports reply-all (all original recipients) or reply-to-sender. |
| messaging_send | extended |  | yes | Send a message to a channel with recipient targeting. Supports broadcast (*), directed, priority, TTL, threading, and structured payloads. |
| messaging_stats | extended | yes |  | Get messaging statistics for a reader: total, unread, channel count. |
| messaging_thread | extended | yes |  | Retrieve a full message thread by root parentId. Returns parent + all nested replies sorted chronologically. |
| messaging_update | extended |  | yes | Update mutable fields of a message (body, recipients, payload, persistent flag). |
| meta_activation_guide | admin | yes |  | Comprehensive guide for activating Index Server tools in VSCode. Explains why settings.json alone is insufficient and provides activation function reference for all tool categories. |
| meta_check_activation | admin | yes |  | Check activation requirements for a specific tool. Returns the VSCode activation function needed and step-by-step instructions. |
| meta_tools | admin | yes |  | Enumerate available tools &amp; their metadata. |
| metrics_snapshot | extended | yes |  | Performance metrics summary for handled methods. |
| promote_from_repo | extended |  | yes | Scan a local Git repository and promote its knowledge content (constitutions, docs, instructions, specs) into the instruction index. Reads .specify/config/promotion-map.json and instructions/*.json from the target repo. |
| prompt_review | core | yes |  | Static analysis of a prompt returning issues &amp; summary. |
| trace_dump | admin | yes |  | Write the in-memory trace ring buffer to a file and return a summary (records count, bytes, env). Requires tracing to be enabled. |
| usage_flush | admin |  | yes | Reset usage counters for a specific instruction (by id) or for entries with lastUsedAt before a given date. |
| usage_hotset | extended | yes |  | Return the most-used instruction entries (hot set). |
| usage_track | core | yes |  | Track instruction usage with optional qualitative signal. Params: id (required), action (retrieved\|applied\|cited), signal (helpful\|not-relevant\|outdated\|applied), comment (short text, max 256 chars). |

## Schemas
### bootstrap
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true,
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "request",
        "confirm",
        "status"
      ],
      "description": "Bootstrap action to perform."
    },
    "rationale": {
      "type": "string",
      "description": "Rationale for bootstrap request."
    },
    "token": {
      "type": "string",
      "description": "Token for confirm action."
    }
  }
}
```

### bootstrap_confirmFinalize
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "token"
  ],
  "properties": {
    "token": {
      "type": "string"
    }
  }
}
```

### bootstrap_request
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "rationale": {
      "type": "string"
    }
  }
}
```

### bootstrap_status
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### dashboard_config
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### diagnostics_block
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ms"
  ],
  "properties": {
    "ms": {
      "type": "number",
      "minimum": 0,
      "maximum": 1000
    }
  }
}
```

### diagnostics_handshake
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### diagnostics_memoryPressure
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "mb": {
      "type": "number",
      "minimum": 1,
      "maximum": 64
    }
  }
}
```

### diagnostics_microtaskFlood
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "count": {
      "type": "number",
      "minimum": 0,
      "maximum": 25000
    }
  }
}
```

### feature_status
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {}
}
```

### feedback_manage
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "submit",
        "list",
        "get",
        "update",
        "delete",
        "stats"
      ],
      "description": "Feedback management action to perform."
    },
    "id": {
      "type": "string",
      "description": "Feedback entry id for get, update, and delete actions."
    },
    "type": {
      "type": "string",
      "enum": [
        "issue",
        "status",
        "security",
        "feature-request",
        "bug-report",
        "performance",
        "usability",
        "other"
      ]
    },
    "severity": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "new",
        "acknowledged",
        "in-progress",
        "resolved",
        "closed"
      ]
    },
    "title": {
      "type": "string",
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 10000
    },
    "context": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "clientInfo": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "version": {
              "type": "string"
            }
          }
        },
        "serverVersion": {
          "type": "string"
        },
        "environment": {
          "type": "object",
          "additionalProperties": true
        },
        "sessionId": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "requestId": {
          "type": "string"
        }
      }
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "tags": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "string"
      }
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 200,
      "description": "Maximum entries to return for list action."
    },
    "offset": {
      "type": "number",
      "minimum": 0,
      "description": "Pagination offset for list action."
    },
    "since": {
      "type": "string",
      "description": "ISO date filter for list and stats actions."
    }
  }
}
```

### feedback_submit
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "type",
    "severity",
    "title",
    "description"
  ],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "issue",
        "status",
        "security",
        "feature-request",
        "bug-report",
        "performance",
        "usability",
        "other"
      ]
    },
    "severity": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "title": {
      "type": "string",
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 10000
    },
    "context": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "clientInfo": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "version": {
              "type": "string"
            }
          }
        },
        "serverVersion": {
          "type": "string"
        },
        "environment": {
          "type": "object",
          "additionalProperties": true
        },
        "sessionId": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "requestId": {
          "type": "string"
        }
      }
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    },
    "tags": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "string"
      }
    }
  }
}
```

### gates_evaluate
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "notConfigured"
      ],
      "properties": {
        "notConfigured": {
          "const": true
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "generatedAt",
        "results",
        "summary"
      ],
      "additionalProperties": false,
      "properties": {
        "generatedAt": {
          "type": "string"
        },
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "passed",
              "count",
              "op",
              "value",
              "severity"
            ],
            "additionalProperties": true,
            "properties": {
              "id": {
                "type": "string"
              },
              "passed": {
                "type": "boolean"
              },
              "count": {
                "type": "number"
              },
              "op": {
                "type": "string"
              },
              "value": {
                "type": "number"
              },
              "severity": {
                "type": "string"
              },
              "description": {
                "type": "string"
              }
            }
          }
        },
        "summary": {
          "type": "object",
          "required": [
            "errors",
            "warnings",
            "total"
          ],
          "properties": {
            "errors": {
              "type": "number"
            },
            "warnings": {
              "type": "number"
            },
            "total": {
              "type": "number"
            }
          },
          "additionalProperties": false
        }
      }
    }
  ]
}
```

### graph_export
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "includeEdgeTypes": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "primary",
          "category",
          "belongs",
          "link"
        ]
      },
      "maxItems": 4
    },
    "maxEdges": {
      "type": "number",
      "minimum": 0
    },
    "format": {
      "type": "string",
      "enum": [
        "json",
        "dot",
        "mermaid"
      ]
    },
    "enrich": {
      "type": "boolean"
    },
    "includeCategoryNodes": {
      "type": "boolean"
    },
    "includeUsage": {
      "type": "boolean"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "meta",
        "nodes",
        "edges"
      ],
      "additionalProperties": true,
      "properties": {
        "meta": {
          "type": "object",
          "required": [
            "graphSchemaVersion",
            "nodeCount",
            "edgeCount"
          ],
          "additionalProperties": true,
          "properties": {
            "graphSchemaVersion": {
              "const": 1
            },
            "nodeCount": {
              "type": "number"
            },
            "edgeCount": {
              "type": "number"
            }
          }
        },
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id"
            ],
            "additionalProperties": true,
            "properties": {
              "id": {
                "type": "string"
              }
            }
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "from",
              "to",
              "type"
            ],
            "additionalProperties": true,
            "properties": {
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "type": {
                "enum": [
                  "primary",
                  "category"
                ]
              }
            }
          }
        }
      }
    },
    {
      "type": "object",
      "required": [
        "meta",
        "nodes",
        "edges"
      ],
      "additionalProperties": true,
      "properties": {
        "meta": {
          "type": "object",
          "required": [
            "graphSchemaVersion",
            "nodeCount",
            "edgeCount"
          ],
          "additionalProperties": true,
          "properties": {
            "graphSchemaVersion": {
              "const": 2
            },
            "nodeCount": {
              "type": "number"
            },
            "edgeCount": {
              "type": "number"
            }
          }
        },
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id"
            ],
            "additionalProperties": true,
            "properties": {
              "id": {
                "type": "string"
              },
              "nodeType": {
                "enum": [
                  "instruction",
                  "category"
                ]
              },
              "categories": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "primaryCategory": {
                "type": "string"
              },
              "usageCount": {
                "type": "number"
              },
              "retrievedCount": {
                "type": "number"
              },
              "appliedCount": {
                "type": "number"
              }
            }
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "from",
              "to",
              "type"
            ],
            "additionalProperties": true,
            "properties": {
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "type": {
                "enum": [
                  "primary",
                  "category",
                  "belongs"
                ]
              }
            }
          }
        },
        "mermaid": {
          "type": "string"
        },
        "dot": {
          "type": "string"
        }
      }
    }
  ]
}
```

### health_check
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "status",
    "timestamp",
    "version"
  ],
  "properties": {
    "status": {
      "const": "ok"
    },
    "timestamp": {
      "type": "string"
    },
    "version": {
      "type": "string"
    }
  }
}
```

### help_overview
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": true,
  "required": [
    "generatedAt",
    "version",
    "sections"
  ],
  "properties": {
    "generatedAt": {
      "type": "string"
    },
    "version": {
      "type": "string"
    },
    "summary": {
      "type": "string"
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "content"
        ],
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "content": {
            "type": "string"
          },
          "bullets": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "nextActions": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "lifecycleModel": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "tiers": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "tier",
              "purpose"
            ],
            "additionalProperties": true,
            "properties": {
              "tier": {
                "type": "string"
              },
              "purpose": {
                "type": "string"
              }
            }
          }
        },
        "promotionChecklist": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "toolDiscovery": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "primary": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "diagnostics": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

### index_add
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "entry"
  ],
  "properties": {
    "entry": {
      "description": "Canonical on-disk instruction record (author + system managed governance metadata).",
      "type": "object",
      "definitions": {
        "changeLogEntry": {
          "type": "object",
          "required": [
            "version",
            "changedAt",
            "summary"
          ],
          "additionalProperties": false,
          "properties": {
            "version": {
              "type": "string",
              "pattern": "^\\d+\\.\\d+\\.\\d+$",
              "description": "Semantic version after this change"
            },
            "changedAt": {
              "type": "string",
              "format": "date-time",
              "description": "Timestamp the change was recorded (ISO 8601)"
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "description": "Human readable summary of change"
            }
          }
        },
        "extensionValue": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "number"
            },
            {
              "type": "boolean"
            },
            {
              "type": "array",
              "items": {
                "$ref": "#/definitions/extensionValue"
              }
            },
            {
              "type": "object",
              "additionalProperties": {
                "$ref": "#/definitions/extensionValue"
              }
            }
          ]
        }
      },
      "required": [
        "id",
        "body"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
          "maxLength": 120,
          "description": "Stable identifier (file name without .json) lower-case, no leading/trailing hyphen/underscore"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "description": "Short display title"
        },
        "body": {
          "type": "string",
          "maxLength": 50000,
          "description": "Instruction body. Current write limit: 50000 characters via INDEX_SERVER_BODY_WARN_LENGTH. Split oversized content into cross-linked instructions."
        },
        "rationale": {
          "type": "string",
          "description": "Optional rationale / context for the instruction"
        },
        "priority": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "description": "Relative ordering: lower = higher importance"
        },
        "audience": {
          "enum": [
            "individual",
            "group",
            "all"
          ],
          "description": "Intended audience scope"
        },
        "requirement": {
          "enum": [
            "mandatory",
            "critical",
            "recommended",
            "optional",
            "deprecated"
          ],
          "description": "Lifecycle requirement status"
        },
        "categories": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
          },
          "uniqueItems": true,
          "minItems": 0,
          "maxItems": 25,
          "description": "Normalized lower-case tags (max 25, each <=49 chars). Empty array permitted for backward compatibility; runtime may auto-fill 'uncategorized'."
        },
        "primaryCategory": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
          "description": "Primary/default category (must be a member of categories when present)"
        },
        "contentType": {
          "enum": [
            "agent",
            "skill",
            "instruction",
            "prompt",
            "workflow",
            "knowledge",
            "template",
            "integration"
          ],
          "default": "instruction",
          "description": "Content type classification: agent (AI agent definitions and personas), skill (packaged agent capabilities or callable skills), instruction (actionable guidance and operating rules), prompt (prompt templates or prompt engineering assets), workflow (multi-step processes or runbooks), knowledge (reference material, examples, concepts, and documentation), template (reusable scaffolds or structured content templates), integration (external system, MCP, API, or tool integration guidance)."
        },
        "deprecatedBy": {
          "type": "string",
          "description": "ID of instruction that supersedes this one"
        },
        "riskScore": {
          "type": "number",
          "description": "Optional numeric risk indicator (higher = riskier)"
        },
        "reviewIntervalDays": {
          "type": "integer",
          "minimum": 1,
          "maximum": 365,
          "description": "Governance review interval in days"
        },
        "workspaceId": {
          "type": "string",
          "description": "Scoped workspace identifier (if specific)"
        },
        "userId": {
          "type": "string",
          "description": "Scoped user identifier (if specific)"
        },
        "teamIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true,
          "description": "Scoped team identifiers (if any)"
        },
        "version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$",
          "description": "Semantic version of the instruction"
        },
        "status": {
          "enum": [
            "draft",
            "review",
            "approved",
            "deprecated"
          ],
          "description": "Governance workflow status"
        },
        "owner": {
          "type": "string",
          "minLength": 1,
          "description": "Assigned owning entity (team / user / group)"
        },
        "priorityTier": {
          "enum": [
            "P1",
            "P2",
            "P3",
            "P4"
          ],
          "description": "Tier bucket derived from priority or governance policy"
        },
        "classification": {
          "enum": [
            "public",
            "internal",
            "restricted"
          ],
          "description": "Information classification level"
        },
        "lastReviewedAt": {
          "type": "string",
          "format": "date-time",
          "description": "Timestamp of last governance review"
        },
        "nextReviewDue": {
          "type": "string",
          "format": "date-time",
          "description": "Scheduled next review timestamp"
        },
        "changeLog": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/changeLogEntry"
          },
          "minItems": 1,
          "description": "Chronological list of notable changes"
        },
        "supersedes": {
          "type": "string",
          "description": "ID of instruction this one replaces"
        },
        "restoreEligible": {
          "type": "boolean",
          "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
        },
        "semanticSummary": {
          "type": "string",
          "maxLength": 600,
          "description": "Cached short natural-language summary of body"
        },
        "sourceWorkspace": {
          "type": "string",
          "maxLength": 200,
          "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
        },
        "createdByAgent": {
          "type": "string",
          "maxLength": 200,
          "description": "Identifier of the MCP agent or client that created or promoted this entry"
        },
        "links": {
          "type": "array",
          "maxItems": 25,
          "items": {
            "type": "object",
            "required": [
              "target"
            ],
            "additionalProperties": false,
            "properties": {
              "target": {
                "type": "string",
                "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                "maxLength": 120,
                "description": "Target instruction ID"
              },
              "rel": {
                "type": "string",
                "enum": [
                  "related",
                  "prerequisite",
                  "sequel",
                  "part-of",
                  "see-also"
                ],
                "default": "related",
                "description": "Relationship type"
              },
              "label": {
                "type": "string",
                "maxLength": 120,
                "description": "Human-readable annotation"
              }
            }
          },
          "description": "Structured cross-references to other instruction entries"
        },
        "extensions": {
          "type": "object",
          "description": "Future-proof vendor / experimental fields",
          "additionalProperties": {
            "$ref": "#/definitions/extensionValue"
          }
        }
      },
      "additionalProperties": false,
      "$id": "tool-input/index_add/entry/1"
    },
    "overwrite": {
      "type": "boolean"
    },
    "lax": {
      "type": "boolean"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "success": {
          "const": false
        },
        "message": {
          "type": "string"
        },
        "validationErrors": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "hints": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "schemaRef": {
          "type": "string"
        },
        "inputSchema": {
          "type": "object"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "id",
        "hash",
        "skipped",
        "created",
        "overwritten"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        },
        "skipped": {
          "type": "boolean"
        },
        "created": {
          "type": "boolean"
        },
        "overwritten": {
          "type": "boolean"
        }
      }
    }
  ]
}
```

### index_archive
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ids"
  ],
  "properties": {
    "ids": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      },
      "description": "Active instruction IDs to archive."
    },
    "reason": {
      "type": "string",
      "enum": [
        "deprecated",
        "superseded",
        "duplicate-merge",
        "manual",
        "legacy-scope"
      ],
      "description": "Archive reason (closed taxonomy from REQ-3)."
    },
    "archivedBy": {
      "type": "string",
      "description": "Identity of the agent/operator performing the archive (optional)."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview what would be archived without writing."
    }
  }
}
```

### index_debug
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### index_diagnostics
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "includeTrace": {
      "type": "boolean"
    }
  }
}
```

### index_dispatch
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true,
  "required": [
    "action"
  ],
  "not": {
    "required": [
      "includeArchived",
      "onlyArchived"
    ]
  },
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "list",
        "listScoped",
        "get",
        "getEnhanced",
        "search",
        "query",
        "categories",
        "diff",
        "export",
        "add",
        "import",
        "patch",
        "remove",
        "reload",
        "groom",
        "repair",
        "enrich",
        "governanceHash",
        "governanceUpdate",
        "health",
        "inspect",
        "dir",
        "capabilities",
        "batch",
        "manifestStatus",
        "manifestRefresh",
        "manifestRepair",
        "archive",
        "restore",
        "listArchived",
        "getArchived",
        "purgeArchive"
      ],
      "description": "Action to perform on the instruction index. Use \"capabilities\" to list all supported actions."
    },
    "id": {
      "type": "string",
      "description": "Instruction ID for get, getEnhanced, remove, inspect, governanceUpdate actions."
    },
    "q": {
      "type": "string",
      "description": "Single-string query for search action. The dispatcher searches the full q phrase first and, if needed, retries with split-word keywords."
    },
    "keywords": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      ],
      "description": "Keywords for search action: an array of tokens, OR a single string (one or many words). A string is searched as-is first, then split on spaces if no match."
    },
    "searchString": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Ergonomic phrase input for search action. Mutually exclusive with keywords."
    },
    "fields": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "id": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
              "maxLength": 120,
              "description": "Stable identifier (file name without .json) lower-case, no leading/trailing hyphen/underscore"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                "maxLength": 120,
                "description": "Stable identifier (file name without .json) lower-case, no leading/trailing hyphen/underscore"
              }
            }
          ]
        },
        "title": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "description": "Short display title"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Short display title"
              }
            }
          ]
        },
        "body": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000000,
              "description": "Primary instruction content (markdown / plain text)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000000,
                "description": "Primary instruction content (markdown / plain text)"
              }
            }
          ]
        },
        "rationale": {
          "oneOf": [
            {
              "type": "string",
              "description": "Optional rationale / context for the instruction"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Optional rationale / context for the instruction"
              }
            }
          ]
        },
        "priority": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "description": "Relative ordering: lower = higher importance"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Relative ordering: lower = higher importance"
              }
            }
          ]
        },
        "audience": {
          "oneOf": [
            {
              "enum": [
                "individual",
                "group",
                "all"
              ],
              "description": "Intended audience scope"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "individual",
                  "group",
                  "all"
                ],
                "description": "Intended audience scope"
              }
            }
          ]
        },
        "requirement": {
          "oneOf": [
            {
              "enum": [
                "mandatory",
                "critical",
                "recommended",
                "optional",
                "deprecated"
              ],
              "description": "Lifecycle requirement status"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "mandatory",
                  "critical",
                  "recommended",
                  "optional",
                  "deprecated"
                ],
                "description": "Lifecycle requirement status"
              }
            }
          ]
        },
        "categories": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
              }
            }
          ]
        },
        "primaryCategory": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
              "description": "Primary/default category (must be a member of categories when present)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
                "description": "Primary/default category (must be a member of categories when present)"
              }
            }
          ]
        },
        "contentType": {
          "oneOf": [
            {
              "enum": [
                "agent",
                "skill",
                "instruction",
                "prompt",
                "workflow",
                "knowledge",
                "template",
                "integration"
              ],
              "default": "instruction",
              "description": "Content type classification: agent (AI agent definitions and personas), skill (packaged agent capabilities or callable skills), instruction (actionable guidance and operating rules), prompt (prompt templates or prompt engineering assets), workflow (multi-step processes or runbooks), knowledge (reference material, examples, concepts, and documentation), template (reusable scaffolds or structured content templates), integration (external system, MCP, API, or tool integration guidance)."
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "agent",
                  "skill",
                  "instruction",
                  "prompt",
                  "workflow",
                  "knowledge",
                  "template",
                  "integration"
                ],
                "default": "instruction",
                "description": "Content type classification: agent (AI agent definitions and personas), skill (packaged agent capabilities or callable skills), instruction (actionable guidance and operating rules), prompt (prompt templates or prompt engineering assets), workflow (multi-step processes or runbooks), knowledge (reference material, examples, concepts, and documentation), template (reusable scaffolds or structured content templates), integration (external system, MCP, API, or tool integration guidance)."
              }
            }
          ]
        },
        "schemaVersion": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "6",
                "7",
                "8",
                "9"
              ],
              "x-fieldClass": "server-managed",
              "description": "Internal schema version for migration"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "enum": [
                  "6",
                  "7",
                  "8",
                  "9"
                ],
                "x-fieldClass": "server-managed",
                "description": "Internal schema version for migration"
              }
            }
          ]
        },
        "sourceHash": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$",
              "x-fieldClass": "server-managed",
              "description": "SHA256 hash of body for drift detection"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$",
                "x-fieldClass": "server-managed",
                "description": "SHA256 hash of body for drift detection"
              }
            }
          ]
        },
        "deprecatedBy": {
          "oneOf": [
            {
              "type": "string",
              "description": "ID of instruction that supersedes this one"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "ID of instruction that supersedes this one"
              }
            }
          ]
        },
        "createdAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Creation timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Creation timestamp (ISO 8601)"
              }
            }
          ]
        },
        "updatedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last mutation timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last mutation timestamp (ISO 8601)"
              }
            }
          ]
        },
        "usageCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "DEPRECATED (issue #418): derived total usage count = retrievedCount + appliedCount"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "DEPRECATED (issue #418): derived total usage count = retrievedCount + appliedCount"
              }
            }
          ]
        },
        "retrievedCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "Number of retrieval events (search/get/query/export/list)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of retrieval events (search/get/query/export/list)"
              }
            }
          ]
        },
        "appliedCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "Number of explicit applied/cited events"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of explicit applied/cited events"
              }
            }
          ]
        },
        "firstSeenTs": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp when usage was first observed (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp when usage was first observed (ISO 8601)"
              }
            }
          ]
        },
        "lastUsedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last usage timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last usage timestamp (ISO 8601)"
              }
            }
          ]
        },
        "lastRetrievedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last retrieval timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last retrieval timestamp (ISO 8601)"
              }
            }
          ]
        },
        "lastAppliedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last applied timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last applied timestamp (ISO 8601)"
              }
            }
          ]
        },
        "riskScore": {
          "oneOf": [
            {
              "type": "number",
              "description": "Optional numeric risk indicator (higher = riskier)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "number",
                "description": "Optional numeric risk indicator (higher = riskier)"
              }
            }
          ]
        },
        "reviewIntervalDays": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 365,
              "description": "Governance review interval in days"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 1,
                "maximum": 365,
                "description": "Governance review interval in days"
              }
            }
          ]
        },
        "workspaceId": {
          "oneOf": [
            {
              "type": "string",
              "description": "Scoped workspace identifier (if specific)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Scoped workspace identifier (if specific)"
              }
            }
          ]
        },
        "userId": {
          "oneOf": [
            {
              "type": "string",
              "description": "Scoped user identifier (if specific)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Scoped user identifier (if specific)"
              }
            }
          ]
        },
        "teamIds": {
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "version": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^\\d+\\.\\d+\\.\\d+$",
              "description": "Semantic version of the instruction"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^\\d+\\.\\d+\\.\\d+$",
                "description": "Semantic version of the instruction"
              }
            }
          ]
        },
        "status": {
          "oneOf": [
            {
              "enum": [
                "draft",
                "review",
                "approved",
                "deprecated"
              ],
              "description": "Governance workflow status"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "draft",
                  "review",
                  "approved",
                  "deprecated"
                ],
                "description": "Governance workflow status"
              }
            }
          ]
        },
        "owner": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "description": "Assigned owning entity (team / user / group)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "description": "Assigned owning entity (team / user / group)"
              }
            }
          ]
        },
        "priorityTier": {
          "oneOf": [
            {
              "enum": [
                "P1",
                "P2",
                "P3",
                "P4"
              ],
              "description": "Tier bucket derived from priority or governance policy"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "P1",
                  "P2",
                  "P3",
                  "P4"
                ],
                "description": "Tier bucket derived from priority or governance policy"
              }
            }
          ]
        },
        "classification": {
          "oneOf": [
            {
              "enum": [
                "public",
                "internal",
                "restricted"
              ],
              "description": "Information classification level"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "public",
                  "internal",
                  "restricted"
                ],
                "description": "Information classification level"
              }
            }
          ]
        },
        "lastReviewedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "description": "Timestamp of last governance review"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "description": "Timestamp of last governance review"
              }
            }
          ]
        },
        "nextReviewDue": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "description": "Scheduled next review timestamp"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "description": "Scheduled next review timestamp"
              }
            }
          ]
        },
        "changeLog": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": true
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": true
              }
            }
          ]
        },
        "supersedes": {
          "oneOf": [
            {
              "type": "string",
              "description": "ID of instruction this one replaces"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "ID of instruction this one replaces"
              }
            }
          ]
        },
        "archivedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp when archived (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp when archived (ISO 8601)"
              }
            }
          ]
        },
        "archivedBy": {
          "oneOf": [
            {
              "type": "string",
              "x-fieldClass": "server-managed",
              "description": "Identifier of the agent / operator that archived this entry (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "x-fieldClass": "server-managed",
                "description": "Identifier of the agent / operator that archived this entry (schema v7)"
              }
            }
          ]
        },
        "archiveReason": {
          "oneOf": [
            {
              "enum": [
                "deprecated",
                "superseded",
                "duplicate-merge",
                "manual",
                "legacy-scope"
              ],
              "x-fieldClass": "server-managed",
              "description": "Closed enum capturing why the entry was archived (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "deprecated",
                  "superseded",
                  "duplicate-merge",
                  "manual",
                  "legacy-scope"
                ],
                "x-fieldClass": "server-managed",
                "description": "Closed enum capturing why the entry was archived (schema v7)"
              }
            }
          ]
        },
        "archiveSource": {
          "oneOf": [
            {
              "enum": [
                "groom",
                "remove",
                "archive",
                "import-migration"
              ],
              "x-fieldClass": "server-managed",
              "description": "Which lifecycle pathway produced the archive event (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "groom",
                  "remove",
                  "archive",
                  "import-migration"
                ],
                "x-fieldClass": "server-managed",
                "description": "Which lifecycle pathway produced the archive event (schema v7)"
              }
            }
          ]
        },
        "restoreEligible": {
          "oneOf": [
            {
              "type": "boolean",
              "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "boolean",
                "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
              }
            }
          ]
        },
        "semanticSummary": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 600,
              "description": "Cached short natural-language summary of body"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 600,
                "description": "Cached short natural-language summary of body"
              }
            }
          ]
        },
        "sourceWorkspace": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 200,
              "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 200,
                "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
              }
            }
          ]
        },
        "createdByAgent": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 200,
              "description": "Identifier of the MCP agent or client that created or promoted this entry"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 200,
                "description": "Identifier of the MCP agent or client that created or promoted this entry"
              }
            }
          ]
        },
        "links": {
          "oneOf": [
            {
              "type": "object",
              "required": [
                "target"
              ],
              "additionalProperties": false,
              "properties": {
                "target": {
                  "type": "string",
                  "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                  "maxLength": 120,
                  "description": "Target instruction ID"
                },
                "rel": {
                  "type": "string",
                  "enum": [
                    "related",
                    "prerequisite",
                    "sequel",
                    "part-of",
                    "see-also"
                  ],
                  "default": "related",
                  "description": "Relationship type"
                },
                "label": {
                  "type": "string",
                  "maxLength": 120,
                  "description": "Human-readable annotation"
                }
              }
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": [
                  "target"
                ],
                "additionalProperties": false,
                "properties": {
                  "target": {
                    "type": "string",
                    "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                    "maxLength": 120,
                    "description": "Target instruction ID"
                  },
                  "rel": {
                    "type": "string",
                    "enum": [
                      "related",
                      "prerequisite",
                      "sequel",
                      "part-of",
                      "see-also"
                    ],
                    "default": "related",
                    "description": "Relationship type"
                  },
                  "label": {
                    "type": "string",
                    "maxLength": 120,
                    "description": "Human-readable annotation"
                  }
                }
              }
            }
          ]
        },
        "signalHistory": {
          "oneOf": [
            {
              "type": "object",
              "required": [
                "signal",
                "ts"
              ],
              "additionalProperties": false,
              "properties": {
                "signal": {
                  "type": "string",
                  "description": "Signal value (e.g. helpful, outdated, applied)"
                },
                "ts": {
                  "type": "string",
                  "format": "date-time",
                  "description": "When the signal arrived (ISO 8601)"
                },
                "comment": {
                  "type": "string",
                  "description": "Optional freeform comment accompanying the signal"
                }
              }
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": [
                  "signal",
                  "ts"
                ],
                "additionalProperties": false,
                "properties": {
                  "signal": {
                    "type": "string",
                    "description": "Signal value (e.g. helpful, outdated, applied)"
                  },
                  "ts": {
                    "type": "string",
                    "format": "date-time",
                    "description": "When the signal arrived (ISO 8601)"
                  },
                  "comment": {
                    "type": "string",
                    "description": "Optional freeform comment accompanying the signal"
                  }
                }
              }
            }
          ]
        },
        "lastSignaledAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp of the most recent signal event (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp of the most recent signal event (ISO 8601)"
              }
            }
          ]
        },
        "extensions": {
          "type": "object",
          "additionalProperties": true
        },
        "categoriesAny": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "categoriesAll": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "categoriesNone": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsAny": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsAll": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsNone": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "idPrefix": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "idRegex": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "priorityMin": {
          "type": "number"
        },
        "priorityMax": {
          "type": "number"
        },
        "usageCountMin": {
          "type": "number"
        },
        "usageCountMax": {
          "type": "number"
        },
        "riskScoreMin": {
          "type": "number"
        },
        "riskScoreMax": {
          "type": "number"
        },
        "reviewIntervalDaysMin": {
          "type": "number"
        },
        "reviewIntervalDaysMax": {
          "type": "number"
        },
        "createdAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "createdBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "updatedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "updatedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "firstSeenAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "firstSeenBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastUsedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastUsedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastReviewedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastReviewedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "nextReviewDueAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "nextReviewDueBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "archivedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "archivedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        }
      },
      "description": "Structural field predicates for search action. Unknown fields are rejected."
    },
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Array of instruction IDs for remove or export actions."
    },
    "category": {
      "type": "string",
      "description": "Filter by category for list action."
    },
    "contentType": {
      "type": "string",
      "enum": [
        "agent",
        "skill",
        "instruction",
        "prompt",
        "workflow",
        "knowledge",
        "template",
        "integration"
      ],
      "description": "Filter by content type for list, search, or query actions, or specify the entry content type for add action."
    },
    "text": {
      "type": "string",
      "description": "Full-text search within query action."
    },
    "includeCategories": {
      "type": "boolean",
      "description": "Search categories in addition to id/title/semanticSummary/body for search action."
    },
    "caseSensitive": {
      "type": "boolean",
      "description": "Enable case-sensitive matching for search action."
    },
    "categoriesAny": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Match instructions having any of these categories (query action)."
    },
    "categoriesAll": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Match instructions having all of these categories (query action)."
    },
    "clientHash": {
      "type": "string",
      "description": "Client-side index hash for diff action (returns changes since)."
    },
    "metaOnly": {
      "type": "boolean",
      "description": "Return metadata only (omit body) for export action."
    },
    "includeBody": {
      "type": "boolean",
      "description": "Include the full body in list/search items. Default false: items are body-light (bodyPreview + bodyLength, full body omitted) to keep responses within MCP client limits. Use the get action for full content."
    },
    "bodyOffset": {
      "type": "number",
      "description": "Start character offset for paginated body retrieval (get action). Supplying bodyOffset or bodyLimit returns a body window plus a bodyPagination envelope; omit both to get the full body."
    },
    "bodyLimit": {
      "type": "number",
      "description": "Maximum number of body characters to return per page (get action). Pairs with bodyOffset for deterministic, surrogate-safe pagination."
    },
    "op": {
      "type": "string",
      "enum": [
        "splice",
        "append",
        "prepend",
        "replace",
        "metadata"
      ],
      "description": "Patch operation (patch action). splice=replace a character window at bodyOffset; append/prepend=concatenate text; replace=literal substring substitution; metadata=update title/semanticSummary/categories/primaryCategory/contentType without touching the body."
    },
    "bodyLength": {
      "type": "number",
      "description": "Number of body characters to remove at bodyOffset (patch action, splice op). Defaults to 0, making the splice a pure insertion."
    },
    "find": {
      "type": "string",
      "description": "Literal substring to find (patch action, replace op). Never interpreted as a regular expression."
    },
    "replaceWith": {
      "type": "string",
      "description": "Replacement text (patch action, replace op). Defaults to empty string."
    },
    "replaceAll": {
      "type": "boolean",
      "description": "Replace every occurrence instead of only the first (patch action, replace op)."
    },
    "expectedSourceHash": {
      "type": "string",
      "description": "Optimistic-concurrency precondition (patch action). When it does not match the stored sourceHash the patch is refused with precondition_failed and nothing is written."
    },
    "summary": {
      "type": "string",
      "description": "Changelog summary recorded when patch is combined with bump."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results to return (list, search, or query action). When omitted, list/search default to INDEX_SERVER_DEFAULT_PAGE_SIZE (default 50). Pass limit:0 on list to return all items."
    },
    "offset": {
      "type": "number",
      "description": "Pagination offset (query action)."
    },
    "entry": {
      "type": "object",
      "description": "Instruction entry object for add action. Alternatively, pass id/body/title as top-level params.",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string",
          "maxLength": 50000,
          "description": "Instruction body for action=\"add\". Current write limit: 50000 characters via INDEX_SERVER_BODY_WARN_LENGTH. Split oversized content into cross-linked instructions."
        }
      }
    },
    "priority": {
      "type": "number"
    },
    "audience": {
      "type": "string",
      "enum": [
        "individual",
        "group",
        "all"
      ]
    },
    "requirement": {
      "type": "string",
      "enum": [
        "mandatory",
        "critical",
        "recommended",
        "optional",
        "deprecated"
      ]
    },
    "categories": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "deprecatedBy": {
      "type": "string"
    },
    "riskScore": {
      "type": "number"
    },
    "version": {
      "type": "string"
    },
    "priorityTier": {
      "type": "string",
      "enum": [
        "P1",
        "P2",
        "P3",
        "P4"
      ]
    },
    "classification": {
      "type": "string",
      "enum": [
        "public",
        "internal",
        "restricted"
      ]
    },
    "links": {
      "type": "array",
      "maxItems": 25,
      "items": {
        "type": "object",
        "properties": {
          "target": {
            "type": "string"
          },
          "rel": {
            "type": "string",
            "enum": [
              "related",
              "prerequisite",
              "sequel",
              "part-of",
              "see-also"
            ]
          },
          "label": {
            "type": "string",
            "maxLength": 120
          }
        },
        "required": [
          "target"
        ]
      },
      "description": "Structured cross-references to other instruction entries (add action)."
    },
    "overwrite": {
      "type": "boolean",
      "description": "Allow overwriting existing instruction (add action)."
    },
    "lax": {
      "type": "boolean",
      "description": "Enable lax mode with default fills for missing optional fields (add action)."
    },
    "entries": {
      "description": "Array of instruction entries for import action, a stringified JSON array of entries, or a file path (string) to a JSON array of entries.",
      "oneOf": [
        {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        },
        {
          "type": "string"
        }
      ]
    },
    "source": {
      "type": "string",
      "description": "Directory path containing .json instruction files to import (import action)."
    },
    "mode": {
      "description": "Import conflict resolution mode (import action) or groom mode object (groom action)."
    },
    "owner": {
      "type": "string",
      "description": "Owner identifier for governanceUpdate action or add action."
    },
    "status": {
      "type": "string",
      "description": "Governance status for governanceUpdate action or add action.",
      "enum": [
        "draft",
        "review",
        "approved",
        "deprecated"
      ]
    },
    "bump": {
      "type": "string",
      "description": "Version bump level for governanceUpdate or patch actions.",
      "enum": [
        "patch",
        "minor",
        "major",
        "none"
      ]
    },
    "lastReviewedAt": {
      "type": "string",
      "description": "Last review date (ISO 8601) for governanceUpdate action."
    },
    "nextReviewDue": {
      "type": "string",
      "description": "Next review due date (ISO 8601) for governanceUpdate action."
    },
    "missingOk": {
      "type": "boolean",
      "description": "Suppress errors for missing IDs (remove action)."
    },
    "force": {
      "type": "boolean",
      "description": "Required for remove action when deleting more than INDEX_SERVER_MAX_BULK_DELETE items. A backup is created automatically."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview what would be deleted without actually removing anything (remove action)."
    },
    "purge": {
      "type": "boolean",
      "description": "Remove action alias for mode:\"purge\". Forces destructive removal (instead of upcoming archive default)."
    },
    "reason": {
      "type": "string",
      "enum": [
        "deprecated",
        "superseded",
        "duplicate-merge",
        "manual",
        "legacy-scope"
      ],
      "description": "Archive reason (archive action)."
    },
    "restoreMode": {
      "type": "string",
      "enum": [
        "reject",
        "overwrite"
      ],
      "description": "Restore collision behavior (restore action). Defaults to \"reject\"."
    },
    "includeArchived": {
      "type": "boolean",
      "description": "Include archived entries in read results (list, query, search, categories, get, export, diff). Mutually exclusive with onlyArchived."
    },
    "onlyArchived": {
      "type": "boolean",
      "description": "Return ONLY archived entries (read actions). Mutually exclusive with includeArchived."
    },
    "includeContent": {
      "type": "boolean",
      "description": "Include full entry bodies in listArchived results (defaults to false)."
    },
    "body": {
      "type": "string",
      "maxLength": 50000,
      "description": "Flat instruction body for action=\"add\". Current write limit: 50000 characters via INDEX_SERVER_BODY_WARN_LENGTH. Split oversized content into cross-linked instructions."
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "supportedActions",
        "mutationEnabled",
        "version"
      ],
      "additionalProperties": true,
      "properties": {
        "version": {
          "type": "string"
        },
        "supportedActions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "mutationEnabled": {
          "type": "boolean"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "results"
      ],
      "additionalProperties": true,
      "properties": {
        "results": {
          "type": "array"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "hash"
      ],
      "additionalProperties": true,
      "properties": {
        "hash": {
          "type": "string"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "error"
      ],
      "additionalProperties": true,
      "properties": {
        "error": {
          "type": "string"
        }
      }
    }
  ]
}
```

### index_enrich
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "rewritten",
    "updated",
    "skipped"
  ],
  "additionalProperties": false,
  "properties": {
    "rewritten": {
      "type": "number"
    },
    "updated": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "skipped": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### index_getArchived
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Archived instruction id."
    }
  }
}
```

### index_governanceHash
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "count",
    "governanceHash",
    "items"
  ],
  "properties": {
    "count": {
      "type": "number"
    },
    "governanceHash": {
      "type": "string"
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "version",
          "owner",
          "priorityTier",
          "nextReviewDue",
          "semanticSummarySha256",
          "changeLogLength"
        ],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "owner": {
            "type": "string"
          },
          "priorityTier": {
            "type": "string"
          },
          "nextReviewDue": {
            "type": "string"
          },
          "semanticSummarySha256": {
            "type": "string"
          },
          "changeLogLength": {
            "type": "number"
          }
        }
      }
    }
  }
}
```

### index_governanceUpdate
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "owner": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "approved",
        "draft",
        "deprecated"
      ]
    },
    "lastReviewedAt": {
      "type": "string"
    },
    "nextReviewDue": {
      "type": "string"
    },
    "riskScore": {
      "type": "number"
    },
    "priority": {
      "type": "number"
    },
    "priorityTier": {
      "type": "string",
      "enum": [
        "P1",
        "P2",
        "P3",
        "P4"
      ]
    },
    "requirement": {
      "type": "string",
      "enum": [
        "mandatory",
        "critical",
        "recommended",
        "optional",
        "deprecated"
      ]
    },
    "categories": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "bump": {
      "type": "string",
      "enum": [
        "patch",
        "minor",
        "major",
        "none"
      ]
    }
  }
}
```

### index_groom
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "mode": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "dryRun": {
          "type": "boolean"
        },
        "removeDeprecated": {
          "type": "boolean"
        },
        "mergeDuplicates": {
          "type": "boolean"
        },
        "purgeLegacyScopes": {
          "type": "boolean"
        },
        "remapCategories": {
          "type": "boolean"
        },
        "purgeArchive": {
          "type": "boolean",
          "description": "Permanently delete archived entries (spec 006 Phase D). Cannot be combined with retirement flags (removeDeprecated/mergeDuplicates/purgeLegacyScopes)."
        }
      }
    },
    "ids": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional subset of archive IDs to purge when mode.purgeArchive=true. Omit to purge all archived entries."
    },
    "force": {
      "type": "boolean",
      "description": "Required for bulk purgeArchive operations exceeding INDEX_SERVER_MAX_BULK_DELETE."
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "previousHash",
    "hash",
    "scanned",
    "repairedHashes",
    "normalizedCategories",
    "deprecatedRemoved",
    "duplicatesMerged",
    "signalApplied",
    "filesRewritten",
    "purgedScopes",
    "dryRun",
    "notes"
  ],
  "properties": {
    "previousHash": {
      "type": "string"
    },
    "hash": {
      "type": "string"
    },
    "scanned": {
      "type": "number"
    },
    "repairedHashes": {
      "type": "number"
    },
    "normalizedCategories": {
      "type": "number"
    },
    "deprecatedRemoved": {
      "type": "number"
    },
    "duplicatesMerged": {
      "type": "number"
    },
    "signalApplied": {
      "type": "number"
    },
    "filesRewritten": {
      "type": "number"
    },
    "purgedScopes": {
      "type": "number"
    },
    "migrated": {
      "type": "number"
    },
    "remappedCategories": {
      "type": "number"
    },
    "dryRun": {
      "type": "boolean"
    },
    "notes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### index_health
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "snapshot",
        "hash",
        "count"
      ],
      "additionalProperties": true,
      "properties": {
        "snapshot": {
          "const": "missing"
        },
        "hash": {
          "type": "string"
        },
        "count": {
          "type": "number"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "snapshot",
        "hash",
        "count",
        "missing",
        "changed",
        "extra",
        "drift"
      ],
      "additionalProperties": true,
      "properties": {
        "snapshot": {
          "const": "present"
        },
        "hash": {
          "type": "string"
        },
        "count": {
          "type": "number"
        },
        "missing": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "changed": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "extra": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "drift": {
          "type": "number"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "snapshot",
        "hash",
        "error"
      ],
      "additionalProperties": true,
      "properties": {
        "snapshot": {
          "const": "error"
        },
        "hash": {
          "type": "string"
        },
        "error": {
          "type": "string"
        }
      }
    }
  ]
}
```

### index_import
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entries": {
      "oneOf": [
        {
          "type": "array",
          "minItems": 1,
          "items": {
            "description": "Canonical on-disk instruction record (author + system managed governance metadata).",
            "type": "object",
            "definitions": {
              "changeLogEntry": {
                "type": "object",
                "required": [
                  "version",
                  "changedAt",
                  "summary"
                ],
                "additionalProperties": false,
                "properties": {
                  "version": {
                    "type": "string",
                    "pattern": "^\\d+\\.\\d+\\.\\d+$",
                    "description": "Semantic version after this change"
                  },
                  "changedAt": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Timestamp the change was recorded (ISO 8601)"
                  },
                  "summary": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Human readable summary of change"
                  }
                }
              },
              "extensionValue": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/definitions/extensionValue"
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/definitions/extensionValue"
                    }
                  }
                ]
              }
            },
            "required": [
              "id",
              "title",
              "body"
            ],
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1
              },
              "title": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Short display title"
              },
              "body": {
                "type": "string",
                "maxLength": 50000,
                "description": "Instruction body. Current write limit: 50000 characters via INDEX_SERVER_BODY_WARN_LENGTH. Split oversized content into cross-linked instructions."
              },
              "rationale": {
                "type": "string",
                "description": "Optional rationale / context for the instruction"
              },
              "priority": {
                "type": "number"
              },
              "audience": {
                "type": "string"
              },
              "requirement": {
                "type": "string"
              },
              "categories": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
                },
                "uniqueItems": true,
                "minItems": 0,
                "maxItems": 25,
                "description": "Normalized lower-case tags (max 25, each <=49 chars). Empty array permitted for backward compatibility; runtime may auto-fill 'uncategorized'."
              },
              "primaryCategory": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
                "description": "Primary/default category (must be a member of categories when present)"
              },
              "contentType": {
                "type": "string"
              },
              "deprecatedBy": {
                "type": "string",
                "description": "ID of instruction that supersedes this one"
              },
              "riskScore": {
                "type": "number",
                "description": "Optional numeric risk indicator (higher = riskier)"
              },
              "reviewIntervalDays": {
                "type": "integer",
                "minimum": 1,
                "maximum": 365,
                "description": "Governance review interval in days"
              },
              "workspaceId": {
                "type": "string",
                "description": "Scoped workspace identifier (if specific)"
              },
              "userId": {
                "type": "string",
                "description": "Scoped user identifier (if specific)"
              },
              "teamIds": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "uniqueItems": true,
                "description": "Scoped team identifiers (if any)"
              },
              "version": {
                "type": "string",
                "pattern": "^\\d+\\.\\d+\\.\\d+$",
                "description": "Semantic version of the instruction"
              },
              "status": {
                "enum": [
                  "draft",
                  "review",
                  "approved",
                  "deprecated"
                ],
                "description": "Governance workflow status"
              },
              "owner": {
                "type": "string",
                "minLength": 1,
                "description": "Assigned owning entity (team / user / group)"
              },
              "priorityTier": {
                "enum": [
                  "P1",
                  "P2",
                  "P3",
                  "P4"
                ],
                "description": "Tier bucket derived from priority or governance policy"
              },
              "classification": {
                "enum": [
                  "public",
                  "internal",
                  "restricted"
                ],
                "description": "Information classification level"
              },
              "lastReviewedAt": {
                "type": "string",
                "format": "date-time",
                "description": "Timestamp of last governance review"
              },
              "nextReviewDue": {
                "type": "string",
                "format": "date-time",
                "description": "Scheduled next review timestamp"
              },
              "changeLog": {
                "type": "array",
                "items": {
                  "$ref": "#/definitions/changeLogEntry"
                },
                "minItems": 1,
                "description": "Chronological list of notable changes"
              },
              "supersedes": {
                "type": "string",
                "description": "ID of instruction this one replaces"
              },
              "restoreEligible": {
                "type": "boolean",
                "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
              },
              "semanticSummary": {
                "type": "string",
                "maxLength": 600,
                "description": "Cached short natural-language summary of body"
              },
              "sourceWorkspace": {
                "type": "string",
                "maxLength": 200,
                "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
              },
              "createdByAgent": {
                "type": "string",
                "maxLength": 200,
                "description": "Identifier of the MCP agent or client that created or promoted this entry"
              },
              "links": {
                "type": "array",
                "maxItems": 25,
                "items": {
                  "type": "object",
                  "required": [
                    "target"
                  ],
                  "additionalProperties": false,
                  "properties": {
                    "target": {
                      "type": "string",
                      "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                      "maxLength": 120,
                      "description": "Target instruction ID"
                    },
                    "rel": {
                      "type": "string",
                      "enum": [
                        "related",
                        "prerequisite",
                        "sequel",
                        "part-of",
                        "see-also"
                      ],
                      "default": "related",
                      "description": "Relationship type"
                    },
                    "label": {
                      "type": "string",
                      "maxLength": 120,
                      "description": "Human-readable annotation"
                    }
                  }
                },
                "description": "Structured cross-references to other instruction entries"
              },
              "extensions": {
                "type": "object",
                "description": "Future-proof vendor / experimental fields",
                "additionalProperties": {
                  "$ref": "#/definitions/extensionValue"
                }
              }
            },
            "additionalProperties": false,
            "$id": "tool-input/index_import/entry/2"
          }
        },
        {
          "type": "string",
          "description": "Stringified JSON array of instruction entries, or a file path to a JSON array of instruction entries"
        }
      ]
    },
    "source": {
      "type": "string",
      "description": "Directory path containing .json instruction files to import"
    },
    "mode": {
      "enum": [
        "skip",
        "overwrite"
      ]
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "hash",
        "imported",
        "skipped",
        "overwritten",
        "errors",
        "total",
        "verified",
        "verifiedCount",
        "verificationErrorCount",
        "stripped",
        "migrationCount",
        "migrationDetails"
      ],
      "additionalProperties": false,
      "properties": {
        "hash": {
          "type": "string"
        },
        "imported": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "overwritten": {
          "type": "number"
        },
        "total": {
          "type": "number"
        },
        "errors": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "error"
            ],
            "properties": {
              "id": {
                "type": "string"
              },
              "error": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "verified": {
          "type": "boolean",
          "description": "True when every written entry was readable in the post-write reload (verifiedCount === written count, verificationErrorCount === 0)."
        },
        "verifiedCount": {
          "type": "number",
          "description": "Number of newly written/overwritten entries successfully read back after reload."
        },
        "verificationErrorCount": {
          "type": "number",
          "description": "Number of newly written entries missing from the index after the post-write reload."
        },
        "stripped": {
          "type": "object",
          "description": "Per-key counts of server-managed fields (e.g. createdAt, updatedAt, sourceHash, schemaVersion) partitioned out of caller payloads via splitEntry. Empty object when no server-managed fields were supplied.",
          "additionalProperties": {
            "type": "number"
          }
        },
        "migrationCount": {
          "type": "number",
          "description": "Number of import entries migrated before canonical validation."
        },
        "migrationDetails": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "originalId": {
                "type": "string"
              },
              "id": {
                "type": "string"
              },
              "schemaVersion": {
                "type": "string"
              },
              "changes": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

### index_inspect
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
    }
  }
}
```

### index_listArchived
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "category": {
      "type": "string",
      "description": "Filter by category."
    },
    "contentType": {
      "type": "string",
      "enum": [
        "agent",
        "skill",
        "instruction",
        "prompt",
        "workflow",
        "knowledge",
        "template",
        "integration"
      ],
      "description": "Filter by content type."
    },
    "reason": {
      "type": "string",
      "enum": [
        "deprecated",
        "superseded",
        "duplicate-merge",
        "manual",
        "legacy-scope"
      ],
      "description": "Filter by archive reason."
    },
    "source": {
      "type": "string",
      "enum": [
        "groom",
        "remove",
        "archive",
        "import-migration"
      ],
      "description": "Filter by archive source."
    },
    "archivedBy": {
      "type": "string",
      "description": "Filter by archivedBy identity."
    },
    "restoreEligible": {
      "type": "boolean",
      "description": "Filter by restore eligibility flag."
    },
    "includeContent": {
      "type": "boolean",
      "description": "Include full body in each entry (default: false)."
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 1000
    },
    "offset": {
      "type": "number",
      "minimum": 0
    }
  }
}
```

### index_normalize
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "dryRun": {
      "type": "boolean"
    },
    "forceCanonical": {
      "type": "boolean"
    }
  }
}
```

### index_patch
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id",
    "op"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Instruction id to patch."
    },
    "op": {
      "type": "string",
      "enum": [
        "splice",
        "append",
        "prepend",
        "replace",
        "metadata"
      ],
      "description": "Patch operation. splice=replace a character window; append/prepend=concatenate; replace=literal substring substitution; metadata=update title/semanticSummary/categories/primaryCategory/contentType without touching the body."
    },
    "text": {
      "type": "string",
      "description": "Text to insert (splice) or concatenate (append/prepend)."
    },
    "bodyOffset": {
      "type": "number",
      "description": "Splice window start in UTF-16 code units. Mirrors the bodyOffset used by the get action, so a windowed read can be written straight back. Clamped into range; never splits a surrogate pair."
    },
    "bodyLength": {
      "type": "number",
      "description": "Number of code units to remove at bodyOffset (splice). Defaults to 0, which makes the splice a pure insertion."
    },
    "find": {
      "type": "string",
      "description": "Literal substring to find (replace op). Never interpreted as a regular expression."
    },
    "replaceWith": {
      "type": "string",
      "description": "Replacement text for the replace op. Defaults to an empty string (deletion)."
    },
    "replaceAll": {
      "type": "boolean",
      "description": "Replace every occurrence instead of only the first (replace op)."
    },
    "expectedSourceHash": {
      "type": "string",
      "description": "Optimistic-concurrency precondition. When supplied and it does not match the stored sourceHash, the patch is refused with precondition_failed and nothing is written."
    },
    "bump": {
      "type": "string",
      "enum": [
        "patch",
        "minor",
        "major",
        "none"
      ],
      "description": "Optional semver bump applied alongside the body change."
    },
    "summary": {
      "type": "string",
      "description": "Changelog summary recorded when bump is supplied."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Compute and report the result without writing."
    },
    "title": {
      "type": "string",
      "description": "New title (op: metadata only)."
    },
    "semanticSummary": {
      "type": "string",
      "description": "New semantic summary, max 600 chars (op: metadata only)."
    },
    "categories": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "New categories (op: metadata only)."
    },
    "primaryCategory": {
      "type": "string",
      "description": "New primary category (op: metadata only)."
    },
    "contentType": {
      "type": "string",
      "description": "New content type (op: metadata only)."
    }
  }
}
```

### index_purgeArchive
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ids"
  ],
  "properties": {
    "ids": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      },
      "description": "Archived instruction IDs to permanently delete."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview what would be purged without deleting."
    },
    "force": {
      "type": "boolean",
      "description": "Required when purging more than INDEX_SERVER_MAX_BULK_DELETE items. A backup is created first."
    }
  }
}
```

### index_reload
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "reloaded",
    "hash",
    "count"
  ],
  "additionalProperties": false,
  "properties": {
    "reloaded": {
      "const": true
    },
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    }
  }
}
```

### index_remove
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ids"
  ],
  "properties": {
    "ids": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      }
    },
    "missingOk": {
      "type": "boolean"
    },
    "force": {
      "type": "boolean",
      "description": "Required when deleting more than INDEX_SERVER_MAX_BULK_DELETE items (default 5). A backup is created first."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview what would be deleted without actually removing anything."
    },
    "mode": {
      "type": "string",
      "enum": [
        "archive",
        "purge"
      ],
      "description": "Removal mode. \"archive\" moves entries to the archive store (spec 006). \"purge\" is the current destructive default. Omitting \"mode\" preserves the destructive default in this transition release but emits a defaultBehaviorChangeWarning. The default will become \"archive\" in a future release."
    },
    "purge": {
      "type": "boolean",
      "description": "Alias for mode:\"purge\". Forces destructive removal."
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "removed",
    "removedIds",
    "missing",
    "errorCount",
    "errors"
  ],
  "additionalProperties": false,
  "properties": {
    "removed": {
      "type": "number"
    },
    "removedIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "missing": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "errorCount": {
      "type": "number"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "error"
        ],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "error": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

### index_repair
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "repaired",
    "updated",
    "migrationCount",
    "migrationDetails"
  ],
  "additionalProperties": false,
  "properties": {
    "repaired": {
      "type": "number"
    },
    "updated": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "skippedRepaired": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "migrationCount": {
      "type": "number"
    },
    "migrationDetails": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    }
  }
}
```

### index_restore
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ids"
  ],
  "properties": {
    "ids": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      },
      "description": "Archived instruction IDs to restore."
    },
    "restoreMode": {
      "type": "string",
      "enum": [
        "reject",
        "overwrite"
      ],
      "default": "reject",
      "description": "Collision behaviour when an active entry with the same id exists."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview what would be restored without writing."
    }
  }
}
```

### index_schema
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "generatedAt",
    "version",
    "summary",
    "schema",
    "minimalExample",
    "requiredFields",
    "optionalFieldsCommon",
    "promotionWorkflow",
    "validationRules",
    "nextSteps"
  ],
  "properties": {
    "generatedAt": {
      "type": "string"
    },
    "version": {
      "type": "string"
    },
    "summary": {
      "type": "string"
    },
    "schema": {
      "type": "object",
      "additionalProperties": true
    },
    "minimalExample": {
      "type": "object",
      "additionalProperties": true
    },
    "requiredFields": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "optionalFieldsCommon": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "promotionWorkflow": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "stage",
          "description",
          "checklistItems"
        ],
        "additionalProperties": false,
        "properties": {
          "stage": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "checklistItems": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "validationRules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "field",
          "rule",
          "constraint"
        ],
        "additionalProperties": false,
        "properties": {
          "field": {
            "type": "string"
          },
          "rule": {
            "type": "string"
          },
          "constraint": {
            "type": "string"
          }
        }
      }
    },
    "nextSteps": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### index_search
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "anyOf": [
    {
      "required": [
        "keywords"
      ]
    },
    {
      "required": [
        "searchString"
      ]
    },
    {
      "required": [
        "fields"
      ]
    },
    {
      "required": [
        "q"
      ]
    },
    {
      "required": [
        "query"
      ]
    }
  ],
  "not": {
    "required": [
      "keywords",
      "searchString"
    ]
  },
  "properties": {
    "keywords": {
      "anyOf": [
        {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "minItems": 1,
          "maxItems": 10
        },
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      ],
      "description": "Search keywords: an array of tokens, OR a single string (one or many words). A string is searched as-is first, then split on spaces if no match."
    },
    "searchString": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Phrase input for search. Mutually exclusive with keywords."
    },
    "q": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Alias for searchString (accepts the common `q` search parameter name)."
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Alias for searchString (accepts the common `query` search parameter name)."
    },
    "mode": {
      "type": "string",
      "enum": [
        "keyword",
        "regex",
        "semantic"
      ],
      "description": "Search mode: keyword (substring), regex (patterns like \"deploy|release\"), or semantic (embedding similarity). Default is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Omit to use the server default."
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "default": 50,
      "description": "Maximum number of instruction IDs to return"
    },
    "includeCategories": {
      "type": "boolean",
      "default": false,
      "description": "Include categories in search scope"
    },
    "caseSensitive": {
      "type": "boolean",
      "default": false,
      "description": "Perform case-sensitive matching"
    },
    "contentType": {
      "type": "string",
      "enum": [
        "agent",
        "skill",
        "instruction",
        "prompt",
        "workflow",
        "knowledge",
        "template",
        "integration"
      ],
      "deprecated": true,
      "description": "Deprecated alias for fields.contentType. Filter results by content type (optional)"
    },
    "fields": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "id": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
              "maxLength": 120,
              "description": "Stable identifier (file name without .json) lower-case, no leading/trailing hyphen/underscore"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                "maxLength": 120,
                "description": "Stable identifier (file name without .json) lower-case, no leading/trailing hyphen/underscore"
              }
            }
          ]
        },
        "title": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "description": "Short display title"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "description": "Short display title"
              }
            }
          ]
        },
        "body": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000000,
              "description": "Primary instruction content (markdown / plain text)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000000,
                "description": "Primary instruction content (markdown / plain text)"
              }
            }
          ]
        },
        "rationale": {
          "oneOf": [
            {
              "type": "string",
              "description": "Optional rationale / context for the instruction"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Optional rationale / context for the instruction"
              }
            }
          ]
        },
        "priority": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "description": "Relative ordering: lower = higher importance"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Relative ordering: lower = higher importance"
              }
            }
          ]
        },
        "audience": {
          "oneOf": [
            {
              "enum": [
                "individual",
                "group",
                "all"
              ],
              "description": "Intended audience scope"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "individual",
                  "group",
                  "all"
                ],
                "description": "Intended audience scope"
              }
            }
          ]
        },
        "requirement": {
          "oneOf": [
            {
              "enum": [
                "mandatory",
                "critical",
                "recommended",
                "optional",
                "deprecated"
              ],
              "description": "Lifecycle requirement status"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "mandatory",
                  "critical",
                  "recommended",
                  "optional",
                  "deprecated"
                ],
                "description": "Lifecycle requirement status"
              }
            }
          ]
        },
        "categories": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$"
              }
            }
          ]
        },
        "primaryCategory": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
              "description": "Primary/default category (must be a member of categories when present)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9-_]{0,48}$",
                "description": "Primary/default category (must be a member of categories when present)"
              }
            }
          ]
        },
        "contentType": {
          "oneOf": [
            {
              "enum": [
                "agent",
                "skill",
                "instruction",
                "prompt",
                "workflow",
                "knowledge",
                "template",
                "integration"
              ],
              "default": "instruction",
              "description": "Content type classification: agent (AI agent definitions and personas), skill (packaged agent capabilities or callable skills), instruction (actionable guidance and operating rules), prompt (prompt templates or prompt engineering assets), workflow (multi-step processes or runbooks), knowledge (reference material, examples, concepts, and documentation), template (reusable scaffolds or structured content templates), integration (external system, MCP, API, or tool integration guidance)."
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "agent",
                  "skill",
                  "instruction",
                  "prompt",
                  "workflow",
                  "knowledge",
                  "template",
                  "integration"
                ],
                "default": "instruction",
                "description": "Content type classification: agent (AI agent definitions and personas), skill (packaged agent capabilities or callable skills), instruction (actionable guidance and operating rules), prompt (prompt templates or prompt engineering assets), workflow (multi-step processes or runbooks), knowledge (reference material, examples, concepts, and documentation), template (reusable scaffolds or structured content templates), integration (external system, MCP, API, or tool integration guidance)."
              }
            }
          ]
        },
        "schemaVersion": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "6",
                "7",
                "8",
                "9"
              ],
              "x-fieldClass": "server-managed",
              "description": "Internal schema version for migration"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "enum": [
                  "6",
                  "7",
                  "8",
                  "9"
                ],
                "x-fieldClass": "server-managed",
                "description": "Internal schema version for migration"
              }
            }
          ]
        },
        "sourceHash": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$",
              "x-fieldClass": "server-managed",
              "description": "SHA256 hash of body for drift detection"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$",
                "x-fieldClass": "server-managed",
                "description": "SHA256 hash of body for drift detection"
              }
            }
          ]
        },
        "deprecatedBy": {
          "oneOf": [
            {
              "type": "string",
              "description": "ID of instruction that supersedes this one"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "ID of instruction that supersedes this one"
              }
            }
          ]
        },
        "createdAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Creation timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Creation timestamp (ISO 8601)"
              }
            }
          ]
        },
        "updatedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last mutation timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last mutation timestamp (ISO 8601)"
              }
            }
          ]
        },
        "usageCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "DEPRECATED (issue #418): derived total usage count = retrievedCount + appliedCount"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "DEPRECATED (issue #418): derived total usage count = retrievedCount + appliedCount"
              }
            }
          ]
        },
        "retrievedCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "Number of retrieval events (search/get/query/export/list)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of retrieval events (search/get/query/export/list)"
              }
            }
          ]
        },
        "appliedCount": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 0,
              "x-fieldClass": "server-managed",
              "description": "Number of explicit applied/cited events"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of explicit applied/cited events"
              }
            }
          ]
        },
        "firstSeenTs": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp when usage was first observed (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp when usage was first observed (ISO 8601)"
              }
            }
          ]
        },
        "lastUsedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last usage timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last usage timestamp (ISO 8601)"
              }
            }
          ]
        },
        "lastRetrievedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last retrieval timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last retrieval timestamp (ISO 8601)"
              }
            }
          ]
        },
        "lastAppliedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Last applied timestamp (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Last applied timestamp (ISO 8601)"
              }
            }
          ]
        },
        "riskScore": {
          "oneOf": [
            {
              "type": "number",
              "description": "Optional numeric risk indicator (higher = riskier)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "number",
                "description": "Optional numeric risk indicator (higher = riskier)"
              }
            }
          ]
        },
        "reviewIntervalDays": {
          "oneOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 365,
              "description": "Governance review interval in days"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 1,
                "maximum": 365,
                "description": "Governance review interval in days"
              }
            }
          ]
        },
        "workspaceId": {
          "oneOf": [
            {
              "type": "string",
              "description": "Scoped workspace identifier (if specific)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Scoped workspace identifier (if specific)"
              }
            }
          ]
        },
        "userId": {
          "oneOf": [
            {
              "type": "string",
              "description": "Scoped user identifier (if specific)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "Scoped user identifier (if specific)"
              }
            }
          ]
        },
        "teamIds": {
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "version": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^\\d+\\.\\d+\\.\\d+$",
              "description": "Semantic version of the instruction"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "pattern": "^\\d+\\.\\d+\\.\\d+$",
                "description": "Semantic version of the instruction"
              }
            }
          ]
        },
        "status": {
          "oneOf": [
            {
              "enum": [
                "draft",
                "review",
                "approved",
                "deprecated"
              ],
              "description": "Governance workflow status"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "draft",
                  "review",
                  "approved",
                  "deprecated"
                ],
                "description": "Governance workflow status"
              }
            }
          ]
        },
        "owner": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "description": "Assigned owning entity (team / user / group)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1,
                "description": "Assigned owning entity (team / user / group)"
              }
            }
          ]
        },
        "priorityTier": {
          "oneOf": [
            {
              "enum": [
                "P1",
                "P2",
                "P3",
                "P4"
              ],
              "description": "Tier bucket derived from priority or governance policy"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "P1",
                  "P2",
                  "P3",
                  "P4"
                ],
                "description": "Tier bucket derived from priority or governance policy"
              }
            }
          ]
        },
        "classification": {
          "oneOf": [
            {
              "enum": [
                "public",
                "internal",
                "restricted"
              ],
              "description": "Information classification level"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "public",
                  "internal",
                  "restricted"
                ],
                "description": "Information classification level"
              }
            }
          ]
        },
        "lastReviewedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "description": "Timestamp of last governance review"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "description": "Timestamp of last governance review"
              }
            }
          ]
        },
        "nextReviewDue": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "description": "Scheduled next review timestamp"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "description": "Scheduled next review timestamp"
              }
            }
          ]
        },
        "changeLog": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": true
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": true
              }
            }
          ]
        },
        "supersedes": {
          "oneOf": [
            {
              "type": "string",
              "description": "ID of instruction this one replaces"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "description": "ID of instruction this one replaces"
              }
            }
          ]
        },
        "archivedAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp when archived (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp when archived (ISO 8601)"
              }
            }
          ]
        },
        "archivedBy": {
          "oneOf": [
            {
              "type": "string",
              "x-fieldClass": "server-managed",
              "description": "Identifier of the agent / operator that archived this entry (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "x-fieldClass": "server-managed",
                "description": "Identifier of the agent / operator that archived this entry (schema v7)"
              }
            }
          ]
        },
        "archiveReason": {
          "oneOf": [
            {
              "enum": [
                "deprecated",
                "superseded",
                "duplicate-merge",
                "manual",
                "legacy-scope"
              ],
              "x-fieldClass": "server-managed",
              "description": "Closed enum capturing why the entry was archived (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "deprecated",
                  "superseded",
                  "duplicate-merge",
                  "manual",
                  "legacy-scope"
                ],
                "x-fieldClass": "server-managed",
                "description": "Closed enum capturing why the entry was archived (schema v7)"
              }
            }
          ]
        },
        "archiveSource": {
          "oneOf": [
            {
              "enum": [
                "groom",
                "remove",
                "archive",
                "import-migration"
              ],
              "x-fieldClass": "server-managed",
              "description": "Which lifecycle pathway produced the archive event (schema v7)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
                  "groom",
                  "remove",
                  "archive",
                  "import-migration"
                ],
                "x-fieldClass": "server-managed",
                "description": "Which lifecycle pathway produced the archive event (schema v7)"
              }
            }
          ]
        },
        "restoreEligible": {
          "oneOf": [
            {
              "type": "boolean",
              "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "boolean",
                "description": "Whether the entry may be restored to the active set. Defaults to true; mergers may set this to false to prevent reactivation (schema v7)."
              }
            }
          ]
        },
        "semanticSummary": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 600,
              "description": "Cached short natural-language summary of body"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 600,
                "description": "Cached short natural-language summary of body"
              }
            }
          ]
        },
        "sourceWorkspace": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 200,
              "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 200,
                "description": "Logical workspace or repository identifier from which this instruction was promoted or created"
              }
            }
          ]
        },
        "createdByAgent": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 200,
              "description": "Identifier of the MCP agent or client that created or promoted this entry"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "maxLength": 200,
                "description": "Identifier of the MCP agent or client that created or promoted this entry"
              }
            }
          ]
        },
        "links": {
          "oneOf": [
            {
              "type": "object",
              "required": [
                "target"
              ],
              "additionalProperties": false,
              "properties": {
                "target": {
                  "type": "string",
                  "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                  "maxLength": 120,
                  "description": "Target instruction ID"
                },
                "rel": {
                  "type": "string",
                  "enum": [
                    "related",
                    "prerequisite",
                    "sequel",
                    "part-of",
                    "see-also"
                  ],
                  "default": "related",
                  "description": "Relationship type"
                },
                "label": {
                  "type": "string",
                  "maxLength": 120,
                  "description": "Human-readable annotation"
                }
              }
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": [
                  "target"
                ],
                "additionalProperties": false,
                "properties": {
                  "target": {
                    "type": "string",
                    "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$",
                    "maxLength": 120,
                    "description": "Target instruction ID"
                  },
                  "rel": {
                    "type": "string",
                    "enum": [
                      "related",
                      "prerequisite",
                      "sequel",
                      "part-of",
                      "see-also"
                    ],
                    "default": "related",
                    "description": "Relationship type"
                  },
                  "label": {
                    "type": "string",
                    "maxLength": 120,
                    "description": "Human-readable annotation"
                  }
                }
              }
            }
          ]
        },
        "signalHistory": {
          "oneOf": [
            {
              "type": "object",
              "required": [
                "signal",
                "ts"
              ],
              "additionalProperties": false,
              "properties": {
                "signal": {
                  "type": "string",
                  "description": "Signal value (e.g. helpful, outdated, applied)"
                },
                "ts": {
                  "type": "string",
                  "format": "date-time",
                  "description": "When the signal arrived (ISO 8601)"
                },
                "comment": {
                  "type": "string",
                  "description": "Optional freeform comment accompanying the signal"
                }
              }
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": [
                  "signal",
                  "ts"
                ],
                "additionalProperties": false,
                "properties": {
                  "signal": {
                    "type": "string",
                    "description": "Signal value (e.g. helpful, outdated, applied)"
                  },
                  "ts": {
                    "type": "string",
                    "format": "date-time",
                    "description": "When the signal arrived (ISO 8601)"
                  },
                  "comment": {
                    "type": "string",
                    "description": "Optional freeform comment accompanying the signal"
                  }
                }
              }
            }
          ]
        },
        "lastSignaledAt": {
          "oneOf": [
            {
              "type": "string",
              "format": "date-time",
              "x-fieldClass": "server-managed",
              "description": "Timestamp of the most recent signal event (ISO 8601)"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "format": "date-time",
                "x-fieldClass": "server-managed",
                "description": "Timestamp of the most recent signal event (ISO 8601)"
              }
            }
          ]
        },
        "extensions": {
          "type": "object",
          "additionalProperties": true
        },
        "categoriesAny": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "categoriesAll": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "categoriesNone": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsAny": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsAll": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "teamIdsNone": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "idPrefix": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "idRegex": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "priorityMin": {
          "type": "number"
        },
        "priorityMax": {
          "type": "number"
        },
        "usageCountMin": {
          "type": "number"
        },
        "usageCountMax": {
          "type": "number"
        },
        "riskScoreMin": {
          "type": "number"
        },
        "riskScoreMax": {
          "type": "number"
        },
        "reviewIntervalDaysMin": {
          "type": "number"
        },
        "reviewIntervalDaysMax": {
          "type": "number"
        },
        "createdAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "createdBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "updatedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "updatedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "firstSeenAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "firstSeenBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastUsedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastUsedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastReviewedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "lastReviewedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "nextReviewDueAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "nextReviewDueBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "archivedAfter": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        },
        "archivedBefore": {
          "type": "string",
          "minLength": 1,
          "format": "date-time"
        }
      },
      "description": "Structural predicates over canonical instruction fields. Scalar arrays use OR semantics; unknown fields are rejected."
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "results",
    "totalMatches",
    "query",
    "executionTimeMs"
  ],
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "instructionId",
          "relevanceScore",
          "matchedFields"
        ],
        "properties": {
          "instructionId": {
            "type": "string"
          },
          "relevanceScore": {
            "type": "number"
          },
          "matchedFields": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "totalMatches": {
      "type": "number"
    },
    "query": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keywords",
        "limit",
        "includeCategories",
        "caseSensitive"
      ],
      "properties": {
        "keywords": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "mode": {
          "type": "string"
        },
        "limit": {
          "type": "number"
        },
        "includeCategories": {
          "type": "boolean"
        },
        "caseSensitive": {
          "type": "boolean"
        },
        "contentType": {
          "type": "string"
        },
        "searchString": {
          "type": "string"
        },
        "fields": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "executionTimeMs": {
      "type": "number"
    }
  }
}
```

### integrity_manifest
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### integrity_verify
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "issues",
    "issueCount"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "expected",
          "actual"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "expected": {
            "type": "string"
          },
          "actual": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "issueCount": {
      "type": "number"
    }
  }
}
```

### manifest_refresh
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### manifest_repair
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### manifest_status
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### messaging_ack
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "messageIds",
    "reader"
  ],
  "properties": {
    "messageIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "description": "Message IDs to acknowledge"
    },
    "reader": {
      "type": "string",
      "description": "Reader identity"
    }
  }
}
```

### messaging_get
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "messageId"
  ],
  "properties": {
    "messageId": {
      "type": "string",
      "description": "Message ID to retrieve"
    }
  }
}
```

### messaging_list_channels
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### messaging_manage
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "send",
        "read",
        "list_channels",
        "ack",
        "stats",
        "get",
        "update",
        "purge",
        "reply",
        "thread"
      ],
      "description": "Messaging action to dispatch. Mirrors the legacy messaging_<action> tools 1:1."
    },
    "channel": {
      "type": "string",
      "description": "Channel name (send/read/stats/purge)."
    },
    "sender": {
      "type": "string",
      "description": "Sender id (send/reply)."
    },
    "recipients": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Recipient ids (send/reply/update)."
    },
    "body": {
      "type": "string",
      "description": "Message body (send/reply/update)."
    },
    "ttlSeconds": {
      "type": "number"
    },
    "persistent": {
      "type": "boolean"
    },
    "payload": {
      "type": "object",
      "additionalProperties": true
    },
    "priority": {
      "type": "string"
    },
    "parentId": {
      "type": "string",
      "description": "Parent message id (reply/thread)."
    },
    "requiresAck": {
      "type": "boolean"
    },
    "ackBySeconds": {
      "type": "number"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reader": {
      "type": "string"
    },
    "unreadOnly": {
      "type": "boolean"
    },
    "limit": {
      "type": "number"
    },
    "markRead": {
      "type": "boolean"
    },
    "unacked": {
      "type": "boolean",
      "description": "Only return unacknowledged messages (action=read, requires reader)."
    },
    "messageIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "messageId": {
      "type": "string"
    },
    "all": {
      "type": "boolean",
      "description": "Purge all messages."
    },
    "replyAll": {
      "type": "boolean"
    }
  }
}
```

### messaging_purge
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "channel": {
      "type": "string",
      "description": "Purge messages in this channel"
    },
    "messageIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Delete specific message IDs"
    },
    "all": {
      "type": "boolean",
      "description": "Purge all messages"
    }
  }
}
```

### messaging_read
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "channel": {
      "type": "string",
      "description": "Filter by channel name"
    },
    "reader": {
      "type": "string",
      "description": "Reader identity for visibility filtering"
    },
    "unreadOnly": {
      "type": "boolean",
      "description": "Only return unread messages"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 500,
      "description": "Maximum messages to return"
    },
    "markRead": {
      "type": "boolean",
      "description": "Mark returned messages as read by reader"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Filter by tags (match any)"
    },
    "sender": {
      "type": "string",
      "description": "Filter by sender name"
    },
    "requiresAck": {
      "type": "boolean",
      "description": "Filter to messages that require/do not require acknowledgment"
    },
    "unacked": {
      "type": "boolean",
      "description": "Only return unacknowledged messages (requires reader)"
    }
  }
}
```

### messaging_reply
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "parentId",
    "sender",
    "body"
  ],
  "properties": {
    "parentId": {
      "type": "string",
      "description": "ID of the message to reply to"
    },
    "sender": {
      "type": "string",
      "description": "Sender agent/instance ID"
    },
    "body": {
      "type": "string",
      "maxLength": 100000,
      "description": "Reply message body"
    },
    "replyAll": {
      "type": "boolean",
      "description": "If true, reply to all original recipients + sender (excluding self)"
    },
    "recipients": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Override recipients (default: reply to sender only)"
    },
    "priority": {
      "type": "string",
      "enum": [
        "low",
        "normal",
        "high",
        "critical"
      ],
      "description": "Priority (default: inherit from parent)"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional categorization tags"
    },
    "persistent": {
      "type": "boolean",
      "description": "If true, message survives TTL sweep"
    },
    "payload": {
      "type": "object",
      "additionalProperties": true,
      "description": "Structured JSON data"
    }
  }
}
```

### messaging_send
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "channel",
    "sender",
    "recipients",
    "body"
  ],
  "properties": {
    "channel": {
      "type": "string",
      "description": "Target channel name"
    },
    "sender": {
      "type": "string",
      "description": "Sender agent/instance ID"
    },
    "recipients": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "description": "Recipients list. Use ['*'] for broadcast."
    },
    "body": {
      "type": "string",
      "maxLength": 100000,
      "description": "Message body text"
    },
    "ttlSeconds": {
      "type": "number",
      "minimum": 1,
      "maximum": 86400,
      "description": "Time-to-live in seconds (default: 3600)"
    },
    "persistent": {
      "type": "boolean",
      "description": "If true, message survives TTL sweep"
    },
    "payload": {
      "type": "object",
      "additionalProperties": true,
      "description": "Structured JSON data"
    },
    "priority": {
      "type": "string",
      "enum": [
        "low",
        "normal",
        "high",
        "critical"
      ]
    },
    "parentId": {
      "type": "string",
      "description": "Parent message ID for threading"
    },
    "requiresAck": {
      "type": "boolean",
      "description": "Whether acknowledgment is required"
    },
    "ackBySeconds": {
      "type": "number",
      "minimum": 1,
      "description": "ACK deadline in seconds from creation"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional categorization tags"
    }
  }
}
```

### messaging_stats
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "reader": {
      "type": "string",
      "description": "Reader identity (default: *)"
    },
    "channel": {
      "type": "string",
      "description": "Filter by channel"
    }
  }
}
```

### messaging_thread
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "parentId"
  ],
  "properties": {
    "parentId": {
      "type": "string",
      "description": "Root message ID to retrieve the thread for"
    }
  }
}
```

### messaging_update
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "messageId"
  ],
  "properties": {
    "messageId": {
      "type": "string",
      "description": "Message ID to update"
    },
    "body": {
      "type": "string",
      "maxLength": 100000,
      "description": "New message body"
    },
    "recipients": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "New recipients list"
    },
    "payload": {
      "type": "object",
      "additionalProperties": true,
      "description": "New structured data"
    },
    "persistent": {
      "type": "boolean",
      "description": "New persistence flag"
    }
  }
}
```

### meta_activation_guide
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```

### meta_check_activation
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "toolName": {
      "type": "string",
      "description": "Tool name to check activation requirements for (e.g., \"index_search\")"
    }
  }
}
```

### meta_tools
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": true,
  "required": [
    "stable",
    "dynamic",
    "tools"
  ],
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "method"
        ],
        "additionalProperties": true,
        "properties": {
          "method": {
            "type": "string"
          },
          "stable": {
            "type": "boolean"
          },
          "mutation": {
            "type": "boolean"
          },
          "disabled": {
            "type": "boolean"
          }
        }
      }
    },
    "stable": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tools"
      ],
      "properties": {
        "tools": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "method",
              "stable",
              "mutation"
            ],
            "additionalProperties": true,
            "properties": {
              "method": {
                "type": "string"
              },
              "stable": {
                "type": "boolean"
              },
              "mutation": {
                "type": "boolean"
              }
            }
          }
        }
      }
    },
    "dynamic": {
      "type": "object",
      "additionalProperties": true,
      "required": [
        "generatedAt",
        "mutationEnabled",
        "disabled"
      ],
      "properties": {
        "generatedAt": {
          "type": "string"
        },
        "mutationEnabled": {
          "type": "boolean"
        },
        "disabled": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "method"
            ],
            "additionalProperties": false,
            "properties": {
              "method": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "mcp": {
      "type": "object",
      "additionalProperties": true,
      "required": [
        "registryVersion",
        "tools"
      ],
      "properties": {
        "registryVersion": {
          "type": "string"
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "name",
              "description",
              "stable",
              "mutation",
              "inputSchema"
            ],
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "stable": {
                "type": "boolean"
              },
              "mutation": {
                "type": "boolean"
              },
              "inputSchema": {
                "type": "object"
              },
              "outputSchema": {
                "type": "object"
              }
            }
          }
        }
      }
    }
  }
}
```

### metrics_snapshot
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": true
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "generatedAt",
    "methods"
  ],
  "properties": {
    "generatedAt": {
      "type": "string"
    },
    "methods": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "method",
          "count",
          "avgMs",
          "maxMs"
        ],
        "additionalProperties": false,
        "properties": {
          "method": {
            "type": "string"
          },
          "count": {
            "type": "number"
          },
          "avgMs": {
            "type": "number"
          },
          "maxMs": {
            "type": "number"
          }
        }
      }
    },
    "features": {
      "type": "object",
      "additionalProperties": true
    }
  }
}
```

### promote_from_repo
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "repoPath"
  ],
  "properties": {
    "repoPath": {
      "type": "string",
      "description": "Absolute path to the Git repository root"
    },
    "scope": {
      "type": "string",
      "enum": [
        "all",
        "governance",
        "specs",
        "docs",
        "instructions"
      ],
      "default": "all",
      "description": "Which content categories to promote"
    },
    "force": {
      "type": "boolean",
      "default": false,
      "description": "Re-promote even if content hash unchanged"
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "Preview what would be promoted without writing"
    },
    "repoId": {
      "type": "string",
      "description": "Override repo identifier. Defaults to directory name."
    }
  }
}
```

### prompt_review
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "truncated",
        "message",
        "max"
      ],
      "additionalProperties": false,
      "properties": {
        "truncated": {
          "const": true
        },
        "message": {
          "type": "string"
        },
        "max": {
          "type": "number"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "issues",
        "summary",
        "length"
      ],
      "additionalProperties": false,
      "properties": {
        "issues": {
          "type": "array",
          "items": {
            "type": "object"
          }
        },
        "summary": {
          "type": "object"
        },
        "length": {
          "type": "number"
        }
      }
    }
  ]
}
```

### trace_dump
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "file": {
      "type": "string",
      "description": "Optional path to write the trace buffer JSON file"
    }
  }
}
```

### usage_flush
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "description": "Instruction ID to reset usage for"
    },
    "before": {
      "type": "string",
      "description": "ISO date — reset usage for entries with lastUsedAt before this date"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "required": [
    "flushed"
  ],
  "additionalProperties": false,
  "properties": {
    "flushed": {
      "const": true
    }
  }
}
```

### usage_hotset
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hash",
    "count",
    "limit",
    "items"
  ],
  "properties": {
    "hash": {
      "type": "string"
    },
    "count": {
      "type": "number"
    },
    "feature_status": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "limit": {
      "type": "number"
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "usageCount"
        ],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "usageCount": {
            "type": "number"
          },
          "retrievedCount": {
            "type": "number"
          },
          "appliedCount": {
            "type": "number"
          },
          "lastUsedAt": {
            "type": "string"
          },
          "lastRetrievedAt": {
            "type": "string"
          },
          "lastAppliedAt": {
            "type": "string"
          },
          "lastSignal": {
            "type": "string"
          },
          "lastComment": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

### usage_track
**Input Schema**
```json
{
  "type": "object",
  "additionalProperties": false,
  "anyOf": [
    {
      "required": [
        "id"
      ]
    },
    {
      "required": [
        "instructionId"
      ]
    }
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "instructionId": {
      "type": "string",
      "description": "Alias for id (accepts the instructionId field returned by search/query/get)."
    },
    "action": {
      "type": "string",
      "enum": [
        "retrieved",
        "applied",
        "cited"
      ],
      "description": "Usage action type (default: retrieved)"
    },
    "signal": {
      "type": "string",
      "enum": [
        "helpful",
        "not-relevant",
        "outdated",
        "applied"
      ],
      "description": "Qualitative signal about instruction usefulness"
    },
    "comment": {
      "type": "string",
      "maxLength": 256,
      "description": "Optional short comment about the instruction"
    }
  }
}
```
**Output Schema (Result)**
```json
{
  "anyOf": [
    {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "notFound"
      ],
      "properties": {
        "notFound": {
          "const": true
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "featureDisabled"
      ],
      "properties": {
        "featureDisabled": {
          "const": true
        }
      },
      "additionalProperties": true
    },
    {
      "type": "object",
      "required": [
        "id",
        "usageCount",
        "lastUsedAt"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "usageCount": {
          "type": "number"
        },
        "retrievedCount": {
          "type": "number"
        },
        "appliedCount": {
          "type": "number"
        },
        "firstSeenTs": {
          "type": "string"
        },
        "lastUsedAt": {
          "type": "string"
        },
        "lastRetrievedAt": {
          "type": "string"
        },
        "lastAppliedAt": {
          "type": "string"
        },
        "action": {
          "type": "string"
        },
        "signal": {
          "type": "string"
        },
        "comment": {
          "type": "string"
        }
      }
    }
  ]
}
```
