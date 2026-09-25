// The popup's markup, rendered to a static `popup.html` at build time by `build-popup.ts`.
//
// Nothing here is rendered at runtime: the popup ships every section it might ever need, all of
// the conditional ones `hidden`, and `state.ts` un-hides the ones that apply to the account. That
// is why selectors, not props, carry the state - see `dom.ts`.

import { raw } from "hono/html"
import { Icon } from "./icon"

/** Markers `dom.ts`'s `replace()` substitutes once the worker has answered. */
const FIRST_NAME = "{FIRST_NAME}"
const VERSION = "{VERSION}"

function Header() {
  return (
    <header class="mb-6">
      <nav
        class="popup-navigation"
        aria-label="Main navigation"
      >
        <a
          class="popup-brand"
          href="/"
        >
          Zero Ad Network
        </a>
        <ul class="popup-navigation-links list-unstyled mb-0">
          <li id="link-pricing">
            <a href="/#features">Features</a>
          </li>
          <li>
            <a href="/#pricing">Pricing</a>
          </li>
        </ul>
      </nav>
    </header>
  )
}

function UnsubscribedSection() {
  return (
    <div
      class="guest user not-subscribed"
      hidden
    >
      <h1
        class="guest greeting fs-xl"
        hidden
      >
        Welcome guest,
      </h1>
      <h1
        class="user not-subscribed greeting fs-xl"
        hidden
      >
        Hi {FIRST_NAME},
      </h1>
      <div
        class="guest"
        hidden
      >
        <p class="fg-2">Sign up and activate a subscription to unlock your ad-free and enhanced browsing experience:</p>
      </div>
      <div
        class="not-subscribed"
        hidden
      >
        <p class="fg-2">Activate a subscription to begin enjoying an ad-free and enhanced web experience:</p>
      </div>
      <ul class="list-unstyled check-list d-flex flex-column gap-3 mb-6">
        <li>Enjoy a completely ad-free experience</li>
        <li>Skip cookie consent pop-ups</li>
        <li>No unnecessary third-party trackers</li>
        <li>No marketing interruptions</li>
        <li>Access partner sites’ base subscriptions or included content and features</li>
      </ul>
      <div class="d-grid">
        <a
          class="guest btn-solid btn-lg theme-primary"
          hidden
          href="/login"
        >
          Join us now {raw("&rarr;")}
        </a>
        <a
          class="user not-subscribed btn-solid btn-lg theme-primary"
          hidden
          href="/checkout"
        >
          Join Freedom {raw("&rarr;")}
        </a>
      </div>
    </div>
  )
}

function ValidSubscription() {
  return (
    <div
      class="subscription-valid"
      hidden
    >
      <div
        class="freedom"
        hidden
      >
        <p>
          You have the <b>Freedom</b> plan active for <b class="valid-until"></b>.
        </p>
        <ul class="list-unstyled check-list d-flex flex-column gap-3 fg-2 mb-6">
          <li>Enjoy a completely ad-free experience and fewer interruptions.</li>
          <li>Access partner sites’ base subscriptions or their included content and features.</li>
        </ul>
      </div>
    </div>
  )
}

function ExpiredSubscription() {
  return (
    <div
      class="subscription-expired"
      hidden
    >
      <h5>
        Your plan is now <span class="fg-danger">expired</span>.
      </h5>
      <p class="fg-2">
        No action needed {raw("&mdash;")} we'll automatically refresh your token while your subscription is active.
      </p>
      <p class="fg-2">
        If not, you can renew your subscription anytime from your dashboard to keep enjoying an ad-free web experience.
      </p>
    </div>
  )
}

function PublisherFeatures() {
  return (
    <div
      id="publisher-features"
      hidden
    >
      <hr />
      <h5>This site offers</h5>
      <ul class="list-unstyled check-list d-flex flex-column gap-3 mb-0">
        <li
          class="clean_web"
          hidden
        >
          Ad Free experience without interruptions
        </li>
        <li
          class="one_pass"
          hidden
        >
          Included subscription content and features
        </li>
      </ul>
    </div>
  )
}

function DeveloperDetails() {
  return (
    <div
      id="developer-details"
      hidden
    >
      <hr />
      <h5>Website test access</h5>
      <span
        id="developer-token-label"
        class="badge theme-warning me-1"
      >
        Mode: Testing
      </span>
      <span
        id="subscription-label"
        class="badge theme-warning me-1"
      >
        Subscription: <span></span>
      </span>
      <span
        id="developer-hostname-label"
        class="badge theme-warning"
      >
        Site: <span></span>
      </span>
      <p class="small fg-secondary mt-2">
        Access is limited to this hostname. Test visits do not contribute to publisher earnings.
      </p>
      <button
        type="button"
        id="stop-testing-btn"
        class="btn-outline theme-secondary mt-2"
        hidden
      >
        Stop testing
      </button>
    </div>
  )
}

function SubscriberControls() {
  return (
    <div class="d-flex flex-wrap gap-2">
      <a
        id="choose-plan-btn"
        class="btn-solid theme-primary flex-grow-1"
        href="/dashboard"
        title="Open my dashboard"
      >
        <Icon name="layout-dashboard" />
        Dashboard
      </a>
      {/* biome-ignore lint/a11y/useValidAnchor: the destination is only known once the active tab
          turns out to be a publisher site - see `updateUrls` in `dom.ts`. */}
      <a
        id="report-site-btn"
        role="link"
        class="btn-outline theme-danger"
        hidden
        data-href="/report/site"
        title="Report a site issue"
        aria-label="Report a site issue"
      >
        <Icon name="bug" />
      </a>
      <button
        type="button"
        id="pause-btn"
        class="btn-outline theme-secondary w-100"
        hidden
        title="Turn Freedom off on all websites"
        aria-label="Turn Freedom off on all websites"
        aria-describedby="freedom-comparison-help"
      >
        <Icon name="circle-pause" /> Turn Freedom off
      </button>
      <button
        type="button"
        id="resume-btn"
        class="btn-outline theme-success w-100"
        hidden
        title="Turn Freedom on for all websites"
        aria-label="Turn Freedom on for all websites"
        aria-describedby="freedom-comparison-help"
      >
        <Icon name="circle-play" /> Turn Freedom on
      </button>
      <p
        id="freedom-comparison-help"
        class="small fg-secondary mb-0"
      >
        Compare websites with Freedom on or off. Applies to all websites; reload pages after switching. This toggle does
        not pause visit measurement or uploads.
      </p>
    </div>
  )
}

function SubscribedSection() {
  return (
    <div
      class="user subscribed"
      hidden
    >
      <ValidSubscription />
      <ExpiredSubscription />
      <PublisherFeatures />
      <DeveloperDetails />
      <hr />
      <SubscriberControls />
    </div>
  )
}

function Footer() {
  return (
    <footer class="popup-footer">
      <div class="d-flex flex-wrap justify-content-end fg-3 gap-3">
        <small
          id="debug-menu"
          class="d-flex flex-wrap gap-3"
          hidden
        >
          <a
            id="sync-token"
            href="/dashboard"
          >
            sync token
          </a>
          <a
            id="push-telemetry"
            // biome-ignore lint/a11y/useValidAnchor: a dev-tools command, not a destination - `dev-tools.ts` handles the click
            href=""
          >
            push telemetry
          </a>
          <a
            id="display-telemetry"
            // biome-ignore lint/a11y/useValidAnchor: a dev-tools command, not a destination - `dev-tools.ts` handles the click
            href=""
          >
            show telemetry
          </a>
          <a
            id="reset-extension-state"
            // biome-ignore lint/a11y/useValidAnchor: a dev-tools command, not a destination - `dev-tools.ts` handles the click
            href=""
          >
            reset
          </a>
        </small>
        <small id="version">Version {VERSION}</small>
      </div>
    </footer>
  )
}

export function Popup() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <meta
          content="en-GB"
          http-equiv="content-language"
        />
        {/* The stylesheet resolves its palette with light-dark(); this lets the popup follow the OS
            light/dark setting on its own, no theme attribute and no JS. */}
        <meta
          name="color-scheme"
          content="light dark"
        />
        <link
          rel="stylesheet"
          href="./css/main.css"
        />
        <script
          type="text/javascript"
          src="./js/popup.js"
        ></script>
      </head>
      <body>
        <div class="px-7 py-6">
          <Header />
          <main>
            <div
              id="extension-paused"
              class="alert theme-warning"
              hidden
            >
              Freedom is off on all websites. Turn it on and reload to request subscriber access again. Visit
              measurement and uploads continue.
            </div>
            <UnsubscribedSection />
            <SubscribedSection />
          </main>
          <Footer />
        </div>
      </body>
    </html>
  )
}

/** The shipped document, as both `build-popup.ts` and the popup tests render it. */
export function renderPopupHtml(): string {
  return `<!DOCTYPE html>${(<Popup />).toString()}`
}
