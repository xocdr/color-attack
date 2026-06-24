// ─── threejs-bg.js ────────────────────────────────────────────────────────────
// Three.js animated 3D starfield rendered on #bgCanvas, layered behind the
// 2D game canvas. Demonstrates the core Three.js building blocks:
//   Scene, PerspectiveCamera, WebGLRenderer, BufferGeometry,
//   Float32BufferAttribute, PointsMaterial, Points, and a RAF loop.

import * as THREE from 'three';

// ─── 1. RENDERER ─────────────────────────────────────────────────────────────
// WebGLRenderer wraps a WebGL context. We point it at bgCanvas so it never
// touches the 2D game canvas sitting on top.
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('bgCanvas'),
  antialias: false,   // points don't benefit from MSAA
  alpha: false,       // we own the full background — no transparency needed
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
// setClearColor(hex, alpha) — the color WebGL clears to each frame.
// Deep space blue-black matches the game's #0a0a0f palette.
renderer.setClearColor(0x07070e, 1);

// ─── 2. SCENE ────────────────────────────────────────────────────────────────
// Scene is the root container. Every 3D object, light, and camera helper you
// want rendered must be added to it with scene.add().
const scene = new THREE.Scene();

// ─── 3. CAMERA ───────────────────────────────────────────────────────────────
// PerspectiveCamera(fov, aspect, near, far)
//   fov    — vertical field of view in degrees (75 = wide-angle, good for space)
//   aspect — width / height (must stay in sync on resize)
//   near   — anything closer than this is clipped (invisible)
//   far    — anything farther than this is clipped (invisible)
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
// Camera sits at the origin, looking down the -Z axis (Three.js default).
camera.position.set(0, 0, 0);

// ─── 4. STAR GEOMETRY ────────────────────────────────────────────────────────
// We represent all 2500 stars as ONE Points object — a single GPU draw call.
// This is the canonical high-performance approach in Three.js for particle systems.
//
// Stars are scattered in a tunnel along the Z axis:
//   x, y — random point in a disc (avoids empty corners)
//   z     — random from -1000 (far) to 0 (at camera)
//
// Each frame we advance z toward the camera. When z > 0 (star passes behind
// the camera) it wraps back to z = -1000. This creates a warp-speed effect.

const STAR_COUNT = 2500;
const SPREAD = 800; // horizontal/vertical scatter radius

// BufferGeometry stores vertex data in typed arrays — much faster than the
// old Geometry class that used JavaScript objects.
const geometry = new THREE.BufferGeometry();

// Float32Array: [x0, y0, z0,  x1, y1, z1,  ...] — 3 floats per star
const positions = new Float32Array(STAR_COUNT * 3);
const speeds    = new Float32Array(STAR_COUNT);  // per-star speed multiplier

function resetStar(i, randomZ) {
  // Spread stars across a disc using polar coordinates
  const angle  = Math.random() * Math.PI * 2;
  const radius = Math.random() * SPREAD;
  positions[i * 3 + 0] = Math.cos(angle) * radius;  // x
  positions[i * 3 + 1] = Math.sin(angle) * radius;  // y
  positions[i * 3 + 2] = randomZ
    ? -(Math.random() * 1000)  // initial scatter across full depth
    : -1000;                    // wrap: teleport to far end of tunnel
  speeds[i] = 0.5 + Math.random() * 1.5; // 0.5 – 2.0× speed multiplier
}

for (let i = 0; i < STAR_COUNT; i++) {
  resetStar(i, true);
}

// setAttribute(name, attribute) — registers the data with the geometry.
// Float32BufferAttribute(array, itemSize) — itemSize=3 means "3 floats = 1 vertex"
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

// ─── 5. MATERIAL ─────────────────────────────────────────────────────────────
// PointsMaterial is the simplest material for point sprites.
//   sizeAttenuation: true  — far points appear smaller (perspective correct)
//   sizeAttenuation: false — all points same screen size regardless of depth
const material = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 2.0,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.85,
});

// ─── 6. POINTS MESH ──────────────────────────────────────────────────────────
// Points(geometry, material) — the Three.js object that renders BufferGeometry
// as point sprites. Add it to the scene so the renderer draws it.
const stars = new THREE.Points(geometry, material);
scene.add(stars);

// ─── 7. NEBULA LAYER ─────────────────────────────────────────────────────────
// A second, sparser coloured Points layer gives depth via parallax.
// This shows that you can have multiple independent objects in the same scene.
const NEBULA_COUNT = 400;
const nebulaPos = new Float32Array(NEBULA_COUNT * 3);

for (let i = 0; i < NEBULA_COUNT; i++) {
  const angle  = Math.random() * Math.PI * 2;
  const radius = Math.random() * SPREAD * 0.6;
  nebulaPos[i * 3 + 0] = Math.cos(angle) * radius;
  nebulaPos[i * 3 + 1] = Math.sin(angle) * radius;
  nebulaPos[i * 3 + 2] = -(Math.random() * 1000);
}

const nebulaGeo = new THREE.BufferGeometry();
nebulaGeo.setAttribute('position', new THREE.Float32BufferAttribute(nebulaPos, 3));

// Pick a card-themed accent colour for the nebula
const NEBULA_COLORS = [0x1e90ff, 0x9b30ff, 0x22dd55, 0xff4444];
const nebulaMat = new THREE.PointsMaterial({
  color: NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)],
  size: 3.5,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.35,
});

const nebula = new THREE.Points(nebulaGeo, nebulaMat);
scene.add(nebula);

// ─── 8. ANIMATION LOOP ───────────────────────────────────────────────────────
// This RAF loop is completely independent from game.js's RAF loop. Both call
// requestAnimationFrame and the browser interleaves them each frame. There is
// no shared mutable state, so they cannot interfere with each other.

const BASE_SPEED = 0.6; // world units advanced per frame at 60 fps
let lastTs = 0;

function animate(ts) {
  requestAnimationFrame(animate);

  const dt    = Math.min(ts - lastTs, 50);    // cap at 50ms (handles tab unfocus)
  lastTs      = ts;
  const delta = (dt / 16.67) * BASE_SPEED;   // normalise to 60 fps

  // ── Advance white stars toward camera ──────────────────────────────────────
  // We write directly into the Float32Array that backs the BufferGeometry.
  // After any write, set needsUpdate = true so Three.js re-uploads to the GPU.
  const pos = geometry.attributes.position.array;
  for (let i = 0; i < STAR_COUNT; i++) {
    pos[i * 3 + 2] += delta * speeds[i];
    if (pos[i * 3 + 2] > 0) resetStar(i, false); // wrap to back of tunnel
  }
  geometry.attributes.position.needsUpdate = true; // ← required after mutation

  // ── Advance nebula layer (slower = depth parallax) ─────────────────────────
  const npos = nebulaGeo.attributes.position.array;
  for (let i = 0; i < NEBULA_COUNT; i++) {
    npos[i * 3 + 2] += delta * 0.6;
    if (npos[i * 3 + 2] > 0) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * SPREAD * 0.6;
      npos[i * 3 + 0] = Math.cos(angle) * radius;
      npos[i * 3 + 1] = Math.sin(angle) * radius;
      npos[i * 3 + 2] = -1000;
    }
  }
  nebulaGeo.attributes.position.needsUpdate = true;

  // Gentle Y rotation gives a subtle drift sensation
  stars.rotation.y  += 0.00004 * (dt / 16.67);
  nebula.rotation.y += 0.00002 * (dt / 16.67);

  // renderer.render(scene, camera) — draw everything in the scene to bgCanvas
  renderer.render(scene, camera);
}

// Seed lastTs before starting so the first frame has dt ≈ 0
requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(animate); });

// ─── 9. RESIZE HANDLING ──────────────────────────────────────────────────────
// Both the renderer pixel buffer and camera aspect ratio must be updated on
// resize. game.js handles its own canvas resize independently — no coordination
// needed between the two loops.
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix(); // MUST call this after changing any camera property
  renderer.setSize(w, h);
});
