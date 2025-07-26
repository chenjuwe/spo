/**
 * 深度學習特徵提取模組
 * 使用預訓練的神經網路模型提取圖像高級特徵
 */

import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as comlink from 'comlink';
import { errorHandler, ErrorType } from './errorHandlingService';

// 定義 Worker 類型
type FeatureExtractorWorker = {
  initialize(): Promise<boolean>;
  extractFeatures(imageData: ImageData): Promise<number[]>;
  dispose(): void;
};

/**
 * 模型類型枚舉
 */
export enum ModelType {
  MOBILENET_V2 = 'mobilenet_v2',
  CUSTOM = 'custom'
}

/**
 * 特徵提取器選項
 */
export interface FeatureExtractorOptions {
  /**
   * 模型類型
   */
  modelType: ModelType;
  
  /**
   * 是否使用量化模型（體積更小但精度略降）
   */
  useQuantizedModel?: boolean;
  
  /**
   * 是否使用 WebGL 加速
   */
  useWebGL?: boolean;
  
  /**
   * 特徵層名稱（針對自定義提取層）
   */
  featureLayerName?: string;
  
  /**
   * 是否啟用模型快取
   */
  enableModelCaching?: boolean;
  
  /**
   * 使用的 alpha 參數（針對 MobileNet）
   * 較小的值意味著網絡較小且速度更快，但準確性降低
   */
  modelAlpha?: 0.25 | 0.5 | 0.75 | 1.0;

  /**
   * 是否使用 Web Worker
   */
  useWorker?: boolean;
}

/**
 * 默認特徵提取器選項
 */
export const DEFAULT_FEATURE_EXTRACTOR_OPTIONS: FeatureExtractorOptions = {
  modelType: ModelType.MOBILENET_V2,
  useQuantizedModel: true,
  useWebGL: true,
  enableModelCaching: true,
  modelAlpha: 0.5,
  useWorker: true
};

/**
 * 檢查瀏覽器是否支持 Web Workers 和 OffscreenCanvas
 */
function isWebWorkerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * 深度學習特徵提取器類
 */
export class DeepFeatureExtractor {
  private model: mobilenet.MobileNet | null = null;
  private worker: Worker | null = null;
  private workerProxy: FeatureExtractorWorker | null = null;
  private options: FeatureExtractorOptions;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private useWorker: boolean;

  /**
   * 構造函數
   * @param options 特徵提取器選項
   */
  constructor(options: Partial<FeatureExtractorOptions> = {}) {
    this.options = { ...DEFAULT_FEATURE_EXTRACTOR_OPTIONS, ...options };
    
    // 檢查是否支持 Web Workers
    this.useWorker = this.options.useWorker === true && isWebWorkerSupported();
    
    if (this.options.useWorker && !this.useWorker) {
      console.warn('此瀏覽器不支持 Web Workers 或 OffscreenCanvas，將使用主線程');
    }
  }

  /**
   * 初始化模型
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.isInitializing) {
      // 等待初始化完成
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isInitialized;
    }

    this.isInitializing = true;
    
    try {
      console.info('開始初始化深度特徵提取器...');
      
      if (this.useWorker) {
        return await this.initializeWorker();
      } else {
        return await this.initializeMainThread();
      }
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        `無法初始化 TensorFlow.js 或 MobileNet 模型: ${error}`,
        true
      );
      
      this.isInitialized = false;
      return false;
    } finally {
      this.isInitializing = false;
    }
  }
  
  /**
   * 在主線程初始化模型
   */
  private async initializeMainThread(): Promise<boolean> {
    try {
      // 配置 TensorFlow.js 後端
      if (this.options.useWebGL) {
        await tf.setBackend('webgl');
        console.info('使用 WebGL 後端加速');
      } else {
        await tf.setBackend('cpu');
        console.info('使用 CPU 後端');
      }
      
      // 加載模型
      if (this.options.modelType === ModelType.MOBILENET_V2) {
        this.model = await mobilenet.load({
          version: 2,
          alpha: this.options.modelAlpha || 0.5,
          modelUrl: ''  // 空字符串將使用默認模型 URL
        });
        
        console.info(`MobileNet V2 模型加載成功，Alpha=${this.options.modelAlpha}`);
      } else {
        throw new Error('目前僅支援 MobileNet V2 模型');
      }

      this.isInitialized = true;
      console.info('深度特徵提取器初始化完成 (主線程)');
      
      return true;
    } catch (error) {
      console.error('深度特徵提取器初始化失敗 (主線程):', error);
      this.isInitialized = false;
      return false;
    }
  }
  
  /**
   * 初始化 Worker 線程
   */
  private async initializeWorker(): Promise<boolean> {
    try {
      // 創建 Worker
      this.worker = new Worker(new URL('./deepFeatureWorker.ts', import.meta.url), { type: 'module' });
      
      // 使用 Comlink 包裝 Worker
      this.workerProxy = comlink.wrap<FeatureExtractorWorker>(this.worker);
      
      // 初始化 Worker
      const success = await this.workerProxy.initialize();
      
      if (success) {
        this.isInitialized = true;
        console.info('深度特徵提取器初始化完成 (Worker 線程)');
      } else {
        console.error('深度特徵提取器在 Worker 線程初始化失敗');
        // 如果 Worker 初始化失敗，嘗試在主線程初始化
        this.terminateWorker();
        this.useWorker = false;
        return await this.initializeMainThread();
      }
      
      return success;
    } catch (error) {
      console.error('創建或初始化 Worker 失敗:', error);
      
      // 如果 Worker 初始化失敗，嘗試在主線程初始化
      this.terminateWorker();
      this.useWorker = false;
      return await this.initializeMainThread();
    }
  }
  
  /**
   * 終止 Worker
   */
  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerProxy = null;
    }
  }

  /**
   * 提取圖像特徵
   * @param imageElement 圖像元素（可以是 HTMLImageElement 或圖像 URL）
   * @param useActivation 是否使用啟用函數（用於非嵌入層特徵）
   * @returns 特徵向量
   */
  public async extractFeatures(
    imageElement: HTMLImageElement | string,
    useActivation: boolean = false
  ): Promise<number[]> {
    if (!this.isInitialized) {
      const success = await this.initialize();
      if (!success) throw new Error('模型未初始化');
    }

    try {
      // 準備圖像
      let imgElement: HTMLImageElement;
      if (typeof imageElement === 'string') {
        imgElement = await this.loadImage(imageElement);
      } else {
        imgElement = imageElement;
      }

      // 創建畫布並獲取 ImageData
      const { imageData } = this.createCanvasAndGetImageData(imgElement);
      
      // 使用 Worker 或主線程提取特徵
      let features: number[] = [];
      
      if (this.useWorker && this.workerProxy) {
        // 使用 Worker 提取特徵
        features = await this.workerProxy.extractFeatures(imageData);
      } else if (this.model) {
        // 使用主線程提取特徵
        const internalActivation = await this.extractInternalFeatures(imgElement);
        features = Array.from(await internalActivation.data());
        
        // 釋放張量
        internalActivation.dispose();
      }

      return features;
    } catch (error) {
      console.error('特徵提取失敗:', error);
      return [];
    }
  }
  
  /**
   * 加載圖像
   */
  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`無法加載圖像: ${url}`));
      img.crossOrigin = 'anonymous';
      img.src = url;
    });
  }
  
  /**
   * 創建畫布並獲取圖像數據
   */
  private createCanvasAndGetImageData(img: HTMLImageElement): { 
    canvas: HTMLCanvasElement; 
    ctx: CanvasRenderingContext2D; 
    imageData: ImageData 
  } {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    return { canvas, ctx, imageData };
  }

  /**
   * 從 MobileNet 提取內部特徵
   * @param img 圖像元素
   * @returns 特徵張量
   */
  private async extractInternalFeatures(img: HTMLImageElement): Promise<tf.Tensor> {
    // 確保模型存在
    if (!this.model) {
      throw new Error('模型未加載');
    }

    // 創建輸入張量
    const tfImg = tf.browser.fromPixels(img);
    
    // 調整大小到模型預期的輸入大小
    const resized = tf.image.resizeBilinear(tfImg, [224, 224]);
    
    // 歸一化圖像像素值到 [-1, 1]
    const normalized = resized.toFloat().div(127.5).sub(1);
    
    // 添加批次維度
    const batched = normalized.expandDims(0);
    
    // 獲取中間層激活值
    const activation = await (this.model as any).model.executeAsync(
      batched, 
      ['MobilenetV2/Logits/AvgPool']  // 提取全局平均池化層輸出
    ) as tf.Tensor;
    
    // 釋放不需要的張量以避免內存泄漏
    tfImg.dispose();
    resized.dispose();
    normalized.dispose();
    batched.dispose();
    
    return activation.squeeze();
  }

  /**
   * 提取並降維特徵
   * @param imageElement 圖像元素
   * @param targetDimension 目標維度
   * @returns 降維後的特徵向量
   */
  public async extractAndReduceFeatures(
    imageElement: HTMLImageElement | string,
    targetDimension: number = 128
  ): Promise<number[]> {
    const features = await this.extractFeatures(imageElement);
    
    if (features.length <= targetDimension) {
      return features;
    }
    
    // 使用簡單的維度縮減：均值池化
    const poolSize = Math.ceil(features.length / targetDimension);
    const reduced: number[] = [];
    
    for (let i = 0; i < targetDimension; i++) {
      const start = i * poolSize;
      const end = Math.min(start + poolSize, features.length);
      let sum = 0;
      
      for (let j = start; j < end; j++) {
        sum += features[j];
      }
      
      reduced.push(sum / (end - start));
    }
    
    return reduced;
  }

  /**
   * 釋放模型資源
   */
  public dispose(): void {
    if (this.useWorker && this.workerProxy) {
      try {
        this.workerProxy.dispose();
        this.terminateWorker();
      } catch (error) {
        console.error('釋放 Worker 資源失敗:', error);
      }
    } else if (this.model) {
      try {
        (this.model as any).dispose();
        this.model = null;
      } catch (error) {
        console.error('釋放模型資源失敗:', error);
      }
    }
    
    this.isInitialized = false;
  }
}

/**
 * 創建並導出一個全局特徵提取器實例
 */
let globalExtractor: DeepFeatureExtractor | null = null;

/**
 * 獲取全局特徵提取器實例
 */
export function getFeatureExtractor(options?: Partial<FeatureExtractorOptions>): DeepFeatureExtractor {
  if (!globalExtractor) {
    globalExtractor = new DeepFeatureExtractor(options);
  } else if (options) {
    // 如果已存在實例但提供了新選項，則重建
    globalExtractor.dispose();
    globalExtractor = new DeepFeatureExtractor(options);
  }
  
  return globalExtractor;
}

/**
 * 提前初始化特徵提取器
 */
export function preloadFeatureExtractor(): void {
  setTimeout(async () => {
    try {
      const extractor = getFeatureExtractor();
      await extractor.initialize();
    } catch (error) {
      console.warn('預加載特徵提取器失敗:', error);
    }
  }, 2000);  // 延遲 2 秒，避免與頁面加載競爭資源
}

/**
 * 釋放特徵提取器資源
 */
export function disposeFeatureExtractor(): void {
  if (globalExtractor) {
    globalExtractor.dispose();
    globalExtractor = null;
  }
} 