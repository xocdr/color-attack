import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

export const SlotState = Object.freeze({
  IDLE:             'IDLE',
  CARD_DROPPING:    'CARD_DROPPING',
  CARD_LANDED:      'CARD_LANDED',
  MONSTER_SPAWNING: 'MONSTER_SPAWNING',
  ACTIVE:           'ACTIVE',
});

// ─────────────────────────────────────────────────────────────────────────────
// EASING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Heavy ease-in for card slam — card is slow at first, then accelerates hard.
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
// Matches the flying-card geometry already used in arena.js.
// ─────────────────────────────────────────────────────────────────────────────

const _cardGeo = new THREE.BoxGeometry(1.4, 0.022, 1.9);
const _cardMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  emissive: 0x2244cc,
  emissiveIntensity: 0.8,
  metalness: 0.4,
  roughness: 0.5,
});

function buildCardMesh() {
  return new THREE.Mesh(_cardGeo, _cardMat.clone());
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD SLOT
// Coordinate anchor + animation state machine for a single player slot.
// ─────────────────────────────────────────────────────────────────────────────

export class FieldSlot {
  /**
   * @param {THREE.Vector3} position  - World-space anchor for this slot.
   * @param {THREE.Scene}   scene     - Scene to add/remove objects from.
   * @param {number}        slotIndex - Used for logging and aura phase.
   * @param {function}      onActive  - Called when summoning completes; receives the monster Group.
   */
  constructor(position, scene, slotIndex, onActive) {
    this.position   = position.clone();
    this.scene      = scene;
    this.slotIndex  = slotIndex;
    this.onActive   = onActive;   // callback: (monsterGroup) => void

    this.state        = SlotState.IDLE;
    this.cardMesh     = null;
    this.monsterGroup = null;

    // Tween clock shared across states
    this._elapsed  = 0;

    // Duration constants (seconds)
    this.CARD_DROP_DURATION    = 0.55;
    this.MONSTER_SPAWN_DURATION = 0.60;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Begin the summoning pipeline.
   * @param {THREE.Group} monsterGroup - Pre-cloned monster Group (not yet in scene).
   */
  summon(monsterGroup) {
    if (this.state !== SlotState.IDLE) return;

    this.monsterGroup = monsterGroup;

    // Position the monster at the slot anchor; hide it until MONSTER_SPAWNING.
    this.monsterGroup.position.copy(this.position);
    this.monsterGroup.scale.setScalar(0);
    this._setMonsterOpacity(0);
    this.scene.add(this.monsterGroup);

    // Build and position the card mesh at its starting offset.
    this.cardMesh = buildCardMesh();
    this.cardMesh.position.set(
      this.position.x,
      this.position.y + 5,       // start high above the slot
      this.position.z - 2        // start slightly behind
    );
    this.cardMesh.rotation.x = Math.PI / 2;   // flat / face-up orientation
    this.scene.add(this.cardMesh);

    this._elapsed = 0;
    this._setState(SlotState.CARD_DROPPING);
  }

  /**
   * Drive all active animations. Call once per frame from the animate loop.
   * @param {number} delta - Frame delta in seconds.
   */
  update(delta) {
    if (this.state === SlotState.IDLE || this.state === SlotState.ACTIVE) return;

    this._elapsed += delta;

    switch (this.state) {

      // ── CARD_DROPPING ────────────────────────────────────────────────────
      case SlotState.CARD_DROPPING: {
        const t = Math.min(this._elapsed / this.CARD_DROP_DURATION, 1);
        const e = easeInQuart(t);

        // Interpolate position: start [x, y+5, z-2] → end [x, y, z]
        this.cardMesh.position.set(
          this.position.x,
          this.position.y + 5 * (1 - e),
          this.position.z - 2 * (1 - e)
        );

        // Interpolate rotation: flat [π/2, 0, 0] → resting [0, 0, 0]
        this.cardMesh.rotation.x = (Math.PI / 2) * (1 - e);

        if (t >= 1) this._onCardLanded();
        break;
      }

      // ── MONSTER_SPAWNING ─────────────────────────────────────────────────
      case SlotState.MONSTER_SPAWNING: {
        const t = Math.min(this._elapsed / this.MONSTER_SPAWN_DURATION, 1);
        const scaleE   = easeOutElastic(t);
        const opacityE = Math.min(t / 0.6, 1);   // linear fade over full duration

        this.monsterGroup.scale.setScalar(Math.max(0, scaleE));
        this._setMonsterOpacity(opacityE);

        if (t >= 1) this._onSummonComplete();
        break;
      }
    }
  }

  // ── Private state transitions ──────────────────────────────────────────────

  _setState(newState) {
    this.state    = newState;
    this._elapsed = 0;
  }

  _onCardLanded() {
    this._setState(SlotState.CARD_LANDED);
    this._onImpact();

    // Immediately kick off monster spawn (no wait required).
    this._setState(SlotState.MONSTER_SPAWNING);
  }

  /**
   * Impact placeholder — wire up particles / screen-shake / squash-stretch here.
   */
  _onImpact() {
    console.log(`[FieldSlot] impact at slot ${this.slotIndex}`);
    // TODO: spawn impact particles at this.position
    // TODO: trigger camera shake (e.g. pass a shakeFn callback)
    // TODO: squash-and-stretch the card mesh briefly
  }

  _onSummonComplete() {
    // Card stays on the field beneath the monster.
    // Restore full opacity on all monster materials (transparent flag no longer needed).
    this._setMonsterOpacity(1, false);

    this._setState(SlotState.ACTIVE);

    // Notify arena.js to register the monster for idle/attack updates.
    if (this.onActive) this.onActive(this.monsterGroup);
  }

  // ── Material helpers ───────────────────────────────────────────────────────

  /**
   * Traverse the monster Group and set opacity on every mesh material.
   * @param {number}  opacity
   * @param {boolean} transparent - Whether to keep material in transparent mode.
   */
  _setMonsterOpacity(opacity, transparent = true) {
    if (!this.monsterGroup) return;
    // Build the material cache once on first call, skip traverse every subsequent frame.
    if (!this.monsterGroup.userData._opacityMats) {
      const mats = [];
      this.monsterGroup.traverse(child => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.userData._opacityCloned = true;
        mats.push(child.material);
      });
      this.monsterGroup.userData._opacityMats = mats;
    }
    const mats = this.monsterGroup.userData._opacityMats;
    for (let i = 0; i < mats.length; i++) {
      mats[i].transparent = transparent;
      mats[i].opacity     = opacity;
    }
  }
}
