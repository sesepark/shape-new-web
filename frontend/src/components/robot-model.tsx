"use client";

import { useEffect, useRef } from "react";
import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";

export type Robot = "worker" | "sapiens" | "omy" | "so101";

// ROS uses Z-up and every robot's front is its X axis. After converting to
// Three.js Y-up, this quarter turn presents the robot to the camera.
const FACING = -Math.PI / 2;
const MODEL_VERSION = "20260824-2";
const SIDES = ["left", "right"] as const;
// `pose` 는 URDF 의 0 자세가 화면에 어울리지 않을 때 쓰는 시작 자세입니다.
// 가운데 맞추기 전에 적용하므로 이 자세 그대로 화면 중앙에 놓이고, 아래
// 애니메이션의 각도는 모두 이 자세를 기준으로 한 차이가 됩니다.
// `facing` 은 그 로봇만 기본 방향에서 더 돌려 보여 줄 때 쓰는 각도입니다.
type Pose = readonly (readonly [string, "x" | "y" | "z", number])[];
const MODELS: Record<Robot, { file: string; scale: number; pose?: Pose; facing?: number }> = {
  worker: { file: "ai-worker", scale: 2.05 },
  sapiens: { file: "ai-sapiens", scale: 2.55 },
  omy: { file: "omy", scale: 3.7 },
  // SO-ARM 101 은 실물이 24cm 남짓이라 같은 화면을 채우려면 배율이 큽니다.
  // URDF 0 자세는 팔이 앞으로 완전히 뻗어 누운 모습이라, 어깨를 세우고 팔꿈치를
  // 펴 집게가 베이스보다 위에서 앞으로 나온 대기 자세로 세워 둡니다. 옆에서만
  // 보면 팔이 겹쳐 보여서, 이 로봇만 조금 더 돌려 베이스와 집게가 함께 보이게
  // 합니다.
  so101: {
    file: "so-arm101",
    scale: 11.5,
    facing: -0.63,
    pose: [
      ["upper_arm_link", "z", -1.2],
      ["lower_arm_link", "z", 0.6],
      ["wrist_link", "z", 0.4],
    ],
  },
};
const ROBOTS = Object.keys(MODELS) as Robot[];
const facingFor = (robot: Robot) => FACING + (MODELS[robot].facing ?? 0);

export function RobotModel({ active, pointer, preload = [] }: { active: Robot; pointer: { x: number; y: number }; preload?: Robot[] }) {
  const host = useRef<HTMLDivElement>(null);
  const models = useRef<Partial<Record<Robot, Group>>>({});
  const activeRef = useRef(active);
  const pointerRef = useRef(pointer);
  const preloadRef = useRef(preload);
  useEffect(() => {
    activeRef.current = active;
    pointerRef.current = pointer;
    preloadRef.current = preload;
  });

  useEffect(() => {
    const element = host.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const mount = element;
    let renderer: WebGLRenderer | undefined;
    let camera: PerspectiveCamera | undefined;
    let scene: Scene | undefined;
    let frame = 0;
    let visible = true;
    let disposed = false;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.05 });
    observer.observe(mount);

    async function start() {
      const [{ AmbientLight, Box3, DirectionalLight, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer }, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three"), import("three/examples/jsm/loaders/GLTFLoader.js"), import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      if (disposed) return;
      scene = new Scene();
      camera = new PerspectiveCamera(31, 1, 0.1, 100);
      camera.position.set(0, .2, 8.2);
      camera.lookAt(0, 0, 0);
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
      renderer.outputColorSpace = "srgb";
      mount.replaceChildren(renderer.domElement);
      scene.add(new AmbientLight(0xffffff, 2.1));
      const key = new DirectionalLight(0xdce7ff, 3.2); key.position.set(3, 6, 5); scene.add(key);
      const fill = new DirectionalLight(0x7398ff, 1.8); fill.position.set(-4, 2, 3); scene.add(fill);
      const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);

      const prepare = (model: Group, robot: Robot, { scale, pose }: { scale: number; pose?: Pose }) => {
        pose?.forEach(([name, axis, angle]) => {
          const joint = model.getObjectByName(name);
          if (joint) joint.rotation[axis] += angle;
        });
        model.traverse((node) => {
          node.userData.restRotation = node.rotation.clone();
          node.userData.restPosition = node.position.clone();
        });
        model.scale.setScalar(scale);
        model.rotation.set(-Math.PI / 2, 0, 0);
        model.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        model.position.set(-center.x, -center.y, -center.z);
        const pivot = new Group();
        pivot.name = `${model.name}-display`;
        pivot.rotation.y = facingFor(robot);
        pivot.add(model);
        return pivot;
      };
      // Visitors usually stay on the first tab, so only the selected robot is
      // downloaded up front and the rest follow once the browser is idle.
      const requested = new Set<Robot>();
      const ensure = (robot: Robot) => {
        if (disposed || requested.has(robot)) return;
        requested.add(robot);
        loader.loadAsync(`/models/${MODELS[robot].file}.glb?v=${MODEL_VERSION}`)
          .then((gltf) => {
            if (disposed || !scene) return;
            const pivot = prepare(gltf.scene, robot, MODELS[robot]);
            pivot.visible = robot === activeRef.current;
            models.current[robot] = pivot;
            scene.add(pivot);
          })
          .catch(() => requested.delete(robot));
      };
      ensure(activeRef.current);

      const resize = () => { if (!renderer || !camera) return; const { width, height } = mount.getBoundingClientRect(); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
      resize(); window.addEventListener("resize", resize, { passive: true });
      // Each URDF joint became a named group whose rest transform is the joint
      // origin, so easing one Euler component is the joint's own rotation. A
      // joint whose URDF axis is negative takes the negated value.
      const moveJoint = (robot: Robot, name: string, axis: "x" | "y" | "z", target: number) => {
        const joint = models.current[robot]?.getObjectByName(name);
        const rest = joint?.userData.restRotation;
        if (!joint || !rest) return;
        joint.rotation[axis] += (rest[axis] + target - joint.rotation[axis]) * .1;
      };
      const render = () => {
        frame = requestAnimationFrame(render);
        if (!visible || !renderer || !camera || !scene) return;
        const current = activeRef.current;
        ensure(current);
        // The stage asks for a robot as soon as its tab is hovered or touched,
        // so nobody downloads a model they never look at.
        preloadRef.current.forEach(ensure);
        const focus = models.current[current];
        const { x, y } = pointerRef.current;
        // Touch devices never report a pointer, so the idle waves keep every
        // robot alive on mobile while the pointer terms lead on desktop.
        const seconds = performance.now() / 1000;
        const breathe = Math.sin(seconds * 1.1);
        const sway = Math.sin(seconds * .62);
        const swing = Math.sin(seconds * .85);
        for (const robot of ROBOTS) {
          const model = models.current[robot];
          if (model) model.visible = robot === current;
        }
        if (focus) focus.rotation.y += (facingFor(current) + x * .08 - focus.rotation.y) * .055;
        if (current === "worker") {
          moveJoint("worker", "arm_r_link1", "y", x * .55 + swing * .07);
          moveJoint("worker", "arm_r_link2", "x", -1.05 + x * .72 + y * .18 + breathe * .06);
          moveJoint("worker", "arm_r_link3", "z", x * -.5 + y * .22 + sway * .08);
          moveJoint("worker", "arm_r_link4", "y", -.32 + y * -.32 - swing * .09);
          moveJoint("worker", "arm_r_link7", "x", x * .45 + breathe * .12);
          moveJoint("worker", "arm_l_link1", "y", x * .22 - swing * .07);
          moveJoint("worker", "arm_l_link2", "x", .78 - x * .48 + y * .12 - breathe * .06);
          moveJoint("worker", "arm_l_link3", "z", x * .24 - sway * .08);
          // The head only turns a third of a radian either way, so the pointer
          // term is scaled to stay inside the joint limits.
          moveJoint("worker", "head_link1", "y", .12 + y * .18);
          moveJoint("worker", "head_link2", "z", x * .3 + sway * .05);
          for (const side of ["r", "l"] as const) {
            const grip = .5 + Math.sin(seconds * .9 + (side === "l" ? Math.PI / 2 : 0)) * .45;
            moveJoint("worker", `gripper_${side}_rh_p12_rn_r1`, "x", grip);
            moveJoint("worker", `gripper_${side}_rh_p12_rn_r2`, "x", -grip);
            moveJoint("worker", `gripper_${side}_rh_p12_rn_l1`, "x", -grip);
            moveJoint("worker", `gripper_${side}_rh_p12_rn_l2`, "x", grip);
          }
        } else if (current === "sapiens") {
          moveJoint("sapiens", "torso_link", "z", x * .18 + sway * .05);
          for (const side of SIDES) {
            // Shoulder roll only opens away from the torso in the K1 limits, so
            // the right arm mirrors the left across every arm joint.
            const mirror = side === "left" ? 1 : -1;
            moveJoint("sapiens", `${side}_shoulder_pitch_link`, "y", -.12 + y * .28 + swing * .12 * mirror);
            moveJoint("sapiens", `${side}_shoulder_roll_link`, "x", mirror * (.17 + Math.abs(x) * .2 + breathe * .05));
            moveJoint("sapiens", `${side}_shoulder_yaw_link`, "z", mirror * x * .16);
            moveJoint("sapiens", `${side}_elbow_link`, "y", .72 - Math.abs(y) * .25 + swing * .1 * mirror);
            moveJoint("sapiens", `${side}_wrist_roll_rubber_hand`, "x", mirror * breathe * .18);
          }
        } else if (current === "so101") {
          // 여섯 관절 모두 URDF 축이 +Z 라 링크 그룹의 z 회전이 곧 관절 각도이고,
          // 값은 대기 자세에서의 차이라 URDF 의 limit 안에 들어갑니다.
          moveJoint("so101", "shoulder_link", "z", x * .7 + sway * .2);
          moveJoint("so101", "upper_arm_link", "z", y * .22 + breathe * .1);
          moveJoint("so101", "lower_arm_link", "z", -y * .2 + swing * .16);
          moveJoint("so101", "wrist_link", "z", y * .18 - breathe * .12);
          moveJoint("so101", "gripper_link", "z", x * .5 + sway * .35);
          // 집게는 한쪽 턱만 움직이고, 열림 한계가 1.75rad 입니다.
          moveJoint("so101", "moving_jaw_so101_v1_link", "z", .8 + Math.sin(seconds * .9) * .7);
        } else {
          moveJoint("omy", "link1", "z", x * .5 + sway * .12);
          moveJoint("omy", "link2", "y", .78 + swing * .16 + y * .18);
          moveJoint("omy", "link3", "y", .95 - swing * .22 - y * .12);
          moveJoint("omy", "link4", "y", -.62 + swing * .1);
          moveJoint("omy", "link5", "z", x * .35 + sway * .2);
          moveJoint("omy", "link6", "y", -.2 + breathe * .25);
          // The RH-P12-RN fingers all mimic rh_r1_joint, and the two joints
          // whose URDF axis is -X take the negated angle.
          const grip = .55 + Math.sin(seconds * .9) * .5;
          moveJoint("omy", "rh_p12_rn_r1", "x", grip);
          moveJoint("omy", "rh_p12_rn_r2", "x", -grip);
          moveJoint("omy", "rh_p12_rn_l1", "x", -grip);
          moveJoint("omy", "rh_p12_rn_l2", "x", grip);
        }
        renderer.render(scene, camera);
      };
      render();
      return () => { window.removeEventListener("resize", resize); };
    }
    let cleanup: (() => void) | undefined;
    start().then((value) => { cleanup = value; });
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); cleanup?.(); renderer?.dispose(); };
  }, []);
  return <div ref={host} className="robot-model-canvas" aria-hidden="true" />;
}
