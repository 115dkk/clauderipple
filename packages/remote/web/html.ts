// Putting markup into the live document. Kept apart from dom.ts: everything in that file is a string
// builder with no browser at all, so the screens and their toasts/timelines can be rendered and
// checked in Node, and only the code that touches the document needs a document.

const lastHtml = new WeakMap<Element, string>();

/**
 * Replace a region only when its markup changed. Regions re-render every second for countdowns;
 * replacing an unchanged button under a thumb between touch-down and touch-up swallows the tap.
 */
export function setHTML(el: Element | null, html: string): void {
  if (!el || lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

/**
 * Keyed list patch: nodes whose key and version are unchanged stay in place (scroll position,
 * text selection and expanded state survive a streaming update); changed ones are replaced.
 */
export function patchList<T extends { key: string; ver: string }>(parent: HTMLElement, items: readonly T[], render: (item: T) => string): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    const k = child.dataset.key;
    if (k) existing.set(k, child);
    else child.remove();
  }
  let cursor: Element | null = parent.firstElementChild;
  const tpl = document.createElement("template");
  for (const item of items) {
    let node = existing.get(item.key);
    if (node && node.dataset.ver !== item.ver) {
      tpl.innerHTML = render(item).trim();
      const fresh = tpl.content.firstElementChild as HTMLElement;
      fresh.dataset.key = item.key;
      fresh.dataset.ver = item.ver;
      node.replaceWith(fresh);
      if (cursor === node) cursor = fresh;
      node = fresh;
    } else if (!node) {
      tpl.innerHTML = render(item).trim();
      node = tpl.content.firstElementChild as HTMLElement;
      node.dataset.key = item.key;
      node.dataset.ver = item.ver;
    }
    existing.delete(item.key);
    if (node !== cursor) parent.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const stale of existing.values()) stale.remove();
}
