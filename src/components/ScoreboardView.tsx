import { useState, useEffect } from 'react';
import { Team, Player } from '../types';
import { Trophy, Users, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';

interface ScoreboardViewProps {
  teams: Team[];
  players: Player[];
}

export default function ScoreboardView({ teams, players }: ScoreboardViewProps) {
  // Bug fix: ALL teams are collapsed/hidden by default irrespective of who checks them
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({
    team_a: true,
    team_b: true,
    team_c: true,
    team_d: true,
  });

  // Whenever the user unmounts/leaves this component, ensure everything collapses
  useEffect(() => {
    return () => {
      setCollapsedTeams({
        team_a: true,
        team_b: true,
        team_c: true,
        team_d: true,
      });
    };
  }, []);

  const toggleTeam = (teamId: string) => {
    setCollapsedTeams((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  const getTeamAvatar = (code: string) => {
    const letter = code.replace('Team ', '');
    return (
      <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-bold flex items-center justify-center text-xs shadow-2xs">
        {letter}
      </div>
    );
  };

  const getCategoryColor = (role: string) => {
    switch (role) {
      case 'Batsman':
        return 'text-blue-700 font-medium';
      case 'Bowler':
        return 'text-slate-700 font-medium';
      case 'Allrounder':
        return 'text-emerald-700 font-medium';
      case 'Wicketkeeper':
        return 'text-amber-700 font-medium';
      default:
        return 'text-slate-600';
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      {/* Title Header: Minimalist Blue/White */}
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Auction Scoreboard
        </h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-1">
          Live auction results, purse analytics, and team standings
        </p>
        <div className="w-12 h-1 bg-blue-600 mx-auto mt-2.5 rounded-full" />
      </div>

      {/* 1. Team Scores Summary Table Card */}
      <div className="bg-white rounded-xl shadow-xs border border-blue-200/80 p-6 sm:p-7 mb-8 overflow-hidden">
        <div className="flex items-center gap-2 mb-5">
          <Trophy className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-bold text-slate-900">Team Standings</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider bg-slate-50/60">
                <th className="py-3 px-4 rounded-l-lg">Team</th>
                <th className="py-3 px-4 text-center">Players</th>
                <th className="py-3 px-4 text-center">Total Value</th>
                <th className="py-3 px-4 text-center">Auction Cost</th>
                <th className="py-3 px-4 text-center font-bold text-blue-900">Initial Budget</th>
                <th className="py-3 px-4 text-center">Remaining</th>
                <th className="py-3 px-4 text-center rounded-r-lg">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teams.map((team) => {
                const teamPlayers = players.filter((p) => p.teamId === team.id);
                const count = teamPlayers.length;

                return (
                  <tr key={team.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4 font-bold text-slate-900 flex items-center gap-2.5">
                      {getTeamAvatar(team.code)}
                      <span>
                        {team.name && team.name.trim() ? team.name.trim() : team.code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                      {count}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-blue-600">
                      {team.totalValue.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-slate-600">
                      {team.totalSpent} M$
                    </td>
                    <td className="py-3.5 px-4 text-center font-bold text-slate-900">
                      {team.baseBudget} M$
                    </td>
                    <td className="py-3.5 px-4 text-center font-extrabold text-blue-600">
                      {team.remainingBudget} M$
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {team.isQualified ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ✓ QUALIFIED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          ✕ NOT QUALIFIED
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Team Squad Details Accordions */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2 mb-5">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">Team Squad Details</h3>
          </div>
          <span className="text-xs text-slate-400">
            Click 'Show Details' on any team to review full squad analytics
          </span>
        </div>

        <div className="space-y-4">
          {teams.map((team) => {
            const teamPlayers = players.filter((p) => p.teamId === team.id);
            const startingPlayers = teamPlayers.filter((p) => p.type === 'Starting');
            const auctionPlayers = teamPlayers.filter((p) => p.type === 'Auction');

            const batsmen = teamPlayers.filter((p) => p.role === 'Batsman').length;
            const bowlers = teamPlayers.filter((p) => p.role === 'Bowler').length;
            const allrounders = teamPlayers.filter((p) => p.role === 'Allrounder').length;
            const wicketkeepers = teamPlayers.filter((p) => p.role === 'Wicketkeeper').length;
            const total = teamPlayers.length;

            const isCollapsed = collapsedTeams[team.id];

            return (
              <div
                key={team.id}
                className="bg-white rounded-xl shadow-xs border border-blue-200 overflow-hidden hover:border-blue-300 transition"
              >
                {/* Header row - All teams start hidden */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
                  <div className="flex items-center gap-3">
                    {getTeamAvatar(team.code)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">
                          {team.name && team.name.trim() ? team.name.trim() : team.code}
                        </span>
                        {team.isQualified ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            QUALIFIED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            NOT QUALIFIED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {total} players • {team.totalSpent} M$ spent on auctions • {team.remainingBudget} M$ remaining
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleTeam(team.id)}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer self-start sm:self-auto"
                  >
                    <span>{isCollapsed ? 'Show Details' : 'Hide Details'}</span>
                    {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Qualification Requirements - Always visible below team name (both collapsed & expanded) */}
                <div className="px-4 sm:px-5 pb-4 pt-1 bg-white border-t border-slate-100">
                  <div
                    className={`rounded-lg p-3 sm:p-3.5 border border-blue-500 ${
                      team.isQualified
                        ? 'bg-emerald-50/50'
                        : 'bg-rose-50/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      {team.isQualified ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <h4
                        className={`font-bold text-xs ${
                          team.isQualified ? 'text-emerald-900' : 'text-rose-900'
                        }`}
                      >
                        {team.isQualified
                          ? '✓ Qualification Requirements Satisfied'
                          : '⚠️ Qualification Requirements Not Met'}
                      </h4>
                    </div>

                    {/* 4 Category Blocks */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2.5">
                      {/* Batsman */}
                      <div
                        className={`p-2 rounded-md border text-center ${
                          batsmen >= 3
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/70 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="text-[10px] font-semibold text-slate-600">Batsman</div>
                        <div className="font-extrabold text-sm">{batsmen}/3</div>
                        <div className="text-[10px] font-medium mt-0.5">
                          {batsmen >= 3 ? (
                            <span className="text-emerald-600">✓ Complete</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              Need {3 - batsmen} more
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bowler */}
                      <div
                        className={`p-2 rounded-md border text-center ${
                          bowlers >= 2
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/70 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="text-[10px] font-semibold text-slate-600">Bowler</div>
                        <div className="font-extrabold text-sm">{bowlers}/2</div>
                        <div className="text-[10px] font-medium mt-0.5">
                          {bowlers >= 2 ? (
                            <span className="text-emerald-600">✓ Complete</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              Need {2 - bowlers} more
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Allrounder */}
                      <div
                        className={`p-2 rounded-md border text-center ${
                          allrounders >= 1
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/70 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="text-[10px] font-semibold text-slate-600">
                          Allrounder
                        </div>
                        <div className="font-extrabold text-sm">{allrounders}/1</div>
                        <div className="text-[10px] font-medium mt-0.5">
                          {allrounders >= 1 ? (
                            <span className="text-emerald-600">✓ Complete</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              Need {1 - allrounders} more
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Wicketkeeper */}
                      <div
                        className={`p-2 rounded-md border text-center ${
                          wicketkeepers >= 1
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/70 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="text-[10px] font-semibold text-slate-600">
                          Wicketkeeper
                        </div>
                        <div className="font-extrabold text-sm">{wicketkeepers}/1</div>
                        <div className="text-[10px] font-medium mt-0.5">
                          {wicketkeepers >= 1 ? (
                            <span className="text-emerald-600">✓ Complete</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              Need {1 - wicketkeepers} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Total squad requirement notification banner */}
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-900 flex items-center gap-1.5">
                      <span>ℹ️</span>
                      <span>
                        <strong>Total Players: {total}/8</strong>{' '}
                        {total >= 8
                          ? '(Minimum squad size met)'
                          : `(Need ${8 - total} more players overall)`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Collapsible Deeper Details: 4 Stat Tiles, Budget Analysis & Full Squad Roster Table */}
                {!isCollapsed && (
                  <div className="p-4 sm:p-5 space-y-4 border-t border-slate-100 bg-slate-50/40 animate-in fade-in duration-150">
                    {/* 4 Stat Tiles */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-white rounded-lg p-3 text-center border border-slate-200 shadow-2xs">
                        <div className="text-lg font-bold text-blue-600 mb-0.5">
                          {startingPlayers.length}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Starting Players</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 text-center border border-slate-200 shadow-2xs">
                        <div className="text-lg font-bold text-emerald-600 mb-0.5">
                          {auctionPlayers.length}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Auction Players</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 text-center border border-slate-200 shadow-2xs">
                        <div className="text-lg font-bold text-slate-700 mb-0.5">
                          {team.totalSpent} M$
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Total Spent</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 text-center border border-slate-200 shadow-2xs">
                        <div className="text-lg font-bold text-slate-900 mb-0.5">
                          {team.baseBudget} M$
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Initial Budget</div>
                      </div>
                    </div>

                    {/* Budget Analysis Card */}
                    <div className="bg-white border border-blue-200 rounded-lg p-3.5 shadow-2xs">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Wallet className="w-3.5 h-3.5 text-blue-600" />
                        <h4 className="font-bold text-xs text-slate-800">Budget Analysis</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 text-xs">
                        <div className="flex justify-between sm:pr-6 text-slate-600">
                          <span>Initial Budget:</span>
                          <span className="font-bold text-slate-900">{team.baseBudget} M$</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Spent on Auctions:</span>
                          <span className="font-bold text-slate-800">{team.totalSpent} M$</span>
                        </div>
                        <div className="flex justify-between sm:pr-6 text-slate-600 pt-1 border-t border-slate-100">
                          <span>Squad Total Points:</span>
                          <span className="font-bold text-blue-600">{team.totalValue.toLocaleString()} pts</span>
                        </div>
                        <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-100">
                          <span className="font-bold text-slate-800">Remaining Budget:</span>
                          <span className="font-extrabold text-blue-600">{team.remainingBudget} M$</span>
                        </div>
                      </div>
                    </div>

                    {/* Squad Players Table */}
                    <div className="overflow-x-auto bg-white rounded-lg border border-blue-200">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 font-semibold text-[10px] uppercase bg-slate-50">
                            <th className="py-2.5 px-3">Player</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3 text-center">Type</th>
                            <th className="py-2.5 px-3 text-center">Value</th>
                            <th className="py-2.5 px-3 text-center">Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {teamPlayers.map((player) => (
                            <tr key={player.id} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                {player.name}
                              </td>
                              <td className={`py-2.5 px-3 ${getCategoryColor(player.role)}`}>
                                {player.role}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                    player.type === 'Starting'
                                      ? 'bg-slate-100 text-slate-700'
                                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                                  }`}
                                >
                                  {player.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold text-blue-600">
                                {player.valuePoints}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-700 font-medium">
                                {player.soldCost !== null ? `${player.soldCost} M$` : '0 M$'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
