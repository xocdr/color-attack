import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const GLB_PATH = 'src/glb/player/Young Boy.glb';

export function buildDuelist(scene) {
  const g = new THREE.Group();
  g.userData.isDuelist = true;
  g.userData.bones = {};

  loader.load(
    GLB_PATH,
    (gltf) => {
      const model = gltf.scene;
      model.traverse(c => {
        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        if (c.isBone)  { g.userData.bones[c.name] = c; }
      });
      // Snap feet to ground — compute box in local space before scaling by parent
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      model.position.y -= box.min.y;

      g.add(model);
    },
    undefined,
    (err) => console.error('Failed to load Young Boy GLB:', err)
  );

  return g;
}

export function animateDuelist(duelist, t, delta = 0.016) {
  const b = duelist.userData.bones;
  if (!b || !b.spine_01x) return; // not loaded yet

  const s = t * 0.8; // base speed

  // Root gentle sway side-to-side
  duelist.rotation.y = Math.sin(s * 0.5) * 0.08;

  // Spine breathing
  if (b.spine_01x) b.spine_01x.rotation.x = Math.sin(s * 0.9) * 0.03;
  if (b.spine_02x) b.spine_02x.rotation.x = Math.sin(s * 0.9 + 0.2) * 0.03;
  if (b.spine_03x) {
    b.spine_03x.rotation.x = Math.sin(s * 0.9 + 0.4) * 0.02;
    b.spine_03x.rotation.z = Math.sin(s * 0.5) * 0.03;
  }

  // Head look around slightly
  if (b.neckx) b.neckx.rotation.y = Math.sin(s * 0.4) * 0.08;
  if (b.headx) {
    b.headx.rotation.x = Math.sin(s * 0.6) * 0.05;
    b.headx.rotation.y = Math.sin(s * 0.35) * 0.06;
  }

  // Shoulders idle shift
  if (b.shoulderr) b.shoulderr.rotation.z = Math.sin(s * 0.9 + 0.5) * 0.04;
  if (b.shoulderl) b.shoulderl.rotation.z = Math.sin(s * 0.9) * 0.04;

  // Arms gentle swing (opposite phase)
  if (b.arm_stretchr) b.arm_stretchr.rotation.x = Math.sin(s * 0.9) * 0.08;
  if (b.arm_stretchl) b.arm_stretchl.rotation.x = Math.sin(s * 0.9 + Math.PI) * 0.08;
  if (b.forearm_stretchr) b.forearm_stretchr.rotation.x = 0.1 + Math.sin(s * 0.9) * 0.05;
  if (b.forearm_stretchl) b.forearm_stretchl.rotation.x = 0.1 + Math.sin(s * 0.9 + Math.PI) * 0.05;

  // Legs subtle weight shift
  if (b.thigh_stretchl) b.thigh_stretchl.rotation.x = Math.sin(s * 0.5) * 0.04;
  if (b.thigh_stretchr) b.thigh_stretchr.rotation.x = Math.sin(s * 0.5 + Math.PI) * 0.04;

  // Feet settle
  if (b.footl) b.footl.rotation.x = -0.05 + Math.sin(s * 0.5) * 0.02;
  if (b.footr) b.footr.rotation.x = -0.05 + Math.sin(s * 0.5 + Math.PI) * 0.02;
}
