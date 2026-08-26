import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEditorUi, setTool, setBrushSize, setShowGrid, cycleMirror, setRecolor, setSecondaryColor, setGradientMode, setGradientAngle, setGradientThickness, setGradientUseAngle } from '../store/editor';
import type { ToolId } from '../store/editor';
import { useProject, canUndo, canRedo } from '../store/project';
import { useClipboard } from '../store/clipboard';
import type { CollabHostInfo, CollabTextureSync, TextureSource } from '@shared/types';
import { CanvasViewport, type CanvasViewportHandle } from '../components/CanvasViewport';
import { ColorPicker } from '../components/ColorPicker';
import { Button } from '../components/Button';
import { ResizeDialog } from '../components/ResizeDialog';
import { SpriteSheetDialog } from '../components/SpriteSheetDialog';
import { ShadePanel } from '../components/ShadePanel';
import { RecolorPanel } from '../components/RecolorPanel';
import { FramesPanel } from '../components/FramesPanel';
import { ActionGlyph, PixelIcon } from '../components/ActionGlyph';
import { StampOverlay, type StampState } from '../components/StampOverlay';
import { encodeFramesToGif, encodeFramesToStripPng, downloadBytes } from '../lib/gif';
import { collab, takePendingJoin } from '../collab/collabClient';
import type { Peer } from '@shared/types';
import {
  bresenhamLine,
  clearRect,
  copyRect,
  erasePixel,
  floodFill,
  getPixel,
  gradientAlongPath,
  gradientAlongPathAngle,
  gradientRect,
  gradientRectAngle,
  gradientPoint,
  gradientDots,
  mirrorRect,
  hexToTuple,
  mirrorX,
  mirrorY,
  paintPixel,
  pasteRect,
  recolorPixels,
  shadePixels,
  smushPixels,
  transformPixels,
  type RescaleMode,
  type TransformOp,
} from '../lib/canvas';
import { hexToRgba, rgbaToHex } from '../lib/color';
import './Editor.css';

type SyncSource = {
  id: string;
  source: TextureSource;
  name: string;
  path: string;
  width: number;
  height: number;
  base: Uint8ClampedArray;
  current: Uint8ClampedArray;
  modified: boolean;
  animation?: { defaultFrameTicks?: number } | null;
};

function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toSync(t: SyncSource): CollabTextureSync {
  return {
    id: t.id,
    source: t.source,
    name: t.name,
    path: t.path,
    width: t.width,
    height: t.height,
    base: new Uint8Array(t.base),
    current: new Uint8Array(t.current),
    modified: t.modified,
    animated: !!t.animation,
    defaultFrameTicks: t.animation?.defaultFrameTicks ?? 2,
  };
}

const TOOLS: { id: ToolId; label: string; shortcut: string }[] = [
  { id: 'pencil', label: 'Pencil', shortcut: 'B' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'fill', label: 'Fill', shortcut: 'G' },
  { id: 'gradient', label: 'Gradient', shortcut: 'V' },
  { id: 'smush', label: 'Smush', shortcut: 'N' },
  { id: 'eyedropper', label: 'Eyedropper', shortcut: 'I' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'select', label: 'Select', shortcut: 'M' },
  { id: 'shade', label: 'Shade', shortcut: 'S' },
  { id: 'stamp', label: 'Stamp', shortcut: '' },
  { id: 'recolor', label: 'Recolor', shortcut: '' },
];

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';

interface PointerState {
  drawing: boolean;
  last: { x: number; y: number } | null;
  selMode:
    | null
    | { kind: 'new'; anchor: { x: number; y: number } }
    | { kind: 'move'; origin: { x: number; y: number }; originalRect: { x: number; y: number; w: number; h: number }; originalBackup: Uint8ClampedArray | null }
    | { kind: 'resize'; anchor: { x: number; y: number }; original: { x: number; y: number; w: number; h: number } };
}

/** Returns the handle name if (px,py) is on a handle of `sel`, else null. */
function pixelInsideHandle(
  px: number,
  py: number,
  sel: { x: number; y: number; w: number; h: number } | null,
  _texW: number,
  _texH: number,
  zoom: number,
): Handle | null {
  if (!sel) return null;
  // Hit-box radius in pixel space; scale down as zoom shrinks so it stays grabbable.
  const hitR = Math.max(0.5, 6 / zoom);
  const tlX = sel.x;
  const tlY = sel.y;
  const trX = sel.x + sel.w - 1;
  const trY = sel.y;
  const blX = sel.x;
  const blY = sel.y + sel.h - 1;
  const brX = sel.x + sel.w - 1;
  const brY = sel.y + sel.h - 1;
  const midX = sel.x + Math.floor(sel.w / 2);
  const midY = sel.y + Math.floor(sel.h / 2);
  const dist = (ax: number, ay: number) => Math.abs(px - ax) <= hitR && Math.abs(py - ay) <= hitR;
  // Corners first (highest priority)
  if (dist(tlX, tlY)) return 'tl';
  if (dist(trX, trY)) return 'tr';
  if (dist(blX, blY)) return 'bl';
  if (dist(brX, brY)) return 'br';
  // Edge midpoints
  if (dist(midX, tlY)) return 't';
  if (dist(midX, blY)) return 'b';
  if (dist(tlX, midY)) return 'l';
  if (dist(trX, midY)) return 'r';
  return null;
}

function pixelInsideRect(
  px: number,
  py: number,
  sel: { x: number; y: number; w: number; h: number } | null,
): boolean {
  if (!sel) return false;
  return px >= sel.x && px <= sel.x + sel.w - 1 && py >= sel.y && py <= sel.y + sel.h - 1;
}

export function Editor(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const projectId = id ?? '';
  const [searchParams] = useSearchParams();

  const texture = useProject((s) => s.texture);
  const save = useProject((s) => s.save);
  const loadProject = useProject((s) => s.load);
  const closeProject = useProject((s) => s.close);
  const applyEdit = useProject((s) => s.applyEdit);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const reset = useProject((s) => s.reset);
  const saveNow = useProject((s) => s.saveNow);
  const resizeTexture = useProject((s) => s.resize);
  const renameTexture = useProject((s) => s.rename);
  const setSelection = useProject((s) => s.setSelection);
  const moveSelection = useProject((s) => s.moveSelection);
  const selectAll = useProject((s) => s.selectAll);
  const clearSelection = useProject((s) => s.clearSelection);
  const cutSelection = useProject((s) => s.cutSelection);
  const deleteSelectionRegion = useProject((s) => s.deleteSelectionRegion);
  const pasteAtSelection = useProject((s) => s.pasteAtSelection);

  const [resizeOpen, setResizeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const activeTool = useEditorUi((s) => s.activeTool);
  const brushSize = useEditorUi((s) => s.brushSize);
  const zoom = useEditorUi((s) => s.zoom);
  const showGrid = useEditorUi((s) => s.showGrid);
  const primaryColor = useEditorUi((s) => s.primaryColor);
  const secondaryColor = useEditorUi((s) => s.secondaryColor);
  const gradientMode = useEditorUi((s) => s.gradientMode);
  const gradientAngle = useEditorUi((s) => s.gradientAngle);
  const gradientThickness = useEditorUi((s) => s.gradientThickness);
  const gradientUseAngle = useEditorUi((s) => s.gradientUseAngle);
  const mirror = useEditorUi((s) => s.mirror);

  const [textureList, setTextureList] = useState<string[]>([]);
  // ===== Collaboration (Phase 3.5) =====
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabStatus, setCollabStatus] = useState<'offline' | 'connecting' | 'connected'>('offline');
  const [collabError, setCollabError] = useState<string | null>(null);
  const [collabIsHost, setCollabIsHost] = useState(false);
  const [collabHostInfo, setCollabHostInfo] = useState<CollabHostInfo | null>(null);
  const [collabPeers, setCollabPeers] = useState<Peer[]>([]);
  const [joinLink, setJoinLink] = useState('');
  const [relayInput, setRelayInput] = useState('');
  const [collabCopied, setCollabCopied] = useState(false);
  const lastPushedRef = useRef<Uint8ClampedArray | null>(null);
  // Tracks which texture id we last broadcast, so switching textures re-broadcasts.
  const lastPushedIdRef = useRef<string | null>(null);
  // Mirror of the texture-list so collab callbacks read fresh data without re-subscribing.
  const textureListRef = useRef<string[]>([]);
  const materializedRef = useRef<Set<string>>(new Set());
  textureListRef.current = textureList;
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Tools need refs because their handlers are recreated on every render
  const activeToolRef = useRef(activeTool);
  const brushSizeRef = useRef(brushSize);
  const primaryColorRef = useRef(primaryColor);
  const zoomRef = useRef(zoom);
  const pointer = useRef<PointerState>({ drawing: false, last: null, selMode: null });
  const gradientPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const gradientDotsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [tick, forceTick] = useState(0);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);
  useEffect(() => {
    primaryColorRef.current = primaryColor;
  }, [primaryColor]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Load texture list for this project — and load the first texture (or create a demo if empty).
  const [listLoaded, setListLoaded] = useState(false);

  useEffect(() => {
    // When joining an existing session as a guest, the shared doc supplies the
    // active texture — don't create a local demo that would hijack the room.
    if (collab.isJoiningSession()) {
      setListLoaded(true);
      return;
    }
    let cancelled = false;
    setListLoaded(false);
    void (async () => {
      try {
        const list = await window.api.textures.list(projectId);
        if (cancelled) return;
        setTextureList(list);
        if (list.length > 0) {
          // Open a requested texture (e.g. one just imported) if present, else the first.
          const requested = searchParams.get('tex');
          const openId = requested && list.includes(requested) ? requested : list[0];
          try {
            const tex = await window.api.textures.load(projectId, openId);
            if (!cancelled) loadProject(projectId, tex);
          } catch (e) {
            console.error('Failed to load first texture', e);
          }
        } else {
          // Truly empty project — create one starter texture exactly once
          await ensureDemoTexture();
        }
        if (!cancelled) setListLoaded(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) setListLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Close on unmount
  useEffect(() => {
    return () => closeProject();
  }, [closeProject]);

  const openTexture = useCallback(
    async (textureId: string) => {
      const tex = await window.api.textures.load(projectId, textureId);
      loadProject(projectId, tex);
    },
    [projectId, loadProject],
  );

  // ===== Collaboration wiring (Phase 3.5) =====
  // Project-level sharing (à la resourcepackcreator): the shared doc holds the
  // WHOLE project's textures. Each collaborator can view/edit a DIFFERENT
  // texture; updates sync per-texture. We never force-switch someone's view.
  const applyRemoteState = (): void => {
    const reg = collab.getRegistry();
    const ids = Object.keys(reg).sort();
    const localList = textureListRef.current;
    const materialized = materializedRef.current;

    // Materialize shared textures we don't have locally yet (adds them to the picker).
    for (const id of ids) {
      if (materialized.has(id)) continue;
      materialized.add(id);
      if (!localList.includes(id)) void materializeSharedTexture(reg[id]);
    }

    // Remove local textures a collaborator deleted from the shared project.
    for (const id of [...materialized]) {
      if (!ids.includes(id)) {
        materialized.delete(id);
        setTextureList((prev) => prev.filter((t) => t !== id));
        if (useProject.getState().texture?.id === id) {
          const remaining = textureListRef.current.filter((t) => t !== id);
          if (remaining.length) void openTexture(remaining[0]);
          else useProject.setState({ texture: null });
        }
      }
    }

    // Reconcile the picker with the shared texture set.
    setTextureList((prev) => [...new Set([...prev, ...ids])].sort());

    // Apply pixel updates to the texture we're currently viewing (if any).
    const cur = useProject.getState().texture;
    if (cur && reg[cur.id]) {
      const entry = reg[cur.id];
      const remote = new Uint8ClampedArray(entry.current);
      if (!pixelsEqual(remote, cur.current)) {
        useProject.getState().setActivePixels(remote);
        lastPushedRef.current = remote;
      }
    }
  };

  // Write a collaborator's texture into our local project so it appears in the picker.
  async function materializeSharedTexture(entry: CollabTextureSync): Promise<void> {
    try {
      await window.api.textures.savePixels(
        projectId,
        entry.id,
        entry.width,
        entry.height,
        new Uint8Array(entry.current),
      );
      setTextureList((prev) => (prev.includes(entry.id) ? prev : [...prev, entry.id]));
    } catch (e) {
      console.error('Failed to materialize shared texture', e);
    }
  }

  // Push one of our local textures into the shared project (used when joining).
  async function pushLocalTextureById(id: string): Promise<void> {
    if (id === 'none') return;
    try {
      const tex = await window.api.textures.load(projectId, id);
      collab.pushEntry({
        id: tex.textureId,
        source: tex.source,
        name: tex.name,
        path: tex.path,
        width: tex.width,
        height: tex.height,
        current: new Uint8Array(tex.pixels),
        base: new Uint8Array(tex.base),
        modified: tex.modified,
        animated: !!tex.animation,
        defaultFrameTicks: tex.animation?.defaultFrameTicks ?? 2,
      });
    } catch (e) {
      console.error('Failed to push local texture', e);
    }
  }

  useEffect(() => {
    const refreshPeers = () => {
      setCollabPeers(collab.getPeers());
      // Remote cursors are drawn in the overlay, so repaint on presence changes.
      viewportRef.current?.repaint();
    };
    const offState = collab.onState(() => {
      setCollabStatus(collab.status);
      setCollabError(collab.lastError);
      setCollabIsHost(collab.isHost);
      setCollabHostInfo(collab.hostInfo);
      setCollabPeers(collab.getPeers());
      if (collab.status === 'connected') {
        setCollabOpen(true);
        // Safety net: pull shared state in case the initial sync fired before
        // our listeners were attached.
        applyRemoteState();
      }
    });
    const offRemote = collab.onRemote(applyRemoteState);
    const offSync = collab.onSync(applyRemoteState);
    const offAwareness = collab.onAwareness(refreshPeers);

    // If we arrived here from a "join via link" while no project was open, the
    // CollabHandler created a project and stashed the link for us to consume.
    const pending = takePendingJoin();
    if (pending && !collab.isActive()) collab.joinLink(pending);

    // If already connected (joined elsewhere), pull current shared state now.
    if (collab.isActive()) applyRemoteState();

    return () => {
      offState();
      offRemote();
      offSync();
      offAwareness();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTexture, loadProject, projectId]);

  // Push local texture state to collaborators (per-texture, project-level share).
  // Skip when the pixels are unchanged since the last push (covers remote-applied
  // updates, which we record via lastPushedRef to avoid a re-broadcast loop).
  useEffect(() => {
    if (!collab.isActive()) return;
    const t = texture;
    if (!t) return;
    // Switching to a different texture: always broadcast it once.
    if (lastPushedIdRef.current !== t.id) {
      collab.pushEntry(toSync(t));
      lastPushedIdRef.current = t.id;
      lastPushedRef.current = new Uint8ClampedArray(t.current);
      return;
    }
    if (lastPushedRef.current && pixelsEqual(lastPushedRef.current, t.current)) return;
    collab.pushEntry(toSync(t));
    lastPushedRef.current = new Uint8ClampedArray(t.current);
  }, [texture?.current, texture?.id]);

  // Keep the shared project in sync with our local textures: any local texture
  // that isn't in the shared registry yet gets pushed (covers initial join AND
  // textures created/imported mid-session). We only push textures absent from the
  // registry so we never overwrite a collaborator's in-progress edits.
  useEffect(() => {
    if (collabStatus !== 'connected' || !listLoaded) return;
    const reg = collab.getRegistry();
    for (const id of textureList) {
      if (id === 'none') continue;
      if (!reg[id]) void pushLocalTextureById(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabStatus, listLoaded, textureList]);

  // Broadcast the local cursor position.
  useEffect(() => {
    if (!collab.isActive() || !cursorPos || !texture) return;
    collab.setCursor(cursorPos.x, cursorPos.y, texture.id);
  }, [cursorPos, texture?.id]);

  async function startCollabSession(relayUrl?: string): Promise<void> {
    try {
      const info = await collab.startHost(projectId, relayUrl);
      setCollabHostInfo(info);
      setCollabStatus('connecting');
      const t = useProject.getState().texture;
      if (t) {
        collab.pushEntry(toSync(t));
        lastPushedRef.current = new Uint8ClampedArray(t.current);
      }
    } catch (e) {
      console.error('Failed to start collab session', e);
    }
  }

  function leaveCollabSession(): void {
    collab.disconnect();
    lastPushedRef.current = null;
    setCollabHostInfo(null);
    setCollabStatus('offline');
    setCollabError(null);
    setCollabPeers([]);
  }

  function joinCollabSession(): void {
    if (!joinLink.trim()) return;
    collab.joinLink(joinLink.trim());
    setCollabStatus('connecting');
  }

  const viewportRef = useRef<CanvasViewportHandle>(null);
  const stampFileInputRef = useRef<HTMLInputElement>(null);
  const [stamp, setStamp] = useState<StampState | null>(null);

  async function loadStampFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      setStamp({
        pixels: new Uint8ClampedArray(data.data),
        width: img.width,
        height: img.height,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function rotateStamp(s: StampState): { pixels: Uint8ClampedArray; width: number; height: number } | null {
    if (s.rotation === 0) return { pixels: s.pixels, width: s.width, height: s.height };
    const c = document.createElement('canvas');
    const swap = s.rotation === 90 || s.rotation === 270;
    c.width = swap ? s.height : s.width;
    c.height = swap ? s.width : s.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((s.rotation * Math.PI) / 180);
    const tmp = document.createElement('canvas');
    tmp.width = s.width;
    tmp.height = s.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return null;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(s.pixels), s.width, s.height), 0, 0);
    ctx.drawImage(tmp, -s.width / 2, -s.height / 2);
    const out = ctx.getImageData(0, 0, c.width, c.height);
    return { pixels: new Uint8ClampedArray(out.data), width: c.width, height: c.height };
  }

  function rescaleViaCanvas(
    pixels: Uint8ClampedArray,
    sw: number,
    sh: number,
    dw: number,
    dh: number,
  ): Uint8ClampedArray {
    const src = document.createElement('canvas');
    src.width = sw;
    src.height = sh;
    const sctx = src.getContext('2d');
    if (!sctx) return pixels;
    sctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), sw, sh), 0, 0);
    const dst = document.createElement('canvas');
    dst.width = dw;
    dst.height = dh;
    const dctx = dst.getContext('2d');
    if (!dctx) return pixels;
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, dw, dh);
    return new Uint8ClampedArray(dctx.getImageData(0, 0, dw, dh).data);
  }

  function applyStampOpacity(
    pixels: Uint8ClampedArray,
    w: number,
    h: number,
    opacity: number,
  ): Uint8ClampedArray {
    if (opacity >= 1) return pixels;
    const out = new Uint8ClampedArray(pixels);
    for (let i = 3; i < out.length; i += 4) {
      out[i] = Math.round(out[i] * opacity);
    }
    return out;
  }

  // Track whether we've already created the demo for this project in this session
  const demoCreatedRef = useRef<string | null>(null);
  async function ensureDemoTexture(): Promise<void> {
    if (demoCreatedRef.current === projectId) return;
    demoCreatedRef.current = projectId;
    const id = 'untitled_16x16';
    try {
      const tex = await window.api.textures.load(projectId, id);
      setTextureList((prev) => (prev.includes(id) ? prev : [...prev, id]));
      loadProject(projectId, tex);
      return;
    } catch {
      // doesn't exist — create
    }
    const size = 16;
    const pixels = makeDemoPixels(size);
    await window.api.textures.savePixels(projectId, id, size, size, pixels);
    setTextureList((prev) => [...prev, id]);
    const tex = await window.api.textures.load(projectId, id);
    loadProject(projectId, tex);
  }

  // ===== Pointer handlers =====

  function applyDotsGradient(): void {
    const t = useProject.getState().texture;
    const ui = useEditorUi.getState();
    const dots = gradientDotsRef.current;
    if (!t || dots.length === 0) return;
    const from = hexToTuple(ui.primaryColor);
    const to = hexToTuple(ui.secondaryColor);
    const pixels = new Uint8ClampedArray(t.current);
    const r = gradientDots(
      pixels,
      t.width,
      t.height,
      dots,
      from,
      to,
      ui.gradientUseAngle ? ui.gradientAngle : undefined,
      Math.max(0, Math.floor((ui.gradientThickness - 1) / 2)),
    );
    if (r) applyEdit(pixels, r);
    gradientDotsRef.current = [];
    forceTick((n) => n + 1);
  }

  const handlePointer = useCallback(
    (e: {
      type: 'down' | 'move' | 'up' | 'leave';
      pixel: { x: number; y: number };
      button: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
    }) => {
      if (!texture) return;
      const tool = activeToolRef.current;
      const color = primaryColorRef.current;

      if (e.type === 'move') {
        setCursorPos(e.pixel);
      }

      // Pointer left the canvas: end any in-progress drawing/select so we
      // don't keep painting after the cursor is released off-screen.
      if (e.type === 'leave') {
        if (pointer.current.drawing || pointer.current.selMode) {
          pointer.current.drawing = false;
          pointer.current.last = null;
          pointer.current.selMode = null;
        }
        return;
      }

      // Mirror-aware helpers
      const mirrorMode = useEditorUi.getState().mirror;
      const w = texture.width;
      const h = texture.height;
      const applyMirror = (x: number, y: number): Array<[number, number]> => {
        const pts: Array<[number, number]> = [[x, y]];
        if (mirrorMode === 'horizontal' || mirrorMode === 'quad') {
          pts.push([mirrorX(x, w), y]);
        }
        if (mirrorMode === 'vertical' || mirrorMode === 'quad') {
          pts.push([x, mirrorY(y, h)]);
        }
        if (mirrorMode === 'quad') {
          pts.push([mirrorX(x, w), mirrorY(y, h)]);
        }
        return pts;
      };
      const mirrorPath = (
        path: Array<{ x: number; y: number }>,
      ): Array<Array<{ x: number; y: number }>> => {
        const variants: Array<Array<{ x: number; y: number }>> = [path];
        if (mirrorMode === 'horizontal' || mirrorMode === 'quad') {
          variants.push(path.map((p) => ({ x: mirrorX(p.x, w), y: p.y })));
        }
        if (mirrorMode === 'vertical' || mirrorMode === 'quad') {
          variants.push(path.map((p) => ({ x: p.x, y: mirrorY(p.y, h) })));
        }
        if (mirrorMode === 'quad') {
          variants.push(path.map((p) => ({ x: mirrorX(p.x, w), y: mirrorY(p.y, h) })));
        }
        return variants;
      };

      if (tool === 'pencil' || tool === 'eraser') {
        if (e.type === 'down') {
          pointer.current.drawing = true;
          pointer.current.last = e.pixel;
          const pixels = new Uint8ClampedArray(texture.current);
          const tuple = hexToTuple(color);
          let rect: { x: number; y: number; w: number; h: number } | null = null;
          for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
            let r: { x: number; y: number; w: number; h: number } | null = null;
            if (tool === 'eraser') {
              r = erasePixel(pixels, px, py, texture.width, texture.height, brushSizeRef.current);
            } else {
              r = paintPixel(pixels, px, py, texture.width, texture.height, tuple, brushSizeRef.current);
            }
            if (r) rect = unionRect(rect, r);
          }
          if (rect) applyEdit(pixels, rect);
        } else if (e.type === 'move' && pointer.current.drawing) {
          const last = pointer.current.last ?? e.pixel;
          const basePts: Array<[number, number]> = e.shiftKey
            ? [[last.x, last.y], [e.pixel.x, e.pixel.y]]
            : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
          const segments: Array<Array<[number, number]>> = [basePts];
          if (mirrorMode === 'horizontal' || mirrorMode === 'quad') {
            const a = mirrorX(last.x, w);
            const b = mirrorX(e.pixel.x, w);
            segments.push(e.shiftKey ? [[a, last.y], [b, e.pixel.y]] : bresenhamLine(a, last.y, b, e.pixel.y));
          }
          if (mirrorMode === 'vertical' || mirrorMode === 'quad') {
            const a = mirrorY(last.y, h);
            const b = mirrorY(e.pixel.y, h);
            segments.push(e.shiftKey ? [[last.x, a], [e.pixel.x, b]] : bresenhamLine(last.x, a, e.pixel.x, b));
          }
          if (mirrorMode === 'quad') {
            const a = mirrorX(last.x, w);
            const b = mirrorY(last.y, h);
            const c = mirrorX(e.pixel.x, w);
            const d = mirrorY(e.pixel.y, h);
            segments.push(e.shiftKey ? [[a, b], [c, d]] : bresenhamLine(a, b, c, d));
          }
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          const pixels = new Uint8ClampedArray(texture.current);
          const tuple = hexToTuple(color);
          for (const seg of segments) {
            for (const point of seg) {
              const px = point[0];
              const py = point[1];
              let r: { x: number; y: number; w: number; h: number } | null = null;
              if (tool === 'eraser') {
                r = erasePixel(pixels, px, py, texture.width, texture.height, brushSizeRef.current);
              } else {
                r = paintPixel(pixels, px, py, texture.width, texture.height, tuple, brushSizeRef.current);
              }
              if (r) combined = unionRect(combined, r);
            }
          }
          pointer.current.last = e.pixel;
          if (combined) applyEdit(pixels, combined);
        } else if (e.type === 'up') {
          pointer.current.drawing = false;
          pointer.current.last = null;
        }
      } else if (tool === 'fill') {
        if (e.type === 'down') {
          // Apply fill at mirrored points; each fill produces its own rect
          const pixels = new Uint8ClampedArray(texture.current);
          const tuple = hexToTuple(color);
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
            const r = floodFill(pixels, texture.width, texture.height, px, py, tuple);
            if (r) combined = unionRect(combined, r);
          }
          if (combined) applyEdit(pixels, combined);
        }
      } else if (tool === 'shade') {
        if (e.type === 'down') {
          pointer.current.drawing = true;
          pointer.current.last = e.pixel;
          const pixels = new Uint8ClampedArray(texture.current);
          const ui = useEditorUi.getState();
          const tint = hexToTuple(ui.primaryColor);
          const rect = shadePixels(
            pixels,
            texture.width,
            texture.height,
            e.pixel.x,
            e.pixel.y,
            brushSizeRef.current,
            ui.shadeMode,
            ui.shadeMode === 'fade' ? Math.max(1, Math.round(ui.shadeStrength * 2.55)) : ui.shadeStrength,
            tint,
          );
          if (rect) applyEdit(pixels, rect);
        } else if (e.type === 'move' && pointer.current.drawing) {
          const last = pointer.current.last ?? e.pixel;
          const linePts = e.shiftKey
            ? [[last.x, last.y], [e.pixel.x, e.pixel.y]] as Array<[number, number]>
            : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
          const pixels = new Uint8ClampedArray(texture.current);
          const ui = useEditorUi.getState();
          const tint = hexToTuple(ui.primaryColor);
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const [px, py] of linePts) {
            const r = shadePixels(
              pixels,
              texture.width,
              texture.height,
              px,
              py,
              brushSizeRef.current,
              ui.shadeMode,
              ui.shadeMode === 'fade' ? Math.max(1, Math.round(ui.shadeStrength * 2.55)) : ui.shadeStrength,
              tint,
            );
            if (r) combined = unionRect(combined, r);
          }
          pointer.current.last = e.pixel;
          if (combined) applyEdit(pixels, combined);
        } else if (e.type === 'up') {
          pointer.current.drawing = false;
          pointer.current.last = null;
        }
      } else if (tool === 'gradient') {
        const ui = useEditorUi.getState();

        // Dots mode: each click selects a single pixel; nothing between is
        // filled. Collect clicks, then press Enter to apply the gradient to
        // just those pixels.
        if (ui.gradientMode === 'dots') {
          if (e.type === 'down') {
            const dots = gradientDotsRef.current;
            if (!dots.some((d) => d.x === e.pixel.x && d.y === e.pixel.y)) {
              dots.push(e.pixel);
              forceTick((n) => n + 1);
            }
          }
          return;
        }

        if (e.type === 'down') {
          gradientPathRef.current = [e.pixel];
          pointer.current.drawing = true;
        } else if (e.type === 'move' && pointer.current.drawing) {
          const path = gradientPathRef.current;
          const last = path[path.length - 1];
          if (!last || Math.abs(last.x - e.pixel.x) > 0 || Math.abs(last.y - e.pixel.y) > 0) {
            path.push(e.pixel);
            forceTick((n) => n + 1);
          }
        } else if (e.type === 'up' && pointer.current.drawing) {
          pointer.current.drawing = false;
          const from = hexToTuple(ui.primaryColor);
          const to = hexToTuple(ui.secondaryColor);

          // Point mode: radial gradient from the clicked point.
          if (ui.gradientMode === 'point') {
            const pt = gradientPathRef.current[0];
            gradientPathRef.current = [];
            if (!pt) return;
            const pixels = new Uint8ClampedArray(texture.current);
            // Thickness controls the point radius (0 means "fill to edges").
            const radius = ui.gradientThickness > 1 ? Math.max(1, Math.floor(ui.gradientThickness / 2)) : undefined;
            let combined: { x: number; y: number; w: number; h: number } | null = null;
            for (const [px, py] of applyMirror(pt.x, pt.y)) {
              const r = gradientPoint(pixels, texture.width, texture.height, px, py, from, to, radius);
              combined = unionRect(combined, r);
            }
            if (combined) applyEdit(pixels, combined);
            return;
          }

          // Rectangle mode: fill the current selection with a gradient.
          if (ui.gradientMode === 'rectangle') {
            const sel = texture.selection;
            if (!sel) return;
            const pixels = new Uint8ClampedArray(texture.current);
            let combined: { x: number; y: number; w: number; h: number } | null = null;
            for (const r of mirrorRect(sel, ui.mirror, texture.width, texture.height)) {
              const rr = ui.gradientUseAngle
                ? gradientRectAngle(pixels, texture.width, texture.height, r, from, to, ui.gradientAngle)
                : gradientRect(pixels, texture.width, texture.height, r, from, to, sel.w > sel.h ? 'horizontal' : 'vertical');
              combined = unionRect(combined, rr);
            }
            if (combined) applyEdit(pixels, combined);
            return;
          }

          // Curve mode: gradient stroke along the freehand path.
          const path = gradientPathRef.current;
          gradientPathRef.current = [];
          if (path.length < 2) return;
          const pixels = new Uint8ClampedArray(texture.current);
          const selRect = texture.selection ?? undefined;
          const thickness = ui.gradientThickness;
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const vp of mirrorPath(path)) {
            const r = ui.gradientUseAngle
              ? gradientAlongPathAngle(pixels, texture.width, texture.height, vp, from, to, selRect, thickness, ui.gradientAngle)
              : gradientAlongPath(pixels, texture.width, texture.height, vp, from, to, selRect, thickness);
            if (r) combined = unionRect(combined, r);
          }
          if (combined) applyEdit(pixels, combined);
        }
      } else if (tool === 'smush') {
        if (e.type === 'down') {
          pointer.current.drawing = true;
          pointer.current.last = e.pixel;
          const pixels = new Uint8ClampedArray(texture.current);
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const [px, py] of applyMirror(e.pixel.x, e.pixel.y)) {
            const r = smushPixels(pixels, texture.width, texture.height, px, py, brushSizeRef.current, 0.6);
            if (r) combined = unionRect(combined, r);
          }
          if (combined) applyEdit(pixels, combined);
        } else if (e.type === 'move' && pointer.current.drawing) {
          const last = pointer.current.last ?? e.pixel;
          const linePts = e.shiftKey
            ? ([[last.x, last.y], [e.pixel.x, e.pixel.y]] as Array<[number, number]>)
            : bresenhamLine(last.x, last.y, e.pixel.x, e.pixel.y);
          const pixels = new Uint8ClampedArray(texture.current);
          let combined: { x: number; y: number; w: number; h: number } | null = null;
          for (const vp of mirrorPath(linePts.map((p) => ({ x: p[0], y: p[1] })))) {
            for (const pt of vp) {
              const r = smushPixels(pixels, texture.width, texture.height, pt.x, pt.y, brushSizeRef.current, 0.6);
              if (r) combined = unionRect(combined, r);
            }
          }
          pointer.current.last = e.pixel;
          if (combined) applyEdit(pixels, combined);
        } else if (e.type === 'up') {
          pointer.current.drawing = false;
          pointer.current.last = null;
        }
      } else if (tool === 'eyedropper') {
        if (e.type === 'down') {
          const px = getPixel(texture.current, e.pixel.x, e.pixel.y, texture.width);
          const hex = rgbaToHex({ r: px[0], g: px[1], b: px[2], a: px[3] });
          useEditorUi.setState({ primaryColor: hex });
        }
      } else if (tool === 'select') {
        if (!texture) return;
        const sel = texture.selection;
        // Detect what we're interacting with on pointer down.
        // Selection handles: 4 corners + 4 edges. Each handle is a small box
        // (~6 / scale screen pixels) in texture-pixel space.
        const handleHit = pixelInsideHandle(e.pixel.x, e.pixel.y, sel, texture.width, texture.height, zoomRef.current);
        const inside = pixelInsideRect(e.pixel.x, e.pixel.y, sel);

        if (e.type === 'down') {
          if (handleHit) {
            pointer.current.selMode = {
              kind: 'resize',
              anchor: { ...e.pixel },
              original: sel ? { ...sel } : { x: 0, y: 0, w: 1, h: 1 },
            };
          } else if (inside && sel) {
            pointer.current.selMode = {
              kind: 'move',
              origin: { ...e.pixel },
              originalRect: { ...sel },
              originalBackup: texture.selectionBackup ? new Uint8ClampedArray(texture.selectionBackup) : null,
            };
          } else {
            // New selection from scratch
            pointer.current.selMode = { kind: 'new', anchor: { ...e.pixel } };
            setSelection({ x: e.pixel.x, y: e.pixel.y, w: 1, h: 1 });
          }
        } else if (e.type === 'move') {
          const m = pointer.current.selMode;
          if (!m) return;
          if (m.kind === 'new') {
            const x0 = Math.min(m.anchor.x, e.pixel.x);
            const y0 = Math.min(m.anchor.y, e.pixel.y);
            const x1 = Math.max(m.anchor.x, e.pixel.x);
            const y1 = Math.max(m.anchor.y, e.pixel.y);
            setSelection({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
          } else if (m.kind === 'move' && m.originalRect) {
            const dx = e.pixel.x - m.origin.x;
            const dy = e.pixel.y - m.origin.y;
            const newX = Math.max(0, Math.min(m.originalRect.x + dx, texture.width - m.originalRect.w));
            const newY = Math.max(0, Math.min(m.originalRect.y + dy, texture.height - m.originalRect.h));
            // Move selection rectangle
            const newRect = { x: newX, y: newY, w: m.originalRect.w, h: m.originalRect.h };
            setSelection(newRect);
            // Also restore the original pixel region to background,
            // then paste the backed-up pixels at the new location.
            if (m.originalBackup) {
              const pixels = new Uint8ClampedArray(texture.current);
              // Restore original region first (so we don't leave ghost pixels at old spot)
              for (let y = 0; y < m.originalRect.h; y++) {
                for (let x = 0; x < m.originalRect.w; x++) {
                  const srcI = (y * m.originalRect.w + x) * 4;
                  const dstI = ((m.originalRect.y + y) * texture.width + (m.originalRect.x + x)) * 4;
                  pixels[dstI] = m.originalBackup[srcI];
                  pixels[dstI + 1] = m.originalBackup[srcI + 1];
                  pixels[dstI + 2] = m.originalBackup[srcI + 2];
                  pixels[dstI + 3] = m.originalBackup[srcI + 3];
                }
              }
              // Paste backup at new position
              for (let y = 0; y < m.originalRect.h; y++) {
                for (let x = 0; x < m.originalRect.w; x++) {
                  const srcI = (y * m.originalRect.w + x) * 4;
                  const dy2 = newY + y;
                  const dx2 = newX + x;
                  if (dy2 < 0 || dy2 >= texture.height || dx2 < 0 || dx2 >= texture.width) continue;
                  const dstI = (dy2 * texture.width + dx2) * 4;
                  pixels[dstI] = m.originalBackup[srcI];
                  pixels[dstI + 1] = m.originalBackup[srcI + 1];
                  pixels[dstI + 2] = m.originalBackup[srcI + 2];
                  pixels[dstI + 3] = m.originalBackup[srcI + 3];
                }
              }
              applyEdit(pixels, { x: 0, y: 0, w: texture.width, h: texture.height });
              // Refresh selection backup so subsequent moves work
              const refreshed = new Uint8ClampedArray(m.originalBackup.length);
              for (let y = 0; y < m.originalRect.h; y++) {
                for (let x = 0; x < m.originalRect.w; x++) {
                  const srcI = (y * m.originalRect.w + x) * 4;
                  refreshed[srcI] = m.originalBackup[srcI];
                  refreshed[srcI + 1] = m.originalBackup[srcI + 1];
                  refreshed[srcI + 2] = m.originalBackup[srcI + 2];
                  refreshed[srcI + 3] = m.originalBackup[srcI + 3];
                }
              }
              useProject.setState((s) => {
                if (s.texture) s.texture.selectionBackup = refreshed;
              });
            }
          } else if (m.kind === 'resize' && m.original && handleHit) {
            // Compute the new rect from anchor + cursor using the corner/edge being dragged
            const ax = m.anchor.x;
            const ay = m.anchor.y;
            const cx = e.pixel.x;
            const cy = e.pixel.y;
            const o = m.original;
            let nx = o.x;
            let ny = o.y;
            let nw = o.w;
            let nh = o.h;
            const dx = cx - ax;
            const dy = cy - ay;
            switch (handleHit) {
              case 'br':
                nw = o.w + dx;
                nh = o.h + dy;
                break;
              case 'tr':
                ny = o.y + dy;
                nh = o.h - dy;
                nw = o.w + dx;
                break;
              case 'bl':
                nx = o.x + dx;
                nw = o.w - dx;
                nh = o.h + dy;
                break;
              case 'tl':
                nx = o.x + dx;
                ny = o.y + dy;
                nw = o.w - dx;
                nh = o.h - dy;
                break;
              case 't':
                ny = o.y + dy;
                nh = o.h - dy;
                break;
              case 'b':
                nh = o.h + dy;
                break;
              case 'l':
                nx = o.x + dx;
                nw = o.w - dx;
                break;
              case 'r':
                nw = o.w + dx;
                break;
            }
            nw = Math.max(1, nw);
            nh = Math.max(1, nh);
            // After resizing, anchor in screen space needs to stay attached to the
            // same corner we grabbed. Easier: clear and re-create selection here.
            // The actual pixel resize happens on pointer-up via applyEdit.
            // For real-time feedback, we just update the rectangle.
            if (nw < 1 || nh < 1) return;
            if (nx < 0) nx = 0;
            if (ny < 0) ny = 0;
            if (nx + nw > texture.width) nw = texture.width - nx;
            if (ny + nh > texture.height) nh = texture.height - ny;
            setSelection({ x: nx, y: ny, w: nw, h: nh });
          }
        } else if (e.type === 'up') {
          const m = pointer.current.selMode;
          if (m?.kind === 'resize') {
            // Apply the resize: crop or extend the previously-backed-up pixels.
            const newSel = texture.selection;
            const oldSel = m.original;
            const backup = texture.selectionBackup;
            if (newSel && oldSel && backup) {
              const oldW = oldSel.w;
              const oldH = oldSel.h;
              const newW = newSel.w;
              const newH = newSel.h;
              // Map old pixels to new by anchor-preserving resize.
              // We support the 8-handle cases by computing the source pixel
              // for each destination pixel using the matching anchor.
              const newPixels = new Uint8ClampedArray(newW * newH * 4);
              const computeSrc = (dx: number, dy: number): { x: number; y: number } => {
                const mh = handleHit!;
                const o = oldSel;
                let sx = 0;
                let sy = 0;
                switch (mh) {
                  case 'br':
                    sx = (dx / newW) * oldW;
                    sy = (dy / newH) * oldH;
                    break;
                  case 'tr':
                    sx = (dx / newW) * oldW;
                    sy = ((newH - 1 - dy) / newH) * oldH;
                    break;
                  case 'bl':
                    sx = ((newW - 1 - dx) / newW) * oldW;
                    sy = (dy / newH) * oldH;
                    break;
                  case 'tl':
                    sx = ((newW - 1 - dx) / newW) * oldW;
                    sy = ((newH - 1 - dy) / newH) * oldH;
                    break;
                  case 't':
                    sx = (dx / newW) * oldW;
                    sy = ((newH - 1 - dy) / newH) * oldH;
                    break;
                  case 'b':
                    sx = (dx / newW) * oldW;
                    sy = (dy / newH) * oldH;
                    break;
                  case 'l':
                    sx = ((newW - 1 - dx) / newW) * oldW;
                    sy = (dy / newH) * oldH;
                    break;
                  case 'r':
                    sx = (dx / newW) * oldW;
                    sy = (dy / newH) * oldH;
                    break;
                }
                return { x: Math.max(0, Math.min(oldW - 1, Math.round(sx))), y: Math.max(0, Math.min(oldH - 1, Math.round(sy))) };
              };
              for (let dy = 0; dy < newH; dy++) {
                for (let dx = 0; dx < newW; dx++) {
                  const { x: sx, y: sy } = computeSrc(dx, dy);
                  const si = (sy * oldW + sx) * 4;
                  const di = (dy * newW + dx) * 4;
                  newPixels[di] = backup[si];
                  newPixels[di + 1] = backup[si + 1];
                  newPixels[di + 2] = backup[si + 2];
                  newPixels[di + 3] = backup[si + 3];
                }
              }
              // Clear the original region + paste the resized region.
              const pixels = new Uint8ClampedArray(texture.current);
              clearRect(pixels, texture.width, oldSel.x, oldSel.y, oldSel.w, oldSel.h);
              // Stamp resized pixels at newSel position
              for (let dy = 0; dy < newH; dy++) {
                for (let dx = 0; dx < newW; dx++) {
                  const sx = newSel.x + dx;
                  const sy = newSel.y + dy;
                  if (sx < 0 || sx >= texture.width || sy < 0 || sy >= texture.height) continue;
                  const si = (dy * newW + dx) * 4;
                  const di = (sy * texture.width + sx) * 4;
                  pixels[di] = newPixels[si];
                  pixels[di + 1] = newPixels[si + 1];
                  pixels[di + 2] = newPixels[si + 2];
                  pixels[di + 3] = newPixels[si + 3];
                }
              }
              const minX = Math.min(oldSel.x, newSel.x);
              const minY = Math.min(oldSel.y, newSel.y);
              const maxX = Math.max(oldSel.x + oldSel.w, newSel.x + newSel.w);
              const maxY = Math.max(oldSel.y + oldSel.h, newSel.y + newSel.h);
              applyEdit(pixels, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
              // Refresh selection backup to reflect the new size
              useProject.setState((s) => {
                if (s.texture) s.texture.selectionBackup = newPixels;
              });
            }
          }
          pointer.current.selMode = null;
        }
      }
    },
    [texture, applyEdit],
  );

  // Clipboard ops are handled via store actions; keyboard shortcuts are below.

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const cmd = e.ctrlKey || e.metaKey;

      if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((cmd && e.key.toLowerCase() === 'y') || (cmd && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
        return;
      }
      if (cmd && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'a' && !e.shiftKey) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'c' && texture?.selection) {
        e.preventDefault();
        const sel = texture.selection;
        if (sel) {
          const clip = copyRect(texture.current, texture.width, sel.x, sel.y, sel.w, sel.h);
          useClipboard.getState().add({ pixels: clip, width: sel.w, height: sel.h });
        }
        return;
      }
      if (cmd && e.key.toLowerCase() === 'x' && texture?.selection) {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteAtSelection();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && texture?.selection) {
        e.preventDefault();
        deleteSelectionRegion();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (pointer.current.selMode) {
          pointer.current.selMode = null;
        }
        clearSelection();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (texture?.selection) {
          e.preventDefault();
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowUp') dy = -1;
          else if (e.key === 'ArrowDown') dy = 1;
          else if (e.key === 'ArrowLeft') dx = -1;
          else if (e.key === 'ArrowRight') dx = 1;
          moveSelection(dx, dy);
          return;
        }
      }
      if (e.key === '[') {
        e.preventDefault();
        setBrushSize(brushSizeRef.current - 1);
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        setBrushSize(brushSizeRef.current + 1);
        return;
      }
      if (e.key === "'" && cmd) {
        e.preventDefault();
        setShowGrid(!showGrid);
        return;
      }
      if (e.key === '0' && cmd) {
        e.preventDefault();
        viewportRef.current?.fitToScreen();
        return;
      }
      if (e.key === 'r' && cmd && !e.shiftKey) {
        e.preventDefault();
        if (texture) setResizeOpen(true);
        return;
      }
      if (e.key === 'M' && e.shiftKey) {
        e.preventDefault();
        cycleMirror();
        return;
      }

      if (e.key === 'Enter' && activeToolRef.current === 'gradient' && useEditorUi.getState().gradientMode === 'dots') {
        e.preventDefault();
        applyDotsGradient();
        return;
      }

      const map: Record<string, ToolId> = {
        b: 'pencil',
        e: 'eraser',
        g: 'fill',
        v: 'gradient',
        n: 'smush',
        i: 'eyedropper',
        h: 'hand',
        m: 'select',
        s: 'shade',
      };
      const key = e.key.toLowerCase();
      if (map[key] && !cmd) {
        setTool(map[key]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveNow, showGrid, brushSize]);

  // Import a PNG as a new texture in the project (Phase 6: single-PNG import).
  async function importFromFile(): Promise<void> {
    const res = await window.api.io.importPng(projectId);
    if (res.cancelled || !res.id) return;
    try {
      const tex = await window.api.textures.load(projectId, res.id);
      setTextureList((prev) => (prev.includes(res.id!) ? prev : [...prev, res.id!]));
      loadProject(projectId, tex);
      if (collab.isActive()) void pushLocalTextureById(res.id!);
    } catch (e) {
      console.error('Failed to load imported texture', e);
    }
  }

  // Create a fresh, empty (transparent) texture — a blank space to draw on,
  // without requiring a PNG import.
  async function createBlankTexture(size = 16): Promise<void> {
    const id = `untitled_${size}x${size}_${Date.now().toString(36)}`;
    const pixels = new Uint8ClampedArray(size * size * 4);
    await window.api.textures.savePixels(projectId, id, size, size, pixels);
    setTextureList((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const tex = await window.api.textures.load(projectId, id);
    loadProject(projectId, tex);
    if (collab.isActive()) void pushLocalTextureById(id);
  }

  async function deleteCurrentTexture(): Promise<void> {
    if (!texture) return;
    const id = texture.id;
    try {
      await window.api.textures.delete(projectId, id);
    } catch (e) {
      console.error('Failed to delete texture', e);
    }
    const remaining = textureList.filter((t) => t !== id);
    setTextureList(remaining);
    materializedRef.current.delete(id);
    if (collab.isActive()) collab.deleteEntry(id);
    if (remaining.length > 0) {
      await openTexture(remaining[0]);
    } else {
      useProject.setState({ texture: null });
    }
    setDeleteConfirm(false);
  }

  // Demo creation now lives inside the texture-list effect above (ensureDemoTexture)
  void listLoaded;

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      const sel = texture?.selection ?? null;
      const myId = texture?.id;

      // Live preview of the in-progress gradient stroke
      if (activeToolRef.current === 'gradient' && gradientPathRef.current.length > 0) {
        const path = gradientPathRef.current;
        ctx.strokeStyle = 'rgba(108, 240, 214, 0.95)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(path[0].x * scale + scale / 2, path[0].y * scale + scale / 2);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x * scale + scale / 2, path[i].y * scale + scale / 2);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (const p of path) {
          ctx.beginPath();
          ctx.arc(p.x * scale + scale / 2, p.y * scale + scale / 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Highlight the individually selected "dots" pixels (gradient dots mode).
      if (activeToolRef.current === 'gradient' && gradientDotsRef.current.length > 0) {
        ctx.fillStyle = 'rgba(108, 240, 214, 0.9)';
        for (const d of gradientDotsRef.current) {
          ctx.fillRect(d.x * scale, d.y * scale, scale, scale);
        }
      }

      if (sel) {
        const x = sel.x * scale;
        const y = sel.y * scale;
        const w = sel.w * scale;
        const h = sel.h * scale;
        // Outer dashed border
        ctx.strokeStyle = 'rgba(108, 240, 214, 0.95)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
        // Handles (8 small squares)
        const handleR = Math.max(4, Math.min(8, 8 / Math.max(scale, 0.01)));
        const half = handleR / 2;
        const handles: Array<[number, number]> = [
          [sel.x, sel.y],
          [sel.x + sel.w - 1, sel.y],
          [sel.x, sel.y + sel.h - 1],
          [sel.x + sel.w - 1, sel.y + sel.h - 1],
          [sel.x + Math.floor(sel.w / 2), sel.y],
          [sel.x + Math.floor(sel.w / 2), sel.y + sel.h - 1],
          [sel.x, sel.y + Math.floor(sel.h / 2)],
          [sel.x + sel.w - 1, sel.y + Math.floor(sel.h / 2)],
        ];
        ctx.fillStyle = '#6cf0d6';
        ctx.strokeStyle = '#0b0d10';
        ctx.lineWidth = 1;
        for (const [hx, hy] of handles) {
          const px = hx * scale - half;
          const py = hy * scale - half;
          ctx.fillRect(px, py, handleR, handleR);
          ctx.strokeRect(px + 0.5, py + 0.5, handleR - 1, handleR - 1);
        }
      }

      // Remote collaborator cursors (drawn even with no local selection)
      const peers = collab.getPeers();
      for (const peer of peers) {
        if (!peer.cursor || peer.cursor.textureId !== myId) continue;
        const cx = peer.cursor.x * scale;
        const cy = peer.cursor.y * scale;
        ctx.strokeStyle = peer.color;
        ctx.fillStyle = peer.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy);
        ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 6);
        ctx.stroke();
        ctx.font = '10px sans-serif';
        const label = `${peer.name}`;
        const tw = ctx.measureText(label).width;
        ctx.fillRect(cx + 6, cy + 6, tw + 6, 14);
        ctx.fillStyle = '#0b0d10';
        ctx.fillText(label, cx + 9, cy + 17);
      }
    },
    [texture, tick],
  );

  if (!projectId) {
    return (
      <div className="empty-state">
        <h2>No project selected</h2>
        <Link to="/projects">Back to projects</Link>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <div className="toolbar">
        <div className="toolbar-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={'tool-btn' + (activeTool === t.id ? ' active' : '')}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
              data-tooltip={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
              aria-label={t.label}
            >
              <ToolIcon id={t.id} />
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="tool-btn"
            title="Undo (Ctrl+Z)"
            data-tooltip="Undo (Ctrl+Z)"
            onClick={() => undo()}
            disabled={!canUndo()}
          >
            <UndoIcon />
          </button>
          <button
            className="tool-btn"
            title="Redo (Ctrl+Shift+Z)"
            data-tooltip="Redo (Ctrl+Shift+Z)"
            onClick={() => redo()}
            disabled={!canRedo()}
          >
            <RedoIcon />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className={'tool-btn' + (mirror !== 'none' ? ' active' : '')}
            title={`Mirror: ${mirror} (Shift+M cycles)`}
            data-tooltip={`Mirror: ${mirror} (Shift+M cycles)`}
            onClick={() => cycleMirror()}
          >
            <MirrorIcon mode={mirror} />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="tool-btn"
            title="Rotate 90° CW"
            data-tooltip="Rotate 90° CW"
            onClick={() => useProject.getState().transform('rotate-cw')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-cw" />
          </button>
          <button
            className="tool-btn"
            title="Rotate 90° CCW"
            data-tooltip="Rotate 90° CCW"
            onClick={() => useProject.getState().transform('rotate-ccw')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-ccw" />
          </button>
          <button
            className="tool-btn"
            title="Rotate 180°"
            data-tooltip="Rotate 180°"
            onClick={() => useProject.getState().transform('rotate-180')}
            disabled={!texture}
          >
            <ActionGlyph name="rotate-180" />
          </button>
          <button
            className="tool-btn"
            title="Flip horizontal"
            data-tooltip="Flip horizontal"
            onClick={() => useProject.getState().transform('flip-h')}
            disabled={!texture}
          >
            <ActionGlyph name="flip-h" />
          </button>
          <button
            className="tool-btn"
            title="Flip vertical"
            data-tooltip="Flip vertical"
            onClick={() => useProject.getState().transform('flip-v')}
            disabled={!texture}
          >
            <ActionGlyph name="flip-v" />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group">
          <button
            className="tool-btn"
            title="Zoom out"
            data-tooltip="Zoom out"
            onClick={() => viewportRef.current?.resetZoom()}
          >
            <ZoomOutIcon />
          </button>
          <button
            className="tool-btn"
            title="Fit to screen (Ctrl+0)"
            data-tooltip="Fit to screen (Ctrl+0)"
            onClick={() => viewportRef.current?.fitToScreen()}
          >
            <FitIcon />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <Button variant="ghost" onClick={() => reset()} disabled={!texture}>
          Reset to original
        </Button>
        <Button
          variant="ghost"
          onClick={() => useProject.getState().resetToSaved()}
          disabled={!texture || !texture.savedSnapshot}
          title="Revert to the last saved version"
          data-tooltip="Revert to the last saved version"
        >
          Reset to saved
        </Button>
        <Button
          variant="primary"
          onClick={() => saveNow()}
          disabled={!texture || save.status === 'saving'}
        >
          {save.status === 'saving' ? 'Saving…' : 'Save'}
        </Button>
        <div style={{ marginLeft: 'auto' }}>
          <Button
            variant={collabStatus !== 'offline' ? 'primary' : 'ghost'}
            onClick={() => setCollabOpen((v) => !v)}
            title="Collaborate — share a link to edit together"
          >
            <span
              className={'status-dot ' + (collabStatus === 'connected' ? 'saved' : collabStatus === 'connecting' ? 'dirty' : 'idle')}
              style={{ marginRight: 6 }}
            />
            {collabStatus !== 'offline' ? 'Collab' : 'Collaborate'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/project/${projectId}/catalog`)}>
            Catalog
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/project/${projectId}/bulk`)}>
            Bulk Edit
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/project/${projectId}/export`)}>
            Import / Export
          </Button>
          <Button variant="ghost" onClick={() => setInfoOpen(true)} title="Help — what each tool does">
            Info
          </Button>
          <Button variant="ghost" onClick={() => setSheetOpen(true)} disabled={!texture}>
            Sprite sheet
          </Button>
          <Button variant="ghost" onClick={() => navigate('/projects')}>
            ← Projects
          </Button>
        </div>
      </div>

      <div className="texture-picker">
        <span style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Texture
        </span>
        {textureList.map((tid) => (
          <button
            key={tid}
            className={'texture-pill' + (texture?.id === tid ? ' active' : '')}
            onClick={() => openTexture(tid)}
          >
            {tid.startsWith('untitled_') ? 'Untitled' : basename(tid)}
          </button>
        ))}
        <button
          className="texture-pill"
          onClick={() => void createBlankTexture(16)}
          title="New blank texture"
        >
          + New
        </button>
        <button
          className="texture-pill"
          onClick={() => void importFromFile()}
          title="Import a PNG as a new texture"
        >
          Import
        </button>
        <button
          className="texture-pill danger"
          onClick={() => setDeleteConfirm(true)}
          disabled={!texture}
          title="Delete current texture"
        >
          Delete
        </button>
      </div>

      {deleteConfirm && texture && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete texture?</h3>
            <p>
              This will permanently delete <strong>{texture.name || texture.id}</strong> from the
              project. This cannot be undone.
            </p>
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void deleteCurrentTexture()}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {infoOpen && (
        <div className="modal-overlay" onClick={() => setInfoOpen(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Tools</h3>
            <div className="info-grid">
              <InfoItem name="Pencil (B)" desc="Paint with the primary color. Hold Shift to draw straight lines. Brush size is in the sidebar." />
              <InfoItem name="Eraser (E)" desc="Erase pixels to transparent. Hold Shift for straight erases." />
              <InfoItem name="Fill (G)" desc="Flood-fill a connected area with the primary color." />
              <InfoItem name="Gradient (V)" desc="Fade from primary to secondary color. Curve traces your stroke; Rectangle fills the selection; Point radiates from a click; Dots paints only individually-clicked pixels (press Enter to apply). Direction can follow start→finish or a chosen Angle. Thickness sets the stroke width." />
              <InfoItem name="Smush (N)" desc="Smear/blend pixels like wet paint. Drag to mix neighboring colors." />
              <InfoItem name="Eyedropper (I)" desc="Pick a color from the canvas into the primary color." />
              <InfoItem name="Hand (H)" desc="Pan around the canvas. Right-click also pans." />
              <InfoItem name="Select (M)" desc="Select a rectangle to edit, move, copy, or fill only that area. Drag the handles to resize." />
              <InfoItem name="Shade (S)" desc="Lighten, darken, tint, or fade the pixels under the brush." />
              <InfoItem name="Stamp" desc="Paste a copied image repeatedly, with rotation and scaling." />
              <InfoItem name="Recolor" desc="Adjust hue, saturation, brightness, and contrast, or invert/grayscale, with a live preview." />
            </div>
            <div className="info-shortcuts">
              <h4>Shortcuts</h4>
              <span>Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+C copy · Ctrl+V paste · Ctrl+wheel zoom · Ctrl+` grid</span>
            </div>
            <div className="modal-actions">
              <Button variant="primary" onClick={() => setInfoOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="canvas-area">
        {texture ? (
          <CanvasViewport ref={viewportRef} onPointer={handlePointer} overlay={drawOverlay} />
        ) : null}
        {texture && stamp && activeTool === 'stamp' && (
          <StampOverlay
            stamp={stamp}
            zoom={zoom}
            onChange={(next) => setStamp((s) => (s ? { ...s, ...next } : s))}
            onCommit={() => {
              // Apply stamp: rotate the source, then paste into texture
              const rotated = rotateStamp(stamp);
              if (rotated) {
                const pixels = new Uint8ClampedArray(texture.current);
                const scaledW = Math.round(rotated.width * stamp.scale);
                const scaledH = Math.round(rotated.height * stamp.scale);
                const scaled =
                  scaledW === rotated.width && scaledH === rotated.height
                    ? rotated.pixels
                    : rescaleViaCanvas(rotated.pixels, rotated.width, rotated.height, scaledW, scaledH);
                const tint = applyStampOpacity(scaled, scaledW, scaledH, stamp.opacity);
                const rect = pasteRect(pixels, texture.width, texture.height, tint, scaledW, scaledH, stamp.x, stamp.y);
                if (rect) applyEdit(pixels, rect);
              }
              setStamp(null);
            }}
            onCancel={() => setStamp(null)}
          />
        )}
        {!texture && (
          <div className="empty-state">
            <h2>No texture loaded</h2>
            <p>The project is empty. Create a new texture above.</p>
          </div>
        )}
      </div>

      <aside className="side">
        {collabOpen && (
          <div className="panel collab-panel">
            <h4 className="panel-title">Collaborate</h4>
            {collabStatus === 'offline' ? (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--fg-3)' }}>
                  Start a session to share a link, or join someone else&apos;s.
                </p>
                <Button variant="primary" onClick={() => void startCollabSession(relayInput.trim() || undefined)} disabled={!texture}>
                  Start session
                </Button>
                <input
                  className="color-input"
                  style={{ marginTop: 8, width: '100%', background: 'var(--bg-1)', padding: '4px 6px', fontSize: 11 }}
                  placeholder="Relay URL (optional, for internet)"
                  value={relayInput}
                  onChange={(e) => setRelayInput(e.target.value)}
                />
                <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                  <input
                    className="color-input"
                    style={{ flex: 1, background: 'var(--bg-1)', padding: '4px 6px', fontSize: 12 }}
                    placeholder="Paste invite link"
                    value={joinLink}
                    onChange={(e) => setJoinLink(e.target.value)}
                  />
                  <Button variant="ghost" onClick={joinCollabSession}>
                    Join
                  </Button>
                </div>
                {collabError && (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--danger)' }}>
                    {collabError}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="panel-row">
                  <span>Status</span>
                  <span style={{ color: collabStatus === 'connected' ? 'var(--accent)' : 'var(--fg-3)' }}>
                    {collabStatus === 'connected' ? 'Connected' : 'Connecting…'}
                  </span>
                </div>
                {collabError && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--danger)' }}>
                    {collabError}
                  </p>
                )}
                {collabIsHost && collabHostInfo && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 4 }}>Invite link</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="color-input"
                        style={{ flex: 1, background: 'var(--bg-1)', padding: '4px 6px', fontSize: 11 }}
                        readOnly
                        value={collabHostInfo.link}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(collabHostInfo.link);
                          setCollabCopied(true);
                          setTimeout(() => setCollabCopied(false), 1500);
                        }}
                      >
                        {collabCopied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 4 }}>
                    Peers ({collabPeers.length})
                  </div>
                  {collabPeers.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-3)' }}>Waiting for others…</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {collabPeers.map((p) => (
                        <div key={p.clientId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                          {p.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="ghost" onClick={leaveCollabSession} style={{ marginTop: 10 }}>
                  Leave session
                </Button>
              </>
            )}
          </div>
        )}
        <div className="panel">
          <h4 className="panel-title">Color</h4>
          <ColorPicker
            value={primaryColor}
            onChange={(hex) => useEditorUi.setState({ primaryColor: hex })}
            onCommit={(hex) => {
              const rgba = hexToRgba(hex);
              // ensure alpha 255 unless explicitly alpha < 255
              const finalHex =
                rgba.a === 255 ? hex : rgbaToHex({ ...rgba, a: rgba.a });
              useEditorUi.setState({ primaryColor: finalHex });
            }}
          />
          {activeTool === 'gradient' && (
            <>
              <div className="gradient-mode-row">
                <span className="panel-title-sm">Gradient mode</span>
                <div className="seg">
                  <button
                    className={gradientMode === 'curve' ? 'active' : ''}
                    onClick={() => setGradientMode('curve')}
                  >
                    Curve
                  </button>
                  <button
                    className={gradientMode === 'rectangle' ? 'active' : ''}
                    onClick={() => setGradientMode('rectangle')}
                  >
                    Rectangle
                  </button>
                  <button
                    className={gradientMode === 'point' ? 'active' : ''}
                    onClick={() => setGradientMode('point')}
                  >
                    Point
                  </button>
                  <button
                    className={gradientMode === 'dots' ? 'active' : ''}
                    onClick={() => setGradientMode('dots')}
                  >
                    Dots
                  </button>
                </div>
              </div>
              <div className="gradient-mode-row">
                <span className="panel-title-sm">Direction</span>
                <div className="seg">
                  <button
                    className={!gradientUseAngle ? 'active' : ''}
                    onClick={() => setGradientUseAngle(false)}
                  >
                    Start→finish
                  </button>
                  <button
                    className={gradientUseAngle ? 'active' : ''}
                    onClick={() => setGradientUseAngle(true)}
                  >
                    Angle
                  </button>
                </div>
              </div>
              {gradientUseAngle && (
                <div className="brush-size-row">
                  <span className="panel-title-sm">Angle</span>
                  <input
                    className="brush-input"
                    type="number"
                    min={0}
                    max={359}
                    value={gradientAngle}
                    onChange={(e) => setGradientAngle(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              )}
              {(gradientMode === 'curve' || gradientMode === 'point' || gradientMode === 'dots') && (
                <div className="brush-size-row">
                  <span className="panel-title-sm">Thickness</span>
                  <input
                    className="brush-input"
                    type="number"
                    min={1}
                    max={63}
                    step={2}
                    value={gradientThickness}
                    onChange={(e) => setGradientThickness(parseInt(e.target.value, 10) || 1)}
                  />
                </div>
              )}
              {gradientMode === 'dots' && (
                <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-3)' }}>
                  Click individual pixels to select them, then press Enter to apply the gradient.
                </p>
              )}
              <div className="secondary-color-row">
                <button
                  className="secondary-swap"
                  title="Swap primary / secondary"
                  onClick={() => {
                    const p = primaryColor;
                    useEditorUi.setState({ primaryColor: secondaryColor, secondaryColor: p });
                  }}
                >
                  ⇄
                </button>
                <div className="secondary-color-block">
                  <span className="panel-title-sm">Secondary (gradient end)</span>
                  <ColorPicker
                    value={secondaryColor}
                    onChange={(hex) => useEditorUi.setState({ secondaryColor: hex })}
                    onCommit={(hex) => {
                      const rgba = hexToRgba(hex);
                      const finalHex =
                        rgba.a === 255 ? hex : rgbaToHex({ ...rgba, a: rgba.a });
                      useEditorUi.setState({ secondaryColor: finalHex });
                    }}
                  />
                </div>
              </div>
            </>
          )}
          <div className="brush-size-row">
            <div className="brush-preview">
              <div
                className="brush-square"
                style={{
                  left: `${12 - brushSize * 2}px`,
                  top: `${12 - brushSize * 2}px`,
                  width: `${Math.max(2, brushSize * 4)}px`,
                  height: `${Math.max(2, brushSize * 4)}px`,
                }}
              />
            </div>
            <input
              className="brush-input"
              type="number"
              min={1}
              max={64}
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value, 10) || 1)}
            />
            <span className="kbd">[</span>
            <span className="kbd">]</span>
          </div>
        </div>

        <div className="panel">
          <h4 className="panel-title">Canvas</h4>
          <div className="panel-row">
            <span>Zoom</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{zoom}x</span>
          </div>
          <div className="panel-row">
            <span>Grid</span>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
          </div>
          <div className="panel-row">
            <span>Size</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {texture ? `${texture.width}×${texture.height}` : '—'}
            </span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <Button
              variant="ghost"
              onClick={() => {
                if (!texture) return;
                setRenameValue(texture.name.startsWith('Untitled') ? '' : texture.name);
                setRenaming(true);
              }}
              disabled={!texture}
              title="Rename texture"
            >
              Rename
            </Button>
            <Button variant="ghost" onClick={() => setResizeOpen(true)} disabled={!texture}>
              Resize
            </Button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <Button variant="ghost" onClick={() => selectAll()} disabled={!texture} title="Select the whole texture">
              Select all
            </Button>
            <Button
              variant="ghost"
              onClick={() => clearSelection()}
              disabled={!texture || !texture.selection}
              title="Clear the current selection"
            >
              Deselect
            </Button>
          </div>
          {renaming && texture && (
            <RenameRow
              initial={renameValue || (texture.name.startsWith('Untitled') ? '' : texture.name)}
              onCancel={() => setRenaming(false)}
              onCommit={(name) => {
                if (name.trim()) {
                  renameTexture(name);
                  setTextureList((prev) => [...prev]); // force re-render of pill list
                }
                setRenaming(false);
              }}
            />
          )}
        </div>

        {activeTool === 'shade' && (
          <div className="panel">
            <h4 className="panel-title">Shade</h4>
            <ShadePanel />
          </div>
        )}

        {activeTool === 'recolor' && (
          <div className="panel">
            <h4 className="panel-title">Recolor</h4>
            <RecolorPanel
              onApply={() => {
                if (!texture) return;
                const opts = useEditorUi.getState().recolor;
                const next = recolorPixels(texture.current, texture.width, texture.height, opts);
                const rect = { x: 0, y: 0, w: texture.width, h: texture.height };
                applyEdit(next, rect);
                // After applying, reset the recolor panel state to defaults
                useEditorUi.getState();
                useEditorUi.setState((s) => {
                  s.recolor = { hue: 0, saturation: 0, brightness: 0, contrast: 0, invert: false, grayscale: false };
                });
              }}
            />
          </div>
        )}

        {activeTool === 'stamp' && (
          <div className="panel">
            <h4 className="panel-title">Stamp</h4>
            <div className="stamp-upload-row">
              <p style={{ margin: 0, fontSize: 11 }}>Drop a PNG to stamp onto the canvas.</p>
              <button
                className="stamp-upload-btn"
                onClick={() => stampFileInputRef.current?.click()}
              >
                Choose PNG…
              </button>
              <input
                ref={stampFileInputRef}
                type="file"
                accept="image/png"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadStampFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        <div className="panel">
          <h4 className="panel-title">Animation</h4>
          <FramesPanel
            onExportGif={async () => {
              if (!texture?.animation) return;
              const outScale = Math.max(1, Math.round(window.devicePixelRatio));
              const gif = await encodeFramesToGif(
                texture.animation.frames.map((f) => ({
                  pixels: f.pixels,
                  width: texture.width,
                  height: texture.height,
                  tickDuration: f.tickDuration,
                })),
                { outScale, interpolate: texture.animation.interpolate },
              );
              await downloadBytes(gif, `${texture.name || 'texture'}.gif`, 'image/gif');
            }}
            onExportStrip={async () => {
              if (!texture?.animation) return;
              const png = await encodeFramesToStripPng(
                texture.animation.frames.map((f) => ({
                  pixels: f.pixels,
                  width: texture.width,
                  height: texture.height,
                  tickDuration: f.tickDuration,
                })),
              );
              await downloadBytes(png, `${texture.name || 'texture'}.png`, 'image/png');
            }}
          />
        </div>

        <div className="panel">
          <h4 className="panel-title">Clipboard</h4>
          <ClipboardList />
        </div>
      </aside>

      <div className="statusbar">
        <span>
          <span className={'status-dot ' + save.status} />
          {labelForSave(save.status)}
          {cursorPos ? ` · ${cursorPos.x}, ${cursorPos.y}` : ''}
        </span>
        <span>
          {texture ? texture.name : '—'} · project {shorten(projectId)}
        </span>
      </div>

      {resizeOpen && texture && (
        <ResizeDialog
          pixels={texture.current}
          width={texture.width}
          height={texture.height}
          onApply={(newPixels, newWidth, newHeight, _mode: RescaleMode) => {
            resizeTexture(newPixels, newWidth, newHeight);
            setResizeOpen(false);
          }}
          onClose={() => setResizeOpen(false)}
        />
      )}

      {sheetOpen && texture && (
        <SpriteSheetDialog
          projectId={projectId}
          activeTexture={{
            id: texture.id,
            name: texture.name,
            width: texture.width,
            height: texture.height,
            current: texture.current,
            animation: texture.animation,
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

function InfoItem({ name, desc }: { name: string; desc: string }): JSX.Element {
  return (
    <div className="info-item">
      <div className="info-item-name">{name}</div>
      <div className="info-item-desc">{desc}</div>
    </div>
  );
}

function RenameRow({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const [allPaths, setAllPaths] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void window.api.textures
      .readVanillaIndex()
      .then((idx) => {
        if (alive && idx) setAllPaths(idx.textures.map((t) => t.path));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const q = value.trim().toLowerCase();
  const matches = q
    ? allPaths.filter((p) => p.toLowerCase().includes(q)).slice(0, 12)
    : allPaths.slice(0, 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          className="color-input"
          style={{ background: 'var(--bg-1)', flex: 1, padding: '4px 6px', fontSize: 12 }}
          value={value}
          placeholder="Texture name (e.g. item/diamond_sword)"
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(value);
            if (e.key === 'Escape') onCancel();
          }}
        />
        <button
          onClick={() => onCommit(value)}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Save
        </button>
      </div>
      {matches.length > 0 && (
        <div className="rename-suggestions">
          {matches.map((s) => (
            <button
              key={s}
              className="rename-suggestion"
              onClick={() => {
                setValue(s);
                onCommit(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClipboardList(): JSX.Element {
  const slots = useClipboard((s) => s.slots);
  const activeIndex = useClipboard((s) => s.activeIndex);
  const setActive = useClipboard((s) => s.setActive);
  const removeAt = useClipboard((s) => s.removeAt);

  if (slots.length === 0) {
    return (
      <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: 0 }}>
        Empty. Copy a selection (Ctrl+C).
      </p>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
      {slots.map((s, i) => (
        <button
          key={i}
          className="texture-thumb"
          onClick={() => setActive(i)}
          onDoubleClick={() => removeAt(i)}
          title={`${s.width}×${s.height}`}
          style={i === activeIndex ? { outline: '2px solid var(--accent)' } : undefined}
        >
          <ClipThumb pixels={s.pixels} width={s.width} height={s.height} />
        </button>
      ))}
    </div>
  );
}

function ClipThumb({ pixels, width, height }: { pixels: Uint8ClampedArray; width: number; height: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const img = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(img, 0, 0);
  }, [pixels, width, height]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />;
}

/**
 * Tool icons — 16×16 vanilla Minecraft item/block PNGs from resourcepackcreator.com.
 * Each icon is bundled via Vite as a URL and rendered as an image with `image-rendering: pixelated`.
 */
import pencilIcon from '../assets/tools/pencil.png';
import eraserIcon from '../assets/tools/eraser.png';
import fillIcon from '../assets/tools/fill.png';
import eyedropperIcon from '../assets/tools/eyedropper.png';
import handIcon from '../assets/tools/hand.png';
import selectIcon from '../assets/tools/select.png';
import undoIcon from '../assets/tools/undo.png';
import gradientIcon from '../assets/tools/gradient.png';
import smushIcon from '../assets/tools/smush.png';
import shadeIcon from '../assets/tools/shade.png';
import stampIcon from '../assets/tools/stamp.png';
import recolorIcon from '../assets/tools/recolor.png';

const TOOL_ICON_URLS: Partial<Record<ToolId, string>> = {
  pencil: pencilIcon,
  eraser: eraserIcon,
  fill: fillIcon,
  eyedropper: eyedropperIcon,
  hand: handIcon,
  select: selectIcon,
  gradient: gradientIcon,
  smush: smushIcon,
  shade: shadeIcon,
  stamp: stampIcon,
  recolor: recolorIcon,
};

function ToolIcon({ id }: { id: ToolId }): JSX.Element {
  const src = TOOL_ICON_URLS[id];
  if (src) {
    return (
      <img
        src={src}
        width={18}
        height={18}
        alt=""
        draggable={false}
        style={{ imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' }}
      />
    );
  }
  // Inline pixel-art for tools without a bundled PNG
  if (id === 'shade' || id === 'stamp' || id === 'recolor' || id === 'gradient' || id === 'smush') {
    return <FallbackToolIcon id={id} />;
  }
  return <span aria-hidden />;
}

function FallbackToolIcon({ id }: { id: ToolId }): JSX.Element {
  if (id === 'gradient') {
    const rows = [
      'bbbbbbbbbbbbbbbb',
      'abbbbbbbbbbbbbbb',
      'aabbbbbbbbbbbbbb',
      'aaabbbbbbbbbbbbb',
      'aaaabbbbbbbbbbbb',
      'aaaaabbbbbbbbbbb',
      'aaaaaabbbbbbbbbb',
      'aaaaaaabbbbbbbbb',
      'aaaaaaaabbbbbbbb',
      'aaaaaaaaabbbbbbb',
      'aaaaaaaaaaabbbbb',
      'aaaaaaaaaaaabbbb',
      'aaaaaaaaaaaabbbb',
      'aaaaaaaaaaaaabbb',
      'aaaaaaaaaaaaaabb',
      'aaaaaaaaaaaaaaab',
    ];
    const palette: Record<string, string> = { '.': 'transparent', a: '#6cf0d6', b: '#e8e8e8' };
    return <PixelIcon rows={rows} palette={palette} />;
  }
  if (id === 'smush') {
    const rows = [
      '................',
      '......a.........',
      '.....aaa........',
      '....aabaa.......',
      '...aabbbaa......',
      '..aabbbbaa......',
      '..aabbbbaa......',
      '.aabbbbbbaa.....',
      '.aabbbbbbaa.....',
      '..aabbbbaa......',
      '..aabbbbaa......',
      '...aabbaa.......',
      '....aabaa.......',
      '.....aaa........',
      '......a.........',
      '................',
    ];
    const palette: Record<string, string> = { '.': 'transparent', a: '#6cf0d6', b: '#c9d1d9' };
    return <PixelIcon rows={rows} palette={palette} />;
  }
  if (id === 'shade') {
    const rows = [
      '................',
      '................',
      '....WWWWWW......',
      '....WSSSSW......',
      '....WSSSSW......',
      '....WSSSSW......',
      '....WSSSSW......',
      '.....WWWW.......',
      '......W.........',
      '......W.........',
      '......W.........',
      '......W.........',
      '................',
      '................',
      '................',
      '................',
    ];
    const palette: Record<string, string> = { '.': 'transparent', W: '#7d8590', S: '#c9d1d9' };
    return <PixelIcon rows={rows} palette={palette} />;
  }
  if (id === 'stamp') {
    const rows = [
      '................',
      '...WWWWWWWWW....',
      '..WSSSSSSSSSW...',
      '.WSSSSSSSSSSW...',
      'WWSSSSSSSSSSWW..',
      'WSSSWWWWWWSSSW..',
      'WSSWoooooWSSSW..',
      'WSSWoooooWSSSW..',
      'WSSWoooooWSSSW..',
      'WSSWoooooWSSSW..',
      'WSSWWWWWWWSSSW..',
      'WSSSSSSSSSSSSW..',
      'WWSSSSSSSSSSSW..',
      '.WWSSSSSSSSWW...',
      '..WWWWWWWWW.....',
      '................',
    ];
    const palette: Record<string, string> = {
      '.': 'transparent',
      W: '#3a2f1e',
      S: '#d8b079',
      o: '#a01818',
    };
    return <PixelIcon rows={rows} palette={palette} />;
  }
  // recolor
  const rows = [
    '................',
    '...RRRR.........',
    '..R....R........',
    '.R......R.......',
    '.R......R.......',
    '.R......R.......',
    '.R......R.......',
    '.R......R.......',
    '.R......R.......',
    '..R....R........',
    '...RRRR.RR......',
    '........R.R.....',
    '.........R.R....',
    '..........R.R...',
    '...........R....',
    '................',
  ];
  const palette: Record<string, string> = { '.': 'transparent', R: '#6cf0d6' };
  return <PixelIcon rows={rows} palette={palette} />;
}

const ACTION_GLYPHS: Record<string, { rows: string[]; palette: Record<string, string> }> = {
  'rotate-cw': {
    rows: [
      '................',
      '.....WWWWW......',
      '....W.....W.....',
      '....W...........',
      '....W...........',
      '....W...........',
      '....W......WWW..',
      '............W.W.',
      '............W.W.',
      '.............WW.',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
  'rotate-ccw': {
    rows: [
      '................',
      '.....WWWWW......',
      '....W.....W.....',
      '...........W....',
      '...........W....',
      '...........W....',
      '..WWW......W....',
      '..W.W...........',
      '..W.W...........',
      '..WW............',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
  'rotate-180': {
    rows: [
      '................',
      '.....WWWWW......',
      '....W.....W.....',
      '....W.....W.....',
      '....W.....W.....',
      '....W.....WWWWW.',
      '....W........W.W',
      '....W........W.W',
      '....W........WW.',
      '.....WWWWWWWWW...',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
  'flip-h': {
    rows: [
      '................',
      '................',
      '................',
      '.......W.W......',
      '.......W.W......',
      '.....WWWWWWW....',
      '.......W.W......',
      '.......W.W......',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
  'flip-v': {
    rows: [
      '................',
      '.......W........',
      '.......W........',
      '.......W........',
      '.....WWWWWWW....',
      '.......W........',
      '.......W........',
      '.......W........',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
  'reset-saved': {
    rows: [
      '................',
      '................',
      '................',
      '....WWWWW.......',
      '...W.....W......',
      '...W............',
      '...W....WWWW....',
      '...W....W...W...',
      '...W....W...W...',
      '....WWWWW.WW.....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: { '.': 'transparent', W: '#6cf0d6' },
  },
};

function MirrorIcon({ mode }: { mode: 'none' | 'horizontal' | 'vertical' | 'quad' }): JSX.Element {
  if (mode === 'horizontal') {
    const rows = [
      '................',
      '.....WW....WW....',
      '....W..W..W..W...',
      '....W..W..W..W...',
      '....W..W..W..W...',
      '.....WW....WW....',
      '......W....W.....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ];
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
        {rows.flatMap((row, y) =>
          row.split('').map((c, x) =>
            c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#6cf0d6" />,
          ),
        )}
      </svg>
    );
  }
  if (mode === 'vertical') {
    const rows = [
      '......WWWW......',
      '.....W....W.....',
      '.....W....W.....',
      '.....W....W.....',
      '.....W....W.....',
      '.....WWWW......',
      '................',
      '................',
      '................',
      '................',
      '......WWWW......',
      '.....W....W.....',
      '.....W....W.....',
      '.....W....W.....',
      '.....W....W.....',
      '.....WWWW......',
    ];
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
        {rows.flatMap((row, y) =>
          row.split('').map((c, x) =>
            c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#6cf0d6" />,
          ),
        )}
      </svg>
    );
  }
  if (mode === 'quad') {
    const rows = [
      '................',
      '....WWWWWWWW....',
      '....W......W....',
      '....W......W....',
      '....W......W....',
      '....W......W....',
      '....WWWWWWWW....',
      '................',
      '................',
      '....WWWWWWWW....',
      '....W......W....',
      '....W......W....',
      '....W......W....',
      '....W......W....',
      '....WWWWWWWW....',
      '................',
    ];
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
        {rows.flatMap((row, y) =>
          row.split('').map((c, x) =>
            c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#6cf0d6" />,
          ),
        )}
      </svg>
    );
  }
  // none
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
      <rect x="3" y="3" width="10" height="10" fill="none" stroke="#7d8590" strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  );
}

function ZoomOutIcon(): JSX.Element {
  // Pixel-art magnifying glass with a minus
  const rows = [
    '................',
    '................',
    '....WWWWWW......',
    '..WWSSSSSSWW....',
    '.WSSWWWWWWSSW...',
    '.WSWW....WWSW...',
    '.WSW.W..W.WSW...',
    '.WSW....W.WSW...',
    '.WSW..WW..WSW...',
    '.WSW....W.WSW...',
    '.WSWW....WWSW...',
    '.WSSWWWWWWSSW...',
    '..WWSSSSSSWW....',
    '....WWWWWW......',
    '......WW........',
    '.......WW.......',
  ];
  const palette: Record<string, string> = { '.': 'transparent', W: '#7d8590', S: '#c9d1d9' };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
      {rows.flatMap((row, y) =>
        row.split('').map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[c]} />,
        ),
      )}
    </svg>
  );
}

function FitIcon(): JSX.Element {
  // Pixel-art corner brackets (fit-to-screen)
  const rows = [
    'W...........W...',
    'WW.........WW...',
    'W.W.......W.W...',
    '...W.....W......',
    '....W...W.......',
    '.....W.W........',
    '......W.........',
    '...............W',
    '..............W.',
    '.............W..',
    '............W...',
    '...........W....',
    '...W......W.....',
    '..W.W....W.W....',
    '.W..WW..WW..W...',
    'W....WW....WW...',
  ];
  const palette: Record<string, string> = { '.': 'transparent', W: '#6cf0d6' };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ imageRendering: 'pixelated' }}>
      {rows.flatMap((row, y) =>
        row.split('').map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[c]} />,
        ),
      )}
    </svg>
  );
}

function UndoIcon(): JSX.Element {
  return (
    <img
      src={undoIcon}
      width={16}
      height={16}
      alt=""
      draggable={false}
      style={{ imageRendering: 'pixelated', display: 'block', pointerEvents: 'none', transform: 'scaleX(-1)' }}
    />
  );
}

function RedoIcon(): JSX.Element {
  return (
    <img
      src={undoIcon}
      width={16}
      height={16}
      alt=""
      draggable={false}
      style={{ imageRendering: 'pixelated', display: 'block', pointerEvents: 'none' }}
    />
  );
}

function labelForSave(status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'): string {
  switch (status) {
    case 'idle':
      return 'No changes';
    case 'dirty':
      return 'Unsaved';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Save failed';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function shorten(s: string): string {
  return s.length <= 10 ? s : s.slice(0, 4) + '…' + s.slice(-4);
}

function unionRect(
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x1 - x, h: y1 - y };
}

function makeDemoPixels(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = ((x >> 2) + (y >> 2)) & 1;
      const i = (y * size + x) * 4;
      pixels[i] = on ? 220 : 60;
      pixels[i + 1] = on ? 220 : 60;
      pixels[i + 2] = on ? 220 : 60;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}
