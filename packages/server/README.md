# @ghost/server

Bun + Effect 4. Start with `bun run dev` (watch mode) or `bun run start`.

```
src/server.ts       wires every layer into the server (src/main.ts runs it)
src/config.ts       env vars, with defaults for a zero-config local run
src/db/             SQLite client, migrations, and the three repositories
src/bungie/         Bungie Platform client with OAuth token refresh
src/mcp/            the tools Claude can call, served as an MCP server at /mcp
src/agent/          Claude Agent SDK wrapper and the job runner fiber
src/api/            handlers for the HttpApi declared in @ghost/contract
```

Interactive API reference at `/docs`, OpenAPI at `/openapi.json`.

Environment variables are listed in `.env.example`. The Bungie values can stay
empty until you register an application at https://www.bungie.net/en/Application;
the health endpoint reports `bungieLinked: false` until the account is linked.
