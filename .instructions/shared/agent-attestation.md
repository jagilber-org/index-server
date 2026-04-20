# Agent Attestation And Provenance Metadata

Use this guidance when agents author commits, decision records, or other tracked artifacts in repositories aligned to this template.

## Purpose

Agent attestation provides a verifiable chain of accountability for machine-authored changes. It answers: which agent acted, under whose authority, guided by what instructions, and within what scope.

## Limitations and Trust Model

> **Important**: Agent attestation trailers are **self-asserted metadata** for audit and traceability purposes. They are **not** cryptographic proof of identity or authorization.

- **Trailers are advisory**: Any process with commit access can write or omit trailers. They establish a *convention*, not a *guarantee*.
- **trustLevel and allowedScopes are advisory**: These fields express *intended* policy. They are not enforced at the Git layer. Violations are detected during review, not prevented at commit time.
- **Signed commits recommended**: For stronger provenance assurance, pair attestation trailers with [GPG or SSH commit signing](https://docs.github.com/en/authentication/managing-commit-signature-verification). Signed commits bind the trailer content to a verified identity.
- **Defense in depth**: Attestation is one layer in a multi-layer model that includes CODEOWNERS, branch protection, required reviewers, and CI validation. No single layer is sufficient alone.
- **Forgery risk**: A malicious or misconfigured agent could emit false trailers. The `validate-agent-trailers.ps1` commit-msg hook warns on missing trailers but cannot prevent forgery. Review processes remain the ultimate gatekeeper.

## Agent Charter Schema

Agent charters live in `.squad/agents/<name>.json` using the schema defined in `.squad/templates/agent-charter.json`.

### Required Provenance Fields

| Field | Type | Description |
|---|---|---|
| `trustLevel` | `"restricted"` \| `"standard"` \| `"elevated"` | Governs what the agent may do without human approval. **Advisory only**; see Limitations above. |
| `attestation` | `boolean` | When `true`, the agent must include provenance metadata in commits and decision records. |
| `allowedScopes` | `string[]` | Glob patterns or path prefixes the agent is authorized to modify. **Advisory only**; see Limitations above. |

### Trust Levels

- **restricted**: Read-only or advisory. Agent may analyze and recommend but not commit changes.
- **standard**: Agent may propose and commit changes within `allowedScopes`. Requires human review before merge.
- **elevated**: Agent may auto-merge or deploy within `allowedScopes` when pre-authorized by a human. Use sparingly.

### Delegation Policy

- **none**: Agent does not delegate to sub-agents.
- **same-trust**: May delegate to agents at the same or lower trust level.
- **restricted-only**: May only delegate to `restricted`-tier agents.

## Commit Provenance Trailers

Agent-authored commits must include structured trailers. Use `scripts/append-agent-provenance.ps1` or add trailers manually:

```
Agent: <agent-name>
Agent-Model: <model-identifier>
Agent-Trust-Level: <restricted|standard|elevated>
Instruction-Hash: <sha256-hash-of-guiding-instruction>
Authorized-By: <human-authorizer>
```

The `Instruction-Hash` field is **required**. When the guiding instruction hash is unknown, use the placeholder `sha256:none` and supply the real hash before final merge.

### Example

```
feat: update PII scanner allowlist for schema URLs

Adds narrow allowlist entries for JSON Schema $id URLs that triggered
false positives in check-pii.ps1.

Agent: security-reviewer
Agent-Model: copilot-gpt-4
Agent-Trust-Level: standard
Instruction-Hash: sha256:e3b0c44298fc1c149afbf4c8996fb924
Authorized-By: alice@example.com
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com> # pii-allowlist
```

## Decision Record Provenance

Decision records in `.squad/decisions/` must include a `provenance` object when authored by an agent. See `.squad/templates/decision-record.json` for the schema.

Required fields:
- `agent`: Name of the authoring agent
- `authorizedBy`: Human who authorized the action
- `instructionHash`: SHA-256 of the guiding instruction or spec (use `sha256:none` as placeholder when unknown)

Optional but recommended:
- `model`: Agent model or version
- `delegationChain`: Ordered list of agents involved in delegation
- `timestamp`: ISO 8601 creation time

## Validation

- Constitution rule AG-4 requires attestation metadata for agent-authored changes.
- The `scripts/append-agent-provenance.ps1` helper generates well-formed trailers.
- The `hooks/validate-agent-trailers.ps1` commit-msg hook warns when agent-pattern commits lack required trailers.
- Review processes should verify that agent commits include the required trailers and that `allowedScopes` were respected.

## Enforcement Roadmap

<!-- TODO: Future enforcement hook phases -->
- **Phase 1 (current)**: Advisory commit-msg hook warns on missing trailers. CODEOWNERS protects `.squad/agents/`.
- **Phase 2 (planned)**: CI check that blocks PRs containing agent commits without valid trailer sets.
- **Phase 3 (planned)**: Signed-commit verification integrated with attestation validation.

## Governance

Changes to agent trust levels or allowed scopes require the same review rigor as constitution amendments. Record trust-level changes in decision records with full provenance.
