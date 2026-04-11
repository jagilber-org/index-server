# Task Breakdown Template

## Feature: [Feature Name]
**Plan Reference**: `specs/NNN-feature-name/plan.md`

### Tasks

#### 1. [Task Title]
- **Status**: Not Started | In Progress | Complete
- **Assignee**: _who_
- **Description**: _what to do_
- **Acceptance Criteria**:
  - [ ] _Criterion_
- **Files to touch**:
  - `src/services/handlers.<name>.ts` (create)
  - `src/services/toolRegistry.ts` (modify)
  - `src/services/toolHandlers.ts` (modify)

#### 2. [Task Title]
- **Status**: Not Started
- **Description**: _what to do_
- **Acceptance Criteria**:
  - [ ] _Criterion_

#### 3. Write Tests
- **Status**: Not Started
- **Description**: Create vitest test file covering handler
- **Acceptance Criteria**:
  - [ ] Error cases tested
  - [ ] Happy path tested
  - [ ] Edge cases tested
  - [ ] All tests pass (`npx vitest run`)

#### 4. Documentation
- **Status**: Not Started
- **Description**: Update TOOLS.md, CHANGELOG.md, bump version
- **Acceptance Criteria**:
  - [ ] Tool documented in docs/TOOLS.md
  - [ ] CHANGELOG.md updated
  - [ ] Version bumped in package.json

### Validation Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` has 0 errors
- [ ] `npx vitest run` all tests pass
- [ ] `git commit` with conventional commit message
