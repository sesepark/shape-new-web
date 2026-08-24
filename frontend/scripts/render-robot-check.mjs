/**
 * 만들어 둔 로봇 glb 가 실제로 어떻게 보이는지 PNG 로 찍어 본다.
 *
 * 브라우저를 띄우지 않고 확인하려고 만든 도구다. WebGL 없이 정점을 직접
 * 투영하고 z 버퍼로 삼각형을 칠한다. 화면에서 쓰는 자세(`robot-model.tsx` 의
 * `pose`, `facing`)를 그대로 넣을 수 있어서, 부품이 제자리에 있는지와 간략화가
 * 형태를 무너뜨리지 않았는지 눈으로 볼 수 있다.
 *
 *   node scripts/render-robot-check.mjs public/models/so-arm101.glb /tmp/check.png \
 *     '[["upper_arm_link","z",-1.2]]' -0.63
 *
 * 세 번째 인자는 자세(JSON), 네 번째는 기본 방향에서 더 돌릴 각도(라디안)다.
 */
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { Box3, Group, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const WIDTH = 300;
const HEIGHT = 380;
const PAD = 16;
/** ROS 는 Z 위, three 는 Y 위. 화면 쪽과 같은 기본 회전을 준다. */
const FACING = -Math.PI / 2;

/**
 * 인자는 두 가지 방식입니다.
 *   1) 한 장:  <glb> <png> '[["link","z",0.3]]' <facing>
 *   2) 여러 장: <glb> <png> --grid '[{"label":"a","pose":[...],"facing":0}, ...]'
 * 여러 장은 가로로 이어 붙여 한 번에 비교합니다.
 */
const [file, out, ...rest] = process.argv.slice(2);
// file 이 "-" 이면 칸마다 적은 file 을 씁니다.
const shots = rest[0] === "--grid"
  ? JSON.parse(rest[1])
  : [{ label: "", pose: JSON.parse(rest[0] ?? "[]"), facing: Number(rest[1] ?? 0) }];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * 자세마다 새로 읽습니다. 회전을 되돌리는 것보다 확실합니다.
 * 칸마다 `file` 을 따로 주면 여러 로봇을 한 장에 늘어놓을 수 있습니다.
 */
async function load(which) {
  const bytes = await readFile(which);
  return (await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  )).scene;
}

/** 부품마다 색을 달리해 어느 조각이 어디 붙어 있는지 보이게 한다. */
const PALETTE = [
  [40, 85, 243], [226, 75, 114], [17, 168, 132], [217, 119, 6],
  [139, 92, 246], [8, 145, 178], [101, 163, 13], [190, 24, 93],
];

function drawOne(root, pose, facing) {
  for (const [name, axis, angle] of pose) {
    const node = root.getObjectByName(name);
    if (!node) {
      console.error(`  자세를 줄 링크를 찾지 못했습니다: ${name}`);
      continue;
    }
    node.rotation[axis] += angle;
  }
  // 화면(`robot-model.tsx` 의 `prepare`)과 똑같이 세운다. ROS 는 Z 가 위이고
  // three 는 Y 가 위라, 먼저 X 로 -90도 눕혀 세운 다음 바라볼 방향으로 돌린다.
  // 이 변환을 빼면 로봇이 바닥에 누운 채로 나와 자세 값을 잘못 읽게 된다.
  root.rotation.set(-Math.PI / 2, 0, 0);
  const pivot = new Group();
  pivot.rotation.y = FACING + facing;
  pivot.add(root);
  pivot.updateMatrixWorld(true);

  const box = new Box3().setFromObject(pivot);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const scale = Math.min((WIDTH - PAD * 2) / Math.max(size.x, 1e-6), (HEIGHT - PAD * 2) / Math.max(size.y, 1e-6));

  const pixels = new Uint8Array(WIDTH * HEIGHT * 3).fill(255);
  const depth = new Float32Array(WIDTH * HEIGHT).fill(Infinity);
  const light = new Vector3(0.35, 0.5, 0.79).normalize();

  const paint = (x, y, z, shade, colour) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const index = y * WIDTH + x;
    if (z >= depth[index]) return;
    depth[index] = z;
    pixels[index * 3] = Math.round(colour[0] * shade);
    pixels[index * 3 + 1] = Math.round(colour[1] * shade);
    pixels[index * 3 + 2] = Math.round(colour[2] * shade);
  };

  const triangle = (a, b, c, colour) => {
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    const shade = 0.34 + 0.66 * Math.max(0, normal.dot(light));
    const points = [a, b, c].map((v) => ({
      x: WIDTH / 2 + (v.x - centre.x) * scale,
      y: HEIGHT / 2 - (v.y - centre.y) * scale,
      z: -(v.z - centre.z),
    }));
    const [p0, p1, p2] = points;
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    if (Math.abs(area) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((p1.x - x) * (p2.y - y) - (p2.x - x) * (p1.y - y)) / area;
        const w1 = ((p2.x - x) * (p0.y - y) - (p0.x - x) * (p2.y - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
        paint(x, y, w0 * p0.z + w1 * p1.z + w2 * p2.z, shade, colour);
      }
    }
  };

  let meshes = 0;
  let triangles = 0;
  pivot.traverse((node) => {
    if (!node.isMesh) return;
    const colour = PALETTE[meshes++ % PALETTE.length];
    const position = node.geometry.getAttribute("position");
    const index = node.geometry.getIndex();
    const count = index ? index.count : position.count;
    const vertex = (slot) => new Vector3()
      .fromBufferAttribute(position, index ? index.getX(slot) : slot)
      .applyMatrix4(node.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      triangle(vertex(i), vertex(i + 1), vertex(i + 2), colour);
      triangles++;
    }
  });
  return { pixels, meshes, triangles, size };
}

/** 의존성 없이 PNG 한 장을 쓴다. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const payload = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload) >>> 0);
    return Buffer.concat([length, payload, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

console.log(file);
const tiles = [];
for (const shot of shots) {
  const result = drawOne(await load(shot.file ?? file), shot.pose ?? [], Number(shot.facing ?? 0));
  tiles.push(result.pixels);
  console.log(
    `  ${(shot.label || "기본").padEnd(14)} ` +
    `${result.size.toArray().map((v) => v.toFixed(3)).join(" × ")} m · ` +
    `부품 ${result.meshes} · 삼각형 ${result.triangles.toLocaleString()}`,
  );
}

const sheetWidth = WIDTH * tiles.length;
const sheet = new Uint8Array(sheetWidth * HEIGHT * 3).fill(255);
tiles.forEach((tile, column) => {
  for (let y = 0; y < HEIGHT; y++) {
    const from = y * WIDTH * 3;
    const to = (y * sheetWidth + column * WIDTH) * 3;
    sheet.set(tile.subarray(from, from + WIDTH * 3), to);
  }
});
await writeFile(out, png(sheetWidth, HEIGHT, sheet));
console.log(`→ ${out}`);
