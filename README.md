# Tonic for GitLab

Tonic for GitLab is a browser extension for small, configurable improvements to
the GitLab interface. It works on `GitLab.com` and on self-managed instances you
add yourself. Everything runs in the browser.

## Features
- Dim draft merge requests, highlight your own, and filter lists to merge
  requests you authored.
- Remember filters for merge request lists.
- Copy the canonical link for a merge request from any detail tab.
- Keep GitLab's Approve button in the merge request tab bar, so it stays
  reachable from Commits, Pipelines, and Changes.
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

## Install manually in a Chromium browser

Until then, or if you prefer release builds from GitHub:

1. Download the Chromium ZIP from the [latest release](https://github.com/beeyev/tonic-for-gitlab/releases/latest).
2. Extract it somewhere permanent.
3. Open the browser's extensions page and enable Developer mode:
   `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `vivaldi://extensions`.
4. Click "Load unpacked" and select the extracted directory that contains
   `manifest.json`.
5. Pin the extension from the browser's extensions menu, then open GitLab.

Chrome documents the same unpacked-install flow in its [extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
Microsoft documents [sideloading in Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading),
and Vivaldi documents its [Chromium extension support](https://help.vivaldi.com/desktop/appearance-customization/extensions/).

## Install temporarily in Firefox

Firefox requires Mozilla signing for ordinary permanent installation. The
Firefox release ZIP is unsigned. To install it temporarily:

1. Download and extract the Firefox ZIP from the [latest release](https://github.com/beeyev/tonic-for-gitlab/releases/latest),
   or run `bun run build` for a local build.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click "Load Temporary Add-on" and select `manifest.json` in the extracted
   directory, or `dist/firefox/manifest.json` for a local build.

Firefox removes temporary add-ons when it restarts. Mozilla documents this flow
in its [temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

## Add a self-managed GitLab instance

`GitLab.com` works immediately. To add your own GitLab instance:

1. Open the extension from the browser toolbar.
2. Under `GitLab instances`, enter the address and click `Add`.
3. If the row says "Access needed", click "Grant access" and approve the browser request.
4. Reload any open tab for that instance.

You can paste either the GitLab address or a full link to a page in that
instance. This extension keeps only the scheme, host and port. The browser
grants access to that scheme and hostname on every port, not to another scheme,
hostname, subdomain, or to separate project and merge request paths.

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
Extension.js reads the local manifest version from `EXTENSION_PUBLIC_VERSION`
in the tracked `.env.defaults`; an environment variable with the same name
overrides that default for release builds.

## License

Tonic for GitLab is released under the [MIT License](LICENSE). It is an
independent project and is not affiliated with, endorsed by, sponsored by, or
approved by GitLab Inc.
