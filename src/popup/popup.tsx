// The popup's markup, rendered to a static `popup.html` at build time by `build-popup.ts`.
//
// Nothing here is rendered at runtime: the popup ships every section it might ever need, all of
// the conditional ones `hidden`, and `state.ts` un-hides the ones that apply to the account. That
// is why selectors, not props, carry the state - see `dom.ts`.

import { Icon } from "./icon"

/** Markers `dom.ts`'s `replace()` substitutes once the worker has answered. */
const VERSION = "{VERSION}"

// Keep aligned with SUBSCRIBER_ENTITLEMENTS in the main site's @config package.
const PLAN_FEATURES = [
  "Ads removed",
  "Cookie consent screens removed",
  "Non-essential third-party trackers removed",
  "Marketing popups removed, including newsletter prompts",
  "Access to the publisher’s base subscription or a custom level of paid content or features",
]

function Header() {
  return (
    <header class="popup-header">
      <a
        class="popup-brand"
        href="/"
      >
        <img
          src="./images/logo.svg"
          width="32"
          height="32"
          alt=""
        />
        Zero Ad Network
      </a>
      <a
        class="popup-help"
        href="/docs/extension-workflow"
        aria-label="Help & guides"
      >
        <Icon name="circle-help" />
      </a>
    </header>
  )
}

// Match the homepage, onboarding and dashboard copy. The extension is released separately,
// so it keeps its own markup while using the frontend's shared @styles components.
function UnsubscribedSection() {
  return (
    <div
      class="guest user not-subscribed"
      hidden
    >
      <div class="popup-welcome popup-feature">
        <p class="popup-eyebrow">Less noise. More freedom.</p>
        <div class="popup-feature-heading">
          <h1
            class="guest greeting"
            hidden
          >
            A quieter way to browse.
          </h1>
          <h1
            class="user not-subscribed greeting"
            hidden
          >
            Freedom membership
          </h1>
          <img
            class="popup-bird"
            src="./images/logo.svg"
            width="96"
            height="96"
            alt=""
          />
        </div>
      </div>
      <p class="popup-intro">
        Read participating websites without ads. Your membership funds the publishers you spend time with.
      </p>
      <div class="d-grid gap-3">
        <a
          class="guest btn-solid theme-primary"
          hidden
          href="/login"
        >
          Sign in to get started <Icon name="arrow-right" />
        </a>
        <a
          class="user not-subscribed btn-solid theme-primary"
          hidden
          href="/checkout"
        >
          Explore Freedom <Icon name="arrow-right" />
        </a>
      </div>
      <details class="accordion-item popup-benefits">
        <summary class="accordion-header">
          What’s included{" "}
          <Icon
            name="chevron-down"
            class="accordion-icon"
          />
        </summary>
        <div class="accordion-body">
          <p>
            One monthly subscription activates your browser extension and includes all Freedom benefits on participating
            websites.
          </p>
          <ul class="list-unstyled check-list d-flex flex-column gap-3 mb-0">
            {PLAN_FEATURES.map((feature) => (
              <li>{feature}</li>
            ))}
          </ul>
        </div>
      </details>
      <ul class="popup-navigation-links list-unstyled d-flex gap-6 mb-0">
        <li>
          <a href="/#how-it-works">How it works</a>
        </li>
        <li id="link-pricing">
          <a href="/#membership">Pricing</a>
        </li>
      </ul>
    </div>
  )
}

function Membership() {
  return (
    <div class="popup-feature popup-membership">
      <div class="popup-membership-status">
        <p class="popup-eyebrow">Your access</p>
        <span
          class="subscription-valid popup-status badge badge-subtle theme-success"
          hidden
        >
          <Icon name="check" /> Active
        </span>
        <span
          class="subscription-expired popup-status badge badge-subtle theme-warning"
          hidden
        >
          <Icon name="circle-alert" /> Expired
        </span>
      </div>
      <div class="popup-feature-heading">
        <h1 id="access-title">Freedom membership</h1>
        <img
          class="popup-bird"
          src="./images/logo.svg"
          width="96"
          height="96"
          alt=""
        />
      </div>
      <div
        class="subscription-valid"
        hidden
      >
        <div
          class="freedom"
          hidden
        >
          <p class="popup-validity">
            Access valid for <span class="valid-until"></span>.
          </p>
        </div>
      </div>
      <div
        id="membership-expired-details"
        class="subscription-expired"
        hidden
      >
        <p class="small fg-2 mb-3">Check your payment method and subscription status to restore access.</p>
        <a href="/billing">
          Review billing <Icon name="arrow-right" />
        </a>
      </div>
      <DeveloperDetails />
    </div>
  )
}

function DeveloperDetails() {
  return (
    <div
      id="developer-details"
      class="mt-3"
      hidden
    >
      <p
        id="developer-hostname-label"
        class="popup-hostname mb-2"
      >
        <span></span>
      </p>
      <p class="small fg-2 mb-3">Test visits do not earn revenue.</p>
      <button
        type="button"
        id="stop-testing-btn"
        class="btn-outline btn-sm theme-secondary"
        hidden
      >
        Stop testing
      </button>
    </div>
  )
}

function PublisherSite() {
  return (
    <section
      id="publisher-site"
      class="popup-site panel"
      hidden
      aria-labelledby="publisher-hostname"
    >
      <div class="popup-site-heading">
        <span class="popup-site-icon">
          <Icon name="globe" />
        </span>
        <div>
          <p class="popup-eyebrow">On this tab</p>
          <h2
            id="publisher-hostname"
            class="popup-hostname fs-md mb-0"
          >
            This website
          </h2>
        </div>
      </div>
      <div class="popup-site-actions">
        <span
          id="publisher-kind"
          class="badge badge-subtle theme-primary"
        >
          Website integration
        </span>
        {/* biome-ignore lint/a11y/useValidAnchor: state.ts sets the destination after identifying the active tab. */}
        <a
          id="report-site-btn"
          class="popup-report"
          role="link"
          hidden
          data-href="/report/site"
          target="_blank"
          title="Report a website or creator"
          aria-label="Report issue with this website or creator"
        >
          <Icon name="flag" /> Report issue
        </a>
      </div>
    </section>
  )
}

function SubscriberControls() {
  return (
    <section
      class="popup-controls"
      aria-labelledby="extension-heading"
    >
      <div class="popup-controls-heading">
        <h2
          id="extension-heading"
          class="fs-sm mb-0"
        >
          Browser extension
        </h2>
        <span
          id="extension-running"
          class="popup-status fg-primary"
          role="status"
          hidden
        >
          <Icon name="check" /> Enabled
        </span>
        <span
          id="extension-paused"
          class="popup-status fg-warning"
          role="status"
          aria-label="Extension paused"
          hidden
        >
          <Icon name="circle-pause" /> Paused
        </span>
      </div>
      <div
        id="extension-actions"
        class="popup-actions"
      >
        <button
          type="button"
          id="pause-btn"
          class="btn-outline btn-sm theme-secondary"
          hidden
          aria-describedby="extension-scope"
        >
          <Icon name="circle-pause" /> Pause extension
        </button>
        <button
          type="button"
          id="resume-btn"
          class="btn-solid btn-sm theme-primary"
          hidden
          aria-describedby="extension-scope"
        >
          <Icon name="circle-play" /> Resume extension
        </button>
        <button
          type="button"
          id="reload-tab-btn"
          class="btn-outline btn-sm theme-secondary"
          hidden
          title="Reload active tab"
        >
          <Icon name="rotate-cw" /> Reload tab
        </button>
      </div>
      <p
        id="reload-tab-error"
        class="small fg-danger mt-3 mb-0"
        role="alert"
        hidden
      >
        Could not reload this tab. Try again or reload it in your browser.
      </p>
      <p
        id="extension-scope"
        class="popup-control-hint"
      >
        Applies to all websites. Reload tabs after changing.
      </p>
      <details
        id="freedom-controls"
        class="accordion-item"
      >
        <summary class="accordion-header">
          What happens when I pause?
          <Icon
            name="chevron-down"
            class="accordion-icon"
          />
        </summary>
        <p
          id="freedom-comparison-help"
          class="small fg-2 mb-0"
        >
          Pausing stops membership proof, publisher discovery and visit measurement on all websites. Previously recorded
          visit statistics still sync with Zero Ad Network.
        </p>
      </details>
    </section>
  )
}

function SubscribedSection() {
  return (
    <div
      class="user subscribed"
      hidden
    >
      <Membership />
      <PublisherSite />
      <SubscriberControls />
      <nav
        class="popup-account-links"
        aria-label="Account"
      >
        <a
          id="choose-plan-btn"
          href="/dashboard"
        >
          <Icon name="layout-dashboard" /> Overview
        </a>
        <a href="/billing">
          <Icon name="settings" /> Membership
        </a>
      </nav>
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
        <small
          id="version"
          hidden
        >
          Version {VERSION}
        </small>
      </div>
    </footer>
  )
}

export function Popup() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Zero Ad Network</title>
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
        <div class="popup-shell">
          <Header />
          <main>
            <p
              id="popup-loading"
              class="popup-loading fg-2"
              role="status"
            >
              Checking your membership…
            </p>
            <div
              id="popup-error"
              class="alert theme-warning"
              role="alert"
              hidden
            >
              <p class="mb-3">Could not sync the extension</p>
              <button
                id="retry-btn"
                type="button"
                class="btn-outline btn-sm"
              >
                Try again
              </button>
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
