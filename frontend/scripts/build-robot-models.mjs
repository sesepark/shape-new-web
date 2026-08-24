import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Blob } from "node:buffer";
import { Euler, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// GLTFExporter uses FileReader; Node provides Blob but not FileReader.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`; this.onloadend?.(); }); }
};
globalThis.Blob = Blob;

const project = process.cwd();
const output = path.join(project, "public/models");
const stlLoader = new STLLoader();
const run = promisify(execFile);

function attr(value, name) {
  return value.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? "";
}
function vector(value, name, fallback = [0, 0, 0]) {
  const raw = attr(value, name);
  return raw ? raw.split(/\s+/).map(Number) : fallback;
}
function matrixFor(origin) {
  const [x, y, z] = vector(origin, "xyz");
  const [r, p, yaw] = vector(origin, "rpy");
  // URDF 의 rpy 는 **고정축** 순서다. 부모 좌표계에서 X(roll) → Y(pitch) → Z(yaw)
  // 순으로 돌리므로 행렬로는 Rz·Ry·Rx 가 된다. three 의 Euler 는 order 가 곱하는
  // 순서를 뜻해서 같은 값을 얻으려면 "ZYX" 를 써야 한다. "XYZ" 를 쓰면 Rx·Ry·Rz
  // 가 되어, rpy 성분이 둘 이상인 관절만 골라 엉뚱한 자리에 붙는다.
  // (SO-ARM 101 의 집게가 팔에서 떨어져 공중에 떠 보이던 원인이 이것이었다.)
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(r, p, yaw, "ZYX")), new Vector3(1, 1, 1));
}
async function filesByName(root) {
  const found = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.name.endsWith(".stl") && !found.has(entry.name)) found.set(entry.name, next);
    }
  }
  await walk(root);
  return found;
}
function parseRobot(xml) {
  const materialColors = new Map();
  for (const block of xml.matchAll(/<material name="([^"]+)">\s*<color rgba="([^"]+)"\/>\s*<\/material>/g)) materialColors.set(block[1], block[2].split(/\s+/).map(Number));
  const links = new Map();
  for (const block of xml.matchAll(/<link\s+name="([^"]+)"[^>]*(?<!\/)>([\s\S]*?)<\/link>/g)) {
    const visuals = [];
    for (const visual of block[2].matchAll(/<visual>([\s\S]*?)<\/visual>/g)) {
      const body = visual[1];
      const mesh = body.match(/<mesh filename="([^"]+)"(?: scale="([^"]+)")?\/>/);
      if (!mesh) continue;
      const material = body.match(/<material name="([^"]+)"\/>/)?.[1] ?? "white";
      visuals.push({ filename: mesh[1], scale: mesh[2]?.split(/\s+/).map(Number) ?? [1, 1, 1], origin: body.match(/<origin[^>]*\/>/)?.[0] ?? "", color: materialColors.get(material) ?? [0.74, 0.77, 0.83, 1] });
    }
    links.set(block[1], visuals);
  }
  for (const block of xml.matchAll(/<link name="([^"]+)"\s*\/>/g)) {
    if (!links.has(block[1])) links.set(block[1], []);
  }
  const joints = [];
  for (const block of xml.matchAll(/<joint [^>]*>([\s\S]*?)<\/joint>/g)) {
    const body = block[1];
    const parent = body.match(/<parent link="([^"]+)"\/>/)?.[1];
    const child = body.match(/<child link="([^"]+)"\/>/)?.[1];
    if (parent && child) joints.push({ parent, child, origin: body.match(/<origin[^>]*\/>/)?.[0] ?? "" });
  }
  return { links, joints };
}
async function exportModel({ name, urdf, meshRoot, ratio = 0.12, error = 0.006 }) {
  const xml = await readFile(urdf, "utf8");
  const { links, joints } = parseRobot(xml);
  const meshPaths = await filesByName(meshRoot);
  const group = new Group();
  group.name = `${name}-root`;
  const linkGroups = new Map([...links.keys()].map((link) => {
    const linkGroup = new Group();
    linkGroup.name = link;
    return [link, linkGroup];
  }));
  const childLinks = new Set(joints.map((joint) => joint.child));
  for (const joint of joints) {
    const parent = linkGroups.get(joint.parent);
    const child = linkGroups.get(joint.child);
    if (!parent || !child) continue;
    child.applyMatrix4(matrixFor(joint.origin));
    parent.add(child);
  }
  for (const [link, linkGroup] of linkGroups) {
    if (!childLinks.has(link)) group.add(linkGroup);
  }
  let count = 0;
  let welded = 0;
  for (const [link, visuals] of links) for (const visual of visuals) {
    const source = meshPaths.get(path.basename(visual.filename));
    const linkGroup = linkGroups.get(link);
    if (!source || !linkGroup) { console.warn(`Missing mesh: ${visual.filename}`); continue; }
    const bytes = await readFile(source);
    let geometry = stlLoader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    geometry.applyMatrix4(new Matrix4().makeScale(...visual.scale));
    geometry.applyMatrix4(matrixFor(visual.origin));
    // STL triangles carry no shared vertices and no normals worth keeping: the
    // per-face normals three would compute are exactly what a normal-less glTF
    // primitive renders as (flat shading), so welding positions alone keeps the
    // shading identical while removing more than half of the vertex payload and
    // giving `gltf-transform simplify` an indexed mesh it can actually reduce.
    geometry.deleteAttribute("normal");
    const before = geometry.getAttribute("position").count;
    geometry = mergeVertices(geometry, 1e-5);
    const vertices = geometry.getAttribute("position").count;
    welded += before - vertices;
    const material = new MeshStandardMaterial({ color: visual.color.slice(0, 3), metalness: 0.55, roughness: 0.38, flatShading: true });
    const mesh = new Mesh(geometry, material);
    mesh.name = `${link}:${path.basename(visual.filename)}`;
    linkGroup.add(mesh);
    count++;
  }
  const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true, maxTextureSize: 1 });
  const source = path.join(output, `${name}.source.glb`);
  const simplified = path.join(output, `${name}.simplified.glb`);
  const destination = path.join(output, `${name}.glb`);
  await writeFile(source, new Uint8Array(data));
  const cli = path.join(project, "node_modules/.bin/gltf-transform");
  // The stage renders these robots a few hundred pixels tall, where one pixel
  // covers roughly 3 mm of the real robot. A 0.6% error budget therefore stays
  // under a pixel, and it — not the ratio — is what stops the collapse: the
  // exported bounding boxes match the originals to four decimals.
  await run(cli, ["simplify", source, simplified, "--ratio", String(ratio), "--error", String(error)]);
  await run(cli, ["meshopt", simplified, destination, "--level", "medium"]);
  await rm(simplified);
  if (!process.env.KEEP_ROBOT_SOURCE) await rm(source);
  const { size } = await stat(destination);
  console.log(`${name}: ${count} meshes, ${welded.toLocaleString()} vertices welded, ${(size / 1024 / 1024).toFixed(2)} MB GLB`);
}

await mkdir(output, { recursive: true });

// The URDF sources are ROS packages cloned outside the web project.  Override
// each root with an environment variable when the checkout lives elsewhere.
const sources = [
  {
    name: "ai-sapiens",
    root: process.env.AI_SAPIENS_ROOT ?? "/tmp/shape-ai-sapiens/ai_sapiens_description",
    urdf: "urdf/k1_rev1/k1.urdf",
    repository: "https://github.com/ROBOTIS-GIT/ai_sapiens.git",
  },
  {
    name: "ai-worker",
    root: process.env.AI_WORKER_ROOT ?? "/tmp/shape-ai-worker/ffw_description",
    urdf: "urdf/ffw_sg2_rev1_follower/ffw_sg2_follower.urdf",
    repository: "https://github.com/ROBOTIS-GIT/ai_worker.git",
  },
  {
    name: "omy",
    root: process.env.OMY_ROOT ?? "/tmp/shape-open-manipulator/open_manipulator_description",
    urdf: "urdf/omy_f3m/omy_f3m.urdf",
    repository: "https://github.com/ROBOTIS-GIT/open_manipulator.git",
  },
  {
    // 이 팔만은 만든 곳의 저장소를 그대로 씁니다. 예전에는 제3자가 ROS 패키지로
    // 다시 포장한 것을 읽었는데, 부품이 깨져 보였습니다. 공식 저장소의
    // `Simulation/SO101` 에 온셰이프에서 바로 내보낸 URDF 와 STL 이 함께
    // 들어 있습니다. 링크와 조인트 이름은 같아서 화면 쪽 자세 코드는 그대로입니다.
    //
    // 팔로워(follower)가 맞습니다. SO-101 은 사람이 잡고 움직이는 리더와 그것을
    // 따라 움직이는 팔로워가 한 쌍인데, 집게로 물건을 잡는 쪽이 팔로워이고
    // 공식 저장소의 시뮬레이션 모델도 이 팔입니다.
    name: "so-arm101",
    root: process.env.SO_ARM101_ROOT ?? "/tmp/so-arm100-official/Simulation/SO101",
    urdf: "so101_new_calib.urdf",
    meshes: ".",
    repository: "https://github.com/TheRobotStudio/SO-ARM100.git",
    // 실물이 24cm 남짓이라 부품 하나하나가 작습니다. 다른 로봇과 같은 12% 로
    // 줄이면 모터 마운트의 구멍과 집게 이가 뭉개져 관절이 깨져 보입니다.
    // 이 팔은 원래 삼각형 수가 적어 절반만 줄여도 파일이 충분히 가볍습니다.
    ratio: 0.2,
    error: 0.002,
  },
];

const only = process.argv.slice(2);
for (const source of sources) {
  if (only.length && !only.includes(source.name)) continue;
  const urdf = path.join(source.root, source.urdf);
  if (!existsSync(urdf)) {
    console.error(`Skipping ${source.name}: clone ${source.repository} and set the source root (${source.root} not found).`);
    continue;
  }
  await exportModel({
    name: source.name,
    urdf,
    meshRoot: path.join(source.root, source.meshes ?? "meshes"),
    ratio: source.ratio,
    error: source.error,
  });
}
