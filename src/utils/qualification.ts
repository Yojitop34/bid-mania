import { Player } from '../types';

export function calculateQualification(teamId: string, players: Player[]) {
  const teamPlayers = players.filter((p) => p.teamId === teamId);
  const batsmen = teamPlayers.filter((p) => p.role === 'Batsman').length;
  const bowlers = teamPlayers.filter((p) => p.role === 'Bowler').length;
  const allrounders = teamPlayers.filter((p) => p.role === 'Allrounder').length;
  const wicketkeepers = teamPlayers.filter((p) => p.role === 'Wicketkeeper').length;
  const total = teamPlayers.length;

  const isQualified =
    total >= 8 &&
    batsmen >= 3 &&
    bowlers >= 2 &&
    allrounders >= 1 &&
    wicketkeepers >= 1;

  return {
    total,
    batsmen,
    bowlers,
    allrounders,
    wicketkeepers,
    isQualified,
    missing: {
      batsmen: Math.max(0, 3 - batsmen),
      bowlers: Math.max(0, 2 - bowlers),
      allrounders: Math.max(0, 1 - allrounders),
      wicketkeepers: Math.max(0, 1 - wicketkeepers),
      totalOverall: Math.max(0, 8 - total),
    },
  };
}
