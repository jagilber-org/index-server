# Generated Tool Registry

Registry Version: 2026-03-29

| Method | Stable | Mutation | Description |
|--------|--------|----------|-------------|
| bootstrap | yes |  | Unified bootstrap dispatcher. Actions: request, confirm, status. |
| feedback_submit | yes |  | Submit feedback entry (issue, status report, security alert, feature request, etc.). |
| health_check | yes |  | Returns server health status & version. |
| help_overview | yes |  | Structured onboarding guidance for new agents (tool discovery, index lifecycle, promotion workflow). |
| index_dispatch | yes |  | Unified dispatcher for instruction index operations. Required: "action". Key params by action: get/getEnhanced(id), search(q or keywords, includeCategories, caseSensitive, limit, mode), query(text,categoriesAny,limit,offset), list(category), diff(clientHash), export(ids,metaOnly), remove(id or ids). Use action="capabilities" to discover all supported actions. |
| index_search | yes |  | 🔍 PRIMARY: Search instructions by keywords — returns instruction IDs for targeted retrieval. Supports mode: "keyword" (substring match), "regex" (patterns like "deploy\|release"), or "semantic" (embedding similarity). Default mode is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword. Omit the mode parameter to let the server choose the best default. Use this FIRST to discover relevant instructions, then use index_dispatch get for details. |
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
      "type": "string"
    },
    "requirement": {
      "type": "string"
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
        "approved",
        "draft",
        "review",
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
  "required": [
    "keywords"
  ],
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
      "description": "Filter results by content type (optional)"
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
              "enum": [
                "title",
                "body",
                "categories"
              ]
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
        "limit": {
          "type": "number"
        },
        "includeCategories": {
          "type": "boolean"
        },
        "caseSensitive": {
          "type": "boolean"
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
