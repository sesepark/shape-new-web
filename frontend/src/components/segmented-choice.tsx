"use client";

/**
 * 몇 안 되는 보기 중 하나를 고르는 띠. `.unit-switcher` 와 같은 모양입니다.
 *
 * `<select>` 를 쓰지 않는 이유는 보기가 서넛뿐이라서입니다. 눌러서 펼치고 다시
 * 고르는 두 동작 대신 한 번에 고르게 하고, 무엇을 고를 수 있는지도 열지 않고
 * 보입니다. 좁은 화면에서는 CSS 가 격자로 바꿔 줄을 맞춥니다.
 *
 * `data-level` 은 색 무게를 CSS 에 넘기기 위한 것입니다. 시급도처럼 보기마다
 * 색이 달라야 하는 경우, 클래스 이름을 문자열로 이어 붙이는 대신 값을 그대로
 * 속성에 실어 보냅니다.
 */
export function SegmentedChoice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  levelled,
}: {
  label: string;
  hint?: string;
  options: readonly (readonly [T, string])[];
  value: T | "";
  onChange: (value: T) => void;
  disabled?: boolean;
  levelled?: boolean;
}) {
  return (
    <div className="booking-choice" data-count={options.length}>
      <span className="booking-field-label">{label}</span>
      <div className="unit-switcher" role="radiogroup" aria-label={label}>
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            disabled={disabled}
            data-level={levelled ? key : undefined}
            className={value === key ? "active" : ""}
            onClick={() => onChange(key)}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}
