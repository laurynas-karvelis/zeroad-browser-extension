/**
 * A chainable wrapper around one `querySelectorAll` result.
 *
 * Every method is a no-op on an empty match, so a selector that finds nothing quietly does
 * nothing instead of throwing - the popup renders whichever sections apply to the current
 * account and simply never matches the rest.
 */
export type Selection = {
  elements: HTMLElement[]
  /** Narrows to descendants of the current match. Empty in, empty out. */
  $(selector: string): Selection
  show(): Selection
  hide(): Selection
  toggle(visible: unknown): Selection
  text(value: string): Selection
  /** Substitutes the `{PLACEHOLDER}` markers the template ships with. */
  replace(values: Record<string, string>): Selection
  title(value: string): Selection
  href(url: string): Selection
  toggleClass(names: string | string[], on: unknown): Selection
  onClick(handler: (event: Event) => unknown): Selection
  /** Reads a `data-*` value off the first match, or undefined when there is none. */
  data(name: string): string | undefined
}

export function $(selector: string, within?: Selection): Selection {
  const roots: ParentNode[] = within ? within.elements : [document]
  const elements = roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>(selector)])

  const each = (apply: (element: HTMLElement) => void): Selection => {
    elements.forEach(apply)
    return selection
  }

  const selection: Selection = {
    elements,

    $: (nested) => $(nested, selection),

    show: () => selection.toggle(true),
    hide: () => selection.toggle(false),
    toggle: (visible) => each((element) => (element.hidden = !visible)),

    text: (value) => each((element) => (element.innerText = value)),

    replace: (values) =>
      each((element) => {
        // Assigning to innerText writes the value as text, so it must not be HTML-escaped first.
        element.innerText = Object.entries(values).reduce(
          (text, [placeholder, value]) => text.replaceAll(`{${placeholder}}`, value),
          element.innerText
        )
      }),

    title: (value) => each((element) => (element.title = value)),
    href: (url) => each((element) => element.setAttribute("href", url)),

    toggleClass: (names, on) =>
      each((element) => {
        for (const name of Array.isArray(names) ? names : [names]) element.classList.toggle(name, !!on)
      }),

    onClick: (handler) =>
      each((element) =>
        element.addEventListener("click", (event) => {
          event.preventDefault()
          handler(event)
        })
      ),

    data: (name) => elements[0]?.dataset[name],
  }

  return selection
}

export function setVersion(version: string) {
  $("#version").replace({ VERSION: version })
}

/** Repoints the template's site-relative links at the real site, since the popup is its own origin. */
export function updateUrls(baseUrl: string) {
  document.querySelectorAll("a").forEach((anchor) => {
    const href = anchor.getAttribute("href")

    // An anchor without an `href` is a button in disguise - the report button, whose real
    // destination is only known once the active tab turns out to be a partner site. Giving it one
    // here would leave it quietly pointing at the home page whenever that lookup comes back empty.
    if (href !== null) {
      anchor.href = new URL(href, baseUrl).toString()
      anchor.target = "_blank"
    }

    // Still resolved, and separately - `data-href` is the deferred destination's base.
    if (anchor.dataset.href) anchor.dataset.href = new URL(anchor.dataset.href, baseUrl).toString()
  })
}

export function applyBootstrapTheme() {
  const root = document.documentElement

  // Only "auto" follows the OS - an explicit choice in the template is left as authored.
  if (root.getAttribute("data-bs-theme") !== "auto") return

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)")
  const applyTheme = () => root.setAttribute("data-bs-theme", prefersDark.matches ? "dark" : "light")

  applyTheme()
  prefersDark.addEventListener("change", applyTheme)
}
