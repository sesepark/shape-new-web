/** 문장 안에 숨어 있는 이름. 이 다섯 글자만 색을 달리합니다. */
const NAME = "SHAPE";

/**
 * 낱말마다 첫 글자가 이름의 다음 글자인지 표시해 돌려줍니다.
 * 첫 글자를 무조건 칠하면 이름을 다 쓴 뒤의 낱말(AI)의 A 까지 파래집니다.
 */
function spell(text: string) {
  let next = 0;
  return text.split(" ").map((word) => {
    const named = next < NAME.length && word.slice(0, 1).toUpperCase() === NAME[next];
    if (named) next += 1;
    return { word, named };
  });
}

/**
 * "SNU Humanoid And Physical Embodied AI" 를 이름이 드러나게 씁니다.
 * S·H·A·P·E 가 문장 안에서 그대로 읽히도록 만든 표기라, 그 다섯 글자가
 * 나머지 글자와 색으로 갈라져야 이름의 유래가 눈에 들어옵니다.
 */
export function ShapeWordmark({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`shape-wordmark ${className}`.trim()}>
      {spell(text).map(({ word, named }, index) => (
        <span key={`${word}-${index}`}>
          {index > 0 ? " " : ""}
          {named ? <b>{word.slice(0, 1)}</b> : word.slice(0, 1)}
          {word.slice(1)}
        </span>
      ))}
    </p>
  );
}
