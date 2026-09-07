# Local GitLab lab

Two disposable GitLab CE instances for live Tonic verification, separate from `bun run verify`.
Local use only: plain HTTP and fixed passwords. Requires Docker Compose; extension commands also
require Bun and installed repository dependencies. Allow about 6.5 GiB RAM for both instances,
3.2 GB of image downloads and 10 minutes for the first start.

## Run

From the repository root:

```bash
make -C lab up                 # Start both instances, wait for health, seed; safe to re-run
make -C lab status             # Container state and health
make -C lab logs               # Last 200 log lines per instance
make -C lab seed               # Reconcile fixtures after editing seed.ts
make -C lab down               # Remove containers, keep data
```

`make -C lab` lists all targets. `restart` keeps data; `cleanup` removes containers and volumes,
deleting all lab data. Ask before running `cleanup`.

| Instance | Version | URL |
| --- | --- | --- |
| `gitlab-18` | `18.11.9-ce.0` | http://localhost:10018 |
| `gitlab-19` | `19.2.2-ce.0` | http://localhost:10019 |

[compose.yaml](compose.yaml) owns image pins and configuration. The seeder requires both instances.

## Browser verification

```bash
make -C lab extension-project
```

This copies the current extension into `.ignore/lab-extension` and grants both lab origins through
required host permissions. Regenerate after source edits. Never copy its manifest into `src/` or
`dist/`.

1. Use Extension.js MCP tools with the repository's `.ignore/lab-extension` as `projectPath`.
   Start headed Chrome and wait for readiness. For an attended run, use
   `make -C lab verify-extension`.
2. Add the instance URL through Tonic's toolbar, then reload the tab. Permission is already granted,
   but this step persists the target and registers the content script.
3. Sign in at `/users/sign_in`. Wait for the visible Username and Password fields; the initial
   `#user_login` and `#user_password` inputs are hidden and populated by Vue.
4. Check the relevant project and group pages on both versions. Use a fresh session per version:
   cross-origin navigation can leave the development bridge in the back-forward cache and pollute logs.
5. Check content and background errors. Report assertions as `pass`, `fail`, or `inconclusive`.
   Stop every owned browser session when done.

Use managed Extension.js Chrome or Chrome DevTools MCP to load the extension. Branded Google Chrome
can ignore `--load-extension`.

For production-bundle evidence, build the generated project separately and load it immediately.
`extension dev` overwrites the same `.ignore/lab-extension/dist/chrome` output with development
permissions and scripts. See the [Extension.js command guide](https://extension.js.org/docs/commands).

The generated project covers target persistence, granted permissions, dynamic registration,
injection and reload recovery. Test permission prompts and revocation separately with the shipping
manifest. Required lab permissions cannot be removed: Tonic's Remove control unregisters the script,
then fails to remove permission; reopening the toolbar restores registration.

## Credentials and API

Credentials are identical on both instances.

| User | Password | Role |
| --- | --- | --- |
| `root` | `Kestrel-Anchor-7413` | admin |
| `alice`, `bob`, `carol`, `a.ivanov`, `alex.ivanov`, `renovate` | `Basalt-Meadow-2610` | Developer |

`a.ivanov` and `alex.ivanov` share the display name `Alexander Ivanov`. `renovate` is an ordinary
account; the `dependabot` project access token creates a `project_N_bot_*` author with no password.
Developers can merge into `main`; direct pushes remain Maintainer-only.

`make -C lab token` prints admin tokens with `api` and `sudo` scopes. Tokens rotate on reconfigure;
read them again after `up` or `restart`. From the repository root:

```bash
TOKEN=$(docker compose -f lab/compose.yaml exec -T gitlab-19 cat /lab/token-19)
curl -fsS -H "PRIVATE-TOKEN: $TOKEN" \
  "http://localhost:10019/api/v4/projects/tonic-lab%2Ffrontend/merge_requests"
```

Add `-H "Sudo: alice"` to act as another user, including writes. Prefer `curl` over per-user tokens
or UI automation when creating test data.

## Fixtures

[seed.ts](seed.ts) owns the fixtures, identical on both instances:

| Project path | Merge requests |
| --- | --- |
| `tonic-lab/frontend` | 14, full fixture set |
| `tonic-lab/backend` | 7, base set |
| `tonic-lab/platform/internal-developer-platform` | 4, nested path and duplicate display names |

Open these paths on either instance:

- `/tonic-lab/frontend/-/merge_requests`
- `/groups/tonic-lab/-/merge_requests`

The base set includes draft and ready MRs from `root`, `alice` and `bob`, plus one from `carol`.
MRs by other authors are assigned to `root`. Useful frontend fixtures on a fresh lab:

| MR | Case |
| --- | --- |
| `!2` | `bug` label and `Sprint 42` milestone |
| `!3` | One resolved and one unresolved thread |
| `!4`, `!6` | Reviewed and approved by `bob` and `root`, respectively |
| `!7` | `needs-review` and `priority::high` labels |
| `!8`, `!9` | Ordinary-account bot and project-token bot |
| `!10`, `!11` | Merged with source branch retained; closed |
| `!12` | Targets `release/1.x` |
| `!13` | 13 files, an 800-line `bun.lock`, and a `linguist-generated` path |
| `!14` | 25 threads to exercise discussion pagination |

Re-running `seed` reconciles labels, milestone, reviewers, assignees, title and target branch on
open MRs. Existing branch contents are reused; changing those fixtures requires an approved
`cleanup` followed by `up`.

CI has no runner and is disabled. Wiki, snippets, registry, packages, LFS, artifacts, dependency
proxy, Terraform state, email, SSH, TLS, Pages and KAS are disabled too. CE excludes tier-gated
features. Lab results do not establish GitLab.com compatibility; record exact tested versions.
