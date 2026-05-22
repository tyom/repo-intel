// Horizontal drag-to-pan (with inertia + edge masks) for .scroll-row strips, and
// the sidebar scroll-spy that highlights the active nav link. Ported verbatim.

export function initScrollRows(): void {
  document.querySelectorAll<HTMLElement>(".scroll-row").forEach((row) => {
    let isDown = false,
      startX = 0,
      scrollLeft = 0,
      lastX = 0,
      lastTime = 0,
      velocity = 0,
      animId: number | null = null;
    function stopInertia(): void {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }
    function inertiaScroll(): void {
      if (Math.abs(velocity) < 0.5) return;
      row.scrollLeft -= velocity;
      velocity *= 0.95;
      animId = requestAnimationFrame(inertiaScroll);
    }
    row.addEventListener("mousedown", (e) => {
      stopInertia();
      isDown = true;
      row.classList.add("dragging");
      startX = e.pageX - row.offsetLeft;
      scrollLeft = row.scrollLeft;
      lastX = e.pageX;
      lastTime = Date.now();
      velocity = 0;
    });
    row.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - row.offsetLeft;
      row.scrollLeft = scrollLeft - (x - startX);
      const now = Date.now(),
        dt = now - lastTime;
      if (dt > 0) {
        velocity = ((e.pageX - lastX) / dt) * 16;
        lastX = e.pageX;
        lastTime = now;
      }
    });
    function release(): void {
      if (!isDown) return;
      isDown = false;
      row.classList.remove("dragging");
      if (Math.abs(velocity) > 0.5) animId = requestAnimationFrame(inertiaScroll);
    }
    row.addEventListener("mouseup", release);
    row.addEventListener("mouseleave", release);

    function updateScrollMask(): void {
      const canLeft = row.scrollLeft > 0;
      const canRight = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      row.classList.toggle("can-scroll-left", canLeft);
      row.classList.toggle("can-scroll-right", canRight);
    }
    row.addEventListener("scroll", updateScrollMask, { passive: true });
    new ResizeObserver(updateScrollMask).observe(row);
    requestAnimationFrame(updateScrollMask);
  });
}

export function initSidebar(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a"));
  if (!links.length) return;
  const linkMap = new Map<string, HTMLAnchorElement>();
  const sections: HTMLElement[] = [];
  links.forEach((a) => {
    const id = a.getAttribute("href")!.slice(1);
    const el = document.getElementById(id);
    if (el) {
      linkMap.set(id, a);
      sections.push(el);
    }
  });
  if (!sections.length) return;
  let currentId: string | null = null;
  let queued = false;
  let clickLockUntil = 0;
  function setActive(id: string): void {
    if (id === currentId) return;
    currentId = id;
    links.forEach((a) => a.classList.toggle("active", a === linkMap.get(id)));
  }
  function update(): void {
    queued = false;
    if (Date.now() < clickLockUntil) return;
    const activation = 80;
    let activeId = sections[0].id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= activation) activeId = s.id;
      else break;
    }
    setActive(activeId);
  }
  function onScroll(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  function releaseLock(): void {
    clickLockUntil = 0;
  }
  links.forEach((link) => {
    link.addEventListener("click", () => {
      const id = link.getAttribute("href")!.slice(1);
      if (!linkMap.has(id)) return;
      setActive(id);
      clickLockUntil = Date.now() + 1500;
    });
  });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("scrollend", releaseLock, { passive: true });
  window.addEventListener("wheel", releaseLock, { passive: true });
  window.addEventListener("touchstart", releaseLock, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) releaseLock();
  });
  update();
}
