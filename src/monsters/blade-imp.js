import * as THREE from 'three';

const _mat = (color, emissive, emInt = 0.3, metal = 0, rough = 0.8) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emInt, metalness: metal, roughness: rough });
const _mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const _attackDir = new THREE.Vector3();

export const IMP_STATS = { name: 'Blade Imp', icon: '🗡️', cost: 2, auraColor: 0xaa00ff, atk: 5, hp: 5 };

export function makeBladeImp() {
  const g = new THREE.Group();

  const body = _mesh(new THREE.SphereGeometry(0.28, 8, 6), _mat(0x662299, 0x441166));
  body.scale.set(1, 1.2, 1); body.position.y = 0.55; g.add(body);

  const head = _mesh(new THREE.SphereGeometry(0.22, 8, 6), _mat(0x7733aa, 0x441166));
  head.position.y = 1.02; g.add(head);

  [-0.12, 0.12].forEach(ox => {
    const horn = _mesh(new THREE.ConeGeometry(0.05, 0.28, 5), _mat(0xddaaff, 0x9944cc, 0.4));
    horn.position.set(ox, 1.3, 0); g.add(horn);
  });

  [-0.08, 0.08].forEach(ox => {
    const eye = _mesh(new THREE.SphereGeometry(0.04, 6, 6), _mat(0xff2222, 0xff0000, 1));
    eye.position.set(ox, 1.05, 0.18); g.add(eye);
  });

  const swordArm = new THREE.Group();
  swordArm.position.set(0.28, 0.72, 0);
  const armR = _mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.35, 6), _mat(0x6622aa, 0x441166));
  armR.rotation.z = -0.6; armR.position.set(-0.099, -0.144, 0); swordArm.add(armR);
  const guard = _mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), _mat(0xaaaaaa, 0x666666));
  guard.rotation.z = 0.3; guard.position.set(-0.198, -0.288, 0); swordArm.add(guard);
  const blade = _mesh(new THREE.BoxGeometry(0.06, 0.7, 0.04), _mat(0xccddff, 0x8899ff, 0.5));
  blade.rotation.z = 0.3; blade.position.set(-0.301, 0.046, 0); swordArm.add(blade);
  g.add(swordArm);

  const armL = _mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.32, 6), _mat(0x6622aa, 0x441166));
  armL.rotation.z = 0.7; armL.position.set(-0.3, 0.68, 0); g.add(armL);

  [-0.12, 0.12].forEach((ox, li) => {
    const leg = _mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.38, 6), _mat(0x5511aa, 0x330088));
    leg.position.set(ox, 0.19, 0);
    leg.userData.impRole = 'leg' + li;
    g.add(leg);
  });

  body.userData.impRole     = 'body';
  head.userData.impRole     = 'head';
  swordArm.userData.impRole = 'swordArm';
  armL.userData.impRole     = 'armL';
  g.userData.isBladeImp     = true;
  return g;
}

export function collectImpParts(group) {
  const p = {};
  group.traverse(c => { if (c.userData.impRole) p[c.userData.impRole] = c; });
  p.legs = [p.leg0, p.leg1];
  return p;
}

export function animateImpIdle(monster, t) {
  if (monster._attacking) return;
  if (!monster._impParts) monster._impParts = collectImpParts(monster);
  const p  = monster.userData.phase || 0;
  const ip = monster._impParts;

  const cycle    = (t * 0.9 + p * 0.3) % 6;
  const ss       = x => x * x * (3 - 2 * x);
  const clamp01  = x => Math.max(0, Math.min(1, x));

  let bodyY = 0.55, bodyTiltZ = 0;
  let headY = 1.02, headZ = 0, headX = 0;
  let saZ = 0, saX = 0;
  let armLz = 0.7, armLy = 0.68;
  let rootY = 0, rootDZ = 0, rootTiltX = 0;
  let leg0z = 0, leg1z = 0;

  if (cycle < 1.5) {
    const w = Math.sin(t * 2.5 + p); const b = Math.sin(t * 1.6 + p);
    bodyTiltZ = w * 0.08; bodyY = 0.55 + b * 0.025;
    headZ = w * 0.12; headY = 1.02 + b * 0.02; headX = -0.12;
    saZ = w * 0.15; armLz = 0.7 - w * 0.1;
    leg0z = w * 0.1; leg1z = -w * 0.1; rootTiltX = 0.1;
  } else if (cycle < 2.5) {
    const e = ss(clamp01((cycle - 1.5) / 1.0));
    saZ = -e * 1.6; saX = e * 0.7;
    bodyTiltZ = -e * 0.22; headZ = e * 0.18; headX = -0.1 - e * 0.1;
    rootDZ = -e * 0.12; rootTiltX = 0.08 + e * 0.05;
    leg0z = -e * 0.18; leg1z = e * 0.18;
  } else if (cycle < 3.2) {
    const e = ss(clamp01((cycle - 2.5) / 0.7));
    saZ = -1.6 + e * 3.0; saX = 0.7 - e * 0.9;
    bodyTiltZ = -0.22 + e * 0.38; headZ = 0.18 - e * 0.1; headX = -0.2 + e * 0.15;
    rootY = e * 0.12; rootDZ = -0.12 + e * 0.2; rootTiltX = 0.13 - e * 0.1;
    leg0z = e * 0.15; leg1z = -e * 0.2;
  } else if (cycle < 4.0) {
    const e = ss(clamp01((cycle - 3.2) / 0.8));
    saZ = 1.4 * (1 - e); saX = 0;
    bodyTiltZ = 0.16 * (1 - e); headX = -0.05 * (1 - e) - 0.1 * e;
    rootDZ = 0.08 * (1 - e); rootY = 0.12 * (1 - e);
    leg0z = 0.15 * (1 - e); leg1z = -0.2 * (1 - e);
    rootTiltX = 0.03 + 0.08 * e;
  } else if (cycle < 5.0) {
    const e = clamp01((cycle - 4.0) / 0.5);
    const ret = clamp01((cycle - 4.5) / 0.5);
    const lunge = ss(e) - ss(ret);
    rootDZ = lunge * 0.4; rootTiltX = 0.08 + lunge * 0.2;
    saZ = -lunge * 0.5; bodyTiltZ = lunge * 0.1; headX = -0.1 - lunge * 0.28;
    leg0z = -lunge * 0.15; leg1z = lunge * 0.22;
  } else {
    const e = clamp01((cycle - 5.0) / 0.25);
    const r = clamp01((cycle - 5.25) / 0.75);
    headZ = ss(e) * 0.5 - ss(r) * 0.5; headX = -0.1 * (1 - ss(r));
    bodyTiltZ = Math.sin(t * 3.5 + p) * 0.04;
    saZ = Math.sin(t * 4 + p) * 0.08; rootTiltX = 0.08 * (1 - ss(r));
  }

  if (monster.userData.baseZ === undefined) monster.userData.baseZ = monster.position.z;

  monster.position.y = (monster.userData.baseY || 0) + rootY;
  monster.position.z = monster.userData.baseZ + rootDZ;
  monster.rotation.x = rootTiltX;
  monster.rotation.y = Math.sin(t * 0.25 + p) * 0.12;

  if (ip.body) { ip.body.position.y = bodyY; ip.body.rotation.z = bodyTiltZ; }
  if (ip.head) { ip.head.position.y = headY; ip.head.rotation.z = headZ; ip.head.rotation.x = headX; }
  if (ip.swordArm) { ip.swordArm.rotation.z = saZ; ip.swordArm.rotation.x = saX; }
  if (ip.armL) { ip.armL.rotation.z = armLz; ip.armL.position.y = armLy; }
  if (ip.legs) { ip.legs[0] && (ip.legs[0].rotation.z = leg0z); ip.legs[1] && (ip.legs[1].rotation.z = leg1z); }

  if (monster.userData.aura) {
    monster.userData.aura.intensity = 0.8 + Math.sin(t * 2.2 + p) * 0.4;
  }
}

export function animateImpAttack(monster, t, delta) {
  if (!monster._impParts) monster._impParts = collectImpParts(monster);
  const ss01 = x => x * x * (3 - 2 * x);
  const CHARGE_DUR = 0.55, SLASH_DUR = 0.35, RETURN_DUR = 0.5;

  monster._atProgress += delta;

  if (monster._atPhase === 'charge') {
    const e    = Math.min(monster._atProgress / CHARGE_DUR, 1);
    const ease = ss01(e);
    const dir  = _attackDir.subVectors(monster._atTarget, monster._atBasePos).normalize();
    const stopPos = monster._atTarget.clone().sub(dir.clone().multiplyScalar(0.8));
    monster.position.lerpVectors(monster._atBasePos, stopPos, ease);
    monster.position.y = Math.sin(ease * Math.PI) * 0.25;
    monster.rotation.y = Math.atan2(dir.x, dir.z);
    monster.rotation.x = ease * 0.3;
    const ip = monster._impParts;
    if (ip) {
      const run = Math.sin(e * Math.PI * 8);
      if (ip.legs)     { ip.legs[0] && (ip.legs[0].rotation.z =  run * 0.5); ip.legs[1] && (ip.legs[1].rotation.z = -run * 0.5); }
      if (ip.swordArm) ip.swordArm.rotation.z = -run * 0.3;
    }
    if (e >= 1) { monster._atPhase = 'slash'; monster._atProgress = 0; monster._atOnHit?.(monster, monster._atTargetMesh); }

  } else if (monster._atPhase === 'slash') {
    const e  = Math.min(monster._atProgress / SLASH_DUR, 1);
    const ip = monster._impParts;
    if (ip) {
      if (e < 0.4) {
        const wu = ss01(e / 0.4);
        if (ip.swordArm) { ip.swordArm.rotation.z = -wu * 2.2; ip.swordArm.rotation.x = wu * 0.8; }
        if (ip.body)     ip.body.rotation.z = -wu * 0.25;
        if (ip.head)     ip.head.rotation.x = -wu * 0.2;
      } else {
        const sl = ss01((e - 0.4) / 0.6);
        if (ip.swordArm) { ip.swordArm.rotation.z = -2.2 + sl * 3.5; ip.swordArm.rotation.x = 0.8 - sl * 1.0; }
        if (ip.body)     ip.body.rotation.z = -0.25 + sl * 0.4;
        monster.position.y = Math.sin(sl * Math.PI) * 0.15;
      }
    }
    if (e >= 1) { monster._atPhase = 'return'; monster._atProgress = 0; monster._atReturnFrom = monster.position.clone(); }

  } else if (monster._atPhase === 'return') {
    const e    = Math.min(monster._atProgress / RETURN_DUR, 1);
    const ease = ss01(e);
    monster.position.lerpVectors(monster._atReturnFrom, monster._atBasePos, ease);
    monster.position.y = Math.sin(ease * Math.PI) * 0.2;
    const targetY = monster._atBaseFacing;
    monster.rotation.y = monster.rotation.y + (targetY - monster.rotation.y) * ease;
    monster.rotation.x = (1 - ease) * 0.2;
    const ip = monster._impParts;
    if (ip && e > 0.5) {
      const recover = ss01((e - 0.5) / 0.5);
      if (ip.swordArm) ip.swordArm.rotation.z = THREE.MathUtils.lerp(ip.swordArm.rotation.z, 0, recover * 0.15);
      if (ip.body)     ip.body.rotation.z     = THREE.MathUtils.lerp(ip.body.rotation.z, 0, recover * 0.15);
    }
    if (e >= 1) {
      monster._attacking = false; monster._atPhase = null;
      monster.position.copy(monster._atBasePos); monster.position.y = monster.userData.baseY || 0;
      monster.rotation.x = 0;
    }
  }
}
