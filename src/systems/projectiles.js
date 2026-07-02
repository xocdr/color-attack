import * as THREE from 'three';

export function createProjectileSystem(scene) {
  const projectiles = [];

  const CONFIGS = {
    fire: {
      color: 0xff4400, emissive: 0xff2200, emInt: 5, size: 0.13,
      lightColor: 0xff3300, lightIntensity: 3.0, duration: 0.42,
    },
    water: {
      color: 0x00aaff, emissive: 0x0066ff, emInt: 4, size: 0.15,
      transparent: true, opacity: 0.88,
      lightColor: 0x0066ff, lightIntensity: 2.5, duration: 0.48,
    },
    spore: {
      color: 0x44ff44, emissive: 0x22cc22, emInt: 3, size: 0.18,
      transparent: true, opacity: 0.8,
      lightColor: 0x00ff44, lightIntensity: 2.0, duration: 0.55,
    },
  };

  function spawnProjectile(type, fromPos, toPos, onHit) {
    const cfg = CONFIGS[type];
    if (!cfg) return;

    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.emissive,
      emissiveIntensity: cfg.emInt,
      transparent: !!cfg.transparent,
      opacity: cfg.opacity || 1.0,
    });
    const proj = new THREE.Mesh(new THREE.SphereGeometry(cfg.size, 8, 6), mat);

    const pLight = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, 5);
    proj.add(pLight);

    proj.position.copy(fromPos);
    scene.add(proj);

    projectiles.push({
      mesh:     proj,
      from:     fromPos.clone(),
      to:       toPos.clone(),
      progress: 0,
      duration: cfg.duration,
      onHit:    onHit || null,
    });
  }

  function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.progress += delta / p.duration;
      if (p.progress >= 1) {
        if (p.onHit) p.onHit();
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        projectiles.splice(i, 1);
        continue;
      }
      const e = p.progress * p.progress * (3 - 2 * p.progress);
      p.mesh.position.lerpVectors(p.from, p.to, e);
      p.mesh.position.y += Math.sin(p.progress * Math.PI) * 0.6;
      const fade = Math.sin(p.progress * Math.PI);
      if (p.mesh.children[0]) p.mesh.children[0].intensity *= 0.98 + fade * 0.02;
    }
  }

  return { spawnProjectile, updateProjectiles };
}
