// ─── threejs-chars.js ─────────────────────────────────────────────────────────
// Single-scene approach: ONE renderer, ONE scene, ONE camera on #charCanvas.
// Characters are placed in 3D world space. Each frame, syncSlots() raycasts the
// 2D card slot centers onto the y=0 ground plane to position the character groups.
// alpha:true keeps everything outside the characters transparent.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

// ─── Renderer ────────────────────────────────────────────────────────────────
const charCanvas = document.getElementById('charCanvas');
const renderer = new THREE.WebGLRenderer({ canvas: charCanvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;   // keep charCanvas lightweight

// ─── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
// No scene.background → cleared to transparent each frame (alpha:true)

// ─── Camera ──────────────────────────────────────────────────────────────────
// Positioned above-front looking down at the field area.
// syncSlots() raycasts 2D card centers onto y=0 each frame, so the exact
// camera position only affects apparent depth/scale — not alignment.
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 5, 9);
camera.lookAt(0, 0, 0);

// ─── Lighting ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x8899cc, 2.2));

const keyLight = new THREE.DirectionalLight(0xfff4e0, 5.0);
keyLight.position.set(2, 7, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x6699ff, 1.5);
fillLight.position.set(-3, 2, 2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x44ddff, 2.5);
rimLight.position.set(0, 2, -5);
scene.add(rimLight);

// ─── Raycast helpers ─────────────────────────────────────────────────────────
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster   = new THREE.Raycaster();

// Map a CSS-pixel screen position to a point on the y=0 ground plane
function cssToWorld(cssX, cssY) {
  const ndc = new THREE.Vector2(
    (cssX / window.innerWidth)  *  2 - 1,
    (cssY / window.innerHeight) * -2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, hit);
  return hit;
}

// ─── Per-slot state ───────────────────────────────────────────────────────────
const MAX_SLOTS = 5;
const slots = Array.from({ length: MAX_SLOTS }, () => ({
  group:    new THREE.Group(),
  model:    null,
  mixer:    null,
  fallback: null,
  glbPath:  null,
}));
slots.forEach(s => scene.add(s.group));

// ─── GLB cache + loader ───────────────────────────────────────────────────────
const loader    = new GLTFLoader();
const gltfCache = {};

function loadGLB(path, cb) {
  if (gltfCache[path]) { cb(gltfCache[path]); return; }
  loader.load(path, gltf => { gltfCache[path] = gltf; cb(gltf); },
    undefined, err => console.warn('GLB load error:', path, err));
}

// ─── Auto-fit model to ~1.3 units tall ───────────────────────────────────────
function fitModel(model) {
  const box  = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.3 / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(model);
  const c    = box2.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box2.min.y;
}

// ─── Idle clip finder ─────────────────────────────────────────────────────────
function findIdleClip(anims) {
  if (!anims || !anims.length) return null;
  for (const n of ['idle','Idle','IDLE','stand','Stand','breathing','rest']) {
    const c = anims.find(a => a.name.toLowerCase().includes(n.toLowerCase()));
    if (c) return c;
  }
  return anims.reduce((a, b) => (a.duration <= b.duration ? a : b));
}

// ─── Clear a slot ─────────────────────────────────────────────────────────────
function clearSlotContent(idx) {
  const s = slots[idx];
  if (s.model)    { s.group.remove(s.model);    s.model    = null; s.mixer = null; }
  if (s.fallback) { s.group.remove(s.fallback); s.fallback = null; }
  s.glbPath = null;
}

// ─── API: place a character ───────────────────────────────────────────────────
function setSlot(idx, glbPath) {
  if (idx < 0 || idx >= MAX_SLOTS) return;
  clearSlotContent(idx);
  const s = slots[idx];

  if (glbPath) {
    s.glbPath = glbPath;
    loadGLB(glbPath, gltf => {
      if (s.glbPath !== glbPath) return;   // slot was replaced before load finished

      const model = SkeletonUtils.clone(gltf.scene);
      fitModel(model);
      s.group.add(model);
      s.model = model;

      if (gltf.animations && gltf.animations.length > 0) {
        s.mixer = new THREE.AnimationMixer(model);
        const clip = findIdleClip(gltf.animations);
        if (clip) {
          const action = s.mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        }
      }
    });
  } else {
    // Fallback: spinning glowing orb for cards without a GLB
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x2266ff })
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.04, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x88ccff })
    );
    ring.rotation.x = Math.PI / 2;
    const group = new THREE.Group();
    group.position.y = 0.9;
    group.add(orb, ring);
    s.group.add(group);
    s.fallback = group;
  }
}

function clearSlot(idx) {
  if (idx < 0 || idx >= MAX_SLOTS) return;
  clearSlotContent(idx);
}

function clearAll() {
  for (let i = 0; i < MAX_SLOTS; i++) clearSlotContent(i);
}

// ─── syncSlots: map 2D card centers → 3D world positions ──────────────────────
function syncSlots() {
  const rects = window._getPlayerSlotRects?.();
  if (!rects) return;
  const dpr = window.devicePixelRatio;

  rects.forEach((r, i) => {
    // Convert card center from buffer pixels to CSS pixels
    const cssX = r.cx / dpr;
    const cssY = r.cy / dpr;

    const wp = cssToWorld(cssX, cssY);
    if (wp) slots[i].group.position.set(wp.x, 0, wp.z);
  });
}

// ─── Animation loop ───────────────────────────────────────────────────────────
let lastTs = 0;
function animate(ts) {
  requestAnimationFrame(animate);
  const dt = Math.min(ts - lastTs, 50) / 1000;
  lastTs = ts;

  for (const s of slots) {
    if (s.mixer)    s.mixer.update(dt);
    if (s.fallback) s.fallback.rotation.y += dt * 1.2;
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(animate); });

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Expose API ───────────────────────────────────────────────────────────────
window.CharacterField = { setSlot, clearSlot, clearAll, syncSlots };
