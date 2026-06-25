/**
 * @typedef {Object} LightingProfile
 * @property {number} ambientColor
 * @property {number} ambientIntensity
 * @property {number} sunColor
 * @property {number} sunIntensity
 * @property {{x:number,y:number,z:number}} sunPosition
 * @property {number} fillColor
 * @property {number} fillIntensity
 * @property {{x:number,y:number,z:number}} fillPosition
 * @property {number} skyColor
 * @property {number} skyIntensity
 */

/**
 * @typedef {Object} BoundaryLimits
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {number} groundY
 */

/**
 * @typedef {Object} SpawnPoint
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} InteractableZone
 * @property {string} id
 * @property {{x:number,y:number,z:number}} center
 * @property {number} radius
 * @property {'deck'|'graveyard'|'summon'|'trigger'} type
 */

/**
 * @typedef {Object} MapConfig
 * @property {string}   mapId
 * @property {string}   displayName
 * @property {number}   clearColor              - Hex colour for renderer background.
 * @property {BoundaryLimits} boundary
 * @property {SpawnPoint[]}   playerSpawns       - Exactly 5 player field positions.
 * @property {SpawnPoint[]}   enemySpawns        - Exactly 5 enemy field positions.
 * @property {InteractableZone} deckZone
 * @property {InteractableZone} graveyardZone
 * @property {InteractableZone[]} interactableZones
 * @property {LightingProfile}  lighting
 * @property {number[][]}  torchPositions
 * @property {number[][]}  pillarCorners
 * @property {number[]}    pillarTilts
 * @property {number}      dustCount
 * @property {{x:number,y:{min:number,max:number},z:number}} dustBounds
 * @property {'golden-hour'|'dark-fantasy'|'elemental'|'void'} environmentTone
 * @property {string|null} ambientSoundPath
 */

const REQUIRED_KEYS = [
  'mapId', 'displayName', 'clearColor', 'boundary',
  'playerSpawns', 'enemySpawns', 'deckZone', 'graveyardZone',
  'lighting', 'environmentTone',
];

/**
 * Validates the structure of an InteractableZone object.
 * @param {unknown} zone
 * @param {string}  fieldName
 * @param {string}  mapId
 */
function validateZone(zone, fieldName, mapId) {
  if (!zone || typeof zone !== 'object') {
    throw new Error(`[MapConfig] "${mapId}" ${fieldName} must be an object`);
  }
  for (const k of ['id', 'center', 'radius', 'type']) {
    if (zone[k] === undefined || zone[k] === null) {
      throw new Error(`[MapConfig] "${mapId}" ${fieldName} is missing required field "${k}"`);
    }
  }
  const c = zone.center;
  if (typeof c !== 'object' || typeof c.x !== 'number' || typeof c.y !== 'number' || typeof c.z !== 'number') {
    throw new Error(`[MapConfig] "${mapId}" ${fieldName}.center must have numeric x, y, z`);
  }
  if (typeof zone.radius !== 'number') {
    throw new Error(`[MapConfig] "${mapId}" ${fieldName}.radius must be a number`);
  }
}

/**
 * Validates a MapConfig object at runtime.
 * Throws a descriptive Error for any missing or malformed field.
 * Returns an immutable (Object.freeze) reference to the same config.
 * @param {MapConfig} cfg
 * @returns {Readonly<MapConfig>}
 */
export function validateMapConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('[MapConfig] config must be a plain object');
  }

  for (const key of REQUIRED_KEYS) {
    if (cfg[key] === undefined || cfg[key] === null) {
      throw new Error(`[MapConfig] "${cfg.mapId || '?'}" is missing required field: "${key}"`);
    }
  }

  if (!Array.isArray(cfg.playerSpawns) || cfg.playerSpawns.length !== 5) {
    throw new Error(`[MapConfig] "${cfg.mapId}" playerSpawns must be an array of exactly 5 points`);
  }
  if (!Array.isArray(cfg.enemySpawns) || cfg.enemySpawns.length !== 5) {
    throw new Error(`[MapConfig] "${cfg.mapId}" enemySpawns must be an array of exactly 5 points`);
  }

  validateZone(cfg.deckZone,      'deckZone',      cfg.mapId);
  validateZone(cfg.graveyardZone, 'graveyardZone', cfg.mapId);

  // Shallow freeze prevents accidental field reassignment after init.
  return Object.freeze(cfg);
}
