export class TurnManager {
  constructor() {
    this.state = 'PLAYER_TURN';
    this.turnNumber = 1;
    this.onTurnChange = null;
  }

  endPlayerTurn(enemyAI) {
    if (this.state !== 'PLAYER_TURN') return;
    this.state = 'ENEMY_TURN_START';
    this.onTurnChange?.(this.state);
    setTimeout(() => {
      this.state = 'ENEMY_TURN';
      this.onTurnChange?.(this.state);
      enemyAI.executeTurn(this.turnNumber, () => {
        this.turnNumber++;
        this.state = 'PLAYER_TURN';
        this.onTurnChange?.(this.state);
      });
    }, 500);
  }
}
