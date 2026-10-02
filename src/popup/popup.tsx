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
      <h1
        class="guest greeting fs-xl"
        hidden
      >
        A quieter way to browse
      </h1>
      <h1
        class="user not-subscribed greeting fs-xl"
        hidden
      >
        Freedom membership
      </h1>
      <p class="fg-2">Join to read participating websites without ads, and fund the publishers you spend time with.</p>
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
          Freedom benefits{" "}
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
    <div class="p-5">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-2">
        <h1
          id="access-title"
          class="fs-lg mb-0"
        >
          Freedom membership
        </h1>
        <span
          class="subscription-valid badge badge-subtle theme-success"
          hidden
        >
          Active
        </span>
        <span
          class="subscription-expired badge badge-subtle theme-warning"
          hidden
        >
          Expired
        </span>
      </div>
      <div
        class="subscription-valid"
        hidden
      >
        <div
          class="freedom"
          hidden
        >
          <p class="small fg-2 mb-0">
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
      <div class="d-flex align-items-center gap-3 p-4">
        <Icon
          name="globe"
          class="fg-2 flex-shrink-0"
        />
        <h2
          id="publisher-hostname"
          class="popup-hostname fs-md mb-0"
        >
          This website
        </h2>
      </div>
      <div class="popup-site-actions border-top bg-1 px-4 py-3">
        <span
          id="publisher-kind"
          class="badge badge-subtle theme-primary"
        >
          Website integration
        </span>
        {/* biome-ignore lint/a11y/useValidAnchor: state.ts sets the destination after identifying the active tab. */}
        <a
          id="report-site-btn"
          class="btn-outline btn-xs theme-secondary"
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
      class="popup-controls border-top bg-1 p-5"
      aria-label="Browser extension"
    >
      <div
        id="extension-paused"
        class="mb-3"
        role="status"
        hidden
      >
        <p class="fw-semibold mb-1">Freedom is off</p>
        <p class="small fg-2 mb-0">While Freedom is off, the extension doesn’t discover publishers or record visits.</p>
      </div>
      <button
        type="button"
        id="pause-btn"
        class="btn-outline theme-secondary w-100"
        hidden
        aria-describedby="freedom-comparison-help"
      >
        <Icon name="circle-pause" /> Turn Freedom off
      </button>
      <button
        type="button"
        id="resume-btn"
        class="btn-solid theme-primary w-100"
        hidden
        aria-describedby="freedom-comparison-help"
      >
        <Icon name="circle-play" /> Turn Freedom on
      </button>
      <p
        id="freedom-comparison-help"
        class="small fg-2 mt-3 mb-0"
      >
        It applies to every website. Reload the website after switching.
      </p>
    </section>
  )
}

function SubscribedSection() {
  return (
    <div
      class="user subscribed"
      hidden
    >
      <section class="panel popup-membership">
        <Membership />
        <SubscriberControls />
      </section>
      <PublisherSite />
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
          Manage membership <Icon name="arrow-right" />
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
              class="fg-2"
              role="status"
            >
              Checking…
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
