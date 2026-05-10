/**
 * Bottom tab bar geometry — single source of truth for OsmaniLovableTabBar height
 * and scroll/list bottom padding so catalog + account screens stay aligned.
 */

/** Compact row (icons + labels); paired with OsmaniLovableTabBar padding. */
export const LOVABLE_TAB_CONTENT_HEIGHT = 51;
export const CONTENT_ABOVE_TAB_GAP = 32;

export function getTabBarTotalHeight(insets) {
  const bottom = typeof insets?.bottom === 'number' ? insets.bottom : 0;
  return LOVABLE_TAB_CONTENT_HEIGHT + bottom;
}

export function getScrollContentBottomPadding(insets) {
  const reserved = getTabBarTotalHeight(insets) + CONTENT_ABOVE_TAB_GAP;
  return Math.max(120, reserved);
}
