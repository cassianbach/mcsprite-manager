import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSettings, setTheme } from '../store/settings';
import { setActiveMode } from '../store/settings';
import { Logo } from './Logo';
import type { UpdateInfo } from '@shared/types';
import './Shell.css';

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const mode = useSettings((s) => s.activeMode);

  return (
    <div className="shell">
      <header className="titlebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={22} seed={0xc1} />
          <h1>MCsprite Manager</h1>
        </div>
        <div className="titlebar-controls">
          <ThemeToggle />
          <button aria-label="Minimize" onClick={() => window.api.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" strokeWidth="1" fill="none" /></svg>
          </button>
          <button aria-label="Maximize" onClick={() => window.api.window.maximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1" fill="none" /></svg>
          </button>
          <button className="close" aria-label="Close" onClick={() => window.api.window.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1" fill="none" /></svg>
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-label">Mode</div>
          <NavLink
            to="/projects"
            className={({ isActive }) => 'sidebar-link' + (isActive || mode === 'texture' ? ' active' : '')}
            onClick={() => setActiveMode('texture')}
          >
            <Icon name="layers" /> Texture
          </NavLink>
          <NavLink
            to="/sprite"
            className={({ isActive }) => 'sidebar-link' + (isActive || mode === 'sprite' ? ' active' : '')}
            onClick={() => setActiveMode('sprite')}
          >
            <Icon name="sparkle" /> Sprite
          </NavLink>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div className="sidebar-label">Texture mode</div>
          <NavLink to="/projects" end className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}>
            <Icon name="folder" /> Projects
          </NavLink>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Community</div>
          <NavLink to="/uploaded" className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}>
            <Icon name="folder" /> Uploaded
          </NavLink>
        </div>

        <div className="sidebar-spacer" />

        <UpdateStatus />
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

function UpdateStatus(): JSX.Element {
  const [info, setInfo] = useState<UpdateInfo>({ status: 'idle' });

  useEffect(() => {
    const off = window.api.update.onStatus(setInfo);
    return off;
  }, []);

  if (info.status === 'idle' || info.status === 'not-available') return <></>;

  if (info.status === 'downloaded') {
    return (
      <div className="update-status">
        <span className="update-status-text">Update ready</span>
        <button className="btn" onClick={() => void window.api.update.install()}>
          Restart & install
        </button>
      </div>
    );
  }

  if (info.status === 'available') {
    return (
      <div className="update-status">
        <span className="update-status-text">Update available</span>
      </div>
    );
  }

  if (info.status === 'downloading') {
    return (
      <div className="update-status">
        <span className="update-status-text">Downloading… {info.percent ?? 0}%</span>
      </div>
    );
  }

  if (info.status === 'checking') {
    return (
      <div className="update-status">
        <span className="update-status-text">Checking for updates…</span>
      </div>
    );
  }

  if (info.status === 'error') {
    return (
      <div className="update-status">
        <span className="update-status-text">Update error</span>
      </div>
    );
  }

  return <></>;
}

function ThemeToggle(): JSX.Element {
  const theme = useSettings((s) => s.theme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        void window.api.theme.set(next);
      }}
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.4 1.4M9.6 9.6L11 11M3 11l1.4-1.4M9.6 4.4L11 3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M11 8.5A5 5 0 0 1 5.5 3 5 5 0 1 0 11 8.5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      )}
    </button>
  );
}

function Icon({ name }: { name: 'layers' | 'sparkle' | 'folder' | 'link' }): JSX.Element {
  if (name === 'layers') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'link') return <LinkIcon />;
  if (name === 'sparkle') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5L8 2z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M2 4v8h12V6H8L6 4H2z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path
        d="M6.5 9.5l3-3M7 4.5l1-1a3 3 0 0 1 4 4l-1 1M9 11.5l-1 1a3 3 0 0 1-4-4l1-1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
