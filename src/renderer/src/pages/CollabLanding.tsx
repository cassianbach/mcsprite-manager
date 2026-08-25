import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collab, setPendingJoin } from '../collab/collabClient';
import type { CollabHostInfo } from '@shared/types';
import './CollabLanding.css';

export function CollabLanding(): JSX.Element {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostInfo, setHostInfo] = useState<CollabHostInfo | null>(null);
  const [joinUrl, setJoinUrl] = useState('');
  const [relay, setRelay] = useState('');
  const [copied, setCopied] = useState(false);

  async function startSession(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const p = await window.api.projects.create({ name: 'Shared Session', kind: 'mc' });
      // collab.startHost both starts the server AND connects this client to the room.
      // An optional relay URL lets the session run on an external server so it works
      // across the internet (not just the local network).
      const info = await collab.startHost(p.id, relay.trim() || undefined);
      setHostInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function joinSession(): Promise<void> {
    const link = joinUrl.trim();
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const p = await window.api.projects.create({ name: 'Shared Session', kind: 'mc' });
      setPendingJoin(link);
      navigate(`/project/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!hostInfo) return;
    try {
      await navigator.clipboard.writeText(hostInfo.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (collab.isActive()) {
    return (
      <div className="collab-landing">
        <h2>Collaboration</h2>
        <p className="collab-status">
          {collab.isHost ? 'Hosting a session' : 'Connected to a session'}.
        </p>
        <button className="btn" onClick={() => navigate(`/project/${collab.hostInfo?.room ?? ''}`)}>
          Open in editor
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            collab.disconnect();
            setHostInfo(null);
          }}
        >
          Leave session
        </button>
      </div>
    );
  }

  return (
    <div className="collab-landing">
      <h2>Collaboration</h2>
      <p className="collab-wip">Work in progress — do not use.</p>
      <p className="collab-blurb">
        Work on textures with a friend in real time. Start a session to get a shareable
        link, or join one with the link you were sent.
      </p>

      <div className="collab-card">
        <h3>Start a session</h3>
        {hostInfo ? (
          <div className="collab-link-row">
            <input readOnly value={hostInfo.link} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate(`/project/${hostInfo.room}`)}>
              Open in editor
            </button>
          </div>
        ) : (
          <>
            <button className="btn" onClick={startSession} disabled={busy}>
              {busy ? 'Starting…' : 'Start session'}
            </button>
            <p className="collab-help">
              Optional: paste a relay server URL (e.g. <code>wss://relay.example.com</code>)
              to collaborate across the internet. Leave blank to host on your local network.
            </p>
            <input
              className="collab-relay-input"
              placeholder="Relay server URL (optional)"
              value={relay}
              onChange={(e) => setRelay(e.target.value)}
            />
          </>
        )}
      </div>

      <div className="collab-card">
        <h3>Join a session</h3>
        <div className="collab-link-row">
          <input
            placeholder="texture-editor://collab?…"
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
          />
          <button className="btn" onClick={joinSession} disabled={busy || !joinUrl.trim()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>

      {error && <p className="collab-error">{error}</p>}
    </div>
  );
}
