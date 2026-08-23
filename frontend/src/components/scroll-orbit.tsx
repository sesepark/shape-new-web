import { ArrowDown } from "lucide-react";

export function ScrollOrbit({ href = "#content" }: { href?: string }) {
  return <a className="scroll-orbit" href={href} aria-label="본문으로 이동">
    <svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="scroll-circle" d="M50,50 m-35,0 a35,35 0 1,1 70,0 a35,35 0 1,1 -70,0" /></defs><text><textPath href="#scroll-circle">SHAPE · SNU · PHYSICAL AI · </textPath></text></svg>
    <ArrowDown />
  </a>;
}
