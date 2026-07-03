# MCP server — Claude Desktop / Claude Code setup

The same four tools the chat spine uses (`search_locations`,
`get_location_details`, `aggregate_metrics`, `compare_locations`) exposed
over the Model Context Protocol via stdio (ADR-0008). One implementation,
two transports: the in-process tool loop and this server both consume
`getToolSpecs()` + `runTool()` from `src/lib/mcp/tools.ts`.

## Prerequisites

- Repo cloned, `pnpm install` run
- `.env.local` at the repo root with `DATABASE_URL` set (the server reads
  it relative to the script file, so clients may launch it from any
  working directory)

Quick smoke test from a terminal:

```sh
pnpm mcp
# → "venue-insights MCP server listening on stdio (4 tools)" on stderr
# Ctrl+C to exit; or inspect interactively:
npx -y @modelcontextprotocol/inspector npx -y tsx <ABSOLUTE_PATH_TO_REPO>/scripts/mcp-server.ts
```

## Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
then fully restart Claude Desktop:

```json
{
  "mcpServers": {
    "venue-insights": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "tsx",
        "C:\\ABSOLUTE\\PATH\\TO\\venue-insights-platform\\scripts\\mcp-server.ts"
      ]
    }
  }
}
```

> **Windows note:** Desktop spawns processes without a shell, and `npx` is
> `npx.cmd` on Windows — the `cmd /c` wrapper is required. On macOS/Linux
> drop `"command": "cmd"` / `"/c"` and use `"command": "npx"` directly.

The tools appear under the 🔌 icon; ask e.g. *"Which Austin locations had
the highest revenue last quarter?"* and Desktop answers through our
Supabase data.

## Claude Code

```sh
claude mcp add venue-insights -- npx -y tsx C:\ABSOLUTE\PATH\TO\venue-insights-platform\scripts\mcp-server.ts
# then inside a session: /mcp shows the server and its 4 tools
```

## Troubleshooting

- **Server never appears / instantly disconnects** — almost always stdout
  contamination or a missing `DATABASE_URL`. Check the client's MCP logs
  (Desktop: `%APPDATA%\Claude\logs\mcp-server-venue-insights.log`); our
  server writes its diagnostics to stderr, which lands in that log.
- **`Cannot find package 'tsx'`** — use `npx -y tsx …` as shown (downloads
  on demand) or install tsx globally.
- **Tool calls fail with a Postgres error** — the Supabase pooler URL in
  `.env.local` must be the transaction pooler (port 6543); same
  requirement as the app.
