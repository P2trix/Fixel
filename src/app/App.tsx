import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { MouseEvent, KeyboardEvent as ReactKE } from "react";
import {
  Pencil, Eraser, Pipette, PaintBucket, Square, Minus,
  ZoomIn, ZoomOut, Trash2, Download, Undo2, Redo2, Grid,
  Eye, EyeOff, Plus, ChevronUp, ChevronDown,
  ArrowUpDown, Layers, Palette as PaletteIcon, X, ChevronDown as CaretDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PixelValue = number | null;
type PGrid = PixelValue[][];
type Tool = "pencil" | "eraser" | "fill" | "eyedropper" | "rect" | "line";
type PaletteEntry = { id: string; name: string; colors: string[] };
type Layer = { id: string; name: string; pixels: PGrid; visible: boolean };

// ── Constants ─────────────────────────────────────────────────────────────────

const W = 32, H = 32;
const PALETTE_SIZES = [4, 8, 16, 24, 32] as const;

const TOOLS: { id: Tool; Icon: React.ComponentType<{ size?: number }>; label: string; key: string }[] = [
  { id: "pencil",     Icon: Pencil,      label: "Pencil",    key: "B" },
  { id: "eraser",     Icon: Eraser,      label: "Eraser",    key: "E" },
  { id: "fill",       Icon: PaintBucket, label: "Fill",      key: "G" },
  { id: "eyedropper", Icon: Pipette,     label: "Eyedrop",   key: "I" },
  { id: "rect",       Icon: Square,      label: "Rect",      key: "R" },
  { id: "line",       Icon: Minus,       label: "Line",      key: "L" },
];

const DEFAULT_PALETTES: PaletteEntry[] = [
  { id: "gameboy", name: "Game Boy", colors: ["#0f380f","#306230","#8bac0f","#9bbc0f"] },
  { id: "nes8", name: "NES 8", colors: ["#000000","#fcfcfc","#f8f800","#f83800","#0058f8","#3cbcfc","#00e800","#a800a8"] },
  {
    id: "pico8", name: "Pico-8",
    colors: ["#000000","#1d2b53","#7e2553","#008751","#ab5236","#5f574f","#c2c3c7","#fff1e8","#ff004d","#ffa300","#ffec27","#00e436","#29adff","#83769c","#ff77a8","#ffccaa"],
  },
  {
    id: "lospec24", name: "Lospec 24",
    colors: ["#1a1c2c","#5d275d","#b13e53","#ef7d57","#ffcd75","#a7f070","#38b764","#257179","#29366f","#3b5dc9","#41a6f6","#73eff7","#f4f4f4","#94b0c2","#566c86","#333c57","#ff0044","#ff8800","#ffff00","#00ff66","#00ccff","#6633ff","#cc0099","#884400"],
  },
  {
    id: "classic32", name: "Classic 32",
    colors: ["#000000","#1a1a2e","#16213e","#0f3460","#533483","#e94560","#c72c41","#7a0000","#ff6b35","#f7b731","#fed330","#a8ff3e","#20bf6b","#00ff88","#2bcbba","#0fb9b1","#45aaf2","#2d98da","#3867d6","#4b7bec","#8854d0","#a55eea","#ff3d6b","#ff00aa","#ffffff","#c8c8e8","#888888","#444444","#8b4513","#d2691e","#c8a96b","#222222"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function uid() { return Math.random().toString(36).slice(2, 10); }

function hslToHex(h: number, s: number, l: number): string {
  const sl = s/100, ll = l/100, a = sl * Math.min(ll, 1-ll);
  const f = (n: number) => { const k=(n+h/30)%12, c=ll-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,"0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateColors(size: number): string[] {
  return Array.from({length:size},(_,i)=>hslToHex(Math.round((i/size)*360),60,i%2===0?35:55));
}

function emptyGrid(): PGrid { return Array.from({length:H},()=>Array(W).fill(null)); }
function createLayer(name: string): Layer { return {id:uid(),name,pixels:emptyGrid(),visible:true}; }

function floodFill(grid: PGrid, x: number, y: number, val: PixelValue): PGrid {
  const t=grid[y][x]; if(t===val) return grid;
  const n=grid.map(r=>[...r]); const s:[number,number][]=[[x,y]];
  while(s.length){const[cx,cy]=s.pop()!;if(cx<0||cx>=W||cy<0||cy>=H||n[cy][cx]!==t)continue;n[cy][cx]=val;s.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);}
  return n;
}

function plotLine(grid: PGrid, x0: number, y0: number, x1: number, y1: number, val: PixelValue): PGrid {
  const n=grid.map(r=>[...r]),dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;
  let err=dx-dy,cx=x0,cy=y0;
  for(;;){if(cx>=0&&cx<W&&cy>=0&&cy<H)n[cy][cx]=val;if(cx===x1&&cy===y1)break;const e2=2*err;if(e2>-dy){err-=dy;cx+=sx;}if(e2<dx){err+=dx;cy+=sy;}}
  return n;
}

function plotRect(grid: PGrid, x0: number, y0: number, x1: number, y1: number, val: PixelValue): PGrid {
  const n=grid.map(r=>[...r]),[mnX,mxX]=[Math.min(x0,x1),Math.max(x0,x1)],[mnY,mxY]=[Math.min(y0,y1),Math.max(y0,y1)];
  for(let x=mnX;x<=mxX;x++){if(mnY>=0&&mnY<H)n[mnY][x]=val;if(mxY>=0&&mxY<H)n[mxY][x]=val;}
  for(let y=mnY;y<=mxY;y++){if(mnX>=0&&mnX<W)n[y][mnX]=val;if(mxX>=0&&mxX<W)n[y][mxX]=val;}
  return n;
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      {children}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [history, setHistory]     = useState<Layer[][]>(() => [[createLayer("Layer 1")]]);
  const [histIdx, setHistIdx]     = useState(0);
  const [activeLayerIdx, setActiveLayerIdx] = useState(0);
  const [live, setLive]           = useState<PGrid | null>(null);
  const [isErasing, setIsErasing] = useState(false);

  const [palettes, setPalettes]     = useState<PaletteEntry[]>(DEFAULT_PALETTES);
  const [activePalId, setActivePalId] = useState("pico8");
  const [primaryIdx, setPrimaryIdx] = useState(0);

  const [tool, setTool]       = useState<Tool>("pencil");
  const [zoom, setZoom]       = useState(14);
  const [showGrid, setShowGrid] = useState(true);
  const [drawing, setDrawing]   = useState(false);
  const [startPx, setStartPx]   = useState<[number,number]|null>(null);
  const [hoverPx, setHoverPx]   = useState<[number,number]|null>(null);

  const [sidebarTab, setSidebarTab]   = useState<"colors"|"layers">("colors");
  const [newPalForm, setNewPalForm]   = useState<{name:string;size:number}|null>(null);
  const [editLayerName, setEditLayerName] = useState<{idx:number;value:string}|null>(null);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const histIdxRef = useRef(0);
  const histLenRef = useRef(1);
  useEffect(() => { histIdxRef.current = histIdx; histLenRef.current = history.length; });

  // Derived
  const layers       = history[histIdx];
  const safeLayerIdx = clamp(activeLayerIdx, 0, layers.length - 1);
  const activeLayer  = layers[safeLayerIdx];
  const activePal    = palettes.find(p => p.id === activePalId) ?? palettes[0];
  const safePrimary  = clamp(primaryIdx, 0, activePal.colors.length - 1);
  const primaryColor = activePal.colors[safePrimary];

  const usedIndices = useMemo(() => {
    const s = new Set<number>();
    for (const l of layers) for (const row of l.pixels) for (const v of row) if (v!==null) s.add(v);
    return s;
  }, [layers]);

  // History
  const pushLayers = (nl: Layer[]) => {
    const h = [...history.slice(0, histIdx + 1), nl].slice(-80);
    setHistory(h); setHistIdx(h.length - 1); setLive(null);
  };

  const commitPixels = (newPix: PGrid) => {
    const idx = safeLayerIdx;
    setHistory(prev => {
      const base = prev[histIdxRef.current];
      const nl = base.map((l,i) => i===clamp(idx,0,base.length-1) ? {...l,pixels:newPix} : l);
      const h = [...prev.slice(0, histIdxRef.current+1), nl].slice(-80);
      setHistIdx(h.length - 1); return h;
    });
    setLive(null);
  };

  const undo = useCallback(()=>{setHistIdx(i=>Math.max(0,i-1));setLive(null);},[]);
  const redo = useCallback(()=>{setHistIdx(i=>Math.min(histLenRef.current-1,i+1));setLive(null);},[]);

  // Layers
  const addLayer     = () => { const nl=createLayer(`Layer ${layers.length+1}`); pushLayers([...layers,nl]); setActiveLayerIdx(layers.length); };
  const deleteLayer  = (i:number) => { if(layers.length===1)return; const nl=layers.filter((_,j)=>j!==i); pushLayers(nl); setActiveLayerIdx(x=>clamp(x>=i?x-1:x,0,nl.length-1)); };
  const toggleVis    = (i:number) => pushLayers(layers.map((l,j)=>j===i?{...l,visible:!l.visible}:l));
  const moveLayerUp  = (i:number) => { if(i>=layers.length-1)return; const nl=[...layers];[nl[i],nl[i+1]]=[nl[i+1],nl[i]];pushLayers(nl);if(activeLayerIdx===i)setActiveLayerIdx(i+1);else if(activeLayerIdx===i+1)setActiveLayerIdx(i); };
  const moveLayerDown= (i:number) => { if(i<=0)return; const nl=[...layers];[nl[i],nl[i-1]]=[nl[i-1],nl[i]];pushLayers(nl);if(activeLayerIdx===i)setActiveLayerIdx(i-1);else if(activeLayerIdx===i-1)setActiveLayerIdx(i); };
  const commitLayerName = (i:number,name:string) => { pushLayers(layers.map((l,j)=>j===i?{...l,name:name.trim()||l.name}:l)); setEditLayerName(null); };

  // Palette
  const reversePalette = (id:string) => setPalettes(p=>p.map(e=>e.id===id?{...e,colors:[...e.colors].reverse()}:e));
  const updatePaletteColor = (id:string,ci:number,hex:string) => setPalettes(p=>p.map(e=>{if(e.id!==id)return e;const c=[...e.colors];c[ci]=hex;return{...e,colors:c};}));
  const switchPalette  = (id:string) => { setActivePalId(id); const p=palettes.find(x=>x.id===id); if(p) setPrimaryIdx(i=>clamp(i,0,p.colors.length-1)); };
  const deletePalette  = (id:string) => { if(palettes.length===1)return; const nl=palettes.filter(p=>p.id!==id); setPalettes(nl); if(activePalId===id){setActivePalId(nl[0].id);setPrimaryIdx(0);} };
  const addNewPalette  = () => { if(!newPalForm)return; const pal:PaletteEntry={id:uid(),name:newPalForm.name.trim()||`Palette ${palettes.length+1}`,colors:generateColors(newPalForm.size)}; setPalettes(p=>[...p,pal]); setActivePalId(pal.id); setPrimaryIdx(0); setNewPalForm(null); };

  // Canvas
  useEffect(() => {
    const c = canvasRef.current; if(!c) return;
    const ctx = c.getContext("2d")!;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      ctx.fillStyle = (x+y)%2===0?"#1e1e1e":"#181818";
      ctx.fillRect(x*zoom,y*zoom,zoom,zoom);
    }
    for (let li=0;li<layers.length;li++) {
      if (!layers[li].visible) continue;
      const pix = (li===safeLayerIdx&&live)?live:layers[li].pixels;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        const v=pix[y][x];
        if (v!==null&&v<activePal.colors.length) { ctx.fillStyle=activePal.colors[v]; ctx.fillRect(x*zoom,y*zoom,zoom,zoom); }
      }
    }
    if (showGrid && zoom >= 4) {
      ctx.strokeStyle="rgba(255,255,255,0.06)"; ctx.lineWidth=1;
      for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*zoom,0);ctx.lineTo(x*zoom,H*zoom);ctx.stroke();}
      for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*zoom);ctx.lineTo(W*zoom,y*zoom);ctx.stroke();}
    }
    if (hoverPx && !drawing) {
      const [hx,hy]=hoverPx;
      ctx.globalAlpha=0.3; ctx.fillStyle=primaryColor; ctx.fillRect(hx*zoom,hy*zoom,zoom,zoom); ctx.globalAlpha=1;
      ctx.strokeStyle="rgba(255,255,255,0.6)"; ctx.lineWidth=1; ctx.strokeRect(hx*zoom+0.5,hy*zoom+0.5,zoom-1,zoom-1);
    }
  }, [layers,safeLayerIdx,live,activePal,primaryColor,zoom,showGrid,hoverPx,drawing]);

  // Mouse
  const getPx = (e: MouseEvent<HTMLCanvasElement>): [number,number] => {
    const r=canvasRef.current!.getBoundingClientRect();
    return [clamp(Math.floor((e.clientX-r.left)/zoom),0,W-1),clamp(Math.floor((e.clientY-r.top)/zoom),0,H-1)];
  };

  const onDown = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault(); const [x,y]=getPx(e);
    const erase = e.button===2||tool==="eraser";
    setIsErasing(erase); setDrawing(true); setStartPx([x,y]);
    const base=activeLayer.pixels;
    if (erase){const n=base.map(r=>[...r]);n[y][x]=null;setLive(n);}
    else if(tool==="pencil"){const n=base.map(r=>[...r]);n[y][x]=safePrimary;setLive(n);}
    else if(tool==="fill"){commitPixels(floodFill(base,x,y,safePrimary));}
    else if(tool==="eyedropper"){for(let li=layers.length-1;li>=0;li--){if(!layers[li].visible)continue;const v=layers[li].pixels[y][x];if(v!==null){setPrimaryIdx(v);break;}}}
  };

  const onMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const [x,y]=getPx(e); setHoverPx([x,y]);
    if(!drawing||!startPx) return;
    const base=activeLayer.pixels;
    if(isErasing){setLive(p=>{const n=(p??base).map(r=>[...r]);n[y][x]=null;return n;});}
    else if(tool==="pencil"){setLive(p=>{const n=(p??base).map(r=>[...r]);n[y][x]=safePrimary;return n;});}
    else if(tool==="line"){setLive(plotLine(base,startPx[0],startPx[1],x,y,safePrimary));}
    else if(tool==="rect"){setLive(plotRect(base,startPx[0],startPx[1],x,y,safePrimary));}
  };

  const onUp = () => { if(live)commitPixels(live); setDrawing(false); setStartPx(null); setIsErasing(false); };

  // Export
  const exportPNG = () => {
    const ec=document.createElement("canvas");ec.width=W;ec.height=H;
    const ctx=ec.getContext("2d")!;
    for(let li=0;li<layers.length;li++){if(!layers[li].visible)continue;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=layers[li].pixels[y][x];if(v!==null&&v<activePal.colors.length){ctx.fillStyle=activePal.colors[v];ctx.fillRect(x,y,1,1);}}}
    const a=document.createElement("a");a.download="pixel-art.png";a.href=ec.toDataURL();a.click();
  };

  // Keyboard
  useEffect(() => {
    const MAP:Record<string,Tool>={b:"pencil",e:"eraser",g:"fill",i:"eyedropper",r:"rect",l:"line"};
    const h=(ev:KeyboardEvent)=>{
      if(ev.target instanceof HTMLInputElement)return;
      const k=ev.key.toLowerCase();
      if(MAP[k]){setTool(MAP[k]);return;}
      if(k==="\\")setShowGrid(g=>!g);
      if(k==="+"||k==="=")setZoom(z=>clamp(z+2,2,40));
      if(k==="-")setZoom(z=>clamp(z-2,2,40));
      if((ev.ctrlKey||ev.metaKey)&&k==="z"){ev.preventDefault();undo();}
      if((ev.ctrlKey||ev.metaKey)&&k==="y"){ev.preventDefault();redo();}
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[undo,redo]);

  const cursor={pencil:"crosshair",eraser:"cell",fill:"crosshair",eyedropper:"crosshair",rect:"crosshair",line:"crosshair"}[tool];
  const totalPx = layers.reduce((s,l)=>s+l.pixels.flat().filter(v=>v!==null).length,0);
  const layersUI = [...layers].reverse();
  const palCols  = activePal.colors.length<=4?4:8;

  return (
    <div className="h-screen bg-[#1e1e1e] text-[#cccccc] flex flex-col overflow-hidden select-none text-[11px]"
      style={{fontFamily:"Inter, system-ui, sans-serif"}}>

      {/* ── MENU BAR ────────────────────────────────────────────────────── */}
      <header className="h-9 bg-[#2c2c2c] border-b border-[rgba(255,255,255,0.08)] flex items-center px-3 gap-1 shrink-0">
        {/* App name */}
        <span className="text-[12px] font-medium text-[#cccccc] mr-3 shrink-0">Pixel Forge</span>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)] mx-1"/>

        {/* Undo / Redo */}
        <button onClick={undo} disabled={histIdx===0} title="Undo (Ctrl+Z)"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] disabled:opacity-30 transition-colors text-[#999]">
          <Undo2 size={13}/>
        </button>
        <button onClick={redo} disabled={histIdx===history.length-1} title="Redo (Ctrl+Y)"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] disabled:opacity-30 transition-colors text-[#999]">
          <Redo2 size={13}/>
        </button>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)] mx-1"/>

        {/* Zoom */}
        <div className="flex items-center gap-px bg-[rgba(0,0,0,0.2)] rounded px-1 h-6">
          <button onClick={()=>setZoom(z=>clamp(z-2,2,40))} className="h-5 w-5 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] text-[#999] transition-colors">
            <ZoomOut size={11}/>
          </button>
          <span className="text-[10px] text-[#999] w-10 text-center tabular-nums select-none">{zoom*100/14|0}%</span>
          <button onClick={()=>setZoom(z=>clamp(z+2,2,40))} className="h-5 w-5 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] text-[#999] transition-colors">
            <ZoomIn size={11}/>
          </button>
        </div>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)] mx-1"/>

        {/* Grid toggle */}
        <button onClick={()=>setShowGrid(g=>!g)} title="Toggle grid (\\)"
          className={`h-6 px-2 flex items-center gap-1.5 rounded text-[10px] transition-colors ${showGrid?"bg-[#0d99ff]/15 text-[#0d99ff]":"text-[#999] hover:bg-[rgba(255,255,255,0.08)]"}`}>
          <Grid size={11}/> Grid
        </button>

        <div className="flex-1"/>

        {/* Canvas info */}
        <span className="text-[10px] text-[#555] mr-2">32 × 32 px</span>

        {/* Clear */}
        <button onClick={()=>commitPixels(emptyGrid())} title="Clear active layer"
          className="h-6 px-2 flex items-center gap-1.5 text-[10px] rounded text-[#999] hover:bg-[rgba(255,255,255,0.08)] hover:text-[#e05555] transition-colors">
          <Trash2 size={11}/> Clear
        </button>

        <div className="w-px h-4 bg-[rgba(255,255,255,0.1)] mx-1"/>

        {/* Export */}
        <button onClick={exportPNG}
          className="h-6 px-3 bg-[#0d99ff] text-white text-[10px] font-medium rounded hover:bg-[#2da8ff] active:bg-[#0080d4] transition-colors flex items-center gap-1.5">
          <Download size={11}/> Export PNG
        </button>
      </header>

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT TOOLBAR ─────────────────────────────────────────────── */}
        <aside className="w-12 bg-[#2c2c2c] border-r border-[rgba(255,255,255,0.08)] flex flex-col items-center pt-2 pb-2 gap-0.5 shrink-0">
          {TOOLS.map(({id,Icon,label,key})=>(
            <button key={id} onClick={()=>setTool(id)} title={`${label}  ${key}`}
              className={`w-10 h-9 flex flex-col items-center justify-center gap-0.5 rounded transition-colors ${
                tool===id
                  ?"bg-[#0d99ff]/15 text-[#0d99ff]"
                  :"text-[#757575] hover:text-[#cccccc] hover:bg-[rgba(255,255,255,0.06)]"
              }`}>
              <Icon size={15}/>
              <span className="text-[7px] leading-none opacity-60">{key}</span>
            </button>
          ))}

          <div className="flex-1"/>

          {/* Color swatch */}
          <div className="flex flex-col items-center gap-1 pb-1">
            <div className="w-px h-3 bg-[rgba(255,255,255,0.1)]"/>
            <div className="relative w-8 h-8">
              {/* Secondary (background) */}
              <div className="absolute bottom-0 right-0 w-5 h-5 border border-[rgba(255,255,255,0.2)] bg-black"/>
              {/* Primary (foreground) */}
              <div className="absolute top-0 left-0 w-5 h-5 border border-[rgba(255,255,255,0.25)]"
                style={{backgroundColor:primaryColor}}/>
            </div>
          </div>
        </aside>

        {/* ── CANVAS ───────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto flex items-center justify-center bg-[#141414]">
          <canvas ref={canvasRef} width={W*zoom} height={H*zoom}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onMouseLeave={()=>{setHoverPx(null);if(drawing)onUp();}}
            onContextMenu={e=>e.preventDefault()}
            style={{cursor:(drawing&&isErasing)?"cell":cursor,imageRendering:"pixelated"}}
            className="shadow-[0_2px_16px_rgba(0,0,0,0.6)]"
          />
        </main>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────── */}
        <aside className="w-56 bg-[#252526] border-l border-[rgba(255,255,255,0.08)] flex flex-col shrink-0 overflow-hidden">

          {/* Panel tabs — like Figma */}
          <div className="flex border-b border-[rgba(255,255,255,0.08)] shrink-0">
            {(["colors","layers"] as const).map(tab=>(
              <button key={tab} onClick={()=>setSidebarTab(tab)}
                className={`flex-1 h-8 flex items-center justify-center gap-1.5 text-[10px] font-medium transition-colors ${
                  sidebarTab===tab
                    ?"text-[#cccccc] border-b-2 border-[#0d99ff]"
                    :"text-[#757575] hover:text-[#aaa]"
                }`}>
                {tab==="colors"?<PaletteIcon size={10}/>:<Layers size={10}/>}
                <span className="capitalize">{tab}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:"thin",scrollbarColor:"#3a3a3a transparent"}}>

            {/* ── COLORS TAB ───────────────────────────────────────────── */}
            {sidebarTab==="colors"&&(
              <div className="flex flex-col">

                {/* Primary color */}
                <div className="border-b border-[rgba(255,255,255,0.06)]">
                  <SectionHeader title="Color"/>
                  <div className="px-3 pb-3 flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded border border-[rgba(255,255,255,0.15)] shrink-0 cursor-pointer relative">
                      <div className="absolute inset-0 rounded" style={{backgroundColor:primaryColor}}/>
                      <input type="color" value={primaryColor}
                        onChange={e=>{
                          // Update the color in the palette at safePrimary
                          updatePaletteColor(activePal.id,safePrimary,e.target.value);
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded"/>
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="text-[11px] text-[#cccccc] tabular-nums">{primaryColor.toUpperCase()}</div>
                      <div className="text-[10px] text-[#555]">Index {safePrimary}</div>
                    </div>
                  </div>
                </div>

                {/* Active palette */}
                <div className="border-b border-[rgba(255,255,255,0.06)]">
                  <SectionHeader title={activePal.name}>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555] px-1 py-0.5 bg-[rgba(255,255,255,0.06)] rounded">{activePal.colors.length}</span>
                      <button onClick={()=>reversePalette(activePal.id)} title="Reverse palette (gradient map flip)"
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] text-[#555] hover:text-[#aaa] transition-colors">
                        <ArrowUpDown size={10}/>
                      </button>
                    </div>
                  </SectionHeader>

                  <div className="px-3 pb-3">
                    <div className="grid gap-px rounded overflow-hidden" style={{gridTemplateColumns:`repeat(${palCols},1fr)`}}>
                      {activePal.colors.map((col,idx)=>(
                        <div key={idx} className="relative group aspect-square">
                          <button
                            className={`absolute inset-0 w-full h-full transition-all duration-75 ${
                              idx===safePrimary?"ring-2 ring-white ring-inset":"hover:brightness-110"
                            }`}
                            style={{backgroundColor:col}}
                            onClick={()=>setPrimaryIdx(idx)}
                            title={`[${idx}] ${col}`}
                          />
                          {/* Used on canvas indicator */}
                          {usedIndices.has(idx)&&(
                            <div className="absolute top-0.5 left-0.5 w-1 h-1 rounded-full bg-white/70 pointer-events-none z-10"/>
                          )}
                          {/* Edit overlay */}
                          <label className="absolute bottom-0 right-0 w-4 h-4 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20"
                            onClick={e=>e.stopPropagation()}>
                            <input type="color" value={col} onChange={e=>updatePaletteColor(activePal.id,idx,e.target.value)} className="sr-only"/>
                            <span className="text-white/80 text-[8px]">✎</span>
                          </label>
                        </div>
                      ))}
                    </div>
                    <div className="text-[9px] text-[#555] mt-1.5">Click to select · hover ✎ to edit</div>
                  </div>
                </div>

                {/* Palette library */}
                <div>
                  <SectionHeader title="Palettes">
                    <button onClick={()=>setNewPalForm({name:"",size:16})}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] text-[#555] hover:text-[#0d99ff] transition-colors">
                      <Plus size={11}/>
                    </button>
                  </SectionHeader>

                  <div className="px-2 pb-3 flex flex-col gap-0.5">
                    {palettes.map(pal=>(
                      <div key={pal.id} onClick={()=>switchPalette(pal.id)}
                        className={`group px-2 py-1.5 rounded cursor-pointer transition-colors ${
                          pal.id===activePalId?"bg-[#0d99ff]/10 border border-[#0d99ff]/20":"hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
                        }`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-[10px] truncate ${pal.id===activePalId?"text-[#cccccc]":"text-[#888]"}`}>{pal.name}</span>
                            <span className="text-[9px] text-[#555] shrink-0">{pal.colors.length}</span>
                          </div>
                          <button onClick={e=>{e.stopPropagation();deletePalette(pal.id);}} disabled={palettes.length===1}
                            className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded text-[#555] hover:text-[#e05555] disabled:opacity-10 transition-all">
                            <Trash2 size={9}/>
                          </button>
                        </div>
                        {/* Color strip */}
                        <div className="flex h-2 rounded-sm overflow-hidden">
                          {pal.colors.map((c,i)=><div key={i} style={{backgroundColor:c,flex:1}}/>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── LAYERS TAB ───────────────────────────────────────────── */}
            {sidebarTab==="layers"&&(
              <div>
                <SectionHeader title="Layers">
                  <button onClick={addLayer} title="New layer"
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.08)] text-[#555] hover:text-[#0d99ff] transition-colors">
                    <Plus size={11}/>
                  </button>
                </SectionHeader>

                <div className="px-2 flex flex-col gap-px">
                  {layersUI.map(layer=>{
                    const ai=layers.indexOf(layer), isActive=ai===safeLayerIdx;
                    return (
                      <div key={layer.id}
                        onClick={()=>{setActiveLayerIdx(ai);setEditLayerName(null);}}
                        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                          isActive?"bg-[#0d99ff]/10 border border-[#0d99ff]/20":"hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
                        }`}>

                        <button onClick={e=>{e.stopPropagation();toggleVis(ai);}}
                          className={`shrink-0 transition-colors ${layer.visible?"text-[#757575] hover:text-[#aaa]":"text-[#444]"}`}>
                          {layer.visible?<Eye size={11}/>:<EyeOff size={11}/>}
                        </button>

                        {editLayerName?.idx===ai?(
                          <input autoFocus value={editLayerName.value}
                            onChange={e=>setEditLayerName({idx:ai,value:e.target.value})}
                            onBlur={()=>commitLayerName(ai,editLayerName.value)}
                            onKeyDown={(e:ReactKE<HTMLInputElement>)=>{if(e.key==="Enter")commitLayerName(ai,editLayerName.value);if(e.key==="Escape")setEditLayerName(null);e.stopPropagation();}}
                            onClick={e=>e.stopPropagation()}
                            className="flex-1 min-w-0 bg-[#333] border border-[#0d99ff]/50 rounded px-1 py-0.5 text-[10px] outline-none"/>
                        ):(
                          <span onDoubleClick={e=>{e.stopPropagation();setEditLayerName({idx:ai,value:layer.name});}}
                            className={`flex-1 min-w-0 text-[10px] truncate ${isActive?"text-[#cccccc]":"text-[#888]"}`}
                            title="Double-click to rename">
                            {layer.name}
                          </span>
                        )}

                        <div className="flex flex-col gap-px opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button onClick={e=>{e.stopPropagation();moveLayerUp(ai);}} disabled={ai===layers.length-1}
                            className="text-[#555] hover:text-[#aaa] disabled:opacity-20"><ChevronUp size={9}/></button>
                          <button onClick={e=>{e.stopPropagation();moveLayerDown(ai);}} disabled={ai===0}
                            className="text-[#555] hover:text-[#aaa] disabled:opacity-20"><ChevronDown size={9}/></button>
                        </div>

                        <button onClick={e=>{e.stopPropagation();deleteLayer(ai);}} disabled={layers.length===1}
                          className="opacity-0 group-hover:opacity-100 shrink-0 text-[#555] hover:text-[#e05555] disabled:opacity-10 transition-all">
                          <Trash2 size={9}/>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mx-3 mt-3 pt-2 border-t border-[rgba(255,255,255,0.06)] text-[9px] text-[#555] space-y-1">
                  <div className="flex justify-between"><span>Active layer</span><span className="text-[#888]">{activeLayer.name}</span></div>
                  <div className="flex justify-between"><span>Pixels</span><span className="text-[#888]">{totalPx}</span></div>
                  <div className="flex justify-between"><span>History</span><span className="text-[#888]">{histIdx+1} / {history.length}</span></div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      <footer className="h-5 bg-[#2c2c2c] border-t border-[rgba(255,255,255,0.08)] flex items-center px-3 gap-4 text-[9px] text-[#555] shrink-0">
        <span className="text-[#888]">{TOOLS.find(t=>t.id===tool)?.label}</span>
        {drawing&&isErasing&&<span className="text-[#e05555]">Erase</span>}
        <span>32 × 32</span>
        {hoverPx&&<span className="tabular-nums text-[#777]">{hoverPx[0]}, {hoverPx[1]}</span>}
        <span>{showGrid?"Grid on":"Grid off"}</span>
        <span className="text-[#555] ml-auto">{safeLayerIdx+1} / {layers.length} layers · {histIdx+1} / {history.length} states</span>
      </footer>

      {/* ── NEW PALETTE MODAL ────────────────────────────────────────────── */}
      {newPalForm&&(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={()=>setNewPalForm(null)}>
          <div className="bg-[#2c2c2c] border border-[rgba(255,255,255,0.12)] rounded-md shadow-2xl p-5 w-72 flex flex-col gap-4"
            style={{fontFamily:"Inter,system-ui,sans-serif"}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#cccccc]">New Palette</span>
              <button onClick={()=>setNewPalForm(null)} className="text-[#555] hover:text-[#999] transition-colors"><X size={13}/></button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#757575]">Name</label>
              <input autoFocus value={newPalForm.name}
                onChange={e=>setNewPalForm(p=>p?{...p,name:e.target.value}:p)}
                onKeyDown={e=>{if(e.key==="Enter")addNewPalette();if(e.key==="Escape")setNewPalForm(null);}}
                placeholder={`Palette ${palettes.length+1}`}
                className="bg-[#333] border border-[rgba(255,255,255,0.1)] rounded px-2.5 py-1.5 text-[11px] text-[#ccc] outline-none focus:border-[#0d99ff]/60"/>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#757575]">Number of colors</label>
              <div className="flex gap-1.5">
                {PALETTE_SIZES.map(sz=>(
                  <button key={sz} onClick={()=>setNewPalForm(p=>p?{...p,size:sz}:p)}
                    className={`flex-1 h-7 text-[10px] rounded transition-colors ${
                      newPalForm.size===sz
                        ?"bg-[#0d99ff] text-white"
                        :"bg-[rgba(255,255,255,0.06)] text-[#888] hover:text-[#ccc] hover:bg-[rgba(255,255,255,0.1)]"
                    }`}>
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-[#757575] mb-1">Preview</div>
              <div className="flex h-5 rounded overflow-hidden border border-[rgba(255,255,255,0.08)]">
                {generateColors(newPalForm.size).map((c,i)=><div key={i} style={{backgroundColor:c,flex:1}}/>)}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={()=>setNewPalForm(null)}
                className="flex-1 h-7 text-[10px] text-[#888] bg-[rgba(255,255,255,0.06)] rounded hover:text-[#ccc] hover:bg-[rgba(255,255,255,0.1)] transition-colors">
                Cancel
              </button>
              <button onClick={addNewPalette}
                className="flex-1 h-7 text-[10px] font-medium bg-[#0d99ff] text-white rounded hover:bg-[#2da8ff] transition-colors">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
