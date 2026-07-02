/**
 * SandArenaMap — warm golden-hour arena.
 *
 * Improvements over the initial implementation:
 *   - Texture factories are lazily cached at module scope (one canvas per session).
 *   - SHARED_GEO constants replace per-init geometry allocations for card/ring/pillar.
 *   - _buildDeck delegated to MapUtils.buildDeckStack (no duplication).
 *   - getSpawnPoints / getInteractableZones / cleanup inherited from MapInterface.
 *   - Particle math loop is now throttled every other frame (not just needsUpdate).
 */

import * as THREE from 'three';
import { MapInterface }                        from '../MapInterface.js';
import { validateMapConfig }                   from '../MapConfig.js';
import { buildDeckStack, getBackTex, SHARED_GEO } from '../MapUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Texture cache — generated once per browser session, reused on map reload
// ─────────────────────────────────────────────────────────────────────────────

let _sandTexCache  = null;
let _stoneTexCache = null;

function makeSandTexture() {
  if (_sandTexCache) return _sandTexCache;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c8a96e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.5, light = Math.random() > 0.5;
    ctx.fillStyle = light
      ? `rgba(220,185,120,${0.3 + Math.random() * 0.4})`
      : `rgba(150,110,55,${0.2 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(160,120,60,0.25)'; ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 20 + Math.random() * 60, 0, Math.PI * 2);
    ctx.stroke();
  }
  _sandTexCache = new THREE.CanvasTexture(canvas);
  return _sandTexCache;
}

function makeWeatheredStoneTexture() {
  if (_stoneTexCache) return _stoneTexCache;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b89a6a'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const bx = Math.random()*size, by = Math.random()*size, br = 20+Math.random()*80;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(80,60,30,0.35)' : 'rgba(200,175,120,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(bx, by, br, br*(0.4+Math.random()*0.6), Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
  }
  for (let i = 0; i < 8; i++) {
    const mx = Math.random()*size;
    ctx.fillStyle = `rgba(60,90,40,${0.1+Math.random()*0.18})`;
    ctx.fillRect(mx, 0, 6+Math.random()*12, size);
  }
  ctx.strokeStyle = 'rgba(50,35,15,0.7)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let cx = Math.random()*size, cy = Math.random()*size;
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 6; s++) { cx += (Math.random()-0.5)*40; cy += (Math.random()-0.5)*40; ctx.lineTo(cx, cy); }
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const ex = Math.random()*size, ey = Math.random()*size;
    ctx.fillStyle = 'rgba(40,28,12,0.5)';
    ctx.beginPath(); ctx.ellipse(ex, ey, 4+Math.random()*10, 3+Math.random()*7, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
  }
  _stoneTexCache = new THREE.CanvasTexture(canvas);
  return _stoneTexCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('../MapConfig.js').MapConfig} */
const SAND_ARENA_CONFIG = {
  mapId:           'sand-arena',
  displayName:     'Sand Arena',
  clearColor:      0xf5a040,
  environmentTone: 'golden-hour',
  ambientSoundPath: null,

  boundary: { minX: -20, maxX: 20, minZ: -20, maxZ: 20, groundY: 0 },

  playerSpawns: [
    { x: -5, y: 0, z:  4 }, { x: -2, y: 0, z:  4 }, { x:  1, y: 0, z:  4 },
    { x:  4, y: 0, z:  4 }, { x:  7, y: 0, z:  4 },
  ],
  enemySpawns: [
    { x: -5, y: 0, z: -4 }, { x: -2, y: 0, z: -4 }, { x:  1, y: 0, z: -4 },
    { x:  4, y: 0, z: -4 }, { x:  7, y: 0, z: -4 },
  ],

  deckZone:      { id: 'deck',      center: { x:  5, y: 0.3, z: 9 }, radius: 1.2, type: 'deck'      },
  graveyardZone: { id: 'graveyard', center: { x: -5, y: 0.3, z: 9 }, radius: 1.2, type: 'graveyard' },
  interactableZones: [],

  lighting: {
    ambientColor: 0xffe0a0, ambientIntensity: 1.4,
    sunColor:     0xffb347, sunIntensity:     3.5,  sunPosition:  { x: -12, y: 10, z: 6 },
    fillColor:    0xffd580, fillIntensity:    1.2,  fillPosition: { x: 10, y: 6, z: -4 },
    skyColor:     0xadd8ff, skyIntensity:     0.5,
  },

  torchPositions: [[-8,-8],[8,-8],[-8,2],[8,2],[-8,8],[8,8]],
  pillarCorners:  [[-11,-11],[11,-11],[-11,11],[11,11]],
  pillarTilts:    [0.025, -0.018, -0.022, 0.015],

  dustCount:  30,
  dustBounds: { x: 24, y: { min: 0.3, max: 4.8 }, z: 24 },
};

// ─────────────────────────────────────────────────────────────────────────────
// SandArenaMap
// ─────────────────────────────────────────────────────────────────────────────

export class SandArenaMap extends MapInterface {
  constructor() {
    super();
    this._config = validateMapConfig(SAND_ARENA_CONFIG);
    this._scene  = null;

    /** @type {THREE.Object3D[]} - tracked by base-class cleanup() */
    this._owned = [];

    // Per-frame animation state
    this._torchLights = [];   // [{light, baseIntensity, phase}]
    this._flames      = [];   // [THREE.Mesh]
    this._fogLayers   = [];   // [{isCrackLight, light, baseIntensity}] | [{mesh, speed}]
    this._dustGeo     = null;
    this._dustData    = [];
    this._DUST_COUNT  = 0;
    this._dustTick    = 0;

    // Raycasting
    this._deckMeshes      = [];
    this._graveyardMeshes = [];
    // Deck groups for tick() bob animation
    this._deckObjects     = [];
  }

  // ── MapInterface: abstract methods ─────────────────────────────────────────

  /** @override */
  init(scene, config) {
    this._scene = scene;
    const lp = config.lighting;

    // Lighting
    this._add(new THREE.AmbientLight(lp.ambientColor, lp.ambientIntensity));
    const sun = new THREE.DirectionalLight(lp.sunColor, lp.sunIntensity);
    sun.position.set(lp.sunPosition.x, lp.sunPosition.y, lp.sunPosition.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    sun.shadow.camera.near  = 0.5; sun.shadow.camera.far   = 80;
    sun.shadow.camera.left  = sun.shadow.camera.bottom = -14;
    sun.shadow.camera.right = sun.shadow.camera.top    =  14;
    this._add(sun);
    const fill = new THREE.DirectionalLight(lp.fillColor, lp.fillIntensity);
    fill.position.set(lp.fillPosition.x, lp.fillPosition.y, lp.fillPosition.z);
    this._add(fill);
    const sky = new THREE.DirectionalLight(lp.skyColor, lp.skyIntensity);
    sky.position.set(0, 20, 0);
    this._add(sky);

    this._buildSky();
    this._buildGround();
    this._buildTorches(config.torchPositions);
    this._buildPillars(config.pillarCorners, config.pillarTilts);

    const runeLight = new THREE.PointLight(0xffaa00, 1.5, 14);
    runeLight.position.set(0, 0.5, -1);
    this._add(runeLight);
    this._fogLayers.push({ isCrackLight: true, light: runeLight, baseIntensity: 1.5 });

    this._buildDust(config.dustCount, config.dustBounds);

    // Deck + graveyard via shared builder
    const backTex = getBackTex();

    const deck = buildDeckStack(scene, this._owned, config.deckZone.center, backTex, false, {
      sideColor: 0x2a1f0e, sideEmissive: 0x886622,
      borderColor: 0xcc9933, borderEmissive: 0xbb8822, borderEmissiveIntensity: 0.7,
      ringColor:   0xddaa33, ringEmissive:   0xcc8811, ringEmissiveIntensity:   0.8,
    });
    this._deckMeshes = deck.meshes;
    this._deckObjects.push(deck.group);

    const gy = buildDeckStack(scene, this._owned, config.graveyardZone.center, backTex, true, {
      sideColor: 0x1a0e06, sideEmissive: 0x442200,
      borderColor: 0x6b3311, borderEmissive: 0x441100, borderEmissiveIntensity: 0.5,
      ringColor:   0x883311, ringEmissive:   0x551100, ringEmissiveIntensity:   0.8,
    });
    this._graveyardMeshes = gy.meshes;
    this._deckObjects.push(gy.group);
  }

  /** @override */
  getConfig() { return this._config; }

  // ── MapInterface: optional overrides ───────────────────────────────────────

  /** @override */
  tick(t, delta) {
    if (!this._scene) return;

    // Torch flicker
    this._torchLights.forEach(({ light, baseIntensity, phase }) => {
      light.intensity = baseIntensity
        + Math.sin(t * 7.3  + phase) * 0.5
        + Math.sin(t * 13.7 + phase * 2) * 0.3;
    });
    this._flames.forEach((f, i) => {
      f.rotation.y = t * 0.8 + i * 0.6;
      f.scale.y    = 1.0 + Math.sin(t * 8   + i * 1.3) * 0.18;
      f.scale.x    = 1.0 + Math.sin(t * 9.5 + i * 0.9) * 0.1;
    });

    // Crack-light pulse
    this._fogLayers.forEach(fl => {
      if (fl.isCrackLight) { fl.light.intensity = fl.baseIntensity + Math.sin(t * 2.4) * 0.6; }
    });

    // Dust motes — math + GPU upload throttled every other frame
    if (this._dustGeo) {
      this._dustTick++;
      if (this._dustTick % 2 === 0) {
        const dPos  = this._dustGeo.attributes.position.array;
        const bnd   = this._config.dustBounds;
        const dt2   = delta * 2;   // compensate for skipped frame
        for (let i = 0; i < this._DUST_COUNT; i++) {
          const d = this._dustData[i];
          d.x += (d.vx + Math.sin(t * 0.4 + d.phase) * 0.002) * dt2 * 30;
          d.y += d.vy * dt2 * 30;
          d.z += Math.cos(t * 0.3 + d.phase) * 0.002 * dt2 * 30;
          if (d.y > 5.0) { d.y = 0.2; d.x = (Math.random()-0.5)*bnd.x; d.z = (Math.random()-0.5)*bnd.z; }
          if (Math.abs(d.x) > bnd.x / 2) d.vx *= -1;
          dPos[i*3] = d.x; dPos[i*3+1] = d.y; dPos[i*3+2] = d.z;
        }
        this._dustGeo.attributes.position.needsUpdate = true;
      }
    }

    // Deck bob
    this._deckObjects.forEach(g => {
      if (g.userData.isGraveyard) return;
      g.position.y = g.userData.baseY + Math.sin(t * 0.5 + g.userData.phase) * 0.03;
    });
  }

  /** @override */
  getRaycastTargets(type) {
    if (type === 'deck')      return this._deckMeshes;
    if (type === 'graveyard') return this._graveyardMeshes;
    return [];
  }

  // ── Private builders ────────────────────────────────────────────────────────

  _add(obj) { this._scene.add(obj); this._owned.push(obj); return obj; }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(120, 32, 16);
    const colors = [], pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.max(0, Math.min(1, (y + 5) / 90));
      colors.push(0.98*(1-t)+0.18*t, 0.55*(1-t)+0.38*t, 0.22*(1-t)+0.72*t);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this._add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(5,24,24), new THREE.MeshBasicMaterial({ color: 0xfffae0 }));
    sunDisc.position.set(-60, 22, -80); this._add(sunDisc);

    const haloMat1 = new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const halo1 = new THREE.Mesh(new THREE.RingGeometry(6,16,48), haloMat1);
    halo1.position.copy(sunDisc.position); halo1.position.z += 1; this._add(halo1);

    const haloMat2 = new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const halo2 = new THREE.Mesh(new THREE.RingGeometry(16,32,48), haloMat2);
    halo2.position.copy(sunDisc.position); halo2.position.z += 2; this._add(halo2);

    // All clouds share one material — no .clone() needed since state is identical
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.55, depthWrite: false });
    [
      { x: -50, y: 28, z: -90, sx: 22, sz: 5 }, { x: 30, y: 35, z: -95, sx: 18, sz: 4 },
      { x:  60, y: 22, z: -85, sx: 14, sz: 3.5 }, { x: -80, y: 30, z: -88, sx: 20, sz: 4.5 },
      { x:  10, y: 45, z:-100, sx: 26, sz: 5 },
    ].forEach(c => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), cloudMat);
      m.scale.set(c.sx, c.sz, 4); m.position.set(c.x, c.y, c.z); this._add(m);
    });
  }

  _buildGround() {
    const sandTex = makeSandTexture();
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(3, 3);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.9, color: 0xddbb88 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this._add(floor);
  }

  _buildTorches(torchPositions) {
    const ironMat  = new THREE.MeshLambertMaterial({ color: 0x6b4c1a });
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xd4b483 });
    const fireMat  = new THREE.MeshBasicMaterial({ color: 0xff7700, transparent: true, opacity: 0.92 });

    torchPositions.forEach(([x, z], idx) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.8, 8), stoneMat);
      pedestal.position.set(x, 0.4, z); pedestal.castShadow = true; this._add(pedestal);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.8, 8), ironMat);
      stand.position.set(x, 2.2, z); this._add(stand);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.18, 0.45, 8), ironMat);
      bowl.position.set(x, 3.8, z); this._add(bowl);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.75, 7), fireMat.clone());
      flame.position.set(x, 4.35, z); this._add(flame); this._flames.push(flame);
      if (idx % 2 === 0) {
        const tl = new THREE.PointLight(0xff8833, 3.0, 18);
        tl.position.set(x, 4.5, z); this._add(tl);
        this._torchLights.push({ light: tl, baseIntensity: 3.0, phase: idx * 1.3 });
      }
    });
  }

  _buildPillars(pillarCorners, pillarTilts) {
    const weatheredTex = makeWeatheredStoneTexture();
    const pillarMat = new THREE.MeshLambertMaterial({ map: weatheredTex, color: 0xb8a080 });
    const capMat    = new THREE.MeshLambertMaterial({ map: weatheredTex, color: 0xa08060 });
    const chunkMat  = new THREE.MeshLambertMaterial({ color: 0x2a1e0a });

    pillarCorners.forEach(([x, z], idx) => {
      const group = new THREE.Group();
      const base  = new THREE.Mesh(SHARED_GEO.pillarBase,  capMat);    base.position.y  = 0.22; base.castShadow = true; group.add(base);
      const shaft = new THREE.Mesh(SHARED_GEO.pillarShaft, pillarMat); shaft.position.y = 3.22; shaft.castShadow = true; group.add(shaft);
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), chunkMat);
      chunk.position.set(0.38, 2.0 + Math.random()*1.5, 0); group.add(chunk);
      const cap = new THREE.Mesh(SHARED_GEO.pillarCap, capMat);
      cap.position.set((Math.random()-0.5)*0.08, 6.22, (Math.random()-0.5)*0.08); group.add(cap);
      if (idx % 2 === 0) {
        const broken = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), capMat);
        broken.position.set(0.2, 6.55, -0.15); broken.rotation.y = 0.4; group.add(broken);
      }
      group.position.set(x, 0, z);
      group.rotation.z = pillarTilts[idx];
      group.rotation.x = pillarTilts[(idx + 1) % 4] * 0.5;
      this._add(group);
    });
  }

  _buildDust(count, bounds) {
    this._DUST_COUNT = count;
    const positions  = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (Math.random()-0.5)*bounds.x;
      const y = bounds.y.min + Math.random()*(bounds.y.max-bounds.y.min);
      const z = (Math.random()-0.5)*bounds.z;
      this._dustData.push({ x, y, z, vy: (Math.random()-0.5)*0.003, vx: (Math.random()-0.5)*0.005, phase: Math.random()*Math.PI*2 });
      positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;
    }
    this._dustGeo = new THREE.BufferGeometry();
    this._dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0xffe099, size: 0.05, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true });
    this._add(new THREE.Points(this._dustGeo, dustMat));
  }
}
