import React, { useState, useMemo, useRef, useEffect } from "react";
import { ImportVessel } from "../../import-contract";
import { project, generateLandPath } from "./map-utils";
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from "../../../../components/ui/primitives";
import { 
  Anchor, Navigation, AlertCircle, HelpCircle,
  Play, Pause, ZoomIn, ZoomOut, MapPin, ChevronLeft
} from "lucide-react";

const KNOWN_PORTS = [
  { id: "port-rotterdam", name: "Rotterdam", pos: [4.4082, 51.9022] as [number, number], desc: "Major European logistics hub." },
  { id: "port-yantian", name: "Yantian", pos: [114.274, 22.575] as [number, number], desc: "Deep-water port in Shenzhen, China." },
  { id: "port-mumbai", name: "Mumbai", pos: [72.8464, 18.9388] as [number, number], desc: "Primary port of India." },
  { id: "port-singapore", name: "Singapore", pos: [103.8198, 1.2902] as [number, number], desc: "Global maritime crossroad." }
];

interface ImportVesselMapProps {
  vessels?: ImportVessel[];
  onShipmentSelect?: (id: string) => void;
}

type EntitySelection = { type: 'vessel', id: string } | { type: 'port', id: string } | null;

export function ImportVesselMap({ vessels = [], onShipmentSelect }: ImportVesselMapProps) {
  const svgWidth = 1000;
  const svgHeight = 500;
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const mapRef = useRef<HTMLDivElement | null>(null);

  const [filter, setFilter] = useState<string>("ALL");
  const [selectedEntity, setSelectedEntity] = useState<EntitySelection>(null);

  const [progress, setProgress] = useState(0); // 0 = actual latest observation
  const [isPlaying, setIsPlaying] = useState(false);
  const reqRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPlaying) {
      let lastTime = performance.now();
      const tick = (time: number) => {
        const delta = time - lastTime;
        lastTime = time;
        setProgress((p) => {
          let next = p + delta * 0.005; 
          if (next > 100) next = 0;
          return next;
        });
        reqRef.current = requestAnimationFrame(tick);
      };
      reqRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [isPlaying]);

  const handleZoom = (factor: number) => {
    setTransform(t => {
      const cx = svgWidth / 2;
      const cy = svgHeight / 2;
      const newScale = Math.max(0.5, Math.min(t.scale * factor, 10));
      const newX = cx - ((cx - t.x) / t.scale) * newScale;
      const newY = cy - ((cy - t.y) / t.scale) * newScale;
      return { x: newX, y: newY, scale: newScale };
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const getRemainingRoute = (current: [number, number], route: [number, number][]) => {
    if (!route || route.length === 0) return [current];
    let bestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = Math.sqrt(Math.pow(route[i][0] - current[0], 2) + Math.pow(route[i][1] - current[1], 2));
      if (d < minDist) { minDist = d; bestIdx = i; }
    }
    return [current, ...route.slice(bestIdx)];
  };

  const interpolateRoute = (route: [number, number][], pct: number) => {
    if (!route || route.length === 0) return null;
    if (route.length === 1) return route[0];
    const p = Math.max(0, Math.min(pct / 100, 1));
    if (p <= 0) return route[0];
    if (p >= 1) return route[route.length - 1];

    let totalDist = 0;
    const dists = [0];
    for (let i = 1; i < route.length; i++) {
      const d = Math.sqrt(Math.pow(route[i][0] - route[i-1][0], 2) + Math.pow(route[i][1] - route[i-1][1], 2));
      totalDist += d;
      dists.push(totalDist);
    }

    const target = totalDist * p;
    for (let i = 1; i < route.length; i++) {
      if (dists[i] >= target) {
        const segmentDist = dists[i] - dists[i-1];
        if (segmentDist === 0) return route[i];
        const t = (target - dists[i-1]) / segmentDist;
        const x = route[i-1][0] + (route[i][0] - route[i-1][0]) * t;
        const y = route[i-1][1] + (route[i][1] - route[i-1][1]) * t;
        return [x, y];
      }
    }
    return route[route.length - 1];
  };

  const displayedVessels = useMemo(() => {
    let list = vessels;
    if (filter !== "ALL") list = list.filter(v => v.status === filter);
    
    return list.map(v => {
      let currentPos = (v.longitude !== undefined && v.latitude !== undefined) 
        ? [v.longitude, v.latitude] as [number, number]
        : null;

      let isSimulated = false;
      if (v.status === "UNDERWAY" && progress > 0 && currentPos && v.route?.length > 0) {
        const remaining = getRemainingRoute(currentPos, v.route);
        const simPos = interpolateRoute(remaining, progress);
        if (simPos) {
          currentPos = simPos as [number, number];
          isSimulated = true;
        }
      }
      return { ...v, currentPos, isSimulated };
    });
  }, [vessels, filter, progress]);

  const landPath = useMemo(() => generateLandPath(svgWidth, svgHeight), []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "UNDERWAY": return <Navigation className="w-4 h-4 text-blue-500" />;
      case "ANCHORED": return <Anchor className="w-4 h-4 text-amber-500" />;
      case "IN_PORT": return <MapPin className="w-4 h-4 text-emerald-500" />;
      case "STALE": return <AlertCircle className="w-4 h-4 text-rose-500" />;
      default: return <HelpCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  const focusPoint = (pos: [number, number]) => {
    const [cx, cy] = project(pos[0], pos[1], svgWidth, svgHeight);
    setTransform({ x: (svgWidth/2) - (cx * 2), y: (svgHeight/2) - (cy * 2), scale: 2 });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* Sidebar */}
      <div className="w-full lg:w-80 flex flex-col gap-4">
        <Card className="flex flex-col max-h-[500px]">
          {selectedEntity?.type === 'port' ? (
            <>
              <CardHeader className="pb-3 border-b bg-slate-50">
                <Button size="sm" variant="ghost" className="w-fit mb-2 -ml-2 h-8 px-2 text-slate-500" onClick={() => setSelectedEntity(null)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back to Fleet
                </Button>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-600" />
                  {KNOWN_PORTS.filter(p => p.id === selectedEntity.id)[0]?.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex-1 overflow-y-auto">
                <p className="text-sm text-slate-600 mb-4">
                  {KNOWN_PORTS.filter(p => p.id === selectedEntity.id)[0]?.desc}
                </p>
                <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Vessels En Route</h4>
                <div className="space-y-2">
                  {vessels.filter(v => v.destination === KNOWN_PORTS.filter(p => p.id === selectedEntity.id)[0]?.name).map(v => (
                    <div key={v.id} className="text-sm border rounded p-2 bg-slate-50 flex justify-between items-center">
                      <span>{v.name}</span>
                      <span className="text-xs text-slate-500">{new Date(v.eta).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {vessels.filter(v => v.destination === KNOWN_PORTS.filter(p => p.id === selectedEntity.id)[0]?.name).length === 0 && (
                    <p className="text-xs text-slate-400">No expected vessels.</p>
                  )}
                </div>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-3 shrink-0">
                <CardTitle>Fleet Overview</CardTitle>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge 
                    variant={filter === "ALL" ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => setFilter("ALL")}
                  >All</Badge>
                  <Badge 
                    variant={filter === "UNDERWAY" ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => setFilter("UNDERWAY")}
                  >Underway</Badge>
                  <Badge 
                    variant={filter === "IN_PORT" ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => setFilter("IN_PORT")}
                  >In Port</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-y-auto flex-1 divide-y">
                {displayedVessels.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground text-center">No vessels found.</div>
                )}
                {displayedVessels.map(v => (
                  <div 
                    key={v.id} 
                    className={`p-4 flex gap-3 cursor-pointer hover:bg-slate-50 transition-colors ${selectedEntity?.id === v.id ? 'bg-blue-50/50' : ''}`}
                    onClick={() => {
                      setSelectedEntity({ type: 'vessel', id: v.id });
                      if (v.currentPos) focusPoint(v.currentPos);
                    }}
                  >
                    <div className="mt-1">{getStatusIcon(v.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2 truncate">
                        <span className="truncate">{v.name}</span>
                        <span className="text-xs font-normal text-muted-foreground shrink-0">{v.identification}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        Dest: {v.destination} · ETA: {v.eta ? new Date(v.eta).toLocaleDateString() : 'Unknown'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                        Observed: {v.observedAt ? new Date(v.observedAt).toLocaleString() : 'N/A'} <br/>
                        <span className="text-slate-400">Src: {v.source}</span>
                      </div>
                      {v.status === "UNDERWAY" && v.speedKnots !== undefined && (
                        <div className="text-xs text-blue-600 mt-1 font-medium">
                          {v.speedKnots} kn · {v.course}° {v.isSimulated && <span className="text-amber-600">(Simulated)</span>}
                        </div>
                      )}
                    </div>
                    {onShipmentSelect && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="shrink-0 h-8 text-xs px-2 self-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShipmentSelect(v.id);
                        }}
                      >
                        View
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* Map Area */}
      <div className="flex-1 flex flex-col gap-4">
        <Card className="flex-1 relative min-h-[500px] bg-[#0f172a] w-full overflow-hidden border-slate-800">
          <div 
            className="absolute inset-0 touch-none" 
            ref={mapRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div className="absolute inset-0 bg-[#0f172a] opacity-50 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
            
            <svg 
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-full absolute inset-0 cursor-grab active:cursor-grabbing"
            >
              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                {/* Land */}
                <path 
                  d={landPath} 
                  className="fill-[#1e293b] stroke-[#334155] stroke-[1]" 
                  vectorEffect="non-scaling-stroke"
                />
                
                {/* Routes */}
                {displayedVessels.map(v => {
                  if (!v.route || v.route.length < 2) return null;
                  const pathD = v.route.map((pt, i) => {
                    const [px, py] = project(pt[0], pt[1], svgWidth, svgHeight);
                    return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
                  }).join(" ");
                  
                  return (
                    <path 
                      key={`route-${v.id}`}
                      d={pathD}
                      className="fill-none stroke-blue-400/20 stroke-[1.5]"
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                {/* Ports */}
                {KNOWN_PORTS.map(p => {
                  const [px, py] = project(p.pos[0], p.pos[1], svgWidth, svgHeight);
                  const isSelected = selectedEntity?.type === 'port' && selectedEntity.id === p.id;
                  return (
                    <g 
                      key={`port-${p.id}`} 
                      transform={`translate(${px},${py}) scale(${1 / transform.scale})`}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEntity({ type: 'port', id: p.id });
                        focusPoint(p.pos);
                      }}
                    >
                      {isSelected && <circle r={14} className="fill-emerald-500/20 stroke-emerald-400 stroke-1" />}
                      <circle r={5} className="fill-emerald-400 stroke-emerald-900 stroke-[1.5]" />
                      <text y={-10} className="text-[10px] fill-emerald-100 font-medium text-center drop-shadow-md" textAnchor="middle">{p.name}</text>
                    </g>
                  );
                })}

                {/* Vessels */}
                {displayedVessels.map(v => {
                  if (!v.currentPos) return null;
                  const [px, py] = project(v.currentPos[0], v.currentPos[1], svgWidth, svgHeight);
                  const isSelected = selectedEntity?.type === 'vessel' && selectedEntity.id === v.id;
                  const isUnderway = v.status === "UNDERWAY";
                  
                  return (
                    <g 
                      key={`vessel-${v.id}`} 
                      transform={`translate(${px},${py}) scale(${1 / transform.scale})`}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEntity({ type: 'vessel', id: v.id });
                        focusPoint(v.currentPos as [number, number]);
                      }}
                    >
                      {isSelected && <circle r={12} className="fill-blue-500/20 stroke-blue-400 stroke-1" />}
                      <circle r={isUnderway ? 5 : 4} className={isUnderway ? "fill-blue-400 stroke-[#0f172a] stroke-1" : "fill-slate-400 stroke-[#0f172a] stroke-1"} />
                      <path 
                        d="M -4 4 L 0 -6 L 4 4 Z" 
                        className={isUnderway ? "fill-blue-400" : "fill-slate-400"}
                        transform={`rotate(${v.course || 0})`}
                      />
                      {isSelected && (
                        <g transform="translate(0, -18)">
                          <rect x={-40} y={-16} width={80} height={20} rx={4} className="fill-slate-900/90 stroke-slate-700 stroke-1" />
                          <text y={-2} className="text-[10px] fill-slate-100 font-medium text-center" textAnchor="middle">{v.name}</text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Map Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-none">
            <Button size="sm" variant="outline" className="w-8 h-8 p-0 bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200 pointer-events-auto" onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}>
              <MapPin className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" className="w-8 h-8 p-0 bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200 pointer-events-auto" onClick={() => handleZoom(1.5)}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" className="w-8 h-8 p-0 bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200 pointer-events-auto" onClick={() => handleZoom(1 / 1.5)}>
              <ZoomOut className="w-4 h-4" />
            </Button>
          </div>

          {/* Playback Controls */}
          <div className="absolute bottom-4 left-4 right-4 bg-slate-900/90 border border-slate-700 rounded-lg p-3 flex items-center gap-4 backdrop-blur-sm shadow-xl">
            <Button 
              size="sm" 
              variant="outline"
              className="w-8 h-8 p-0 rounded-full border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white shrink-0"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex justify-between text-xs text-slate-300 font-medium px-1">
                <span>{progress === 0 ? "Laatste fictieve positie" : "Gesimuleerde verplaatsing"}</span>
                <span className="text-slate-400">+{progress.toFixed(0)}%</span>
              </div>
              <input 
                type="range"
                value={progress}
                onChange={(e) => {
                  setProgress(parseFloat(e.target.value));
                  setIsPlaying(false);
                }}
                min={0}
                max={100}
                step={0.1}
                className="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </Card>
        <p className="text-xs text-slate-500 mt-2">Geografisch overzicht: Natural Earth (publiek domein). Alle posities zijn SYNTHETIC DEMO, niet live. Routes zijn illustratief en niet nautisch geverifieerd.</p>
      </div>
    </div>
  );
}
