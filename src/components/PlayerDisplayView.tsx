import { Player, ActiveAuction } from '../types';
import { Users, Gavel, CheckCircle } from 'lucide-react';

interface PlayerDisplayViewProps {
  players: Player[];
  activeAuction: ActiveAuction;
  onSelectPlayer: (player: Player) => void;
}

export default function PlayerDisplayView({
  players,
  activeAuction,
  onSelectPlayer,
}: PlayerDisplayViewProps) {
  // Only auction players
  const auctionPlayers = players.filter((p) => p.type === 'Auction');

  const lots = [
    { number: 1, name: 'Premium Players', badgeBg: 'bg-blue-600 text-white' },
    { number: 2, name: 'Star Players', badgeBg: 'bg-slate-800 text-white' },
    { number: 3, name: 'Elite Players', badgeBg: 'bg-indigo-600 text-white' },
  ];

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'Batsman':
        return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'Bowler':
        return 'bg-slate-100 text-slate-700 border border-slate-200';
      case 'Allrounder':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'Wicketkeeper':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6 sm:py-8 px-3 sm:px-6 lg:px-8">
      {/* Title Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Player Display
        </h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-1">
          12 premium catalog players organized in 3 lots of 4 players each
        </p>
        <div className="w-12 h-1 bg-blue-600 mx-auto mt-2.5 rounded-full" />
      </div>

      {/* Render Lots */}
      <div className="space-y-10">
        {lots.map((lot) => {
          const lotPlayers = auctionPlayers.filter((p) => p.lotNumber === lot.number);

          return (
            <div key={lot.number} className="space-y-3.5">
              {/* Lot Header Badge */}
              <div className="flex items-center gap-2.5 pb-1">
                <span
                  className={`px-3 py-0.5 rounded-md text-xs font-bold tracking-wide ${lot.badgeBg}`}
                >
                  Lot {lot.number}
                </span>
                <h3 className="text-base font-bold text-slate-800 tracking-tight">
                  {lot.name}
                </h3>
              </div>

              {/* 4 Cards Grid on PC, 2 Cards Grid on Mobile */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5">
                {lotPlayers.map((player) => {
                  const isUnderAuction =
                    activeAuction.status === 'bidding' &&
                    activeAuction.playerId === player.id;

                  return (
                    <div
                      key={player.id}
                      onClick={() => onSelectPlayer(player)}
                      className={`group relative bg-white rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all duration-200 border ${
                        isUnderAuction
                          ? 'ring-2 ring-blue-600 border-blue-600'
                          : player.isSold
                          ? 'border-slate-200 opacity-80'
                          : 'border-slate-200/90 hover:border-blue-400'
                      } cursor-pointer flex flex-col`}
                    >
                      {/* Player Image with Clean Aspect Ratio */}
                      <div className="relative aspect-4/5 w-full overflow-hidden bg-slate-100">
                        <img
                          src={player.imageUrl}
                          alt={player.name}
                          className="w-full h-full object-cover object-top transition duration-300 group-hover:scale-102"
                        />

                        {/* Top-Left Player Number Badge (#21, etc.) */}
                        <div className="absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 bg-slate-900/80 backdrop-blur-xs text-white text-[9px] sm:text-[11px] font-bold px-1.5 sm:px-2 py-0.5 rounded">
                          #{player.id}
                        </div>

                        {/* Live Bidding Badge if active */}
                        {isUnderAuction && (
                          <div className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 bg-blue-600 text-white text-[8px] sm:text-[10px] font-bold uppercase px-1.5 sm:px-2 py-0.5 rounded shadow-sm">
                            LIVE AUCTION
                          </div>
                        )}

                        {/* Sold Banner Overlay */}
                        {player.isSold && (
                          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-2xs flex flex-col items-center justify-center p-2 sm:p-3 text-center">
                            <CheckCircle className="w-5 h-5 sm:w-7 sm:h-7 text-emerald-400 mb-0.5 sm:mb-1" />
                            <span className="text-white font-extrabold text-[10px] sm:text-xs uppercase tracking-wider">
                              SOLD
                            </span>
                            <span className="text-amber-300 font-bold text-[10px] sm:text-xs mt-0.5">
                              {player.soldCost} M$
                            </span>
                            <span className="text-slate-200 text-[8px] sm:text-[10px] font-medium mt-0.5 uppercase truncate max-w-full px-1">
                              {player.teamId?.replace('_', ' ')}
                            </span>
                          </div>
                        )}

                        {/* Dark Gradient Overlay for Name and Chips */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent pt-6 sm:pt-8 pb-2 sm:pb-3 px-2 sm:px-3 text-white">
                          <h4 className="text-xs sm:text-sm font-bold tracking-tight mb-1 sm:mb-1.5 text-white truncate" title={player.name}>
                            {player.name}
                          </h4>

                          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                            <span
                              className={`px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-semibold ${getRoleBadge(
                                player.role
                              )}`}
                            >
                              {player.role}
                            </span>
                            <span className="px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-semibold bg-white/20 text-white">
                              {player.valuePoints} pts
                            </span>
                            <span className="px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-semibold bg-blue-600 text-white">
                              {player.basePrice} M$
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bottom action bar */}
                      <div className="bg-slate-50 py-1.5 sm:py-2 px-1.5 sm:px-3 text-center border-t border-slate-100 text-[10px] sm:text-[11px] font-semibold text-slate-700 group-hover:bg-blue-600 group-hover:text-white transition flex items-center justify-center gap-1 sm:gap-1.5">
                        <Gavel className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                        <span className="truncate">{player.isSold ? 'View Details' : 'View / Start Bid'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
