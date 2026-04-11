# Feature Specification Template

## Feature: [Feature Name]

### Summary
_One-paragraph description of what this feature does and why it matters._

### Problem Statement
_What problem does this solve? What is the current pain point?_

### Requirements
1. **[REQ-1]**: _Requirement description_
2. **[REQ-2]**: _Requirement description_
3. **[REQ-3]**: _Requirement description_

### Success Criteria
- [ ] _Criterion 1_
- [ ] _Criterion 2_
- [ ] _Criterion 3_

### Non-Goals
- _What this feature intentionally does NOT do_

### Technical Considerations
- **Handler Pattern**: New tools must use `registerHandler()` from `src/server/registry.ts`
- **Registry Integration**: Add to `INPUT_SCHEMAS`, `STABLE`/`MUTATION` set, `describeTool()`
- **Side-effect Import**: Register in `src/services/toolHandlers.ts`
- **Audit**: Mutation handlers must call `logAudit()`

### Dependencies
- _List dependent features, services, or infrastructure_

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| _Risk 1_ | _High/Med/Low_ | _Mitigation strategy_ |

### References
- Constitution: `constitution.json`
- Architecture: `docs/ARCHITECTURE.md`
- PRD: `docs/PROJECT_PRD.md`
