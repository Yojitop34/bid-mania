import { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Navigation from './components/Navigation';
import WelcomeView from './components/WelcomeView';
import InstructionsView from './components/InstructionsView';
import TeamInfoView from './components/TeamInfoView';
import ScoreboardView from './components/ScoreboardView';
import PlayerDisplayView from './components/PlayerDisplayView';
import PlayerModal from './components/PlayerModal';
import LiveBiddingArena from './components/LiveBiddingArena';
import LoginModal from './components/LoginModal';
import { DatabaseState, Player, TabType, UserAuth } from './types';
import { Gavel } from 'lucide-react';

export default function App() {
  const [auth, setAuth] = useState<UserAuth | null>(() => {
    try {
      const saved = sessionStorage.getItem('apl_auth');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.role === 'participant' && !parsed.selectedTeam) {
          parsed.selectedTeam = 'Team A';
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [currentTab, setCurrentTab] = useState<TabType>('welcome');
  const [dbState, setDbState] = useState<DatabaseState | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isArenaActive, setIsArenaActive] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(() => {
    try {
      return !sessionStorage.getItem('apl_auth');
    } catch {
      return true;
    }
  });
  const [auctionError, setAuctionError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('apl_sound') !== 'false';
    } catch {
      return true;
    }
  });

  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('apl_sound', next ? 'true' : 'false');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const wsRef = useRef<WebSocket | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    let isDisposed = false;
    let reconnectTimeout: any;

    const connectWebSocket = () => {
      if (isDisposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isDisposed) {
          setIsConnected(true);
        }
      };

      ws.onclose = () => {
        if (!isDisposed) {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connectWebSocket, 2000);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection error:', err);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (
            data.type === 'INIT_STATE' ||
            data.type === 'STATE_UPDATE' ||
            data.type === 'DATABASE_CLEARED'
          ) {
            setDbState(data.state);
            if (data.state.activeAuction.status === 'bidding') {
              setIsArenaActive(true);
            }
          } else if (data.type === 'AUCTION_STARTED') {
            setDbState(data.state);
            setIsArenaActive(true); // Automatically take everyone to the Bidding Arena!
            setAuctionError(null);
          } else if (data.type === 'BID_PLACED') {
            setDbState(data.state);
            setAuctionError(null);
          } else if (data.type === 'TIMER_TICK') {
            setDbState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                activeAuction: {
                  ...prev.activeAuction,
                  timerSeconds: data.timerSeconds,
                },
              };
            });
          } else if (data.type === 'AUCTION_RESOLVED') {
            setDbState(data.state);
          } else if (data.type === 'ERROR') {
            setAuctionError(data.message);
          }
        } catch (e) {
          console.error('Error handling WebSocket message', e);
        }
      };
    };

    connectWebSocket();

    // Initial state fetch via REST
    fetch('/api/state')
      .then((res) => res.json())
      .then((data) => {
        setDbState(data);
        if (data.activeAuction?.status === 'bidding') {
          setIsArenaActive(true);
        }
      })
      .catch((err) => console.error('Failed to fetch initial state', err));

    return () => {
      isDisposed = true;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendWs = (payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const handleLoginSuccess = (newAuth: UserAuth) => {
    setAuth(newAuth);
    try {
      sessionStorage.setItem('apl_auth', JSON.stringify(newAuth));
      localStorage.setItem('apl_auth', JSON.stringify(newAuth));
    } catch {
      // ignore
    }
    setShowLoginModal(false);
  };

  const handleLogout = () => {
    setAuth(null);
    try {
      sessionStorage.removeItem('apl_auth');
      localStorage.removeItem('apl_auth');
    } catch {
      // ignore
    }
    setShowLoginModal(true);
  };

  const handleStartBid = (
    playerId: number,
    durationSeconds: number = 30,
    biddingType: 'online' | 'offline' = 'online'
  ) => {
    setAuctionError(null);
    sendWs({ type: 'START_BID', playerId, durationSeconds, biddingType });
    setIsArenaActive(true);
  };

  const handlePlaceBid = (teamCode: string, amount: number) => {
    sendWs({ type: 'PLACE_BID', teamCode, amount });
  };

  const handleEndBidding = (offlineAward?: { teamId: string; amount: number }) => {
    if (offlineAward) {
      sendWs({ type: 'END_BIDDING', teamId: offlineAward.teamId, amount: offlineAward.amount });
    } else {
      sendWs({ type: 'END_BIDDING' });
    }
  };

  const handleClearDatabase = () => {
    sendWs({ type: 'CLEAR_DATABASE' });
    setIsArenaActive(false);
  };

  const handleUpdateTeamName = (teamId: string, name: string) => {
    sendWs({ type: 'UPDATE_TEAM_NAME', teamId, name });
  };

  const handleUpdateTeamCode = (teamId: string, code: string) => {
    sendWs({ type: 'UPDATE_TEAM_CODE', teamId, code });
  };

  const handleUpdatePurse = (teamId: string, newPurse: number) => {
    if (teamId === 'all') {
      sendWs({ type: 'UPDATE_ALL_PURSES', newPurse });
    } else {
      sendWs({ type: 'UPDATE_TEAM_PURSE', teamId, newPurse });
    }
  };

  const handleReAuctionPlayer = (playerId: number) => {
    sendWs({ type: 'REAUCTION_PLAYER', playerId });
  };

  const handleExtendTimer = () => {
    sendWs({ type: 'EXTEND_TIMER' });
  };

  const handleCloseArena = () => {
    setIsArenaActive(false);
    if (
      dbState?.activeAuction.status === 'sold' ||
      dbState?.activeAuction.status === 'unsold'
    ) {
      sendWs({ type: 'CLOSE_BID_MODAL' });
    }
  };

  const handleViewScoreboard = () => {
    setIsArenaActive(false);
    setCurrentTab('scoreboard');
    if (
      dbState?.activeAuction.status === 'sold' ||
      dbState?.activeAuction.status === 'unsold'
    ) {
      sendWs({ type: 'CLOSE_BID_MODAL' });
    }
  };

  const isAuctionLive =
    dbState?.activeAuction.status === 'bidding' &&
    dbState.activeAuction.playerId !== null;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900 antialiased selection:bg-blue-600 selection:text-white">
      {/* 1. Header with Minimalist Dark Slate / Blue Theme */}
      <Header
        auth={auth}
        teams={dbState?.teams || []}
        universalPurse={dbState?.universalPurse}
        isConnected={isConnected}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onClearDatabase={handleClearDatabase}
        onUpdatePurse={handleUpdatePurse}
        onLogout={handleLogout}
        onOpenLogin={() => setShowLoginModal(true)}
      />

      {/* When Arena is Active, take everyone to the Bidding Interface right below the header */}
      {isArenaActive && dbState && dbState.activeAuction.playerId !== null ? (
        <main className="flex-1 pb-16">
          <LiveBiddingArena
            activeAuction={dbState.activeAuction}
            players={dbState.players}
            teams={dbState.teams}
            auth={auth}
            onPlaceBid={handlePlaceBid}
            onEndBidding={handleEndBidding}
            onExtendTimer={handleExtendTimer}
            onCloseArena={handleCloseArena}
            onViewScoreboard={handleViewScoreboard}
            soundEnabled={soundEnabled}
            errorMsg={auctionError}
            onClearError={() => setAuctionError(null)}
          />
        </main>
      ) : (
        <>
          {/* Navigation Tabs (Centered aligned) */}
          <Navigation
            currentTab={currentTab}
            onSelectTab={(tab) => setCurrentTab(tab)}
            auth={auth}
            teams={dbState?.teams || []}
          />

          {/* Floating Banner if Auction is active but user is browsing other tabs */}
          {isAuctionLive && !isArenaActive && (
            <div className="bg-slate-900 text-white shadow-md sticky top-[49px] z-20 py-2 px-4 animate-in slide-in-from-top duration-150 border-b border-slate-800">
              <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center px-2 h-7 rounded-lg bg-blue-600 text-white font-extrabold text-xs">
                    {dbState.activeAuction.biddingType === 'offline'
                      ? 'OFFLINE'
                      : `${dbState.activeAuction.timerSeconds}s`}
                  </div>
                  <div className="text-xs">
                    <span className="font-bold text-slate-300 mr-1.5">
                      {dbState.activeAuction.biddingType === 'offline'
                        ? 'Offline Auction Active:'
                        : 'Live Auction Active:'}
                    </span>
                    <span className="font-semibold text-white">
                      {dbState.players.find((p) => p.id === dbState.activeAuction.playerId)?.name}
                    </span>
                    {dbState.activeAuction.biddingType === 'offline' ? (
                      <span className="text-slate-400 ml-2">(Physical Bidding)</span>
                    ) : dbState.activeAuction.currentBid ? (
                      <span className="text-blue-400 font-semibold ml-2">
                        ({dbState.activeAuction.currentTeam} leads at {dbState.activeAuction.currentBid} M$)
                      </span>
                    ) : (
                      <span className="text-slate-400 ml-2">
                        (No bids placed yet)
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setIsArenaActive(true)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded-md shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Gavel className="w-3 h-3" />
                  <span>Go to Live Bidding Page</span>
                </button>
              </div>
            </div>
          )}

          {/* Standard Page Content */}
          <main className="flex-1 pb-16">
            {currentTab === 'welcome' && (
              <WelcomeView onStartExploring={(tab) => setCurrentTab(tab)} />
            )}

            {currentTab === 'players' && dbState && (
              <PlayerDisplayView
                players={dbState.players}
                activeAuction={dbState.activeAuction}
                onSelectPlayer={(player) => setSelectedPlayer(player)}
              />
            )}

            {currentTab === 'instructions' && <InstructionsView />}

            {currentTab === 'teams' && dbState && (
              <TeamInfoView
                teams={dbState.teams}
                players={dbState.players}
                auth={auth}
                onUpdateTeamName={handleUpdateTeamName}
                onUpdateTeamCode={handleUpdateTeamCode}
              />
            )}

            {currentTab === 'scoreboard' && dbState && (
              <ScoreboardView
                key="scoreboard-view"
                teams={dbState.teams}
                players={dbState.players}
              />
            )}
          </main>
        </>
      )}

      {/* Player Detail & Start Auction Modal */}
      {selectedPlayer && dbState && (
        <PlayerModal
          player={dbState.players.find((p) => p.id === selectedPlayer.id) || selectedPlayer}
          auth={auth}
          activeAuction={dbState.activeAuction}
          onClose={() => setSelectedPlayer(null)}
          onStartBid={handleStartBid}
          onReAuction={handleReAuctionPlayer}
          onOpenLiveAuction={() => {
            setSelectedPlayer(null);
            setIsArenaActive(true);
          }}
        />
      )}

      {/* Login Gateway Modal */}
      <LoginModal
        isOpen={!auth || showLoginModal}
        allowClose={Boolean(auth)}
        teams={dbState?.teams || []}
        onLoginSuccess={handleLoginSuccess}
        onClose={() => {
          if (auth) setShowLoginModal(false);
        }}
      />
    </div>
  );
}
