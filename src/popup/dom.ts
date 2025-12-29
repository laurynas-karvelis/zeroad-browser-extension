function iterateElements<T = HTMLElement>(elements: NodeListOf<HTMLElement>, fn: (element: T) => unknown) {
  elements.forEach((element) => fn(element as T));
}

export function updateUrls(baseUrl: string) {
  document.querySelectorAll("a").forEach((el) => {
    // Replace base URL of "[chrome|moz]-extension://<uuid>/" with "/"
    el.href = baseUrl + el.href.replace(/^(.+:\/\/.+\/)/i, "/");
    el.target = "_blank";
    if ("href" in el.dataset) el.dataset.href = baseUrl + el.dataset.href;
  });
}

export function applyBootstrapTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const theme = root.getAttribute("data-bs-theme");

  const applyTheme = () => {
    if (theme === "auto") {
      root.setAttribute("data-bs-theme", prefersDark.matches ? "dark" : "light");
      return true;
    }

    return false;
  };

  if (applyTheme()) {
    prefersDark.addEventListener("change", applyTheme);
  }
}

export function setVersion(version: string) {
  $("#version").replace({ VERSION: version });
}

export function $(query: string, parent?: { elements: NodeListOf<HTMLElement> }) {
  const elements = (parent?.elements[0] || document).querySelectorAll<HTMLElement>(query);

  return {
    elements,
    $(query: string) {
      return $(query, this);
    },
    visibleWhen(truthy: unknown) {
      if (truthy) this.show();
      else this.hide();
      return this;
    },
    hiddenWhen(truthy: unknown) {
      if (truthy) this.hide();
      else this.show();
      return this;
    },
    title(title: string, when?: boolean) {
      if (when !== undefined && !when) return this;
      iterateElements(elements, (el) => (el.title = title));
      return this;
    },
    show() {
      iterateElements(elements, (el) => (el.hidden = false));
      return this;
    },
    hide() {
      iterateElements(elements, (el) => (el.hidden = true));
      return this;
    },
    text(value?: string) {
      if (value) iterateElements(elements, (el) => (el.innerText = value));
      return (elements[0] as HTMLElement).innerText;
    },
    replace(values: Record<string, string>) {
      iterateElements(elements, (el) =>
        Object.entries(values).forEach(([placeholder, replacement]) => {
          el.innerText = el.innerText.replace(`{${placeholder}}`, replacement);
        })
      );
      return this;
    },
    addClass(className: string | string[], when?: boolean) {
      if (when !== undefined && !when) return this;
      iterateElements(elements, (el) =>
        ((Array.isArray(className) && className) || [className]).forEach((name) => {
          el.classList.add(name);
        })
      );
      return this;
    },
    removeClass(className: string | string[], when?: boolean) {
      if (when !== undefined && !when) return this;
      iterateElements(elements, (el) =>
        ((Array.isArray(className) && className) || [className]).forEach((name) => {
          el.classList.remove(name);
        })
      );
      return this;
    },
    href(url?: string) {
      if (url !== undefined) {
        iterateElements<HTMLLinkElement>(elements, (el) => (el.href = url));
        return this;
      }
      return (elements[0] as HTMLLinkElement)?.href || "";
    },
    dataset(prop: string, value?: string) {
      if (value !== undefined) {
        iterateElements<HTMLLinkElement>(elements, (el) => (el.dataset[prop as keyof DOMStringMap] = value));
        return this;
      }
      return (elements[0] as HTMLLinkElement).dataset[prop];
    },
    onClick(fn: (e: Event) => void) {
      iterateElements<HTMLLinkElement>(elements, (el) =>
        el.addEventListener("click", (e) => {
          e.preventDefault();
          return fn(e);
        })
      );
      return this;
    },
  };
}
