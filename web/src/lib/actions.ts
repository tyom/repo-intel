// Reusable element directives (Svelte actions).
//  - portal / position: power the body-portaled popovers + timeline tooltip.
//  - dragScroll / scrollSpy: the pattern-row drag-to-pan and sidebar scroll-spy
//    (formerly the imperative initScrollRows / initSidebar in interactions.ts).
//
//  - portal: relocate the node to <body> so its position:fixed isn't trapped by
//    an ancestor's transform/filter/contain (which would create a containing
//    block) and its z-index isn't clipped by a stacking context.
//  - position: measure-then-place AND own the .visible class, so the popover is
//    never painted at a stale position. The action's update() runs after each
//    DOM render, so offsetWidth/Height reflect the freshly rendered content —
//    no flushSync needed.

export function portal(node: HTMLElement, target: HTMLElement = document.body) {
  target.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}

interface Metrics {
  w: number;
  h: number;
  vw: number;
  vh: number;
}

export interface PositionParams {
  visible: boolean;
  // Given the measured popover + viewport, return the clamped {left, top}, or
  // null to leave the popover hidden (e.g. no anchor yet).
  place: (m: Metrics) => { left: number; top: number } | null;
  // Unused by the action — its only job is to be read in the params expression
  // so Svelte re-runs update() when it changes. Element-anchored popovers don't
  // need it (visible flips when they open); a cursor-follower passes the live
  // {x, y} here so it repositions on every mousemove. See TimelineTooltip.svelte.
  deps?: unknown;
}

export function position(node: HTMLElement, params: PositionParams) {
  function apply(p: PositionParams): void {
    if (!p.visible) {
      node.classList.remove("visible");
      return;
    }
    // Measure off-screen first so the box wraps to its final content width
    // before we compute the placement.
    node.style.left = "-9999px";
    node.style.top = "0px";
    const m: Metrics = {
      w: node.offsetWidth,
      h: node.offsetHeight,
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
    const pos = p.place(m);
    if (!pos) {
      node.classList.remove("visible");
      return;
    }
    node.style.left = pos.left + "px";
    node.style.top = pos.top + "px";
    node.classList.add("visible");
  }

  apply(params);
  return { update: apply };
}

// Horizontal drag-to-pan (with inertia + edge fade masks) for a .scroll-row strip
// — the hour/dow pattern rows. Was initScrollRows() in interactions.ts, now a
// per-element action so each row owns its own listeners and cleanup.
export function dragScroll(row: HTMLElement) {
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
  function onMouseDown(e: MouseEvent): void {
    stopInertia();
    isDown = true;
    row.classList.add("dragging");
    startX = e.pageX - row.offsetLeft;
    scrollLeft = row.scrollLeft;
    lastX = e.pageX;
    lastTime = Date.now();
    velocity = 0;
  }
  function onMouseMove(e: MouseEvent): void {
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
  }
  function release(): void {
    if (!isDown) return;
    isDown = false;
    row.classList.remove("dragging");
    if (Math.abs(velocity) > 0.5) animId = requestAnimationFrame(inertiaScroll);
  }
  function updateScrollMask(): void {
    row.classList.toggle("can-scroll-left", row.scrollLeft > 0);
    row.classList.toggle(
      "can-scroll-right",
      row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
    );
  }
  row.addEventListener("mousedown", onMouseDown);
  row.addEventListener("mousemove", onMouseMove);
  row.addEventListener("mouseup", release);
  row.addEventListener("mouseleave", release);
  row.addEventListener("scroll", updateScrollMask, { passive: true });
  const ro = new ResizeObserver(updateScrollMask);
  ro.observe(row);
  requestAnimationFrame(updateScrollMask);

  return {
    destroy() {
      stopInertia();
      ro.disconnect();
      row.removeEventListener("mousedown", onMouseDown);
      row.removeEventListener("mousemove", onMouseMove);
      row.removeEventListener("mouseup", release);
      row.removeEventListener("mouseleave", release);
      row.removeEventListener("scroll", updateScrollMask);
    },
  };
}

// Sidebar scroll-spy: highlights the nav link of the section nearest the top.
// Applied to the <nav>; resolves its own links → sections via each link's href.
// Was initSidebar() in interactions.ts. A click "locks" the active link briefly
// so the smooth-scroll to the target doesn't flicker through intermediate ones.
export function scrollSpy(nav: HTMLElement) {
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"));
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
  function onClick(e: Event): void {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    const id = link.getAttribute("href")!.slice(1);
    if (!linkMap.has(id)) return;
    setActive(id);
    clickLockUntil = Date.now() + 1500;
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key))
      releaseLock();
  }
  nav.addEventListener("click", onClick);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("scrollend", releaseLock, { passive: true });
  window.addEventListener("wheel", releaseLock, { passive: true });
  window.addEventListener("touchstart", releaseLock, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  update();

  return {
    destroy() {
      nav.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scrollend", releaseLock);
      window.removeEventListener("wheel", releaseLock);
      window.removeEventListener("touchstart", releaseLock);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
