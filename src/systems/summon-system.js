import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

export const SummonState = Object.freeze({
  IDLE:             'IDLE',
  INITIATED:        'INITIATED',
  CARD_DROPPING:    'CARD_DROPPING',
  CARD_LANDED:      'CARD_LANDED',
  MONSTER_SPAWNING: 'MONSTER_SPAWNING',
  COMPLETE:         'COMPLETE',
});

// ─────────────────────────────────────────────────────────────────────────────
// EASING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Heavy ease-in for card slam — slow start, hard acceleration into the ground.
function easeInQuart(t) {
  return t * t * t * t;
}

// Elastic ease-out for monster spawn — overshoots scale then snaps back.
function easeOutElastic(t) {
  if (t === 0) return 0;
  if (t === 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD MESH FACTORY
// Matches the flat card geometry used throughout the rest of the arena.
// ─────────────────────────────────────────────────────────────────────────────

const _cardGeo = new THREE.BoxGeometry(1.4, 0.022, 1.9);
const _cardMat = new THREE.MeshStandardMaterial({
  color:             0x1a1a2e,
  emissive:          0x2244cc,
  emissiveIntensity: 0.8,
  metalness:         0.4,
  roughness:         0.5,
});

function buildCardMesh() {
  return new THREE.Mesh(_cardGeo, _cardMat.clone());
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC POSITIONING
// Projects the camera's forward vector onto the XZ plane to find a raw
// "in-front-of-camera" anchor, then snaps it to the nearest free player slot.
// ─────────────────────────────────────────────────────────────────────────────

const _fwd = new THREE.Vector3();

function resolveAnchor(camera, slotOccupied, playerPositions, ANCHOR_FORWARD_DISTANCE) {
  // Camera forward on the XZ plane (strip Y tilt, normalize).
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _fwd.y = 0;
  _fwd.normalize();

  // Project camera position to ground level, push forward.
  const rawAnchor = camera.position.clone();
  rawAnchor.y = 0;
  rawAnchor.addScaledVector(_fwd, ANCHOR_FORWARD_DISTANCE);

  return findNearestFreeSlot(rawAnchor, slotOccupied, playerPositions);
}

function findNearestFreeSlot(rawAnchor, slotOccupied, playerPositions) {
  let bestIdx  = -1;
  let bestDist = Infinity;

  for (let i = 0; i < playerPositions.length; i++) {
    if (slotOccupied[i]) continue;
    const dx   = rawAnchor.x - playerPositions[i].x;
    const dz   = rawAnchor.z - playerPositions[i].z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }

  if (bestIdx === -1) {
    // All slots occupied — use the raw projected position as a fallback.
    console.warn('[SummonSystem] all player slots occupied, using free-form anchor');
    return { anchor: rawAnchor, slotIndex: -1 };
  }

  return { anchor: playerPositions[bestIdx].clone(), slotIndex: bestIdx };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMON SYSTEM
// Central handler that owns the full INITIATED → CARD_DROPPING → CARD_LANDED
// → MONSTER_SPAWNING → COMPLETE pipeline for a single auto-summoned card.
// ─────────────────────────────────────────────────────────────────────────────

export class SummonSystem {
  /**
   * @param {THREE.Scene}     scene
   * @param {THREE.Camera}    camera
   * @param {boolean[]}       slotOccupied    - Shared array; written on slot resolution.
   * @param {THREE.Vector3[]} playerPositions - The 5 fixed player slot world positions.
   * @param {object}          monsterRegistry - Map of name → { builder, collect, stats, … }
   * @param {object}          templateCache   - Map of name → pre-built THREE.Group (cloned per summon).
   * @param {function}        addAuraFn       - (monster, auraColor) → void
   * @param {function}        onComplete      - (monsterGroup) → void  called when animation finishes.
   */
  constructor(scene, camera, slotOccupied, playerPositions,
              monsterRegistry, templateCache, addAuraFn, onComplete) {
    this.scene           = scene;
    this.camera          = camera;
    this.slotOccupied    = slotOccupied;
    this.playerPositions = playerPositions;
    this.monsterRegistry = monsterRegistry;
    this.templateCache   = templateCache;
    this.addAuraFn       = addAuraFn;
    this.onComplete      = onComplete;

    this.state = SummonState.IDLE;

    // Animation timing (seconds) — mirrors FieldSlot for visual consistency.
    this.CARD_DROP_DURATION     = 0.55;
    this.MONSTER_SPAWN_DURATION = 0.60;

    // How far in front of the camera footprint the FieldAnchor is placed.
    this.ANCHOR_FORWARD_DISTANCE = 4.0;

    // Internal animation state.
    this._elapsed        = 0;
    this._anchor         = null;   // Vector3 resolved at summon time
    this._cardMesh       = null;
    this._pendingMonster = null;
    this._pendingCardData = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Kick off the full summoning sequence for cardData.
   * Safe to call from any event handler — guard prevents double-firing.
   * @param {{ name: string, icon: string, cost: number, auraColor?: number }} cardData
   */
  executeSummonSequence(cardData) {
    if (this.state !== SummonState.IDLE) return;

    const reg = this.monsterRegistry[cardData.name];
    if (!reg) {
      console.warn(`[SummonSystem] unknown monster: "${cardData.name}"`);
      return;
    }

    // Clone from template cache — preserves GPU buffer sharing.
    const monster = this.templateCache[cardData.name].clone();
    monster.userData.monsterName = cardData.name;
    monster.userData.registry    = reg;
    monster.userData.baseY       = 0;
    monster.userData.phase       = Math.random() * Math.PI * 2;
    monster.userData.slot        = -1;   // sentinel: free-summoned, not from a fixed slot

    if (reg.stats.auraColor !== undefined) {
      this.addAuraFn(monster, reg.stats.auraColor);
    }

    this._pendingMonster  = monster;
    this._pendingCardData = cardData;

    // ─── PHASE: INITIATED ──────────────────────────────────────────────────
    // Resolve the FieldAnchor and place both meshes synchronously, then
    // immediately begin the drop animation.
    this._setState(SummonState.INITIATED);
    this._setupCardAndMonster();
    this._setState(SummonState.CARD_DROPPING);
  }

  /**
   * Drive all active animations. Call once per frame from the animate loop.
   * @param {number} delta - Frame delta in seconds.
   */
  update(delta) {
    if (this.state === SummonState.IDLE || this.state === SummonState.COMPLETE) return;

    this._elapsed += delta;

    switch (this.state) {

      // ── PHASE 1: CARD_DROPPING ────────────────────────────────────────────
      // Card falls from y+5 to the anchor floor using easeInQuart (gravity feel).
      case SummonState.CARD_DROPPING: {
        const t = Math.min(this._elapsed / this.CARD_DROP_DURATION, 1);
        const e = easeInQuart(t);

        this._cardMesh.position.set(
          this._anchor.x,
          this._anchor.y + 5 * (1 - e),
          this._anchor.z - 2 * (1 - e)
        );
        // Rotate from tilted (π/2) to flat (0) as it lands face-up.
        this._cardMesh.rotation.x = (Math.PI / 2) * (1 - e);

        if (t >= 1) this._onCardLanded();
        break;
      }

      // ── PHASE 3: MONSTER_SPAWNING ─────────────────────────────────────────
      // Monster scales from 0 → 1 with elastic overshoot; opacity 0 → 1 over 0.6 s.
      case SummonState.MONSTER_SPAWNING: {
        const t        = Math.min(this._elapsed / this.MONSTER_SPAWN_DURATION, 1);
        const scaleE   = easeOutElastic(t);
        const opacityE = Math.min(t / 0.6, 1);

        this._pendingMonster.scale.setScalar(Math.max(0, scaleE));
        this._setMonsterOpacity(opacityE);

        if (t >= 1) this._onSummonComplete();
        break;
      }
    }
  }

  // ── Private state transitions ───────────────────────────────────────────────

  _setState(newState) {
    this.state    = newState;
    this._elapsed = 0;
  }

  // ── PHASE 2: CARD_LANDED (impact event) ────────────────────────────────────
  _onCardLanded() {
    this._setState(SummonState.CARD_LANDED);
    this._triggerScreenShake();
    // Immediately transition — CARD_LANDED is a zero-duration impact state.
    this._setState(SummonState.MONSTER_SPAWNING);
  }

  _onSummonComplete() {
    this._setMonsterOpacity(1, false);   // restore full opacity, disable transparency
    this._setState(SummonState.COMPLETE);

    if (this.onComplete) this.onComplete(this._pendingMonster);

    // Reset for the next summon.
    this._pendingMonster  = null;
    this._pendingCardData = null;
    this._cardMesh        = null;
    this._anchor          = null;
    this._setState(SummonState.IDLE);
  }

  // ── Setup helpers ───────────────────────────────────────────────────────────

  _setupCardAndMonster() {
    // ── FieldAnchor: resolve dynamic world-space coordinate ──────────────────
    const { anchor, slotIndex } = resolveAnchor(
      this.camera,
      this.slotOccupied,
      this.playerPositions,
      this.ANCHOR_FORWARD_DISTANCE
    );
    this._anchor = anchor;

    // Mark the slot occupied immediately so rapid drops can't double-stack.
    if (slotIndex !== -1) {
      this.slotOccupied[slotIndex] = true;
      this._pendingMonster.userData.slot = slotIndex;
    }

    // ── Monster Mesh: hidden at anchor, waiting for MONSTER_SPAWNING ─────────
    this._pendingMonster.position.copy(anchor);
    this._pendingMonster.scale.setScalar(0);
    this._setMonsterOpacity(0);
    this.scene.add(this._pendingMonster);

    // ── Card Mesh: spawned high above anchor, flat face-up orientation ────────
    this._cardMesh = buildCardMesh();
    this._cardMesh.position.set(anchor.x, anchor.y + 5, anchor.z - 2);
    this._cardMesh.rotation.x = Math.PI / 2;
    this.scene.add(this._cardMesh);

    this._elapsed = 0;

    console.log(`[SummonSystem] FieldAnchor resolved → slot ${slotIndex}`, anchor);
  }

  // ── Impact placeholder ──────────────────────────────────────────────────────
  _triggerScreenShake() {
    console.log('[SummonSystem] card landed at', this._anchor);
    // TODO: briefly offset camera.position for tactile impact feel.
    // Pattern: store shake offset Vector3, decay it over ~0.2 s in update().
  }

  // ── Material helpers ────────────────────────────────────────────────────────

  _setMonsterOpacity(opacity, transparent = true) {
    if (!this._pendingMonster) return;
    if (!this._pendingMonster.userData._opacityMats) {
      const mats = [];
      this._pendingMonster.traverse(child => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.userData._opacityCloned = true;
        mats.push(child.material);
      });
      this._pendingMonster.userData._opacityMats = mats;
    }
    const mats = this._pendingMonster.userData._opacityMats;
    for (let i = 0; i < mats.length; i++) {
      mats[i].transparent = transparent;
      mats[i].opacity     = opacity;
    }
  }
}
