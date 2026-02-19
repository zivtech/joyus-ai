# Claude Desktop MCP Configuration

Connect Claude Desktop to the deployed Joyus AI MCP server.

## Setup

Add this to your Claude Desktop MCP config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "joyus-ai": {
      "url": "https://ai.zivtech.com/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

Replace `<YOUR_MCP_BEARER_TOKEN>` with the token provided by your admin.

## Verify Connection

1. Restart Claude Desktop after saving the config
2. Check the MCP indicator (bottom of chat window) — it should show connected
3. Try: "Search Jira for recent bugs"
4. You should see tool calls executing against the deployed server

## Available Tools

Once connected, Claude Desktop has access to:

- **Jira** — search, view, comment on, and transition issues
- **Slack** — search, read, and post messages
- **GitHub** — search code, list PRs, view issues
- **Google** — Gmail, Drive, Docs access
- **Playwright** — browser automation and screenshots
- **Memory** — persistent knowledge graph across sessions

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Check that `https://ai.zivtech.com/health` returns 200 |
| 401 Unauthorized | Verify your bearer token matches `MCP_BEARER_TOKEN` in server config |
| Timeout | MCP server may be restarting — wait 30 seconds and retry |
| Tools not showing | Restart Claude Desktop completely (quit and reopen) |
| "Server disconnected" | Check your internet connection; the server may have redeployed |

## Web Chat (Mobile/AFK)

For mobile or away-from-keyboard access, open:

```
https://ai.zivtech.com/chat
```

Enter your web chat token when prompted. The web chat provides the same tool access as Claude Desktop.
