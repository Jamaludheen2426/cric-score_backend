export function ballsPerOver(match: { balls_per_over?: number | null }) {
  const value = Number(match.balls_per_over || 6);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

export function ballsToOversFloat(totalBalls: number, perOver: number) {
  return Math.floor(totalBalls / perOver) + (totalBalls % perOver) / 10;
}

export function overProgressToBalls(overNumber: number, legalBalls: number, perOver: number) {
  return (Number(overNumber) - 1) * perOver + Number(legalBalls || 0);
}
