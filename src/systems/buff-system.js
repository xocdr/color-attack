export const BUFF_DEFS = {
  atk_up:    { id: 'atk_up',    name: 'Attack Up',    icon: '🗡️', kind: 'buff',   description: '+{value} ATK', maxStacks: 5 },
  atk_down:  { id: 'atk_down',  name: 'Weakened',     icon: '💢', kind: 'debuff', description: '-{value} ATK', maxStacks: 5 },
  shield:    { id: 'shield',    name: 'Shield',       icon: '🛡️', kind: 'buff',   description: 'Blocks next {value} dmg instances', maxStacks: 3 },
  burn:      { id: 'burn',      name: 'Burn',         icon: '🔥', kind: 'debuff', description: '{value} dmg per turn', maxStacks: 5 },
  stun:      { id: 'stun',      name: 'Stunned',      icon: '💫', kind: 'debuff', description: 'Skips next attack', maxStacks: 1 },
};

export function applyBuff(monster, buffId, opts = {}) {
  const { duration = 1, value = 0, stacks = 1 } = opts;
  const def = BUFF_DEFS[buffId];
  if (!def) return;
  if (!monster.userData.buffs) monster.userData.buffs = [];
  const existing = monster.userData.buffs.find(b => b.id === buffId);
  if (existing) {
    existing.stacks = Math.min(existing.stacks + stacks, def.maxStacks);
    existing.duration = Math.max(existing.duration, duration);
    existing.value = value;
  } else {
    monster.userData.buffs.push({ id: buffId, duration, value, stacks: Math.min(stacks, def.maxStacks) });
  }
}

export function removeBuff(monster, buffId) {
  if (!monster.userData.buffs) return;
  monster.userData.buffs = monster.userData.buffs.filter(b => b.id !== buffId);
}

export function tickBuffs(monster) {
  if (!monster.userData.buffs) return [];
  const expired = [];
  monster.userData.buffs = monster.userData.buffs.filter(b => {
    b.duration--;
    if (b.duration <= 0) {
      expired.push(b.id);
      return false;
    }
    return true;
  });
  return expired;
}

export function getBuffs(monster) {
  return monster.userData.buffs ?? [];
}

export function getAtkModifier(monster) {
  return getBuffs(monster).reduce((sum, b) => {
    if (b.id === 'atk_up')   return sum + b.value * b.stacks;
    if (b.id === 'atk_down') return sum - b.value * b.stacks;
    return sum;
  }, 0);
}

export function isStunned(monster) {
  return getBuffs(monster).some(b => b.id === 'stun');
}

export function consumeStun(monster) {
  if (!isStunned(monster)) return false;
  removeBuff(monster, 'stun');
  return true;
}

export function absorbWithShield(monster) {
  const shield = getBuffs(monster).find(b => b.id === 'shield');
  if (!shield) return false;
  shield.stacks--;
  if (shield.stacks <= 0) removeBuff(monster, 'shield');
  return true;
}
