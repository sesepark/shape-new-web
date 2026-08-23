/**
 * Draw the AI Worker as clean line art for the footer.
 *
 * The old footer PNG was a hand-traced outline whose edges were visibly ragged.
 * The robot already ships as a URDF-derived GLB, so this renders that geometry
 * with a small software rasteriser: depth and normals go into a supersampled
 * buffer, silhouette and crease edges are found from that buffer, and the
 * result is boxed down so every line lands anti-aliased.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { Box3, Matrix4, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const WIDTH = Number(process.env.ART_WIDTH ?? 760);
const HEIGHT = Number(process.env.ART_HEIGHT ?? 560);
const YAW = Number(process.env.ART_YAW ?? -0.9);
const MARGIN = 0.04;
const SCALE = 4; // supersampling factor
const DEPTH_EDGE = 0.006; // relative depth jump that counts as a silhouette
const CREASE = 0.62; // normal dot product below this counts as a crease

const project = process.cwd();
const source = path.join(project, "public/models/ai-worker.glb");

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[i] = value;
    }
  }
  let crc = -1;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const bytes = readFileSync(source);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
const model = gltf.scene;

// Same rest pose the home stage settles into, so the footer artwork and the
// live 3D robot read as the same machine.
// 한쪽 팔은 사이트를 소개하듯 들어 올리고, 반대 팔은 자연스럽게 내립니다.
const POSE = (process.env.ART_POSE ?? "present").split(",").includes("present")
  ? [
      ["arm_r_link2", "x", -0.2], ["arm_r_link3", "z", -0.35], ["arm_r_link4", "y", -1.05],
      ["arm_l_link2", "x", 1.15], ["arm_l_link4", "y", 0.2],
      ["head_link1", "y", 0.1], ["head_link2", "z", 0.18],
    ]
  : [
      ["arm_r_link2", "x", -1.05], ["arm_r_link4", "y", -0.32],
      ["arm_l_link2", "x", 0.78], ["arm_l_link4", "y", 0.3],
      ["head_link1", "y", 0.12],
    ];
for (const [name, axis, angle] of POSE) {
  const joint = model.getObjectByName(name);
  if (joint) joint.rotation[axis] = angle;
}
for (const side of ["r", "l"]) {
  for (const [suffix, sign] of [["r1", 1], ["r2", -1], ["l1", -1], ["l2", 1]]) {
    const finger = model.getObjectByName(`gripper_${side}_rh_p12_rn_${suffix}`);
    if (finger) finger.rotation.x = sign * 0.5;
  }
}

// Same conversion the live stage uses: ROS Z-up to Three Y-up, then a three
// quarter turn so the robot is seen from its front left.
model.rotation.set(-Math.PI / 2, 0, 0);
model.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(model);
const center = bounds.getCenter(new Vector3());
const size = bounds.getSize(new Vector3());
const view = new Matrix4()
  .makeRotationY(-Math.PI / 2 + YAW)
  .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
view.premultiply(new Matrix4().makeRotationX(0.06));

const pixelWidth = WIDTH * SCALE;
const pixelHeight = HEIGHT * SCALE;
const depth = new Float32Array(pixelWidth * pixelHeight).fill(-Infinity);
const normals = new Float32Array(pixelWidth * pixelHeight * 3);
// First pass: measure the projected silhouette so the crop hugs the robot
// instead of leaving the wide empty margins the old artwork had.
const probe = new Vector3();
let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
model.traverse((node) => {
  if (!node.isMesh) return;
  const position = node.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    probe.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).applyMatrix4(view);
    left = Math.min(left, probe.x); right = Math.max(right, probe.x);
    top = Math.min(top, -probe.y); bottom = Math.max(bottom, -probe.y);
  }
});
const spanX = right - left;
const spanY = bottom - top;
const fit = Math.min((pixelWidth * (1 - MARGIN * 2)) / spanX, (pixelHeight * (1 - MARGIN * 2)) / spanY);
const originX = pixelWidth / 2 - ((left + right) / 2) * fit;
const originY = pixelHeight / 2 - ((top + bottom) / 2) * fit;

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const edge1 = new Vector3();
const edge2 = new Vector3();
const faceNormal = new Vector3();
let triangles = 0;

model.traverse((node) => {
  if (!node.isMesh) return;
  const geometry = node.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const world = node.matrixWorld;
  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i;
    const i1 = index ? index.getX(i + 1) : i + 1;
    const i2 = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, i0).applyMatrix4(world).applyMatrix4(view);
    b.fromBufferAttribute(position, i1).applyMatrix4(world).applyMatrix4(view);
    c.fromBufferAttribute(position, i2).applyMatrix4(world).applyMatrix4(view);
    faceNormal.copy(edge1.subVectors(b, a)).cross(edge2.subVectors(c, a)).normalize();
    triangles++;

    const ax = originX + a.x * fit, ay = originY - a.y * fit;
    const bx = originX + b.x * fit, by = originY - b.y * fit;
    const cx = originX + c.x * fit, cy = originY - c.y * fit;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(pixelWidth - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(pixelHeight - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!area) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
        const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w1 * a.z + w2 * b.z + w0 * c.z;
        const offset = y * pixelWidth + x;
        if (z <= depth[offset]) continue;
        depth[offset] = z;
        normals[offset * 3] = faceNormal.x;
        normals[offset * 3 + 1] = faceNormal.y;
        normals[offset * 3 + 2] = faceNormal.z;
      }
    }
  }
});

// Edge detection over the supersampled buffer.
const span = size.length();
const ink = new Float32Array(pixelWidth * pixelHeight);
for (let y = 1; y < pixelHeight - 1; y++) {
  for (let x = 1; x < pixelWidth - 1; x++) {
    const offset = y * pixelWidth + x;
    const here = depth[offset];
    if (here === -Infinity) continue;
    let edge = 0;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const other = (y + dy) * pixelWidth + (x + dx);
      const there = depth[other];
      if (there === -Infinity) { edge = 1; break; }
      if (Math.abs(there - here) / span > DEPTH_EDGE) { edge = Math.max(edge, 0.9); continue; }
      const dot =
        normals[offset * 3] * normals[other * 3] +
        normals[offset * 3 + 1] * normals[other * 3 + 1] +
        normals[offset * 3 + 2] * normals[other * 3 + 2];
      if (dot < CREASE) edge = Math.max(edge, 0.55);
    }
    ink[offset] = edge;
  }
}

// Box downsample: every output pixel averages SCALE × SCALE samples, which is
// what turns the stair-stepped edges into smooth ones.
const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
const samples = SCALE * SCALE;
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    let total = 0;
    for (let sy = 0; sy < SCALE; sy++) {
      for (let sx = 0; sx < SCALE; sx++) {
        total += ink[(y * SCALE + sy) * pixelWidth + (x * SCALE + sx)];
      }
    }
    const alpha = Math.min(1, (total / samples) * 1.9);
    const offset = (y * WIDTH + x) * 4;
    rgba[offset] = 17;
    rgba[offset + 1] = 29;
    rgba[offset + 2] = 63;
    rgba[offset + 3] = Math.round(alpha * 255);
  }
}

const destination = path.join(project, "public/ai-worker-outline.png");
writeFileSync(destination, encodePng(WIDTH, HEIGHT, rgba));
const covered = rgba.filter((_, i) => i % 4 === 3).filter((value) => value > 8).length;
console.log(`${triangles.toLocaleString()} triangles → ${WIDTH}×${HEIGHT}, ${covered.toLocaleString()} inked pixels`);
