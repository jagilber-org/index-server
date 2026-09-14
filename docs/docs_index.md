# Documentation Index

<!-- GENERATED FILE — do not edit by hand.
     Source: `git ls-files` + each document's own first heading and first prose line.
     Regenerate: `npm run docs:index`   Verify: `npm run guard:docs` -->

Every tracked Markdown document in `docs/`, `specs/` and the repository root, with the title and
summary each file gives itself. `npm run guard:docs` fails CI when a link here does not resolve
(case-sensitively) or when a document under `docs/` is linked from neither this index nor
[README.md](../README.md).

Documents indexed: 88.

## Repository Root

| Document | Summary |
|----------|---------|
| [Changelog](../CHANGELOG.md) | All notable changes to this project will be documented in this file. |
| [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md) | We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body… |
| [Index Server - COMPREHENSIVE CODE & SECURITY REVIEW](../CODE_SECURITY_REVIEW.md) | Repository: <root>\index-server License: MIT \| Node.js: engines in package.json (currently >=22) |
| [Contributing](../CONTRIBUTING.md) | Thanks for your interest in contributing. |
| [Privacy Policy](../PRIVACY.md) | Effective Date: 2025-06-15 Last Updated: 2026-04-25 Project: Index (@jagilber-org/index-server) License: MIT |
| [Index Server](../README.md) | Governed knowledge base for AI agents via the Model Context Protocol (MCP). |
| [Security Policy](../SECURITY.md) | Do NOT open public issues for security vulnerabilities. |
| [Third-Party Licenses](../THIRD-PARTY-LICENSES.md) | This file documents the licenses of third-party dependencies included in or used by Index (@jagilber-org/index-server). |
| [Index Constitution](../constitution.md) | Version: 2.11.0 Ratified: 2026-02-16 |

## Architecture & Design

| Document | Summary |
|----------|---------|
| [ARCHITECTURE](architecture.md) | Updated for 1.24.0 (adds: IEmbeddingStore abstraction with sqlite-vec KNN backend, device probe fallback chain, model readiness checks, structured logging… |
| [Graph Export Reference](graph.md) | graphexport exposes the instruction relationship graph for MCP clients, agents, and the dashboard. |
| [Index Manifest & Materialization Architecture](manifest.md) | Version: 1.0 (Introduced 1.4.x) |
| [Index: Leader/Follower Architecture Spec](mcp-index-leader-follower-spec.md) | A single user running 10+ VS Code Insiders instances, each configured with Index, spawns 10+ independent Node.js processes. |
| [Multi-Instance Design: Standalone & Leader/Follower Modes](multi_instance_design.md) | the index supports two operational modes for multi-instance environments where many VS Code windows, Copilot Chat sessions, or Squad agents each spawn their… |

## API & Tools

| Document | Summary |
|----------|---------|
| [Generated Tool Registry](TOOLS-GENERATED.md) | Registry Version: 2026-06-01 |
| [Index Server Client Scripts](client_scripts.md) | REST client scripts for agents and users that lack MCP tool access. |
| [Knowledge Store REST API](knowledge_api_spec.md) | Status: implemented and shipping. |
| [Messaging System](messaging.md) | Inter-agent messaging for the MCP Index Server. |
| [Index - Tools API Reference](tools.md) | Protocol: Model Context Protocol (MCP) v1.0+ Transport: JSON-RPC 2.0 over stdio, REST bridge via dashboard HTTP(S) Server version: see package.json — this… |

## Configuration

| Document | Summary |
|----------|---------|
| [Configuration Guide](configuration.md) | Complete configuration and deployment reference for Index. |
| [Index Configuration Guide](mcp_configuration.md) | Version: 1.0.0 Last Updated: August 28, 2025 Compliance: MCP Protocol v1.0+ |
| [Network Privacy & Verification Guide](network-privacy.md) | Complete reference for Index outbound network behavior, embedded AI components, and how to verify the server makes no unwanted connections. |
| [Runtime Configuration Migration Map](runtime_config_mapping.md) | This document captures the proposed shape for expanding runtimeConfig so the remaining process.env reads in runtime code can be consolidated behind a single… |
| [vscode_mcp.md](vscode_mcp.md) | — |

## Guides & Integration

| Document | Summary |
|----------|---------|
| [Agent Graph Utilization Guide (v1)](agent_graph_instructions.md) | Purpose: Enable MCP-compatible agents (GPT-5, Claude, etc.) to leverage the index graph for high-relevance instruction retrieval, reasoning, and maintenance… |
| [Copilot CLI quick setup guide](copilot-cli-quick-setup-guide.md) | A walkthrough for getting the GitHub Copilot CLI running with the index-server MCP wired in. |
| [GPT-5 MCP Server Connection Guide](gpt5_mcp_connection_guide.md) | Problem: GPT-5 can't find or connect to the index Solution: Use the exact server name and proper MCP syntax |
| [MCP Testing Knowledge Base](gpt5_mcp_testing_kb.md) | LOCATION: src/tests/helpers/mcpTestClient.ts PURPOSE: Programmatic MCP server testing using @modelcontextprotocol/sdk STATUS: Stable, replaces the former… |
| [Index Server — Interactive Setup Walkthrough](interactive_setup_walkthrough.md) | End-to-end walkthrough of the bundled configuration wizard, from npx launch through dashboard verification. |
| [MCP Stdio Logging — Fixing `\[warning\] \[server stderr\]` in VS Code](mcp_stdio_logging.md) | VS Code's MCP host hardcodes all stderr output as LogLevel.Warning with the prefix [server stderr]. |
| [PowerShell MCP Server Usage Guide](powershell_mcp_guide.md) | This guide demonstrates how to use the PowerShell MCP Server (run-powershell tool) safely with timeout protection and file logging for Index operations. |
| [Quick Start Guide](quickstart.md) | Get Index Server running with HTTPS and semantic search in 5 minutes. |

## Knowledge & Governance

| Document | Summary |
|----------|---------|
| [Index Content Guidance](content_guidance.md) | Version: 1.1.0 Owner: AI Engineering Team Last Updated: February 3, 2026 Next Review: May 3, 2026 |
| [Feedback → Defect → Red/Green → Fix → Coverage Lifecycle](feedback_defect_lifecycle.md) | Date: 2025-08-30 Current package version: 1.0.7 Current instruction schemaVersion: 2 (no change in this cycle) |
| [Index Normalization & Migration Reference](index_normalization.md) | Version: 1.0.0 Applies to: schemaVersion v3+ (server version >= 1.5.0) Status: Authoritative specification for always-on ingestion normalization. |
| [Index Quality Gates](index_quality_gates.md) | This document defines enforceable quality gates for the instruction index and the remediation / salvage rules that keep acceptance rates high while… |
| [Lifecycle Hooks](lifecycle-hooks.md) | Lifecycle hooks let an operator run a trusted local command after Index Server commits an instruction mutation. |
| [Prompt Interpretation & Optimization Guide](prompt_optimization.md) | Version: 1.0.0 Owner: AI Engineering Team Last Updated: August 28, 2025 Next Review: November 28, 2025 |
| [Use Case Scenarios](use-cases.md) | Real-world examples showing how Index Server provides value as a central, persistent knowledge source for AI agents across repos and sessions. |

## Operations & Security

| Document | Summary |
|----------|---------|
| [Admin Dashboard Guide](dashboard.md) | - Overview - Dashboard Panels - Enabling the Dashboard - Core Panels - System Health Card - instruction index - Instruction Editor - Live Log Tail -… |
| [MetricsCollector File Storage Configuration](metrics_file_storage.md) | The MetricsCollector now supports file-based storage to prevent memory accumulation while preserving historical data. |
| [Runtime Diagnostics & Global Error Handling](runtime_diagnostics.md) | This document describes the unified runtime diagnostics guard added in version 1.1.4. |
| [Security & Governance Guards](security_guards.md) | - Prevent accidental commit of secrets, PII, large artifacts. |
| [Tracing & Diagnostics Guide](tracing.md) | Enhanced tracing provides deterministic, low‑overhead insight into Index CRUD, handshake, and test cross‑validation flows. |

## Testing & Quality

| Document | Summary |
|----------|---------|
| [MCP Search Benchmark Results](benchmark-results.md) | Date: 2026-03-02 22:31:24 Device: cuda Total Duration: 26.83s Total Queries: 30 GPU: NVIDIA GeForce RTX 3090 OS: Microsoft Windows 11 Pro N |
| [Mandatory PR Review Checklist — AI Agent-Generated Code & Tests](pr_review_checklist.md) | AI agents (GitHub Copilot, squad agents, other LLM-based tooling) have repeatedly introduced defective code and tests that passed CI but delivered no real… |
| [Stress Testing](stress-testing.md) | This guide covers the two PowerShell stress test scripts for Index Server and how to run them locally or in CI. |
| [Test Artifact Management Guide](testing.md) | This document explains how test artifacts are managed in the index-server project. |
| [Testing Strategy](testing_strategy.md) | This document describes the layered test approach to continuously expand coverage without exploding maintenance cost. |

## Release & Deployment

| Document | Summary |
|----------|---------|
| [`--init-cert`: Bootstrap a Self-Signed TLS Certificate](cert_init.md) | --init-cert is a built-in CLI switch on index-server that generates a self-signed TLS certificate + key suitable for the admin dashboard. |
| [Index Deployment & Troubleshooting Guide](deployment.md) | --- ## 1. |
| [Docker Deployment Guide](docker_deployment.md) | Index Server ships with a production-hardened Docker image featuring: - Multi-stage build — compile-time tools excluded from runtime image - Non-root… |
| [Migration & Verification Guide](migration.md) | Version: 0.7.0 (updated with schema v4 notes – 2026-02-16) |
| [Publishing to Public Repository](publishing.md) | This project uses a dual-repo pattern: an internal development repository for all development, and a public mirror (jagilber-org/index-server) as a… |
| [Release Checklist](release-checklist.md) | Use this checklist before every versioned release of index-server. |
| [Versioning & Release Strategy](versioning.md) | This project follows Semantic Versioning (SemVer): MAJOR.MINOR.PATCH |

## Dashboard Panels

| Document | Summary |
|----------|---------|
| [Configuration Panel](panels/config.md) | The dashboard Configuration tab is the registry-driven view of Index Server runtime settings. |
| [Graph Panel](panels/graph.md) | The Graph panel visualizes relationships between instructions in the index. |
| [Instructions Panel](panels/instructions.md) | The Instructions panel provides a management interface for the instruction index. |
| [Lifecycle Hooks](panels/lifecycle-hooks.md) | Lifecycle hooks run trusted local commands after Index Server durably commits an instruction mutation. |
| [Maintenance Panel](panels/maintenance.md) | The Maintenance panel provides system operations and backup/restore controls. |
| [Monitoring Panel](panels/monitoring.md) | The Monitoring panel provides real-time observability into server operations. |
| [Overview Panel](panels/overview.md) | The Overview panel is the first operational readout for the Index Server admin dashboard. |
| [Sessions Panel](panels/sessions.md) | The Sessions panel monitors active connections and session history. |

## Planning & Review

| Document | Summary |
|----------|---------|
| [PR330-REMEDIATION.md](PR330-REMEDIATION.md) | — |
| [Design review and action plan — 2026-09-01](design_review_action_plan_2026-09.md) | The core is sound: stdout is protocol-clean, config reads are concentrated in src/config, search scoring is pure over an internal params type, the storage… |
| [MCP Marketplace Migration — Status Tracker](mcp_migration_tracker.md) | The migration is mid-Stage 1, nearing Stage 2 readiness. |
| [Index Project Requirements Document (PRD)](project_prd.md) | Version: 1.8.1 (Supersedes 1.4.2; incorporates ToolTier system, dispatcher flat-param assembly, schema completeness, constitution Q-7/Q-8) Status: Binding -… |

## Specifications

| Document | Summary |
|----------|---------|
| [Bootstrapper Specification (P1)](../specs/000-bootstrapper.md) | Provide the minimal shared foundation so local (P0) knowledge capture can mature independently while defining the contract for later lifecycle expansion specs. |
| [Knowledge Index Lifecycle (P1)](../specs/001-knowledge-index-lifecycle.md) | A comprehensive knowledge management lifecycle expanding the bootstrapper specification. |
| [002 – Tool Surface Consolidation & Flag-Gating](../specs/002-tool-consolidation.md) | Category: governance Status: draft Priority: P1 Author: copilot Date: 2025-08-28 |
| [Index: Leader/Follower Architecture Spec](../specs/003-leader-follower-election.md) | A single user running 10+ VS Code Insiders instances, each configured with Index, spawns 10+ independent Node.js processes. |
| [Feature: SQLite Storage Backend](../specs/004-sqlite-storage-backend/spec.md) | Add an experimental SQLite storage backend for the instruction index, sitting behind a feature flag (INDEXSERVERSTORAGEBACKEND=sqlite). |
| [Task Breakdown: SQLite Storage Backend](../specs/004-sqlite-storage-backend/tasks.md) | - Status: Not Started - Assignee: TBD - Files: src/services/storage/types.ts - Acceptance: - [ ] Interface with JSDoc for all methods - [ ] Types for query… |
| [Drift Review: Index-Server vs Template-Repo](../specs/005-template-conformance-enrichment-review/review.md) | Current comparison baseline: |
| [Feature: Template Conformance And Enrichment Review](../specs/005-template-conformance-enrichment-review/spec.md) | Perform a deep, evidence-based review of jagilber-dev/index-server against jagilber/template-repo now that the template repo is the canonical parent. |
| [Draft Template-Repo Enrichment Issues](../specs/005-template-conformance-enrichment-review/template-repo-issues.md) | These are draft issues to create in jagilber/template-repo after the review is approved. |
| [Feature Specification](../specs/006-archive-lifecycle/spec.md) | Introduce a non-destructive archive lifecycle for instruction records that works equivalently across the JSON and SQLite storage backends. |
| [Task Breakdown: Archive Lifecycle for Instruction Storage](../specs/006-archive-lifecycle/tasks.md) | Each task is sized to land in a single PR. |
| [Spec 107 — MCP marketplace migration](../specs/107-mcp-marketplace-migration.md) | Issue: #107 Branch: docs/107-marketplace-migration Status: Stage 1 complete; Stage 2 partially complete; gallery validation and release-path automation… |
| [Issue #109 — Build Verify Failure Triage](../specs/109-build-verify-triage.md) | Date: 2026-04-26 Branch: main @ 08945cd (1 commit ahead of origin/main) Author: Tank 🧪 Scope: Triage only. |
| [Spec 111 — Feedback MCP rip-down to `feedback_submit` only](../specs/111-feedback-mcp-rip-down.md) | Issue: #111 Branch: refactor/111-feedback-mcp-to-dashboard Status: implementation complete (delivered in PR #191); this spec captures the contract and lands… |
| [Spec 138 — Handshake Manager Decomposition](../specs/138-handshake-decomposition.md) | Issue: #138 Branch: refactor/138-handshake-decomposition Status: complete Owner: Morpheus 🏗️ (squad architecture) Type: behavior-preserving refactor (no… |
| [Feature Specification](../specs/511-instruction-links/spec.md) | Add an optional links array field to the instruction schema, enabling machine-readable cross-references between instruction entries. |
| [Specification Categories Summary](../specs/CATEGORIES.md) | Authoritative source: ../memory/constitution.md (this file is a navigational aid). |

## Migration Notes

| Document | Summary |
|----------|---------|
| [Migration: Dashboard Configuration API v2 (#359)](migration/dashboard-config-v2.md) | The dashboard Configuration tab moved from a hand-rolled envelope to a registry-driven flag surface. |

## Triage Records

| Document | Summary |
|----------|---------|
| [Security alert triage — #352](triage/issue-352-security-alerts.md) | Status: triage plan only. |
| [Security alert triage — #451](triage/issue-451-security-alerts.md) | Status: reconciliation in progress. |
