"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

export function TopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 120);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return <button className={`top-button${visible ? " visible" : ""}`} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="페이지 상단으로 이동"><ArrowUp size={16} /></button>;
}
