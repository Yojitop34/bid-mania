import { useState, useEffect } from 'react';
import { UserAuth, Team } from '../types';
import { Shield, Users, KeyRound, AlertCircle, Trophy, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';

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
  onClose,
  allowClose = false,
}: LoginModalProps) {
  const [roleMode, setRoleMode] = useState<'participant' | 'admin'>('participant');
  const [teamCode, setTeamCode] = useState<string>('');
  const [adminCode, setAdminCode] = useState<string>('');
  const [showAdminCode, setShowAdminCode] = useState<boolean>(false);
  const [showChangeCode, setShowChangeCode] = useState<boolean>(false);
  const [changePassword, setChangePassword] = useState<string>('');
  const [showChangePassword, setShowChangePassword] = useState<boolean>(false);
  const [newAdminCode, setNewAdminCode] = useState<string>('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState<string | null>(null);
  const [changeLoading, setChangeLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Server-enforced cooldown countdown state (source of truth is server retryAfterSeconds)
  const [loginCooldownUntilMs, setLoginCooldownUntilMs] = useState<number | null>(null);
  const [loginCooldownSeconds, setLoginCooldownSeconds] = useState<number>(0);
  const [loginCooldownPhase, setLoginCooldownPhase] = useState<'activated' | 'blocked' | null>(null);

  const [changeCooldownUntilMs, setChangeCooldownUntilMs] = useState<number | null>(null);
  const [changeCooldownSeconds, setChangeCooldownSeconds] = useState<number>(0);
  const [changeCooldownPhase, setChangeCooldownPhase] = useState<'activated' | 'blocked' | null>(null);

  useEffect(() => {
    if (!loginCooldownUntilMs) {
      setLoginCooldownSeconds(0);
      setLoginCooldownPhase(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((loginCooldownUntilMs - Date.now()) / 1000));
      setLoginCooldownSeconds(remaining);
      if (remaining <= 0) {
        setLoginCooldownUntilMs(null);
        setLoginCooldownPhase(null);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 250);
    return () => clearInterval(interval);
  }, [loginCooldownUntilMs]);

  useEffect(() => {
    if (!changeCooldownUntilMs) {
      setChangeCooldownSeconds(0);
      setChangeCooldownPhase(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((changeCooldownUntilMs - Date.now()) / 1000));
      setChangeCooldownSeconds(remaining);
      if (remaining <= 0) {
        setChangeCooldownUntilMs(null);
        setChangeCooldownPhase(null);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 250);
    return () => clearInterval(interval);
  }, [changeCooldownUntilMs]);

  // Reset transient sensitive state on close (preserve active cooldown timers)
  useEffect(() => {
    if (!isOpen) {
      setTeamCode('');
      setAdminCode('');
      setError(null);
      setShowAdminCode(false);
      setShowChangeCode(false);
      setChangePassword('');
      setShowChangePassword(false);
      setNewAdminCode('');
      setChangeError(null);
      setChangeSuccess(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (loginCooldownSeconds <= 0) {
      if (roleMode === 'admin' && !adminCode.trim()) {
        setError('Please enter your confidential Admin Access Code.');
        return;
      }

      if (roleMode === 'participant' && !teamCode.trim()) {
        setError('Please enter your Team Code.');
        return;
      }
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
      if (
        res.status === 429 ||
        (typeof data?.retryAfterSeconds === 'number' && data.retryAfterSeconds > 0)
      ) {
        const seconds = Math.max(1, Math.ceil(Number(data?.retryAfterSeconds) || 30));
        setLoginCooldownPhase(data?.cooldownActivated ? 'activated' : 'blocked');
        setLoginCooldownSeconds(seconds);
        setLoginCooldownUntilMs(Date.now() + seconds * 1000);
        setError(null);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setLoginCooldownUntilMs(null);
      setLoginCooldownSeconds(0);
      setLoginCooldownPhase(null);
      onLoginSuccess({
        role: data.role,
        selectedTeam: data.selectedTeam,
        gameCode: data.gameCode,
        sessionToken: data.sessionToken,
      });
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };


  const handleSaveAdminCode = async () => {
    setChangeError(null);
    setChangeSuccess(null);

    const trimmedNewCode = newAdminCode.trim();
    if (changeCooldownSeconds <= 0) {
      if (!changePassword) {
        setChangeError('Please enter the authorization password.');
        return;
      }

      if (!trimmedNewCode) {
        setChangeError('Please enter a new Admin Code.');
        return;
      }

      if (trimmedNewCode.length < 4 || trimmedNewCode.length > 64 || /\s/.test(trimmedNewCode)) {
        setChangeError('New Admin Code must be 4-64 non-whitespace characters.');
        return;
      }
    }

    setChangeLoading(true);
    try {
      const res = await fetch('/api/auth/change-admin-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: changePassword,
          newAdminCode: trimmedNewCode,
        }),
      });
      const data = await res.json();
      if (
        res.status === 429 ||
        (typeof data?.retryAfterSeconds === 'number' && data.retryAfterSeconds > 0)
      ) {
        const seconds = Math.max(1, Math.ceil(Number(data?.retryAfterSeconds) || 30));
        setChangeCooldownPhase(data?.cooldownActivated ? 'activated' : 'blocked');
        setChangeCooldownSeconds(seconds);
        setChangeCooldownUntilMs(Date.now() + seconds * 1000);
        setChangeError(null);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update admin code.');
      }

      setChangeCooldownUntilMs(null);
      setChangeCooldownSeconds(0);
      setChangeCooldownPhase(null);
      setChangePassword('');
      setShowChangePassword(false);
      setNewAdminCode('');
      setChangeSuccess(data.message || 'Admin code updated successfully.');
    } catch (err: any) {
      setChangeError(err.message || 'Failed to update admin code.');
    } finally {
      setChangeLoading(false);
    }
  };

  const formatSecondsLabel = (n: number) => `${n} ${n === 1 ? 'second' : 'seconds'}`;

  const activeLoginErrorMessage =
    loginCooldownSeconds > 0
      ? loginCooldownPhase === 'activated'
        ? `Too many failed login attempts. Please wait ${formatSecondsLabel(loginCooldownSeconds)} before trying again.`
        : `Login temporarily blocked. Please try again in ${formatSecondsLabel(loginCooldownSeconds)}.`
      : error;

  const activeChangeErrorMessage =
    changeCooldownSeconds > 0
      ? changeCooldownPhase === 'activated'
        ? `Too many failed authorization attempts. Please wait ${formatSecondsLabel(changeCooldownSeconds)} before trying again.`
        : `Authorization temporarily blocked. Please try again in ${formatSecondsLabel(changeCooldownSeconds)}.`
      : changeError;

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
          {!(roleMode === 'admin' && showChangeCode) && (
            <div className="flex rounded-lg bg-slate-100 p-1 mb-5">
              <button
                type="button"
                onClick={() => {
                  setRoleMode('participant');
                  setError(null);
                  setShowAdminCode(false);
                  setShowChangeCode(false);
                  setChangePassword('');
                  setShowChangePassword(false);
                  setNewAdminCode('');
                  setChangeError(null);
                  setChangeSuccess(null);
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
          )}

          {roleMode === 'admin' && showChangeCode ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveAdminCode();
              }}
              className="space-y-4"
            >
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setShowChangeCode(false);
                    setChangePassword('');
                    setShowChangePassword(false);
                    setNewAdminCode('');
                    setChangeError(null);
                    setChangeSuccess(null);
                  }}
                  aria-label="Back to Admin Login"
                  title="Back"
                  className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 hover:text-slate-900 active:scale-95 transition cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Enter Password
                  </label>
                  <div className="relative">
                    <input
                      type={showChangePassword ? 'text' : 'password'}
                      value={changePassword}
                      onChange={(e) => setChangePassword(e.target.value)}
                      placeholder="Enter Password"
                      className="w-full px-3.5 py-2 pr-10 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowChangePassword((prev) => !prev)}
                      aria-label={showChangePassword ? 'Hide password' : 'Show password'}
                      title={showChangePassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 active:scale-95 transition cursor-pointer"
                    >
                      {showChangePassword ? (
                        <Eye className="w-4 h-4" strokeWidth={2} />
                      ) : (
                        <EyeOff className="w-4 h-4" strokeWidth={2} />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    New Admin Code
                  </label>
                  <input
                    type="text"
                    value={newAdminCode}
                    onChange={(e) => setNewAdminCode(e.target.value)}
                    placeholder="Enter New Admin Code"
                    className="w-full px-3.5 py-2 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {activeChangeErrorMessage && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-2.5 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                  <span>{activeChangeErrorMessage}</span>
                </div>
              )}

              {changeSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-2.5 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  <span>{changeSuccess}</span>
                </div>
              )}

              <div className="flex justify-center pt-1">
                <button
                  type="submit"
                  disabled={changeLoading}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {changeLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
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
                        placeholder="Enter Team Code"
                        className="w-full px-3.5 py-2 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 uppercase"
                      />
                      <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
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
                        type={showAdminCode ? 'text' : 'password'}
                        required
                        value={adminCode}
                        onChange={(e) => setAdminCode(e.target.value)}
                        placeholder="Enter Admin Access Code"
                        className="w-full px-3.5 py-2 pr-10 text-sm font-mono font-bold tracking-wider bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminCode((prev) => !prev)}
                        aria-label={showAdminCode ? 'Hide admin code' : 'Show admin code'}
                        title={showAdminCode ? 'Hide admin code' : 'Show admin code'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 active:scale-95 transition cursor-pointer"
                      >
                        {showAdminCode ? (
                          <Eye className="w-4 h-4" strokeWidth={2} />
                        ) : (
                          <EyeOff className="w-4 h-4" strokeWidth={2} />
                        )}
                      </button>
                    </div>

                    {/* Subtle grey underlined option below Admin Code textbox */}
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setShowChangeCode(true);
                          setChangeError(null);
                          setChangeSuccess(null);
                        }}
                        className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2 cursor-pointer transition-colors"
                      >
                        Change Admin Code
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {activeLoginErrorMessage && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-2.5 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                  <span>{activeLoginErrorMessage}</span>
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
                    <span>Enter as Team Player</span>
                  </>
                )}
              </button>
            </form>
          )}

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
