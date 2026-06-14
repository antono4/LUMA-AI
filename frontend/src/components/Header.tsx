import { Settings, Github, Menu } from 'lucide-react';
import { useState } from 'react';

interface HeaderProps {
  title: string;
  status: 'idle' | 'running' | 'paused' | 'completed';
  onToggleSidebar?: () => void;
}

export function Header({ title, status, onToggleSidebar }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header className="h-14 bg-dark-200 border-b border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 hover:bg-dark-100 rounded-lg transition-colors text-gray-400 hover:text-white lg:hidden"
        >
          <Menu size={20} />
        </button>
        
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">LU</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">{title}</h1>
            <div className="flex items-center gap-1 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  status === 'running'
                    ? 'bg-green-500 animate-pulse'
                    : status === 'paused'
                    ? 'bg-yellow-500'
                    : 'bg-gray-500'
                }`}
              />
              <span className="text-gray-400 capitalize">{status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <a
          href="https://github.com/antono4/LUMA-AI"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 hover:bg-dark-100 rounded-lg transition-colors text-gray-400 hover:text-white"
          title="View on GitHub"
        >
          <Github size={20} />
        </a>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-dark-100 rounded-lg transition-colors text-gray-400 hover:text-white"
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}