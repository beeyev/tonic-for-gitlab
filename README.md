# Tonic for GitLab

Tonic for GitLab is a Chrome extension for small, configurable improvements to
the GitLab interface. It works on `GitLab.com` and on self-managed instances you
add yourself. Everything runs in the browser.

## Features
- Dim draft merge requests, highlight your own, and filter lists to merge
  requests you authored.
- Remember filters for merge request lists.
- Copy the canonical link for a merge request from any detail tab.
- Confirm merge and auto-merge actions before they run.
- Start new merge request comments as threads by default.
- Expand or collapse all job-log sections, and optionally open logs collapsed.
- Dismiss broadcast banners locally.
- Hide the GitLab Duo entry point and the file browser feedback link.
- And more small GitLab interface fixes, all configurable from the in-page
  settings panel.

## Chrome Web Store

> The first release is currently under review in the Chrome Web Store. Once it
> is approved, this section will link to the listing and Chrome will handle
> updates.

## Install manually

Until then, or if you prefer release builds from GitHub:

1. Download the Chrome ZIP from the [latest release](https://github.com/beeyev/tonic-for-gitlab/releases/latest).
2. Extract it somewhere permanent.
3. Open `chrome://extensions` in Chrome and enable Developer mode.
4. Click "Load unpacked" and select the extracted directory that contains
   `manifest.json`.
5. Pin the extension from Chrome's extensions menu, then open GitLab.

Chrome documents the same unpacked-install flow in its [extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Add a self-managed GitLab instance

`GitLab.com` works immediately. To add your own GitLab instance:

1. Open the extension from the Chrome toolbar.
2. Under `GitLab instances`, enter the address and click `Add`
3. Approve Chrome access request, then reload any open tab for that instance.
4. If access was denied, open the extension again and click "Grant access"
   beside the saved address.

You can paste either the GitLab address or a full link to a page in that
instance. This extension keeps only the scheme, host and port. Chrome grants
access to the whole instance, not separate project or merge request paths.

| You enter | Saved address |
| --- | --- |
| `gitlab.example.com` | `https://gitlab.example.com` |
| `https://gitlab.example.com/group/project/` | `https://gitlab.example.com` |
| `http://gitlab.internal:8080` | `http://gitlab.internal:8080` |
| `http://localhost:10019` | `http://localhost:10019` |

Use `http://` when the instance has no TLS. Paths, query parameters, fragments,
surrounding whitespace and default ports are normalized away. This extension
does not accept broad wildcard addresses or URLs with credentials.

## Privacy

This extension runs locally in your browser. It has no backend, analytics,
advertising, telemetry, or third-party integrations. It does not send GitLab
page content, URLs, usernames, or interaction data anywhere.

Browser-managed extension storage holds only the settings and state needed for
the features you use, such as saved filters, dismissed banner fingerprints, and
self-managed GitLab origins. Details are in the [privacy policy](PRIVACY.md).

## Feedback and contributions

Have an idea, found a bug, or want to improve a feature? Open an [issue](https://github.com/beeyev/tonic-for-gitlab/issues) or send a [pull request](https://github.com/beeyev/tonic-for-gitlab/pulls).

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

The local GitLab lab is documented in [lab/README.md](lab/README.md).

## License

Tonic for GitLab is released under the [MIT License](LICENSE). It is an
independent project and is not affiliated with, endorsed by, sponsored by, or
approved by GitLab Inc.
