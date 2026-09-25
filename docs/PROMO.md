# Chrome Web Store copy

## Extension name

Zero Ad Network

## Short description

Ad-free browsing and included paid content on participating sites. Support publishers with one paid Freedom membership.

## Detailed description

Spend more time enjoying the web, with fewer interruptions. Zero Ad Network connects your Freedom membership to participating websites, so they can welcome you with an ad-free experience and included paid content. Your membership also helps fund the sites and creators you spend time with.

A paid Freedom membership is required for subscriber benefits. They are available on participating websites, and each site provides its own included access.

### More of what you came for

- **Read without the interruptions.** Participating websites provide pages without ads, cookie consent banners, marketing popups, or non-essential third-party tracking.
- **Enjoy included paid content.** Access a partner site's base subscription or the paid articles and features it includes with Freedom. Higher tiers and other purchases may still cost extra.
- **Support the people behind the content.** Part of your membership funds participating websites and creators. How much time you spend with them helps determine their share, alongside your allocation preferences.
- **Keep it simple.** One monthly membership works across participating sites. After setup, the extension lets recognized partner websites know you're a member as you browse.

### Get started

1. Install the extension and sign in or create an account at zeroad.network.
2. Join Freedom, then open your dashboard to connect your membership to the extension. Already a member? Open your dashboard and check your membership in the extension popup.
3. Visit a participating website. On your first visit, you may need to reload the page before its subscriber benefits appear.

See current membership pricing at https://zeroad.network/#membership.

### Where it works

Look for websites that participate in Zero Ad Network. The extension confirms your membership; the website removes interruptions and provides its included content. Installing the extension does not remove ads or unlock paywalls across the whole web.

Creators on other platforms can also participate by adding their Publisher ID to their content. When the extension recognizes one, your time can help support that creator. This does not remove the platform's ads or unlock its paid features.

Need help with a recognized site? Open the extension and use “Report a site issue.” You can also open your dashboard from the popup.

### How your time helps

The extension measures time on recognized sites and creator pages while their tab and browser window are in focus. Background tabs do not earn time just by staying open. Reading without moving your mouse still counts. This activity helps divide the publisher share of membership payments each month; page views alone do not decide earnings.

### Your privacy and controls

To find participating sites and creators, the extension checks page information locally, including visible text. This is why it asks for access to websites you visit. It sends activity records, not copies of page text.

Activity sent to Zero Ad Network is linked to your account. It includes publisher identifiers, website addresses, page-view counts, and time spent. For creator content on other platforms, it can include full page URLs. Uploads also include the extension version; the service records your IP address and when the upload arrives. Publishers receive activity totals rather than your account identity. We do not sell your data.

The membership proof sent to a recognized partner website contains no account ID, name, or email. It is specific to that website and is sent over HTTPS.

“Turn Freedom off” stops the extension requesting subscriber benefits on all websites. Reload pages after switching. Visit measurement and uploads continue; this is not a privacy pause, and a website's own login may keep you signed in.

Install Zero Ad Network and connect your Freedom membership to start browsing and supporting participating sites.

Learn more: https://zeroad.network/docs
Privacy policy: https://zeroad.network/privacy

---

## Publishing notes — not part of the store description

The short description is also used in `manifest.json`. Keep both copies aligned. Paste the detailed description into the store listing using plain headings and bullets if Markdown formatting is unavailable.

The structure follows [Chrome's listing guidance](https://developer.chrome.com/docs/webstore/best-listing): a concise summary, an opening overview, concrete benefits, and clear setup. [Dark Reader](https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh) and [Bitwarden](https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb) were reviewed as widely used examples of direct benefit language and scannable feature descriptions. Public user counts do not establish which wording converts best; this copy has not been conversion-tested.

Claims were checked against publisher discovery, hostname-specific membership proof, focused-tab measurement, account-linked uploads, popup controls, and their tests in `src/worker` and `src/popup`, plus the platform's onboarding and telemetry endpoint. Keep the participating-site boundary, paid membership requirement, creator-platform distinction, and privacy disclosure when adapting this copy.

Do not add unverified user or partner counts, guaranteed speed improvements, universal ad-blocking or paywall access, or anonymous/no-tracking claims. Match screenshots to actual participating-site behavior and the released extension. Updating this file does not publish a store listing or release the manifest change.
