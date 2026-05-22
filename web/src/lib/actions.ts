// Reusable element directives (Svelte actions) for the popovers.
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
