/**
 * MapUtils — shared utilities for all map implementations.
 *
 * Centralises the deck stack builder, the standard cleanup loop, the shared
 * card-back texture loader, and module-scope geometry constants so nothing
 * is duplicated across SandArenaMap / DarkFantasyMap / future map packs.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Shared card-back texture — one GPU upload for the entire session.
// Both maps and arena.js (fly-card) use this instead of separate TextureLoader
// calls. The browser HTTP cache would deduplicate the network request but
// Three.js would still create three separate Texture objects; this prevents that.
// ─────────────────────────────────────────────────────────────────────────────

let _backTexCache = null;

/**
 * Returns the lazily-loaded card back texture (src/card-img/back.png).
 * Logs a warning to the console if the file fails to load.
 * @returns {THREE.Texture}
 */
export function getBackTex() {
  if (!_backTexCache) {
    _backTexCache = new THREE.TextureLoader().load(
      'src/card-img/back.png',
      undefined,
      undefined,
      () => console.warn('[MapUtils] failed to load card back texture — using fallback'),
    );
  }
  return _backTexCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared geometries — created once, never individually disposed.
// These are read-only data shared by every mesh that references them.
// DO NOT call .dispose() on these in map cleanup() methods.
// ─────────────────────────────────────────────────────────────────────────────

export const SHARED_GEO = Object.freeze({
  /** Standard playing card (W=1.4, H=0.022, D=1.9) */
  cardBox:      new THREE.BoxGeometry(1.4, 0.022, 1.9),
  /** Card border inset */
  cardBorderBox: new THREE.BoxGeometry(1.4 * 0.84, 0.022 * 0.5, 1.9 * 0.84),
  /** Deck / graveyard ring indicator */
  deckRing:     new THREE.RingGeometry(0.85, 1.1, 48),
  /** Standard arena pillar shaft */
  pillarShaft:  new THREE.CylinderGeometry(0.42, 0.52, 5.6, 8),
  /** Standard pillar base slab */
  pillarBase:   new THREE.BoxGeometry(1.5, 0.45, 1.5),
  /** Standard pillar capital */
  pillarCap:    new THREE.BoxGeometry(1.3, 0.4, 1.3),
});

// ─────────────────────────────────────────────────────────────────────────────
// Standard cleanup — traverses and disposes all owned scene objects.
// Used by every MapInterface subclass's cleanup() implementation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes every object in `owned` from `scene`, then disposes all geometries
 * and materials found by traversal. Clears the owned array in place.
 *
 * NOTE: Do NOT include objects that hold shared geometries from SHARED_GEO in
 * the traversal path if you plan to dispose those geometries here — shared
 * geometries must never be disposed.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D[]} owned  - Array that will be emptied after cleanup.
 */
export function standardCleanup(scene, owned) {
  for (const obj of owned) {
    scene.remove(obj);
    obj.traverse(child => {
      if (!child.isMesh) return;
      // Only dispose geometries that are NOT shared module-scope constants.
      // Shared geometries are identified by reference equality.
      const isShared = Object.values(SHARED_GEO).includes(child.geometry);
      if (!isShared) child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material?.dispose();
      }
    });
  }
  owned.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deck stack builder — the single canonical implementation used by every map.
// Previously copy-pasted identically in SandArenaMap and DarkFantasyMap.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DeckStyle
 * @property {number} sideColor
 * @property {number} sideEmissive
 * @property {number} [sideEmissiveIntensity]
 * @property {number} borderColor
 * @property {number} borderEmissive
 * @property {number} [borderEmissiveIntensity]
 * @property {number} ringColor
 * @property {number} ringEmissive
 * @property {number} [ringEmissiveIntensity]
 * @property {number} [cardCount]         - Defaults to 10 for deck, 4 for graveyard.
 */

/**
 * Builds a deck or graveyard card stack and ring indicator.
 * Adds all created objects to `scene` and appends them to `owned` for cleanup.
 *
 * @param {THREE.Scene}       scene
 * @param {THREE.Object3D[]}  owned        - Tracking array for cleanup.
 * @param {{x:number,y:number,z:number}} center  - World position.
 * @param {THREE.Texture}     backTex
 * @param {boolean}           isGraveyard
 * @param {DeckStyle}         style
 * @returns {{ group: THREE.Group, meshes: THREE.Mesh[] }}
 */
export function buildDeckStack(scene, owned, center, backTex, isGraveyard, style) {
  const {
    sideColor,   sideEmissive,   sideEmissiveIntensity   = 0.3,
    borderColor, borderEmissive, borderEmissiveIntensity = 0.7,
    ringColor,   ringEmissive,   ringEmissiveIntensity   = 0.8,
    cardCount = isGraveyard ? 4 : 10,
  } = style;

  const W = 1.4, H = 0.022, D = 1.9;

  const sideMat = new THREE.MeshStandardMaterial({
    color: sideColor, emissive: sideEmissive, emissiveIntensity: sideEmissiveIntensity,
  });
  const backFaceMat = new THREE.MeshStandardMaterial({
    map: backTex, emissive: 0x222222, emissiveIntensity: 0.3,
  });
  // BoxGeometry material order: +x, -x, +y (top/face), -y, +z, -z
  const cardMats = [sideMat, sideMat, backFaceMat, sideMat, backFaceMat, backFaceMat];

  const borderMat = new THREE.MeshStandardMaterial({
    color: borderColor, emissive: borderEmissive, emissiveIntensity: borderEmissiveIntensity,
  });

  const g = new THREE.Group();

  for (let i = 0; i < cardCount; i++) {
    const card = new THREE.Mesh(SHARED_GEO.cardBox, cardMats);
    card.position.set(
      (Math.random() - 0.5) * (isGraveyard ? 0.3 : 0.04),
      i * H * 1.15,
      (Math.random() - 0.5) * (isGraveyard ? 0.25 : 0.04),
    );
    card.rotation.y = (Math.random() - 0.5) * 0.06;
    if (isGraveyard) card.rotation.x = (Math.random() - 0.5) * 0.08;
    g.add(card);

    const border = new THREE.Mesh(SHARED_GEO.cardBorderBox, borderMat);
    border.position.set(card.position.x, card.position.y + H, card.position.z);
    border.rotation.copy(card.rotation);
    g.add(border);
  }

  const stackTopY = cardCount * H * 1.15 + H * 0.5;
  const topCard   = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: backTex, emissive: 0x333333, emissiveIntensity: 0.5, side: THREE.DoubleSide }),
  );
  topCard.position.set(0, stackTopY, 0);
  topCard.rotation.x = -Math.PI / 2;
  g.add(topCard);

  g.rotation.x           = isGraveyard ? 0.08 : 0.1;
  g.position.set(center.x, 0, center.z);
  g.userData.isDeck      = true;
  g.userData.isGraveyard = isGraveyard;
  g.userData.baseY       = 0;
  g.userData.phase       = isGraveyard ? 1.6 : 0.8;

  scene.add(g);
  owned.push(g);

  const ring = new THREE.Mesh(
    SHARED_GEO.deckRing,
    new THREE.MeshStandardMaterial({
      color: ringColor, emissive: ringEmissive, emissiveIntensity: ringEmissiveIntensity,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(center.x, 0.01, center.z);
  scene.add(ring);
  owned.push(ring);

  // Collect all child meshes for raycasting
  const meshes = [];
  g.traverse(c => { if (c.isMesh) meshes.push(c); });

  return { group: g, meshes };
}
