# Application logging

The application uses the Winston logger in `utilities/logger.js`. Structured
JSON records are written to daily rotating files under `logs/` by default.
Set `MEAN_L2_LOG_DIR` to use a different writable directory:

- `combined.log.YYYY-MM-DD` receives all configured application levels.
- `error.log.YYYY-MM-DD` receives errors only.

Files rotate daily and at 20 MB per segment. Size-triggered segments receive a
numbered suffix; rotated files are compressed. The 14-day retention limit is
configured on both file transports. The tests exercise size rollover and
compression, but do not simulate retention expiry. The dated filenames are
intentional; the logger does not maintain a stable undated filename.

The log directory is created when the logger initializes and must be writable
and persistent for local file logging to be durable. `logs/` is excluded from
version control. Deployments with ephemeral filesystems or multiple application
instances should forward logs to a centralized logging service.

In development, the console shows readable HTTP-level and higher messages. In
production, it shows warnings and errors only. Request records include an
internally generated request ID, method, route template, final status, and
duration; query strings, bodies, and headers are not recorded. A sanitizer runs
before transport formatting, including console output. It redacts sensitive
metadata keys and recognizable database URIs, bearer credentials, JWTs,
credential formats, and labeled secret values. Nested metadata and error causes
are sanitized with cycle, depth, collection, and string-size bounds.

Redaction is pattern-based and cannot identify every arbitrary secret in
unlabeled text, so callers must not log credentials, request bodies, or
unrestricted user-controlled content.
