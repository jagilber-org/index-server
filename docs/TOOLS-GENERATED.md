# Generated Tool Registry

Registry Version: 2026-03-29

| Method | Stable | Mutation | Description |
|--------|--------|----------|-------------|
| bootstrap | yes |  | Unified bootstrap dispatcher. Actions: request, confirm, status. |
| feedback_manage |  | yes | Manage feedback entries through a single action dispatcher. Actions: submit, list, get, update, delete, stats. |
| feedback_submit | yes |  | Submit feedback entry (issue, status report, security alert, feature request, etc.). |
| gates_evaluate | yes |  | Evaluate configured gating criteria over current index. |
| graph_export | yes |  | Export instruction relationship graph (schema v1 minimal or v2 enriched). |
| health_check | yes |  | Returns server health status & version. |
| help_overview | yes |  | Structured onboarding guidance for new agents (tool discovery, index lifecycle, promotion workflow). |
| index_add |  | yes | Add a single instruction (lax mode fills defaults; overwrite optional). |
| index_dispatch | yes |  | Unified dispatcher for instruction index operations. Required: "action". Key params by action: get/getEnhanced(id), search(q/searchString/keywords/fields, includeCategories, caseSensitive, limit, mode), query(text,categoriesAny,limit,offset), list(category), diff(clientHash), export(ids,metaOnly), remove(id or ids, mode:"archive"\|"purge"), archive(ids, reason), restore(ids, restoreMode), listArchived/getArchived/purgeArchive. Read actions accept includeArchived/onlyArchived flags (mutually exclusive). Use action="capabilities" to discover all supported actions. |
| index_governanceHash | yes |  | Return governance projection & deterministic governance hash. |
| index_governanceUpdate |  | yes | Patch limited governance fields (owner/status/review dates + optional version bump). |
| index_import |  | yes | Import instruction entries from: inline array (entries), stringified JSON array, file path to JSON array (entries as string), or directory of .json files (source). |
| index_reload |  | yes | Force reload of instruction index from disk. |
| index_remove |  | yes | Delete one or more instruction entries by id. Bulk deletes exceeding INDEX_SERVER_MAX_BULK_DELETE (default 5) require force=true and auto-create a backup first. Use dryRun=true to preview. NOTE: spec 006-archive-lifecycle introduces a new mode parameter ("archive" \| "purge"). Today the omitted-mode default remains destructive ("purge") for backwards compatibility, but the response includes defaultBehaviorChangeWarning — pass mode:"archive" to opt into the upcoming default (move to archive store, restorable) or mode:"purge" (or purge:true alias) to keep destructive behavior. The default WILL change to "archive" in a future release. |
| index_schema | yes |  | Return instruction JSON schema, examples, validation rules, and promotion workflow guidance for self-documentation. |
| index_search | yes |  | 🔍 PRIMARY: Search instructions by keywords, searchString phrase input, and/or structural fields — returns instruction IDs for targeted retrieval. Supports mode: "keyword" (substring match), "regex" (patterns like "deploy\|release"), or "semantic" (embedding similarity). Default mode is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Omit the mode parameter to let the server choose the best default. Use this FIRST to discover relevant instructions, then use index_dispatch get for details. |
| integrity_verify | yes |  | Verify each instruction body hash against stored sourceHash. |
| messaging_ack |  | yes | Acknowledge (mark as read) one or more messages by ID. |
| messaging_get | yes |  | Get a single message by ID with full details. |
| messaging_list_channels | yes |  | List all active messaging channels with message counts and latest timestamps. |
| messaging_purge |  | yes | Delete messages: all, by channel, or by specific IDs. |
| messaging_read | yes |  | Read messages from a channel with visibility filtering. Supports unread-only, limit, mark-as-read, tag filtering, and sender filtering. |
| messaging_reply |  | yes | Reply to a message with auto-populated channel and parentId. Supports reply-all (all original recipients) or reply-to-sender. |
| messaging_send |  | yes | Send a message to a channel with recipient targeting. Supports broadcast (*), directed, priority, TTL, threading, and structured payloads. |
| messaging_stats | yes |  | Get messaging statistics for a reader: total, unread, channel count. |
| messaging_thread | yes |  | Retrieve a full message thread by root parentId. Returns parent + all nested replies sorted chronologically. |
| messaging_update |  | yes | Update mutable fields of a message (body, recipients, payload, persistent flag). |
| metrics_snapshot | yes |  | Performance metrics summary for handled methods. |
| promote_from_repo |  | yes | Scan a local Git repository and promote its knowledge content (constitutions, docs, instructions, specs) into the instruction index. Reads .specify/config/promotion-map.json and instructions/*.json from the target repo. |
| prompt_review | yes |  | Static analysis of a prompt returning issues & summary. |
| usage_hotset | yes |  | Return the most-used instruction entries (hot set). |
| usage_track | yes |  | Track instruction usage with optional qualitative signal. Params: id (required), action (retrieved\|applied\|cited), signal (helpful\|not-relevant\|outdated\|applied), comment (short text, max 256 chars). |

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
          "belongs"
        ]
      },
      "maxItems": 3
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
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Explicit keyword array for search action when the caller wants direct token control."
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
                "7"
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
                  "7"
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
              "description": "Number of tracked usage events"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of tracked usage events"
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
    "limit": {
      "type": "number",
      "description": "Maximum number of results to return (search or query action)."
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
      "description": "Version bump level for governanceUpdate action.",
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
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "minItems": 1,
      "maxItems": 10,
      "description": "Search keywords to match against instruction titles, bodies, and categories"
    },
    "searchString": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Phrase input for search. Mutually exclusive with keywords."
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
                "7"
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
                  "7"
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
              "description": "Number of tracked usage events"
            },
            {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "integer",
                "minimum": 0,
                "x-fieldClass": "server-managed",
                "description": "Number of tracked usage events"
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
          "lastUsedAt": {
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
  "required": [
    "id"
  ],
  "properties": {
    "id": {
      "type": "string"
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
        "firstSeenTs": {
          "type": "string"
        },
        "lastUsedAt": {
          "type": "string"
        }
      }
    }
  ]
}
```
