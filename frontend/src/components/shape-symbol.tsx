import Image from "next/image";

export function ShapeSymbol({ className = "" }: { className?: string }) {
  return <Image className={className} src="/shape-symbol.png" width={256} height={256} alt="SHAPE S 심볼" priority />;
}
