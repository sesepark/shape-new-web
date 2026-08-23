"use client";

import { useCallback, useState } from "react";
import { RobotModel, type Robot } from "@/components/robot-model";

const robotCopy: Record<Robot, { tab: string; label: string; title: string; description: string; axis: string }> = {
  worker: {
    tab: "AI Worker",
    label: "01 · AI WORKER",
    title: "Make the physical world move.",
    description: "감지하고, 판단하고, 손을 움직이는 AI Worker를 탐구합니다.",
    axis: "MANIPULATION",
  },
  sapiens: {
    tab: "AI Sapiens",
    label: "02 · AI SAPIENS",
    title: "Intelligence, embodied.",
    description: "현실 공간에서 균형을 잡고 행동하는 AI Sapiens를 탐구합니다.",
    axis: "LOCOMOTION",
  },
  omy: {
    tab: "OMY",
    label: "03 · OMY",
    title: "Precision, joint by joint.",
    description: "정밀한 파지와 조작 데이터를 쌓아 올리는 로봇 팔 OMY를 다룹니다.",
    axis: "GRASPING",
  },
};

export function HomeRobotStage() {
  const [active, setActive] = useState<Robot>("worker");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  // Hovering or touching a tab is the earliest reliable signal that a visitor
  // wants that robot, so its model download starts before the click lands.
  const [preload, setPreload] = useState<Robot[]>([]);
  const want = useCallback((robot: Robot) => {
    setPreload((current) => (current.includes(robot) ? current : [...current, robot]));
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1)),
      y: Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1)),
    });
  }, []);

  const style = {
    "--pointer-x": pointer.x.toFixed(3),
    "--pointer-y": pointer.y.toFixed(3),
  } as React.CSSProperties;
  const content = robotCopy[active];

  return (
    <section className="home-robot-stage" onPointerMove={onPointerMove} style={style}>
      <div className="robot-copy" aria-live="polite">
        <p>{content.label}</p>
        <h2>{content.title}</h2>
        <span>{content.description}</span>
      </div>
      <div className="robot-switch" role="tablist" aria-label="로봇 모델 선택">
        {(Object.keys(robotCopy) as Robot[]).map((robot) => (
          <button
            key={robot}
            type="button"
            role="tab"
            aria-selected={active === robot}
            className={active === robot ? "active" : ""}
            onPointerEnter={() => want(robot)}
            onFocus={() => want(robot)}
            onClick={() => { want(robot); setActive(robot); }}
          >
            {robotCopy[robot].tab}
          </button>
        ))}
      </div>
      <div className={`robot-visual is-${active}`} aria-hidden="true">
        <div className="robot-halo" />
        <RobotModel active={active} pointer={pointer} preload={preload} />
        <span className="robot-coordinate">{content.axis}</span>
      </div>
    </section>
  );
}
