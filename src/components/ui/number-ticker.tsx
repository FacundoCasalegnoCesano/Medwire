"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 580;

/** Counts from zero to the supplied integer once after mounting. */
export function NumberTicker({ value }: { value: number }) {
  const target = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const [displayValue, setDisplayValue] = useState(target);
  const [previousTarget, setPreviousTarget] = useState(target);
  const hasAnimated = useRef(false);

  if (previousTarget !== target) {
    setPreviousTarget(target);
    setDisplayValue(target);
  }

  useEffect(() => {
    if (hasAnimated.current) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (target === 0 || motionPreference.matches) {
      hasAnimated.current = true;
      return;
    }

    let frame = 0;
    let startTime: number | undefined;
    let finished = false;

    const tick = (now: number) => {
      hasAnimated.current = true;
      startTime ??= now;
      const progress = Math.min((now - startTime) / DURATION_MS, 1);
      // Ease out cubic: quick initial movement with a gentle stop.
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(target * eased));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        finished = true;
      }
    };

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches && !finished) {
        window.cancelAnimationFrame(frame);
        finished = true;
        setDisplayValue(target);
      }
    };

    motionPreference.addEventListener("change", handleMotionPreferenceChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      motionPreference.removeEventListener("change", handleMotionPreferenceChange);
    };
  }, [target]);

  const formattedValue = new Intl.NumberFormat("en").format(target);

  return (
    <span
      style={{
        display: "inline-grid",
        minWidth: `${formattedValue.length}ch`,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span className="sr-only">{formattedValue}</span>
      <span aria-hidden="true">
        {new Intl.NumberFormat("en").format(displayValue)}
      </span>
    </span>
  );
}
