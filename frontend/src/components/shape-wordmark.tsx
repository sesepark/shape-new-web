/**
 * "SNU Humanoid And Physical Embodied AI" 를 낱말 첫 글자만 파랗게 씁니다.
 * S·H·A·P·E 가 문장 안에서 그대로 읽히도록 만든 표기라, 그 다섯 글자가
 * 나머지 글자와 색으로 갈라져야 이름의 유래가 눈에 들어옵니다.
 */
export function ShapeWordmark({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`shape-wordmark ${className}`.trim()}>
      {text.split(" ").map((word, index) => (
        <span key={`${word}-${index}`}>
          {index > 0 ? " " : ""}
          <b>{word.slice(0, 1)}</b>
          {word.slice(1)}
        </span>
      ))}
    </p>
  );
}
