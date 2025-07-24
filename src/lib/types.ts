// 通用類型定義庫

export interface PhotoFile {
  file: File;
  preview: string;
  id: string;
  similarity?: number;
  isSelected?: boolean;
  group?: string;
  quality?: ImageQuality;
  hash?: string;
  hashes?: HashResult; // 新增支援多種哈希類型
  path?: string; // 原始路徑
}

export interface ImageQuality {
  sharpness: number;
  brightness: number;
  contrast: number;
  score: number;
}

export interface SimilarityGroup {
  id: string;
  photos: string[];
  bestPhoto: string;
  averageSimilarity: number;
}

export interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
}

export interface ProcessingOptions {
  autoRename?: boolean;
  preserveOriginal?: boolean;
  maxDimension?: number;
  optimizeQuality?: boolean;
}

export interface OrganizationResult {
  keptPhotos: PhotoFile[];
  deletedPhotos: PhotoFile[];
  renamedPhotos: { original: string; newName: string }[];
}

export interface ProcessingTaskOptions {
  onProgress?: (progress: number) => void;
  onError?: (error: Error) => void;
  onComplete?: <T>(result: T) => void;
  signal?: AbortSignal;
}

// 哈希類型定義
export type HashType = 'pHash' | 'dHash' | 'aHash';
export type HashResult = Record<HashType, string>;

// 哈希相似度比較閾值設定
export interface SimilarityThresholds {
  histogram: number; // 顏色直方圖相似度閾值 (0-1)
  hash: number;      // 哈希相似度閾值 (0-100)
  feature: number;   // 特徵向量相似度閾值 (0-1)
} 