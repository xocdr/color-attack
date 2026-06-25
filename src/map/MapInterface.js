import * as THREE from 'three';
import { standardCleanup } from './MapUtils.js';

/**
 * MapInterface — abstract base class for all map packs.
 *
 * Concrete maps extend this class and override the methods marked "abstract".
 * Methods with default implementations (getSpawnPoints, getInteractableZones,
 * cleanup) work automatically as long as the subclass sets `this._config` and
 * `this._owned` before calling them.
 *
 * Lifecycle contract (all must be called in this order):
 *   init(scene, config)        — abstract; build lights, sky, ground, props.
 *   getSpawnPoints(role)       — default; returns Vector3[] from config.
 *   getInteractableZones()     — default; returns zones from config.
 *   getConfig()                — abstract; returns the validated MapConfig.
 *   cleanup()                  — default; disposes all tracked scene objects.
 *   tick(t, delta)             — optional no-op; per-frame env animation.
 *   getRaycastTargets(type)    — optional; returns Mesh[] for raycasting.
 */
export class MapInterface {

  // ── Abstract methods — subclasses MUST override these ─────────────────────

  /**
   * Build all scene objects for this map.
   * @param {THREE.Scene} _scene
   * @param {import('./MapConfig.js').MapConfig} _config
   */
  init(_scene, _config) {
    throw new Error(`[MapInterface] "${this.constructor.name}" must implement init(scene, config)`);
  }

  /**
   * Returns the validated MapConfig object for this map.
   * @returns {import('./MapConfig.js').MapConfig}
   */
  getConfig() {
    throw new Error(`[MapInterface] "${this.constructor.name}" must implement getConfig()`);
  }

  // ── Default implementations — subclasses may override if needed ────────────

  /**
   * Returns world-space spawn positions sourced from the map config.
   * Override only if custom logic is required.
   * @param {'player'|'enemy'} role
   * @returns {THREE.Vector3[]}
   */
  getSpawnPoints(role) {
    const cfg = this.getConfig();
    const toVec3 = p => new THREE.Vector3(p.x, p.y, p.z);
    if (role === 'player') return cfg.playerSpawns.map(toVec3);
    if (role === 'enemy')  return cfg.enemySpawns.map(toVec3);
    throw new Error(`[MapInterface] unknown spawn role "${role}" — use 'player' or 'enemy'`);
  }

  /**
   * Returns all interactable zones (deck, graveyard, player summon slots).
   * Sourced from the map config. Override only if custom zones are needed.
   * @returns {import('./MapConfig.js').InteractableZone[]}
   */
  getInteractableZones() {
    const cfg = this.getConfig();
    return [
      cfg.deckZone,
      cfg.graveyardZone,
      ...cfg.playerSpawns.map((p, i) => ({
        id:     `player-slot-${i}`,
        center: { x: p.x, y: p.y, z: p.z },
        radius: 1.2,
        type:   'summon',
      })),
    ];
  }

  /**
   * Removes and disposes every object added to the scene during init().
   * Requires the subclass to track objects in `this._owned` (Array) and set
   * `this._scene` during init(). Sets `this._scene` to null after cleanup.
   */
  cleanup() {
    if (!this._scene) return;
    standardCleanup(this._scene, this._owned);
    this._scene = null;
  }

  // ── Optional hooks — override to add functionality ─────────────────────────

  /**
   * Per-frame environmental animation (torch flicker, particles, fog…).
   * Default is a no-op so maps without animation don't need to override.
   * @param {number} _t     Total elapsed time in seconds.
   * @param {number} _delta Frame delta in seconds.
   */
  tick(_t, _delta) { /* no-op default */ }

  /**
   * Returns meshes suitable for THREE.Raycaster.intersectObjects().
   * @param {'deck'|'graveyard'|string} _type
   * @returns {THREE.Mesh[]}
   */
  getRaycastTargets(_type) { return []; }
}
