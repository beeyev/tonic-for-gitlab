# Privacy Policy for Tonic for GitLab

Last updated: September 5, 2026

This policy describes how the Tonic for GitLab browser extension handles user data.

## Summary

Tonic for GitLab processes GitLab page data locally to provide its user-facing features. The developer does not receive this data. The extension has no analytics, advertising, telemetry, tracking, developer-operated backend, or external service integration.

Tonic for GitLab does not sell, share, or transfer user data to third parties.

## Data handled

The extension handles only the data needed to improve GitLab workflows:

- **Personally identifiable information:** GitLab usernames displayed on merge request pages are read temporarily to identify merge requests authored by the current user. Usernames are not stored by Tonic.
- **Web history:** GitLab origins, page paths, and merge request filter query parameters are read to determine which features apply and to restore filters the user explicitly chooses to remember.
- **User activity:** Tonic responds to user actions on relevant GitLab and Tonic controls. It does not create a separate activity log.
- **Website content:** Tonic reads the GitLab interface, including text, links, merge request metadata, controls, and broadcast banners, to apply enabled features.

This processing occurs locally in the browser. No GitLab page content, usernames, URLs, or interaction data is sent to the developer or to a third party.

## Data stored locally

Tonic uses browser-managed extension storage for:

- Feature preferences.
- Self-managed GitLab origins added by the user.
- Merge request list paths and filter query parameters the user chooses to remember.
- A timestamp used to manage remembered filter entries.
- A SHA-256 fingerprint and dismissal state for the latest broadcast banner on an origin. Raw banner text is not stored.
- A temporary session flag indicating that open tabs may need to be reloaded after access changes.

Persistent values use `chrome.storage.local`. The temporary reload flag uses `chrome.storage.session`. Tonic does not use `chrome.storage.sync`.

## How data is used

The extension uses this data only to provide the features described on its Chrome Web Store page, including page customization, merge request controls, remembered filters, broadcast dismissal, and support for user-approved self-managed GitLab instances.

Tonic writes a merge request URL to the clipboard only when the user activates its copy-link control. It does not read existing clipboard contents.

## Data sharing and transmission

Tonic has no developer-operated server and does not transmit user data. It does not sell data, use data for advertising, determine creditworthiness, or allow humans to review user data.

The extension operates inside GitLab pages. GitLab's own collection and processing are governed by the policies of the GitLab instance being used and are outside Tonic's control.

## Permissions

- **Host access:** Allows Tonic to run on GitLab.com and on self-managed GitLab schemes and hostnames explicitly added and approved by the user.
- **Scripting:** Registers or removes Tonic's content script for those user-approved self-managed GitLab host scopes.
- **Storage:** Saves the local settings and feature state described above.

Tonic does not load or execute remote JavaScript or WebAssembly. All executable code is included in the reviewed extension package.

## Retention and deletion

Stored data remains in browser-managed extension storage until the user replaces or removes it, clears the extension's data, or uninstalls the extension. Removing the last saved instance for a scheme and hostname unregisters Tonic's content script and asks the browser to revoke host access for that scope. A broader grant managed by the browser may remain. Removing one saved port keeps shared access while another saved port still uses it.

## Chrome Web Store Limited Use

Tonic for GitLab's use and transfer of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Policy changes

This policy will be updated before Tonic introduces materially different data handling. Where required, such changes will also be disclosed prominently to users before the new handling begins.

## Contact

Privacy questions may be sent through the developer contact channel shown on the Tonic for GitLab Chrome Web Store listing.

## Trademark notice

Tonic for GitLab is not affiliated with, endorsed by, sponsored by, or approved by GitLab Inc.

GITLAB is a trademark of GitLab Inc. in the United States and other countries and regions.
