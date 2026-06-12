/**
 * A minimal MapLibre style that uses free OpenStreetMap raster tiles.
 * No API key or access token is required.
 */
export const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#05060a" },
    },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: { "raster-brightness-max": 0.8, "raster-saturation": 0.1 },
    },
  ],
} as const;

export const OSM_RASTER_STYLE_JSON = JSON.stringify(OSM_RASTER_STYLE);
