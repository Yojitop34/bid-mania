import { useState } from 'react';
import { Team, Player, UserAuth } from '../types';
import { Shield, Check, Pencil, KeyRound, X } from 'lucide-react';

interface TeamInfoViewProps {
  teams: Team[];
  players: Player[];
  auth: UserAuth | null;
  onUpdateTeamName: (teamId: string, name: string) => void;
  onUpdateTeamCode: (teamId: string, code: string) => void;
}

export default function TeamInfoView({
  teams,
  players,
  auth,
  onUpdateTeamName,
  onUpdateTeamCode,
}: TeamInfoViewProps) {
  // Center Modal state for editing franchise display name
  const [editingModalTeam, setEditingModalTeam] = useState<Team | null>(null);
  const [modalNameInput, setModalNameInput] = useState<string>('');

  // Team Code inputs & saved states for Admin
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [savedCodeTeamId, setSavedCodeTeamId] = useState<string | null>(null);

  const isAdmin = auth?.role === 'admin';

  const defaultCodes: Record<string, string> = {
    team_a: 'TEAMA777',
    team_b: 'TEAMB777',
    team_c: 'TEAMC777',
    team_d: 'TEAMD777',
  };

  const handleOpenEditModal = (team: Team) => {
    setEditingModalTeam(team);
    setModalNameInput(team.name || '');
  };

  const handleCloseModal = () => {
    setEditingModalTeam(null);
  };

  const handleModalSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModalTeam) return;

    onUpdateTeamName(editingModalTeam.id, modalNameInput.trim());
    setEditingModalTeam(null);
  };

  const handleCodeInputChange = (teamId: string, val: string) => {
    setCodeInputs((prev) => ({ ...prev, [teamId]: val }));
  };

  const handleSaveCode = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    const fallbackCode = defaultCodes[teamId] || 'TEAM777';
    const currentVal =
      codeInputs[teamId] !== undefined
        ? codeInputs[teamId]
        : team?.loginCode || fallbackCode;

    const trimmed = currentVal.trim().toUpperCase();
    if (!trimmed) return;

    onUpdateTeamCode(teamId, trimmed);
    setSavedCodeTeamId(teamId);
    setTimeout(() => setSavedCodeTeamId(null), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
      {/* Title Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Team Information
        </h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-1">
          Configure franchise names, review squad allocations, and manage credentials
        </p>
        <div className="w-12 h-1 bg-blue-600 mx-auto mt-2.5 rounded-full" />
      </div>

      {/* 2x2 Grid of Team Cards with Minimalist Blue/White Styling & Uniform Spacing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        {teams.map((team) => {
          const teamPlayers = players.filter((p) => p.teamId === team.id);
          const totalPlayersCount = teamPlayers.length;
          const letter = team.code.replace('Team ', '');

          // Permission check: Admin can edit any team; Participants can only edit their own team
          const isMyTeam = auth?.role === 'participant' && auth.selectedTeam === team.code;
          const canEditThisTeam = isAdmin || isMyTeam;

          // Name Display rule: If custom name exists, show ONLY the custom name (e.g. "Winners"). If none, fallback to default "Team A".
          const hasCustomName = Boolean(team.name && team.name.trim());
          const displayName = hasCustomName ? team.name.trim() : team.code;

          const fallbackCode = defaultCodes[team.id] || 'TEAM777';
          const currentCodeInput =
            codeInputs[team.id] !== undefined
              ? codeInputs[team.id]
              : team.loginCode || fallbackCode;

          const batsmenCount = teamPlayers.filter((p) => p.role === 'Batsman').length;
          const bowlersCount = teamPlayers.filter((p) => p.role === 'Bowler').length;
          const allroundersCount = teamPlayers.filter((p) => p.role === 'Allrounder').length;
          const wicketkeepersCount = teamPlayers.filter((p) => p.role === 'Wicketkeeper').length;

          return (
            <div
              key={team.id}
              className="bg-white rounded-xl shadow-xs border border-blue-500 p-5 transition hover:border-blue-600 flex flex-col justify-between"
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between mb-4 pb-3 border-b border-slate-100">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-extrabold text-sm shrink-0 mt-0.5">
                      {letter}
                    </div>
                    <div>
                      {/* Team Name + Pencil Edit Icon (Opens Center Pop-up Modal) */}
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                          {displayName}
                        </h3>
                        {canEditThisTeam && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(team)}
                            className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                            title="Edit Franchise Display Name"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Initial Budget & Purse Left */}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Initial Budget: <strong>{team.baseBudget} M$</strong> • Purse Left:{' '}
                        <strong className="text-blue-600">{team.remainingBudget} M$</strong>
                      </div>

                      {/* Feature 1a: Squad count pill placed directly below budget line without extra text */}
                      <div className="mt-1.5">
                        <span className="inline-block px-2.5 py-0.5 text-xs font-bold text-blue-700 bg-blue-50/70 border border-blue-500 rounded-md shadow-2xs">
                          {totalPlayersCount}/8
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Qualification badge */}
                  <div>
                    {team.isQualified ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        QUALIFIED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        NOT QUALIFIED
                      </span>
                    )}
                  </div>
                </div>

                {/* Qualification Requirement Box */}
                <div className="rounded-lg p-3 border border-blue-500 bg-blue-50/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                      <Shield className="w-3.5 h-3.5 text-blue-600" />
                      <span>Qualification Requirements</span>
                    </div>
                    {team.isQualified ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        ✓ Complete
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                        Pending
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                    <div
                      className={`p-1.5 rounded border ${
                        batsmenCount >= 3
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div className="font-semibold text-slate-600">Batsmen</div>
                      <div className="font-bold">{batsmenCount}/3</div>
                      <div className="text-[9px] mt-0.5">
                        {batsmenCount >= 3 ? '✓ Complete' : `Need ${3 - batsmenCount}`}
                      </div>
                    </div>
                    <div
                      className={`p-1.5 rounded border ${
                        bowlersCount >= 2
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div className="font-semibold text-slate-600">Bowlers</div>
                      <div className="font-bold">{bowlersCount}/2</div>
                      <div className="text-[9px] mt-0.5">
                        {bowlersCount >= 2 ? '✓ Complete' : `Need ${2 - bowlersCount}`}
                      </div>
                    </div>
                    <div
                      className={`p-1.5 rounded border ${
                        allroundersCount >= 1
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div className="font-semibold text-slate-600">Allrounder</div>
                      <div className="font-bold">{allroundersCount}/1</div>
                      <div className="text-[9px] mt-0.5">
                        {allroundersCount >= 1 ? '✓ Complete' : 'Need 1'}
                      </div>
                    </div>
                    <div
                      className={`p-1.5 rounded border ${
                        wicketkeepersCount >= 1
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div className="font-semibold text-slate-600">Keeper</div>
                      <div className="font-bold">{wicketkeepersCount}/1</div>
                      <div className="text-[9px] mt-0.5">
                        {wicketkeepersCount >= 1 ? '✓ Complete' : 'Need 1'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature 1d: Admin-Only Custom Team Code Manager (Flush with qualification box) */}
              {isAdmin && (
                <div className="mt-4 pt-3.5 border-t border-slate-100">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 uppercase tracking-wide">
                      <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                      <span>Team Code</span>
                    </span>
                    <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      Admin Only
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={currentCodeInput}
                      onChange={(e) => handleCodeInputChange(team.id, e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveCode(team.id);
                      }}
                      placeholder={fallbackCode}
                      className="flex-1 px-3 py-1.5 text-xs sm:text-sm font-mono font-bold tracking-wider border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 bg-slate-50/50 uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveCode(team.id)}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold rounded-lg shadow-xs transition flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {savedCodeTeamId === team.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-white" />
                          <span>Saved</span>
                        </>
                      ) : (
                        <span>Save</span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pop-up Menu in Center for Franchise Display Name */}
      {editingModalTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200 text-slate-900 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-600/30 text-blue-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Franchise Display Name</h3>
                  <p className="text-[11px] text-slate-400">
                    Update franchise branding for {editingModalTeam.code}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleModalSave} className="p-5 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Franchise Display Name
                </label>
                <input
                  type="text"
                  value={modalNameInput}
                  onChange={(e) => setModalNameInput(e.target.value)}
                  placeholder={`e.g. Winners, Claws, Mentora (default: ${editingModalTeam.code})`}
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 bg-slate-50 font-medium"
                  autoFocus
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Leave empty or enter a custom name. This name will appear across the scoreboard, bidding arena, and login screen.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
