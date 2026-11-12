import { useState, useEffect } from 'react';
import { UserAuth, Team } from '../types';
import { Shield, Users, LogOut, AlertTriangle, Wallet, RotateCcw, Check, Volume2, VolumeX } from 'lucide-react';

interface HeaderProps {
  auth: UserAuth | null;
  teams?: Team[];
  universalPurse?: number;
  isConnected?: boolean;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  onClearDatabase: () => void;
  onUpdatePurse?: (teamId: string, newPurse: number) => void;
  onLogout: () => void;
  onOpenLogin: () => void;
}

export default function Header({
  auth,
  teams = [],
  universalPurse = 800,
  isConnected,
  soundEnabled = true,
  onToggleSound,
  onClearDatabase,
  onUpdatePurse,
  onLogout,
  onOpenLogin,
}: HeaderProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPurseModal, setShowPurseModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // State for purse adjustment modal
  const [allPurseValue, setAllPurseValue] = useState<string>('800');
  const [individualPurses, setIndividualPurses] = useState<Record<string, string>>({
    team_a: '800',
    team_b: '800',
    team_c: '800',
    team_d: '800',
  });
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);
  const [purseError, setPurseError] = useState<string | null>(null);

  const handleOpenPurseModal = () => {
    setPurseError(null);
    setSavedSuccess(null);
    if (teams && teams.length > 0) {
      const currentPurses: Record<string, string> = {};
      teams.forEach((t) => {
        currentPurses[t.id] = (t.remainingBudget ?? 800).toString();
      });
      setIndividualPurses(currentPurses);
    }
    setAllPurseValue((universalPurse ?? 800).toString());
    setShowPurseModal(true);
  };

  // Keep modal inputs synced in real-time when team purses change from server updates
  useEffect(() => {
    if (!showPurseModal || !teams || teams.length === 0) return;
    const syncedPurses: Record<string, string> = {};
    teams.forEach((t) => {
      syncedPurses[t.id] = (t.remainingBudget ?? 0).toString();
    });
    setIndividualPurses(syncedPurses);
  }, [teams, showPurseModal]);

  const handleStepAllPurse = (delta: number) => {
    const current = parseInt(allPurseValue.trim(), 10);
    const base = isNaN(current) ? 0 : current;
    setAllPurseValue(Math.max(0, base + delta).toString());
  };

  const handleStepSinglePurse = (teamId: string, fallback: number, delta: number) => {
    const raw = (individualPurses[teamId] ?? fallback.toString()).trim();
    const current = parseInt(raw, 10);
    const base = isNaN(current) ? fallback : current;
    setIndividualPurses((prev) => ({
      ...prev,
      [teamId]: Math.max(0, base + delta).toString(),
    }));
  };

  const handleSetAllPurses = (e: React.FormEvent) => {
    e.preventDefault();
    setPurseError(null);
    const val = parseInt(allPurseValue.trim(), 10);
    if (isNaN(val) || val < 0) {
      setPurseError('Please enter a valid non-negative purse amount in M$ (e.g. 800).');
      return;
    }
    if (onUpdatePurse) {
      onUpdatePurse('all', val);
      setSavedSuccess(`All team remaining purses updated to ${val} M$ successfully!`);
      setTimeout(() => setSavedSuccess(null), 2500);
    }
  };

  const handleSetSinglePurse = (teamId: string) => {
    setPurseError(null);
    const teamObj = teams.find((t) => t.id === teamId);
    const teamDisplay =
      teamObj?.name && teamObj.name.trim() ? teamObj.name.trim() : teamObj?.code || teamId.toUpperCase();
    const val = parseInt((individualPurses[teamId] || '').trim(), 10);
    if (isNaN(val) || val < 0) {
      setPurseError(`Please enter a valid non-negative purse amount for ${teamDisplay}.`);
      return;
    }
    if (onUpdatePurse) {
      onUpdatePurse(teamId, val);
      setSavedSuccess(`Updated remaining purse for ${teamDisplay} to ${val} M$!`);
      setTimeout(() => setSavedSuccess(null), 2000);
    }
  };

  const handleConfirmClear = () => {
    onClearDatabase();
    setShowClearConfirm(false);
  };

  const renderFullscreenSvg = () => {
    if (isFullscreen) {
      return (
        <>
          {/* Opposing / Inward pointing arrows when in fullscreen */}
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <polyline points="4 14 10 14 10 20" />
          <line x1="10" y1="14" x2="3" y2="21" />
        </>
      );
    }
    return (
      <>
        {/* Outward pointing arrows */}
        <polyline points="15 3 21 3 21 9" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </>
    );
  };

  return (
    <>
      <header className="relative w-full bg-[#0f172a] text-white border-b border-slate-800 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex flex-col md:flex-row items-center justify-between gap-2.5 sm:gap-3">
          {/* Row 1 on mobile: [Expand] [Volume] - [Bid Mania Simulation] - [Logout] | On PC: Left branding + Volume */}
          <div className="w-full md:w-auto flex items-center justify-between md:justify-start gap-2">
            {/* Mobile-only left buttons: Expand, followed immediately by Volume */}
            <div className="flex items-center gap-1.5 md:hidden">
              {auth ? (
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  title={isFullscreen ? 'Compress' : 'Expand'}
                  aria-label={isFullscreen ? 'Compress' : 'Expand'}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition text-xs border border-slate-700 hover:border-slate-600 cursor-pointer flex items-center justify-center shrink-0 group"
                >
                  <svg
                    className="w-3.5 h-3.5 text-white group-hover:scale-110 transition-transform"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {renderFullscreenSvg()}
                  </svg>
                </button>
              ) : null}

              {/* Volume Button on Mobile (after expand option) */}
              {onToggleSound && (
                <button
                  type="button"
                  onClick={onToggleSound}
                  title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
                  aria-label={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 hover:border-slate-600 cursor-pointer flex items-center justify-center shrink-0 group"
                >
                  {soundEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-400 group-hover:scale-110 transition-transform" />
                  )}
                </button>
              )}
            </div>

            {/* Title & Badge */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-sm sm:text-base shrink-0">
                🏆
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                  Bid Mania
                  <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-blue-400 bg-blue-950/80 px-1.5 sm:px-2 py-0.5 rounded border border-blue-800/60">
                    Simulation
                  </span>
                </h1>
              </div>

              {/* PC Volume Toggle Button (immediately after "🏆 Bid Mania Simulation") */}
              {onToggleSound && (
                <button
                  type="button"
                  onClick={onToggleSound}
                  title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
                  aria-label={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
                  className="hidden md:flex p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 hover:border-slate-600 cursor-pointer items-center justify-center shrink-0 ml-1 group"
                >
                  {soundEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-400 group-hover:scale-110 transition-transform" />
                  )}
                </button>
              )}
            </div>

            {/* Mobile-only Logout button to the right of title */}
            {auth ? (
              <button
                onClick={onLogout}
                className="md:hidden p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 cursor-pointer flex items-center justify-center shrink-0"
                title="Switch Role or Exit"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="w-7 md:hidden shrink-0" />
            )}
          </div>

          {/* Row 2 on mobile: Single line for [Host / Admin], [Adjust Purses], [Reset] | On PC: Full controls row */}
          <div className="w-full md:w-auto flex items-center justify-center md:justify-end gap-1.5 sm:gap-2.5 flex-nowrap overflow-x-auto no-scrollbar py-0.5">
            {auth ? (
              <>
                {/* Desktop-only Expand / Fullscreen Button (to the left of Host/Admin on PC) */}
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  title={isFullscreen ? 'Compress' : 'Expand'}
                  aria-label={isFullscreen ? 'Compress' : 'Expand'}
                  className="hidden md:flex p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition text-xs border border-slate-700 hover:border-slate-600 cursor-pointer items-center justify-center shrink-0 group"
                >
                  <svg
                    className="w-3.5 h-3.5 text-white group-hover:scale-110 transition-transform"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {renderFullscreenSvg()}
                  </svg>
                </button>

                {/* Team / Role Chip */}
                {(() => {
                  const userTeam = teams.find(
                    (t) =>
                      t.code.toLowerCase() === (auth.selectedTeam || '').toLowerCase() ||
                      t.id.toLowerCase() === (auth.selectedTeam || '').toLowerCase()
                  );
                  const teamDisplayName =
                    userTeam?.name && userTeam.name.trim()
                      ? userTeam.name.trim()
                      : auth.selectedTeam || 'Participant';

                  return (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold border shrink-0 ${
                        auth.role === 'admin'
                          ? 'bg-blue-950/70 text-blue-300 border-blue-800/70'
                          : 'bg-slate-800 text-slate-200 border-slate-700'
                      }`}
                      title={
                        auth.role === 'admin'
                          ? 'Authenticated as Host / Admin'
                          : `Authenticated as ${teamDisplayName}`
                      }
                    >
                      {auth.role === 'admin' ? (
                        <Shield className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
                      )}
                      <span className="truncate max-w-[120px] sm:max-w-[160px] whitespace-nowrap">
                        {auth.role === 'admin' ? 'Host / Admin' : teamDisplayName}
                      </span>
                    </div>
                  );
                })()}

                {/* Admin Features: Adjust Purses & Reset in the same single line */}
                {auth.role === 'admin' && (
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      onClick={handleOpenPurseModal}
                      className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium text-xs rounded-lg shadow-xs transition cursor-pointer shrink-0 whitespace-nowrap"
                      title="Adjust Purse amounts for teams anytime"
                    >
                      <Wallet className="w-3.5 h-3.5 shrink-0" />
                      <span>Adjust Purses</span>
                    </button>

                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 bg-slate-800 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 font-medium text-xs rounded-lg transition border border-slate-700 hover:border-rose-800/80 cursor-pointer shrink-0 whitespace-nowrap"
                      title="Reset auction state to default 800M budgets"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Reset</span>
                    </button>
                  </div>
                )}

                {/* Desktop-only Logout Button */}
                <button
                  onClick={onLogout}
                  className="hidden md:flex p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs border border-slate-700 cursor-pointer items-center justify-center shrink-0"
                  title="Switch Role or Exit"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={onOpenLogin}
                className="px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-500 font-medium text-xs rounded-lg shadow-xs transition"
              >
                Login / Join
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Admin Adjust Purse Modal */}
      {showPurseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 text-gray-900 border border-slate-100">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-blue-600">
                <Wallet className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-slate-900">Adjust Team Purses</h3>
              </div>
              <button
                onClick={() => setShowPurseModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-5 leading-relaxed">
              As Admin, you can adjust the current remaining purse for all teams simultaneously or customize individual teams in real time. Initial budget adjusts automatically to match any auction spending.
            </p>

            {savedSuccess && (
              <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{savedSuccess}</span>
              </div>
            )}

            {purseError && (
              <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{purseError}</span>
              </div>
            )}

            {/* Quick Set All Teams Purse */}
            <form onSubmit={handleSetAllPurses} className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 mb-5">
              <div className="text-xs font-bold text-slate-800 mb-2">
                Set Universal Remaining Purse for All 4 Teams
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleStepAllPurse(-50)}
                    className="w-9 h-9 flex items-center justify-center bg-white hover:bg-slate-100 active:scale-95 border border-slate-300 rounded-lg text-slate-700 font-bold text-sm transition cursor-pointer"
                    title="Decrease by 50 M$"
                  >
                    -
                  </button>
                  <div className="flex items-baseline w-24 px-2.5 py-2 bg-white border border-slate-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500">
                    <input
                      type="number"
                      min="0"
                      value={allPurseValue}
                      onChange={(e) => setAllPurseValue(e.target.value)}
                      placeholder="800"
                      className="w-full min-w-0 p-0 bg-transparent text-sm text-right font-semibold leading-normal focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="ml-1 text-xs font-bold text-slate-400 leading-normal shrink-0 select-none">
                      M$
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStepAllPurse(50)}
                    className="w-9 h-9 flex items-center justify-center bg-white hover:bg-slate-100 active:scale-95 border border-slate-300 rounded-lg text-slate-700 font-bold text-sm transition cursor-pointer"
                    title="Increase by 50 M$"
                  >
                    +
                  </button>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs rounded-lg shadow-xs transition cursor-pointer"
                >
                  Apply to All
                </button>
              </div>
            </form>

            {/* Individual Team Purse Adjustments */}
            <div className="space-y-3 mb-6">
              <div className="text-xs font-bold text-slate-800">
                Individual Team Purses (Remaining Purse):
              </div>
              {teams.map((t) => {
                const currentVal = individualPurses[t.id] ?? t.remainingBudget.toString();
                const displayName = t.name && t.name.trim() ? t.name.trim() : t.code;
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                        {t.code.replace('Team ', '')}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {displayName}
                        </div>
                        {t.totalSpent > 0 && (
                          <div className="text-[10px] text-slate-400">
                            Spent: {t.totalSpent} M$
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStepSinglePurse(t.id, t.remainingBudget, -50)}
                        className="w-7 h-7 flex items-center justify-center bg-slate-50 hover:bg-slate-100 active:scale-95 border border-slate-300 rounded-md text-slate-700 font-bold text-sm transition cursor-pointer"
                        title="Decrease by 50 M$"
                      >
                        -
                      </button>
                      <div className="flex items-baseline w-20 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-md focus-within:ring-2 focus-within:ring-blue-500">
                        <input
                          type="number"
                          min="0"
                          value={currentVal}
                          onChange={(e) =>
                            setIndividualPurses((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                          className="w-full min-w-0 p-0 bg-transparent text-xs text-right font-semibold leading-normal focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="ml-1 text-[11px] font-bold text-slate-400 leading-normal shrink-0 select-none">
                          M$
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStepSinglePurse(t.id, t.remainingBudget, 50)}
                        className="w-7 h-7 flex items-center justify-center bg-slate-50 hover:bg-slate-100 active:scale-95 border border-slate-300 rounded-md text-slate-700 font-bold text-sm transition cursor-pointer"
                        title="Increase by 50 M$"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetSinglePurse(t.id)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white font-medium text-xs rounded-md transition cursor-pointer ml-0.5"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPurseModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Database Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-gray-900 border border-slate-100">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-2 rounded-full bg-rose-50 text-rose-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Reset Auction State?</h3>
            </div>
            <p className="text-xs text-slate-600 mb-5 leading-relaxed">
              This will reset all team purses back to their default $800M, unassign all auction players, and cancel active bids. Pre-assigned starting players will remain intact.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClear}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Database
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
