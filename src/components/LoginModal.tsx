import { useState, useEffect } from 'react';
import { UserAuth, Team } from '../types';
import { Shield, Users, KeyRound, AlertCircle, Trophy, Sparkles } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onLoginSuccess: (auth: UserAuth) => void;
  teams?: Team[];
  onClose?: () => void;
  allowClose?: boolean;
}

export default function LoginModal({
  isOpen,
  onLoginSuccess,
  teams = [],
  onClose,
  allowClose = false,
}: LoginModalProps) {
  const [roleMode, setRoleMode] = useState<'participant' | 'admin'>('participant');
  const [modalTeams, setModalTeams] = useState<Team[]>(teams);
  const [teamCode, setTeamCode] = useState<string>('TEAMA777');
  const [adminCode, setAdminCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Sync teams prop
  useEffect(() => {
    if (teams && teams.length > 0) {
      setModalTeams(teams);
    }
  }, [teams]);

  // Fresh load on open to guarantee newest custom names and custom codes
  useEffect(() => {
    if (isOpen) {
      fetch('/api/state')
        .then((res) => res.json())
        .then((data) => {
          if (data?.teams && Array.isArray(data.teams)) {
            setModalTeams(data.teams);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (roleMode === 'admin' && !adminCode.trim()) {
      setError('Please enter your confidential Admin Access Code.');
      return;
    }

    if (roleMode === 'participant' && !teamCode.trim()) {
      setError('Please enter your Team Code (e.g. TEAMA777, TEAMB777, TEAMC777, TEAMD777).');
      return;
    }

    setLoading(true);

    try {
      const payload =
        roleMode === 'admin'
          ? { adminCode: adminCode.trim().toUpperCase() }
          : { teamCode: teamCode.trim().toUpperCase() };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onLoginSuccess({
        role: data.role,
        selectedTeam: data.selectedTeam,
        gameCode: data.gameCode,
      });
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTeamCode = (code: string) => {
    setTeamCode(code);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-100 text-slate-900">
        {/* Header with Minimalist Navy/Blue Theme */}
        <div className="bg-[#0f172a] p-6 text-white text-center border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-2 text-xl shadow-2xs">
            🏆
          </div>
          <h2 className="text-lg font-bold tracking-tight">Bid Mania Gateway</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Auction Simulation Access Portal
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {/* Role Switcher */}
          <div className="flex rounded-lg bg-slate-100 p-1 mb-5">
            <button
              type="button"
              onClick={() => {
                setRoleMode('participant');
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 cursor-pointer ${
                roleMode === 'participant'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-blue-600" />
              <span>Team Participant</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRoleMode('admin');
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition flex items-center justify-center gap-1.5 cursor-pointer ${
                roleMode === 'admin'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-blue-600" />
              <span>Host / Admin</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {roleMode === 'participant' ? (
              /* Participant: ONLY Ask for Team Code */
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Team Code
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Unique per franchise
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={teamCode}
                      onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
                      placeholder="e.g. TEAMA777"
                      className="w-full px-3.5 py-2 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 uppercase"
                    />
                    <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  </div>
                </div>

                {/* Quick Selection Buttons for 4 Teams */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-blue-500" />
                    <span>Select Team Code:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        id: 'team_a',
                        code: 'Team A',
                        defaultCode: 'TEAMA777',
                        activeClass: 'bg-red-50 border-red-300 text-red-700 ring-2 ring-red-100',
                      },
                      {
                        id: 'team_b',
                        code: 'Team B',
                        defaultCode: 'TEAMB777',
                        activeClass: 'bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-100',
                      },
                      {
                        id: 'team_c',
                        code: 'Team C',
                        defaultCode: 'TEAMC777',
                        activeClass: 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-100',
                      },
                      {
                        id: 'team_d',
                        code: 'Team D',
                        defaultCode: 'TEAMD777',
                        activeClass: 'bg-amber-50 border-amber-300 text-amber-800 ring-2 ring-amber-100',
                      },
                    ].map((item) => {
                      const foundTeam = modalTeams.find(
                        (t) => t.id === item.id || t.code === item.code
                      );
                      const activeCode = (foundTeam?.loginCode || item.defaultCode).toUpperCase();
                      // Exact user rule:
                      // If custom name is set (e.g. "Claws" or "Winners"), show ONLY "Claws" or "Winners"!
                      // If not set, show "Team B" or "Team A".
                      const activeName =
                        foundTeam?.name && foundTeam.name.trim()
                          ? foundTeam.name.trim()
                          : item.code;
                      const isSelected = teamCode.trim().toUpperCase() === activeCode;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectTeamCode(activeCode)}
                          className={`px-3 py-2 text-xs font-bold rounded-lg border text-left transition cursor-pointer ${
                            isSelected
                              ? item.activeClass
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="font-extrabold truncate text-xs">{activeName}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                            {activeCode}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Host / Admin: ONLY Ask for Admin Code */
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Admin Code
                    </label>
                    <span className="text-[11px] text-slate-400">
                      Host authority
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      value={adminCode}
                      onChange={(e) => setAdminCode(e.target.value)}
                      placeholder="Enter Admin Access Code"
                      className="w-full px-3.5 py-2 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <Shield className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-2.5 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Authenticating...</span>
              ) : roleMode === 'admin' ? (
                <>
                  <Shield className="w-4 h-4" />
                  <span>Enter as Host / Admin</span>
                </>
              ) : (
                <>
                  <Trophy className="w-4 h-4" />
                  <span>Enter as {teamCode.startsWith('TEAM') ? `Team ${teamCode.charAt(4)}` : 'Team Player'}</span>
                </>
              )}
            </button>
          </form>

          {allowClose && onClose && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Close Window
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
