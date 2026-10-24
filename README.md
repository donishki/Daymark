# Daymark

A self-hosted, multi-user diary for days, places, people, and ideas.

Daymark combines Markdown journaling, photos and media, maps, calendar and timeline views, search, sharing, account exports, and administration. It includes password authentication, TOTP, passkeys, and an installable web app.

## Run with Docker

1. Copy `.env.example` to `.env`.
2. Set three different strong random secrets in `.env`.
3. Run `docker compose up -d --build`.
4. Open `http://localhost:3000` and create your first account.

The first account becomes administrator. The included Mailpit development inbox is available on port 8025. Configure production email and HTTPS before making an installation available online; set `COOKIE_SECURE` to `true` behind HTTPS.

PostgreSQL, media storage, mail, and backups use Compose-project-scoped volumes. Use a distinct project name for every installation. Never point a test or public instance at another installation's database or volumes.

`docker-compose.standalone.yml` is an equivalent portable configuration. See [deployment instructions](DEPLOYMENT.md).

## Development

Use Node.js 22 or later. Run `npm ci` and `npm run build` to build the frontend. `npm run dev` starts Vite; the backend requires the database and storage configuration supplied by Docker Compose.

## Repositories

- [GitHub](https://github.com/donishki/Daymark)
- [Gitea](https://git.ptbox.org/dasp/Daymark)

This public edition starts with clean source history. Personal deployment configuration and diary contents are excluded. Database and media content live in deployment volumes, not this source repository.

Legacy storage keys and export identifiers are retained for compatibility with existing backups.

## License

No open-source license has been selected. All rights reserved until a license is added.
