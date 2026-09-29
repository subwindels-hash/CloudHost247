# Backup architecture (spec §18)

- **On-server**: the server agent archives each deployment (volumes + logical DB dump) to
  `/opt/cloudhost247/backups/<project>-<timestamp>.tar.gz` with a SHA-256 checksum.
- **Off-server (required for scheduled backups)**: the control plane's backup job uploads
  archives to the configured S3-compatible target (`BACKUP_S3_*` env; AWS S3, Cloudflare R2,
  Wasabi, MinIO) and records the object path in `backups.storage_path` with
  `storage_provider = 's3' | 'r2'`. A server losing its disk still has every archive.
- **Retention**: `platform_settings.backup.retention_days` (admin-configurable, default 30);
  the worker's expiry sweep marks older backups `expired`.
- **Testing restores**: restore is a first-class deployment action (`POST
  /api/v1/app-installations/:id/restore`) with its own step pipeline and audit entry.
