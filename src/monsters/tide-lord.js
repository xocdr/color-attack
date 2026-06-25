import * as THREE from 'three';

const _mat = (color, emissive, emInt = 0.3, metal = 0, rough = 0.8) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emInt, metalness: metal, roughness: rough });
const _mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const _attackDir = new THREE.Vector3();

export const TIDE_STATS = { name: 'Tide Lord', icon: '🌊', cost: 4, auraColor: 0x0088ff };

export function makeTideLord() {
  const g = new THREE.Group();

  const robe = _mesh(new THREE.CylinderGeometry(0.15, 0.42, 0.9, 8), _mat(0x0055cc, 0x002299));
  robe.position.y = 0.45; g.add(robe);

  const torso = _mesh(new THREE.SphereGeometry(0.26, 8, 6), _mat(0x0066dd, 0x003399));
  torso.scale.set(1, 1.1, 1); torso.position.y = 1.0; g.add(torso);

  const head = _mesh(new THREE.SphereGeometry(0.2, 8, 6), _mat(0x0077ee, 0x0033aa));
  head.position.y = 1.42; g.add(head);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = _mesh(new THREE.ConeGeometry(0.04, 0.2, 5), _mat(0x00ddff, 0x00aacc, 0.8));
    spike.position.set(Math.cos(a) * 0.17, 1.68, Math.sin(a) * 0.17);
    spike.userData.tideRole = 'spike' + i;
    g.add(spike);
  }

  [-1, 1].forEach(side => {
    const arm = _mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.5, 6), _mat(0x0044bb, 0x002288));
    arm.rotation.z = side * 1.1; arm.position.set(side * 0.4, 0.98, 0); g.add(arm);
    arm.userData.tideRole = side < 0 ? 'armL' : 'armR';
    const tip = _mesh(new THREE.SphereGeometry(0.07, 6, 6), _mat(0x00aaff, 0x0066cc, 0.5));
    tip.position.set(side * 0.68, 0.72, 0); g.add(tip);
  });

  [-0.07, 0.07].forEach(ox => {
    const eye = _mesh(new THREE.SphereGeometry(0.04, 6, 6), _mat(0x00ffff, 0x00ffff, 1));
    eye.position.set(ox, 1.44, 0.17); g.add(eye);
  });

  head.userData.tideRole  = 'head';
  torso.userData.tideRole = 'torso';
  robe.userData.tideRole  = 'robe';
  g.userData.isTideLord   = true;
  return g;
}

export function collectTideParts(group) {
  const p = {};
  group.traverse(c => { if (c.userData.tideRole) p[c.userData.tideRole] = c; });
  p.spikes = [p.spike0, p.spike1, p.spike2, p.spike3, p.spike4].filter(Boolean);
  return p;
}

export function animateTideIdle(monster, t) {
  if (monster._attacking) return;
  if (!monster._tideParts) monster._tideParts = collectTideParts(monster);
  const p  = monster.userData.phase || 0;
  const tp = monster._tideParts;

  monster.position.y = (monster.userData.baseY || 0) + Math.sin(t * 1.0 + p) * 0.07;
  monster.rotation.z = Math.sin(t * 0.9 + p) * 0.07;
  monster.rotation.y = Math.sin(t * 0.4 + p) * 0.15;

  if (tp.armL) tp.armL.rotation.z = 1.1 + Math.sin(t * 1.5 + p) * 0.25;
  if (tp.armR) tp.armR.rotation.z = -1.1 - Math.sin(t * 1.5 + p + 0.8) * 0.25;
  if (tp.head) tp.head.rotation.x = Math.sin(t * 0.7 + p) * 0.08;

  if (tp.spikes) {
    tp.spikes.forEach((s, i) => {
      s.scale.y = 1.0 + Math.sin(t * 2.2 + p + i * 0.9) * 0.18;
    });
  }

  if (monster.userData.aura) {
    monster.userData.aura.intensity = 0.8 + Math.sin(t * 2.2 + p) * 0.4;
  }
}

export function animateTideAttack(monster, t, delta, spawnProjectile) {
  if (!monster._tideParts) monster._tideParts = collectTideParts(monster);
  const tp  = monster._tideParts;
  const ss  = x => x * x * (3 - 2 * x);

  const WINDUP_DUR = 0.65, FIRE_DUR = 0.42, RECOVER_DUR = 0.5;
  monster._atProgress += delta;

  if (monster._atPhase === 'windup') {
    const e = ss(Math.min(monster._atProgress / WINDUP_DUR, 1));
    const dir = _attackDir.subVectors(monster._atTarget, monster.position).normalize();
    monster.rotation.y = Math.atan2(dir.x, dir.z);
    if (tp.armL) tp.armL.rotation.z = 1.1 - e * 2.1;
    if (tp.armR) tp.armR.rotation.z = -1.1 + e * 2.1;
    if (tp.torso) tp.torso.rotation.x = -e * 0.22;
    monster.position.y = (monster.userData.baseY || 0) + e * 0.05;
    if (tp.spikes) { tp.spikes.forEach(s => { s.scale.y = 1.0 + e * 0.6; }); }

    if (monster._atProgress >= WINDUP_DUR) {
      monster._atPhase = 'fire'; monster._atProgress = 0;
      const from = monster.position.clone(); from.y += 1.2;
      const to   = monster._atTarget.clone(); to.y  += 0.8;
      if (spawnProjectile) spawnProjectile('water', from, to);
    }

  } else if (monster._atPhase === 'fire') {
    if (monster._atProgress >= FIRE_DUR) { monster._atPhase = 'recover'; monster._atProgress = 0; }

  } else if (monster._atPhase === 'recover') {
    const e = ss(Math.min(monster._atProgress / RECOVER_DUR, 1));
    if (tp.armL) tp.armL.rotation.z = 1.1 - (1 - e) * 2.1;
    if (tp.armR) tp.armR.rotation.z = -1.1 + (1 - e) * 2.1;
    if (tp.torso) tp.torso.rotation.x = -(1 - e) * 0.22;
    monster.position.y = (monster.userData.baseY || 0) + (1 - e) * 0.05;
    if (tp.spikes) { tp.spikes.forEach(s => { s.scale.y = 1.0 + (1 - e) * 0.6; }); }

    if (monster._atProgress >= RECOVER_DUR) {
      monster._attacking = false; monster._atPhase = null;
      monster.rotation.x = 0;
      monster.position.copy(monster._atBasePos); monster.position.y = monster.userData.baseY || 0;
      if (tp.armL) tp.armL.rotation.z = 1.1;
      if (tp.armR) tp.armR.rotation.z = -1.1;
      if (tp.torso) tp.torso.rotation.x = 0;
      if (tp.spikes) { tp.spikes.forEach(s => { s.scale.y = 1.0; }); }
    }
  }
}
