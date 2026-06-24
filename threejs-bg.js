import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('bgCanvas'),
  antialias: false,
  alpha: false,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x07070e, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 300);

// ── Ambient floating particles ────────────────────────────────────────────────
const COUNT  = 180;
const SPREAD = 500;

const positions = new Float32Array(COUNT * 3);
const velocities = [];

for (let i = 0; i < COUNT; i++) {
  positions[i * 3 + 0] = (Math.random() - 0.5) * SPREAD;
  positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
  // Very slow random drift in x/y only — no z tunnelling
  velocities.push({
    vx: (Math.random() - 0.5) * 0.04,
    vy: (Math.random() - 0.5) * 0.04,
  });
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

const mat = new THREE.PointsMaterial({
  color: 0x4488ff,
  size: 2.2,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.55,
});

const particles = new THREE.Points(geo, mat);
scene.add(particles);

// ── Accent layer (dimmer, slightly larger, cyan-tinted) ───────────────────────
const ACC_COUNT = 60;
const accPos = new Float32Array(ACC_COUNT * 3);
const accVel = [];

for (let i = 0; i < ACC_COUNT; i++) {
  accPos[i * 3 + 0] = (Math.random() - 0.5) * SPREAD;
  accPos[i * 3 + 1] = (Math.random() - 0.5) * SPREAD;
  accPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
  accVel.push({
    vx: (Math.random() - 0.5) * 0.025,
    vy: (Math.random() - 0.5) * 0.025,
  });
}

const accGeo = new THREE.BufferGeometry();
accGeo.setAttribute('position', new THREE.Float32BufferAttribute(accPos, 3));

const accMat = new THREE.PointsMaterial({
  color: 0x00e5ff,
  size: 3.0,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.25,
});

const accent = new THREE.Points(accGeo, accMat);
scene.add(accent);

// ── Animation loop ─────────────────────────────────────────────────────────────
let lastTs = 0;

function animate(ts) {
  requestAnimationFrame(animate);
  const dt = Math.min(ts - lastTs, 50);
  lastTs = ts;
  const t = dt / 16.67;

  const pos = geo.attributes.position.array;
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3 + 0] += velocities[i].vx * t;
    pos[i * 3 + 1] += velocities[i].vy * t;
    // Wrap around when drifting out of bounds
    if (pos[i * 3 + 0] >  SPREAD / 2) pos[i * 3 + 0] = -SPREAD / 2;
    if (pos[i * 3 + 0] < -SPREAD / 2) pos[i * 3 + 0] =  SPREAD / 2;
    if (pos[i * 3 + 1] >  SPREAD / 2) pos[i * 3 + 1] = -SPREAD / 2;
    if (pos[i * 3 + 1] < -SPREAD / 2) pos[i * 3 + 1] =  SPREAD / 2;
  }
  geo.attributes.position.needsUpdate = true;

  const apos = accGeo.attributes.position.array;
  for (let i = 0; i < ACC_COUNT; i++) {
    apos[i * 3 + 0] += accVel[i].vx * t;
    apos[i * 3 + 1] += accVel[i].vy * t;
    if (apos[i * 3 + 0] >  SPREAD / 2) apos[i * 3 + 0] = -SPREAD / 2;
    if (apos[i * 3 + 0] < -SPREAD / 2) apos[i * 3 + 0] =  SPREAD / 2;
    if (apos[i * 3 + 1] >  SPREAD / 2) apos[i * 3 + 1] = -SPREAD / 2;
    if (apos[i * 3 + 1] < -SPREAD / 2) apos[i * 3 + 1] =  SPREAD / 2;
  }
  accGeo.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
}

requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(animate); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
