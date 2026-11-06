"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";
import styles from "./buttons.module.css";
import { sfx, setMuted } from "./sound";
import { burst, center, floatText, ring, shake } from "./particles";

function Card({ title, hint, children, wide }: { title: string; hint: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`${styles.card} ${wide ? styles.wide : ""}`}>
      <div className={styles.stage}>{children}</div>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.hint}>{hint}</p>
    </section>
  );
}

/* ---------- 1. The Big Red Button ---------- */
function BigRed({ onPress }: { onPress: () => void }) {
  const [n, setN] = useState(0);
  return (
    <button
      className={styles.bigRed}
      onClick={(e) => {
        sfx.thunk();
        const { x, y } = center(e.currentTarget);
        ring(x, y, "#ff4d6d", 260);
        burst(x, y, { colors: ["#ff4d6d", "#ff8fa3", "#fff"], count: 18, spread: 130 });
        setN((v) => v + 1);
        onPress();
      }}
    >
      <span className={styles.bigRedCap}>{n === 0 ? "DO NOT PRESS" : n}</span>
    </button>
  );
}

/* ---------- 2. Pop ---------- */
function Pop() {
  const [key, setKey] = useState(0);
  return (
    <button
      key={key}
      className={styles.pop}
      onClick={(e) => {
        sfx.pop(0.9 + Math.random() * 0.3);
        burst(e.clientX, e.clientY, { count: 16, spread: 100 });
        setKey((k) => k + 1);
      }}
    >
      POP
    </button>
  );
}

/* ---------- 3. Combo counter ---------- */
function Combo() {
  const [combo, setCombo] = useState(0);
  const [best, setBest] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div className={styles.col}>
      <button
        className={styles.combo}
        style={{ ["--heat" as string]: Math.min(combo / 30, 1) }}
        onClick={(e) => {
          const next = combo + 1;
          setCombo(next);
          setBest((b) => Math.max(b, next));
          // C major scale climbing up with the combo
          const scale = [0, 2, 4, 5, 7, 9, 11];
          const step = next - 1;
          const semis = scale[step % 7] + 12 * Math.floor(step / 7);
          sfx.note(261.63 * Math.pow(2, Math.min(semis, 36) / 12));
          const { x, y } = center(e.currentTarget);
          if (next % 10 === 0) {
            sfx.sparkle();
            burst(x, y, { count: 24, spread: 140 });
            floatText(x, y - 40, `${next} COMBO!`, "#ffd166");
          } else {
            floatText(x + (Math.random() * 40 - 20), y - 30, `+1`);
          }
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCombo(0), 900);
        }}
      >
        {combo}
      </button>
      <span className={styles.small}>best: {best}</span>
    </div>
  );
}

/* ---------- 4. Mechanical keys ---------- */
function Keys() {
  const letters = ["C", "L", "I", "C", "K"];
  return (
    <div className={styles.keys}>
      {letters.map((l, i) => (
        <button key={i} className={styles.key} onPointerDown={() => sfx.clack(0.85 + i * 0.07)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------- 5. Toggle switches ---------- */
function Switches() {
  const [on, setOn] = useState([false, true, false, false]);
  return (
    <div className={styles.switches}>
      {on.map((v, i) => (
        <button
          key={i}
          role="switch"
          aria-checked={v}
          className={`${styles.switch} ${v ? styles.switchOn : ""}`}
          onClick={() => {
            if (v) sfx.switchOff();
            else sfx.switchOn();
            setOn((arr) => arr.map((x, j) => (j === i ? !x : x)));
          }}
        >
          <span className={styles.knob} />
        </button>
      ))}
    </div>
  );
}

/* ---------- 6. Bubble wrap ---------- */
const BUBBLES = 24;
function BubbleWrap() {
  const [popped, setPopped] = useState<boolean[]>(() => Array(BUBBLES).fill(false));
  const [sheet, setSheet] = useState(0);
  const all = popped.every(Boolean);
  useEffect(() => {
    if (!all) return;
    const t = setTimeout(() => {
      setPopped(Array(BUBBLES).fill(false));
      setSheet((s) => s + 1);
    }, 700);
    return () => clearTimeout(t);
  }, [all]);
  return (
    <div className={styles.wrap} key={sheet}>
      {popped.map((p, i) => (
        <button
          key={i}
          aria-label={p ? "popped" : "bubble"}
          className={`${styles.bubble} ${p ? styles.bubblePopped : ""}`}
          onPointerDown={(e) => {
            if (p) return;
            sfx.pop(0.7 + Math.random() * 0.6);
            burst(e.clientX, e.clientY, { colors: ["#cfefff", "#ffffff"], count: 6, spread: 30, size: 5 });
            setPopped((arr) => arr.map((x, j) => (j === i ? true : x)));
          }}
        />
      ))}
    </div>
  );
}

/* ---------- 7. Arcade pads ---------- */
function Arcade() {
  const pads = [
    { c: "#ff4d6d", f: 261.63 },
    { c: "#ffd166", f: 293.66 },
    { c: "#06d6a0", f: 329.63 },
    { c: "#4cc9f0", f: 392.0 },
    { c: "#b388ff", f: 440.0 },
    { c: "#ff8fa3", f: 523.25 },
  ];
  return (
    <div className={styles.arcade}>
      {pads.map((p, i) => (
        <button
          key={i}
          className={styles.pad}
          style={{ ["--c" as string]: p.c }}
          onPointerDown={(e) => {
            sfx.note(p.f);
            const { x, y } = center(e.currentTarget);
            ring(x, y, p.c, 90);
          }}
          aria-label={`note ${i + 1}`}
        />
      ))}
    </div>
  );
}

/* ---------- 8. Jelly ---------- */
function Jelly() {
  const [k, setK] = useState(0);
  return (
    <button
      key={k}
      className={`${styles.jelly} ${k > 0 ? styles.jellyWobble : ""}`}
      onClick={() => {
        sfx.boing();
        setK((v) => v + 1);
      }}
    >
      boing
    </button>
  );
}

/* ---------- 9. Hold to charge ---------- */
function Charge() {
  const [power, setPower] = useState(0);
  const [launched, setLaunched] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const hum = useRef(0);
  const btn = useRef<HTMLButtonElement>(null);

  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = performance.now();
    hum.current = 0;
    const tick = () => {
      const p = Math.min((performance.now() - start.current) / 1500, 1);
      setPower(p);
      const step = Math.floor(p * 10);
      if (step > hum.current) {
        hum.current = step;
        sfx.note(200 + step * 60);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const up = () => {
    if (raf.current === null) return;
    cancelAnimationFrame(raf.current);
    raf.current = null;
    const p = Math.min((performance.now() - start.current) / 1500, 1);
    sfx.whoosh(p);
    if (btn.current) {
      const { x, y } = center(btn.current);
      burst(x, y, { count: 8 + Math.round(p * 30), spread: 60 + p * 200, colors: ["#ffd166", "#ff9f1c", "#fff"] });
      if (p >= 1) {
        ring(x, y, "#ffd166", 320);
        floatText(x, y - 50, "MAX POWER", "#ffd166");
      }
    }
    setLaunched((n) => n + 1);
    setPower(0);
  };
  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  return (
    <div className={styles.col}>
      <button
        ref={btn}
        className={styles.charge}
        style={{ ["--p" as string]: power }}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        {power > 0 ? `${Math.round(power * 100)}%` : "HOLD"}
      </button>
      <span className={styles.small}>launches: {launched}</span>
    </div>
  );
}

/* ---------- 10. Confetti ---------- */
function Confetti() {
  return (
    <button
      className={styles.confetti}
      onClick={(e) => {
        sfx.sparkle();
        const { x, y } = center(e.currentTarget);
        burst(x, y, { count: 40, spread: 220, gravity: 160, shape: "square", size: 9 });
      }}
    >
      🎉 Celebrate
    </button>
  );
}

/* ---------- 11. Squeaky duck ---------- */
function Duck() {
  const [squish, setSquish] = useState(false);
  return (
    <button
      className={`${styles.duck} ${squish ? styles.duckSquish : ""}`}
      onPointerDown={() => {
        sfx.squeak();
        setSquish(true);
      }}
      onPointerUp={() => setSquish(false)}
      onPointerLeave={() => setSquish(false)}
      aria-label="squeaky duck"
    >
      🦆
    </button>
  );
}

/* ---------- 12. Retro click ---------- */
function Retro() {
  return (
    <div className={styles.retroRow}>
      {["A", "B"].map((l) => (
        <button key={l} className={styles.retro} onPointerDown={() => sfx.click()}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function ButtonsPage() {
  const [muted, setMutedState] = useState(false);
  const [presses, setPresses] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setMuted(muted), [muted]);

  // Count every button press on the page.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("button")) setPresses((n) => n + 1);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <div ref={root} className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Button Bonanza</h1>
        <div className={styles.headerRight}>
          <span className={styles.counter}>{presses.toLocaleString()} presses</span>
          <button className={styles.mute} onClick={() => setMutedState((m) => !m)} aria-pressed={muted}>
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <main className={styles.grid}>
        <Card title="The Big Red Button" hint="You know you want to." wide>
          <BigRed onPress={() => shake(root.current, 8)} />
        </Card>
        <Card title="Pop" hint="Grows back every time.">
          <Pop />
        </Card>
        <Card title="Combo" hint="Click fast. Climb the scale.">
          <Combo />
        </Card>
        <Card title="Mechanical Keys" hint="Thocky.">
          <Keys />
        </Card>
        <Card title="Switches" hint="Flip 'em.">
          <Switches />
        </Card>
        <Card title="Bubble Wrap" hint="Pop them all for a fresh sheet." wide>
          <BubbleWrap />
        </Card>
        <Card title="Arcade Pads" hint="Play a little tune.">
          <Arcade />
        </Card>
        <Card title="Jelly" hint="Wobbly.">
          <Jelly />
        </Card>
        <Card title="Charge Shot" hint="Hold, then let go.">
          <Charge />
        </Card>
        <Card title="Confetti" hint="For no reason at all.">
          <Confetti />
        </Card>
        <Card title="Duck" hint="Squeeze.">
          <Duck />
        </Card>
        <Card title="A / B" hint="Crisp little clicks.">
          <Retro />
        </Card>
      </main>
    </div>
  );
}
