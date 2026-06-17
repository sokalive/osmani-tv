/**
 * Temporary production diagnostics for channel-card tap → navigation pipeline.
 * Prefix: [CHANNEL_CARD_TAP]
 */

const PREFIX = '[CHANNEL_CARD_TAP]';

/**
 * @param {string} event
 * @param {Record<string, unknown>} [detail]
 */
export function logChannelCardTap(event, detail = {}) {
  try {
    console.log(PREFIX, event, {
      at: Date.now(),
      ...detail,
    });
  } catch {
    /* ignore */
  }
}
