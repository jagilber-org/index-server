---
id: 001-knowledge-index-lifecycle
version: 1.0.0
status: active
priority: P1
category: lifecycle
created: 2025-09-14
updated: 2025-09-14
author: system
lineage: 000-bootstrapper
summary: Local-first knowledge lifecycle governing capture, validation, scoring, and selective promotion into shared instruction index.
---

# Knowledge Index Lifecycle (P1)

## Executive Summary

A comprehensive knowledge management lifecycle expanding the bootstrapper specification. Implements local-first approach where knowledge is captured and refined locally (P0) before selective promotion to shared index server.

## Core Philosophy

### Local-First Principle

- P0 Priority: Local knowledge capture takes highest priority
- Quality through Iteration: Knowledge refined locally before sharing
- Selective Promotion: Only proven, high-value knowledge promoted to shared index
- Personal Knowledge Base: Maintain individual learning repository

### Foundation Integration

- Architecture foundation alignment
- Testing & validation gates
- Diagnostics & performance considerations
- Best practice reinforcement

## Repository Architecture Model

```text
.knowledge-index/
├── constitution.md
├── config/
│   ├── local-settings.json
│   ├── promotion-criteria.json
│   └── mcp-connection.json
├── local/
│   ├── p0-commands/
│   ├── discoveries/
│   ├── drafts/
│   └── archive/
├── promoted/
│   ├── pending-promotion/
│   ├── promoted-tracking/
│   └── promotion-reports/
├── tools/
└── templates/
```

## Knowledge Entry Schema

### Metadata

- ID (uuid)
- Created / Updated timestamps
- P-Level (P0..P3)
- Categories (tags)
- Source (discovery method)
- Validation state (tested/draft/theoretical)
- Promotion-Ready flag

### Content & Context Sections

- Knowledge Content (structured)
- Usage Context (when to use, prerequisites, related knowledge)
- Validation Evidence (scenarios, success rate, edge cases)
- Promotion Assessment (shareability, quality, value, maintenance effort)

## P0 Command System

### Core Commands

- p0-capture (immediate structured capture)
- p0-search (fast retrieval with filters)
- p0-promote (promotion workflow)

## Promotion Strategy

### What To Promote

1. Proven patterns with broad applicability
2. Organizational knowledge assets
3. Time-saving discoveries
4. Risk mitigation knowledge

### What Not To Promote

1. Personal learning & experimentation
2. Project-specific context
3. Incomplete or unvalidated knowledge
4. Highly contextual information

## Quality Gates

Promotion Score = (Breadth × Accuracy × Clarity × Value × Maintainability) / 5

### Thresholds

- 4.0+: Immediate promotion candidate
- 3.0–3.9: Improve then re-evaluate
- 2.0–2.9: Keep local for iteration
- <2.0: Personal/project scope only

## Validation Criteria

- Tested & validated
- Dependencies documented
- Clear success criteria
- Edge cases identified
- Audience-appropriate clarity
- Practical examples
- Organizational value & alignment
- Maintenance parameters defined

## MCP Integration

### Connection Sample

```json
{
  "mcp-connection": {
    "server-tools": {
      "add-instruction": "mcp_mcp-index-ser_instructions_add",
      "search-instructions": "mcp_mcp-index-ser_instructions_dispatch",
      "health-check": "mcp_mcp-index-ser_health_check"
    },
    "promotion-settings": {
      "auto-categorize": true,
      "quality-threshold": 0.8,
      "review-period-days": 90
    },
    "governance": {
      "default-owner": "knowledge-contributor",
      "default-status": "approved",
      "classification": "internal"
    }
  }
}
```

### Workflow Steps

1. Transform local knowledge to MCP spec format
2. Apply quality scoring
3. Submit via MCP tool
4. Record promotion result
5. Update tracking & move artifact

## Sequential P1 Positioning

### Rationale

Maintain clarity: bootstrapper defines minimal contract; lifecycle adds depth only after technical discipline is stable.

### Readiness Signals

- Consistent structured development
- Routine quality gate usage
- Established documentation habits
- Effective tool integration
- Systematic problem-solving

## Quick Start (Illustrative)

```powershell
Initialize-KnowledgeRepository -Path "$env:USERPROFILE/.knowledge-index"
Set-IndexServerConnection -ConfigPath "config/mcp-connection.json"
p0-capture "Setup Complete" "Repository initialized" -Categories setup
p0-search "2025-09-13" # review prior day
Get-PromotionCandidates | ForEach-Object { p0-promote $_.ID -DryRun }
```

## Benefits Summary

- Personal: immediate capture, iterative quality, fast retrieval
- Team: reduced noise, validated value, lower maintenance burden
- Organization: scalable growth, reduced duplication, analytics insights

## Success Metrics (Examples)

- Time saved via reuse
- Growth in validated assets
- Reduction in duplicate incidents
- Faster onboarding velocity

## Governance & Change Control

- Amend via constitution process
- Maintain lineage reference in frontmatter
- Patch version for clarifications; minor for scope add; major for structural changes

## Risks & Mitigations

- Over-documentation (enforce scoring threshold)
- Premature promotion (require validation evidence)
- Stale knowledge (review period in config)

## Change Log

- 1.0.0 Initial specification extracted from provided lifecycle framework
