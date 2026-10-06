import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';

/** A parsed page with scripts and styles still in place (the Wowhead parser reads inline scripts). */
export const parseHtml = (html: string): HTMLElement =>
  parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The page's visible text, whitespace collapsed: what a quote must be found in. */
export function pageText(root: HTMLElement): string {
  const copy = parseHtml(root.toString());
  for (const el of copy.querySelectorAll('script, style, noscript, template, svg')) el.remove();
  return collapse(copy.textContent);
}

export function pageTitle(root: HTMLElement): string | null {
  const t = root.querySelector('title')?.textContent;
  return t ? collapse(t) || null : null;
}

/** When the page says it was last updated (meta tags or JSON-LD `dateModified`), else null. */
export function pageUpdatedAt(root: HTMLElement): Date | null {
  const metas = ['article:modified_time', 'og:updated_time', 'last-modified', 'dateModified'];
  for (const m of root.querySelectorAll('meta')) {
    const key = m.getAttribute('property') ?? m.getAttribute('name') ?? m.getAttribute('itemprop');
    const content = m.getAttribute('content');
    if (key && content && metas.includes(key)) {
      const d = new Date(content);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    const m = /"dateModified"\s*:\s*"([^"]+)"/.exec(s.textContent);
    if (m?.[1]) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** Whether `quote` appears in `text`, ignoring case, whitespace and typographic quotes/dashes. */
export function containsQuote(text: string, quote: string): boolean {
  const norm = (s: string) =>
    collapse(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}

export { collapse };
