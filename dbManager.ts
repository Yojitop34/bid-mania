import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type RuntimeEnvironment = 'local' | 'render' | 'hostinger';

export type DatabaseStatus =
  | 'ready'
  | 'missing'
  | 'corrupt'
  | 'missing_admin_hash'
  | 'storage_missing'
  | 'storage_not_directory'
  | 'storage_inaccessible'
  | 'file_locked';

export interface PlayerRecord {
  id: number;
  name: string;
  role: 'Batsman' | 'Bowler' | 'Allrounder' | 'Wicketkeeper';
  type: 'Starting' | 'Auction';
  teamId: string | null;
  valuePoints: number;
  basePrice: number;
  soldCost: number | null;
  isSold: boolean;
  lotNumber: number | null;
  lotName: string | null;
  imageUrl: string;
}

export interface TeamRecord {
  id: string;
  code: string;
  name: string;
  color: string;
  avatarBg: string;
  baseBudget: number;
  adjustedBudget: number;
  remainingBudget: number;
  totalSpent: number;
  totalValue: number;
  isQualified: boolean;
  loginCode?: string;
}

export interface BidHistoryRecord {
  id: string;
  playerId: number;
  teamCode: string;
  amount: number;
  timestamp: string;
}

export interface ActiveAuctionRecord {
  playerId: number | null;
  biddingType?: 'online' | 'offline';
  currentBid: number | null;
  currentTeam: string | null;
  timerSeconds: number;
  timerDuration: number;
  timerRunning: boolean;
  status: 'idle' | 'bidding' | 'sold' | 'unsold';
  bidHistory: BidHistoryRecord[];
  startedAt: string | null;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  timestamp: string;
  details: any;
}

export interface PersistedDatabaseState {
  config: {
    gameCode: string;
    adminCodeHash?: string;
    adminCode?: string;
  };
  universalPurse?: number;
  teams: TeamRecord[];
  players: PlayerRecord[];
  activeAuction: ActiveAuctionRecord;
  auditLogs: AuditLogRecord[];
}

export interface DatabaseMetadata {
  schemaVersion: number;
  dbFileName: string;
  environment: RuntimeEnvironment;
  createdAt: string;
  lastSavedAt: string;
  lastVerifiedAt: string;
  saveCount: number;
  checksumSha256: string;
  hasAdminCodeHash: boolean;
  recoveryCount: number;
  lastRecoveryReason: string | null;
}

export interface InitMarker {
  schemaVersion: number;
  dbFileName: string;
  environment: RuntimeEnvironment;
  createdAt: string;
  initMode: 'auto' | 'cli' | 'recovered' | 'salvaged' | 'existing_verified';
}

export interface ResolvedDatabasePaths {
  env: RuntimeEnvironment;
  dataDir: string;
  dbFile: string;
  bakFile: string;
  bakPrevFile: string;
  metaFile: string;
  markerFile: string;
  lockFile: string;
  explicitPathConfigured: boolean;
}

export interface DatabaseLoadResult<T extends PersistedDatabaseState = PersistedDatabaseState> {
  status: DatabaseStatus;
  persistenceEnabled: boolean;
  fatalStorageError: boolean;
  message: string;
  state: T | null;
  needsSave: boolean;
  source:
    | 'primary'
    | 'auto_initialized'
    | 'recovered_backup'
    | 'salvaged'
    | 'replaced_corrupt'
    | 'none';
  preservedCorruptFile: string | null;
}

export function getDefaultAdminCode(): string | null {
  const raw = process.env.ADMIN_DEFAULT_CODE;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function isValidAdminCodeFormat(normalizedCode: string): boolean {
  return (
    normalizedCode.length >= 4 &&
    normalizedCode.length <= 64 &&
    !/[\x00-\x1F\x7F\s]/.test(normalizedCode)
  );
}

export function hashAdminCode(normalizedCode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalizedCode, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function isValidAdminCodeHashFormat(storedHash: unknown): storedHash is string {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  return (
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[0-9a-f]{32}$/i.test(parts[1]) &&
    /^[0-9a-f]{128}$/i.test(parts[2])
  );
}

export function verifyAdminCodeHash(normalizedCode: string, storedHash: unknown): boolean {
  if (!isValidAdminCodeHashFormat(storedHash)) return false;
  const [, salt, hexHash] = storedHash.split(':');
  const expectedBuf = Buffer.from(hexHash, 'hex');
  const actualBuf = crypto.scryptSync(normalizedCode, salt, 64);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function isRenderEnvironment(): boolean {
  return (
    process.env.RENDER === 'true' ||
    process.env.RENDER === '1' ||
    Boolean(process.env.RENDER_SERVICE_ID)
  );
}

export function detectRuntimeEnvironment(): RuntimeEnvironment {
  if (isRenderEnvironment()) {
    return 'render';
  }
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.HOSTINGER === 'true' ||
    process.env.HOSTINGER === '1'
  ) {
    return 'hostinger';
  }
  return 'local';
}

export function resolveDatabasePaths(appRoot: string): ResolvedDatabasePaths {
  const env = detectRuntimeEnvironment();
  const rawDbPath = (process.env.DATABASE_PATH || process.env.DB_FILE_PATH || '').trim();
  const rawDataDir = (process.env.DATA_DIR || process.env.RENDER_DISK_PATH || '').trim();

  let dataDir: string;
  let dbFile: string;
  let explicitPathConfigured = false;

  if (rawDbPath) {
    dbFile = path.resolve(rawDbPath);
    dataDir = path.dirname(dbFile);
    explicitPathConfigured = true;
  } else if (rawDataDir) {
    dataDir = path.resolve(rawDataDir);
    dbFile = path.join(dataDir, 'auction_database.json');
    explicitPathConfigured = true;
  } else {
    if (env === 'render') {
      throw new Error(
        'FATAL: Persistent storage is required on Render. Set DATA_DIR (e.g. /tmp on Render Free or /var/data on persistent disk) or DATABASE_PATH. Refusing to fall back inside the application repository.'
      );
    }
    dataDir = path.join(appRoot, 'data');
    dbFile = path.join(dataDir, 'auction_database.json');
  }

  if (env === 'render') {
    const resolvedAppRoot = path.resolve(appRoot);
    const relativeToApp = path.relative(resolvedAppRoot, dbFile);
    const isInsideAppRoot =
      relativeToApp === '' ||
      (!relativeToApp.startsWith('..') && !path.isAbsolute(relativeToApp));
    if (isInsideAppRoot) {
      throw new Error(
        `FATAL: Database path "${dbFile}" points inside the application directory "${resolvedAppRoot}" on Render. Configure DATA_DIR outside the repo (e.g. /tmp or /var/data).`
      );
    }
  }

  const ext = path.extname(dbFile);
  const baseName = ext ? path.basename(dbFile, ext) : path.basename(dbFile);

  return {
    env,
    dataDir,
    dbFile,
    bakFile: path.join(dataDir, `${baseName}.bak.json`),
    bakPrevFile: path.join(dataDir, `${baseName}.bak.prev.json`),
    metaFile: path.join(dataDir, `${baseName}.meta.json`),
    markerFile: path.join(dataDir, `.${baseName}.initialized`),
    lockFile: path.join(dataDir, `.${baseName}.lock`),
    explicitPathConfigured,
  };
}

export function isValidPersistedDatabaseShape(
  candidate: unknown
): candidate is PersistedDatabaseState {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.teams) || obj.teams.length === 0) return false;
  if (!Array.isArray(obj.players) || obj.players.length === 0) return false;
  if (!obj.activeAuction || typeof obj.activeAuction !== 'object' || Array.isArray(obj.activeAuction)) {
    return false;
  }

  for (const t of obj.teams) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
    const team = t as Record<string, unknown>;
    if (typeof team.id !== 'string' || !team.id) return false;
    if (typeof team.code !== 'string' || !team.code) return false;
    if (typeof team.baseBudget !== 'number' || !Number.isFinite(team.baseBudget)) return false;
  }

  for (const p of obj.players) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    const player = p as Record<string, unknown>;
    if (typeof player.id !== 'number' || !Number.isFinite(player.id)) return false;
    if (typeof player.name !== 'string' || !player.name) return false;
    if (typeof player.role !== 'string' || typeof player.type !== 'string') return false;
    if (typeof player.valuePoints !== 'number' || !Number.isFinite(player.valuePoints)) return false;
    if (typeof player.basePrice !== 'number' || !Number.isFinite(player.basePrice)) return false;
  }

  const auction = obj.activeAuction as Record<string, unknown>;
  if (
    auction.status !== 'idle' &&
    auction.status !== 'bidding' &&
    auction.status !== 'sold' &&
    auction.status !== 'unsold'
  ) {
    return false;
  }

  return true;
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function syncWaitMs(ms: number) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // Only ESRCH definitively proves the PID does not exist on this host.
    // EPERM (owned by another user) or any other signal/error keeps the PID protected as alive.
    return err?.code !== 'ESRCH';
  }
}

export function writeBytesAtomically(filePath: string, content: Buffer | string, mode = 0o600) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, mode);
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    let offset = 0;
    while (offset < buffer.length) {
      offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
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

export function writeDatabaseStateAtomically(filePath: string, state: PersistedDatabaseState) {
  const serialized = JSON.stringify(state, null, 2);
  writeBytesAtomically(filePath, serialized, 0o600);
}

interface StorageCheckResult {
  ok: boolean;
  status?: 'storage_missing' | 'storage_not_directory' | 'storage_inaccessible';
  message?: string;
}

export function ensureAndVerifyStorageDirectory(paths: ResolvedDatabasePaths): StorageCheckResult {
  const { dataDir, env, explicitPathConfigured } = paths;
  const canCreateDirIfMissing =
    env === 'local' || (env === 'hostinger' && !explicitPathConfigured);

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(dataDir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      if (!canCreateDirIfMissing) {
        return {
          ok: false,
          status: 'storage_missing',
          message: `FATAL: Storage directory "${dataDir}" does not exist (environment: ${env}). Refusing to create a substitute path or fall back to another directory.`,
        };
      }

      const parentDir = path.dirname(dataDir);
      let parentStat: fs.Stats;
      try {
        parentStat = fs.statSync(parentDir);
      } catch (parentErr: any) {
        return {
          ok: false,
          status: 'storage_missing',
          message: `FATAL: Parent directory "${parentDir}" for storage "${dataDir}" is missing or inaccessible (${parentErr?.code || parentErr?.message}).`,
        };
      }

      if (!parentStat.isDirectory()) {
        return {
          ok: false,
          status: 'storage_not_directory',
          message: `FATAL: Parent path "${parentDir}" is not a directory.`,
        };
      }

      try {
        fs.accessSync(parentDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        fs.mkdirSync(dataDir, { recursive: true });
        stat = fs.statSync(dataDir);
      } catch (createErr: any) {
        return {
          ok: false,
          status: 'storage_inaccessible',
          message: `FATAL: Unable to create or access storage directory "${dataDir}": ${createErr?.code || createErr?.message}`,
        };
      }
    } else if (err?.code === 'ENOTDIR') {
      return {
        ok: false,
        status: 'storage_not_directory',
        message: `FATAL: Storage path "${dataDir}" contains a non-directory component.`,
      };
    } else {
      return {
        ok: false,
        status: 'storage_inaccessible',
        message: `FATAL: Unable to inspect storage directory "${dataDir}": ${err?.code || err?.message}`,
      };
    }
  }

  if (!stat || !stat.isDirectory()) {
    return {
      ok: false,
      status: 'storage_not_directory',
      message: `FATAL: Storage path "${dataDir}" exists but is not a directory.`,
    };
  }

  // Verify permissions, directory listing, and actual write/fsync/read/unlink probe
  const probeFile = path.join(
    dataDir,
    `.storage_probe.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  const probeToken = `bidmania-probe-${process.pid}-${Date.now()}`;
  let probeFd: number | null = null;
  try {
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    fs.readdirSync(dataDir);

    probeFd = fs.openSync(
      probeFile,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    fs.writeSync(probeFd, probeToken, 0, 'utf-8');
    fs.fsyncSync(probeFd);
    fs.closeSync(probeFd);
    probeFd = null;

    const readBack = fs.readFileSync(probeFile, 'utf-8');
    if (readBack !== probeToken) {
      return {
        ok: false,
        status: 'storage_inaccessible',
        message: `FATAL: Storage directory "${dataDir}" failed write-read verification.`,
      };
    }
    fs.unlinkSync(probeFile);
  } catch (err: any) {
    if (probeFd !== null) {
      try {
        fs.closeSync(probeFd);
      } catch {
        // ignore
      }
    }
    try {
      if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile);
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: 'storage_inaccessible',
      message: `FATAL: Storage directory "${dataDir}" is not readable/writable (${err?.code || err?.message}). Refusing to fall back to another directory.`,
    };
  }

  return { ok: true };
}

interface ParsedLockMetadata {
  pid: number;
  token: string;
  hostname: string;
  operation?: string;
}

function parseLockMetadata(
  raw: string
): { valid: true; info: ParsedLockMetadata } | { valid: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, reason: 'lock file is empty or still being written' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, reason: 'lock file contains malformed or incomplete JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'lock file root is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.pid !== 'number' || !Number.isInteger(obj.pid) || obj.pid <= 0) {
    return { valid: false, reason: 'lock file is missing a valid positive integer pid' };
  }
  if (typeof obj.hostname !== 'string' || obj.hostname.trim().length === 0) {
    return { valid: false, reason: 'lock file is missing a valid hostname' };
  }
  if (typeof obj.token !== 'string' || obj.token.length === 0) {
    return { valid: false, reason: 'lock file is missing a valid lock token' };
  }
  return {
    valid: true,
    info: {
      pid: obj.pid,
      token: obj.token,
      hostname: obj.hostname,
      operation: typeof obj.operation === 'string' ? obj.operation : undefined,
    },
  };
}

function extractPartialGuardOwnership(
  raw: string,
  currentHostname: string
): { remoteHost: boolean; liveLocalPid: boolean } {
  let detectedHostname: string | null = null;
  let remoteHost = false;

  const completeHostMatch = /"hostname"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (completeHostMatch) {
    try {
      detectedHostname = JSON.parse(`"${completeHostMatch[1]}"`);
    } catch {
      detectedHostname = completeHostMatch[1];
    }
    if (detectedHostname && detectedHostname !== currentHostname) {
      remoteHost = true;
    }
  } else {
    const truncatedHostMatch = /"hostname"\s*:\s*"([^"\\]*)$/.exec(raw);
    if (truncatedHostMatch) {
      const prefix = truncatedHostMatch[1];
      if (prefix.length > 0 && !currentHostname.startsWith(prefix)) {
        remoteHost = true;
      }
    }
  }

  let liveLocalPid = false;
  if (!remoteHost) {
    const pidMatch = /"pid"\s*:\s*(\d+)\s*(?=[,}\s])/.exec(raw);
    if (pidMatch) {
      const pid = Number(pidMatch[1]);
      if (
        Number.isInteger(pid) &&
        pid > 0 &&
        (detectedHostname === null || detectedHostname === currentHostname) &&
        isProcessAlive(pid)
      ) {
        liveLocalPid = true;
      }
    }
  }

  return { remoteHost, liveLocalPid };
}

function acquireExclusiveFileViaStaging(targetFile: string, payload: string): boolean {
  const stageFile = `${targetFile}.stage.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  let stageFd: number | null = null;

  try {
    stageFd = fs.openSync(
      stageFile,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    fs.writeSync(stageFd, payload, 0, 'utf-8');
    fs.fsyncSync(stageFd);
    fs.closeSync(stageFd);
    stageFd = null;

    try {
      fs.linkSync(stageFile, targetFile);
      return true;
    } catch (linkErr: any) {
      if (linkErr?.code === 'EEXIST') {
        return false;
      }
      if (
        linkErr?.code === 'ENOSYS' ||
        linkErr?.code === 'EPERM' ||
        linkErr?.code === 'EXDEV' ||
        linkErr?.code === 'EMLINK'
      ) {
        let fallbackFd: number | null = null;
        try {
          fallbackFd = fs.openSync(
            targetFile,
            fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
            0o600
          );
          fs.writeSync(fallbackFd, payload, 0, 'utf-8');
          fs.fsyncSync(fallbackFd);
          fs.closeSync(fallbackFd);
          fallbackFd = null;
          return true;
        } catch (fallbackErr: any) {
          if (fallbackFd !== null) {
            try {
              fs.closeSync(fallbackFd);
            } catch {
              // ignore
            }
          }
          if (fallbackErr?.code === 'EEXIST') {
            return false;
          }
          throw fallbackErr;
        }
      }
      throw linkErr;
    }
  } finally {
    if (stageFd !== null) {
      try {
        fs.closeSync(stageFd);
      } catch {
        // ignore
      }
    }
    try {
      if (fs.existsSync(stageFile)) {
        fs.unlinkSync(stageFile);
      }
    } catch {
      // ignore
    }
  }
}

function unlinkGuardIfOwnedByToken(guardFile: string, expectedToken: string): void {
  try {
    const current = fs.readFileSync(guardFile, 'utf-8');
    const parsed = parseLockMetadata(current);
    if (parsed.valid && parsed.info.token === expectedToken && parsed.info.pid === process.pid) {
      fs.unlinkSync(guardFile);
    }
  } catch {
    // ignore if already removed
  }
}

interface DeadLocalGuardInspection {
  exists: true;
  state: 'dead_local';
  stat: fs.Stats;
  rawBytes: Buffer;
  info: ParsedLockMetadata;
}

interface ProtectedCompleteGuardInspection {
  exists: true;
  state: 'protected_remote' | 'protected_live';
  stat: fs.Stats;
  rawBytes: Buffer;
  info: ParsedLockMetadata;
}

interface IncompleteUnownedGuardInspection {
  exists: true;
  state: 'incomplete_unowned';
  stat: fs.Stats;
  rawBytes: Buffer;
}

interface ProtectedPartialGuardInspection {
  exists: true;
  state: 'protected_remote_partial' | 'protected_live_partial';
  stat: fs.Stats;
  rawBytes: Buffer;
}

type RemovableGuardInspection = DeadLocalGuardInspection | IncompleteUnownedGuardInspection;

type GuardInspection =
  | { exists: false }
  | DeadLocalGuardInspection
  | ProtectedCompleteGuardInspection
  | IncompleteUnownedGuardInspection
  | ProtectedPartialGuardInspection;

function inspectReapGuard(guardFile: string, currentHostname: string): GuardInspection {
  let stat: fs.Stats;
  let rawBytes: Buffer;
  try {
    stat = fs.lstatSync(guardFile);
    if (!stat.isFile()) {
      return {
        exists: true,
        state: 'protected_live_partial',
        stat,
        rawBytes: Buffer.alloc(0),
      };
    }
    rawBytes = fs.readFileSync(guardFile);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { exists: false };
    }
    return {
      exists: true,
      state: 'protected_live_partial',
      stat: {} as fs.Stats,
      rawBytes: Buffer.alloc(0),
    };
  }

  const rawText = rawBytes.toString('utf-8');
  const parsed = parseLockMetadata(rawText);
  if (parsed.valid) {
    if (parsed.info.hostname !== currentHostname) {
      return {
        exists: true,
        state: 'protected_remote',
        stat,
        rawBytes,
        info: parsed.info,
      };
    }
    if (parsed.info.pid === process.pid || isProcessAlive(parsed.info.pid)) {
      return {
        exists: true,
        state: 'protected_live',
        stat,
        rawBytes,
        info: parsed.info,
      };
    }
    return {
      exists: true,
      state: 'dead_local',
      stat,
      rawBytes,
      info: parsed.info,
    };
  }

  const partial = extractPartialGuardOwnership(rawText, currentHostname);
  if (partial.remoteHost) {
    return {
      exists: true,
      state: 'protected_remote_partial',
      stat,
      rawBytes,
    };
  }
  if (partial.liveLocalPid) {
    return {
      exists: true,
      state: 'protected_live_partial',
      stat,
      rawBytes,
    };
  }

  return {
    exists: true,
    state: 'incomplete_unowned',
    stat,
    rawBytes,
  };
}

function verifyIncompleteGuardIsStatic(
  guardFile: string,
  initial: IncompleteUnownedGuardInspection,
  currentHostname: string
): RemovableGuardInspection | null {
  for (let sample = 0; sample < 3; sample++) {
    syncWaitMs(35);
    const current = inspectReapGuard(guardFile, currentHostname);
    if (!current.exists) {
      return null;
    }
    if (current.state === 'dead_local') {
      return current;
    }
    if (current.state !== 'incomplete_unowned') {
      return null;
    }
    if (
      current.stat.ino !== initial.stat.ino ||
      current.stat.size !== initial.stat.size ||
      Buffer.compare(current.rawBytes, initial.rawBytes) !== 0
    ) {
      // File is actively being written or replaced; never treat it as crashed
      return null;
    }
  }
  return initial;
}

function matchesObservedRemovableGuard(
  observed: RemovableGuardInspection,
  latest: GuardInspection,
  currentHostname: string
): boolean {
  if (!latest.exists) {
    return false;
  }
  if (observed.state === 'dead_local') {
    return (
      latest.state === 'dead_local' &&
      latest.info.hostname === currentHostname &&
      latest.info.pid === observed.info.pid &&
      latest.info.token === observed.info.token &&
      !isProcessAlive(latest.info.pid)
    );
  }
  return (
    latest.state === 'incomplete_unowned' &&
    latest.stat.ino === observed.stat.ino &&
    latest.stat.size === observed.stat.size &&
    Buffer.compare(latest.rawBytes, observed.rawBytes) === 0
  );
}

function clearDeadOrCrashedRecoverGuard(
  recoverGuardFile: string,
  observed: RemovableGuardInspection,
  currentHostname: string
): boolean {
  const serializeGuardFile = `${recoverGuardFile}.guard`;
  const serializeToken = `${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
  const serializePayload = JSON.stringify({
    pid: process.pid,
    hostname: currentHostname,
    token: serializeToken,
    operation: 'recover_guard_lock',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
  });

  if (!acquireExclusiveFileViaStaging(serializeGuardFile, serializePayload)) {
    return false;
  }

  try {
    const latest = inspectReapGuard(recoverGuardFile, currentHostname);
    if (!latest.exists) {
      return true;
    }
    if (!matchesObservedRemovableGuard(observed, latest, currentHostname)) {
      return false;
    }
    fs.unlinkSync(recoverGuardFile);
    return true;
  } catch {
    return false;
  } finally {
    unlinkGuardIfOwnedByToken(serializeGuardFile, serializeToken);
  }
}

function cleanupDeadOrCrashedReapGuard(reapGuardFile: string, currentHostname: string): boolean {
  const initial = inspectReapGuard(reapGuardFile, currentHostname);
  if (!initial.exists) {
    return true;
  }

  let removable: RemovableGuardInspection;

  if (initial.state === 'dead_local') {
    removable = initial;
  } else if (initial.state === 'incomplete_unowned') {
    const confirmed = verifyIncompleteGuardIsStatic(reapGuardFile, initial, currentHostname);
    if (!confirmed) {
      return false;
    }
    removable = confirmed;
  } else {
    return false;
  }

  const recoverGuardFile = `${reapGuardFile}.recover`;
  const recoverToken = `${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
  const recoverPayload = JSON.stringify({
    pid: process.pid,
    hostname: currentHostname,
    token: recoverToken,
    operation: 'recover_reap_guard',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
  });

  let acquiredRecover = acquireExclusiveFileViaStaging(recoverGuardFile, recoverPayload);
  if (!acquiredRecover) {
    const existingRecover = inspectReapGuard(recoverGuardFile, currentHostname);
    if (!existingRecover.exists) {
      acquiredRecover = acquireExclusiveFileViaStaging(recoverGuardFile, recoverPayload);
    } else if (existingRecover.state === 'dead_local') {
      if (clearDeadOrCrashedRecoverGuard(recoverGuardFile, existingRecover, currentHostname)) {
        acquiredRecover = acquireExclusiveFileViaStaging(recoverGuardFile, recoverPayload);
      }
    } else if (existingRecover.state === 'incomplete_unowned') {
      const staticRecover = verifyIncompleteGuardIsStatic(
        recoverGuardFile,
        existingRecover,
        currentHostname
      );
      if (
        staticRecover &&
        clearDeadOrCrashedRecoverGuard(recoverGuardFile, staticRecover, currentHostname)
      ) {
        acquiredRecover = acquireExclusiveFileViaStaging(recoverGuardFile, recoverPayload);
      }
    }
  }

  if (!acquiredRecover) {
    return false;
  }

  try {
    // Re-read and verify ownership/immutability immediately before deleting the .reap guard
    const latest = inspectReapGuard(reapGuardFile, currentHostname);
    if (!latest.exists) {
      return true;
    }
    if (!matchesObservedRemovableGuard(removable, latest, currentHostname)) {
      return false;
    }
    fs.unlinkSync(reapGuardFile);
    return true;
  } catch {
    return false;
  } finally {
    unlinkGuardIfOwnedByToken(recoverGuardFile, recoverToken);
  }
}

function reapDeadLockIfVerified(
  lockFile: string,
  expectedDeadInfo: ParsedLockMetadata,
  currentHostname: string
): boolean {
  const reapGuardFile = `${lockFile}.reap`;
  const reapToken = `${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
  const reapPayload = JSON.stringify({
    pid: process.pid,
    hostname: currentHostname,
    token: reapToken,
    operation: 'reap_dead_lock',
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
  });

  let acquiredReapGuard = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      acquiredReapGuard = acquireExclusiveFileViaStaging(reapGuardFile, reapPayload);
    } catch {
      return false;
    }

    if (acquiredReapGuard) {
      break;
    }

    if (attempt === 0) {
      const cleaned = cleanupDeadOrCrashedReapGuard(reapGuardFile, currentHostname);
      if (!cleaned) {
        return false;
      }
    }
  }

  if (!acquiredReapGuard) {
    return false;
  }

  try {
    let latestRaw: string;
    try {
      latestRaw = fs.readFileSync(lockFile, 'utf-8');
    } catch {
      return false;
    }
    const latest = parseLockMetadata(latestRaw);
    if (!latest.valid) return false;
    if (latest.info.token !== expectedDeadInfo.token) return false;
    if (latest.info.hostname !== currentHostname) return false;
    if (latest.info.pid !== expectedDeadInfo.pid) return false;
    if (isProcessAlive(latest.info.pid)) return false;

    fs.unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  } finally {
    if (acquiredReapGuard) {
      unlinkGuardIfOwnedByToken(reapGuardFile, reapToken);
    }
  }
}

export function withDatabaseLock<T>(
  paths: ResolvedDatabasePaths,
  operation: string,
  fn: () => T,
  timeoutMs = 7000
): T {
  const currentHostname = os.hostname();
  const lockToken = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
  const start = Date.now();
  let acquired = false;
  let lastContentionReason = 'held by another process';

  while (true) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(
        paths.lockFile,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600
      );
      const payload = JSON.stringify({
        pid: process.pid,
        token: lockToken,
        hostname: currentHostname,
        operation,
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
      });
      fs.writeSync(fd, payload, 0, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      acquired = true;
      break;
    } catch (err: any) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      if (err?.code !== 'EEXIST') {
        throw err;
      }

      // Inspect existing lock without ever deleting live, remote-host, or unverifiable locks
      let rawLock: string | null = null;
      try {
        rawLock = fs.readFileSync(paths.lockFile, 'utf-8');
      } catch (readErr: any) {
        if (readErr?.code === 'ENOENT') {
          // Lock was just released cleanly; retry acquisition immediately
          continue;
        }
        lastContentionReason = `lock file cannot be read (${readErr?.code || readErr?.message})`;
      }

      if (rawLock !== null) {
        const parsedLock = parseLockMetadata(rawLock);
        if (!parsedLock.valid) {
          // Do NOT delete malformed/incomplete lock files because ownership cannot be established safely
          lastContentionReason = `${parsedLock.reason}; refusing to remove lock with unverified ownership`;
        } else {
          const { pid, hostname, operation: ownerOp } = parsedLock.info;
          if (hostname !== currentHostname) {
            // Different host/container sharing storage: local PID liveness cannot be verified safely
            lastContentionReason = `owned by another host "${hostname}" (pid=${pid}${ownerOp ? `, operation=${ownerOp}` : ''})`;
          } else if (isProcessAlive(pid)) {
            // Owning process on this host is alive; NEVER steal lock regardless of age
            lastContentionReason = `held by active process (pid=${pid}, host=${hostname}${ownerOp ? `, operation=${ownerOp}` : ''})`;
          } else {
            // Owning process on this exact host is confirmed dead (ESRCH)
            const reaped = reapDeadLockIfVerified(paths.lockFile, parsedLock.info, currentHostname);
            if (reaped) {
              continue;
            }
            lastContentionReason = `dead-process lock (pid=${pid}) could not be reaped cleanly yet`;
          }
        }
      }

      if (Date.now() - start >= timeoutMs) {
        const lockErr: any = new Error(
          `Database lock "${paths.lockFile}" could not be acquired after ${timeoutMs}ms (${lastContentionReason}).`
        );
        lockErr.code = 'DB_FILE_LOCKED';
        throw lockErr;
      }
      syncWaitMs(35);
    }
  }

  try {
    return fn();
  } finally {
    if (acquired) {
      try {
        const current = fs.readFileSync(paths.lockFile, 'utf-8');
        const parsed = parseLockMetadata(current);
        if (parsed.valid && parsed.info.token === lockToken) {
          fs.unlinkSync(paths.lockFile);
        }
      } catch {
        // ignore if already removed
      }
    }
  }
}

function cleanupStaleTempFiles(paths: ResolvedDatabasePaths) {
  const dbBase = path.basename(paths.dbFile);
  try {
    const entries = fs.readdirSync(paths.dataDir);
    const now = Date.now();
    for (const entry of entries) {
      if (
        (entry.startsWith(`.${dbBase}.`) || entry.startsWith('.storage_probe.')) &&
        entry.endsWith('.tmp')
      ) {
        const full = path.join(paths.dataDir, entry);
        try {
          const st = fs.statSync(full);
          if (now - st.mtimeMs > 5000) {
            fs.unlinkSync(full);
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

function readJsonMetadata(metaFile: string): DatabaseMetadata | null {
  try {
    if (!fs.existsSync(metaFile)) return null;
    const raw = fs.readFileSync(metaFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DatabaseMetadata;
    }
  } catch {
    // ignore corrupt meta
  }
  return null;
}

function writeMetadataAndMarker(
  paths: ResolvedDatabasePaths,
  dbChecksumSha256: string,
  hasAdminCodeHash: boolean,
  options: {
    incrementSaveCount: boolean;
    initMode: InitMarker['initMode'];
    recoveryReason?: string | null;
  }
) {
  const now = new Date().toISOString();
  const prevMeta = readJsonMetadata(paths.metaFile);
  const nextMeta: DatabaseMetadata = {
    schemaVersion: 1,
    dbFileName: path.basename(paths.dbFile),
    environment: paths.env,
    createdAt: prevMeta?.createdAt || now,
    lastSavedAt: options.incrementSaveCount ? now : prevMeta?.lastSavedAt || now,
    lastVerifiedAt: now,
    saveCount: options.incrementSaveCount
      ? (prevMeta?.saveCount || 0) + 1
      : prevMeta?.saveCount || 1,
    checksumSha256: dbChecksumSha256,
    hasAdminCodeHash,
    recoveryCount: options.recoveryReason
      ? (prevMeta?.recoveryCount || 0) + 1
      : prevMeta?.recoveryCount || 0,
    lastRecoveryReason:
      options.recoveryReason !== undefined
        ? options.recoveryReason
        : prevMeta?.lastRecoveryReason || null,
  };
  writeBytesAtomically(paths.metaFile, JSON.stringify(nextMeta, null, 2), 0o600);

  if (!fs.existsSync(paths.markerFile)) {
    const marker: InitMarker = {
      schemaVersion: 1,
      dbFileName: path.basename(paths.dbFile),
      environment: paths.env,
      createdAt: prevMeta?.createdAt || now,
      initMode: options.initMode,
    };
    writeBytesAtomically(paths.markerFile, JSON.stringify(marker, null, 2), 0o600);
  }
}

function readAndVerifyDbFileOnDisk<T extends PersistedDatabaseState>(
  filePath: string
): { valid: true; state: T; checksumSha256: string } | { valid: false; reason: string } {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err: any) {
    return { valid: false, reason: `Read failure: ${err?.code || err?.message}` };
  }
  const text = buf.toString('utf-8').trim();
  if (!text) {
    return { valid: false, reason: 'File is empty.' };
  }
  try {
    const parsed = JSON.parse(text);
    if (!isValidPersistedDatabaseShape(parsed)) {
      return { valid: false, reason: 'Invalid database schema.' };
    }
    return {
      valid: true,
      state: parsed as T,
      checksumSha256: sha256Hex(buf),
    };
  } catch (err: any) {
    return { valid: false, reason: `JSON parse failure: ${err?.message || err}` };
  }
}

function writeAndVerifyAuthoritativeDb<T extends PersistedDatabaseState>(
  paths: ResolvedDatabasePaths,
  state: T,
  options: {
    initMode: InitMarker['initMode'];
    incrementSaveCount: boolean;
    recoveryReason?: string | null;
    updateBackup?: boolean;
  }
): string {
  writeDatabaseStateAtomically(paths.dbFile, state);
  const verified = readAndVerifyDbFileOnDisk<T>(paths.dbFile);
  if (!verified.valid) {
    throw new Error(
      `FATAL: Written database at "${paths.dbFile}" failed post-write verification: ${verified.reason}`
    );
  }

  if (options.updateBackup !== false) {
    try {
      const rawBuf = fs.readFileSync(paths.dbFile);
      writeBytesAtomically(paths.bakFile, rawBuf, 0o600);
    } catch {
      // non-fatal if backup mirror fails after primary verified write
    }
  }

  writeMetadataAndMarker(
    paths,
    verified.checksumSha256,
    isValidAdminCodeHashFormat(verified.state.config?.adminCodeHash),
    {
      incrementSaveCount: options.incrementSaveCount,
      initMode: options.initMode,
      recoveryReason: options.recoveryReason,
    }
  );

  return verified.checksumSha256;
}

function preserveCorruptedDatabaseFile(
  paths: ResolvedDatabasePaths,
  rawBytes: Buffer
): string {
  const ext = path.extname(paths.dbFile) || '.json';
  const baseName = path.basename(paths.dbFile, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${timestamp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const backupPath = path.join(paths.dataDir, `${baseName}.corrupt.${suffix}${ext}`);
  writeBytesAtomically(backupPath, rawBytes, 0o600);
  return backupPath;
}

function findValidBackupCandidate<T extends PersistedDatabaseState>(
  paths: ResolvedDatabasePaths
): { filePath: string; state: T } | null {
  const candidates = [paths.bakFile, paths.bakPrevFile];
  let fallbackWithoutAdminHash: { filePath: string; state: T } | null = null;

  for (const candidatePath of candidates) {
    if (!fs.existsSync(candidatePath)) continue;
    const check = readAndVerifyDbFileOnDisk<T>(candidatePath);
    if (!check.valid) continue;
    if (isValidAdminCodeHashFormat(check.state.config?.adminCodeHash)) {
      return { filePath: candidatePath, state: check.state };
    }
    if (!fallbackWithoutAdminHash) {
      fallbackWithoutAdminHash = { filePath: candidatePath, state: check.state };
    }
  }

  return fallbackWithoutAdminHash;
}

// Extracts a balanced JSON value (object, array, string, number, boolean, null) starting at startIdx
function extractJsonValueSubstring(text: string, startIdx: number): string | null {
  let i = startIdx;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return null;

  const first = text[i];
  if (first === '{' || first === '[') {
    const stack: string[] = [first];
    let inString = false;
    let escaped = false;
    for (let j = i + 1; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        stack.push(ch);
      } else if (ch === '}' || ch === ']') {
        const expected = ch === '}' ? '{' : '[';
        if (stack[stack.length - 1] !== expected) {
          return null;
        }
        stack.pop();
        if (stack.length === 0) {
          return text.slice(i, j + 1);
        }
      }
    }
    return null;
  }

  if (first === '"') {
    let escaped = false;
    for (let j = i + 1; j < text.length; j++) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        return text.slice(i, j + 1);
      }
    }
    return null;
  }

  const primitiveMatch = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
    text.slice(i)
  );
  return primitiveMatch ? primitiveMatch[1] : null;
}

function extractTopLevelJsonProperty(rawText: string, propName: string): unknown {
  const keyRegex = new RegExp(`"${propName}"\\s*:`);
  const match = keyRegex.exec(rawText);
  if (!match) return undefined;
  const sub = extractJsonValueSubstring(rawText, match.index + match[0].length);
  if (!sub) return undefined;
  try {
    return JSON.parse(sub);
  } catch {
    return undefined;
  }
}

function extractPartialObjectsFromArraySection(rawText: string, propName: string): any[] {
  const keyRegex = new RegExp(`"${propName}"\\s*:\\s*\\[`);
  const match = keyRegex.exec(rawText);
  if (!match) return [];
  const items: any[] = [];
  let cursor = match.index + match[0].length;
  while (cursor < rawText.length) {
    while (cursor < rawText.length && /[\s,]/.test(rawText[cursor])) cursor++;
    if (cursor >= rawText.length || rawText[cursor] === ']') break;
    if (rawText[cursor] !== '{') break;
    const objSub = extractJsonValueSubstring(rawText, cursor);
    if (!objSub) break;
    try {
      items.push(JSON.parse(objSub));
    } catch {
      break;
    }
    cursor += objSub.length;
  }
  return items;
}

export function trySalvageCorruptedDatabase<T extends PersistedDatabaseState>(
  rawText: string,
  buildSeededState: (adminCodeHash?: string) => T,
  defaultAdminCode: string | null
): { state: T; salvagedParts: string[] } | null {
  let rootObj: Record<string, unknown> | null = null;

  // 1) Attempt parsing full text, or trimmed balanced prefix if trailing bytes exist
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rootObj = parsed as Record<string, unknown>;
      }
    } catch {
      const balancedRoot = extractJsonValueSubstring(trimmed, 0);
      if (balancedRoot) {
        try {
          const parsed = JSON.parse(balancedRoot);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            rootObj = parsed as Record<string, unknown>;
          }
        } catch {
          // fall through to section-level extraction
        }
      }
    }
  }

  const rawConfig = rootObj?.config ?? extractTopLevelJsonProperty(rawText, 'config');
  const rawPurse =
    rootObj?.universalPurse ?? extractTopLevelJsonProperty(rawText, 'universalPurse');
  const rawTeams =
    rootObj?.teams ??
    extractTopLevelJsonProperty(rawText, 'teams') ??
    extractPartialObjectsFromArraySection(rawText, 'teams');
  const rawPlayers =
    rootObj?.players ??
    extractTopLevelJsonProperty(rawText, 'players') ??
    extractPartialObjectsFromArraySection(rawText, 'players');
  const rawAuction =
    rootObj?.activeAuction ?? extractTopLevelJsonProperty(rawText, 'activeAuction');
  const rawAuditLogs =
    rootObj?.auditLogs ??
    extractTopLevelJsonProperty(rawText, 'auditLogs') ??
    extractPartialObjectsFromArraySection(rawText, 'auditLogs');

  const salvagedParts: string[] = [];

  let salvagedAdminHash: string | undefined;
  if (
    rawConfig &&
    typeof rawConfig === 'object' &&
    !Array.isArray(rawConfig) &&
    isValidAdminCodeHashFormat((rawConfig as Record<string, unknown>).adminCodeHash)
  ) {
    salvagedAdminHash = (rawConfig as Record<string, unknown>).adminCodeHash as string;
    salvagedParts.push('config.adminCodeHash');
  }

  const baseState = buildSeededState(salvagedAdminHash);

  if (typeof rawPurse === 'number' && Number.isFinite(rawPurse) && rawPurse >= 0) {
    baseState.universalPurse = rawPurse;
    salvagedParts.push('universalPurse');
  }

  if (Array.isArray(rawTeams) && rawTeams.length > 0) {
    let teamMerged = 0;
    for (const candidate of rawTeams) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const c = candidate as Record<string, unknown>;
      const target = baseState.teams.find(
        (t) =>
          (typeof c.id === 'string' && t.id === c.id) ||
          (typeof c.code === 'string' && t.code === c.code)
      );
      if (!target) continue;
      if (typeof c.name === 'string') target.name = c.name;
      if (typeof c.loginCode === 'string' && c.loginCode.trim()) {
        target.loginCode = c.loginCode.trim().toUpperCase();
      }
      if (typeof c.adjustedBudget === 'number' && Number.isFinite(c.adjustedBudget)) {
        target.adjustedBudget = Math.max(0, c.adjustedBudget);
      }
      if (typeof c.remainingBudget === 'number' && Number.isFinite(c.remainingBudget)) {
        target.remainingBudget = Math.max(0, c.remainingBudget);
      }
      if (typeof c.totalSpent === 'number' && Number.isFinite(c.totalSpent)) {
        target.totalSpent = Math.max(0, c.totalSpent);
      }
      if (typeof c.totalValue === 'number' && Number.isFinite(c.totalValue)) {
        target.totalValue = Math.max(0, c.totalValue);
      }
      if (typeof c.isQualified === 'boolean') {
        target.isQualified = c.isQualified;
      }
      teamMerged++;
    }
    if (teamMerged > 0) {
      salvagedParts.push(`teams(${teamMerged})`);
    }
  }

  if (Array.isArray(rawPlayers) && rawPlayers.length > 0) {
    let playerMerged = 0;
    for (const candidate of rawPlayers) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const c = candidate as Record<string, unknown>;
      const target = baseState.players.find((p) => typeof c.id === 'number' && p.id === c.id);
      if (!target) continue;
      if (c.teamId === null || typeof c.teamId === 'string') {
        target.teamId = c.teamId;
      }
      if (c.soldCost === null || (typeof c.soldCost === 'number' && Number.isFinite(c.soldCost))) {
        target.soldCost = c.soldCost;
      }
      if (typeof c.isSold === 'boolean') {
        target.isSold = c.isSold;
      }
      if (typeof c.name === 'string' && c.name.trim()) {
        target.name = c.name;
      }
      playerMerged++;
    }
    if (playerMerged > 0) {
      salvagedParts.push(`players(${playerMerged})`);
    }
  }

  if (rawAuction && typeof rawAuction === 'object' && !Array.isArray(rawAuction)) {
    const a = rawAuction as Record<string, unknown>;
    if (a.status === 'idle' || a.status === 'bidding' || a.status === 'sold' || a.status === 'unsold') {
      baseState.activeAuction = {
        playerId: typeof a.playerId === 'number' ? a.playerId : null,
        biddingType: a.biddingType === 'offline' ? 'offline' : 'online',
        currentBid: typeof a.currentBid === 'number' ? a.currentBid : null,
        currentTeam: typeof a.currentTeam === 'string' ? a.currentTeam : null,
        timerSeconds: typeof a.timerSeconds === 'number' ? a.timerSeconds : 30,
        timerDuration: typeof a.timerDuration === 'number' ? a.timerDuration : 30,
        timerRunning: false, // always pause timer safely after recovery
        status: a.status,
        bidHistory: Array.isArray(a.bidHistory) ? (a.bidHistory as BidHistoryRecord[]) : [],
        startedAt: typeof a.startedAt === 'string' ? a.startedAt : null,
      };
      salvagedParts.push('activeAuction');
    }
  }

  if (Array.isArray(rawAuditLogs) && rawAuditLogs.length > 0) {
    const validLogs = rawAuditLogs.filter(
      (item): item is AuditLogRecord =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as any).id === 'string' &&
        typeof (item as any).action === 'string' &&
        typeof (item as any).timestamp === 'string'
    );
    if (validLogs.length > 0) {
      baseState.auditLogs = validLogs;
      salvagedParts.push(`auditLogs(${validLogs.length})`);
    }
  }

  if (salvagedParts.length === 0) {
    return null;
  }

  // If adminCodeHash wasn't in the salvaged section, fall back ONLY to configured ADMIN_DEFAULT_CODE
  if (!baseState.config.adminCodeHash && defaultAdminCode && isValidAdminCodeFormat(defaultAdminCode)) {
    baseState.config.adminCodeHash = hashAdminCode(defaultAdminCode);
  }

  baseState.auditLogs.push({
    id: `salvage_${Date.now()}`,
    action: 'DATABASE_SALVAGED',
    timestamp: new Date().toISOString(),
    details: {
      message: `Salvaged intact fields from corrupted database: ${salvagedParts.join(', ')}`,
    },
  });

  return { state: baseState, salvagedParts };
}

function normalizeLoadedState<T extends PersistedDatabaseState>(state: T): {
  status: 'ready' | 'missing_admin_hash';
  needsSave: boolean;
  message: string;
} {
  let needsSave = false;

  if (!state.config || typeof state.config !== 'object') {
    state.config = { gameCode: 'APL2026' };
    needsSave = true;
  }
  if (state.config.gameCode !== 'APL2026') {
    state.config.gameCode = 'APL2026';
    needsSave = true;
  }
  if ('adminCode' in state.config) {
    delete state.config.adminCode;
    needsSave = true;
  }

  let status: 'ready' | 'missing_admin_hash' = 'ready';
  let message = '';

  if (!isValidAdminCodeHashFormat(state.config.adminCodeHash)) {
    delete state.config.adminCodeHash;
    status = 'missing_admin_hash';
    message =
      'Persistent database is missing a valid adminCodeHash. Admin login is disabled; run explicit recovery ("npm run recover-admin -- --code <NEW_CODE>").';
  }

  const defaultCodes: Record<string, string> = {
    team_a: 'TEAMA777',
    team_b: 'TEAMB777',
    team_c: 'TEAMC777',
    team_d: 'TEAMD777',
  };
  for (const team of state.teams) {
    if (!team.loginCode) {
      team.loginCode =
        defaultCodes[team.id] || `${team.code.replace(/\s+/g, '').toUpperCase()}777`;
      needsSave = true;
    }
    if (team.adjustedBudget === undefined) {
      team.adjustedBudget = team.baseBudget;
      needsSave = true;
    }
  }
  if (!state.activeAuction.biddingType) {
    state.activeAuction.biddingType = 'online';
    needsSave = true;
  }
  if (state.universalPurse === undefined) {
    state.universalPurse = 800;
    needsSave = true;
  }
  if (!Array.isArray(state.auditLogs)) {
    state.auditLogs = [];
    needsSave = true;
  }

  return { status, needsSave, message };
}

export function initializeOrLoadDatabase<T extends PersistedDatabaseState>(
  paths: ResolvedDatabasePaths,
  buildSeededState: (adminCodeHash?: string) => T
): DatabaseLoadResult<T> {
  const storageCheck = ensureAndVerifyStorageDirectory(paths);
  if (!storageCheck.ok) {
    return {
      status: storageCheck.status!,
      persistenceEnabled: false,
      fatalStorageError: true,
      message: storageCheck.message!,
      state: null,
      needsSave: false,
      source: 'none',
      preservedCorruptFile: null,
    };
  }

  try {
    return withDatabaseLock(paths, 'startup_init_or_load', () => {
      cleanupStaleTempFiles(paths);

      // Step 1: Inspect primary DB file with explicit error distinction
      let primaryExists = false;
      let primaryStat: fs.Stats | null = null;
      try {
        primaryStat = fs.statSync(paths.dbFile);
        primaryExists = true;
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          primaryExists = false;
        } else if (err?.code === 'EBUSY' || err?.code === 'EAGAIN' || err?.code === 'ETXTBSY') {
          return {
            status: 'file_locked',
            persistenceEnabled: false,
            fatalStorageError: true,
            message: `FATAL: Database file "${paths.dbFile}" is locked by another process (${err.code}).`,
            state: null,
            needsSave: false,
            source: 'none',
            preservedCorruptFile: null,
          };
        } else {
          return {
            status: 'storage_inaccessible',
            persistenceEnabled: false,
            fatalStorageError: true,
            message: `FATAL: Unable to inspect database file "${paths.dbFile}": ${err?.code || err?.message}`,
            state: null,
            needsSave: false,
            source: 'none',
            preservedCorruptFile: null,
          };
        }
      }

      if (primaryExists && primaryStat && !primaryStat.isFile()) {
        return {
          status: 'storage_not_directory',
          persistenceEnabled: false,
          fatalStorageError: true,
          message: `FATAL: Database path "${paths.dbFile}" is not a regular file.`,
          state: null,
          needsSave: false,
          source: 'none',
          preservedCorruptFile: null,
        };
      }

      const defaultAdminCode = getDefaultAdminCode();

      // Step 2: Primary DB exists — read, parse, validate
      if (primaryExists) {
        let rawBytes: Buffer;
        try {
          rawBytes = fs.readFileSync(paths.dbFile);
        } catch (err: any) {
          if (err?.code === 'EBUSY' || err?.code === 'EAGAIN') {
            return {
              status: 'file_locked',
              persistenceEnabled: false,
              fatalStorageError: true,
              message: `FATAL: Database file "${paths.dbFile}" is locked (${err.code}).`,
              state: null,
              needsSave: false,
              source: 'none',
              preservedCorruptFile: null,
            };
          }
          return {
            status: 'storage_inaccessible',
            persistenceEnabled: false,
            fatalStorageError: true,
            message: `FATAL: Database file "${paths.dbFile}" is unreadable (${err?.code || err?.message}). Refusing to overwrite or fall back.`,
            state: null,
            needsSave: false,
            source: 'none',
            preservedCorruptFile: null,
          };
        }

        const rawText = rawBytes.toString('utf-8');
        let parsed: unknown = null;
        let parseFailureReason = '';

        if (!rawText.trim()) {
          parseFailureReason = 'Database file is empty (0 bytes or whitespace).';
        } else {
          try {
            parsed = JSON.parse(rawText);
            if (!isValidPersistedDatabaseShape(parsed)) {
              parseFailureReason = 'Invalid persistent database structure.';
              parsed = null;
            }
          } catch (err: any) {
            parseFailureReason = `Invalid JSON (${err?.message || err}).`;
            parsed = null;
          }
        }

        if (parsed !== null) {
          const state = parsed as T;
          const norm = normalizeLoadedState(state);
          const checksum = sha256Hex(rawBytes);

          // Ensure metadata, marker, and warm backup exist without unnecessarily rewriting DB_FILE
          if (norm.status === 'ready') {
            if (!fs.existsSync(paths.bakFile)) {
              writeBytesAtomically(paths.bakFile, rawBytes, 0o600);
            }
            writeMetadataAndMarker(paths, checksum, true, {
              incrementSaveCount: false,
              initMode: 'existing_verified',
            });
          } else {
            console.error(`CRITICAL: ${norm.message}`);
          }

          return {
            status: norm.status,
            persistenceEnabled: true,
            fatalStorageError: false,
            message: norm.message,
            state,
            needsSave: norm.needsSave,
            source: 'primary',
            preservedCorruptFile: null,
          };
        }

        // Primary DB is corrupted — preserve verbatim BEFORE any recovery or replacement
        const preservedCorruptFile = preserveCorruptedDatabaseFile(paths, rawBytes);
        console.error(
          `CRITICAL: Primary database at "${paths.dbFile}" is corrupted (${parseFailureReason}). Preserved raw corrupted file at "${preservedCorruptFile}".`
        );

        // Priority 1: Valid backup recovery
        const backup = findValidBackupCandidate<T>(paths);
        if (backup) {
          const norm = normalizeLoadedState(backup.state);
          if (!Array.isArray(backup.state.auditLogs)) {
            backup.state.auditLogs = [];
          }
          backup.state.auditLogs.push({
            id: `recover_bak_${Date.now()}`,
            action: 'DATABASE_RECOVERED_FROM_BACKUP',
            timestamp: new Date().toISOString(),
            details: {
              message: `Recovered authoritative database from backup "${path.basename(backup.filePath)}" after primary corruption (${parseFailureReason}).`,
              preservedCorruptFile: path.basename(preservedCorruptFile),
            },
          });
          writeAndVerifyAuthoritativeDb(paths, backup.state, {
            initMode: 'recovered',
            incrementSaveCount: true,
            recoveryReason: `Recovered from backup after primary corruption: ${parseFailureReason}`,
          });
          console.warn(
            `RECOVERY: Restored database at "${paths.dbFile}" from verified backup "${backup.filePath}".`
          );
          return {
            status: norm.status,
            persistenceEnabled: true,
            fatalStorageError: false,
            message: norm.message,
            state: backup.state,
            needsSave: false,
            source: 'recovered_backup',
            preservedCorruptFile,
          };
        }

        // Priority 2: Partial salvage from corrupted data
        const salvaged = trySalvageCorruptedDatabase(
          rawText,
          buildSeededState,
          defaultAdminCode
        );
        if (salvaged) {
          const norm = normalizeLoadedState(salvaged.state);
          writeAndVerifyAuthoritativeDb(paths, salvaged.state, {
            initMode: 'salvaged',
            incrementSaveCount: true,
            recoveryReason: `Salvaged fields (${salvaged.salvagedParts.join(', ')}) after corruption: ${parseFailureReason}`,
          });
          console.warn(
            `RECOVERY: Salvaged fields [${salvaged.salvagedParts.join(', ')}] into verified database at "${paths.dbFile}".`
          );
          return {
            status: norm.status,
            persistenceEnabled: true,
            fatalStorageError: false,
            message: norm.message,
            state: salvaged.state,
            needsSave: false,
            source: 'salvaged',
            preservedCorruptFile,
          };
        }

        // Priority 3: Irrecoverable — replace cleanly using configured ADMIN_DEFAULT_CODE
        if (defaultAdminCode && isValidAdminCodeFormat(defaultAdminCode)) {
          const replacement = buildSeededState(hashAdminCode(defaultAdminCode));
          replacement.auditLogs.push({
            id: `replace_corrupt_${Date.now()}`,
            action: 'DATABASE_REPLACED_AFTER_CORRUPTION',
            timestamp: new Date().toISOString(),
            details: {
              message: `Irrecoverable corruption (${parseFailureReason}); replaced with clean initialized database. Corrupt copy preserved at "${path.basename(preservedCorruptFile)}".`,
            },
          });
          writeAndVerifyAuthoritativeDb(paths, replacement, {
            initMode: 'recovered',
            incrementSaveCount: true,
            recoveryReason: `Replaced irrecoverable corrupt DB: ${parseFailureReason}`,
          });
          console.warn(
            `RECOVERY: Replaced irrecoverable database at "${paths.dbFile}" using configured ADMIN_DEFAULT_CODE (corrupt copy preserved at "${preservedCorruptFile}").`
          );
          return {
            status: 'ready',
            persistenceEnabled: true,
            fatalStorageError: false,
            message: '',
            state: replacement,
            needsSave: false,
            source: 'replaced_corrupt',
            preservedCorruptFile,
          };
        }

        return {
          status: 'corrupt',
          persistenceEnabled: false,
          fatalStorageError: false,
          message: `Persistent database at "${paths.dbFile}" is irrecoverably corrupted (${parseFailureReason}) and ADMIN_DEFAULT_CODE is not configured for clean replacement. Corrupted file preserved at "${preservedCorruptFile}".`,
          state: null,
          needsSave: false,
          source: 'none',
          preservedCorruptFile,
        };
      }

      // Step 3: Primary DB is genuinely absent — check valid backups first before creating a fresh DB
      const backup = findValidBackupCandidate<T>(paths);
      if (backup) {
        const norm = normalizeLoadedState(backup.state);
        if (!Array.isArray(backup.state.auditLogs)) {
          backup.state.auditLogs = [];
        }
        backup.state.auditLogs.push({
          id: `recover_missing_${Date.now()}`,
          action: 'DATABASE_RECOVERED_FROM_BACKUP',
          timestamp: new Date().toISOString(),
          details: {
            message: `Restored missing primary database from verified backup "${path.basename(backup.filePath)}".`,
          },
        });
        writeAndVerifyAuthoritativeDb(paths, backup.state, {
          initMode: 'recovered',
          incrementSaveCount: true,
          recoveryReason: 'Primary database file was absent; restored from backup',
        });
        console.warn(
          `RECOVERY: Restored missing database at "${paths.dbFile}" from verified backup "${backup.filePath}".`
        );
        return {
          status: norm.status,
          persistenceEnabled: true,
          fatalStorageError: false,
          message: norm.message,
          state: backup.state,
          needsSave: false,
          source: 'recovered_backup',
          preservedCorruptFile: null,
        };
      }

      // Step 4: Storage directory is verified accessible & writable, DB and backups genuinely absent -> Auto-initialize
      if (!defaultAdminCode || !isValidAdminCodeFormat(defaultAdminCode)) {
        const msg = `Persistent database not found at "${paths.dbFile}" and ADMIN_DEFAULT_CODE is not set (or invalid: must be 4-64 non-whitespace characters). Set ADMIN_DEFAULT_CODE or run "npm run init-db".`;
        console.error(`CRITICAL: ${msg}`);
        return {
          status: 'missing',
          persistenceEnabled: false,
          fatalStorageError: false,
          message: msg,
          state: null,
          needsSave: false,
          source: 'none',
          preservedCorruptFile: null,
        };
      }

      const freshState = buildSeededState(hashAdminCode(defaultAdminCode));
      writeAndVerifyAuthoritativeDb(paths, freshState, {
        initMode: 'auto',
        incrementSaveCount: false,
        recoveryReason: null,
      });
      console.log(
        `DB_INIT: Automatically initialized verified database at "${paths.dbFile}" (environment: ${paths.env}).`
      );

      return {
        status: 'ready',
        persistenceEnabled: true,
        fatalStorageError: false,
        message: '',
        state: freshState,
        needsSave: false,
        source: 'auto_initialized',
        preservedCorruptFile: null,
      };
    });
  } catch (err: any) {
    if (err?.code === 'DB_FILE_LOCKED') {
      return {
        status: 'file_locked',
        persistenceEnabled: false,
        fatalStorageError: true,
        message: `FATAL: ${err.message}`,
        state: null,
        needsSave: false,
        source: 'none',
        preservedCorruptFile: null,
      };
    }
    return {
      status: 'storage_inaccessible',
      persistenceEnabled: false,
      fatalStorageError: true,
      message: `FATAL: Database initialization failed in "${paths.dataDir}": ${err?.message || err}`,
      state: null,
      needsSave: false,
      source: 'none',
      preservedCorruptFile: null,
    };
  }
}

export function saveDatabaseWithBackup<T extends PersistedDatabaseState>(
  paths: ResolvedDatabasePaths,
  state: T
): void {
  if (!isValidPersistedDatabaseShape(state)) {
    throw new Error('Refusing to persist invalid database state.');
  }

  const storageCheck = ensureAndVerifyStorageDirectory(paths);
  if (!storageCheck.ok) {
    throw new Error(storageCheck.message || `Storage directory "${paths.dataDir}" unavailable.`);
  }

  withDatabaseLock(paths, 'save', () => {
    // Rotate existing valid .bak.json -> .bak.prev.json before overwriting primary
    if (fs.existsSync(paths.bakFile)) {
      const prevBakCheck = readAndVerifyDbFileOnDisk<T>(paths.bakFile);
      if (prevBakCheck.valid) {
        try {
          const bakBytes = fs.readFileSync(paths.bakFile);
          writeBytesAtomically(paths.bakPrevFile, bakBytes, 0o600);
        } catch {
          // non-fatal
        }
      }
    }

    writeDatabaseStateAtomically(paths.dbFile, state);
    const verified = readAndVerifyDbFileOnDisk<T>(paths.dbFile);
    if (!verified.valid) {
      throw new Error(
        `Post-write database verification failed for "${paths.dbFile}": ${verified.reason}`
      );
    }

    // Mirror the newly verified primary DB to .bak.json so recovery always restores the latest verified state
    try {
      const verifiedBytes = fs.readFileSync(paths.dbFile);
      writeBytesAtomically(paths.bakFile, verifiedBytes, 0o600);
    } catch {
      // non-fatal
    }

    writeMetadataAndMarker(
      paths,
      verified.checksumSha256,
      isValidAdminCodeHashFormat(verified.state.config?.adminCodeHash),
      {
        incrementSaveCount: true,
        initMode: 'existing_verified',
      }
    );
  });
}

export function cliInitDatabase<T extends PersistedDatabaseState>(
  paths: ResolvedDatabasePaths,
  buildSeededState: (adminCodeHash?: string) => T
): never {
  const storageCheck = ensureAndVerifyStorageDirectory(paths);
  if (!storageCheck.ok) {
    console.error(storageCheck.message);
    process.exit(1);
  }

  withDatabaseLock(paths, 'cli_init_db', () => {
    if (fs.existsSync(paths.dbFile)) {
      console.error(
        `REFUSED: Persistent database already exists at ${paths.dbFile}. First-time initialization will never overwrite an active database or Admin Code. Use "npm run recover-admin -- --code <NEW_CODE>" if you need to recover Admin access.`
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

    const initialState = buildSeededState(hashAdminCode(defaultAdminCode));
    writeAndVerifyAuthoritativeDb(paths, initialState, {
      initMode: 'cli',
      incrementSaveCount: false,
      recoveryReason: null,
    });
    console.log(
      `Initialized persistent database at ${paths.dbFile} with salted scrypt hash of ADMIN_DEFAULT_CODE.`
    );
    console.log('Restart the application server if it is currently running.');
  });
  process.exit(0);
}

export function cliRecoverAdmin(
  paths: ResolvedDatabasePaths,
  codeArg: string | null,
  useDefault: boolean
): never {
  const storageCheck = ensureAndVerifyStorageDirectory(paths);
  if (!storageCheck.ok) {
    console.error(storageCheck.message);
    process.exit(1);
  }

  withDatabaseLock(paths, 'cli_recover_admin', () => {
    if (!fs.existsSync(paths.dbFile)) {
      console.error(
        `ERROR: No persistent database exists at ${paths.dbFile}. Run "npm run init-db" for first-time initialization.`
      );
      process.exit(1);
    }

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(paths.dbFile, 'utf-8');
      parsed = JSON.parse(raw);
    } catch (err: any) {
      console.error(
        `ERROR: Persistent database at ${paths.dbFile} could not be read or parsed as JSON (${err?.message || err}). Refusing to overwrite existing data.`
      );
      process.exit(1);
    }

    if (!isValidPersistedDatabaseShape(parsed)) {
      console.error(
        `ERROR: Persistent database at ${paths.dbFile} has an invalid schema. Refusing to overwrite existing data.`
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

    // Save with backup rotation and verification
    const currentBytes = fs.readFileSync(paths.dbFile);
    writeBytesAtomically(paths.bakFile, currentBytes, 0o600);
    writeAndVerifyAuthoritativeDb(paths, parsed, {
      initMode: 'existing_verified',
      incrementSaveCount: true,
      recoveryReason: null,
      updateBackup: false,
    });
    console.log(
      `Recovered Admin Code hash in ${paths.dbFile} while preserving all teams, players, purses, and auction state.`
    );
    console.log('Restart the application server if it is currently running.');
  });
  process.exit(0);
}
