/** 문장 안에 숨어 있는 이름. 이 다섯 글자만 색을 달리합니다. */
const NAME = "SHAPE";

/**
 * "SNU Humanoid And Physical Embodied AI" 를 낱말 첫 글자만 파랗게 씁니다.
 * S·H·A·P·E 가 문장 안에서 그대로 읽히도록 만든 표기라, 그 다섯 글자가
 * 나머지 글자와 색으로 갈라져야 이름의 유래가 눈에 들어옵니다.
 *
 * 첫 글자를 무조건 칠하지 않고 SHAPE 를 한 글자씩 따라가며 맞는 것만 칠하므로,
 * 이름을 다 쓰고 남는 낱말(AI)의 A 까지 파래지는 일이 없습니다.
 */
export function ShapeWordmark({ text, className = "" }: { text: string; className?: string }) {
  let next = 0;
  return (
    <p className={`shape-wordmark ${className}`.trim()}>
      {text.split(" ").map((word, index) => {
        const spelling = next < NAME.length && word.slice(0, 1).toUpperCase() === NAME[next];
        if (spelling) next += 1;
        return (
          <span key={`${word}-${index}`}>
            {index > 0 ? " " : ""}
            {spelling ? <b>{word.slice(0, 1)}</b> : word.slice(0, 1)}
            {word.slice(1)}
          </span>
        );
      })}
    </p>
  );
}
