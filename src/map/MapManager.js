import * as THREE from 'three';

/**
 * MapManager — core engine handler for the map system.
 *
 * Responsibilities:
 *   - Maintain a registry of named MapInterface instances.
 *   - Load/unload maps cleanly (init → active → cleanup on swap).
 *   - Expose a unified API so arena.js never imports a concrete map class.
 *
 * Usage:
 *   mapManager.register('sand-arena', new SandArenaMap());
 *   mapManager.load('sand-arena', scene, renderer);
 *   const playerSlots = mapManager.getSpawnPoints('player');
 *   // each frame:
 *   mapManager.tick(t, delta);
 */
class MapManager {
  constructor() {
    /** @type {Map<string, import('./MapInterface.js').MapInterface>} */
    this._registry = new Map();
    /** @type {import('./MapInterface.js').MapInterface|null} */
    this._activeMap = null;
    this._activeMapId = null;
  }

  // ── Registry ──────────────────────────────────────────────────────────────────

  /**
   * Register a map pack under a unique identifier.
   * @param {string} mapId
   * @param {import('./MapInterface.js').MapInterface} mapInstance
   */
  register(mapId, mapInstance) {
    if (this._registry.has(mapId)) {
      console.warn(`[MapManager] overwriting existing map registration: "${mapId}"`);
    }
    this._registry.set(mapId, mapInstance);
  }

  // ── Load / Unload ─────────────────────────────────────────────────────────────

  /**
   * Load a map: cleanup the currently active map (if any), then init the new one.
   * @param {string}            mapId
   * @param {THREE.Scene}       scene
   * @param {THREE.WebGLRenderer} renderer  - Used to apply the map's clearColor.
   */
  load(mapId, scene, renderer) {
    if (!this._registry.has(mapId)) {
      throw new Error(`[MapManager] no map registered with id "${mapId}". Did you call register() first?`);
    }

    // Teardown current map cleanly before init'ing the next.
    if (this._activeMap) {
      this._activeMap.cleanup();
      this._activeMap = null;
      this._activeMapId = null;
    }

    const map = this._registry.get(mapId);
    const cfg = map.getConfig();

    // Apply map-level renderer settings before init so the background is correct.
    if (renderer && cfg.clearColor !== undefined) {
      renderer.setClearColor(cfg.clearColor);
    }

    map.init(scene, cfg);

    this._activeMap   = map;
    this._activeMapId = mapId;

    console.log(`[MapManager] loaded map: "${mapId}" (${cfg.displayName})`);
  }

  /**
   * Unload the currently active map, cleaning up all its scene objects.
   */
  unload() {
    if (!this._activeMap) return;
    this._activeMap.cleanup();
    this._activeMap   = null;
    this._activeMapId = null;
    console.log('[MapManager] active map unloaded');
  }

  // ── Spatial Queries ───────────────────────────────────────────────────────────

  /**
   * @param {'player'|'enemy'} role
   * @returns {THREE.Vector3[]}
   */
  getSpawnPoints(role) {
    this._assertActive();
    return this._activeMap.getSpawnPoints(role);
  }

  /**
   * @returns {import('./MapConfig.js').InteractableZone[]}
   */
  getInteractableZones() {
    this._assertActive();
    return this._activeMap.getInteractableZones();
  }

  /**
   * Convenience lookup by zone id.
   * @param {string} id
   * @returns {import('./MapConfig.js').InteractableZone|null}
   */
  getZoneById(id) {
    this._assertActive();
    return this._activeMap.getInteractableZones().find(z => z.id === id) ?? null;
  }

  // ── Raycasting ────────────────────────────────────────────────────────────────

  /**
   * Returns mesh targets for THREE.Raycaster.intersectObjects().
   * @param {'deck'|'graveyard'|string} type
   * @returns {THREE.Mesh[]}
   */
  getRaycastTargets(type) {
    this._assertActive();
    return this._activeMap.getRaycastTargets(type);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────────

  /**
   * Drive environmental animation for the active map.
   * Call once per frame from the main render loop.
   * @param {number} t     Total elapsed time (seconds).
   * @param {number} delta Frame delta (seconds).
   */
  tick(t, delta) {
    if (this._activeMap) this._activeMap.tick(t, delta);
  }

  // ── Introspection ─────────────────────────────────────────────────────────────

  getCurrentMapId() { return this._activeMapId; }

  getConfig() {
    this._assertActive();
    return this._activeMap.getConfig();
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  _assertActive() {
    if (!this._activeMap) {
      throw new Error('[MapManager] no map is currently loaded. Call load() first.');
    }
  }
}

// Singleton export — import { mapManager } everywhere.
export const mapManager = new MapManager();
