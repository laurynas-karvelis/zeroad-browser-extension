// The popup's markup, rendered to a static `popup.html` at build time by `build-popup.ts`.
//
// Nothing here is rendered at runtime: the popup ships every section it might ever need, all of
// the conditional ones `hidden`, and `state.ts` un-hides the ones that apply to the account. That
// is why selectors, not props, carry the state - see `dom.ts`.

import { raw } from "hono/html"

/** Markers `dom.ts`'s `replace()` substitutes once the worker has answered. */
const FIRST_NAME = "{FIRST_NAME}"
const VERSION = "{VERSION}"

function Header() {
  return (
    <header class="mb-4">
      <nav class="navbar border-bottom">
        <a
          class="navbar-brand"
          href="/"
        >
          <img
            class="d-inline-block me-2"
            src="./images/dove.png"
            width="26"
            height="26"
            alt=""
          />
          Zero Ad Network
        </a>
        <ul class="navbar-nav ms-auto">
          <li
            id="link-pricing"
            class="nav-item"
          >
            <a
              class="nav-link px-0 pe-4 py-0"
              href="/#features"
            >
              Features
            </a>
          </li>
          <li class="nav-item">
            <a
              class="nav-link p-0"
              href="/#pricing"
            >
              Pricing
            </a>
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
      <h4
        class="guest greeting"
        hidden
      >
        Welcome guest,
      </h4>
      <h4
        class="user not-subscribed greeting"
        hidden
      >
        Hi {FIRST_NAME},
      </h4>
      <div
        class="guest"
        hidden
      >
        <p>
          Sign up and activate a subscription to <b class="text-success">unlock</b> your ad-free and enhanced browsing
          experience:
        </p>
      </div>
      <div
        class="not-subscribed"
        hidden
      >
        <p>
          Activate a subscription to <b class="text-success">begin enjoying</b> an ad-free and enhanced web experience:
        </p>
      </div>
      <ul class="list-unstyled unstyled-icon">
        <li>Enjoy a completely ad-free experience</li>
        <li>Skip cookie consent pop-ups</li>
        <li>No unnecessary third-party trackers</li>
        <li>No marketing interruptions</li>
        <li>Access content behind paywalls</li>
        <li>Unlock free access to publisher subscriptions</li>
        <li>Unlock free access to streaming services</li>
      </ul>
      <div class="d-grid">
        <a
          class="guest btn btn-lg btn-primary"
          hidden
          href="/login"
        >
          Join us now {raw("&rarr;")}
        </a>
        <a
          class="user not-subscribed btn btn-lg btn-primary"
          hidden
          href="/checkout"
        >
          Choose your plan now {raw("&rarr;")}
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
      <p
        class="clean-web"
        hidden
      >
        Your have the <b class="text-success">Clean Web</b> plan active for <b class="valid-until text-success"></b>.
        <span class="text-muted ms-1">Enjoy a completely ad-free experience and fewer interruptions.</span>
      </p>
      <p
        class="one-pass"
        hidden
      >
        Your have the <b class="text-success">One Pass</b> plan active for <b class="valid-until text-success"></b>.
        <span class="text-muted ms-1">
          Access content behind paywalls and unlocked free access to subscriptions and streaming services.
        </span>
      </p>
      <p
        class="freedom"
        hidden
      >
        Your have the <b class="text-success">Freedom</b> plan active for <b class="valid-until text-success"></b>.
        <span class="text-muted ms-1">Enjoy a completely ad-free experience and fewer interruptions.</span>
        {/* A nested <p> would be auto-closed by the parser, hoisting this line out of the hidden
            .freedom paragraph and showing it to every plan. A block span stays put. */}
        <span class="text-muted d-block">
          Access content behind paywalls and unlocked free access to subscriptions and streaming services.
        </span>
      </p>
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
        Your plan is now <span class="text-danger">expired</span>.
      </h5>
      <p class="text-muted">
        No action needed {raw("&mdash;")} we'll automatically refresh your token while your subscription is active.
      </p>
      <p class="text-muted">
        If not, you can renew your subscription anytime from your dashboard to keep enjoying an ad-free web experience.
      </p>
    </div>
  )
}

function PublisherFeatures() {
  return (
    <div
      id="publisher-features"
      class="col"
      hidden
    >
      <hr />
      <h5>
        The active tab <span class="text-success">site offers</span>:
      </h5>
      <ul class="list-unstyled unstyled-icon">
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
          Free subscriptions and no paywalls
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
      <h5>Developer token overview:</h5>
      <span
        id="developer-token-label"
        class="badge text-bg-warning me-1"
      >
        Type: Developer Token
      </span>
      <span
        id="subscription-label"
        class="badge text-bg-warning me-1"
      >
        Subscription: <span></span>
      </span>
      <span
        id="developer-hostname-label"
        class="badge text-bg-warning"
      >
        Site: <span></span>
      </span>
    </div>
  )
}

function SubscriberControls() {
  return (
    <div class="d-flex gap-2">
      <a
        id="choose-plan-btn"
        class="btn btn-primary flex-grow-1"
        href="/dashboard"
        title="Open my dashboard"
      >
        <img
          class="me-2"
          src="./images/svg/columns-gap.svg"
          alt=""
        />
        Dashboard
      </a>
      {/* biome-ignore lint/a11y/useValidAnchor: the destination is only known once the active tab
          turns out to be a publisher site - see `updateUrls` in `dom.ts`. */}
      <a
        id="report-site-btn"
        class="btn btn-danger"
        hidden
        data-href="/report/site"
        title="Report publishered site Issue"
      >
        <img
          src="./images/svg/bug.svg"
          alt=""
        />
      </a>
      <button
        type="button"
        id="pause-btn"
        class="btn btn-warning"
        hidden
        title="Pause the extension"
      >
        <img
          src="./images/svg/pause-circle.svg"
          alt=""
        />
      </button>
      <button
        type="button"
        id="resume-btn"
        class="btn btn-success"
        hidden
        title="Resume the extension"
      >
        <img
          src="./images/svg/play-circle.svg"
          alt=""
        />
      </button>
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
    <footer class="mt-3">
      <div class="d-flex flex-row justify-content-end text-muted gap-2 mt-3">
        <small
          id="debug-menu"
          class="d-flex d-row gap-1"
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
    <html
      lang="en"
      data-bs-theme="auto"
    >
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
        <div class="container px-4 py-3">
          <Header />
          <main>
            <div
              id="extension-paused"
              class="alert alert-warning text-center"
              hidden
            >
              NOTE: Extension functionality is currently paused!
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
