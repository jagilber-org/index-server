# Generated Tool Registry

Registry Version: 2026-03-29

| Method | Stable | Mutation | Description |
|--------|--------|----------|-------------|
| bootstrap | yes |  | Unified bootstrap dispatcher. Actions: request, confirm, status. |
| feedback_submit | yes |  | Submit feedback entry (issue, status report, security alert, feature request, etc.). |
| health_check | yes |  | Returns server health status & version. |
| help_overview | yes |  | Structured onboarding guidance for new agents (tool discovery, index lifecycle, promotion workflow). |
| index_dispatch | yes |  | Unified dispatcher for instruction index operations. Required: "action". Key params by action: get/getEnhanced(id), search(q/searchString/keywords/fields, includeCategories, caseSensitive, limit, mode), query(text,categoriesAny,limit,offset), list(category), diff(clientHash), export(ids,metaOnly), remove(id or ids). Use action="capabilities" to discover all supported actions. |
| index_search | yes |  | 🔍 PRIMARY: Search instructions by keywords, searchString phrase input, and/or structural fields — returns instruction IDs for targeted retrieval. Supports mode: "keyword" (substring match), "regex" (patterns like "deploy\|release"), or "semantic" (embedding similarity). Default mode is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Omit the mode parameter to let the server choose the best default. Use this FIRST to discover relevant instructions, then use index_dispatch get for details. |
| prompt_review | yes |  | Static analysis of a prompt returning issues & summary. |

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

### index_dispatch
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
        "manifestRepair"
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
                "6"
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
                  "6"
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
                "6"
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
                  "6"
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
