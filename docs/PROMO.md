# Chrome Web Store copy

## Extension name

Zero Ad Network

## Short description

Browse participating websites without ads and access the paid content they include. Requires a paid Freedom membership.

## Detailed description

Browse participating websites without ads and access the paid content they include. Get started with one paid Freedom membership and the Zero Ad Network browser extension. Your subscription supports publishers and creators based on the time you spend with their content.

A paid Freedom membership is required for subscriber benefits. They are available on participating websites, and each website provides access to the content and features it includes with Freedom.

### More of what you came for

- **Browse without the interruptions.** Participating websites provide pages without ads, cookie consent banners, marketing popups, or non-essential third-party tracking.
- **Enjoy included paid content.** Access a participating website's base subscription or the paid articles and features it includes with Freedom. Higher tiers and other purchases may still cost extra.
- **Support the people behind the content.** Part of your membership funds participating websites and creators. How much time you spend with them helps determine their share, alongside your allocation preferences.
- **Keep it simple.** One monthly membership works across participating websites. After setup, the extension lets participating websites know you're a member as you browse.

### Get started

1. Install the extension and sign in or create an account at zeroad.network.
2. Join Freedom, then open your dashboard to connect your membership to the extension. Already a member? Open your dashboard and check your membership in the extension popup.
3. Visit a participating website. On your first visit, you may need to reload the page before its subscriber benefits appear.

See current membership pricing at https://zeroad.network/#membership.

### Where it works

Look for websites that participate in Zero Ad Network. The extension confirms your membership; the website removes interruptions and provides its included content. Installing the extension does not remove ads or unlock paywalls across the whole web.

Creators on other platforms can also participate by adding their Publisher ID to their content. When the extension recognizes one, your time can help support that creator. This does not remove the platform's ads or unlock its paid features.

Need help with a participating website? Open the extension and select “Report an issue.” You can also open your dashboard from the popup.

### How your time helps

The extension measures time on recognized websites and creator pages while their tab and browser window are in focus. Time spent in background tabs does not count. Reading without moving your mouse still counts. This activity helps divide the publisher share of membership payments each month; page views alone do not decide earnings.

### Your privacy and controls

To find participating websites and creators, the extension checks page information locally, including visible text. This is why it asks for access to websites you visit. It sends activity records, not copies of page text.

Activity sent to Zero Ad Network is linked to your account. It includes publisher identifiers, website addresses, page-view counts, and time spent. For creator content on other platforms, it can include full page URLs. Uploads also include the extension version; the service records your IP address and when the upload arrives. Publishers receive activity totals rather than your account identity. We do not sell your data.

The membership proof sent to a participating website contains no account ID, name, or email. It is specific to that website and is sent over HTTPS.

Select “Pause extension” to stop the extension from telling websites you’re a member, looking for publishers, and recording visits. This applies to all websites. Previously recorded activity still syncs with Zero Ad Network. Select “Resume extension” to resume. Reload pages after pausing or resuming; a website's own login may keep you signed in.

Install Zero Ad Network and connect your Freedom membership to start browsing and supporting participating websites.

Learn more: https://zeroad.network/docs
Privacy policy: https://zeroad.network/privacy

---

## Publishing notes — not part of the store description

The short description is also used in `manifest.json`. Keep both copies aligned. Paste the detailed description into the store listing using plain headings and bullets if Markdown formatting is unavailable.

The structure follows [Chrome's listing guidance](https://developer.chrome.com/docs/webstore/best-listing): a concise summary, an opening overview, concrete benefits, and clear setup. [Dark Reader](https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh) and [Bitwarden](https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb) were reviewed as widely used examples of direct benefit language and scannable feature descriptions. Public user counts do not establish which wording converts best; this copy has not been conversion-tested.

Claims were checked against publisher discovery, hostname-specific membership proof, focused-tab measurement, account-linked uploads, popup controls, and their tests in `src/worker` and `src/popup`, plus the platform's onboarding and telemetry endpoint. Keep the participating-site boundary, paid membership requirement, creator-platform distinction, and privacy disclosure when adapting this copy.

Do not add unverified user or partner counts, guaranteed speed improvements, universal ad-blocking or paywall access, or anonymous/no-tracking claims. Match screenshots to actual participating-site behavior and the released extension. Updating this file does not publish a store listing or release the manifest change.
