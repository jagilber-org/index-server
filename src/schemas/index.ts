// JSON Schemas for tool response contracts. These are used in tests to lock interfaces.
// Increment version in docs/tools.md when changing any stable schema.

export const instructionEntry = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id','title','body','priority','audience','requirement','categories','sourceHash','schemaVersion','createdAt','updatedAt',
    'version','status','owner','priorityTier','classification','lastReviewedAt','nextReviewDue','changeLog','semanticSummary'
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    body: { type: 'string' },
    rationale: { type: 'string' },
    priority: { type: 'number' },
    audience: { enum: ['individual','group','all'] },
    requirement: { enum: ['mandatory','critical','recommended','optional','deprecated'] },
    categories: { type: 'array', items: { type: 'string' } },
    sourceHash: { type: 'string' },
    schemaVersion: { type: 'string' },
    deprecatedBy: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  usageCount: { type: 'number' },
  firstSeenTs: { type: 'string' },
    lastUsedAt: { type: 'string' },
    riskScore: { type: 'number' }
  ,workspaceId: { type: 'string' }
  ,userId: { type: 'string' }
  ,teamIds: { type: 'array', items: { type: 'string' } }
  ,version: { type: 'string' }
  ,status: { enum: ['draft','review','approved','deprecated'] }
  ,owner: { type: 'string' }
  ,priorityTier: { enum: ['P1','P2','P3','P4'] }
  ,classification: { enum: ['public','internal','restricted'] }
  ,lastReviewedAt: { type: 'string' }
  ,nextReviewDue: { type: 'string' }
  ,changeLog: { type: 'array', items: { type: 'object', required: ['version','changedAt','summary'], additionalProperties: false, properties: { version: { type: 'string' }, changedAt: { type: 'string' }, summary: { type: 'string' } } } }
  ,supersedes: { type: 'string' }
  ,semanticSummary: { type: 'string' }
  ,createdByAgent: { type: 'string' }
  ,sourceWorkspace: { type: 'string' }
  ,extensions: { type: 'object', additionalProperties: true }
  }
} as const;

// (listLike schema removed after dispatcher consolidation of read-only instruction methods)

// Using unknown for schema values to avoid any and preserve flexibility
export const schemas: Record<string, unknown> = {
  'health_check': {
    type: 'object', additionalProperties: false,
    required: ['status','timestamp','version'],
    properties: {
      status: { const: 'ok' },
      timestamp: { type: 'string' },
      version: { type: 'string' }
    }
  },
  'index_dispatch': {
    // Dispatcher returns varying shapes; keep loose but assert required action echo when capabilities.
    anyOf: [
      { type: 'object', required: ['supportedActions','mutationEnabled','version'], additionalProperties: true, properties: {
        version: { type: 'string' },
        supportedActions: { type: 'array', items: { type: 'string' } },
        mutationEnabled: { type: 'boolean' }
      } },
      { type: 'object', required: ['results'], additionalProperties: true, properties: { results: { type: 'array' } } },
      { type: 'object', required: ['hash'], additionalProperties: true, properties: { hash: { type: 'string' } } },
      { type: 'object', required: ['error'], additionalProperties: true, properties: { error: { type: 'string' } } }
    ]
  },
  'index_import': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['hash','imported','skipped','overwritten','errors','total'], additionalProperties: false, properties: {
        hash: { type: 'string' }, imported: { type: 'number' }, skipped: { type: 'number' }, overwritten: { type: 'number' }, total: { type: 'number' }, errors: { type: 'array', items: { type: 'object', required: ['id','error'], properties: { id: { type: 'string' }, error: { type: 'string' } }, additionalProperties: false } }
      } }
    ]
  },
  'index_repair': { type: 'object', required: ['repaired','updated'], additionalProperties: false, properties: { repaired: { type: 'number' }, updated: { type: 'array', items: { type: 'string' } } } },
  'prompt_review': {
    anyOf: [
      { type: 'object', required: ['truncated','message','max'], additionalProperties: false, properties: {
        truncated: { const: true },
        message: { type: 'string' },
        max: { type: 'number' }
      } },
      { type: 'object', required: ['issues','summary','length'], additionalProperties: false, properties: {
        issues: { type: 'array', items: { type: 'object' } },
        summary: { type: 'object' },
        length: { type: 'number' }
      } }
    ]
  },
  'integrity_verify': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','issues','issueCount'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number' },
      issues: { type: 'array', items: { type: 'object', required: ['id','expected','actual'], properties: { id: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' } }, additionalProperties: false } },
      issueCount: { type: 'number' }
    }
  },
  'usage_track': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['notFound'], properties: { notFound: { const: true } }, additionalProperties: true },
  { type: 'object', required: ['featureDisabled'], properties: { featureDisabled: { const: true } }, additionalProperties: true },
      { type: 'object', required: ['id','usageCount','lastUsedAt'], additionalProperties: false, properties: {
        id: { type: 'string' }, usageCount: { type: 'number' }, firstSeenTs: { type: 'string' }, lastUsedAt: { type: 'string' }
      } }
    ]
  },
  'usage_hotset': {
    type: 'object', additionalProperties: false,
    required: ['hash','count','limit','items'],
    properties: {
      hash: { type: 'string' },
      count: { type: 'number' },
    'feature_status': {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
      limit: { type: 'number' },
      items: { type: 'array', items: { type: 'object', required: ['id','usageCount'], additionalProperties: false, properties: {
        id: { type: 'string' }, usageCount: { type: 'number' }, lastUsedAt: { type: 'string' }
      } } }
    }
  },
  'metrics_snapshot': {
    type: 'object', additionalProperties: false,
    required: ['generatedAt','methods'],
    properties: {
      generatedAt: { type: 'string' },
      methods: { type: 'array', items: { type: 'object', required: ['method','count','avgMs','maxMs'], additionalProperties: false, properties: {
        method: { type: 'string' }, count: { type: 'number' }, avgMs: { type: 'number' }, maxMs: { type: 'number' }
      } } },
      features: { type: 'object', additionalProperties: true }
    }
  },
  'index_governanceHash': {
    type: 'object', additionalProperties: false,
    required: ['count','governanceHash','items'],
    properties: {
      count: { type: 'number' },
      governanceHash: { type: 'string' },
      items: { type: 'array', items: { type: 'object', required: ['id','title','version','owner','priorityTier','nextReviewDue','semanticSummarySha256','changeLogLength'], additionalProperties: false, properties: {
        id: { type: 'string' }, title: { type: 'string' }, version: { type: 'string' }, owner: { type: 'string' }, priorityTier: { type: 'string' }, nextReviewDue: { type: 'string' }, semanticSummarySha256: { type: 'string' }, changeLogLength: { type: 'number' }
      } } }
    }
  },
  'index_health': {
    anyOf: [
      { type: 'object', required: ['snapshot','hash','count'], additionalProperties: true, properties: { snapshot: { const: 'missing' }, hash: { type: 'string' }, count: { type: 'number' } } },
      { type: 'object', required: ['snapshot','hash','count','missing','changed','extra','drift'], additionalProperties: true, properties: {
        snapshot: { const: 'present' }, hash: { type: 'string' }, count: { type: 'number' },
        missing: { type: 'array', items: { type: 'string' } },
        changed: { type: 'array', items: { type: 'string' } },
        extra: { type: 'array', items: { type: 'string' } },
        drift: { type: 'number' }
      } },
      { type: 'object', required: ['snapshot','hash','error'], additionalProperties: true, properties: { snapshot: { const: 'error' }, hash: { type: 'string' }, error: { type: 'string' } } }
    ]
  },
  'gates_evaluate': {
    anyOf: [
      { type: 'object', required: ['notConfigured'], properties: { notConfigured: { const: true } }, additionalProperties: true },
      { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['generatedAt','results','summary'], additionalProperties: false, properties: {
        generatedAt: { type: 'string' },
        results: { type: 'array', items: { type: 'object', required: ['id','passed','count','op','value','severity'], additionalProperties: true, properties: {
          id: { type: 'string' }, passed: { type: 'boolean' }, count: { type: 'number' }, op: { type: 'string' }, value: { type: 'number' }, severity: { type: 'string' }, description: { type: 'string' }
        } } },
        summary: { type: 'object', required: ['errors','warnings','total'], properties: { errors: { type: 'number' }, warnings: { type: 'number' }, total: { type: 'number' } }, additionalProperties: false }
      } }
    ]
  }
  ,
  // Graph export (legacy v1 + enriched v2). Optional contract registration enabling future schema locking.
  'graph_export': {
    anyOf: [
      { type: 'object', required: ['meta','nodes','edges'], additionalProperties: true, properties: {
        meta: { type: 'object', required: ['graphSchemaVersion','nodeCount','edgeCount'], additionalProperties: true, properties: { graphSchemaVersion: { const: 1 }, nodeCount: { type: 'number' }, edgeCount: { type: 'number' } } },
        nodes: { type: 'array', items: { type: 'object', required: ['id'], additionalProperties: true, properties: { id: { type:'string' } } } },
        edges: { type: 'array', items: { type: 'object', required: ['from','to','type'], additionalProperties: true, properties: { from: { type:'string' }, to: { type:'string' }, type: { enum: ['primary','category'] } } } }
      } },
      { type: 'object', required: ['meta','nodes','edges'], additionalProperties: true, properties: {
        meta: { type: 'object', required: ['graphSchemaVersion','nodeCount','edgeCount'], additionalProperties: true, properties: { graphSchemaVersion: { const: 2 }, nodeCount: { type: 'number' }, edgeCount: { type: 'number' } } },
        nodes: { type: 'array', items: { type: 'object', required: ['id'], additionalProperties: true, properties: { id: { type:'string' }, nodeType: { enum: ['instruction','category'] }, categories: { type:'array', items:{ type:'string' } }, primaryCategory: { type:'string' }, usageCount: { type:'number' } } } },
        edges: { type: 'array', items: { type: 'object', required: ['from','to','type'], additionalProperties: true, properties: { from: { type:'string' }, to: { type:'string' }, type: { enum: ['primary','category','belongs'] } } } },
        mermaid: { type: 'string' }, dot: { type: 'string' }
      } }
    ]
  }
  ,
  'meta_tools': {
    type: 'object', additionalProperties: true,
    required: ['stable','dynamic','tools'],
    properties: {
      // Legacy flat list (includes disabled flag)
      tools: { type: 'array', items: { type: 'object', required: ['method'], additionalProperties: true, properties: {
        method: { type: 'string' }, stable: { type: 'boolean' }, mutation: { type: 'boolean' }, disabled: { type: 'boolean' }
      } } },
      stable: {
        type: 'object', additionalProperties: false,
        required: ['tools'],
        properties: {
          tools: { type: 'array', items: { type: 'object', required: ['method','stable','mutation'], additionalProperties: true, properties: {
            method: { type: 'string' },
            stable: { type: 'boolean' },
            mutation: { type: 'boolean' }
          } } }
        }
      },
      dynamic: {
        type: 'object', additionalProperties: true,
        required: ['generatedAt','mutationEnabled','disabled'],
        properties: {
          generatedAt: { type: 'string' },
          mutationEnabled: { type: 'boolean' },
          disabled: { type: 'array', items: { type: 'object', required: ['method'], additionalProperties: false, properties: { method: { type: 'string' } } } }
        }
      },
      // New MCP style registry (optional for now)
      mcp: {
        type: 'object', additionalProperties: true,
        required: ['registryVersion','tools'],
        properties: {
          registryVersion: { type: 'string' },
          tools: { type: 'array', items: { type: 'object', required: ['name','description','stable','mutation','inputSchema'], additionalProperties: false, properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            stable: { type: 'boolean' },
            mutation: { type: 'boolean' },
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' }
          } } }
        }
      }
    }
  },
  'help_overview': {
    type: 'object',
    additionalProperties: true,
    required: ['generatedAt','version','sections'],
    properties: {
      generatedAt: { type: 'string' },
      version: { type: 'string' },
      summary: { type: 'string' },
      sections: { type: 'array', items: { type: 'object', required: ['id','title','content'], additionalProperties: true, properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
        nextActions: { type: 'array', items: { type: 'string' } }
      } } },
      lifecycleModel: { type: 'object', additionalProperties: true, properties: {
        tiers: { type: 'array', items: { type: 'object', required: ['tier','purpose'], additionalProperties: true, properties: { tier: { type: 'string' }, purpose: { type: 'string' } } } },
        promotionChecklist: { type: 'array', items: { type: 'string' } }
      } },
      toolDiscovery: { type: 'object', additionalProperties: true, properties: {
        primary: { type: 'array', items: { type: 'string' } },
        diagnostics: { type: 'array', items: { type: 'string' } }
      } }
    }
  },
  'index_schema': {
    type: 'object',
    additionalProperties: false,
    required: ['generatedAt','version','summary','schema','minimalExample','requiredFields','optionalFieldsCommon','promotionWorkflow','validationRules','nextSteps'],
    properties: {
      generatedAt: { type: 'string' },
      version: { type: 'string' },
      summary: { type: 'string' },
      schema: { type: 'object', additionalProperties: true },
      minimalExample: { type: 'object', additionalProperties: true },
      requiredFields: { type: 'array', items: { type: 'string' } },
      optionalFieldsCommon: { type: 'array', items: { type: 'string' } },
      promotionWorkflow: { type: 'array', items: { type: 'object', required: ['stage','description','checklistItems'], additionalProperties: false, properties: {
        stage: { type: 'string' },
        description: { type: 'string' },
        checklistItems: { type: 'array', items: { type: 'string' } }
      } } },
      validationRules: { type: 'array', items: { type: 'object', required: ['field','rule','constraint'], additionalProperties: false, properties: {
        field: { type: 'string' },
        rule: { type: 'string' },
        constraint: { type: 'string' }
      } } },
      nextSteps: { type: 'array', items: { type: 'string' } }
    }
  },
  'usage_flush': { type: 'object', required: ['flushed'], additionalProperties: false, properties: { flushed: { const: true } } },
  'index_reload': { type: 'object', required: ['reloaded','hash','count'], additionalProperties: false, properties: { reloaded: { const: true }, hash: { type: 'string' }, count: { type: 'number' } } },
  'index_remove': { type: 'object', required: ['removed','removedIds','missing','errorCount','errors'], additionalProperties: false, properties: {
    removed: { type: 'number' },
    removedIds: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    errorCount: { type: 'number' },
    errors: { type: 'array', items: { type: 'object', required: ['id','error'], additionalProperties: false, properties: { id: { type: 'string' }, error: { type: 'string' } } } }
  } },
  'index_enrich': { type: 'object', required: ['rewritten','updated','skipped'], additionalProperties: false, properties: {
    rewritten: { type: 'number' },
    updated: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } }
  } },
  'index_add': {
    anyOf: [
      { type: 'object', required: ['error'], properties: { error: { type: 'string' }, id: { type: 'string' } }, additionalProperties: true },
      { type: 'object', required: ['id','hash','skipped','created','overwritten'], additionalProperties: false, properties: {
        id: { type: 'string' }, hash: { type: 'string' }, skipped: { type: 'boolean' }, created: { type: 'boolean' }, overwritten: { type: 'boolean' }
      } }
    ]
  },
  'index_groom': {
    type: 'object', additionalProperties: false,
    required: ['previousHash','hash','scanned','repairedHashes','normalizedCategories','deprecatedRemoved','duplicatesMerged','signalApplied','filesRewritten','purgedScopes','dryRun','notes'],
    properties: {
      previousHash: { type: 'string' },
      hash: { type: 'string' },
      scanned: { type: 'number' },
      repairedHashes: { type: 'number' },
      normalizedCategories: { type: 'number' },
      deprecatedRemoved: { type: 'number' },
      duplicatesMerged: { type: 'number' },
      signalApplied: { type: 'number' },
      filesRewritten: { type: 'number' },
      purgedScopes: { type: 'number' },
      migrated: { type: 'number' },
      remappedCategories: { type: 'number' },
      dryRun: { type: 'boolean' },
      notes: { type: 'array', items: { type: 'string' } }
    }
  },
  'index_search': {
    type: 'object',
    additionalProperties: false,
    required: ['results', 'totalMatches', 'query', 'executionTimeMs'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['instructionId', 'relevanceScore', 'matchedFields'],
          properties: {
            instructionId: { type: 'string' },
            relevanceScore: { type: 'number' },
            matchedFields: {
              type: 'array',
              items: { enum: ['title', 'body', 'categories'] }
            }
          }
        }
      },
      totalMatches: { type: 'number' },
      query: {
        type: 'object',
        additionalProperties: false,
        required: ['keywords', 'limit', 'includeCategories', 'caseSensitive'],
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number' },
          includeCategories: { type: 'boolean' },
          caseSensitive: { type: 'boolean' }
        }
      },
      executionTimeMs: { type: 'number' }
    }
  }
};

export type SchemaMap = typeof schemas;
