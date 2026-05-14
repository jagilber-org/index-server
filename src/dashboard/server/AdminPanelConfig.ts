/**
 * AdminPanelConfig — Session timing configuration for the admin panel.
 *
 * Historical note (#359, plan §2.6 T6 / clean break):
 *  Pre-1.29 this module owned `serverSettings`, `indexSettings`, and
 *  `securitySettings` envelopes that mirrored a subset of runtime config.
 *  Those structures duplicated the flag registry surfaced through
 *  `/api/admin/config` and `dashboard_config`, so they were removed in
 *  favor of the single source of truth. The only piece worth preserving
 *  was `sessionTimeout` (consumed by AdminPanelState for session expiry),
 *  which now lives on `SessionTimingConfig`.
 *
 * For runtime flag CRUD, see:
 *   - GET/POST /api/admin/config  (src/dashboard/server/routes/admin.routes.ts)
 *   - src/services/handlers.dashboardConfig.ts (FLAG_REGISTRY)
 *   - src/services/configValidation.ts (validateFlagUpdate)
 *   - src/config/runtimeOverrides.ts (overlay persistence)
 */

/**
 * Session timing knobs consumed by AdminPanelState. Intentionally minimal —
 * NOT a place to re-introduce duplicate envelopes. Add new fields here only
 * when they belong to session lifetime, not to general server configuration.
 */
export interface SessionTimingConfig {
  /** Inactivity timeout for admin sessions, in milliseconds. */
  sessionTimeout: number;
}

/**
 * Legacy export retained as an empty alias so type-only consumers that still
 * import `AdminConfig` do not break the build. The T6 compile-time guard in
 * adminConfigRoute.spec.ts asserts the legacy keys are gone via
 * `'indexSettings' extends keyof AdminConfig` style checks; both work on `{}`.
 *
 * Marked deprecated to discourage new usage.
 *
 * @deprecated Use `SessionTimingConfig` for session knobs, or query
 *   `/api/admin/config` for runtime flag values.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AdminConfig = {};

const DEFAULT_SESSION_TIMEOUT_MS = 3600000;

export class AdminPanelConfig {
  private timing: SessionTimingConfig;

  constructor() {
    this.timing = { sessionTimeout: DEFAULT_SESSION_TIMEOUT_MS };
  }

  /** Session timeout in milliseconds — consumed by AdminPanelState. */
  get sessionTimeout(): number {
    return this.timing.sessionTimeout;
  }
}
