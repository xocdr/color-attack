/**
 * DarkFantasyMap — gothic dark arena with lava cracks, embers, lightning.
 *
 * Fixes & improvements over the initial implementation:
 *   - Critical bug fixed: setTimeout inside tick() replaced with delta-based
 *     two-phase timer (_lightningTimer + _lightningFadeTimer).
 *   - Cloud material shared: one MeshBasicMaterial instance for ALL cloud
 *     puffs (was 30+ .clone() calls).
 *   - _buildDeck replaced with buildDeckStack() from MapUtils.
 *   - getSpawnPoints / getInteractableZones / cleanup deleted — inherited from
 *     MapInterface base class.
 *   - Ember particle math loop throttled every other frame.
 */

import * as THREE from 'three';
import { MapInterface }                             from '../MapInterface.js';
import { validateMapConfig }                        from '../MapConfig.js';
import { buildDeckStack, getBackTex, SHARED_GEO }   from '../MapUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import('../MapConfig.js').MapConfig} */
const DARK_FANTASY_CONFIG = {
  mapId:           'dark-fantasy',
  displayName:     'Shadow Citadel',
  clearColor:      0x140810,
  environmentTone: 'dark-fantasy',
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
    ambientColor: 0x1a0522, ambientIntensity: 1.2,
    sunColor:     0x4a0066, sunIntensity:     1.0,  sunPosition:  { x: -10, y: 8, z: 5 },
    fillColor:    0x220022, fillIntensity:    0.8,  fillPosition: { x: 8, y: 4, z: -4 },
    skyColor:     0x110011, skyIntensity:     0.3,
  },

  torchPositions: [[-8,-8],[8,-8],[-8,2],[8,2],[-8,8],[8,8]],
  pillarCorners:  [[-11,-11],[11,-11],[-11,11],[11,11]],
  pillarTilts:    [0.025, -0.018, -0.022, 0.015],

  emberCount:  40,
  emberBounds: { x: 26, y: { min: 0.2, max: 6.5 }, z: 26 },
};

// ─────────────────────────────────────────────────────────────────────────────
// DarkFantasyMap
// ─────────────────────────────────────────────────────────────────────────────

export class DarkFantasyMap extends MapInterface {
  constructor() {
    super();
    this._config = validateMapConfig(DARK_FANTASY_CONFIG);
    this._scene  = null;

    /** @type {THREE.Object3D[]} - tracked by base-class cleanup() */
    this._owned = [];

    // Torch animation state
    this._torchLights = [];   // [{light, baseIntensity, phase}]
    this._flames      = [];   // [THREE.Mesh]

    // Ember particle state
    this._emberGeo    = null;
    this._emberData   = [];
    this._EMBER_COUNT = 0;
    this._emberTick   = 0;

    // Lightning delta-based two-phase timer (fix: no more setTimeout)
    this._lightningLight      = null;
    this._lightningTimer      = 2 + Math.random() * 3;   // seconds until next flash
    this._lightningFadeTimer  = 0;                        // seconds remaining in fade

    // Crack-glow light
    this._crackLight         = null;
    this._crackBaseIntensity = 1.8;

    // Raycasting
    this._deckMeshes      = [];
    this._graveyardMeshes = [];
    this._deckGroups      = [];
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
    this._add(sun);
    const fill = new THREE.DirectionalLight(lp.fillColor, lp.fillIntensity);
    fill.position.set(lp.fillPosition.x, lp.fillPosition.y, lp.fillPosition.z);
    this._add(fill);

    // Lava crack ground light
    this._crackLight = new THREE.PointLight(0xff4400, this._crackBaseIntensity, 18);
    this._crackLight.position.set(0, 0.3, 0);
    this._add(this._crackLight);

    // Purple ambient fill — one central light replaces three
    const purpleA = new THREE.PointLight(0x5500aa, 1.4, 35); purpleA.position.set(0, 8, 0); this._add(purpleA);

    // Lightning global fill (starts at 0, set by timer in tick)
    this._lightningLight = new THREE.DirectionalLight(0xccddff, 0);
    this._lightningLight.position.set(5, 20, 5);
    this._add(this._lightningLight);

    this._buildSky();
    this._buildGround();
    this._buildLavaCracks();
    this._buildTorches(config.torchPositions);
    this._buildPillars(config.pillarCorners, config.pillarTilts);
    this._buildFogLayers();
    this._buildEmbers(config.emberCount, config.emberBounds);

    const backTex = getBackTex();

    const deck = buildDeckStack(scene, this._owned, config.deckZone.center, backTex, false, {
      sideColor: 0x1a0a2e, sideEmissive: 0x440066, sideEmissiveIntensity: 0.4,
      borderColor: 0x6600aa, borderEmissive: 0x4400aa, borderEmissiveIntensity: 0.8,
      ringColor:   0x8800cc, ringEmissive:   0x5500aa, ringEmissiveIntensity:   1.0,
    });
    this._deckMeshes = deck.meshes;
    this._deckGroups.push(deck.group);

    const gy = buildDeckStack(scene, this._owned, config.graveyardZone.center, backTex, true, {
      sideColor: 0x0d0008, sideEmissive: 0x220011, sideEmissiveIntensity: 0.3,
      borderColor: 0x440022, borderEmissive: 0x220011, borderEmissiveIntensity: 0.5,
      ringColor:   0x660033, ringEmissive:   0x330011, ringEmissiveIntensity:   0.8,
    });
    this._graveyardMeshes = gy.meshes;
    this._deckGroups.push(gy.group);
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
        + Math.sin(t * 7.8  + phase) * 0.7
        + Math.sin(t * 15.2 + phase * 2.5) * 0.4;
    });
    this._flames.forEach((f, i) => {
      f.rotation.y = t * 1.2 + i * 0.6;
      f.scale.y    = 1.0 + Math.sin(t * 9   + i * 1.4) * 0.22;
      f.scale.x    = 1.0 + Math.sin(t * 11  + i * 1.1) * 0.12;
    });

    // Lava crack pulse
    if (this._crackLight) {
      this._crackLight.intensity = this._crackBaseIntensity
        + Math.sin(t * 2.1) * 0.9
        + Math.sin(t * 5.3) * 0.4;
    }

    // Lightning — delta-based two-phase timer; no setTimeout, no closure allocation
    this._lightningTimer -= delta;
    if (this._lightningTimer <= 0) {
      this._lightningLight.intensity = 4 + Math.random() * 6;
      this._lightningFadeTimer = 0.08;
      this._lightningTimer = 3 + Math.random() * 5;
    }
    if (this._lightningFadeTimer > 0) {
      this._lightningFadeTimer -= delta;
      if (this._lightningFadeTimer <= 0) {
        this._lightningLight.intensity = 0;
        this._lightningFadeTimer = 0;
      }
    }

    // Ember particles — math + GPU upload throttled every other frame
    if (this._emberGeo) {
      this._emberTick++;
      if (this._emberTick % 2 === 0) {
        const ePos = this._emberGeo.attributes.position.array;
        const bnd  = this._config.emberBounds;
        const dt2  = delta * 2;  // compensate for skipped frame
        for (let i = 0; i < this._EMBER_COUNT; i++) {
          const e = this._emberData[i];
          e.x += (e.vx + Math.sin(t * 0.5 + e.phase) * 0.004) * dt2 * 30;
          e.y += (e.vy + 0.003) * dt2 * 30;
          e.z += Math.cos(t * 0.4 + e.phase) * 0.003 * dt2 * 30;
          if (e.y > bnd.y.max + 1) {
            e.y = bnd.y.min;
            e.x = (Math.random() - 0.5) * bnd.x;
            e.z = (Math.random() - 0.5) * bnd.z;
          }
          if (Math.abs(e.x) > bnd.x / 2) e.vx *= -1;
          ePos[i*3] = e.x; ePos[i*3+1] = e.y; ePos[i*3+2] = e.z;
        }
        this._emberGeo.attributes.position.needsUpdate = true;
      }
    }

    // Deck bob
    this._deckGroups.forEach(g => {
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
      const y  = pos.getY(i);
      const bl = Math.max(0, Math.min(1, (y + 5) / 90));
      colors.push(0.04*(1-bl)+0.02*bl, 0, 0.06*(1-bl)+0.08*bl);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this._add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

    // Moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4,24,24), new THREE.MeshBasicMaterial({ color: 0xddccff }));
    moon.position.set(50, 45, -80); this._add(moon);
    const moonGlow = new THREE.Mesh(
      new THREE.RingGeometry(5, 14, 48),
      new THREE.MeshBasicMaterial({ color: 0x6600aa, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    moonGlow.position.copy(moon.position); moonGlow.position.z += 1; this._add(moonGlow);

    // Clouds — ONE shared material for all puffs (was 30+ .clone() calls)
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0x2a1030, transparent: true, opacity: 0.35, depthWrite: false });
    [
      { x:-50, y:30, z:-90 }, { x: 30, y:40, z:-95 }, { x: 60, y:25, z:-85 },
      { x:-80, y:35, z:-88 }, { x: 10, y:50, z:-100 }, { x:-30, y:20, z:-80 },
      { x: 70, y:45, z:-92 }, { x:-60, y:28, z:-82 },  { x: 20, y:38, z:-88 }, { x:-20, y:55, z:-97 },
    ].forEach(c => {
      const puffCount = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffCount; p++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(3 + Math.random() * 5, 7, 5),
          cloudMat,  // shared — no .clone()
        );
        puff.position.set(
          c.x + (Math.random()-0.5) * 12,
          c.y + (Math.random()-0.5) * 4,
          c.z + (Math.random()-0.5) * 6,
        );
        puff.scale.set(1, 0.4 + Math.random() * 0.4, 0.6 + Math.random() * 0.4);
        this._add(puff);
      }
    });
  }

  _buildGround() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1024;
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark
        ? `rgba(10,5,5,${0.3+Math.random()*0.4})`
        : `rgba(40,20,15,${0.2+Math.random()*0.3})`;
      ctx.fillRect(x, y, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshLambertMaterial({ map: tex, color: 0x1a0808 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this._add(floor);
  }

  _buildLavaCracks() {
    const crackMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.85 });
    [
      [0, 0, 10, 0.3], [-3, 0, 8, 0.2], [2, 0, -4, 0.25], [-5, 0, -6, 0.2],
      [7, 0, 2, 0.15], [0, 0, -9, 0.22], [-8, 0, 3, 0.18], [5, 0, 7, 0.2],
    ].forEach(([cx, , cz, w]) => {
      const len  = 1.5 + Math.random() * 3;
      const rz   = Math.random() * Math.PI;
      const ox   = cx + (Math.random()-0.5)*2;
      const oz   = cz + (Math.random()-0.5)*2;
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(w, len), crackMat);
      crack.rotation.x = -Math.PI / 2; crack.rotation.z = rz;
      crack.position.set(ox, 0.01, oz); this._add(crack);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 3.5, len * 3.5),
        new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2; glow.rotation.z = rz;
      glow.position.set(ox, 0.005, oz); this._add(glow);
    });
  }

  _buildTorches(torchPositions) {
    const ironMat  = new THREE.MeshLambertMaterial({ color: 0x2a1a2a });
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x1a0a1a });
    const fireMat  = new THREE.MeshBasicMaterial({ color: 0xaa00ff, transparent: true, opacity: 0.9 });

    torchPositions.forEach(([x, z], idx) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.85, 8), stoneMat);
      pedestal.position.set(x, 0.42, z); pedestal.castShadow = true; this._add(pedestal);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.0, 8), ironMat);
      stand.position.set(x, 2.3, z); this._add(stand);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.2, 0.5, 8), ironMat);
      bowl.position.set(x, 4.0, z); this._add(bowl);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.85, 7), fireMat.clone());
      flame.position.set(x, 4.65, z); this._add(flame); this._flames.push(flame);
      if (idx % 2 === 0) {
        const tl = new THREE.PointLight(0x8800cc, 2.8, 16);
        tl.position.set(x, 4.8, z); this._add(tl);
        this._torchLights.push({ light: tl, baseIntensity: 2.8, phase: idx * 1.7 });
      }
    });
  }

  _buildPillars(pillarCorners, pillarTilts) {
    const darkStoneMat = new THREE.MeshLambertMaterial({ color: 0x0d0808 });
    const capMat       = new THREE.MeshLambertMaterial({ color: 0x150b15 });
    const runeMat      = new THREE.MeshBasicMaterial({ color: 0x660088, transparent: true, opacity: 0.6 });

    pillarCorners.forEach(([x, z], idx) => {
      const group = new THREE.Group();
      const base  = new THREE.Mesh(SHARED_GEO.pillarBase,  capMat);       base.position.y  = 0.22; base.castShadow = true; group.add(base);
      const shaft = new THREE.Mesh(SHARED_GEO.pillarShaft, darkStoneMat); shaft.position.y = 3.22; shaft.castShadow = true; group.add(shaft);
      const cap   = new THREE.Mesh(SHARED_GEO.pillarCap,   capMat);       cap.position.y   = 6.22; group.add(cap);
      const rune  = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 2.5), runeMat);
      rune.position.set(0.53, 3.5, 0); group.add(rune);
      const runeGlo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 2.8),
        new THREE.MeshBasicMaterial({ color: 0x440066, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      runeGlo.position.set(0.55, 3.5, 0); group.add(runeGlo);
      group.position.set(x, 0, z);
      group.rotation.z = pillarTilts[idx];
      this._add(group);
    });

    // Background mountain silhouettes
    const mountainMat = new THREE.MeshBasicMaterial({ color: 0x0a0512, side: THREE.DoubleSide });
    [[-90,0,-100,1.0],[90,0,-100,0.9],[0,0,-110,1.1],[-50,0,-95,0.85],[50,0,-95,0.8]].forEach(([mx,,mz,sc]) => {
      const h = 30 + Math.random() * 15, w = 18 + Math.random() * 12;
      const m = new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, h, 4), mountainMat);
      m.position.set(mx, h * 0.5 - 2, mz); m.scale.set(sc, sc, sc); this._add(m);
    });
  }

  _buildFogLayers() {
    const fogMat1 = new THREE.MeshBasicMaterial({ color: 0x1a0022, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const fogMat2 = new THREE.MeshBasicMaterial({ color: 0x0d0015, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide });
    [{ mat: fogMat1, y: 0.5 }, { mat: fogMat2, y: 1.8 }].forEach(({ mat, y }) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), mat);
      f.rotation.x = -Math.PI / 2; f.position.set(0, y, 0); this._add(f);
    });
  }

  _buildEmbers(count, bounds) {
    this._EMBER_COUNT = count;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (Math.random()-0.5) * bounds.x;
      const y = bounds.y.min + Math.random() * (bounds.y.max - bounds.y.min);
      const z = (Math.random()-0.5) * bounds.z;
      this._emberData.push({ x, y, z, vy: 0.005 + Math.random()*0.01, vx: (Math.random()-0.5)*0.006, phase: Math.random()*Math.PI*2 });
      positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;
    }
    this._emberGeo = new THREE.BufferGeometry();
    this._emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._add(new THREE.Points(this._emberGeo, new THREE.PointsMaterial({ color: 0xff4400, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true })));

    // Purple mist overlay (static — no per-frame update needed)
    const mistCount = 80;
    const mistPos   = new Float32Array(mistCount * 3);
    for (let i = 0; i < mistCount; i++) {
      mistPos[i*3]   = (Math.random()-0.5) * 34;
      mistPos[i*3+1] = Math.random() * 5;
      mistPos[i*3+2] = (Math.random()-0.5) * 34;
    }
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
    this._add(new THREE.Points(mistGeo, new THREE.PointsMaterial({ color: 0x6600aa, size: 0.35, transparent: true, opacity: 0.18, depthWrite: false, sizeAttenuation: true })));
  }
}
