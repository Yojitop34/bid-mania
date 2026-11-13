import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data Types
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
  loginCode?: string; // custom login code (e.g. TEAMA777)
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

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'auction_database.json');

// Constant Fixed Starting Teams and Players as specified
function getInitialTeams(): Team[] {
  return [
    {
      id: 'team_a',
      code: 'Team A',
      name: '',
      loginCode: 'TEAMA777',
      color: '#ef4444',
      avatarBg: 'bg-red-500',
      baseBudget: 800,
      adjustedBudget: 800,
      remainingBudget: 800,
      totalSpent: 0,
      totalValue: 5000,
      isQualified: false,
    },
    {
      id: 'team_b',
      code: 'Team B',
      name: '',
      loginCode: 'TEAMB777',
      color: '#3b82f6',
      avatarBg: 'bg-blue-500',
      baseBudget: 800,
      adjustedBudget: 800,
      remainingBudget: 800,
      totalSpent: 0,
      totalValue: 5000,
      isQualified: false,
    },
    {
      id: 'team_c',
      code: 'Team C',
      name: '',
      loginCode: 'TEAMC777',
      color: '#22c55e',
      avatarBg: 'bg-green-500',
      baseBudget: 800,
      adjustedBudget: 800,
      remainingBudget: 800,
      totalSpent: 0,
      totalValue: 5000,
      isQualified: false,
    },
    {
      id: 'team_d',
      code: 'Team D',
      name: '',
      loginCode: 'TEAMD777',
      color: '#eab308',
      avatarBg: 'bg-yellow-500',
      baseBudget: 800,
      adjustedBudget: 800,
      remainingBudget: 800,
      totalSpent: 0,
      totalValue: 5000,
      isQualified: false,
    },
  ];
}

// Local player photos live in  public/players/  and are served at  /players/<file>.
// Root-relative paths work on localhost AND on any domain (no hard-coded host).
// To change a photo: drop the new file in public/players/ and edit the filename in that player's playerImg('...') call.
const PLAYER_IMG_DIR = '/players';
const playerImg = (file: string) => `${PLAYER_IMG_DIR}/${file}`;

function getInitialPlayers(): Player[] {
  return [
    // --- TEAM A STARTING PLAYERS (Total: 5,000 pts) ---
    {
      id: 101,
      name: 'S. Iyer',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_a',
      valuePoints: 1200,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 102,
      name: 'K. Williamson',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_a',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 103,
      name: 'D. Steyn',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_a',
      valuePoints: 1200,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 104,
      name: 'R. Ashwin',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_a',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 105,
      name: 'D. Karthik',
      role: 'Wicketkeeper',
      type: 'Starting',
      teamId: 'team_a',
      valuePoints: 1000,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&auto=format&fit=crop&q=80',
    },

    // --- TEAM B STARTING PLAYERS (Total: 5,000 pts) ---
    {
      id: 106,
      name: 'K. Pollard',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_b',
      valuePoints: 1500,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 107,
      name: 'A. Rayudu',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_b',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 108,
      name: 'M. Pandey',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_b',
      valuePoints: 700,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 109,
      name: 'Y. Chahal',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_b',
      valuePoints: 1200,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 110,
      name: 'M. Shami',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_b',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&auto=format&fit=crop&q=80',
    },

    // --- TEAM C STARTING PLAYERS (Total: 5,000 pts) ---
    {
      id: 111,
      name: 'M. Agarwal',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_c',
      valuePoints: 1200,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 112,
      name: 'S. Dhawan',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_c',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 113,
      name: 'I. Sharma',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_c',
      valuePoints: 1000,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 114,
      name: 'K. Yadav',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_c',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 115,
      name: 'S. Curran',
      role: 'Allrounder',
      type: 'Starting',
      teamId: 'team_c',
      valuePoints: 1200,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    },

    // --- TEAM D STARTING PLAYERS (Total: 5,000 pts) ---
    {
      id: 116,
      name: 'E. Morgan',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_d',
      valuePoints: 1000,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 117,
      name: 'B. Kumar',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_d',
      valuePoints: 2000,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 118,
      name: 'C. Gayle',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_d',
      valuePoints: 800,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 119,
      name: 'A. Rahane',
      role: 'Batsman',
      type: 'Starting',
      teamId: 'team_d',
      valuePoints: 600,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80',
    },
    {
      id: 120,
      name: 'P. Chawla',
      role: 'Bowler',
      type: 'Starting',
      teamId: 'team_d',
      valuePoints: 600,
      basePrice: 0,
      soldCost: 0,
      isSold: true,
      lotNumber: null,
      lotName: null,
      imageUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=400&auto=format&fit=crop&q=80',
    },
    // --- AUCTION PLAYERS (12 players in 3 lots of 4 players, starting from #1 up to #12) ---
    // LOT 1: Premium Players
    {
      id: 1,
      name: 'Hardik Pandya',
      role: 'Allrounder',
      type: 'Auction',
      teamId: null,
      valuePoints: 4000,
      basePrice: 80,
      soldCost: null,
      isSold: false,
      lotNumber: 1,
      lotName: 'Premium Players',
      imageUrl: playerImg('h-pandya.webp'),
    },
    {
      id: 2,
      name: 'Arshdeep Singh',
      role: 'Bowler',
      type: 'Auction',
      teamId: null,
      valuePoints: 3600,
      basePrice: 70,
      soldCost: null,
      isSold: false,
      lotNumber: 1,
      lotName: 'Premium Players',
      imageUrl: playerImg('arshdeep-singh.webp'),
    },
    {
      id: 3,
      name: 'K. L. Rahul',
      role: 'Wicketkeeper',
      type: 'Auction',
      teamId: null,
      valuePoints: 3000,
      basePrice: 60,
      soldCost: null,
      isSold: false,
      lotNumber: 1,
      lotName: 'Premium Players',
      imageUrl: playerImg('k-rahul.webp'),
    },
    {
      id: 4,
      name: 'Axar Patel',
      role: 'Allrounder',
      type: 'Auction',
      teamId: null,
      valuePoints: 1000,
      basePrice: 30,
      soldCost: null,
      isSold: false,
      lotNumber: 1,
      lotName: 'Premium Players',
      imageUrl: playerImg('axar-patel.webp'),
    },

    // LOT 2: Star Players
    {
      id: 5,
      name: 'Jasprit Bumrah',
      role: 'Bowler',
      type: 'Auction',
      teamId: null,
      valuePoints: 4000,
      basePrice: 80,
      soldCost: null,
      isSold: false,
      lotNumber: 2,
      lotName: 'Star Players',
      imageUrl: playerImg('j-bumrah.webp'),
    },
    {
      id: 6,
      name: 'Shubman Gill',
      role: 'Batsman',
      type: 'Auction',
      teamId: null,
      valuePoints: 3500,
      basePrice: 70,
      soldCost: null,
      isSold: false,
      lotNumber: 2,
      lotName: 'Star Players',
      imageUrl: playerImg('shubman-gill.webp'),
    },
    {
      id: 7,
      name: 'Rishabh Pant',
      role: 'Wicketkeeper',
      type: 'Auction',
      teamId: null,
      valuePoints: 4000,
      basePrice: 90,
      soldCost: null,
      isSold: false,
      lotNumber: 2,
      lotName: 'Star Players',
      imageUrl: playerImg('rishabh-pant.webp'),
    },
    {
      id: 8,
      name: 'Glenn Maxwell',
      role: 'Allrounder',
      type: 'Auction',
      teamId: null,
      valuePoints: 3000,
      basePrice: 70,
      soldCost: null,
      isSold: false,
      lotNumber: 2,
      lotName: 'Star Players',
      imageUrl: playerImg('glenn-maxwell.webp'),
    },

    // LOT 3: Elite Players
    {
      id: 9,
      name: 'Virat Kohli',
      role: 'Batsman',
      type: 'Auction',
      teamId: null,
      valuePoints: 4500,
      basePrice: 90,
      soldCost: null,
      isSold: false,
      lotNumber: 3,
      lotName: 'Elite Players',
      imageUrl: playerImg('v-kohli.webp'),
    },
    {
      id: 10,
      name: 'Ben Stokes',
      role: 'Allrounder',
      type: 'Auction',
      teamId: null,
      valuePoints: 3500,
      basePrice: 75,
      soldCost: null,
      isSold: false,
      lotNumber: 3,
      lotName: 'Elite Players',
      imageUrl: playerImg('b-stokes.webp'),
    },
    {
      id: 11,
      name: 'Abhishek Sharma',
      role: 'Batsman',
      type: 'Auction',
      teamId: null,
      valuePoints: 3200,
      basePrice: 60,
      soldCost: null,
      isSold: false,
      lotNumber: 3,
      lotName: 'Elite Players',
      imageUrl: playerImg('abhishek-sharma.webp'),
    },
    {
      id: 12,
      name: 'Travis Head',
      role: 'Batsman',
      type: 'Auction',
      teamId: null,
      valuePoints: 3800,
      basePrice: 80,
      soldCost: null,
      isSold: false,
      lotNumber: 3,
      lotName: 'Elite Players',
      imageUrl: playerImg('travis-head.webp'),
    },
  ];
}

// Check team qualification logic:
// - Total players >= 8
// - Batsman >= 3
// - Bowler >= 2
// - Allrounder >= 1
// - Wicketkeeper >= 1
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

// Database Layer with File Persistence & Auto-Migrations
class AuctionDatabase {
  private state: DatabaseState;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.state = JSON.parse(raw);
        // Ensure static game codes are permanent
        this.state.config.gameCode = 'APL2026';
        this.state.config.adminCode = 'ADMIN777';
        // Ensure teams have loginCode initialized
        const defaultCodes: Record<string, string> = {
          team_a: 'TEAMA777',
          team_b: 'TEAMB777',
          team_c: 'TEAMC777',
          team_d: 'TEAMD777',
        };
        for (const team of this.state.teams) {
          if (!team.loginCode) {
            team.loginCode = defaultCodes[team.id] || `${team.code.replace(/\s+/g, '').toUpperCase()}777`;
          }
          if (team.adjustedBudget === undefined) {
            team.adjustedBudget = team.baseBudget;
          }
        }
        if (!this.state.activeAuction.biddingType) {
          this.state.activeAuction.biddingType = 'online';
        }
        if (this.state.universalPurse === undefined) {
          this.state.universalPurse = 800;
        }
      } catch (e) {
        console.error('Error loading db file, re-initializing', e);
        this.state = this.createDefaultState();
        this.save();
      }
    } else {
      this.state = this.createDefaultState();
      this.save();
    }

    this.syncImageUrls();
    this.recalculateAllTeams();
  }

  // Keeps imageUrl AND name in an already-saved database in sync with the seed above,
  // so editing a photo path or a player name in getInitialPlayers() takes effect on restart without a DB reset.
  private syncImageUrls() {
    const seed = new Map(getInitialPlayers().map((p) => [p.id, p]));
    for (const p of this.state.players) {
      const s = seed.get(p.id);
      if (!s) continue;
      if (p.imageUrl !== s.imageUrl) p.imageUrl = s.imageUrl;
      if (p.name !== s.name) p.name = s.name;
    }
  }

  private createDefaultState(): DatabaseState {
    return {
      config: {
        gameCode: 'APL2026',
        adminCode: 'ADMIN777',
      },
      universalPurse: 800,
      teams: getInitialTeams(),
      players: getInitialPlayers(),
      activeAuction: {
        playerId: null,
        biddingType: 'online',
        currentBid: null,
        currentTeam: null,
        timerSeconds: 30,
        timerDuration: 30,
        timerRunning: false,
        status: 'idle',
        bidHistory: [],
        startedAt: null,
      },
      auditLogs: [
        {
          id: 'init_1',
          action: 'DATABASE_INITIALIZED',
          timestamp: new Date().toISOString(),
          details: { message: 'Database schema migrated and seeded.' },
        },
      ],
    };
  }

  public save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write database file', err);
    }
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public recalculateAllTeams() {
    for (const team of this.state.teams) {
      const teamPlayers = this.state.players.filter((p) => p.teamId === team.id);
      
      // Calculate total spent on auction players
      const auctionSpent = teamPlayers
        .filter((p) => p.type === 'Auction')
        .reduce((sum, p) => sum + (p.soldCost || 0), 0);

      // Total value points
      const totalVal = teamPlayers.reduce((sum, p) => sum + p.valuePoints, 0);

      team.totalSpent = auctionSpent;
      const effectiveBudget = team.adjustedBudget ?? team.baseBudget;
      team.remainingBudget = Math.max(0, effectiveBudget - auctionSpent);
      team.totalValue = totalVal;

      const qual = calculateQualification(team.id, this.state.players);
      team.isQualified = qual.isQualified;
    }
    this.save();
  }

  public updateTeamName(teamId: string, name: string) {
    const team = this.state.teams.find((t) => t.id === teamId || t.code === teamId);
    if (team) {
      team.name = (name || '').trim();
      this.save();
    }
  }

  public updateTeamCode(teamId: string, code: string) {
    const team = this.state.teams.find((t) => t.id === teamId || t.code === teamId);
    if (team) {
      team.loginCode = (code || '').trim().toUpperCase();
      this.save();
    }
  }

  public updateTeamPurse(teamId: string, newRemainingPurse: number) {
    if (!Number.isFinite(newRemainingPurse)) throw new Error('Invalid amount');
    const team = this.state.teams.find((t) => t.id === teamId || t.code === teamId);
    if (team) {
      const safeRemaining = Math.max(0, newRemainingPurse);
      team.remainingBudget = safeRemaining;
      team.adjustedBudget = safeRemaining + team.totalSpent;
      this.save();
    }
  }

  public updateAllTeamsPurse(newRemainingPurse: number) {
    if (!Number.isFinite(newRemainingPurse)) throw new Error('Invalid amount');
    const safeRemaining = Math.max(0, newRemainingPurse);
    this.state.universalPurse = safeRemaining;
    for (const team of this.state.teams) {
      team.remainingBudget = safeRemaining;
      team.adjustedBudget = safeRemaining + team.totalSpent;
    }
    this.save();
  }

  public clearDatabase() {
    // Reset all 4 team purses back to $800M and reset names if needed or keep names
    this.state.universalPurse = 800;
    this.state.teams = getInitialTeams();
    this.state.players = getInitialPlayers();
    this.state.activeAuction = {
      playerId: null,
      biddingType: 'online',
      currentBid: null,
      currentTeam: null,
      timerSeconds: 30,
      timerDuration: 30,
      timerRunning: false,
      status: 'idle',
      bidHistory: [],
      startedAt: null,
    };
    this.state.auditLogs.push({
      id: `clear_${Date.now()}`,
      action: 'CLEAR_DATABASE',
      timestamp: new Date().toISOString(),
      details: { message: 'Admin reset database to starting state.' },
    });
    this.recalculateAllTeams();
    this.save();
  }

  public startBid(
    playerId: number,
    durationSeconds: number = 30,
    biddingType: 'online' | 'offline' = 'online'
  ) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.isSold) throw new Error('Player is already sold');

    const mode: 'online' | 'offline' = biddingType === 'offline' ? 'offline' : 'online';
    const duration =
      mode === 'offline'
        ? 0
        : [30, 60, 90, 120].includes(Number(durationSeconds))
        ? Number(durationSeconds)
        : 30;

    this.state.activeAuction = {
      playerId: player.id,
      biddingType: mode,
      currentBid: null, // First bid will be >= basePrice
      currentTeam: null,
      timerSeconds: duration,
      timerDuration: duration,
      timerRunning: mode === 'online',
      status: 'bidding',
      bidHistory: [],
      startedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.activeAuction;
  }

  public endBidding(offlineAward?: { teamId?: string; amount?: number }) {
    const auction = this.state.activeAuction;
    if (!auction.playerId || auction.status !== 'bidding') {
      throw new Error('No active auction in progress to end');
    }

    if (auction.biddingType === 'offline') {
      const hasTeam = Boolean(offlineAward?.teamId && String(offlineAward.teamId).trim());
      const hasAmount =
        offlineAward?.amount !== undefined &&
        offlineAward?.amount !== null &&
        String(offlineAward.amount).trim() !== '';

      if (!hasTeam && !hasAmount) {
        return this.resolveAuction(false);
      }

      if (!hasTeam || !offlineAward?.teamId) {
        throw new Error('Please select a team before ending offline bidding.');
      }
      const amount = Number(offlineAward.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid price in M$ before ending offline bidding.');
      }
      const player = this.state.players.find((p) => p.id === auction.playerId);
      if (!player) throw new Error('Player not found');
      if (amount < player.basePrice) {
        throw new Error(
          `Please enter an amount equal to or higher than the Base price of ${player.basePrice} M$`
        );
      }

      const match = offlineAward.teamId.trim().toLowerCase();
      const team = this.state.teams.find(
        (t) =>
          t.id.toLowerCase() === match ||
          t.code.toLowerCase() === match ||
          (t.name && t.name.trim().toLowerCase() === match)
      );
      if (!team) {
        throw new Error('Selected team not found.');
      }
      if (amount > team.remainingBudget) {
        const displayName = team.name && team.name.trim() ? team.name.trim() : team.code;
        throw new Error(
          `Insufficient purse! ${displayName} has ${team.remainingBudget} M$ remaining, but entered price is ${amount} M$.`
        );
      }

      auction.currentBid = amount;
      auction.currentTeam = team.code;
      return this.resolveAuction(true);
    }

    // If there is an active bid and team, make that highest bidder the winner immediately!
    const sold = auction.currentBid !== null && auction.currentTeam !== null;
    return this.resolveAuction(sold);
  }

  public placeBid(teamCodeOrId: string, bidAmount: number) {
  if (!Number.isFinite(bidAmount)) throw new Error('Invalid amount');
    const auction = this.state.activeAuction;
    if (!auction.playerId || auction.status !== 'bidding') {
      throw new Error('No active auction in progress');
    }
    if (auction.biddingType === 'offline') {
      throw new Error('Online bidding is disabled during an offline auction');
    }

    const player = this.state.players.find((p) => p.id === auction.playerId);
    if (!player) throw new Error('Player not found');

    const match = (teamCodeOrId || '').trim().toLowerCase();
    const team = this.state.teams.find(
      (t) =>
        t.code.toLowerCase() === match ||
        t.id.toLowerCase() === match ||
        (t.name && t.name.trim().toLowerCase() === match)
    );
    if (!team) throw new Error('Team not found');

    // Check remaining purse
    if (bidAmount > team.remainingBudget) {
      throw new Error(
        `Insufficient purse! ${team.code} has ${team.remainingBudget} M$ remaining, but bid is ${bidAmount} M$.`
      );
    }

    // First bid rule: must be >= Base Price
    if (auction.currentBid === null) {
      if (bidAmount < player.basePrice) {
        throw new Error(
          `Bid must be at least the base price of ${player.basePrice} M$.`
        );
      }
    } else {
      // Counter bid rule: must be >= current highest bid + 20 M$
      const minBid = auction.currentBid + 20;
      if (bidAmount < minBid) {
        throw new Error(
          `Counter bid must be at least ${minBid} M$ (Current bid ${auction.currentBid} M$ + 20 M$ minimum increment).`
        );
      }
    }

    // Valid bid!
    auction.currentBid = bidAmount;
    auction.currentTeam = team.code;
    auction.timerSeconds = auction.timerDuration || 30; // Reset timer to configured duration (e.g. 30s)
    auction.timerRunning = true;
    auction.bidHistory.unshift({
      id: `bid_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      playerId: player.id,
      teamCode: team.code,
      amount: bidAmount,
      timestamp: new Date().toLocaleTimeString(),
    });

    this.save();
    return { auction, team, player };
  }

  public resolveAuction(sold: boolean) {
    const auction = this.state.activeAuction;
    if (!auction.playerId) return null;

    const player = this.state.players.find((p) => p.id === auction.playerId);
    if (!player) return null;

    if (sold && auction.currentTeam && auction.currentBid !== null) {
      const matchTeam = auction.currentTeam.trim().toLowerCase();
      const winningTeam = this.state.teams.find(
        (t) =>
          t.code.toLowerCase() === matchTeam ||
          t.id.toLowerCase() === matchTeam ||
          (t.name && t.name.trim().toLowerCase() === matchTeam)
      );
      if (winningTeam) {
        player.isSold = true;
        player.soldCost = auction.currentBid;
        player.teamId = winningTeam.id;
        auction.status = 'sold';

        this.state.auditLogs.push({
          id: `sold_${Date.now()}`,
          action: 'PLAYER_SOLD',
          timestamp: new Date().toISOString(),
          details: {
            player: player.name,
            team: winningTeam.code,
            amount: auction.currentBid,
          },
        });
      } else {
        auction.status = 'unsold';
      }
    } else {
      auction.status = 'unsold';
      this.state.auditLogs.push({
        id: `unsold_${Date.now()}`,
        action: 'PLAYER_UNSOLD',
        timestamp: new Date().toISOString(),
        details: { player: player.name },
      });
    }

    auction.timerRunning = false;
    auction.timerSeconds = 0;

    this.recalculateAllTeams();
    this.save();
    return { auction, player };
  }

  public closeBiddingModal() {
    this.state.activeAuction.status = 'idle';
    this.state.activeAuction.playerId = null;
    this.state.activeAuction.currentBid = null;
    this.state.activeAuction.currentTeam = null;
    this.state.activeAuction.timerRunning = false;
    this.save();
  }

  public extendTimer(addSeconds: number = 30) {
    const auction = this.state.activeAuction;
    if (!auction.playerId || auction.status !== 'bidding' || auction.biddingType === 'offline') {
      throw new Error('No active online auction in progress');
    }
    const maxDuration = auction.timerDuration || 30;
    auction.timerSeconds = Math.min(maxDuration, auction.timerSeconds + addSeconds);
    auction.timerRunning = true;
    this.save();
    return auction.timerSeconds;
  }

  public reAuctionPlayer(playerId: number) {
    if (this.state.activeAuction.status === 'bidding') {
      throw new Error('Complete the active auction before re-auctioning a player.');
    }

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.type !== 'Auction') {
      throw new Error('Auction player not found');
    }

    if (player.isSold) {
      player.isSold = false;
      player.soldCost = null;
      player.teamId = null;

      if (
        this.state.activeAuction.playerId === player.id &&
        this.state.activeAuction.status === 'sold'
      ) {
        this.state.activeAuction.status = 'idle';
        this.state.activeAuction.playerId = null;
        this.state.activeAuction.currentBid = null;
        this.state.activeAuction.currentTeam = null;
        this.state.activeAuction.timerRunning = false;
      }

      this.state.auditLogs.push({
        id: `reauction_${Date.now()}`,
        action: 'PLAYER_REAUCTION',
        timestamp: new Date().toISOString(),
        details: { player: player.name, playerId: player.id },
      });

      this.recalculateAllTeams();
      this.save();
    }
    return player;
  }
}

export const db = new AuctionDatabase();

function publicState() {
  const { config, ...rest } = db.getState();
  return rest;
}

// --- SERVER SETUP ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Serve local player photos (works in dev and production, on any domain)
app.use(
  '/players',
  express.static(path.join(__dirname, 'public', 'players'), { maxAge: '7d' })
);

// Broadcast helper for WebSockets
function broadcast(payload: any) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Timer Loop (runs on server every second)
setInterval(() => {
  const state = db.getState();
  const auction = state.activeAuction;

  if (
    auction.timerRunning &&
    auction.status === 'bidding' &&
    auction.biddingType !== 'offline'
  ) {
    if (auction.timerSeconds > 0) {
      auction.timerSeconds -= 1;
      broadcast({
        type: 'TIMER_TICK',
        timerSeconds: auction.timerSeconds,
      });

      if (auction.timerSeconds === 0) {
        // Time expired! Resolve auction
        if (auction.currentBid !== null && auction.currentTeam !== null) {
          const res = db.resolveAuction(true);
          broadcast({
            type: 'AUCTION_RESOLVED',
            status: 'sold',
            result: res,
            state: publicState(),
          });
        } else {
          const res = db.resolveAuction(false);
          broadcast({
            type: 'AUCTION_RESOLVED',
            status: 'unsold',
            result: res,
            state: publicState(),
          });
        }
      }
    }
  }
}, 1000);

// WebSocket Connections
wss.on('connection', (ws) => {
  // Send current full state on connect
  ws.send(
    JSON.stringify({
      type: 'INIT_STATE',
      state: publicState(),
    })
  );

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'PLACE_BID') {
        const { teamCode, amount } = data;
        const result = db.placeBid(teamCode, Number(amount));
        broadcast({
          type: 'BID_PLACED',
          auction: result.auction,
          state: publicState(),
          message: `${teamCode} placed a bid of ${amount} M$!`,
        });
      } else if (data.type === 'START_BID') {
        const { playerId, durationSeconds, biddingType } = data;
        const mode = biddingType === 'offline' ? 'offline' : 'online';
        const auction = db.startBid(
          Number(playerId),
          durationSeconds ? Number(durationSeconds) : 30,
          mode
        );
        broadcast({
          type: 'AUCTION_STARTED',
          auction,
          state: publicState(),
        });
      } else if (data.type === 'END_BIDDING') {
        const offlineAward =
          data.teamId !== undefined || data.amount !== undefined
            ? { teamId: data.teamId, amount: data.amount }
            : undefined;
        const result = db.endBidding(offlineAward);
        broadcast({
          type: 'AUCTION_RESOLVED',
          status: result?.auction.status || 'unsold',
          result,
          state: publicState(),
        });
      } else if (data.type === 'CLOSE_BID_MODAL') {
        db.closeBiddingModal();
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'CLEAR_DATABASE') {
        db.clearDatabase();
        broadcast({
          type: 'DATABASE_CLEARED',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_NAME') {
        db.updateTeamName(data.teamId, data.name);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_CODE') {
        db.updateTeamCode(data.teamId, data.code);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_PURSE') {
        db.updateTeamPurse(data.teamId, Number(data.newPurse));
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_ALL_PURSES') {
        db.updateAllTeamsPurse(Number(data.newPurse));
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'REAUCTION_PLAYER') {
        db.reAuctionPlayer(Number(data.playerId));
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'EXTEND_TIMER') {
        const timerSeconds = db.extendTimer(30);
        broadcast({
          type: 'TIMER_TICK',
          timerSeconds,
        });
      }
    } catch (err: any) {
      ws.send(
        JSON.stringify({
          type: 'ERROR',
          message: err.message || 'Operation failed',
        })
      );
    }
  });
});

// REST API Endpoints
app.get('/api/state', (req, res) => {
  res.json(publicState());
});

app.post('/api/auth/login', (req, res) => {
  const { teamCode, adminCode } = req.body;
  const config = db.getState().config;

  if (adminCode !== undefined) {
    const cleaned = (adminCode || '').trim().toUpperCase();
    if (cleaned === config.adminCode) {
      return res.json({ role: 'admin', gameCode: config.gameCode });
    }
    return res.status(401).json({ error: 'Invalid Admin Code. Access denied.' });
  }

  if (teamCode !== undefined) {
    const code = (teamCode || '').trim().toUpperCase();
    const matchedTeam = db
      .getState()
      .teams.find((t) => t.loginCode && t.loginCode.trim().toUpperCase() === code);
    if (matchedTeam) {
      return res.json({
        role: 'participant',
        selectedTeam: matchedTeam.code,
        gameCode: config.gameCode,
      });
    }
    return res.status(401).json({ error: 'Invalid Team Code. Please check and try again.' });
  }

  return res.status(400).json({ error: 'Please enter a valid Team Code or Admin Code.' });
});

// Vite middleware in dev or static files in production
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
