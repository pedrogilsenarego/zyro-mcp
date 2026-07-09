/**
 * Per-request context handed to every tool module. Both values are resolved
 * from the validated OAuth token — never from tool arguments.
 */
export interface ToolDeps {
  /** The caller's imocerto JWT. */
  getAccessToken: () => string | undefined;
  /** The caller's user id, extracted from the JWT. */
  getUserId: () => string | undefined;
}
