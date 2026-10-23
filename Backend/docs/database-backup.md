# Database backup core

The reusable Phase 1 workflow is in `service/backup.service.js`. A caller must
provide an explicit MongoDB URI naming exactly one database; this service does
not read `MONGO_URI` or load dotenv. The same target is used to find every
Product image reference and to create the `mongodump` archive.

Backups are written under the current user's local application-data directory
by default, outside the project, upload, and static directories. Each operation
uses a unique temporary directory, validates its archive, copied images, and
SHA-256 manifest, then atomically renames that directory as a completed
artifact. Missing or unsafe referenced image files fail the operation; orphan
uploads are not included.

The target URI is written only to a short-lived tool configuration file inside
the operation's private temporary directory. Unix-like systems create it with
owner-only file permissions; on Windows it inherits the user-profile ACL. The
database tool receives the config path, not credentials in its process
arguments; this file is removed before publication and on failure cleanup.

Only one operation per service instance is allowed at a time. The default
service is a process-local singleton; separate Node.js processes or application
instances are not coordinated in this phase. The Windows backup directory
inherits the current user's profile ACL; Unix-like systems create operation
directories with owner-only permissions.

This phase does not provide an HTTP endpoint, scheduler, retention policy,
restore, or database-adoption procedure. The application's MongoDB version and
topology have not been established, so compatibility and backup consistency
for that deployment remain unverified.
