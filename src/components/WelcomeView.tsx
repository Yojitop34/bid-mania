import { Gavel, ArrowRight } from 'lucide-react';
import { TabType } from '../types';

interface WelcomeViewProps {
  onStartExploring: (tab: TabType) => void;
}

export default function WelcomeView({ onStartExploring }: WelcomeViewProps) {
  return (
    <div className="min-h-[65vh] flex flex-col items-center justify-center py-12 px-4 sm:px-6">
      {/* Minimalist Blue/White Welcome Card */}
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xs border border-slate-200/80 p-8 sm:p-12 text-center relative overflow-hidden">
        {/* Subtle top blue accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-blue-600" />

        {/* Minimalist Gavel Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-2xs">
            <Gavel className="w-7 h-7 transform -rotate-12" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
          Welcome to Bid Mania
        </h2>

        {/* Body Text */}
        <p className="text-slate-600 text-sm leading-relaxed mb-2">
          Review squads, analyze player values, and participate in real-time auction bidding.
        </p>

        <p className="text-slate-500 text-xs sm:text-sm leading-relaxed mb-6">
          If you have questions, please consult the simulation director.
        </p>

        {/* Refined Blue Accent Callout */}
        <p className="text-blue-700 font-semibold text-sm tracking-wide mb-8">
          All the best. May you all achieve your team goals!
        </p>

        {/* Start Exploring Button */}
        <div>
          <button
            onClick={() => onStartExploring('players')}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-semibold text-sm rounded-lg shadow-xs transition cursor-pointer"
          >
            <span>Start Exploring</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
