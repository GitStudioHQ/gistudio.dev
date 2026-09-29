---
name: gitstudio-mcp
description: Connect an AI agent (Claude Desktop, Cursor, VS Code with Copilot, Windsurf, or any MCP client) to GitStudio's MCP server, a local stdio server that ships with the GitStudio desktop app and gives the agent read-only, and optionally write, Git tools over one repository.
---

# Connect an agent to GitStudio's MCP server

GitStudio Desktop (2.1.0 and later) ships a Model Context Protocol server, `gitstudio-mcp`. It is a **local stdio server**: the MCP client starts it as a child process on the user's machine, and it works on **one repository**. There is no hosted or remote endpoint, no account and no API key. It is read-only unless the user opts into writes.

If GitStudio Desktop is not installed, install it first (see the `install-gitstudio` skill, or https://gitstudio.dev/download).

## The easy way: Agent Access

In GitStudio, open the repository, then **Settings ▸ Agent Access**. One click adds the server to Claude Desktop, Cursor, VS Code (Copilot) or Windsurf, scoped to the open repository, with the permission level the user picks (read-only by default). The same card copies a ready-made config snippet for any other MCP client. Restart or reload the client afterwards.

On macOS, move GitStudio to Applications and open it from there first: Agent Access refuses to write a path from a disk image or a temporary copy macOS made, because that path disappears when the app quits.

## By hand

The client runs the app's own executable as Node (`ELECTRON_RUN_AS_NODE=1`) with the bundled server script, so the user does not need Node installed. On macOS, with the app in /Applications:

```json
{
  "mcpServers": {
    "gitstudio": {
      "command": "/Applications/GitStudio.app/Contents/MacOS/GitStudio",
      "args": [
        "/Applications/GitStudio.app/Contents/Resources/mcp/gitstudio-mcp.js",
        "--repo",
        "/absolute/path/to/the/repository"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

On Windows and Linux the executable and the `resources/mcp/gitstudio-mcp.js` script are in the app's install folder; the snippet Agent Access copies has the exact paths for that machine, so prefer it there.

Where the config goes:

| Client | File | Key |
| --- | --- | --- |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| VS Code | `.vscode/mcp.json` in the workspace, or the user `mcp.json` | `servers` |

## Permissions

| Flag | Adds |
| --- | --- |
| (none) | Read-only tools: `git_status`, `git_log`, `git_show`, `git_diff`, `git_branches`, `git_current_branch`, `git_stashes`, `git_search_commits`, `read_file`, `git_compare` |
| `--write` | Safe writes: `git_stage`, `git_unstage`, `git_commit`, `git_create_branch`, `git_checkout`, `git_stash_save` |
| `--allow-destructive` | Also `git_discard`, `git_delete_branch`, `git_reset`, which can lose work (implies `--write`) |

Add the flag after the `--repo` argument. The environment variables `GITSTUDIO_MCP_WRITE=1` and `GITSTUDIO_MCP_ALLOW_DESTRUCTIVE=1` do the same. Start read-only, and only enable writes when the user asks for them. Tools are annotated with `readOnlyHint` and `destructiveHint`; keep a human in the loop for anything that writes, and ask before any destructive tool.

Besides tools, the server offers resources (`gitstudio://status`, `gitstudio://branches`, `gitstudio://log`, and the templates `gitstudio://commit/{sha}` and `gitstudio://file/{path}`) and prompts (`commit_staged`, `review_changes`, `release_notes`, `explain_branch`).

## Check it worked

Ask the agent to list the repository's branches or its status; it should call `git_branches` or `git_status` and answer from the real repository. If the server does not start, check that both paths in the config exist and that `--repo` points at a Git repository. The server writes diagnostics to stderr, which most clients show in their MCP logs.

Source and full reference: https://github.com/GitStudioHQ/gitstudio/blob/main/apps/mcp/README.md and https://github.com/GitStudioHQ/gitstudio/blob/main/docs/ai-and-agents.md
