import * as THREE from 'three';

const _mat = (color, emissive, emInt = 0.3, metal = 0, rough = 0.8) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emInt, metalness: metal, roughness: rough });
const _mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const _attackDir = new THREE.Vector3();

export const DRAKE_STATS = { name: 'Fire Drake', icon: '🐉', cost: 3, auraColor: 0xff4400 };

export function makeFireDrake() {
  const g = new THREE.Group();

  const body = _mesh(new THREE.SphereGeometry(0.32, 8, 6), _mat(0xff4400, 0xdd2200));
  body.scale.set(1, 1.5, 1); body.position.y = 0.65; g.add(body);

  const neck = _mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.35, 7), _mat(0xff5500, 0xcc2200));
  neck.position.set(0.18, 1.1, 0); neck.rotation.z = -0.4; g.add(neck);

  const head = _mesh(new THREE.SphereGeometry(0.2, 8, 6), _mat(0xff5500, 0xcc2200));
  head.position.set(0.4, 1.32, 0); g.add(head);

  const snout = _mesh(new THREE.ConeGeometry(0.08, 0.22, 6), _mat(0xff6600, 0xdd3300));
  snout.rotation.z = -Math.PI / 2; snout.position.set(0.62, 1.28, 0); g.add(snout);

  const wL = _mesh(new THREE.ConeGeometry(0.38, 0.7, 3), _mat(0xcc1100, 0x880000, 0.2));
  wL.rotation.set(0.2, 0, -0.7); wL.position.set(-0.42, 1.0, 0); g.add(wL);

  const wR = wL.clone(); wR.rotation.z = 0.7; wR.position.set(0.1, 1.0, 0); g.add(wR);

  const tail = _mesh(new THREE.CylinderGeometry(0.04, 0.13, 0.55, 6), _mat(0xff4400, 0xcc2200));
  tail.rotation.z = 0.9; tail.position.set(-0.52, 0.28, 0); g.add(tail);

  [-0.15, 0.15].forEach(ox => {
    const leg = _mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.38, 6), _mat(0xdd3300, 0xaa1100));
    leg.position.set(ox, 0.19, 0); g.add(leg);
  });

  body.userData.drakeRole = 'body';
  neck.userData.drakeRole = 'neck';
  head.userData.drakeRole = 'head';
  wL.userData.drakeRole   = 'wingL';
  wR.userData.drakeRole   = 'wingR';
  tail.userData.drakeRole = 'tail';
  g.userData.isFireDrake  = true;
  return g;
}

export function collectDrakeParts(group) {
  const p = {};
  group.traverse(c => { if (c.userData.drakeRole) p[c.userData.drakeRole] = c; });
  return p;
}

export function animateDrakeIdle(monster, t) {
  if (monster._attacking) return;
  if (!monster._drakeParts) monster._drakeParts = collectDrakeParts(monster);
  const p  = monster.userData.phase || 0;
  const dp = monster._drakeParts;

  const flap = Math.sin(t * 3.5 + p);
  if (dp.wingL) dp.wingL.rotation.set(0.2, 0, -0.7 + flap * 0.5);
  if (dp.wingR) dp.wingR.rotation.set(-0.2, 0, 0.7 - flap * 0.5);

  monster.position.y = (monster.userData.baseY || 0) + Math.abs(flap) * 0.06;
  monster.rotation.y = Math.sin(t * 0.5 + p) * 0.2;

  if (dp.neck) { dp.neck.rotation.z = -0.4 + Math.sin(t * 1.2 + p) * 0.1; }
  if (dp.head) { dp.head.rotation.y = Math.sin(t * 0.8 + p) * 0.15; }
  if (dp.tail) { dp.tail.rotation.z = 0.9 + Math.sin(t * 1.8 + p + 1) * 0.3; }

  if (monster.userData.aura) {
    monster.userData.aura.intensity = 0.8 + Math.sin(t * 2.2 + p) * 0.4;
  }
}

export function animateDrakeAttack(monster, t, delta, spawnProjectile) {
  if (!monster._drakeParts) monster._drakeParts = collectDrakeParts(monster);
  const dp  = monster._drakeParts;
  const ss  = x => x * x * (3 - 2 * x);
  const p   = monster.userData.phase || 0;

  const WINDUP_DUR = 0.65, FIRE_DUR = 0.42, RECOVER_DUR = 0.5;
  monster._atProgress += delta;

  if (monster._atPhase === 'windup') {
    const e = ss(Math.min(monster._atProgress / WINDUP_DUR, 1));
    const dir = _attackDir.subVectors(monster._atTarget, monster.position).normalize();
    monster.rotation.y = Math.atan2(dir.x, dir.z);
    if (dp.wingL) dp.wingL.rotation.set(0.2, 0, -0.7 - e * 0.65);
    if (dp.wingR) dp.wingR.rotation.set(-0.2, 0, 0.7 + e * 0.65);
    if (dp.neck)  { dp.neck.rotation.z = -0.4 - e * 0.35; dp.neck.rotation.x = e * 0.2; }
    if (dp.head)  { dp.head.rotation.x = -e * 0.15; }
    monster.rotation.x = -e * 0.18;
    monster.position.y = (monster.userData.baseY || 0) + e * 0.12;

    if (monster._atProgress >= WINDUP_DUR) {
      monster._atPhase = 'fire'; monster._atProgress = 0;
      const from = monster.position.clone(); from.y += 0.9;
      const to   = monster._atTarget.clone(); to.y  += 0.8;
      if (spawnProjectile) spawnProjectile('fire', from, to);
    }

  } else if (monster._atPhase === 'fire') {
    if (monster._atProgress >= FIRE_DUR) { monster._atPhase = 'recover'; monster._atProgress = 0; }

  } else if (monster._atPhase === 'recover') {
    const e = ss(Math.min(monster._atProgress / RECOVER_DUR, 1));
    if (dp.wingL) dp.wingL.rotation.set(0.2, 0, -0.7 - (1 - e) * 0.65);
    if (dp.wingR) dp.wingR.rotation.set(-0.2, 0, 0.7 + (1 - e) * 0.65);
    if (dp.neck)  { dp.neck.rotation.z = -0.4 - (1 - e) * 0.35; dp.neck.rotation.x = (1 - e) * 0.2; }
    if (dp.head)  { dp.head.rotation.x = -(1 - e) * 0.15; }
    monster.rotation.x = -(1 - e) * 0.18;
    monster.position.y = (monster.userData.baseY || 0) + (1 - e) * 0.12;

    if (monster._atProgress >= RECOVER_DUR) {
      monster._attacking = false; monster._atPhase = null;
      monster.rotation.x = 0;
      monster.position.copy(monster._atBasePos); monster.position.y = monster.userData.baseY || 0;
      if (dp.wingL) dp.wingL.rotation.set(0.2, 0, -0.7);
      if (dp.wingR) dp.wingR.rotation.set(-0.2, 0, 0.7);
      if (dp.neck)  { dp.neck.rotation.z = -0.4; dp.neck.rotation.x = 0; }
      if (dp.head)  { dp.head.rotation.x = 0; dp.head.rotation.y = 0; }
    }
  }
}
