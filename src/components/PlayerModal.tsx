import { useState } from 'react';
import { Player, ActiveAuction, UserAuth } from '../types';
import { X, Gavel, CheckCircle, Clock, RotateCcw } from 'lucide-react';

interface PlayerModalProps {
  player: Player;
  auth: UserAuth | null;
  activeAuction: ActiveAuction;
  onClose: () => void;
  onStartBid: (
    playerId: number,
    durationSeconds: number,
    biddingType: 'online' | 'offline'
  ) => void;
  onReAuction?: (playerId: number) => void;
  onOpenLiveAuction: () => void;
}

export default function PlayerModal({
  player,
  auth,
  activeAuction,
  onClose,
  onStartBid,
  onReAuction,
  onOpenLiveAuction,
}: PlayerModalProps) {
  const [biddingType, setBiddingType] = useState<'online' | 'offline'>('online');
  const [selectedDuration, setSelectedDuration] = useState<number>(30);

  const isCurrentlyBidding =
    activeAuction.status === 'bidding' && activeAuction.playerId === player.id;
  const isAnotherBidding =
    activeAuction.status === 'bidding' && activeAuction.playerId !== player.id;

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'Batsman':
        return 'text-blue-600';
      case 'Bowler':
        return 'text-slate-600';
      case 'Allrounder':
        return 'text-emerald-600';
      case 'Wicketkeeper':
        return 'text-amber-600';
      default:
        return 'text-slate-600';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 sm:p-7 relative text-center border border-slate-100">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Player Portrait Avatar */}
        <div className="flex justify-center mb-3.5">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white shadow-sm ring-2 ring-slate-100">
            <img
              src={player.imageUrl}
              alt={player.name}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Player Name & Role */}
        <h3 className="text-xl font-bold text-slate-900 mb-0.5">{player.name}</h3>
        <p className={`text-xs font-bold ${getRoleColor(player.role)} mb-0.5`}>{player.role}</p>
        <p className="text-xs text-slate-400 font-medium mb-5">
          Player #{player.id} • Lot {player.lotNumber}
        </p>

        {/* Player Value & Base Price stats boxes */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80">
            <div className="text-xl font-bold text-slate-900 mb-0.5">
              {player.valuePoints}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Player Value Points</div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80">
            <div className="text-xl font-bold text-blue-600 mb-0.5">
              {player.basePrice} M$
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Base Price</div>
          </div>
        </div>

        {/* Status Callout / Actions */}
        {player.isSold ? (
          <div className="space-y-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-emerald-800">
              <div className="flex items-center justify-center gap-1.5 font-bold text-xs mb-0.5">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>Player Acquired</span>
              </div>
              <div className="text-xs">
                Sold for <strong>{player.soldCost} M$</strong> to{' '}
                <span className="font-bold text-emerald-900">
                  {player.teamId ? player.teamId.replace('_', ' ').toUpperCase() : ''}
                </span>
              </div>
            </div>

            {auth?.role === 'admin' && (
              isAnotherBidding ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
                  Complete the current active auction before re-auctioning this player.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onReAuction?.(player.id)}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>RE - AUCTION</span>
                </button>
              )
            )}
          </div>
        ) : isCurrentlyBidding ? (
          <div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-blue-800 text-xs mb-3">
              Bidding is currently active on this player.
            </div>
            <button
              onClick={() => {
                onClose();
                onOpenLiveAuction();
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Gavel className="w-4 h-4" />
              <span>Go to Live Bidding Arena</span>
            </button>
          </div>
        ) : isAnotherBidding ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
            Another auction is currently in progress. Complete that auction first.
          </div>
        ) : (
          <div>
            {auth?.role === 'admin' ? (
              <div className="space-y-3">
                {/* Admin Bidding Type Selection: Online (Default) or Offline */}
                <div className="text-left bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Gavel className="w-3.5 h-3.5 text-blue-600" />
                    <span>Select Bidding Type:</span>
                  </label>
                  <select
                    value={biddingType}
                    onChange={(e) => setBiddingType(e.target.value as 'online' | 'offline')}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer text-slate-800"
                  >
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>

                {/* Admin Timer Duration Selection (Shown only when Online is selected) */}
                {biddingType === 'online' && (
                  <div className="text-left bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      <span>Select Bidding Duration:</span>
                    </label>
                    <select
                      value={selectedDuration}
                      onChange={(e) => setSelectedDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer text-slate-800"
                    >
                      <option value={30}>30 seconds (Default)</option>
                      <option value={60}>1 minute</option>
                      <option value={90}>1 minute 30 sec</option>
                      <option value={120}>2 minutes</option>
                    </select>
                  </div>
                )}

                <button
                  onClick={() => {
                    onStartBid(player.id, selectedDuration, biddingType);
                    onClose();
                  }}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Gavel className="w-4 h-4" />
                  <span>
                    {biddingType === 'offline'
                      ? 'Start Bid (Offline)'
                      : `Start Bid (${
                          selectedDuration === 30
                            ? '30s'
                            : selectedDuration === 60
                            ? '1m'
                            : selectedDuration === 90
                            ? '1m 30s'
                            : '2m'
                        })`}
                  </span>
                </button>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500 mb-2.5">
                  The host/admin initiates bidding for Lot players from the Player Display.
                </p>
                <button
                  disabled
                  className="w-full py-2.5 bg-slate-100 text-slate-400 font-medium text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Gavel className="w-3.5 h-3.5" />
                  <span>Awaiting Host to Start Bid</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
