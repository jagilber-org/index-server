# Third-Party Licenses

This file documents the licenses of third-party dependencies included in or used by Index (`@jagilber-org/index-server`). Most dependencies use permissive licenses compatible with the MIT License under which this project is distributed. Dependencies with weak copyleft licenses (EPL-2.0, LGPL-3.0) are documented below with full attribution.

---

## Production Dependencies

### @huggingface/transformers

- **License:** Apache License 2.0
- **Repository:** https://github.com/huggingface/transformers.js
- **Usage:** Optional local ML inference for semantic search (embedding generation)
- **Note:** Disabled by default (`INDEX_SERVER_SEMANTIC_ENABLED=0`). When enabled, all inference runs locally on-device.

> Licensed under the Apache License, Version 2.0 (the "License");
> you may not use this file except in compliance with the License.
> You may obtain a copy of the License at
>
>     http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS,
> WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
> See the License for the specific language governing permissions and
> limitations under the License.

### @modelcontextprotocol/sdk

- **License:** MIT
- **Repository:** https://github.com/modelcontextprotocol/typescript-sdk

### @mermaid-js/layout-elk

- **License:** MIT
- **Repository:** https://github.com/mermaid-js/layout-elk

### adm-zip

- **License:** MIT
- **Repository:** https://github.com/cthackers/adm-zip
- **Usage:** ZIP file creation and extraction for backup/restore operations

### ajv / ajv-formats

- **License:** MIT
- **Repository:** https://github.com/ajv-validator/ajv

### express

- **License:** MIT
- **Repository:** https://github.com/expressjs/express

### ws

- **License:** MIT
- **Repository:** https://github.com/websockets/ws

### zod

- **License:** MIT
- **Repository:** https://github.com/colinhacks/zod

---

## Transitive Dependencies with Non-MIT Licenses

### elkjs (via @mermaid-js/layout-elk)

- **License:** Eclipse Public License 2.0 (EPL-2.0)
- **Version:** 0.9.3
- **Repository:** https://github.com/kieler/elkjs
- **Source Code:** https://github.com/kieler/elkjs
- **Usage:** Graph layout algorithm for mermaid diagram rendering in the admin dashboard
- **Note:** EPL-2.0 is a weak copyleft license, OSI-approved. This dependency is used for dashboard visualization only. Source code is available at the repository link above per EPL-2.0 Section 3.2.

> This program and the accompanying materials are made available under the
> terms of the Eclipse Public License 2.0 which is available at
> https://www.eclipse.org/legal/epl-2.0/

### sharp (via @huggingface/transformers)

- **License:** Apache-2.0 (JavaScript wrapper); native binaries include LGPL-3.0-or-later components (libvips)
- **Version:** 0.34.5
- **Repository:** https://github.com/lovell/sharp
- **Usage:** Transitive dependency for image processing (used by @huggingface/transformers for semantic search)
- **Note:** The LGPL-3.0 applies only to the dynamically-linked native image processing libraries (libvips and its dependencies). The JavaScript wrapper is Apache-2.0. LGPL permits dynamic linking without copyleft propagation. This dependency is optional — it is only present when `INDEX_SERVER_SEMANTIC_ENABLED=1`.

> Licensed under the Apache License, Version 2.0.
> Native components licensed under LGPL-3.0-or-later.
> See https://github.com/lovell/sharp/blob/main/LICENSE for full details.

### chevrotain (via mermaid)

- **License:** Apache License 2.0
- **Repository:** https://github.com/Chevrotain/chevrotain
- **Usage:** Parsing DSL used by mermaid for diagram syntax parsing

> Licensed under the Apache License, Version 2.0.

### dompurify (via mermaid)

- **License:** (MPL-2.0 OR Apache-2.0) — dual licensed; Apache-2.0 chosen
- **Repository:** https://github.com/cure53/DOMPurify
- **Usage:** DOM sanitizer used by mermaid for XSS prevention

> Licensed under the Apache License, Version 2.0 (chosen from dual-license).

### flatbuffers (via @huggingface/transformers)

- **License:** Apache License 2.0
- **Repository:** https://github.com/google/flatbuffers
- **Usage:** Serialization library used by @huggingface/transformers for model loading

> Licensed under the Apache License, Version 2.0.

---

## Bundled Client-Side Libraries

The following libraries are vendored (copied) into `src/dashboard/client/js/` for the admin dashboard. Each file retains its original license header.

### Chart.js

- **File:** `chart.umd.js`
- **Version:** 4.4.0
- **License:** MIT
- **Repository:** https://github.com/chartjs/Chart.js

### marked

- **File:** `marked.umd.js`
- **Version:** 17.0.6
- **License:** MIT
- **Repository:** https://github.com/markedjs/marked

### mermaid

- **File:** `mermaid.min.js`
- **License:** MIT
- **Repository:** https://github.com/mermaid-js/mermaid
- **Note:** The bundled file contains embedded sub-license headers for DOMPurify, js-yaml, and lodash.

### elkjs (ELK)

- **File:** `elk.bundled.js`
- **Version:** 0.9.3
- **License:** Eclipse Public License 2.0 (EPL-2.0)
- **Repository:** https://github.com/kieler/elkjs
- **Source Code:** https://github.com/kieler/elkjs
- **Note:** This file is distributed under EPL-2.0. Source code is available at the repository link above.

> This program and the accompanying materials are made available under the
> terms of the Eclipse Public License 2.0 which is available at
> https://www.eclipse.org/legal/epl-2.0/

---

## Development Dependencies (not distributed)

The following dependencies are used during development and testing only. They are NOT included in the published npm package or VS Code extension (unless bundled via `-IncludeServer`).

### typescript

- **License:** Apache License 2.0
- **Repository:** https://github.com/microsoft/TypeScript

> Licensed under the Apache License, Version 2.0.

### @playwright/test

- **License:** Apache License 2.0
- **Repository:** https://github.com/microsoft/playwright

> Licensed under the Apache License, Version 2.0.

### @typescript-eslint/parser

- **License:** BSD-2-Clause
- **Repository:** https://github.com/typescript-eslint/typescript-eslint

### All other development dependencies

- **License:** MIT
- eslint, prettier, vitest, @vitest/coverage-v8, cross-env, fast-check, ts-node, @types/node, @types/express, @types/ws

---

## License Compatibility

All dependencies use licenses that are compatible with this project's MIT License for distribution purposes. Two dependencies use weak copyleft licenses (EPL-2.0, LGPL-3.0) which are compatible when properly attributed.

| License | Compatible with MIT? | Dependencies |
|---------|---------------------|-------------|
| MIT | ✅ Yes | Majority of dependencies |
| Apache-2.0 | ✅ Yes | @huggingface/transformers, typescript, @playwright/test, chevrotain, flatbuffers, sharp (JS wrapper) |
| BSD-2-Clause | ✅ Yes | @typescript-eslint/parser |
| EPL-2.0 | ⚠️ Conditionally | elkjs (weak copyleft — OK with attribution; see above) |
| LGPL-3.0 | ⚠️ Conditionally | sharp native binaries/libvips (dynamically linked — OK per LGPL terms) |
| (MPL-2.0 OR Apache-2.0) | ✅ Yes | dompurify (Apache-2.0 chosen) |

---

## Bundled Extension Note

If the VS Code extension is built with `-IncludeServer` (standalone mode), the production dependencies listed above are bundled into the `.vsix` file. In that case, this `THIRD-PARTY-LICENSES.md` file serves as the required attribution notice for Apache-2.0 licensed dependencies.

---

*Last updated: 2026-04-09*
