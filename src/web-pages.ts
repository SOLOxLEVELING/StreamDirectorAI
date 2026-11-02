export function page(title: string, entry: string, overlay = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/${entry}.css"></head><body${overlay ? ' class="overlay-body"' : ''}><div id="root"></div><script type="module" src="/assets/${entry}.js"></script></body></html>`;
}
