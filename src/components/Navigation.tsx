import { TabType, UserAuth, Team } from '../types';
import { Home, Users, ClipboardList, Shield, BarChart3 } from 'lucide-react';

interface NavigationProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  auth: UserAuth | null;
  teams?: Team[];
}

export default function Navigation({ currentTab, onSelectTab, auth, teams = [] }: NavigationProps) {
  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: 'welcome', label: 'Welcome', icon: Home },
    { id: 'players', label: 'Player Display', icon: Users },
    { id: 'instructions', label: 'Instructions', icon: ClipboardList },
    { id: 'teams', label: 'Team Information', icon: Shield },
    { id: 'scoreboard', label: 'Scoreboard', icon: BarChart3 },
  ];

  const getTeamBadgeStyle = (teamName?: string) => {
    switch (teamName) {
      case 'Team A':
        return 'bg-red-50 text-red-700 border-red-200 ring-1 ring-red-100';
      case 'Team B':
        return 'bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-100';
      case 'Team C':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100';
      case 'Team D':
        return 'bg-amber-50 text-amber-800 border-amber-200 ring-1 ring-amber-100';
      default:
        return 'bg-blue-50 text-blue-800 border-blue-200';
    }
  };

  const getTeamDotStyle = (teamName?: string) => {
    switch (teamName) {
      case 'Team A':
        return 'bg-red-500';
      case 'Team B':
        return 'bg-blue-500';
      case 'Team C':
        return 'bg-emerald-500';
      case 'Team D':
        return 'bg-amber-500';
      default:
        return 'bg-blue-500';
    }
  };

  return (
    <nav className="w-full bg-white border-b border-slate-200/80 shadow-2xs sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 relative">
        <div className="flex items-center justify-between py-2 sm:py-2.5">
          {/* Spacer on left for balanced centering on desktop */}
          <div className="hidden lg:block w-36 shrink-0" />

          {/* Center-aligned tabs balanced equally across remaining 5 panels with horizontal scroll on mobile */}
          <div className="flex-1 flex items-center justify-start sm:justify-center gap-1.5 sm:gap-3 lg:gap-4 overflow-x-auto no-scrollbar scroll-smooth">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 lg:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-blue-600 hover:bg-blue-50/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isActive ? 'text-white' : 'text-slate-500'} shrink-0`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Top Right Side Team Mentioning Badge (below the blue ribbon) */}
          <div className="shrink-0 pl-2">
            {auth?.role === 'admin' ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 shadow-2xs font-bold text-xs uppercase tracking-wider">
                <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="hidden sm:inline">Host /</span> Admin
              </div>
            ) : auth?.selectedTeam ? (
              (() => {
                const teamObj = teams.find(
                  (t) =>
                    t.code.trim().toLowerCase() === (auth.selectedTeam || '').trim().toLowerCase() ||
                    t.id.trim().toLowerCase() === (auth.selectedTeam || '').trim().toLowerCase()
                );
                const badgeLabel = teamObj?.name && teamObj.name.trim() ? teamObj.name.trim() : auth.selectedTeam;
                return (
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border shadow-2xs text-xs font-extrabold uppercase tracking-wider ${getTeamBadgeStyle(
                      auth.selectedTeam
                    )}`}
                    title={`You are authenticated as ${badgeLabel}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${getTeamDotStyle(auth.selectedTeam)} animate-pulse`} />
                    <span className="truncate max-w-[150px]">{badgeLabel}</span>
                  </div>
                );
              })()
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
