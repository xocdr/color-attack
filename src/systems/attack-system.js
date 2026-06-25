import * as THREE from 'three';

export function startAttack(monster, targetMesh) {
  monster._attacking    = true;
  monster._atProgress   = 0;
  monster._atTarget     = new THREE.Vector3(targetMesh.position.x, 0, targetMesh.position.z);
  monster._atBasePos    = monster.position.clone();
  monster._atBaseFacing = monster.rotation.y;

  if (monster.userData.isFireDrake || monster.userData.isTideLord || monster.userData.isSporeKin) {
    monster._atType  = 'ranged';
    monster._atPhase = 'windup';
  } else {
    monster._atType  = 'melee';
    monster._atPhase = 'charge';
  }

  if (targetMesh.userData.aura) {
    targetMesh.userData.aura.intensity = 4.0;
    setTimeout(() => { if (targetMesh.userData.aura) targetMesh.userData.aura.intensity = 1.0; }, 400);
  }
}
