/** Once per JS runtime (app session): home expiry reminder must not repeat. */
let homeExpiryReminderConsumed = false;

export function isHomeExpiryReminderConsumed() {
  return homeExpiryReminderConsumed;
}

export function consumeHomeExpiryReminder() {
  homeExpiryReminderConsumed = true;
}
