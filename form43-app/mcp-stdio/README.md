# form43-mcp (stdio adapter)

Tiny MCP server that runs over stdio and proxies JSON-RPC frames to a remote
`form43-app` Cloudflare Worker over the Streamable HTTP `/mcp` endpoint.

Use this when an MCP client (Claude Desktop, `mcp-cli`, etc.) doesn't yet speak
remote MCP transport. For any client that does (Claude.ai, ChatGPT custom
connectors, aqua), connect directly to `https://<host>/mcp` with the bearer
token and skip this package.

## Install & build

```bash
cd form43-app/mcp-stdio
npm install
npm run build
```

## Configure your MCP client

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "form43": {
      "command": "node",
      "args": ["/absolute/path/to/form43-app/mcp-stdio/dist/index.js"],
      "env": {
        "FORM43_BASE_URL": "https://form43.drivenwp.workers.dev",
        "FORM43_API_TOKEN": "<your bearer token>"
      }
    }
  }
}
```

Set `FORM43_MCP_DEBUG=1` to log every JSON-RPC round-trip to stderr.

## Available tools

The adapter proxies every tool the remote Worker exposes — no list duplication.
See `form43-app/src/mcp/tools.ts` for the canonical catalogue.
