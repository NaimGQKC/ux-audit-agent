# Slack slash-command setup — `/ux-audit`

This app exposes two Slack endpoints:

| Purpose | URL |
| --- | --- |
| Slash command | `${APP_URL}/api/slack/audit` |
| Interactivity (button clicks) | `${APP_URL}/api/slack/interactive` |

`APP_URL` must be publicly reachable by Slack. For local development, use a tunnel (e.g. `ngrok http 3000`) and set `APP_URL` to the tunnel URL in `.env.local`.

---

## 1. Create the Slack app

1. Go to <https://api.slack.com/apps> and click **Create New App** → **From an app manifest**.
2. Pick your workspace.
3. Paste the manifest below — replace `https://your-app.example.com` with your `APP_URL`.

```yaml
display_information:
  name: UX Audit
  description: Run a UX audit against a URL and post the top findings.
  background_color: "#0f172a"
features:
  bot_user:
    display_name: UX Audit
    always_online: true
  slash_commands:
    - command: /ux-audit
      url: https://your-app.example.com/api/slack/audit
      description: Audit a URL for UX, a11y, and visual issues.
      usage_hint: "https://staging.example.com"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
settings:
  interactivity:
    is_enabled: true
    request_url: https://your-app.example.com/api/slack/interactive
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. Click **Create**.

---

## 2. Install the app + wire up env vars

1. From the app's left sidebar, open **Install App** and install it to your workspace. Approve the scopes (`commands`, `chat:write`).
2. Open **Basic Information** → **App Credentials** → copy the **Signing Secret**.
3. In your project's `.env.local`:

```bash
SLACK_SIGNING_SECRET=<the signing secret you just copied>
APP_URL=https://your-app.example.com
```

Also make sure `ASANA_ACCESS_TOKEN` and `ASANA_PROJECT_ID` are set so the "Push top issue to Asana" button works.

---

## 3. Test it

In any Slack channel the app is in:

```text
/ux-audit https://staging.example.com
```

You should immediately see an ephemeral "Auditing..." message. A few minutes later the channel gets a public message with the top 3 findings, a link to the full report, and a **Push top issue to Asana** button.

### Help

```text
/ux-audit help
```

---

## 4. Security notes

- **Request signing:** every request is verified with HMAC-SHA256 against `SLACK_SIGNING_SECRET`, with a 5-minute timestamp skew window to protect against replay. Comparison uses `crypto.timingSafeEqual`.
- **URL validation:** the slash command only accepts `http(s)` URLs and rejects private-network targets (`localhost`, `127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`, `.local`, `.internal`) to prevent SSRF.
- **Button payload:** the Asana push button carries `{ runId, issueId }` and resolves the issue server-side from the audit cache — users can't inject arbitrary task content.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `dispatch_failed` in Slack | Slack couldn't reach `APP_URL` within 3 s. Check the tunnel is up and `APP_URL` is correct. |
| `Invalid Slack signature` (401) | `SLACK_SIGNING_SECRET` mismatch or stale timestamp. Copy the secret again and check the server clock. |
| "Audit failed: ..." | The internal `/api/audit` SSE stream errored. Check the server logs; common causes: Claude CLI not on PATH, URL unreachable. |
| Asana button replies with "Couldn't find issue" | The cache entry was evicted or the audit never persisted. Run `/ux-audit` again. |
