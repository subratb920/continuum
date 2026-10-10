import { useState } from "react";

import "./DurationPicker.css";

const pad = (n) => String(n).padStart(2, "0");

function Chevron({ direction }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d={direction === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * DurationPicker
 * --------------
 * Reusable hours : minutes picker. Each box shows one value with an
 * up and down arrow, and can also be typed into (applied on Enter or
 * when leaving the box; Escape cancels). Arrow keys step the value.
 *
 * Props
 * - value          total minutes
 * - onChange(min)  called with the new total minutes
 * - min / max      limits in minutes (arrows stop; typed values clamp)
 * - step           minutes per click on the Minutes arrows
 * - defaultValue   value restored by Reset
 * - disabled
 */
export default function DurationPicker({
  value,
  onChange,
  min = 5,
  max = 90,
  step = 5,
  defaultValue = 30,
  disabled = false,
}) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  // Text being typed in a box (null = not editing that box)
  const [draft, setDraft] = useState({ hours: null, minutes: null });

  const clamp = (v) => Math.min(max, Math.max(min, v));

  function emit(next) {
    const clamped = clamp(next);
    if (clamped !== value) onChange(clamped);
  }

  // Total minutes after applying a typed value to one box
  function totalWithTyped(unitKey, text) {
    const n = parseInt(text, 10);
    if (Number.isNaN(n)) return null;
    return unitKey === "hours"
      ? n * 60 + minutes
      : hours * 60 + Math.min(59, n);
  }

  function commit(unitKey) {
    const text = draft[unitKey];
    if (text !== null) {
      const total = totalWithTyped(unitKey, text);
      if (total !== null) emit(total);
    }
    setDraft((d) => ({ ...d, [unitKey]: null }));
  }

  function stepBy(unitKey, delta) {
    // Apply anything being typed first, then step from that value
    const typed = draft[unitKey] !== null ? totalWithTyped(unitKey, draft[unitKey]) : null;
    const base = typed !== null ? clamp(typed) : value;
    setDraft((d) => ({ ...d, [unitKey]: null }));
    emit(base + delta);
  }

  const units = [
    { key: "hours", label: "Hours", current: hours, delta: 60 },
    { key: "minutes", label: "Minutes", current: minutes, delta: step },
  ];

  return (
    <div className={`duration-picker${disabled ? " is-disabled" : ""}`}>
      <div className="duration-picker-boxes">
        {units.map((unit, i) => (
          <div key={unit.key} className="duration-picker-unit-wrap">
            {i > 0 && <span className="duration-picker-sep">:</span>}

            <div className="duration-picker-unit">
              <span className="duration-picker-label">{unit.label}</span>

              <button
                type="button"
                className="duration-picker-arrow"
                onClick={() => stepBy(unit.key, unit.delta)}
                disabled={disabled || value >= max}
                aria-label={`Increase ${unit.label.toLowerCase()}`}
              >
                <Chevron direction="up" />
              </button>

              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                className="duration-picker-box"
                aria-label={unit.label}
                value={draft[unit.key] ?? pad(unit.current)}
                disabled={disabled}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setDraft((d) => ({ ...d, [unit.key]: digits }));
                }}
                onBlur={() => commit(unit.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(unit.key);
                    e.target.select();
                  } else if (e.key === "Escape") {
                    setDraft((d) => ({ ...d, [unit.key]: null }));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    stepBy(unit.key, unit.delta);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    stepBy(unit.key, -unit.delta);
                  }
                }}
              />

              <button
                type="button"
                className="duration-picker-arrow"
                onClick={() => stepBy(unit.key, -unit.delta)}
                disabled={disabled || value <= min}
                aria-label={`Decrease ${unit.label.toLowerCase()}`}
              >
                <Chevron direction="down" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="duration-picker-reset"
        onClick={() => {
          setDraft({ hours: null, minutes: null });
          emit(defaultValue);
        }}
        disabled={disabled || value === clamp(defaultValue)}
        title={`Reset to ${defaultValue} minutes`}
      >
        ↺ Reset
      </button>
    </div>
  );
}
