import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer, type IncomingMessage } from 'http';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

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
    adminCodeHash?: string;
    adminCode?: string;
  };
  universalPurse?: number;
  teams: Team[];
  players: Player[];
  activeAuction: ActiveAuction;
  auditLogs: { id: string; action: string; timestamp: string; details: any }[];
}

function getDefaultAdminCode(): string | null {
  const raw = process.env.ADMIN_DEFAULT_CODE;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function getAdminCodeChangePassword(): string | null {
  const raw = process.env.ADMIN_CODE_CHANGE_PASSWORD;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

function isValidAdminCodeFormat(normalizedCode: string): boolean {
  return (
    normalizedCode.length >= 4 &&
    normalizedCode.length <= 64 &&
    !/[\x00-\x1F\x7F\s]/.test(normalizedCode)
  );
}

function hashAdminCode(normalizedCode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalizedCode, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function isValidAdminCodeHashFormat(storedHash: unknown): storedHash is string {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  return (
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[0-9a-f]{32}$/i.test(parts[1]) &&
    /^[0-9a-f]{128}$/i.test(parts[2])
  );
}

function verifyAdminCodeHash(normalizedCode: string, storedHash: unknown): boolean {
  if (!isValidAdminCodeHashFormat(storedHash)) return false;
  const [, salt, hexHash] = storedHash.split(':');
  const expectedBuf = Buffer.from(hexHash, 'hex');
  const actualBuf = crypto.scryptSync(normalizedCode, salt, 64);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function isRenderEnvironment(): boolean {
  return (
    process.env.RENDER === 'true' ||
    process.env.RENDER === '1' ||
    Boolean(process.env.RENDER_SERVICE_ID)
  );
}

function validateRenderPersistentDir(targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `FATAL: Persistent disk directory "${targetDir}" does not exist on Render. Refusing to fall back to a temporary filesystem.`
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetDir);
  } catch (err: any) {
    throw new Error(
      `FATAL: Unable to inspect persistent disk directory "${targetDir}": ${err?.message || err}`
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `FATAL: Persistent disk path "${targetDir}" is not a directory. Refusing to fall back to a temporary filesystem.`
    );
  }
  try {
    fs.accessSync(targetDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err: any) {
    throw new Error(
      `FATAL: Persistent disk directory "${targetDir}" is not readable and writable: ${err?.message || err}`
    );
  }
}

function resolveDatabasePaths(): { dataDir: string; dbFile: string } {
  const rawDbPath = (process.env.DATABASE_PATH || process.env.DB_FILE_PATH || '').trim();
  const rawDataDir = (process.env.DATA_DIR || process.env.RENDER_DISK_PATH || '').trim();
  const onRender = isRenderEnvironment();

  let dataDir: string;
  let dbFile: string;

  if (rawDbPath) {
    dbFile = path.resolve(rawDbPath);
    dataDir = path.dirname(dbFile);
  } else if (rawDataDir) {
    dataDir = path.resolve(rawDataDir);
    dbFile = path.join(dataDir, 'auction_database.json');
  } else {
    if (onRender) {
      throw new Error(
        'FATAL: Persistent storage is required on Render. Set DATA_DIR (e.g. /var/data) or DATABASE_PATH pointing to your mounted Render persistent disk. Refusing to fall back to a temporary filesystem.'
      );
    }
    dataDir = path.join(__dirname, 'data');
    dbFile = path.join(dataDir, 'auction_database.json');
  }

  if (onRender) {
    const resolvedAppRoot = path.resolve(__dirname);
    const relativeToApp = path.relative(resolvedAppRoot, dbFile);
    const isInsideAppRoot =
      relativeToApp === '' ||
      (!relativeToApp.startsWith('..') && !path.isAbsolute(relativeToApp));
    if (isInsideAppRoot) {
      throw new Error(
        `FATAL: Database path "${dbFile}" points inside the ephemeral application directory "${resolvedAppRoot}" on Render. Configure DATA_DIR to your mounted persistent disk (e.g. /var/data).`
      );
    }
    validateRenderPersistentDir(dataDir);
  }

  return { dataDir, dbFile };
}

const { dataDir: DATA_DIR, dbFile: DB_FILE } = resolveDatabasePaths();

function writeDatabaseStateAtomically(filePath: string, state: DatabaseState) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore temp cleanup failure
    }
    throw err;
  }
}

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

function buildSeededDatabaseState(adminCodeHash?: string): DatabaseState {
  return {
    config: {
      gameCode: 'APL2026',
      ...(adminCodeHash ? { adminCodeHash } : {}),
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
        details: { message: 'Database initialized explicitly.' },
      },
    ],
  };
}

function isValidPersistedDatabaseShape(candidate: unknown): candidate is DatabaseState {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  const obj = candidate as Record<string, unknown>;
  return (
    Array.isArray(obj.teams) &&
    obj.teams.length > 0 &&
    Array.isArray(obj.players) &&
    obj.players.length > 0 &&
    Boolean(obj.activeAuction) &&
    typeof obj.activeAuction === 'object' &&
    !Array.isArray(obj.activeAuction)
  );
}

function parseCliFlags(argv: string[]): {
  command: 'init-db' | 'recover-admin' | null;
  code: string | null;
  useDefault: boolean;
} {
  let command: 'init-db' | 'recover-admin' | null = null;
  let code: string | null = null;
  let useDefault = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--init-db') {
      command = 'init-db';
    } else if (arg === '--recover-admin') {
      command = 'recover-admin';
    } else if (arg === '--use-default') {
      useDefault = true;
    } else if (arg === '--code' && i + 1 < argv.length) {
      code = argv[++i];
    } else if (arg.startsWith('--code=')) {
      code = arg.slice('--code='.length);
    }
  }

  return { command, code, useDefault };
}

function runCliInitDb(): never {
  if (fs.existsSync(DB_FILE)) {
    console.error(
      `REFUSED: Persistent database already exists at ${DB_FILE}. First-time initialization will never overwrite an active database or Admin Code. Use "npm run recover-admin -- --code <NEW_CODE>" if you need to recover Admin access.`
    );
    process.exit(1);
  }

  const defaultAdminCode = getDefaultAdminCode();
  if (!defaultAdminCode || !isValidAdminCodeFormat(defaultAdminCode)) {
    console.error(
      'ERROR: ADMIN_DEFAULT_CODE must be set to 4-64 non-whitespace characters for first-time database initialization.'
    );
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    if (isRenderEnvironment()) {
      console.error(`FATAL: Persistent disk directory "${DATA_DIR}" is unavailable on Render.`);
      process.exit(1);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const initialState = buildSeededDatabaseState(hashAdminCode(defaultAdminCode));
  writeDatabaseStateAtomically(DB_FILE, initialState);
  console.log(
    `Initialized persistent database at ${DB_FILE} with salted scrypt hash of ADMIN_DEFAULT_CODE.`
  );
  console.log('Restart the application server if it is currently running.');
  process.exit(0);
}

function runCliRecoverAdmin(codeArg: string | null, useDefault: boolean): never {
  if (!fs.existsSync(DB_FILE)) {
    console.error(
      `ERROR: No persistent database exists at ${DB_FILE}. Run "npm run init-db" for first-time initialization.`
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (err: any) {
    console.error(
      `ERROR: Persistent database at ${DB_FILE} could not be read or parsed as JSON (${err?.message || err}). Refusing to overwrite existing data.`
    );
    process.exit(1);
  }

  if (!isValidPersistedDatabaseShape(parsed)) {
    console.error(
      `ERROR: Persistent database at ${DB_FILE} has an invalid schema. Refusing to overwrite existing data.`
    );
    process.exit(1);
  }

  let recoveryRaw = codeArg ?? process.env.ADMIN_RECOVERY_CODE ?? null;
  if (!recoveryRaw && useDefault) {
    recoveryRaw = getDefaultAdminCode();
  }

  if (!recoveryRaw) {
    console.error(
      'Usage: npm run recover-admin -- --code <NEW_ADMIN_CODE>  (or set ADMIN_RECOVERY_CODE, or pass --use-default to explicitly re-seed from ADMIN_DEFAULT_CODE).'
    );
    process.exit(1);
  }

  const normalizedCode = recoveryRaw.trim().toUpperCase();
  if (!isValidAdminCodeFormat(normalizedCode)) {
    console.error(
      'ERROR: Recovery Admin Code must be 4-64 characters with no spaces or control characters.'
    );
    process.exit(1);
  }

  if (!parsed.config || typeof parsed.config !== 'object') {
    parsed.config = { gameCode: 'APL2026' };
  }
  parsed.config.gameCode = 'APL2026';
  if ('adminCode' in parsed.config) {
    delete parsed.config.adminCode;
  }
  parsed.config.adminCodeHash = hashAdminCode(normalizedCode);

  if (!Array.isArray(parsed.auditLogs)) {
    parsed.auditLogs = [];
  }
  parsed.auditLogs.push({
    id: `admin_recover_${Date.now()}`,
    action: 'ADMIN_CODE_RECOVERED',
    timestamp: new Date().toISOString(),
    details: { message: 'Admin login code was explicitly recovered via CLI.' },
  });

  writeDatabaseStateAtomically(DB_FILE, parsed);
  console.log(
    `Recovered Admin Code hash in ${DB_FILE} while preserving all teams, players, purses, and auction state.`
  );
  console.log('Restart the application server if it is currently running.');
  process.exit(0);
}

const cliFlags = parseCliFlags(process.argv.slice(2));
if (cliFlags.command === 'init-db') {
  runCliInitDb();
} else if (cliFlags.command === 'recover-admin') {
  runCliRecoverAdmin(cliFlags.code, cliFlags.useDefault);
}

export type DatabaseStatus = 'ready' | 'missing' | 'corrupt' | 'missing_admin_hash';

// Database Layer with File Persistence & Fail-Secure Authority
class AuctionDatabase {
  private state: DatabaseState;
  private dbStatus: DatabaseStatus = 'missing';
  private persistenceEnabled = false;
  private statusMessage = '';

  constructor() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!isValidPersistedDatabaseShape(parsed)) {
          throw new Error('Invalid persistent database structure.');
        }
        this.state = parsed;

        if (!this.state.config || typeof this.state.config !== 'object') {
          this.state.config = { gameCode: 'APL2026' };
        }
        // Ensure static game code is permanent and plaintext adminCode is never retained
        this.state.config.gameCode = 'APL2026';
        let needsSave = false;
        if ('adminCode' in this.state.config) {
          delete this.state.config.adminCode;
          needsSave = true;
        }
        if (isValidAdminCodeHashFormat(this.state.config.adminCodeHash)) {
          this.dbStatus = 'ready';
          this.persistenceEnabled = true;
          this.statusMessage = '';
        } else {
          // NEVER silently recreate or fall back to ADMIN_DEFAULT_CODE
          delete this.state.config.adminCodeHash;
          this.dbStatus = 'missing_admin_hash';
          this.persistenceEnabled = true;
          this.statusMessage =
            'Persistent database is missing a valid adminCodeHash. Admin login is disabled; run explicit recovery ("npm run recover-admin -- --code <NEW_CODE>").';
          console.error(`CRITICAL: ${this.statusMessage}`);
        }

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
            needsSave = true;
          }
          if (team.adjustedBudget === undefined) {
            team.adjustedBudget = team.baseBudget;
            needsSave = true;
          }
        }
        if (!this.state.activeAuction.biddingType) {
          this.state.activeAuction.biddingType = 'online';
          needsSave = true;
        }
        if (this.state.universalPurse === undefined) {
          this.state.universalPurse = 800;
          needsSave = true;
        }
        if (!Array.isArray(this.state.auditLogs)) {
          this.state.auditLogs = [];
          needsSave = true;
        }
        if (needsSave && this.dbStatus === 'ready') {
          this.save();
        }
      } catch (e) {
        this.dbStatus = 'corrupt';
        this.persistenceEnabled = false;
        this.statusMessage = `Persistent database file at ${DB_FILE} is unreadable or corrupted. Refusing to recreate default admin credentials.`;
        console.error(`CRITICAL: ${this.statusMessage}`, e);
        this.state = this.createEphemeralFallbackState();
      }
    } else {
      this.dbStatus = 'missing';
      this.persistenceEnabled = false;
      this.statusMessage = `Persistent database not found at ${DB_FILE}. Run explicit first-time initialization ("npm run init-db") with ADMIN_DEFAULT_CODE configured.`;
      console.error(`CRITICAL: ${this.statusMessage}`);
      this.state = this.createEphemeralFallbackState();
    }

    this.syncImageUrls();
    this.recalculateAllTeams(this.dbStatus === 'ready');
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

  // Used only in memory when persistent DB is missing or corrupted; intentionally omits adminCodeHash and never saves to disk.
  private createEphemeralFallbackState(): DatabaseState {
    return buildSeededDatabaseState(undefined);
  }

  public getDatabaseStatus(): {
    status: DatabaseStatus;
    persistenceEnabled: boolean;
    message: string;
  } {
    return {
      status: this.dbStatus,
      persistenceEnabled: this.persistenceEnabled,
      message: this.statusMessage,
    };
  }

  public isAdminAuthReady(): boolean {
    return (
      this.dbStatus === 'ready' &&
      isValidAdminCodeHashFormat(this.state.config.adminCodeHash)
    );
  }

  public isDatabaseIntact(): boolean {
    return (
      this.persistenceEnabled &&
      (this.dbStatus === 'ready' || this.dbStatus === 'missing_admin_hash')
    );
  }

  public save() {
    if (!this.persistenceEnabled) {
      throw new Error(
        'Database persistence is disabled because the persistent database is missing or corrupted.'
      );
    }
    if (!fs.existsSync(DATA_DIR)) {
      if (isRenderEnvironment()) {
        throw new Error(`Persistent disk directory "${DATA_DIR}" is unavailable on Render.`);
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    writeDatabaseStateAtomically(DB_FILE, this.state);
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public recalculateAllTeams(shouldSave: boolean = true) {
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
    if (shouldSave && this.persistenceEnabled) {
      this.save();
    }
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

  public updateAdminCode(normalizedNewCode: string) {
    if (!this.isDatabaseIntact()) {
      throw new Error('Cannot update admin code: persistent database is missing or corrupted.');
    }
    const previousHash = this.state.config.adminCodeHash;
    const previousAuditLength = this.state.auditLogs.length;
    this.state.config.adminCodeHash = hashAdminCode(normalizedNewCode);
    if ('adminCode' in this.state.config) {
      delete this.state.config.adminCode;
    }
    this.state.auditLogs.push({
      id: `admin_code_${Date.now()}`,
      action: 'ADMIN_CODE_CHANGED',
      timestamp: new Date().toISOString(),
      details: { message: 'Admin login code was updated.' },
    });
    try {
      this.save();
      this.dbStatus = 'ready';
      this.statusMessage = '';
    } catch (err) {
      if (previousHash !== undefined) {
        this.state.config.adminCodeHash = previousHash;
      } else {
        delete this.state.config.adminCodeHash;
      }
      this.state.auditLogs.length = previousAuditLength;
      throw err;
    }
  }

  public clearDatabase() {
    const currentAdminCodeHash = this.state.config.adminCodeHash;
    if (!this.isAdminAuthReady() || !isValidAdminCodeHashFormat(currentAdminCodeHash)) {
      throw new Error('Reset unavailable: active admin code hash is missing.');
    }

    // Reset all 4 team purses back to $800M and reset auction/teams while preserving the active admin code hash
    this.state.config.adminCodeHash = currentAdminCodeHash;
    if ('adminCode' in this.state.config) {
      delete this.state.config.adminCode;
    }
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
      details: {
        message: 'Admin reset database to starting state (active admin code preserved).',
      },
    });
    this.recalculateAllTeams(false);
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
  const state = db.getState();
  const auction = state.activeAuction;
  return {
    universalPurse: typeof state.universalPurse === 'number' ? state.universalPurse : 800,
    teams: state.teams.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      color: t.color,
      avatarBg: t.avatarBg,
      baseBudget: t.baseBudget,
      adjustedBudget: t.adjustedBudget,
      remainingBudget: t.remainingBudget,
      totalSpent: t.totalSpent,
      totalValue: t.totalValue,
      isQualified: t.isQualified,
    })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      type: p.type,
      teamId: p.teamId,
      valuePoints: p.valuePoints,
      basePrice: p.basePrice,
      soldCost: p.soldCost,
      isSold: p.isSold,
      lotNumber: p.lotNumber,
      lotName: p.lotName,
      imageUrl: p.imageUrl,
    })),
    activeAuction: {
      playerId: auction.playerId,
      biddingType: auction.biddingType,
      currentBid: auction.currentBid,
      currentTeam: auction.currentTeam,
      timerSeconds: auction.timerSeconds,
      timerDuration: auction.timerDuration,
      timerRunning: auction.timerRunning,
      status: auction.status,
      bidHistory: Array.isArray(auction.bidHistory)
        ? auction.bidHistory.map((item) => ({
            id: item.id,
            playerId: item.playerId,
            teamCode: item.teamCode,
            amount: item.amount,
            timestamp: item.timestamp,
          }))
        : [],
      startedAt: auction.startedAt,
    },
  };
}

// --- SESSION & WEBSOCKET SECURITY CONFIGURATION ---
interface SessionRecord {
  token: string;
  role: 'admin' | 'participant';
  teamCode?: string;
  teamId?: string;
  createdAt: number;
  expiresAt: number;
}

interface ConnectionIpTracking {
  clientIp: string;
  countsAsUnauth: boolean;
  ipReleased: boolean;
  handedOffToWs: boolean;
}

interface IpConnectionCounts {
  total: number;
  unauth: number;
}

interface ClientMeta {
  authenticated: boolean;
  sessionToken: string | null;
  role: 'admin' | 'participant' | null;
  teamCode: string | null;
  isAlive: boolean;
  msgTimestamps: number[];
  rateLimitWarnedAt: number;
  invalidAttempts: number;
  authTimer: NodeJS.Timeout | null;
  ipTracking: ConnectionIpTracking;
}

const DEFAULT_WS_MAX_CONNECTIONS_PER_IP = 100;
const DEFAULT_WS_MAX_UNAUTH_CONNECTIONS_PER_IP = 25;
const MAX_CONFIGURABLE_WS_CONNECTION_LIMIT = 100_000;

function parsePositiveIntLimit(
  rawValue: string | undefined,
  defaultValue: number,
  maxValue = MAX_CONFIGURABLE_WS_CONNECTION_LIMIT
): number {
  if (typeof rawValue !== 'string') {
    return defaultValue;
  }
  const trimmed = rawValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    return defaultValue;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxValue) {
    return defaultValue;
  }
  return parsed;
}

const WS_MAX_CONNECTIONS_PER_IP = parsePositiveIntLimit(
  process.env.WS_MAX_CONNECTIONS_PER_IP,
  DEFAULT_WS_MAX_CONNECTIONS_PER_IP
);
const WS_MAX_UNAUTH_CONNECTIONS_PER_IP = parsePositiveIntLimit(
  process.env.WS_MAX_UNAUTH_CONNECTIONS_PER_IP,
  DEFAULT_WS_MAX_UNAUTH_CONNECTIONS_PER_IP
);

const SESSION_TTL_MS = (() => {
  const parsed = Number(process.env.SESSION_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12 * 60 * 60 * 1000;
})();

const MAX_WS_PAYLOAD_BYTES = 16 * 1024; // 16 KB
const AUTH_HANDSHAKE_TIMEOUT_MS = 10_000; // 10 seconds
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const RATE_LIMIT_WINDOW_MS = 5_000; // 5 seconds
const RATE_LIMIT_MAX_MESSAGES = 25; // max 25 messages per 5s window
const MAX_PURSE_AMOUNT = 1_000_000; // 1,000,000 M$ upper bound
const ALLOWED_AUCTION_DURATIONS = new Set([30, 60, 90, 120]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const sessions = new Map<string, SessionRecord>();
const clientMetaMap = new WeakMap<WebSocket, ClientMeta>();
const ipConnections = new Map<string, IpConnectionCounts>();
const pendingUpgradeTickets = new WeakMap<IncomingMessage, ConnectionIpTracking>();

function isTrustProxyEnabled(): boolean {
  return process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
}

function expandIpv6ToGroups(ip: string): number[] | null {
  let working = ip.toLowerCase();
  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) {
    return null;
  }

  const parseSegmentList = (segment: string): number[] | null => {
    if (!segment) return [];
    const parts = segment.split(':');
    const groups: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('.')) {
        if (i !== parts.length - 1 || !net.isIPv4(part)) {
          return null;
        }
        const octets = part.split('.').map(Number);
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) {
          return null;
        }
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSegmentList(doubleColonParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseSegmentList(doubleColonParts[0]);
  const right = parseSegmentList(doubleColonParts[1]);
  if (!left || !right) return null;

  const missingCount = 8 - (left.length + right.length);
  if (missingCount < 1) return null;

  return [...left, ...new Array<number>(missingCount).fill(0), ...right];
}

function formatCanonicalIpv6(groups: number[]): string {
  // Collapse longest run of >= 2 zero groups per RFC 5952
  let bestStart = -1;
  let bestLen = 0;
  let currStart = -1;
  let currLen = 0;

  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (currStart === -1) {
        currStart = i;
        currLen = 1;
      } else {
        currLen += 1;
      }
      if (currLen > bestLen) {
        bestStart = currStart;
        bestLen = currLen;
      }
    } else {
      currStart = -1;
      currLen = 0;
    }
  }

  if (bestLen < 2) {
    bestStart = -1;
    bestLen = 0;
  }

  const hexGroups = groups.map((g) => g.toString(16));
  if (bestStart === -1) {
    return hexGroups.join(':');
  }

  const left = hexGroups.slice(0, bestStart).join(':');
  const right = hexGroups.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

function normalizeIp(rawIp: string | undefined | null): string {
  if (typeof rawIp !== 'string') {
    return 'unknown';
  }

  let candidate = rawIp.trim();
  if (!candidate) {
    return 'unknown';
  }

  // Strip optional brackets (e.g. [::1] or [::1]:12345)
  const bracketMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketMatch) {
    candidate = bracketMatch[1];
  } else {
    // Strip optional :port from IPv4:port
    const ipv4PortMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
    if (ipv4PortMatch && net.isIPv4(ipv4PortMatch[1])) {
      candidate = ipv4PortMatch[1];
    }
  }

  // Strip IPv6 zone identifier if present (e.g. fe80::1%eth0)
  const zoneIdx = candidate.indexOf('%');
  if (zoneIdx !== -1) {
    candidate = candidate.slice(0, zoneIdx);
  }

  candidate = candidate.toLowerCase();
  const ipVersion = net.isIP(candidate);
  if (ipVersion === 4) {
    return candidate;
  }
  if (ipVersion === 6) {
    const groups = expandIpv6ToGroups(candidate);
    if (!groups) {
      return candidate;
    }
    // Map IPv4-mapped IPv6 addresses (::ffff:a.b.c.d or ::ffff:xxxx:yyyy) to canonical IPv4
    const isIpv4Mapped =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0xffff;
    if (isIpv4Mapped) {
      return `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    }
    return formatCanonicalIpv6(groups);
  }

  return 'unknown';
}

function getClientIp(req?: IncomingMessage): string {
  const socketIp = normalizeIp(req?.socket?.remoteAddress);
  if (!req || !isTrustProxyEnabled()) {
    return socketIp;
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const rawHeader = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof rawHeader === 'string' && rawHeader.trim().length > 0) {
    for (const part of rawHeader.split(',')) {
      const normalized = normalizeIp(part);
      if (normalized !== 'unknown') {
        return normalized;
      }
    }
  }

  return socketIp;
}

interface AuthRateLimitEntry {
  failures: number;
  blockedUntil: number;
  lastAttemptAt: number;
}

const AUTH_MAX_FAILED_ATTEMPTS = 10;
const AUTH_COOLDOWN_MS = 30_000;
const AUTH_LIMITER_MAX_ENTRIES = 10_000;
const AUTH_LIMITER_IDLE_TTL_MS = 15 * 60 * 1000;
const AUTH_LIMITER_CLEANUP_INTERVAL_MS = 60_000;

class AuthRateLimiter {
  private entries = new Map<string, AuthRateLimitEntry>();

  public check(ip: string, now: number = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
    const entry = this.entries.get(ip);
    if (!entry) {
      return { blocked: false, retryAfterSeconds: 0 };
    }

    if (entry.blockedUntil > 0) {
      if (now < entry.blockedUntil) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
        return { blocked: true, retryAfterSeconds };
      }
      this.entries.delete(ip);
      return { blocked: false, retryAfterSeconds: 0 };
    }

    if (now - entry.lastAttemptAt > AUTH_LIMITER_IDLE_TTL_MS) {
      this.entries.delete(ip);
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  public recordFailure(
    ip: string,
    now: number = Date.now()
  ): { cooldownActivated: boolean; retryAfterSeconds: number; failures: number } {
    let entry = this.entries.get(ip);
    if (
      entry &&
      ((entry.blockedUntil > 0 && now >= entry.blockedUntil) ||
        now - entry.lastAttemptAt > AUTH_LIMITER_IDLE_TTL_MS)
    ) {
      this.entries.delete(ip);
      entry = undefined;
    }

    if (!entry) {
      if (this.entries.size >= AUTH_LIMITER_MAX_ENTRIES) {
        this.cleanup(now);
        if (this.entries.size >= AUTH_LIMITER_MAX_ENTRIES) {
          const oldestKey = this.entries.keys().next().value;
          if (oldestKey !== undefined) {
            this.entries.delete(oldestKey);
          }
        }
      }
      entry = { failures: 0, blockedUntil: 0, lastAttemptAt: now };
    } else {
      // Refresh insertion order for bounded LRU eviction
      this.entries.delete(ip);
    }

    entry.failures += 1;
    entry.lastAttemptAt = now;

    if (entry.failures >= AUTH_MAX_FAILED_ATTEMPTS) {
      entry.blockedUntil = now + AUTH_COOLDOWN_MS;
      this.entries.set(ip, entry);
      return {
        cooldownActivated: true,
        retryAfterSeconds: Math.ceil(AUTH_COOLDOWN_MS / 1000),
        failures: entry.failures,
      };
    }

    this.entries.set(ip, entry);
    return {
      cooldownActivated: false,
      retryAfterSeconds: 0,
      failures: entry.failures,
    };
  }

  public reset(ip: string): void {
    this.entries.delete(ip);
  }

  public cleanup(now: number = Date.now()): void {
    for (const [ip, entry] of this.entries.entries()) {
      if (entry.blockedUntil > 0 && now >= entry.blockedUntil) {
        this.entries.delete(ip);
      } else if (entry.blockedUntil === 0 && now - entry.lastAttemptAt > AUTH_LIMITER_IDLE_TTL_MS) {
        this.entries.delete(ip);
      }
    }
  }

  public clear(): void {
    this.entries.clear();
  }
}

const loginRateLimiter = new AuthRateLimiter();
const adminCodeChangeRateLimiter = new AuthRateLimiter();

const authLimiterCleanupInterval = setInterval(() => {
  const now = Date.now();
  loginRateLimiter.cleanup(now);
  adminCodeChangeRateLimiter.cleanup(now);
}, AUTH_LIMITER_CLEANUP_INTERVAL_MS);
authLimiterCleanupInterval.unref();

function formatSecondsUnit(seconds: number): string {
  return seconds === 1 ? 'second' : 'seconds';
}

function sendCooldownBlockedResponse(
  res: Response,
  retryAfterSeconds: number,
  scope: 'login' | 'change-admin-code'
) {
  const safeSeconds = Math.max(1, retryAfterSeconds);
  res.setHeader('Retry-After', String(safeSeconds));
  const error =
    scope === 'login'
      ? `Login temporarily blocked. Please try again in ${safeSeconds} ${formatSecondsUnit(safeSeconds)}.`
      : `Authorization temporarily blocked. Please try again in ${safeSeconds} ${formatSecondsUnit(safeSeconds)}.`;
  return res.status(429).json({
    error,
    code: 'RATE_LIMIT_ACTIVE',
    retryAfterSeconds: safeSeconds,
    cooldownActivated: false,
  });
}

function sendRateLimitedFailureResponse(
  res: Response,
  limiter: AuthRateLimiter,
  clientIp: string,
  statusCode: number,
  failureMessage: string,
  scope: 'login' | 'change-admin-code'
) {
  const outcome = limiter.recordFailure(clientIp);
  if (outcome.cooldownActivated) {
    res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
    const error =
      scope === 'login'
        ? 'Too many failed login attempts. Please wait 30 seconds before trying again.'
        : 'Too many failed authorization attempts. Please wait 30 seconds before trying again.';
    return res.status(429).json({
      error,
      code: 'RATE_LIMIT_COOLDOWN_ACTIVATED',
      retryAfterSeconds: outcome.retryAfterSeconds,
      cooldownActivated: true,
    });
  }
  return res.status(statusCode).json({ error: failureMessage });
}

function tryAcquireIpConnectionSlot(clientIp: string): ConnectionIpTracking | null {
  const current = ipConnections.get(clientIp) || { total: 0, unauth: 0 };
  if (
    current.total >= WS_MAX_CONNECTIONS_PER_IP ||
    current.unauth >= WS_MAX_UNAUTH_CONNECTIONS_PER_IP
  ) {
    return null;
  }
  current.total += 1;
  current.unauth += 1;
  ipConnections.set(clientIp, current);
  return {
    clientIp,
    countsAsUnauth: true,
    ipReleased: false,
    handedOffToWs: false,
  };
}

function releaseUnauthSlot(tracking: ConnectionIpTracking) {
  if (tracking.ipReleased || !tracking.countsAsUnauth) {
    return;
  }
  tracking.countsAsUnauth = false;
  const entry = ipConnections.get(tracking.clientIp);
  if (!entry) return;
  entry.unauth = Math.max(0, entry.unauth - 1);
  if (entry.total === 0 && entry.unauth === 0) {
    ipConnections.delete(tracking.clientIp);
  }
}

function releaseConnectionSlot(tracking: ConnectionIpTracking) {
  if (tracking.ipReleased) {
    return;
  }
  tracking.ipReleased = true;
  const wasUnauth = tracking.countsAsUnauth;
  tracking.countsAsUnauth = false;
  const entry = ipConnections.get(tracking.clientIp);
  if (!entry) return;
  entry.total = Math.max(0, entry.total - 1);
  if (wasUnauth) {
    entry.unauth = Math.max(0, entry.unauth - 1);
  }
  if (entry.total === 0 && entry.unauth === 0) {
    ipConnections.delete(tracking.clientIp);
  }
}

function createSession(role: 'admin' | 'participant', team?: Team): SessionRecord {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const record: SessionRecord = {
    token,
    role,
    teamCode: team?.code,
    teamId: team?.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(token, record);
  return record;
}

function validateSession(token: unknown): SessionRecord | null {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function parseAllowedOrigins(): Set<string> {
  const raw = process.env.WS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '';
  const set = new Set<string>();
  const isProd = process.env.NODE_ENV === 'production';
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (trimmed !== parsed.origin || parsed.username || parsed.password) {
        continue;
      }
      if (parsed.protocol !== 'https:' && (isProd || parsed.protocol !== 'http:')) {
        continue;
      }
      set.add(parsed.origin);
    } catch {
      // ignore invalid origin entries
    }
  }
  return set;
}

const LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://0.0.0.0:3000',
  'https://localhost:3000',
  'https://127.0.0.1:3000',
]);

function isLoopbackIp(rawIp: string | undefined | null): boolean {
  const normalized = normalizeIp(rawIp);
  return normalized === '127.0.0.1' || normalized === '::1';
}

function getConfiguredAppOrigin(isProd: boolean): string | null {
  const rawAppUrl = (process.env.APP_URL || '').trim();
  if (!rawAppUrl) return null;
  try {
    const parsed = new URL(rawAppUrl);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol !== 'https:' && (isProd || parsed.protocol !== 'http:')) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function stripDefaultPortForProtocol(host: string, protocol: string): string {
  const lower = host.toLowerCase();
  if (protocol === 'https:' && lower.endsWith(':443')) {
    return lower.slice(0, -4);
  }
  if (protocol === 'http:' && lower.endsWith(':80')) {
    return lower.slice(0, -3);
  }
  return lower;
}

function isOriginAllowed(req: IncomingMessage): boolean {
  const originHeader = req.headers.origin;
  if (!originHeader || typeof originHeader !== 'string') {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }

  // Reject malformed origins with paths, query strings, fragments, or userinfo
  if (originHeader !== parsed.origin || parsed.username || parsed.password) {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const isProd = process.env.NODE_ENV === 'production';

  // In production, enforce HTTPS BEFORE checking any allowlist or host match
  if (isProd && parsed.protocol !== 'https:') {
    return false;
  }

  const normalizedOrigin = parsed.origin;
  const rawAllowlist = (process.env.WS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '').trim();
  const explicitAllowedOrigins = parseAllowedOrigins();

  if (rawAllowlist.length > 0) {
    if (explicitAllowedOrigins.has(normalizedOrigin)) {
      return true;
    }
    if (!isProd && LOCAL_DEV_ORIGINS.has(normalizedOrigin)) {
      return true;
    }
    return false;
  }

  if (!isProd && LOCAL_DEV_ORIGINS.has(normalizedOrigin)) {
    return true;
  }

  const appOrigin = getConfiguredAppOrigin(isProd);
  if (appOrigin && normalizedOrigin === appOrigin) {
    return true;
  }

  const trustProxy = isTrustProxyEnabled() || isLoopbackIp(req.socket?.remoteAddress);
  const forwardedHost = trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const rawHostHeader = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host;

  if (!rawHostHeader || typeof rawHostHeader !== 'string') {
    return false;
  }

  const requestHost = stripDefaultPortForProtocol(
    rawHostHeader.split(',')[0].trim(),
    parsed.protocol
  );
  if (!requestHost || parsed.host.toLowerCase() !== requestHost) {
    return false;
  }

  if (trustProxy) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protoStr = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (
      protoStr &&
      protoStr.split(',')[0].trim().toLowerCase() === 'https' &&
      parsed.protocol !== 'https:'
    ) {
      return false;
    }
  }

  return true;
}

function hasOnlyAllowedKeys(obj: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      return false;
    }
  }
  return true;
}

function findTeamByIdentifier(identifier: string): Team | undefined {
  const match = identifier.trim().toLowerCase();
  if (!match) return undefined;
  return db
    .getState()
    .teams.find(
      (t) =>
        t.id.toLowerCase() === match ||
        t.code.toLowerCase() === match ||
        (t.name && t.name.trim().toLowerCase() === match)
    );
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore send failures on closing sockets
  }
}

function cleanupSocket(ws: WebSocket, meta: ClientMeta) {
  if (meta.authTimer) {
    clearTimeout(meta.authTimer);
    meta.authTimer = null;
  }
  meta.authenticated = false;
  meta.sessionToken = null;
  meta.role = null;
  meta.teamCode = null;
  releaseConnectionSlot(meta.ipTracking);
  try {
    ws.terminate();
  } catch {
    // ignore
  }
}

function revokeSocketSession(ws: WebSocket, meta: ClientMeta, reason: string) {
  if (meta.authTimer) {
    clearTimeout(meta.authTimer);
    meta.authTimer = null;
  }
  meta.authenticated = false;
  meta.sessionToken = null;
  meta.role = null;
  meta.teamCode = null;
  sendJson(ws, { type: 'AUTH_ERROR', message: reason });
  try {
    ws.close(4001, reason);
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        cleanupSocket(ws, meta);
      }
    }, 1000).unref();
  } catch {
    cleanupSocket(ws, meta);
  }
}

const ADMIN_COMMANDS = new Set([
  'START_BID',
  'END_BIDDING',
  'CLOSE_BID_MODAL',
  'CLEAR_DATABASE',
  'UPDATE_TEAM_NAME',
  'UPDATE_TEAM_CODE',
  'UPDATE_TEAM_PURSE',
  'UPDATE_ALL_PURSES',
  'REAUCTION_PLAYER',
  'EXTEND_TIMER',
]);

// --- SERVER SETUP ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    pathname = '';
  }

  // Only handle application WebSocket upgrades on /ws; leave other paths (e.g. Vite HMR /__vite_hmr) untouched in dev
  if (pathname !== '/ws') {
    if (process.env.NODE_ENV === 'production') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
    return;
  }

  if (!isOriginAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const clientIp = getClientIp(req);
  const tracking = tryAcquireIpConnectionSlot(clientIp);
  if (!tracking) {
    socket.write(
      'HTTP/1.1 429 Too Many Requests\r\nContent-Type: text/plain\r\nConnection: close\r\nRetry-After: 5\r\n\r\nToo many WebSocket connections from this IP.\r\n'
    );
    socket.destroy();
    return;
  }

  pendingUpgradeTickets.set(req, tracking);
  const releasePendingIfNotHandedOff = () => {
    if (!tracking.handedOffToWs) {
      pendingUpgradeTickets.delete(req);
      releaseConnectionSlot(tracking);
    }
  };
  socket.once('close', releasePendingIfNotHandedOff);
  socket.once('error', releasePendingIfNotHandedOff);

  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.off('close', releasePendingIfNotHandedOff);
    socket.off('error', releasePendingIfNotHandedOff);
    if (tracking.ipReleased || socket.destroyed) {
      pendingUpgradeTickets.delete(req);
      releaseConnectionSlot(tracking);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      return;
    }
    tracking.handedOffToWs = true;
    wss.emit('connection', ws, req);
  });
});

wss.on('error', (err) => {
  console.error('WebSocketServer error:', err);
});

app.disable('x-powered-by');

// Enforce active cooldown BEFORE parsing JSON bodies so malformed payloads cannot bypass rate limiting
app.post('/api/auth/login', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  const cooldown = loginRateLimiter.check(getClientIp(req));
  if (cooldown.blocked) {
    return sendCooldownBlockedResponse(res, cooldown.retryAfterSeconds, 'login');
  }
  return next();
});

app.post('/api/auth/change-admin-code', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  const cooldown = adminCodeChangeRateLimiter.check(getClientIp(req));
  if (cooldown.blocked) {
    return sendCooldownBlockedResponse(res, cooldown.retryAfterSeconds, 'change-admin-code');
  }
  return next();
});

app.use('/api', express.json({ limit: '16kb', strict: true }));

// Catch malformed JSON / oversized JSON payloads before route handlers without leaking stack traces
app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  const status = err.type === 'entity.too.large' ? 413 : 400;
  const message =
    err.type === 'entity.parse.failed' || err instanceof SyntaxError
      ? 'Malformed JSON request body.'
      : err.type === 'entity.too.large'
      ? 'Request payload too large.'
      : 'Invalid request.';

  if (req.method === 'POST' && req.path === '/auth/login') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      getClientIp(req),
      status,
      message,
      'login'
    );
  }
  if (req.method === 'POST' && req.path === '/auth/change-admin-code') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      getClientIp(req),
      status,
      message,
      'change-admin-code'
    );
  }
  return res.status(status).json({ error: message });
});

// Serve local player photos (works in dev and production, on any domain)
app.use(
  '/players',
  express.static(path.join(__dirname, 'public', 'players'), {
    maxAge: '7d',
    dotfiles: 'ignore',
  })
);

function invalidateAllAdminSessions(
  reason: string = 'Admin code was changed. Please log in again.'
) {
  for (const [token, session] of sessions.entries()) {
    if (session.role === 'admin') {
      sessions.delete(token);
    }
  }
  wss.clients.forEach((client) => {
    const meta = clientMetaMap.get(client);
    if (meta && meta.authenticated && meta.role === 'admin') {
      revokeSocketSession(client, meta, reason);
    }
  });
}

// Broadcast helper for authenticated WebSockets only
function broadcast(payload: any) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const meta = clientMetaMap.get(client);
    if (!meta || !meta.authenticated || !meta.sessionToken) return;
    if (!validateSession(meta.sessionToken)) {
      revokeSocketSession(client, meta, 'Session expired. Please log in again.');
      return;
    }
    try {
      client.send(data, (err) => {
        if (err) {
          cleanupSocket(client, meta);
        }
      });
    } catch {
      cleanupSocket(client, meta);
    }
  });
}

// Heartbeat & Expired Session Cleanup Loop
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }

  wss.clients.forEach((client) => {
    const meta = clientMetaMap.get(client);
    if (!meta) return;

    if (meta.authenticated && meta.sessionToken && !validateSession(meta.sessionToken)) {
      revokeSocketSession(client, meta, 'Session expired. Please log in again.');
      return;
    }

    if (!meta.isAlive) {
      cleanupSocket(client, meta);
      return;
    }

    meta.isAlive = false;
    try {
      client.ping();
    } catch {
      cleanupSocket(client, meta);
    }
  });
}, HEARTBEAT_INTERVAL_MS);

// Timer Loop (runs on server every second)
const auctionTimerInterval = setInterval(() => {
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

function clearServerIntervals() {
  clearInterval(heartbeatInterval);
  clearInterval(auctionTimerInterval);
  clearInterval(authLimiterCleanupInterval);
  loginRateLimiter.clear();
  adminCodeChangeRateLimiter.clear();
  wss.clients.forEach((client) => {
    const meta = clientMetaMap.get(client);
    if (meta) {
      cleanupSocket(client, meta);
    }
  });
  ipConnections.clear();
}

wss.on('close', clearServerIntervals);
server.on('close', clearServerIntervals);

// WebSocket Connections (authenticated handshake required before state or commands)
wss.on('connection', (ws, req) => {
  const existingTicket = req ? pendingUpgradeTickets.get(req) : undefined;
  if (req) {
    pendingUpgradeTickets.delete(req);
  }
  const ipTracking: ConnectionIpTracking = existingTicket || {
    clientIp: getClientIp(req),
    countsAsUnauth: true,
    ipReleased: false,
    handedOffToWs: true,
  };

  const meta: ClientMeta = {
    authenticated: false,
    sessionToken: null,
    role: null,
    teamCode: null,
    isAlive: true,
    msgTimestamps: [],
    rateLimitWarnedAt: 0,
    invalidAttempts: 0,
    authTimer: setTimeout(() => {
      if (!meta.authenticated) {
        revokeSocketSession(ws, meta, 'Authentication timeout. Please log in again.');
      }
    }, AUTH_HANDSHAKE_TIMEOUT_MS),
    ipTracking,
  };
  clientMetaMap.set(ws, meta);

  ws.on('pong', () => {
    meta.isAlive = true;
  });

  ws.on('close', () => {
    if (meta.authTimer) {
      clearTimeout(meta.authTimer);
      meta.authTimer = null;
    }
    meta.authenticated = false;
    meta.sessionToken = null;
    meta.role = null;
    meta.teamCode = null;
    releaseConnectionSlot(meta.ipTracking);
  });

  ws.on('error', () => {
    cleanupSocket(ws, meta);
  });

  ws.on('message', (message, isBinary) => {
    try {
      if (isBinary) {
        sendJson(ws, { type: 'ERROR', message: 'Binary messages are not supported.' });
        if (!meta.authenticated) {
          meta.invalidAttempts += 1;
          if (meta.invalidAttempts >= 3) {
            ws.close(4001, 'Authentication required');
          }
        }
        return;
      }

      // Per-connection sliding window rate limiting
      const now = Date.now();
      meta.msgTimestamps = meta.msgTimestamps.filter(
        (ts) => now - ts < RATE_LIMIT_WINDOW_MS
      );
      if (meta.msgTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
        if (now - meta.rateLimitWarnedAt > 1000) {
          meta.rateLimitWarnedAt = now;
          sendJson(ws, { type: 'ERROR', message: 'Rate limit exceeded. Please slow down.' });
        }
        if (meta.msgTimestamps.length >= RATE_LIMIT_MAX_MESSAGES * 2) {
          ws.close(1008, 'Rate limit exceeded');
        }
        meta.msgTimestamps.push(now);
        return;
      }
      meta.msgTimestamps.push(now);

      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(message.toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sendJson(ws, { type: 'ERROR', message: 'Malformed message payload.' });
          if (!meta.authenticated) {
            meta.invalidAttempts += 1;
            if (meta.invalidAttempts >= 3) ws.close(4001, 'Authentication required');
          }
          return;
        }
        data = parsed as Record<string, unknown>;
      } catch {
        sendJson(ws, { type: 'ERROR', message: 'Invalid JSON payload.' });
        if (!meta.authenticated) {
          meta.invalidAttempts += 1;
          if (meta.invalidAttempts >= 3) ws.close(4001, 'Authentication required');
        }
        return;
      }

      if (typeof data.type !== 'string' || !data.type || data.type.length > 64) {
        sendJson(ws, { type: 'ERROR', message: 'Invalid or missing message type.' });
        if (!meta.authenticated) {
          meta.invalidAttempts += 1;
          if (meta.invalidAttempts >= 3) ws.close(4001, 'Authentication required');
        }
        return;
      }

      // 1. Authentication Handshake
      if (data.type === 'AUTH') {
        if (!hasOnlyAllowedKeys(data, ['type', 'token'])) {
          sendJson(ws, { type: 'AUTH_ERROR', message: 'Unexpected fields in AUTH payload.' });
          return;
        }
        if (meta.authenticated) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Connection is already authenticated. Open a new connection to change sessions.',
          });
          return;
        }

        const session = validateSession(data.token);
        if (!session) {
          meta.authenticated = false;
          meta.sessionToken = null;
          meta.role = null;
          meta.teamCode = null;
          meta.invalidAttempts += 1;
          sendJson(ws, {
            type: 'AUTH_ERROR',
            message: 'Invalid or expired session token. Please log in again.',
          });
          if (meta.invalidAttempts >= 3) {
            ws.close(4003, 'Authentication failed');
          }
          return;
        }

        if (meta.authTimer) {
          clearTimeout(meta.authTimer);
          meta.authTimer = null;
        }
        meta.authenticated = true;
        meta.sessionToken = session.token;
        meta.role = session.role;
        meta.teamCode = session.teamCode || null;
        meta.invalidAttempts = 0;
        releaseUnauthSlot(meta.ipTracking);

        sendJson(ws, {
          type: 'AUTH_OK',
          role: session.role,
          selectedTeam: session.teamCode,
        });
        sendJson(ws, {
          type: 'INIT_STATE',
          state: publicState(),
        });
        return;
      }

      // 2. Reject any unauthenticated connection commands
      if (!meta.authenticated || !meta.sessionToken) {
        meta.invalidAttempts += 1;
        sendJson(ws, { type: 'ERROR', message: 'Authentication required.' });
        if (meta.invalidAttempts >= 3) {
          ws.close(4001, 'Authentication required');
        }
        return;
      }

      const session = validateSession(meta.sessionToken);
      if (!session || session.role !== meta.role || (session.teamCode || null) !== meta.teamCode) {
        revokeSocketSession(ws, meta, 'Session expired. Please log in again.');
        return;
      }

      if (data.type === 'LOGOUT') {
        if (!hasOnlyAllowedKeys(data, ['type'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in LOGOUT payload.' });
          return;
        }
        sessions.delete(session.token);
        meta.authenticated = false;
        meta.sessionToken = null;
        meta.role = null;
        meta.teamCode = null;
        ws.close(1000, 'Logged out');
        return;
      }

      // 3. Enforce Role-Based Authorization
      if (ADMIN_COMMANDS.has(data.type) && session.role !== 'admin') {
        sendJson(ws, { type: 'ERROR', message: 'Unauthorized: Admin privileges required.' });
        return;
      }

      // 4. Validate Payload Schemas & Execute Authorized Commands
      if (data.type === 'PLACE_BID') {
        if (!hasOnlyAllowedKeys(data, ['type', 'teamCode', 'amount'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in PLACE_BID payload.' });
          return;
        }
        if (session.role !== 'participant' || !session.teamCode) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Only authenticated team participants can place bids.',
          });
          return;
        }
        if (data.teamCode !== undefined) {
          if (
            typeof data.teamCode !== 'string' ||
            data.teamCode.trim().toLowerCase() !== session.teamCode.toLowerCase()
          ) {
            sendJson(ws, {
              type: 'ERROR',
              message: 'Unauthorized: Cannot bid on behalf of another team.',
            });
            return;
          }
        }
        if (
          typeof data.amount !== 'number' ||
          !Number.isFinite(data.amount) ||
          data.amount <= 0 ||
          data.amount > MAX_PURSE_AMOUNT
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid bid amount.' });
          return;
        }

        const result = db.placeBid(session.teamCode, data.amount);
        broadcast({
          type: 'BID_PLACED',
          auction: result.auction,
          state: publicState(),
          message: `${session.teamCode} placed a bid of ${data.amount} M$!`,
        });
      } else if (data.type === 'START_BID') {
        if (!hasOnlyAllowedKeys(data, ['type', 'playerId', 'durationSeconds', 'biddingType'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in START_BID payload.' });
          return;
        }
        if (
          typeof data.playerId !== 'number' ||
          !Number.isInteger(data.playerId) ||
          data.playerId <= 0
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid playerId.' });
          return;
        }
        const targetPlayer = db
          .getState()
          .players.find((p) => p.id === data.playerId && p.type === 'Auction');
        if (!targetPlayer) {
          sendJson(ws, { type: 'ERROR', message: 'Auction player not found.' });
          return;
        }
        if (
          data.durationSeconds !== undefined &&
          (typeof data.durationSeconds !== 'number' ||
            !Number.isInteger(data.durationSeconds) ||
            !ALLOWED_AUCTION_DURATIONS.has(data.durationSeconds))
        ) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Invalid durationSeconds. Allowed values: 30, 60, 90, 120.',
          });
          return;
        }
        if (
          data.biddingType !== undefined &&
          data.biddingType !== 'online' &&
          data.biddingType !== 'offline'
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid biddingType.' });
          return;
        }

        const mode = data.biddingType === 'offline' ? 'offline' : 'online';
        const auction = db.startBid(
          targetPlayer.id,
          data.durationSeconds !== undefined ? data.durationSeconds : 30,
          mode
        );
        broadcast({
          type: 'AUCTION_STARTED',
          auction,
          state: publicState(),
        });
      } else if (data.type === 'END_BIDDING') {
        if (!hasOnlyAllowedKeys(data, ['type', 'teamId', 'amount'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in END_BIDDING payload.' });
          return;
        }

        const hasTeamId = data.teamId !== undefined;
        const hasAmount = data.amount !== undefined;
        if (hasTeamId !== hasAmount) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Both teamId and amount must be provided together when awarding offline.',
          });
          return;
        }

        let offlineAward: { teamId: string; amount: number } | undefined;
        if (hasTeamId && hasAmount) {
          if (
            typeof data.teamId !== 'string' ||
            !data.teamId.trim() ||
            data.teamId.length > 64
          ) {
            sendJson(ws, { type: 'ERROR', message: 'Invalid teamId.' });
            return;
          }
          const matchedTeam = findTeamByIdentifier(data.teamId);
          if (!matchedTeam) {
            sendJson(ws, { type: 'ERROR', message: 'Selected team not found.' });
            return;
          }
          if (
            typeof data.amount !== 'number' ||
            !Number.isFinite(data.amount) ||
            data.amount <= 0 ||
            data.amount > MAX_PURSE_AMOUNT
          ) {
            sendJson(ws, { type: 'ERROR', message: 'Invalid offline award amount.' });
            return;
          }
          offlineAward = { teamId: matchedTeam.id, amount: data.amount };
        }

        const result = db.endBidding(offlineAward);
        broadcast({
          type: 'AUCTION_RESOLVED',
          status: result?.auction.status || 'unsold',
          result,
          state: publicState(),
        });
      } else if (data.type === 'CLOSE_BID_MODAL') {
        if (!hasOnlyAllowedKeys(data, ['type'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in CLOSE_BID_MODAL payload.' });
          return;
        }
        db.closeBiddingModal();
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'CLEAR_DATABASE') {
        if (!hasOnlyAllowedKeys(data, ['type'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in CLEAR_DATABASE payload.' });
          return;
        }
        db.clearDatabase();
        broadcast({
          type: 'DATABASE_CLEARED',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_NAME') {
        if (!hasOnlyAllowedKeys(data, ['type', 'teamId', 'name'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in UPDATE_TEAM_NAME payload.' });
          return;
        }
        if (
          typeof data.teamId !== 'string' ||
          !data.teamId.trim() ||
          data.teamId.length > 64 ||
          typeof data.name !== 'string' ||
          data.name.length > 64 ||
          /[\x00-\x1F\x7F]/.test(data.name)
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid team name payload.' });
          return;
        }
        const matchedTeam = findTeamByIdentifier(data.teamId);
        if (!matchedTeam) {
          sendJson(ws, { type: 'ERROR', message: 'Team not found.' });
          return;
        }
        db.updateTeamName(matchedTeam.id, data.name);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_CODE') {
        if (!hasOnlyAllowedKeys(data, ['type', 'teamId', 'code'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in UPDATE_TEAM_CODE payload.' });
          return;
        }
        if (
          typeof data.teamId !== 'string' ||
          !data.teamId.trim() ||
          data.teamId.length > 64 ||
          typeof data.code !== 'string'
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid team code payload.' });
          return;
        }
        const trimmedCode = data.code.trim().toUpperCase();
        if (
          trimmedCode.length < 2 ||
          trimmedCode.length > 32 ||
          /[\x00-\x1F\x7F\s]/.test(trimmedCode)
        ) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Team code must be 2-32 non-whitespace characters.',
          });
          return;
        }
        const matchedTeam = findTeamByIdentifier(data.teamId);
        if (!matchedTeam) {
          sendJson(ws, { type: 'ERROR', message: 'Team not found.' });
          return;
        }
        const duplicateTeam = db
          .getState()
          .teams.find(
            (t) =>
              t.id !== matchedTeam.id &&
              t.loginCode &&
              t.loginCode.trim().toUpperCase() === trimmedCode
          );
        if (duplicateTeam) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Team login code is already assigned to another team.',
          });
          return;
        }
        db.updateTeamCode(matchedTeam.id, trimmedCode);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_TEAM_PURSE') {
        if (!hasOnlyAllowedKeys(data, ['type', 'teamId', 'newPurse'])) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Unexpected fields in UPDATE_TEAM_PURSE payload.',
          });
          return;
        }
        if (
          typeof data.teamId !== 'string' ||
          !data.teamId.trim() ||
          data.teamId.length > 64 ||
          typeof data.newPurse !== 'number' ||
          !Number.isFinite(data.newPurse) ||
          data.newPurse < 0 ||
          data.newPurse > MAX_PURSE_AMOUNT
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid team purse payload.' });
          return;
        }
        const matchedTeam = findTeamByIdentifier(data.teamId);
        if (!matchedTeam) {
          sendJson(ws, { type: 'ERROR', message: 'Team not found.' });
          return;
        }
        db.updateTeamPurse(matchedTeam.id, data.newPurse);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'UPDATE_ALL_PURSES') {
        if (!hasOnlyAllowedKeys(data, ['type', 'newPurse'])) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Unexpected fields in UPDATE_ALL_PURSES payload.',
          });
          return;
        }
        if (
          typeof data.newPurse !== 'number' ||
          !Number.isFinite(data.newPurse) ||
          data.newPurse < 0 ||
          data.newPurse > MAX_PURSE_AMOUNT
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid universal purse payload.' });
          return;
        }
        db.updateAllTeamsPurse(data.newPurse);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'REAUCTION_PLAYER') {
        if (!hasOnlyAllowedKeys(data, ['type', 'playerId'])) {
          sendJson(ws, {
            type: 'ERROR',
            message: 'Unexpected fields in REAUCTION_PLAYER payload.',
          });
          return;
        }
        if (
          typeof data.playerId !== 'number' ||
          !Number.isInteger(data.playerId) ||
          data.playerId <= 0
        ) {
          sendJson(ws, { type: 'ERROR', message: 'Invalid playerId.' });
          return;
        }
        const targetPlayer = db
          .getState()
          .players.find((p) => p.id === data.playerId && p.type === 'Auction');
        if (!targetPlayer) {
          sendJson(ws, { type: 'ERROR', message: 'Auction player not found.' });
          return;
        }
        db.reAuctionPlayer(targetPlayer.id);
        broadcast({
          type: 'STATE_UPDATE',
          state: publicState(),
        });
      } else if (data.type === 'EXTEND_TIMER') {
        if (!hasOnlyAllowedKeys(data, ['type'])) {
          sendJson(ws, { type: 'ERROR', message: 'Unexpected fields in EXTEND_TIMER payload.' });
          return;
        }
        const timerSeconds = db.extendTimer(30);
        broadcast({
          type: 'TIMER_TICK',
          timerSeconds,
        });
      } else {
        sendJson(ws, { type: 'ERROR', message: 'Unsupported message type.' });
      }
    } catch (err: any) {
      sendJson(ws, {
        type: 'ERROR',
        message: err.message || 'Operation failed',
      });
    }
  });
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function timingSafeCodeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function requireAdminSession(req: Request, res: Response): SessionRecord | null {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (match && match[1].length <= 256) {
      token = match[1];
    }
  }
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  const session = validateSession(token);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return null;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Unauthorized: Admin privileges required.' });
    return null;
  }
  return session;
}

// REST API Endpoints
app.get('/api/state', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicState());
});

app.get('/api/admin/team-codes', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  if (!requireAdminSession(req, res)) {
    return;
  }

  const teamCodes = db.getState().teams.map((t) => ({
    id: t.id,
    code: t.code,
    loginCode: t.loginCode || '',
  }));
  return res.json({ teamCodes });
});

app.post('/api/admin/team-codes', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  if (!requireAdminSession(req, res)) {
    return;
  }

  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json.' });
  }

  if (!isPlainObject(req.body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }

  if (!hasOnlyAllowedKeys(req.body, ['teamId', 'code'])) {
    return res.status(400).json({ error: 'Unexpected fields in team code request.' });
  }

  const { teamId, code } = req.body;
  if (typeof teamId !== 'string' || !teamId.trim() || teamId.length > 64 || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid team code payload.' });
  }

  const trimmedCode = code.trim().toUpperCase();
  if (trimmedCode.length < 2 || trimmedCode.length > 32 || /[\x00-\x1F\x7F\s]/.test(trimmedCode)) {
    return res.status(400).json({
      error: 'Team code must be 2-32 non-whitespace characters.',
    });
  }

  const matchedTeam = findTeamByIdentifier(teamId);
  if (!matchedTeam) {
    return res.status(404).json({ error: 'Team not found.' });
  }

  const duplicateTeam = db
    .getState()
    .teams.find(
      (t) =>
        t.id !== matchedTeam.id &&
        t.loginCode &&
        t.loginCode.trim().toUpperCase() === trimmedCode
    );
  if (duplicateTeam) {
    return res.status(409).json({
      error: 'Team login code is already assigned to another team.',
    });
  }

  db.updateTeamCode(matchedTeam.id, trimmedCode);
  return res.json({
    ok: true,
    teamId: matchedTeam.id,
    loginCode: trimmedCode,
  });
});

app.post('/api/auth/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const clientIp = getClientIp(req);
  const cooldown = loginRateLimiter.check(clientIp);
  if (cooldown.blocked) {
    return sendCooldownBlockedResponse(res, cooldown.retryAfterSeconds, 'login');
  }

  if (!req.is('application/json')) {
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      415,
      'Content-Type must be application/json.',
      'login'
    );
  }

  if (!isPlainObject(req.body)) {
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      400,
      'Request body must be a JSON object.',
      'login'
    );
  }

  if (!hasOnlyAllowedKeys(req.body, ['teamCode', 'adminCode'])) {
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      400,
      'Unexpected fields in login request.',
      'login'
    );
  }

  const { teamCode, adminCode } = req.body;
  if (adminCode !== undefined && teamCode !== undefined) {
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      400,
      'Provide either teamCode or adminCode, not both.',
      'login'
    );
  }

  const config = db.getState().config;
  const dbStatus = db.getDatabaseStatus();

  if (adminCode !== undefined) {
    if (typeof adminCode !== 'string' || adminCode.length > 64) {
      return sendRateLimitedFailureResponse(
        res,
        loginRateLimiter,
        clientIp,
        400,
        'Invalid Admin Code format.',
        'login'
      );
    }
    const cleaned = adminCode.trim().toUpperCase();
    if (!cleaned) {
      return sendRateLimitedFailureResponse(
        res,
        loginRateLimiter,
        clientIp,
        400,
        'Invalid Admin Code format.',
        'login'
      );
    }
    if (!db.isAdminAuthReady()) {
      return res.status(503).json({
        error:
          'Admin login is unavailable because the persistent database is missing, corrupted, or lacks a valid admin code hash. Run explicit initialization or recovery.',
        code: 'ADMIN_DB_UNAVAILABLE',
      });
    }
    if (verifyAdminCodeHash(cleaned, config.adminCodeHash)) {
      loginRateLimiter.reset(clientIp);
      const session = createSession('admin');
      return res.json({
        role: 'admin',
        gameCode: config.gameCode,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      });
    }
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      401,
      'Invalid Admin Code. Access denied.',
      'login'
    );
  }

  if (teamCode !== undefined) {
    if (typeof teamCode !== 'string' || teamCode.length > 64) {
      return sendRateLimitedFailureResponse(
        res,
        loginRateLimiter,
        clientIp,
        400,
        'Invalid Team Code format.',
        'login'
      );
    }
    const code = teamCode.trim().toUpperCase();
    if (!code) {
      return sendRateLimitedFailureResponse(
        res,
        loginRateLimiter,
        clientIp,
        400,
        'Invalid Team Code format.',
        'login'
      );
    }
    if (!db.isDatabaseIntact()) {
      return res.status(503).json({
        error:
          dbStatus.status === 'corrupt'
            ? 'Login is unavailable because the persistent database is corrupted.'
            : 'Login is unavailable because the persistent database has not been initialized.',
        code: 'DB_UNAVAILABLE',
      });
    }
    const matchedTeam = db
      .getState()
      .teams.find((t) => t.loginCode && t.loginCode.trim().toUpperCase() === code);
    if (matchedTeam) {
      loginRateLimiter.reset(clientIp);
      const session = createSession('participant', matchedTeam);
      return res.json({
        role: 'participant',
        selectedTeam: matchedTeam.code,
        gameCode: config.gameCode,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      });
    }
    return sendRateLimitedFailureResponse(
      res,
      loginRateLimiter,
      clientIp,
      401,
      'Invalid Team Code. Please check and try again.',
      'login'
    );
  }

  return sendRateLimitedFailureResponse(
    res,
    loginRateLimiter,
    clientIp,
    400,
    'Please enter a valid Team Code or Admin Code.',
    'login'
  );
});

app.post('/api/auth/change-admin-code', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const clientIp = getClientIp(req);
  const cooldown = adminCodeChangeRateLimiter.check(clientIp);
  if (cooldown.blocked) {
    return sendCooldownBlockedResponse(res, cooldown.retryAfterSeconds, 'change-admin-code');
  }

  if (!req.is('application/json')) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      415,
      'Content-Type must be application/json.',
      'change-admin-code'
    );
  }

  if (!isPlainObject(req.body)) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      400,
      'Request body must be a JSON object.',
      'change-admin-code'
    );
  }

  if (!hasOnlyAllowedKeys(req.body, ['password', 'newAdminCode'])) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      400,
      'Unexpected fields in request.',
      'change-admin-code'
    );
  }

  const expectedPassword = getAdminCodeChangePassword();
  if (!expectedPassword) {
    return res.status(503).json({
      error: 'Admin code change is currently unavailable because server authorization is not configured.',
    });
  }

  const { password, newAdminCode } = req.body;

  if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      400,
      'Please enter a valid authorization password.',
      'change-admin-code'
    );
  }

  if (typeof newAdminCode !== 'string' || newAdminCode.length > 64) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      400,
      'New Admin Code must be 4-64 non-whitespace characters.',
      'change-admin-code'
    );
  }

  const normalizedNewCode = newAdminCode.trim().toUpperCase();
  if (
    normalizedNewCode.length < 4 ||
    normalizedNewCode.length > 64 ||
    /[\x00-\x1F\x7F\s]/.test(normalizedNewCode)
  ) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      400,
      'New Admin Code must be 4-64 characters with no spaces or control characters.',
      'change-admin-code'
    );
  }

  if (!timingSafeCodeEqual(password, expectedPassword)) {
    return sendRateLimitedFailureResponse(
      res,
      adminCodeChangeRateLimiter,
      clientIp,
      401,
      'Incorrect password. Admin code was not changed.',
      'change-admin-code'
    );
  }

  if (!db.isDatabaseIntact()) {
    return res.status(503).json({
      error:
        'Admin code cannot be updated because the persistent database is missing or corrupted. Run explicit initialization or recovery first.',
      code: 'DB_UNAVAILABLE',
    });
  }

  adminCodeChangeRateLimiter.reset(clientIp);
  try {
    db.updateAdminCode(normalizedNewCode);
  } catch (err) {
    console.error('Failed to persist updated admin code:', err);
    return res.status(500).json({
      error: 'Failed to persist updated admin code to database.',
    });
  }
  invalidateAllAdminSessions('Admin code was changed. Please log in again.');
  return res.json({
    ok: true,
    message: 'Admin code updated successfully. Please log in with your new Admin Code.',
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const authHeader = req.headers.authorization;
  let bearerToken: string | null = null;
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (match && match[1].length <= 256) {
      bearerToken = match[1];
    }
  }

  let bodyToken: string | null = null;
  const contentType = req.headers['content-type'];
  if (req.body !== undefined) {
    // express.json leaves req.body as {} only when JSON {} was parsed or untouched
    if (contentType && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json.' });
    }
    if (!isPlainObject(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }
    if (!hasOnlyAllowedKeys(req.body, ['sessionToken'])) {
      return res.status(400).json({ error: 'Unexpected fields in logout request.' });
    }
    if (req.body.sessionToken !== undefined) {
      if (
        typeof req.body.sessionToken !== 'string' ||
        req.body.sessionToken.trim().length === 0 ||
        req.body.sessionToken.length > 256
      ) {
        return res.status(400).json({ error: 'Invalid sessionToken format.' });
      }
      bodyToken = req.body.sessionToken.trim();
    }
  } else if (contentType && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json.' });
  }

  if (bearerToken && bodyToken && bearerToken !== bodyToken) {
    return res.status(400).json({ error: 'Conflicting session tokens in request.' });
  }

  const token = bearerToken || bodyToken;
  if (token && token.length >= 32 && token.length <= 256) {
    sessions.delete(token);
    wss.clients.forEach((client) => {
      const meta = clientMetaMap.get(client);
      if (meta && meta.sessionToken === token) {
        revokeSocketSession(client, meta, 'Logged out.');
      }
    });
  }
  return res.json({ ok: true });
});

// Return clean JSON 404 for unknown /api routes instead of falling through to SPA HTML
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Final fallback API error handler (prevents leaking stack traces or internals)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('Unhandled server error:', err);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
  return res.status(500).send('Internal server error.');
});

// Vite middleware in dev or static files in production
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: {
          server,
          path: '/__vite_hmr',
        },
      },
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
