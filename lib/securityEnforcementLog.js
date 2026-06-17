/**
 * Structured security enforcement diagnostics for allow/deny paths.
 */

/**
 * @param {{
 *   allowed: boolean;
 *   enforcementReason?: string | null;
 *   enforcementTrigger?: string | null;
 *   tag?: string;
 *   channelKey?: string;
 * }} input
 */
export function logSecurityEnforcement(input) {
  const line = {
    tag: input.tag ?? 'security-enforcement',
    allowed: input.allowed === true,
    enforcementReason: input.enforcementReason ?? null,
    enforcementTrigger: input.enforcementTrigger ?? null,
    ...(input.channelKey ? { channelKey: input.channelKey } : {}),
  };
  console.log('[security-enforcement]', JSON.stringify(line));
  return line;
}
