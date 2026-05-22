// Reads data-bg/data-initial from a failed avatar <img> and swaps in a styled
// fallback. Doing this from a real error listener (rather than inline onerror)
// avoids the double-decoding trap where a name starting with a single quote
// would break the JS string literal.
export function installAvatarFallback(img: HTMLImageElement | null): void {
  if (!img) return;
  img.addEventListener("error", () => {
    const tag = img.dataset.fallbackTag || "div";
    const fb = document.createElement(tag);
    fb.className = img.dataset.fallbackClass || "";
    if (img.dataset.bg) fb.style.background = img.dataset.bg;
    if (img.dataset.initial) fb.textContent = img.dataset.initial;
    img.replaceWith(fb);
  });
}
