# Stitch MCP Setup Guide

## 1. Get a Stitch API Key

1. Go to the [Stitch Settings page](https://stitch.googleapis.com/settings)
2. Create a new API key
3. Copy the key — you'll need it for the next step

## 2. Add Stitch to Claude Code

Run this command in your terminal:

```bash
claude mcp add stitch --transport http https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key: YOUR-KEY" -s user
```

Replace `YOUR-KEY` with your actual Stitch API key.

## 3. Verify Connection

```bash
claude mcp list
```

You should see `stitch` in the list of connected MCP servers.

## 4. Add to Environment

Add your key to `.env.local`:

```
STITCH_API_KEY=your-stitch-api-key-here
```

Optionally, if you already have a design system in Stitch:

```
STITCH_DESIGN_SYSTEM_ID=your-existing-design-system-id
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Generate Fix" buttons don't appear | Check that `STITCH_API_KEY` is set in `.env.local` |
| Fix generation fails | Run `claude mcp list` to verify Stitch is connected |
| Timeout errors | Stitch generation can take up to 2 minutes — try again |
| "MCP tool not found" errors | Re-run the `claude mcp add` command above |
| Connection refused | Check your API key is valid and not expired |
