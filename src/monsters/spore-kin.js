import * as THREE from 'three';

const _mat = (color, emissive, emInt = 0.3, metal = 0, rough = 0.8) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emInt, metalness: metal, roughness: rough });
const _mesh = (geo, mat) => new THREE.Mesh(geo, mat);

export const SPORE_STATS = { name: 'Spore Kin', icon: '🍄', cost: 1, auraColor: 0x44ff44 };

export function makeSporeKin() {
  const g = new THREE.Group();

  [-0.13, 0.13].forEach((ox, li) => {
    const leg = _mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 6), _mat(0xddccaa, 0xaa9966));
    leg.position.set(ox, 0.15, 0);
    leg.userData.sporeRole = 'leg' + li;
    g.add(leg);
  });

  const stem = _mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), _mat(0xeeddbb, 0xbbaa88));
  stem.position.y = 0.55; g.add(stem);

  const cap = _mesh(new THREE.SphereGeometry(0.45, 10, 7), _mat(0xcc2211, 0x991100));
  cap.scale.set(1, 0.65, 1); cap.position.y = 1.08; g.add(cap);

  const under = _mesh(new THREE.CylinderGeometry(0.42, 0.12, 0.12, 10), _mat(0xffeecc, 0xddbb88));
  under.position.y = 0.88; g.add(under);

  [[-0.18,1.22,0.28],[0.2,1.25,0.18],[-0.05,1.3,-0.25],[0.22,1.15,-0.2],[-0.28,1.12,-0.1]].forEach(([x,y,z]) => {
    const spot = _mesh(new THREE.SphereGeometry(0.06, 6, 6), _mat(0xffffff, 0xdddddd, 0.1));
    spot.position.set(x, y, z); g.add(spot);
  });

  const eyes = [];
  [-0.1, 0.1].forEach(ox => {
    const eye = _mesh(new THREE.SphereGeometry(0.05, 6, 6), _mat(0x22ff44, 0x00ff22, 1));
    eye.position.set(ox, 0.72, 0.17); g.add(eye);
    eyes.push(eye);
  });

  cap.userData.sporeRole  = 'cap';
  stem.userData.sporeRole = 'stem';
  eyes[0].userData.sporeRole = 'eyeL';
  eyes[1].userData.sporeRole = 'eyeR';
  g.userData.isSporeKin   = true;
  return g;
}

export function collectSporeParts(group) {
  const p = {};
  group.traverse(c => { if (c.userData.sporeRole) p[c.userData.sporeRole] = c; });
  p.legs = [p.leg0, p.leg1].filter(Boolean);
  return p;
}

export function animateSporeIdle(monster, t) {
  if (monster._attacking) return;
  if (!monster._sporeParts) monster._sporeParts = collectSporeParts(monster);
  const p  = monster.userData.phase || 0;
  const sp = monster._sporeParts;

  const hop = Math.abs(Math.sin(t * 2.5 + p));
  monster.position.y = (monster.userData.baseY || 0) + hop * 0.12;
  monster.rotation.z = Math.sin(t * 2.5 + p) * 0.06;
  monster.rotation.y = Math.sin(t * 0.4 + p) * 0.2;

  if (sp.cap) {
    sp.cap.scale.y = 0.65 - hop * 0.08;
    sp.cap.scale.x = sp.cap.scale.z = 1.0 + hop * 0.06;
    sp.cap.position.y = 1.08 + hop * 0.05;
  }

  if (sp.eyeL) sp.eyeL.material.emissiveIntensity = 0.8 + Math.sin(t * 3 + p) * 0.5;
  if (sp.eyeR) sp.eyeR.material.emissiveIntensity = 0.8 + Math.sin(t * 3 + p + 0.3) * 0.5;

  if (monster.userData.aura) {
    monster.userData.aura.intensity = 0.8 + Math.sin(t * 2.2 + p) * 0.4;
  }
}

export function animateSporeAttack(monster, t, delta, spawnProjectile) {
  if (!monster._sporeParts) monster._sporeParts = collectSporeParts(monster);
  const sp  = monster._sporeParts;
  const ss  = x => x * x * (3 - 2 * x);

  const WINDUP_DUR = 0.5, FIRE_DUR = 0.42, RECOVER_DUR = 0.4;
  monster._atProgress += delta;

  if (monster._atPhase === 'windup') {
    const e = ss(Math.min(monster._atProgress / WINDUP_DUR, 1));
    const dir = new THREE.Vector3().subVectors(monster._atTarget, monster.position).normalize();
    monster.rotation.y = Math.atan2(dir.x, dir.z);
    if (sp.cap) {
      sp.cap.scale.y = 0.65 + e * 0.45;
      sp.cap.scale.x = sp.cap.scale.z = 1.0 + e * 0.25;
    }
    monster.position.y = (monster.userData.baseY || 0) - e * 0.1;
    monster.rotation.x = e * 0.12;

    if (monster._atProgress >= WINDUP_DUR) {
      monster._atPhase = 'fire'; monster._atProgress = 0;
      const from = monster.position.clone(); from.y += 1.1;
      const to   = monster._atTarget.clone(); to.y  += 0.8;
      if (spawnProjectile) spawnProjectile('spore', from, to);
    }

  } else if (monster._atPhase === 'fire') {
    if (monster._atProgress >= FIRE_DUR) { monster._atPhase = 'recover'; monster._atProgress = 0; }

  } else if (monster._atPhase === 'recover') {
    const e = ss(Math.min(monster._atProgress / RECOVER_DUR, 1));
    if (sp.cap) {
      sp.cap.scale.y = 0.65 + (1 - e) * 0.45;
      sp.cap.scale.x = sp.cap.scale.z = 1.0 + (1 - e) * 0.25;
    }
    monster.position.y = (monster.userData.baseY || 0) - (1 - e) * 0.1;
    monster.rotation.x = (1 - e) * 0.12;

    if (monster._atProgress >= RECOVER_DUR) {
      monster._attacking = false; monster._atPhase = null;
      monster.rotation.x = 0;
      monster.position.copy(monster._atBasePos); monster.position.y = monster.userData.baseY || 0;
      if (sp.cap) { sp.cap.scale.set(1, 0.65, 1); sp.cap.position.y = 1.08; }
    }
  }
}
