/**
 * 優化功能集成模塊
 * 提供對所有圖像處理優化功能的統一訪問
 */

// WebGPU 加速
export { 
  getWebGPUContext, 
  preInitializeWebGPU 
} from './webGpuAcceleration';

export type {
  WebGPUContext, 
  WebGPUSupport
} from './webGpuAcceleration';

export { 
  calculateHammingDistanceGPU, 
  calculateBatchHammingDistancesGPU,
  smartHammingDistance,
  smartBatchHammingDistance,
  initializeGPUHashCompare,
  preInitializeGPUHashCompare
} from './gpuHashCompare';

// 增強的 LSH
export {
  DEFAULT_ENHANCED_LSH_CONFIG,
  MultiProbeLSHIndex,
  E2LSHIndex,
  EnhancedLSHIndex,
  createEnhancedLSHIndex
} from './enhancedLSH';

export type {
  EnhancedLSHConfig
} from './enhancedLSH';

// 自適應處理
export {
  AdaptiveSampling,
  DEFAULT_ADAPTIVE_SAMPLING_CONFIG,
  createAdaptiveSampling
} from './adaptiveSampling';

export type {
  AdaptiveSamplingConfig
} from './adaptiveSampling';

export {
  IntelligentBatchProcessing,
  DEFAULT_BATCH_PROCESSING_CONFIG,
  TaskStatus,
  BatchProcessingEventType,
  createIntelligentBatchProcessing
} from './intelligentBatchProcessing';

export type {
  BatchProcessingConfig
} from './intelligentBatchProcessing';

// 核心功能
export * from './types';
export * from './utils';

// WebAssembly 加速
export {
  initializeModule,
  calculateHammingDistance as calculateHammingDistanceWasm,
  calculateHammingDistanceSync,
  calculateBatchHammingDistances,
  hammingDistanceJS,
  initializeModuleEager
} from './wasmHashCompare';

// LSH 系統
export {
  DEFAULT_LSH_CONFIG,
  LSHIndex,
  createLSHIndex,
  hexToBinary,
  combineHashes
} from './lsh';

export type {
  LSHConfig
} from './lsh';

// 圖像處理服務
export * from './imageProcessingService';
export * from './imageSimilaritySystem';
export * from './imageWorker';

// 深度學習和多級特徵
export {
  DeepFeatureExtractor,
  ModelType,
  DEFAULT_FEATURE_EXTRACTOR_OPTIONS,
  getFeatureExtractor,
  preloadFeatureExtractor,
  disposeFeatureExtractor
} from './deepFeatureExtractor';

export type {
  FeatureExtractorOptions
} from './deepFeatureExtractor';

export {
  FeatureLevel,
  MultiLevelFeatureFusion,
  DEFAULT_FUSION_WEIGHTS
} from './multiLevelFeatureFusion';

export type {
  MultiLevelFeature,
  FeatureFusionWeights
} from './multiLevelFeatureFusion';

export {
  EnhancedImageSimilaritySystem,
  DEFAULT_ENHANCED_OPTIONS,
  getEnhancedSimilaritySystem
} from './enhancedImageSimilarity';

export type {
  EnhancedSimilarityGroup,
  EnhancedSimilarityOptions
} from './enhancedImageSimilarity';

// 兼容性和錯誤處理
export * from './compatibilityChecker';
export * from './errorHandlingService';

/**
 * 優化器配置接口
 */
export interface OptimizationsConfig {
  /**
   * 是否啟用 WebGPU 加速
   */
  enableWebGPU: boolean;
  
  /**
   * 是否啟用深度學習特徵
   */
  enableDeepFeatures: boolean;
  
  /**
   * 是否啟用增強 LSH
   */
  enableEnhancedLSH: boolean;
  
  /**
   * 是否啟用自適應採樣
   */
  enableAdaptiveSampling: boolean;
  
  /**
   * 是否啟用智能批量處理
   */
  enableIntelligentBatch: boolean;
}

/**
 * 系統優化初始化
 * 預加載和初始化各種優化功能
 */
export async function initializeOptimizations(
  config: Partial<OptimizationsConfig> = {}
): Promise<void> {
  const defaults = {
    enableWebGPU: true,
    enableDeepFeatures: true,
    enableEnhancedLSH: true,
    enableAdaptiveSampling: true,
    enableIntelligentBatch: true
  };
  
  const options = { ...defaults, ...config };
  
  const initPromises: Promise<any>[] = [];
  
  // 初始化 WebGPU
  if (options.enableWebGPU) {
    const { getWebGPUContext, preInitializeWebGPU } = await import('./webGpuAcceleration');
    const { initializeGPUHashCompare } = await import('./gpuHashCompare');
    
    preInitializeWebGPU();
    initPromises.push(initializeGPUHashCompare());
  }
  
  // 初始化 WebAssembly
  const { initializeModule } = await import('./wasmHashCompare');
  initPromises.push(initializeModule());
  
  // 初始化深度學習模型
  if (options.enableDeepFeatures) {
    const { preloadFeatureExtractor } = await import('./deepFeatureExtractor');
    preloadFeatureExtractor();
  }
  
  // 等待所有初始化完成
  await Promise.allSettled(initPromises);
  
  console.info('系統優化初始化完成');
} 