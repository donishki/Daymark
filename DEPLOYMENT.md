# Daymark deployment

Copy `.env.example` to `.env` and fill in all three secret values. Keep `.env` private and backed up securely. Losing the authentication encryption key can make protected authentication data unreadable.

Start with `docker compose up -d --build`. Inspect with `docker compose ps` and `docker compose logs -f diary`. The app listens on port 3000; the development mail inbox listens on port 8025.

For Portainer, use this repository and docker-compose.yml, and provide DB_PASSWORD, MINIO_PASSWORD, and AUTH_ENCRYPTION_KEY as stack environment variables. Configure a reverse proxy for HTTPS and set COOKIE_SECURE=true. Configure appropriate production SMTP delivery before relying on account emails.

## Independent installations

The default Compose project is daymark. To create a separate installation, use `docker compose -p another-name up -d --build` and choose different published ports. Compose scopes all volume and network names by the project. Do not reuse an existing personal deployment's database or media volumes.

## Backups

The backup service writes database dumps and media archives every 24 hours and retains 14 days. Copy these off the server regularly and test restoration. The admin dashboard also supports backup management.

Use `docker compose exec backup ls -lh /backups` to inspect backups. `docker compose cp backup:/backups ./backups` copies them locally. Backups contain private data and must not be committed to Git.

`docker compose down` preserves named volumes. Adding `-v` deletes persistent data.

To migrate an existing diary, arrange a maintenance window, back up the database and media together, preserve authentication keys, and restore into explicitly selected new volumes. Source code alone does not contain diary entries or uploaded media. Do not change a live personal deployment's project name or volumes as part of a source-folder rename.
