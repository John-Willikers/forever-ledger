// Shapes of /admin/api/maps* (apps/server/src/routes/adminMaps.ts). Zone names and point labels come from uploads:
// untrusted text, rendered as text only. Times are America/Chicago ISO strings.

export interface ZoneMapImage {
  uiMapId: number;
  name: string | null;
  mime: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  build: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  aspectWarning: string | null;
}

export interface ZoneMapRow {
  uiMapId: number;
  zone: string | null;
  points: { gathering: number; quests: number; npcs: number; total: number };
  image: ZoneMapImage | null;
}

export interface ZoneMapsList {
  latestBuild: number | null;
  maps: ZoneMapRow[];
}

export interface ZoneMapPoints {
  uiMapId: number;
  points: { x: number; y: number; kind: string; label: string; weight: number }[];
}

export interface UploadResult {
  map: ZoneMapImage;
  warnings: string[];
}
