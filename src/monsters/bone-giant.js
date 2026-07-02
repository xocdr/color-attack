import * as THREE from 'three';

const _mat = (color, emissive, emInt = 0.3, metal = 0, rough = 0.8) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emInt, metalness: metal, roughness: rough });
const _mesh = (geo, mat) => new THREE.Mesh(geo, mat);

export const BONE_STATS = { name: 'Bone Giant', icon: '💀', cost: 5, auraColor: 0x00ff88, atk: 6, hp: 15 };

export function makeBoneGiant() {
  const g = new THREE.Group();
  const bone = _mat(0xeeeedd, 0xbbbbaa, 0.15);

  [-0.18, 0.18].forEach(ox => {
    const upper = _mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6), bone);
    upper.position.set(ox, 0.25, 0); g.add(upper);
    const lower = _mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.45, 6), bone);
    lower.position.set(ox, 0.65, 0.05); lower.rotation.x = 0.15; g.add(lower);
  });

  const pelvis = _mesh(new THREE.BoxGeometry(0.5, 0.14, 0.22), bone);
  pelvis.position.y = 0.52; g.add(pelvis);

  for (let i = 0; i < 4; i++) {
    const vert = _mesh(new THREE.SphereGeometry(0.07, 6, 5), bone);
    vert.position.y = 0.68 + i * 0.2; g.add(vert);
  }

  [-1, 1].forEach(side => {
    [0.82, 1.0, 1.18].forEach(y => {
      const rib = _mesh(new THREE.TorusGeometry(0.19, 0.03, 5, 10, Math.PI), bone);
      rib.rotation.y = side > 0 ? 0 : Math.PI;
      rib.position.set(side * 0.04, y, 0); g.add(rib);
    });
  });

  [-0.38, 0.38].forEach(ox => {
    const sh = _mesh(new THREE.SphereGeometry(0.1, 7, 6), bone);
    sh.position.set(ox, 1.38, 0); g.add(sh);
    sh.userData.boneRole = ox < 0 ? 'shoulderL' : 'shoulderR';
    const arm = _mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 6), bone);
    arm.rotation.z = ox > 0 ? -0.5 : 0.5; arm.position.set(ox * 1.3, 1.16, 0); g.add(arm);
    arm.userData.boneRole = ox < 0 ? 'armL' : 'armR';
  });

  const skull = _mesh(new THREE.SphereGeometry(0.22, 8, 7), bone);
  skull.position.y = 1.68; g.add(skull);

  const jaw = _mesh(new THREE.BoxGeometry(0.22, 0.1, 0.18), bone);
  jaw.position.set(0, 1.51, 0.04); g.add(jaw);

  [-0.08, 0.08].forEach(ox => {
    const socket = _mesh(new THREE.SphereGeometry(0.06, 6, 6), _mat(0x000000, 0x111111));
    socket.position.set(ox, 1.7, 0.17); g.add(socket);
    const glow = _mesh(new THREE.SphereGeometry(0.035, 6, 6), _mat(0x44ff44, 0x00ff00, 2));
    glow.position.set(ox, 1.7, 0.21); g.add(glow);
  });

  skull.userData.boneRole  = 'skull';
  pelvis.userData.boneRole = 'pelvis';
  jaw.userData.boneRole    = 'jaw';
  g.userData.isBoneGiant   = true;
  return g;
}

export function collectBoneParts(group) {
  const p = {};
  group.traverse(c => { if (c.userData.boneRole) p[c.userData.boneRole] = c; });
  return p;
}

export function animateBoneIdle(monster, t) {
  if (monster._attacking) return;
  if (!monster._boneParts) monster._boneParts = collectBoneParts(monster);
  const p  = monster.userData.phase || 0;
  const bp = monster._boneParts;

  monster.position.y = (monster.userData.baseY || 0) + Math.sin(t * 0.8 + p) * 0.04;
  monster.rotation.z = Math.sin(t * 0.7 + p) * 0.06;
  monster.rotation.y = Math.sin(t * 0.35 + p) * 0.15;

  if (bp.skull) { bp.skull.rotation.z = Math.sin(t * 1.1 + p + 0.5) * 0.12; bp.skull.rotation.x = Math.sin(t * 0.9 + p) * 0.08; }
  if (bp.jaw)   { bp.jaw.rotation.x = Math.abs(Math.sin(t * 2.2 + p)) * 0.12; }
  if (bp.armL)  { bp.armL.rotation.z = 0.5 + Math.sin(t * 0.9 + p) * 0.35; }
  if (bp.armR)  { bp.armR.rotation.z = -0.5 - Math.sin(t * 0.9 + p + Math.PI) * 0.35; }

  if (monster.userData.aura) {
    monster.userData.aura.intensity = 0.8 + Math.sin(t * 2.2 + p) * 0.4;
  }
}

export function animateBoneAttack(monster, t, delta) {
  if (!monster._boneParts) monster._boneParts = collectBoneParts(monster);
  const bp   = monster._boneParts;
  const ss01 = x => x * x * (3 - 2 * x);
  const CHARGE_DUR = 0.65, SLAM_DUR = 0.5, RETURN_DUR = 0.55;

  monster._atProgress += delta;

  if (monster._atPhase === 'charge') {
    const e    = Math.min(monster._atProgress / CHARGE_DUR, 1);
    const ease = ss01(e);
    const dir  = new THREE.Vector3().subVectors(monster._atTarget, monster._atBasePos).normalize();
    const stopPos = monster._atTarget.clone().sub(dir.clone().multiplyScalar(0.9));
    monster.position.lerpVectors(monster._atBasePos, stopPos, ease);
    monster.position.y = Math.sin(ease * Math.PI) * 0.2;
    monster.rotation.y = Math.atan2(dir.x, dir.z);
    monster.rotation.x = ease * 0.2;
    const stomp = Math.abs(Math.sin(e * Math.PI * 5));
    if (bp.armL) bp.armL.rotation.z = 0.5 + stomp * 0.6;
    if (bp.armR) bp.armR.rotation.z = -0.5 - stomp * 0.6;
    if (e >= 1) { monster._atPhase = 'slam'; monster._atProgress = 0; monster._atOnHit?.(monster, monster._atTargetMesh); }

  } else if (monster._atPhase === 'slam') {
    const e = Math.min(monster._atProgress / SLAM_DUR, 1);
    if (e < 0.35) {
      const wu = ss01(e / 0.35);
      if (bp.armL) bp.armL.rotation.z = 0.5 - wu * 1.9;
      if (bp.armR) bp.armR.rotation.z = -0.5 + wu * 1.9;
      if (bp.skull) bp.skull.rotation.x = -wu * 0.22;
    } else {
      const sl = ss01((e - 0.35) / 0.65);
      if (bp.armL) bp.armL.rotation.z = -1.4 + sl * 2.3;
      if (bp.armR) bp.armR.rotation.z =  1.4 - sl * 2.3;
      if (bp.skull) bp.skull.rotation.x = -0.22 + sl * 0.32;
      monster.position.y = Math.sin(sl * Math.PI) * 0.22;
      monster.rotation.x = 0.2 + sl * 0.25;
    }
    if (e >= 1) { monster._atPhase = 'return'; monster._atProgress = 0; monster._atReturnFrom = monster.position.clone(); }

  } else if (monster._atPhase === 'return') {
    const e    = Math.min(monster._atProgress / RETURN_DUR, 1);
    const ease = ss01(e);
    monster.position.lerpVectors(monster._atReturnFrom, monster._atBasePos, ease);
    monster.position.y = Math.sin(ease * Math.PI) * 0.18;
    const targetY = monster._atBaseFacing;
    monster.rotation.y = monster.rotation.y + (targetY - monster.rotation.y) * ease;
    monster.rotation.x = (1 - ease) * 0.35;
    if (e > 0.5) {
      const rec = ss01((e - 0.5) / 0.5);
      if (bp.armL) bp.armL.rotation.z = THREE.MathUtils.lerp(bp.armL.rotation.z, 0.5, rec * 0.15);
      if (bp.armR) bp.armR.rotation.z = THREE.MathUtils.lerp(bp.armR.rotation.z, -0.5, rec * 0.15);
      if (bp.skull) bp.skull.rotation.x = THREE.MathUtils.lerp(bp.skull.rotation.x, 0, rec * 0.15);
    }
    if (e >= 1) {
      monster._attacking = false; monster._atPhase = null;
      monster.position.copy(monster._atBasePos); monster.position.y = monster.userData.baseY || 0;
      monster.rotation.x = 0;
    }
  }
}
