// Fire-and-forget DOM particles using the Web Animations API.

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function burst(
  x: number,
  y: number,
  { colors = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff"], count = 14, spread = 90, size = 8, gravity = 0, shape = "circle" as "circle" | "square" } = {}
) {
  if (typeof document === "undefined" || reduced()) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    const s = size * (0.6 + Math.random() * 0.8);
    el.style.cssText = `position:fixed;left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px;border-radius:${shape === "circle" ? "50%" : "2px"};background:${colors[i % colors.length]};pointer-events:none;z-index:9999;`;
    document.body.appendChild(el);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = spread * (0.5 + Math.random() * 0.7);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const rot = Math.random() * 720 - 360;
    const anim = el.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px,${dy + gravity * 0.4}px) rotate(${rot / 2}deg) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx * 1.1}px,${dy + gravity}px) rotate(${rot}deg) scale(0.4)`, opacity: 0 },
      ],
      { duration: 600 + Math.random() * 400, easing: "cubic-bezier(.15,.7,.3,1)" }
    );
    anim.onfinish = () => el.remove();
  }
}

export function ring(x: number, y: number, color = "#ff4d6d", size = 200) {
  if (typeof document === "undefined" || reduced()) return;
  const el = document.createElement("span");
  el.style.cssText = `position:fixed;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;border:4px solid ${color};pointer-events:none;z-index:9999;`;
  document.body.appendChild(el);
  el.animate(
    [
      { transform: "scale(0.2)", opacity: 0.9 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: 500, easing: "cubic-bezier(.2,.8,.3,1)" }
  ).onfinish = () => el.remove();
}

export function floatText(x: number, y: number, text: string, color = "#fff") {
  if (typeof document === "undefined") return;
  const el = document.createElement("span");
  el.textContent = text;
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);font:700 18px var(--font-press-start), monospace;color:${color};text-shadow:0 2px 0 #0008;pointer-events:none;z-index:9999;white-space:nowrap;`;
  document.body.appendChild(el);
  el.animate(
    [
      { transform: "translate(-50%,-50%) scale(0.6)", opacity: 0 },
      { transform: "translate(-50%,-120%) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%,-260%) scale(1)", opacity: 0 },
    ],
    { duration: 800, easing: "ease-out" }
  ).onfinish = () => el.remove();
}

export function shake(target: HTMLElement | null, intensity = 6) {
  if (!target || reduced()) return;
  const k = [0, -1, 1, -0.8, 0.8, -0.4, 0.4, 0].map((m) => ({
    transform: `translate(${m * intensity}px, ${m * intensity * -0.5}px)`,
  }));
  target.animate(k, { duration: 320, easing: "linear" });
}

export function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
