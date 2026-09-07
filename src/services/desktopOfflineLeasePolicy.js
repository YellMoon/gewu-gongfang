// Only tolerate small differences in signed lease issue times. Never extend expiry.
const DESKTOP_OFFLINE_LEASE_CLOCK_SKEW_MS = 60 * 1000;

module.exports = { DESKTOP_OFFLINE_LEASE_CLOCK_SKEW_MS };
