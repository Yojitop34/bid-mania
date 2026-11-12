import { useState, useEffect, useRef } from 'react';
import { ActiveAuction, Player, Team, UserAuth } from '../types';
import { Gavel, Clock, Trophy, AlertCircle, CheckCircle, Zap, Shield, Target, ArrowLeft } from 'lucide-react';
import { calculateQualification } from '../utils/qualification';
import { playStopwatchTick, playWinningSoundtrack } from '../utils/soundEffects';
import confetti from 'canvas-confetti';

interface LiveBiddingArenaProps {
  activeAuction: ActiveAuction;
  players: Player[];
  teams: Team[];
  auth: UserAuth | null;
  onPlaceBid: (teamCode: string, amount: number) => void;
  onEndBidding: (offlineAward?: { teamId: string; amount: number }) => void;
  onExtendTimer?: () => void;
  onCloseArena: () => void;
  onViewScoreboard?: () => void;
  soundEnabled?: boolean;
  errorMsg: string | null;
  onClearError: () => void;
}

export default function LiveBiddingArena({
  activeAuction,
  players,
  teams,
  auth,
  onPlaceBid,
  onEndBidding,
  onExtendTimer,
  onCloseArena,
  onViewScoreboard,
  soundEnabled = true,
  errorMsg,
  onClearError,
}: LiveBiddingArenaProps) {
  const player = players.find((p) => p.id === activeAuction.playerId);
  const assignedTeam = auth?.selectedTeam || 'Team A';
  const [bidAmountInput, setBidAmountInput] = useState<string>('');
  const [offlineTeamId, setOfflineTeamId] = useState<string>('');
  const [offlinePriceInput, setOfflinePriceInput] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isOffline = activeAuction.biddingType === 'offline';

  const lastPlayedSecondRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const soldSoundPlayedRef = useRef<string | null>(null);

  // Reset offline inputs when a new auction starts
  useEffect(() => {
    setOfflineTeamId('');
    setOfflinePriceInput('');
    setLocalError(null);
  }, [activeAuction.playerId, activeAuction.startedAt]);

  // Synchronized stopwatch ticking sound with countdown timer (Online mode only)
  // Anti-jitter: strict decrement check + 650ms minimum interval to prevent bunched / overlapping sounds
  useEffect(() => {
    if (
      !isOffline &&
      soundEnabled &&
      activeAuction.status === 'bidding' &&
      typeof activeAuction.timerSeconds === 'number' &&
      activeAuction.timerSeconds > 0
    ) {
      const currentSec = activeAuction.timerSeconds;
      const now = performance.now();

      if (lastPlayedSecondRef.current === null) {
        lastPlayedSecondRef.current = currentSec;
        lastTickTimeRef.current = now;
        playStopwatchTick(currentSec <= 5);
        return;
      }

      if (currentSec !== lastPlayedSecondRef.current) {
        const isDecrement = currentSec < lastPlayedSecondRef.current;
        const isReasonableInterval = now - lastTickTimeRef.current >= 650;
        lastPlayedSecondRef.current = currentSec;

        if (isDecrement && isReasonableInterval) {
          lastTickTimeRef.current = now;
          playStopwatchTick(currentSec <= 5);
        }
      }
    } else if (activeAuction.status !== 'bidding' || isOffline) {
      lastPlayedSecondRef.current = null;
    }
  }, [activeAuction.timerSeconds, activeAuction.status, soundEnabled, isOffline]);

  // Confetti and celebratory victory fanfare when sold (exact once per completed sale)
  useEffect(() => {
    if (activeAuction.status === 'sold') {
      const saleKey = `${activeAuction.playerId}_${activeAuction.currentBid}_${activeAuction.currentTeam}`;
      if (soldSoundPlayedRef.current !== saleKey) {
        soldSoundPlayedRef.current = saleKey;
        try {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.5 },
          });
        } catch {
          // ignore
        }
        if (soundEnabled) {
          playWinningSoundtrack();
        }
      }
    } else {
      soldSoundPlayedRef.current = null;
    }
  }, [activeAuction.status, activeAuction.playerId, activeAuction.currentBid, activeAuction.currentTeam, soundEnabled]);

  if (!player && activeAuction.status === 'idle') {
    return null;
  }

  const isFirstBid = activeAuction.currentBid === null;
  const minValidBid = isFirstBid
    ? (player?.basePrice || 50)
    : (activeAuction.currentBid || 0) + 20;

  const currentTeamObj = teams.find((t) => t.code === assignedTeam);
  const currentTeamPurse = currentTeamObj?.remainingBudget ?? 0;

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'Batsman':
        return 'bg-blue-600/90 text-white border border-blue-400/40';
      case 'Bowler':
        return 'bg-slate-700/90 text-white border border-slate-500/40';
      case 'Allrounder':
        return 'bg-emerald-600/90 text-white border border-emerald-400/40';
      case 'Wicketkeeper':
        return 'bg-amber-600/90 text-white border border-amber-400/40';
      default:
        return 'bg-slate-700/90 text-white';
    }
  };

  const handleQuickAmount = (amount: number) => {
    setBidAmountInput(amount.toString());
    setLocalError(null);
    onClearError();
  };

  const handleSubmitBid = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    onClearError();

    const numAmount = parseInt(bidAmountInput.trim(), 10);
    if (isNaN(numAmount) || numAmount <= 0) {
      setLocalError('Please enter a valid positive number in millions.');
      return;
    }

    if (numAmount < minValidBid) {
      if (isFirstBid) {
        setLocalError(`First bid must be at least the base price of ${minValidBid} M$.`);
      } else {
        setLocalError(
          `Bid must be at least ${minValidBid} M$ (Current bid + 20 M$ increment).`
        );
      }
      return;
    }

    if (numAmount > currentTeamPurse) {
      setLocalError(
        `Insufficient purse! ${assignedTeam} only has ${currentTeamPurse} M$ remaining.`
      );
      return;
    }

    onPlaceBid(assignedTeam, numAmount);
    setBidAmountInput('');
  };

  const handleEndOfflineBidding = () => {
    setLocalError(null);
    onClearError();

    const hasTeam = Boolean(offlineTeamId);
    const hasPrice = Boolean(offlinePriceInput.trim());

    if (!hasTeam && !hasPrice) {
      onEndBidding();
      return;
    }

    if (!hasTeam) {
      setLocalError('Please select a team, or clear the price to mark as unsold.');
      return;
    }

    const numAmount = Number(offlinePriceInput.trim());
    if (!hasPrice || isNaN(numAmount) || numAmount <= 0) {
      setLocalError('Please enter a valid price in millions (M$), or clear the team to mark as unsold.');
      return;
    }

    const minBase = player?.basePrice || 0;
    if (numAmount < minBase) {
      setLocalError(
        `Please enter an amount equal to or higher than the Base price of ${minBase} M$`
      );
      return;
    }

    const chosenTeam = teams.find((t) => t.id === offlineTeamId);
    if (chosenTeam && numAmount > chosenTeam.remainingBudget) {
      const displayName =
        chosenTeam.name && chosenTeam.name.trim() ? chosenTeam.name.trim() : chosenTeam.code;
      setLocalError(
        `Insufficient purse! ${displayName} only has ${chosenTeam.remainingBudget} M$ remaining.`
      );
      return;
    }

    onEndBidding({ teamId: offlineTeamId, amount: numAmount });
  };

  const isAdmin = auth?.role === 'admin';

  return (
    <div className="max-w-6xl mx-auto py-2.5 sm:py-3.5 px-3 sm:px-5 space-y-2.5 animate-in fade-in duration-200">
      {/* Top Banner Navigation / Close Bar */}
      <div className="flex items-center justify-between pb-0.5">
        <button
          onClick={onCloseArena}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Exit Live Arena</span>
        </button>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-amber-600" />
              <span>Host Control View</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
              Team Bidding Portal
            </span>
          )}
        </div>
      </div>

      {/* Main Rounded Rectangular Bidding Interface */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        {/* Expanded Top Header Bar (No circular avatar, role/value/base moved to middle card) */}
        {/* Expanded Top Header Bar (No circular avatar, role/value/base moved to middle card) */}
        <div className="bg-slate-900 text-white px-3.5 sm:px-5 py-2.5 sm:py-3">
          {/* Desktop Version (sm and above): Completely unchanged */}
          <div className="hidden sm:flex sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
              <h3 className="text-lg sm:text-2xl font-black text-white tracking-tight">
                {player?.name}
              </h3>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-600 text-white shadow-2xs tracking-wide">
                Player #{player?.id}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-white/10 text-slate-200 border border-white/15">
                Lot {player?.lotNumber} ({player?.lotName})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span>{isOffline ? 'OFFLINE BIDDING' : 'LIVE BIDDING'}</span>
              </span>
              {isAdmin && activeAuction.status === 'bidding' && (
                <button
                  onClick={() => (isOffline ? handleEndOfflineBidding() : onEndBidding())}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                  title="Award player to winner immediately"
                >
                  <Gavel className="w-3.5 h-3.5" />
                  <span>End Bidding Now</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Version (below sm): 
              Line 1: H. Pandya Player #1     LIVE BIDDING
              Line 2: Lot 1 (Premium Players)
              Line 3 (Admin only): End Bidding Now
          */}
          <div className="sm:hidden flex flex-col space-y-1.5 w-full">
            {/* Line 1: Player Name + #1 on Left, LIVE BIDDING on Right */}
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-1.5 truncate">
                <h3 className="text-base font-black text-white tracking-tight truncate">
                  {player?.name}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white shadow-2xs tracking-wide shrink-0">
                  Player #{player?.id}
                </span>
              </div>

              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                <span>{isOffline ? 'OFFLINE BIDDING' : 'LIVE BIDDING'}</span>
              </span>
            </div>

            {/* Line 2: Lot info */}
            <div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-slate-200 border border-white/15 inline-block">
                Lot {player?.lotNumber} ({player?.lotName})
              </span>
            </div>

            {/* Line 3 (Admin only): End Bidding Now button */}
            {isAdmin && activeAuction.status === 'bidding' && (
              <div className="pt-0.5">
                <button
                  onClick={() => (isOffline ? handleEndOfflineBidding() : onEndBidding())}
                  className="w-full py-1.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Award player to winner immediately"
                >
                  <Gavel className="w-3.5 h-3.5" />
                  <span>End Bidding Now</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bidding Core Area (3-Column Viewport Optimized Layout) */}
        <div className="p-3 sm:p-4">
          {activeAuction.status === 'sold' ? (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 sm:p-5 text-center text-emerald-950 animate-in zoom-in-95 duration-150">
              <div className="flex justify-center mb-1.5">
                <CheckCircle className="w-9 h-9 text-emerald-600 animate-bounce" />
              </div>
              <h4 className="text-xl font-black uppercase tracking-wide">
                AUCTION CONCLUDED — SOLD!
              </h4>
              <p className="text-sm font-semibold mt-1">
                Player awarded to{' '}
                <span className="font-extrabold text-emerald-800 text-base">
                  {(() => {
                    const winTeam = teams.find(
                      (t) =>
                        t.code.toLowerCase() === (activeAuction.currentTeam || '').toLowerCase() ||
                        (t.name && t.name.toLowerCase() === (activeAuction.currentTeam || '').toLowerCase())
                    );
                    return winTeam?.name && winTeam.name.trim()
                      ? winTeam.name.trim()
                      : activeAuction.currentTeam;
                  })()}
                </span>{' '}
                for{' '}
                <span className="font-extrabold text-emerald-700 text-lg">{activeAuction.currentBid} M$</span>
              </p>
              <p className="text-[11px] text-emerald-700 mt-1">
                Team purse deducted and player assigned to team roster in database.
              </p>
              <div className="mt-3.5">
                <button
                  onClick={onViewScoreboard || onCloseArena}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-xs transition cursor-pointer"
                >
                  View Scoreboard
                </button>
              </div>
            </div>
          ) : activeAuction.status === 'unsold' ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 text-center text-slate-700">
              <h4 className="text-lg font-bold uppercase text-slate-900">PLAYER UNSOLD</h4>
              <p className="text-xs text-slate-500 mt-1">
                Auction ended with no qualifying bids placed. Player remains in Lot catalog.
              </p>
              <div className="mt-3">
                <button
                  onClick={onCloseArena}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-black text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                >
                  Return to Player Display
                </button>
              </div>
            </div>
          ) : (
            (() => {
              const renderTimerCard = () => (
                <div
                  className={`rounded-xl border text-center transition-all shadow-2xs ${
                    isAdmin ? 'p-2.5 sm:p-3' : 'p-3.5 sm:p-4'
                  } ${
                    activeAuction.timerSeconds <= 5
                      ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    <span>Countdown Timer</span>
                  </div>
                  <div className="flex items-center justify-center my-0.5 sm:my-1">
                    <div className="text-3xl sm:text-4xl font-black tracking-tight">
                      {activeAuction.timerSeconds}
                      <span className="text-lg font-bold text-slate-400 ml-1">s</span>
                    </div>
                    {isAdmin && activeAuction.status === 'bidding' && (
                      <button
                        type="button"
                        onClick={() => onExtendTimer?.()}
                        className="ml-3 px-2.5 py-0.5 rounded text-sm sm:text-base font-semibold bg-slate-900/15 hover:bg-slate-900/25 text-slate-800 backdrop-blur-xs transition active:scale-95 cursor-pointer"
                        title="Add 30 seconds to countdown timer (capped at max duration)"
                      >
                        + 30s
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                    Limit: {activeAuction.timerDuration || 120}s (Resets on every valid bid)
                  </div>
                </div>
              );

              const renderHighestBidCard = () => (
                <div
                  className={`bg-white rounded-xl border border-slate-200 text-center shadow-2xs ${
                    isAdmin ? 'p-2.5 sm:p-3' : 'p-3.5 sm:p-4'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <Trophy className="w-3.5 h-3.5 text-blue-600" />
                    <span>Current Highest Bid</span>
                  </div>

                  {activeAuction.currentBid !== null ? (
                    <>
                      <div className="text-2xl sm:text-3xl font-extrabold text-blue-600 tracking-tight my-0.5 sm:my-1">
                        {activeAuction.currentBid}{' '}
                        <span className="text-base font-bold text-slate-600">M$</span>
                      </div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200">
                        <span>
                          {(() => {
                            const winTeam = teams.find(
                              (t) =>
                                t.code.toLowerCase() === (activeAuction.currentTeam || '').toLowerCase() ||
                                (t.name && t.name.toLowerCase() === (activeAuction.currentTeam || '').toLowerCase())
                            );
                            return winTeam?.name && winTeam.name.trim()
                              ? winTeam.name.trim()
                              : activeAuction.currentTeam;
                          })()}{' '}
                          is winning
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg sm:text-xl font-bold text-slate-400 my-0.5 sm:my-1">
                        No Bids Yet
                      </div>
                      <div className="text-xs font-semibold text-blue-700 bg-blue-50 px-3 py-0.5 rounded-full inline-block">
                        Base Price: {player?.basePrice} M$
                      </div>
                    </>
                  )}
                </div>
              );

              const renderHostActionCard = () => (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-2 sm:p-2.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                      <Shield className="w-3.5 h-3.5 text-amber-700" />
                      <span>Host Action</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onEndBidding()}
                    className="w-full py-1.5 sm:py-2 bg-rose-600 hover:bg-rose-500 active:scale-98 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Gavel className="w-3.5 h-3.5" />
                    <span>End Bidding (Award Winner Now)</span>
                  </button>
                </div>
              );

              const renderPlayerImageCard = () => (
                <div className="relative w-[235px] sm:w-[245px] h-[308px] sm:h-[318px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-2xs group flex flex-col justify-end mx-auto">
                  <img
                    src={player?.imageUrl}
                    alt={player?.name}
                    className="absolute inset-0 w-full h-full object-cover object-top transition duration-300 group-hover:scale-102"
                  />
                  <div className="absolute top-2.5 left-2.5 bg-slate-900/85 backdrop-blur-xs text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-xs z-10">
                    #{player?.id}
                  </div>
                  <div className="absolute top-2.5 right-2.5 bg-slate-900/75 backdrop-blur-xs text-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded border border-white/10 z-10">
                    Lot {player?.lotNumber}
                  </div>
                  <div className="relative z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent pt-12 pb-3 px-3 text-white">
                    <h4 className="text-sm font-extrabold tracking-tight mb-1.5 text-white drop-shadow-xs truncate">
                      {player?.name}
                    </h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold ${getRoleBadge(
                          player?.role
                        )}`}
                      >
                        {player?.role}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-semibold bg-white/20 text-white backdrop-blur-xs">
                        {player?.valuePoints} pts
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold bg-blue-600 text-white shadow-2xs">
                        {player?.basePrice} M$
                      </span>
                    </div>
                  </div>
                </div>
              );

              const renderHostMonitorCard = () => (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 sm:p-3 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h4 className="font-bold text-xs text-slate-900">
                        Host Live Monitor
                      </h4>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                      Admin Spectator
                    </span>
                  </div>
                  <div className="space-y-1.5 pt-0.5">
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                      <div className="text-[10px] text-slate-500 font-medium">Leading Team:</div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5">
                        {(() => {
                          if (!activeAuction.currentTeam) return 'None yet';
                          const winTeam = teams.find(
                            (t) =>
                              t.code.toLowerCase() === activeAuction.currentTeam?.toLowerCase() ||
                              (t.name && t.name.toLowerCase() === activeAuction.currentTeam?.toLowerCase())
                          );
                          return winTeam?.name && winTeam.name.trim()
                            ? winTeam.name.trim()
                            : activeAuction.currentTeam;
                        })()}
                      </div>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                      <div className="text-[10px] text-slate-500 font-medium">Leading Amount:</div>
                      <div className="text-xs sm:text-sm font-bold text-blue-600 mt-0.5">
                        {activeAuction.currentBid !== null ? `${activeAuction.currentBid} M$` : 'Awaiting 1st bid'}
                      </div>
                    </div>
                  </div>
                </div>
              );

              const renderPlayerBidForm = () => (
                <form onSubmit={handleSubmitBid} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 sm:p-3 space-y-2 shadow-2xs">
                  <div className="bg-white border border-slate-200 rounded-xl p-2 text-center shadow-2xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Bidding As
                    </div>
                    <div className="text-lg sm:text-xl font-black text-slate-900 tracking-tight my-0.5">
                      {currentTeamObj?.name && currentTeamObj.name.trim()
                        ? currentTeamObj.name.trim()
                        : assignedTeam}
                    </div>
                    <div className="text-xs text-slate-600">
                      Available Purse:{' '}
                      <strong className="text-blue-600 font-extrabold text-xs sm:text-sm">
                        {currentTeamPurse} M$
                      </strong>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-bold text-slate-700">
                        Bid Amount (Millions M$):
                      </label>
                      <span className="text-[10px] text-slate-500">
                        Min: <strong>{minValidBid} M$</strong>
                      </span>
                    </div>

                    <div className="relative">
                      <input
                        type="number"
                        step="1"
                        min={minValidBid}
                        value={bidAmountInput}
                        onChange={(e) => {
                          setBidAmountInput(e.target.value);
                          setLocalError(null);
                          onClearError();
                        }}
                        placeholder={`e.g. ${minValidBid}`}
                        className="w-full px-3 py-1.5 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="absolute right-3 top-1.5 text-xs font-bold text-slate-400">
                        M$
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <button
                        type="button"
                        onClick={() => handleQuickAmount(minValidBid)}
                        className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-200/80 hover:bg-slate-300 text-slate-800 transition cursor-pointer"
                      >
                        Min: {minValidBid} M$
                      </button>
                      {!isFirstBid && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleQuickAmount(minValidBid + 20)}
                            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-100 hover:bg-blue-200 text-blue-800 transition cursor-pointer"
                          >
                            +{20} M$ ({minValidBid + 20} M$)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickAmount(minValidBid + 50)}
                            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-100 hover:bg-blue-200 text-blue-800 transition cursor-pointer"
                          >
                            +{50} M$ ({minValidBid + 50} M$)
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {(localError || errorMsg) && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[11px] p-2 rounded-lg flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                      <span>{localError || errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-1.5 sm:py-2 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Gavel className="w-3.5 h-3.5" />
                    <span>
                      Submit Bid for{' '}
                      {currentTeamObj?.name && currentTeamObj.name.trim()
                        ? currentTeamObj.name.trim()
                        : assignedTeam}
                    </span>
                  </button>
                </form>
              );

              const renderLiveStreamCard = () => (
                <div className="bg-white border border-slate-200 rounded-xl p-2.5 sm:p-3 shadow-2xs">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-blue-600" />
                    <span>Live Bid Activity Stream</span>
                  </div>

                  {activeAuction.bidHistory && activeAuction.bidHistory.length > 0 ? (
                    <div className="space-y-1 max-h-24 sm:max-h-28 overflow-y-auto pr-1">
                      {activeAuction.bidHistory.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-100 text-[11px]"
                        >
                          <span className="font-bold text-slate-900">{item.teamCode}</span>
                          <span className="font-extrabold text-blue-600">{item.amount} M$</span>
                          <span className="text-[9px] text-slate-400">{item.timestamp}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 italic py-2.5 sm:py-3.5 text-center">
                      Waiting for the first bid to be submitted...
                    </div>
                  )}
                </div>
              );

              const renderOfflineAdminPanel = () => (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-2xs">
                  {/* i) Select Team Dropdown */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Select Team:
                    </label>
                    <select
                      value={offlineTeamId}
                      onChange={(e) => {
                        setOfflineTeamId(e.target.value);
                        setLocalError(null);
                        onClearError();
                      }}
                      className="w-full px-3 py-2 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer text-slate-900"
                    >
                      <option value="">-- Select Team --</option>
                      {teams.map((team) => {
                        const displayName =
                          team.name && team.name.trim() ? team.name.trim() : team.code;
                        return (
                          <option key={team.id} value={team.id}>
                            {displayName}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* ii) Enter Price in M (Million) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Enter Price
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={offlinePriceInput}
                        onChange={(e) => {
                          setOfflinePriceInput(e.target.value);
                          setLocalError(null);
                          onClearError();
                        }}
                        placeholder="Enter price in M$ (e.g. 80)"
                        className="w-full px-3 py-2 pr-12 text-sm font-bold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900"
                      />
                      <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">
                        M$
                      </span>
                    </div>
                  </div>

                  {(localError || errorMsg) && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-2.5 rounded-lg flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{localError || errorMsg}</span>
                    </div>
                  )}

                  {/* iii) Host Action: End Bidding (Award Winner Now) */}
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-2.5 sm:p-3 shadow-2xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                        <Shield className="w-3.5 h-3.5 text-amber-700" />
                        <span>Host Action</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleEndOfflineBidding}
                      className="w-full py-2 sm:py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-98 text-white font-bold text-xs rounded-lg shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Gavel className="w-3.5 h-3.5" />
                      <span>End Bidding (Award Winner Now)</span>
                    </button>
                  </div>
                </div>
              );

              const renderOfflinePlayerDetailsCard = () => (
                <div className="bg-gradient-to-br from-slate-50/90 to-blue-50/40 border border-slate-200/80 rounded-2xl px-5 py-3 shadow-2xs divide-y divide-slate-200/70">
                  <div className="py-3 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-950">Player type :</span>
                    <span className="text-sm font-extrabold text-slate-900">{player?.role}</span>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-950">Points :</span>
                    <span className="text-sm font-extrabold text-emerald-700">
                      {player?.valuePoints} pts
                    </span>
                  </div>
                  <div className="py-3 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-950">Base Price :</span>
                    <span className="text-sm font-extrabold text-blue-600">
                      {player?.basePrice} M$
                    </span>
                  </div>
                </div>
              );

              const offlineTeamDisplayName =
                currentTeamObj?.name && currentTeamObj.name.trim()
                  ? currentTeamObj.name.trim()
                  : assignedTeam;

              const renderOfflineRepresentingTeamCard = () => (
                <div className="bg-gradient-to-br from-blue-50/60 via-white to-slate-50/80 border border-slate-200/80 rounded-2xl px-6 py-7 text-center shadow-2xs flex flex-col items-center justify-center min-h-[164px]">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100/70 px-3 py-1 rounded-full mb-3">
                    Representing Team
                  </h2>
                  <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight break-words max-w-full">
                    {offlineTeamDisplayName}
                  </h3>
                  <div className="w-10 h-0.5 bg-blue-500/60 rounded-full mt-2.5" />
                </div>
              );

              if (isOffline) {
                if (isAdmin) {
                  return (
                    <>
                      {/* Offline Admin Desktop: Player image on left, Select Team + Enter Price + Host Action aligned to end around OFFLINE badge */}
                      <div className="hidden lg:grid lg:grid-cols-12 gap-4 items-center">
                        <div className="lg:col-span-4 flex flex-col items-center justify-start">
                          {renderPlayerImageCard()}
                        </div>
                        <div className="lg:col-span-6 flex flex-col justify-center">
                          {renderOfflineAdminPanel()}
                        </div>
                      </div>

                      {/* Offline Admin Mobile: Player image followed by Offline Admin Panel */}
                      <div className="lg:hidden flex flex-col space-y-3">
                        {renderPlayerImageCard()}
                        {renderOfflineAdminPanel()}
                      </div>
                    </>
                  );
                }

                // Offline Player Side: Player info on left, Cricketer image centered, Representing Team on right
                return (
                  <>
                    <div className="hidden lg:grid lg:grid-cols-12 gap-4 items-center">
                      <div className="lg:col-span-4">
                        {renderOfflinePlayerDetailsCard()}
                      </div>
                      <div className="lg:col-span-4 flex flex-col items-center justify-center">
                        {renderPlayerImageCard()}
                      </div>
                      <div className="lg:col-span-4">
                        {renderOfflineRepresentingTeamCard()}
                      </div>
                    </div>

                    <div className="lg:hidden flex flex-col space-y-3">
                      {renderPlayerImageCard()}
                      {renderOfflinePlayerDetailsCard()}
                      {renderOfflineRepresentingTeamCard()}
                    </div>
                  </>
                );
              }

              return (
                <>
                  {/* Desktop 3-Column Layout: Unchanged PC Looks */}
                  <div className="hidden lg:grid lg:grid-cols-12 gap-3.5 items-start">
                    {/* Left Column: Timer & Highest Bid & Admin Action */}
                    <div className="lg:col-span-4 flex flex-col space-y-2">
                      {renderTimerCard()}
                      {renderHighestBidCard()}
                      {isAdmin && renderHostActionCard()}
                    </div>

                    {/* Middle Column: Player Card */}
                    <div className="lg:col-span-4 flex flex-col items-center justify-start">
                      {renderPlayerImageCard()}
                    </div>

                    {/* Right Column: Host Monitor / Player Form + Stream */}
                    <div className="lg:col-span-4 flex flex-col space-y-2">
                      {isAdmin ? renderHostMonitorCard() : renderPlayerBidForm()}
                      {renderLiveStreamCard()}
                    </div>
                  </div>

                  {/* Mobile-Only Vertical Layout as specified */}
                  <div className="lg:hidden flex flex-col space-y-3">
                    {isAdmin ? (
                      <>
                        {/* Admin Mobile Order:
                            1. Player image with all the info present now
                            2. Countdown Timer
                            3. Current Highest Bid
                            4. Host Action: End Bidding (Award Winner Now)
                            5. Host Live Monitor
                            6. Live Bid Activity Stream
                        */}
                        {renderPlayerImageCard()}
                        {renderTimerCard()}
                        {renderHighestBidCard()}
                        {renderHostActionCard()}
                        {renderHostMonitorCard()}
                        {renderLiveStreamCard()}
                      </>
                    ) : (
                      <>
                        {/* Player Mobile Order:
                            1. Countdown Timer
                            2. Player image with all the info present now
                            3. Bidding Form
                            4. Current Highest Bid
                            5. Live Bid Activity Stream
                        */}
                        {renderTimerCard()}
                        {renderPlayerImageCard()}
                        {renderPlayerBidForm()}
                        {renderHighestBidCard()}
                        {renderLiveStreamCard()}
                      </>
                    )}
                  </div>
                </>
              );
            })()
          )}
        </div>
      </div>

      {/* Feature 2b: Strategic Horizontal Qualification Matrix */}
      <div className="bg-white rounded-xl shadow-xs border border-blue-200 p-3 sm:p-4 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-slate-100 pb-2">
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-blue-600" />
              <span>Competitor Qualification Intelligence</span>
            </h4>
            <p className="text-[10px] sm:text-[11px] text-slate-500">
              Live breakdown of rival team roster needs to inform strategic counter-bidding
            </p>
          </div>
          <div className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 self-start sm:self-auto">
            Auctioning: <strong className="text-blue-600">{player?.role}</strong> ({player?.name})
          </div>
        </div>

        {/* 4 Horizontal Columns: Team A | Team B | Team C | Team D */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {teams.map((team) => {
            const qual = calculateQualification(team.id, players);
            const teamPlayers = players.filter((p) => p.teamId === team.id);

            // User Rule:
            // Primary assigned required slots are: 3 Batsmen, 2 Bowlers, 1 Allrounder, 1 Wicketkeeper (total 7)
            const missingBatsmen = qual.missing.batsmen;
            const missingBowlers = qual.missing.bowlers;
            const missingAllrounders = qual.missing.allrounders;
            const missingWicketkeepers = qual.missing.wicketkeepers;
            const totalMissingPrimarySlots =
              missingBatsmen + missingBowlers + missingAllrounders + missingWicketkeepers;

            // ONLY show Urgent Need when the team is missing EXACTLY ONE primary role slot overall!
            let singleMissingRole: string | null = null;
            if (totalMissingPrimarySlots === 1) {
              if (missingBatsmen === 1) singleMissingRole = 'BATSMAN';
              else if (missingBowlers === 1) singleMissingRole = 'BOWLER';
              else if (missingAllrounders === 1) singleMissingRole = 'ALLROUNDER';
              else if (missingWicketkeepers === 1) singleMissingRole = 'WICKETKEEPER';
            }

            // Highlighting when current auction player matches what this team needs
            const auctionMatchesNeed =
              player &&
              ((player.role.toLowerCase() === 'batsman' && missingBatsmen > 0) ||
                (player.role.toLowerCase() === 'bowler' && missingBowlers > 0) ||
                (player.role.toLowerCase() === 'allrounder' && missingAllrounders > 0) ||
                (player.role.toLowerCase() === 'wicketkeeper' && missingWicketkeepers > 0));

            return (
              <div
                key={team.id}
                className="rounded-lg p-2.5 sm:p-3 border transition-all border-blue-500 bg-white hover:border-blue-600 shadow-xs"
              >
                {/* Team Header */}
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                      {team.code.replace('Team ', '')}
                    </div>
                    <div className="font-bold text-xs text-slate-900 truncate">
                      {team.name && team.name.trim() ? team.name.trim() : team.code}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-extrabold text-blue-600">
                      {team.remainingBudget} M$
                    </div>
                    <div className="text-[8px] text-slate-400">Purse Left</div>
                  </div>
                </div>

                {/* Urgent Need Banner - Shown ONLY when exactly ONE primary role is needed, with eye-catching medium-light red blinking animation */}
                {singleMissingRole && (
                  <div
                    className="text-[10px] font-black px-2 py-1 rounded-md mb-2 text-center uppercase tracking-wider border animate-urgent-blink flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-700 shrink-0" />
                    <span>🎯 Urgent Need: {singleMissingRole}</span>
                    {player && player.role.toUpperCase() === singleMissingRole && (
                      <span className="text-[9px] bg-rose-700 text-white px-1.5 py-0.2 rounded font-black tracking-normal ml-0.5 shadow-2xs">
                        ON BLOCK!
                      </span>
                    )}
                  </div>
                )}

                {/* Qualification Badge or Role Breakdown */}
                {team.isQualified ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center my-1">
                    <div className="text-emerald-700 font-black text-xs uppercase tracking-wider">
                      ✓ QUALIFIED
                    </div>
                    <div className="text-[10px] text-emerald-800 font-semibold mt-0.5">
                      {teamPlayers.length}/8 Players • {team.remainingBudget} M$
                    </div>
                    <div className="text-[8px] text-emerald-600 mt-0.5 italic">
                      Can bid aggressively or drive up prices
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-xs">
                    {/* Batsman */}
                    <div className="flex justify-between items-center text-[10px] sm:text-[11px]">
                      <span className="text-slate-600">Batsmen (min 3):</span>
                      {missingBatsmen > 0 ? (
                        <span className="font-bold text-rose-600 bg-rose-50 px-1 py-0.2 rounded text-[10px] border border-rose-200">
                          Need {missingBatsmen}
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-600 text-[10px]">
                          ✓ Complete ({qual.batsmen})
                        </span>
                      )}
                    </div>

                    {/* Bowler */}
                    <div className="flex justify-between items-center text-[10px] sm:text-[11px]">
                      <span className="text-slate-600">Bowlers (min 2):</span>
                      {missingBowlers > 0 ? (
                        <span className="font-bold text-rose-600 bg-rose-50 px-1 py-0.2 rounded text-[10px] border border-rose-200">
                          Need {missingBowlers}
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-600 text-[10px]">
                          ✓ Complete ({qual.bowlers})
                        </span>
                      )}
                    </div>

                    {/* Allrounder */}
                    <div className="flex justify-between items-center text-[10px] sm:text-[11px]">
                      <span className="text-slate-600">Allrounder (min 1):</span>
                      {missingAllrounders > 0 ? (
                        <span className="font-bold text-rose-600 bg-rose-50 px-1 py-0.2 rounded text-[10px] border border-rose-200">
                          Need {missingAllrounders}
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-600 text-[10px]">
                          ✓ Complete ({qual.allrounders})
                        </span>
                      )}
                    </div>

                    {/* Wicketkeeper */}
                    <div className="flex justify-between items-center text-[10px] sm:text-[11px]">
                      <span className="text-slate-600">Wicketkeeper (min 1):</span>
                      {missingWicketkeepers > 0 ? (
                        <span className="font-bold text-rose-600 bg-rose-50 px-1 py-0.2 rounded text-[10px] border border-rose-200">
                          Need {missingWicketkeepers}
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-600 text-[10px]">
                          ✓ Complete ({qual.wicketkeepers})
                        </span>
                      )}
                    </div>

                    <div className="pt-1.5 mt-1 border-t border-slate-100 flex justify-between text-[10px] text-slate-500 font-medium">
                      <span>Total Squad:</span>
                      <span className="font-bold text-slate-800">{teamPlayers.length} / 8</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
