import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ProjectBrowser } from './pages/ProjectBrowser';
import { Editor } from './pages/Editor';
import { SpriteEditor } from './pages/SpriteEditor';
import { Catalog } from './pages/Catalog';
import { BulkEdit } from './pages/BulkEdit';
import { ImportExport } from './pages/ImportExport';
import { CollabLanding } from './pages/CollabLanding';
import { UploadedCatalog } from './pages/UploadedCatalog';
import { useSettings } from './store/settings';
import { collab, setPendingJoin } from './collab/collabClient';

// Captures `texture-editor://collab?...` deep links. If a guest opens a link
// without a project open, we spin up a scratch project and stash the link so
// the Editor can join on mount (no local project needed — just the link).
function CollabHandler(): null {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const off = window.api.collab.onDeeplink((link: string) => {
      const inProject = /^\/project\/[^/]+/.test(location.pathname);
      if (inProject) {
        collab.joinLink(link);
      } else {
        void (async () => {
          try {
            const p = await window.api.projects.create({ name: 'Shared Session', kind: 'mc' });
            setPendingJoin(link);
            navigate(`/project/${p.id}`);
          } catch (e) {
            console.error('Failed to create collaboration project', e);
          }
        })();
      }
    });
    return off;
  }, [location.pathname, navigate]);

  return null;
}

export function App(): JSX.Element {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <Shell>
      <CollabHandler />
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectBrowser />} />
        <Route path="/project/:id" element={<Editor />} />
        <Route path="/project/:id/catalog" element={<Catalog />} />
        <Route path="/project/:id/bulk" element={<BulkEdit />} />
        <Route path="/project/:id/export" element={<ImportExport />} />
        <Route path="/uploaded" element={<UploadedCatalog />} />
        <Route path="/collab" element={<CollabLanding />} />
        <Route path="/sprite" element={<SpriteEditor />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}
