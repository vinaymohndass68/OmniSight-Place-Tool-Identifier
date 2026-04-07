
export interface FoundItem {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
  boundingBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
}

export enum AnalysisMode {
  TEXT = 'text',
  IMAGE = 'image'
}

export interface AppState {
  items: FoundItem[];
  isLoading: boolean;
  error: string | null;
  currentPlace: string;
}
