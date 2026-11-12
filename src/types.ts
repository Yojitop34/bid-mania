export interface Player {
  id: number;
  name: string;
  role: 'Batsman' | 'Bowler' | 'Allrounder' | 'Wicketkeeper';
  type: 'Starting' | 'Auction';
  teamId: string | null;
  valuePoints: number;
  basePrice: number; // in M$
  soldCost: number | null; // in M$
  isSold: boolean;
  lotNumber: number | null;
  lotName: string | null;
  imageUrl: string;
}

export interface Team {
  id: string; // 'team_a', 'team_b', 'team_c', 'team_d'
  code: string; // 'Team A', etc.
  name: string; // custom name
  color: string;
  avatarBg: string;
  baseBudget: number; // 800
  adjustedBudget: number; // 800
  remainingBudget: number; // 800
  totalSpent: number; // 0
  totalValue: number; // 5000 initial
  isQualified: boolean;
  loginCode?: string; // custom login code (default TEAMA777, TEAMB777, etc.)
}

export interface BidHistoryItem {
  id: string;
  playerId: number;
  teamCode: string;
  amount: number;
  timestamp: string;
}

export interface ActiveAuction {
  playerId: number | null;
  biddingType?: 'online' | 'offline';
  currentBid: number | null;
  currentTeam: string | null;
  timerSeconds: number;
  timerDuration: number; // 30, 60, 90, 120
  timerRunning: boolean;
  status: 'idle' | 'bidding' | 'sold' | 'unsold';
  bidHistory: BidHistoryItem[];
  startedAt: string | null;
}

export interface DatabaseState {
  config: {
    gameCode: string;
    adminCode: string;
  };
  universalPurse?: number;
  teams: Team[];
  players: Player[];
  activeAuction: ActiveAuction;
  auditLogs: { id: string; action: string; timestamp: string; details: any }[];
}

export type TabType = 'welcome' | 'players' | 'instructions' | 'teams' | 'scoreboard';

export interface UserAuth {
  role: 'admin' | 'participant';
  gameCode?: string;
  selectedTeam?: string; // e.g. 'Team A', 'Team B', 'Team C', 'Team D'
}
