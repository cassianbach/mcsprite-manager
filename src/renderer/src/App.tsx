import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ProjectBrowser } from './pages/ProjectBrowser';
import { Editor } from './pages/Editor';
import { PRESET_BACKGROUNDS } from './themes';
import { Catalog } from './pages/Catalog';
import { BulkEdit } from './pages/BulkEdit';
import { ImportExport } from './pages/ImportExport';
import GlintStudio from './pages/GlintStudio';
import BiomeTintStudio from './pages/BiomeTintStudio';
import SkyLoadingStudio from './pages/SkyLoadingStudio';
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
  const backgroundImage = useSettings((s) => s.backgroundImage);
  const backgroundCrop = useSettings((s) => s.backgroundCrop);
  const customTokens = useSettings((s) => s.customTokens);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (theme === 'custom') {
      for (const [k, v] of Object.entries(customTokens)) root.style.setProperty(`--${k}`, v as string);
    } else {
      for (const k of Object.keys(customTokens)) root.style.removeProperty(`--${k}`);
    }
    if (!backgroundImage) {
      // Fall back to the active preset's default background image (e.g. galaxy
      // → starfield, midnight → stars, forest → foliage). The user's custom
      // background always wins when it is set.
      const presetBg = PRESET_BACKGROUNDS[theme];
      root.style.setProperty('--app-bg-image', presetBg ? `url("${presetBg}")` : 'none');
      root.style.setProperty('--app-bg-size', 'cover');
      root.style.setProperty('--app-bg-pos', 'center');
      return;
    }
    const img = backgroundImage.startsWith('data:')
      ? backgroundImage
      : `file:///${backgroundImage.replace(/\\/g, '/')}`;
    root.style.setProperty('--app-bg-image', `url("${img}")`);

    // Selected region (fractions) -> scale that region to fill the viewport.
    // size = 100%/w (and /h); position aligns the region's top-left to the corner.
    const crop = backgroundCrop;
    if (crop && crop.w < 1 && crop.h < 1) {
      const sw = (1 / crop.w) * 100;
      const sh = (1 / crop.h) * 100;
      const px = (-crop.x / (crop.w - 1)) * 100;
      const py = (-crop.y / (crop.h - 1)) * 100;
      root.style.setProperty('--app-bg-size', `${sw}% ${sh}%`);
      root.style.setProperty('--app-bg-pos', `${px}% ${py}%`);
    } else {
      root.style.setProperty('--app-bg-size', 'cover');
      root.style.setProperty('--app-bg-pos', 'center');
    }
  }, [theme, backgroundImage, backgroundCrop, customTokens]);

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
        <Route path="/project/:id/glint" element={<GlintStudio />} />
        <Route path="/project/:id/biome" element={<BiomeTintStudio />} />
        <Route path="/project/:id/sky" element={<SkyLoadingStudio />} />
        <Route path="/uploaded" element={<UploadedCatalog />} />
        <Route path="/collab" element={<CollabLanding />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </Shell>
  );
}
