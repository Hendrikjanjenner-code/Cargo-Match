import { landData } from "./ne_110m_land";

export function project(lon: number, lat: number, width = 1000, height = 500) {
  const x = (lon + 180) * (width / 360);
  const y = (90 - lat) * (height / 180);
  return [x, y];
}

export function generateLandPath(width = 1000, height = 500) {
  let pathStr = "";
  
  for (const feature of landData.features) {
    const coords = feature.geometry.coordinates as any;
    if (feature.geometry.type === "Polygon") {
      const ring = coords[0];
      pathStr += renderRing(ring, width, height);
    } else if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of coords) {
        pathStr += renderRing(polygon[0], width, height);
      }
    }
  }
  return pathStr;
}

function renderRing(ring: number[][], width: number, height: number) {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1], width, height);
    if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)} `;
    else d += `L${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d + "Z ";
}
