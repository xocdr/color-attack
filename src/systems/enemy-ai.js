import * as THREE from 'three';
import { DRAKE_STATS, makeFireDrake, collectDrakeParts, animateDrakeIdle, animateDrakeAttack } from '../monsters/fire-drake.js';
import { IMP_STATS,   makeBladeImp,  collectImpParts,   animateImpIdle,   animateImpAttack   } from '../monsters/blade-imp.js';
import { TIDE_STATS,  makeTideLord,  collectTideParts,  animateTideIdle,  animateTideAttack  } from '../monsters/tide-lord.js';
import { SPORE_STATS, makeSporeKin,  collectSporeParts, animateSporeIdle, animateSporeAttack } from '../monsters/spore-kin.js';
import { BONE_STATS,  makeBoneGiant, collectBoneParts,  animateBoneIdle,  animateBoneAttack  } from '../monsters/bone-giant.js';
import { startAttack } from './attack-system.js';
import { getAtkModifier, consumeStun, absorbWithShield } from './buff-system.js';

export let AI_DIFFICULTY = 1;

const DIFFICULTY_MAX_SUMMONS    = [1,   3,   5  ];
const DIFFICULTY_NOISE_RANGE    = [0.5, 0.12, 0.0];
const DIFFICULTY_HOLD_THRESHOLD = [99,  0,   -2 ];
const DIFFICULTY_ADAPTIVE       = [false, false, true];

const MONSTER_POOL = [
  { stats: IMP_STATS,   make: makeBladeImp,  collect: collectImpParts,   idle: animateImpIdle,   attack: animateImpAttack   },
  { stats: SPORE_STATS, make: makeSporeKin,  collect: collectSporeParts, idle: animateSporeIdle, attack: animateSporeAttack },
  { stats: DRAKE_STATS, make: makeFireDrake, collect: collectDrakeParts, idle: animateDrakeIdle, attack: animateDrakeAttack },
  { stats: TIDE_STATS,  make: makeTideLord,  collect: collectTideParts,  idle: animateTideIdle,  attack: animateTideAttack  },
  { stats: BONE_STATS,  make: makeBoneGiant, collect: collectBoneParts,  idle: animateBoneIdle,  attack: animateBoneAttack  },
];

export const ENEMY_FIELD_POSITIONS = [
  new THREE.Vector3(-5, 0, -4),
  new THREE.Vector3(-2, 0, -4),
  new THREE.Vector3( 1, 0, -4),
  new THREE.Vector3( 4, 0, -4),
  new THREE.Vector3( 7, 0, -4),
];

export class EnemyAI {
  constructor() {
    this.scene = null;
    this.activeMonsters = null;
    this.playerField = null;
    this.enemyMeshes = null;
    this.registryFor = null;
    this.destroyMonster = null;
    this.getPlayerHP = null;
    this.setPlayerHP = null;
    this.getEnemyHP  = null;
    this.setEnemyHP  = null;
    this.onGameOver  = null;

    this.enemyField = [null, null, null, null, null];
    this.enemyMana    = 3;
    this.enemyMaxMana = 3;
    this.FIELD_POSITIONS = [];
    this._aiMode = 'balanced';
  }

  init(ctx) {
    this.scene          = ctx.scene;
    this.activeMonsters = ctx.activeMonsters;
    this.playerField    = ctx.playerField;
    this.enemyMeshes    = ctx.enemyMeshes;
    this.registryFor    = ctx.registryFor;
    this.destroyMonster = ctx.destroyMonster;
    this.getPlayerHP    = ctx.getPlayerHP;
    this.setPlayerHP    = ctx.setPlayerHP;
    this.getEnemyHP     = ctx.getEnemyHP;
    this.setEnemyHP     = ctx.setEnemyHP;
    this.onGameOver     = ctx.onGameOver;
    this.FIELD_POSITIONS = ctx.enemyFieldPositions;
  }

  _startTurnResources(turnNumber) {
    this.enemyMaxMana = Math.min(10, 2 + turnNumber);
    this.enemyMana    = this.enemyMaxMana;
  }

  _clearSummoningSickness() {
    for (const slot of this.enemyField) {
      if (slot) slot.summoningSickness = false;
    }
  }

  _makeSnap(turnNumber) {
    const pf = this.playerField.filter(Boolean);
    const ef = this.enemyField.filter(Boolean);
    return {
      playerCount:    pf.length,
      enemyCount:     ef.length,
      playerTotalAtk: pf.reduce((s, m) => s + m.stats.atk, 0),
      enemyTotalAtk:  ef.reduce((s, m) => s + m.stats.atk, 0),
      playerTotalHp:  pf.reduce((s, m) => s + m.hp,        0),
      enemyTotalHp:   ef.reduce((s, m) => s + m.hp,        0),
      playerHP:       this.getPlayerHP(),
      enemyHP:        this.getEnemyHP(),
      turnNumber,
      enemyManaUsed:  this.enemyMaxMana - this.enemyMana,
    };
  }

  _computeAiMode(snap) {
    this._aiMode = 'balanced';
    if (!DIFFICULTY_ADAPTIVE[AI_DIFFICULTY]) return;
    if (snap.enemyHP < 8)                              this._aiMode = 'defensive';
    if (snap.playerHP < 8)                             this._aiMode = 'aggro';
    if (snap.enemyCount >= 3 && snap.turnNumber > 5)   this._aiMode = 'control';
  }

  _scoreSummon(stats) {
    const freeSlots = this.enemyField.filter(s => s === null).length;
    let score = 0;
    score += stats.atk * 1.5;
    score += stats.hp  * 0.8;
    score -= stats.cost * 0.3;
    score += (freeSlots < 2 ? -5 : 0);
    if (this._aiMode === 'defensive') score += stats.hp  * 1.2;
    if (this._aiMode === 'aggro')     score += stats.atk * 1.5;
    const noise = DIFFICULTY_NOISE_RANGE[AI_DIFFICULTY];
    if (noise > 0) score *= (1 - noise + Math.random() * noise * 2);
    return score;
  }

  _scoreAttack(attackerStats, target, targetIsHero) {
    let score = 0;
    if (targetIsHero) {
      const kills = this.getPlayerHP() <= attackerStats.atk;
      score += kills ? 50 : 2;
      if (this._aiMode === 'defensive') score += -10;
      if (this._aiMode === 'aggro')     score += 5;
    } else {
      const kills    = target.hp <= attackerStats.atk;
      const survives = attackerStats.hp > target.stats.atk;
      score += kills    ? target.stats.atk * 2.0 : 0;
      score += survives ? 2.5 : -2.0;
      score += target.stats.atk * 0.5;
    }
    return score;
  }

  _chooseBestAttackAction(attackerSlotIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    if (!attacker) return null;

    let best = null;
    let bestScore = DIFFICULTY_HOLD_THRESHOLD[AI_DIFFICULTY];

    const heroScore = this._scoreAttack(attacker.stats, null, true);
    if (heroScore > bestScore) { bestScore = heroScore; best = { targetIsHero: true }; }

    for (let i = 0; i < this.playerField.length; i++) {
      const target = this.playerField[i];
      if (!target) continue;
      const s = this._scoreAttack(attacker.stats, target, false);
      if (s > bestScore) { bestScore = s; best = { targetIsHero: false, targetIdx: i }; }
    }

    return best;
  }

  _spawnEnemyMonster(monsterDef, slotIdx) {
    const mesh  = monsterDef.make();
    const parts = monsterDef.collect(mesh);
    mesh.userData.monsterName = monsterDef.stats.name;
    mesh.userData.isEnemy     = true;
    mesh.userData.hp          = monsterDef.stats.hp;
    mesh.userData.maxHp       = monsterDef.stats.hp;
    mesh.userData.atk         = monsterDef.stats.atk;
    mesh.userData.registry    = { idle: monsterDef.idle, attack: monsterDef.attack, stats: monsterDef.stats };
    mesh.position.copy(this.FIELD_POSITIONS[slotIdx]);
    mesh.scale.set(0, 0, 0);
    mesh.rotation.y = Math.PI;
    this.scene.add(mesh);
    this.enemyMeshes.push(mesh);

    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / 400);
      const s = p * p * (3 - 2 * p);
      mesh.scale.setScalar(s);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    this.enemyField[slotIdx] = {
      mesh,
      stats: monsterDef.stats,
      hp:    monsterDef.stats.hp,
      hasAttacked:      false,
      summoningSickness: true,
      parts,
    };
  }

  _attackPlayerMonster(attackerSlotIdx, targetIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    const target   = this.playerField[targetIdx];
    if (!attacker || !target) return;
    attacker.hasAttacked = true;

    const onHit = () => {
      const atkDmg = attacker.stats.atk + getAtkModifier(attacker.mesh);
      const defDmg = target.stats.atk   + getAtkModifier(target.mesh);

      if (!absorbWithShield(target.mesh)) {
        target.hp -= atkDmg;
        target.mesh.userData.hp = target.hp;
      }
      if (!absorbWithShield(attacker.mesh)) {
        attacker.hp -= defDmg;
        attacker.mesh.userData.hp = attacker.hp;
      }

      if (target.hp <= 0) {
        this.destroyMonster(target.mesh);
        this.playerField[targetIdx] = null;
      }
      if (attacker.hp <= 0) {
        this.destroyMonster(attacker.mesh);
        this.enemyField[attackerSlotIdx] = null;
      }
    };

    startAttack(attacker.mesh, target.mesh, onHit);
  }

  _attackPlayerHero(attackerSlotIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    if (!attacker) return;
    attacker.hasAttacked = true;
    const dmg = attacker.stats.atk + getAtkModifier(attacker.mesh);
    const newHP = this.getPlayerHP() - dmg;
    this.setPlayerHP(newHP);
    if (newHP <= 0) this.onGameOver('enemy');
  }

  executeTurn(turnNumber, onComplete) {
    let delay = 0;

    this._startTurnResources(turnNumber);
    this._clearSummoningSickness();

    const snap = this._makeSnap(turnNumber);
    this._computeAiMode(snap);

    const readyAttackers = this.enemyField.filter(
      e => e && !e.summoningSickness && !e.hasAttacked
    );
    const totalAtk = readyAttackers.reduce((s, e) => s + e.stats.atk, 0);
    const goingForLethal = totalAtk >= this.getPlayerHP();

    const freeSlots = this.enemyField
      .map((v, i) => (v === null ? i : -1))
      .filter(i => i >= 0);
    let summonsLeft = DIFFICULTY_MAX_SUMMONS[AI_DIFFICULTY];

    for (let si = 0; si < freeSlots.length && summonsLeft > 0; si++) {
      const slotIdx    = freeSlots[si];
      const affordable = MONSTER_POOL.filter(m => m.stats.cost <= this.enemyMana);
      if (!affordable.length) break;

      const scored = affordable.map(m => ({ m, score: this._scoreSummon(m.stats) }));
      scored.sort((a, b) => b.score - a.score);
      const pick = scored[0].m;

      this.enemyMana -= pick.stats.cost;
      summonsLeft--;

      const capturedSlot = slotIdx;
      const capturedPick = pick;
      setTimeout(() => this._spawnEnemyMonster(capturedPick, capturedSlot), delay);
      delay += 700;
    }

    for (let i = 0; i < 5; i++) {
      const slot = this.enemyField[i];
      if (!slot || slot.summoningSickness || slot.hasAttacked) continue;

      const capturedIdx = i;
      setTimeout(() => {
        const current = this.enemyField[capturedIdx];
        if (!current || current.hasAttacked) return;
        if (consumeStun(current.mesh)) { current.hasAttacked = true; return; }
        if (goingForLethal) {
          this._attackPlayerHero(capturedIdx);
          return;
        }
        const action = this._chooseBestAttackAction(capturedIdx);
        if (!action) return;
        if (action.targetIsHero) {
          this._attackPlayerHero(capturedIdx);
        } else {
          this._attackPlayerMonster(capturedIdx, action.targetIdx);
        }
      }, delay);
      delay += 950;
    }

    setTimeout(() => onComplete(), delay + 400);
  }
}
