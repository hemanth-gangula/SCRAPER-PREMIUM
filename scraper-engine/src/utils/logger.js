/**
 * Minimal structured logger — writes to stdout as JSON lines.
 */

function log(level, message, extra = {}) {
  const entry = {
    ts:    new Date().toISOString(),
    level,
    msg:   message,
    ...extra,
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  info:  (msg, extra)  => log("INFO",  msg, extra),
  warn:  (msg, extra)  => log("WARN",  msg, extra),
  error: (msg, extra)  => log("ERROR", msg, extra),
  debug: (msg, extra)  => log("DEBUG", msg, extra),
};
