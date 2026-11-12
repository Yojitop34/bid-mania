import { ClipboardList, AlertCircle, CheckCircle2, Users, Gavel, Scale, Trophy } from 'lucide-react';

export default function InstructionsView() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      {/* Top Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Competition Instructions
        </h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-1">
          Official squad qualification requirements for the tournament
        </p>
        <div className="w-12 h-1 bg-blue-600 mx-auto mt-2.5 rounded-full" />
      </div>

      {/* Main Instructions Card */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200/80 p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-5">
          <Trophy className="w-4 h-4 text-blue-600" />
          <h3 className="text-base font-bold text-slate-900">Team Qualification Criteria</h3>
        </div>

        {/* Warning / Notice Box */}
        <div className="bg-blue-50/60 border border-blue-200/80 rounded-lg p-4 mb-6 text-slate-800">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-xs text-blue-950 mb-0.5">
                Mandatory Minimum Requirements
              </h4>
              <p className="text-xs text-blue-900/80 leading-relaxed">
                Your team must fulfill all minimum category quotas below by the end of the auction to qualify for tournament play.
              </p>
            </div>
          </div>
        </div>

        {/* 4 Category Requirements Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-7">
          {/* Batsmen */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-600 mb-0.5">3</div>
            <div className="text-xs font-bold text-slate-800">Batsmen</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Minimum Required</div>
          </div>

          {/* Bowlers */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-slate-800 mb-0.5">2</div>
            <div className="text-xs font-bold text-slate-800">Bowlers</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Minimum Required</div>
          </div>

          {/* Allrounder */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-emerald-600 mb-0.5">1</div>
            <div className="text-xs font-bold text-slate-800">Allrounder</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Minimum Required</div>
          </div>

          {/* Wicketkeeper */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-amber-600 mb-0.5">1</div>
            <div className="text-xs font-bold text-slate-800">Wicketkeeper</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Minimum Required</div>
          </div>
        </div>

        {/* Total Squad Requirements Box */}
        <div className="border-t border-slate-100 pt-5">
          <h4 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4 text-blue-600" />
            <span>Squad Formation Rules</span>
          </h4>

          <ul className="space-y-2.5 text-xs text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                <strong>Minimum 8 players total</strong> (including pre-assigned players)
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>
                Each team begins with <strong>5 pre-assigned players</strong>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Gavel className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>
                You must purchase <strong>at least 3 additional players</strong> from the live auction
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Scale className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>
                Final rosters must satisfy every individual role quota above
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
