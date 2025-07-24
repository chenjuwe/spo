/**
 * 優化版本的圖片分析模塊
 * 使用 LSH、整合式哈希計算、WebAssembly 和降維技術優化相似度比較
 */

import { PhotoFile } from "../components/PhotoOrganizer";
import { HashResult } from "./integratedHasher";
import { calculateMultipleHashes } from "./integratedHasher";
import { OptimizedImageComparator, OptimizationLevel, ComparisonOptions, SimilarityGroup as OptimizedSimilarityGroup } from "./optimizedImageComparison";
import { errorHandler, ErrorType } from "./errorHandlingService";

// 照片群組
export interface SimilarityGroup {
  keyPhoto: PhotoFile;
  similarPhotos: PhotoFile[];
}

// 默認相似度閾值 (0-100)
const DEFAULT_SIMILARITY_THRESHOLD = 90;

// 全局優化比較器實例
let globalComparator: OptimizedImageComparator | null = null;

/**
 * 獲取優化級別
 * 根據照片數量和設備性能調整優化級別
 */
function getOptimizationLevel(photoCount: number): OptimizationLevel {
  // 根據照片數量選擇合適的優化級別
  if (photoCount < 50) {
    return OptimizationLevel.STANDARD; // 少量照片，使用標準級別即可
  } else if (photoCount < 200) {
    return OptimizationLevel.ADVANCED; // 中等數量，使用 LSH 優化
  } else {
    return OptimizationLevel.PROFESSIONAL; // 大量照片，使用所有優化技術
  }
}

/**
 * 初始化全局比較器
 * @param photoCount 照片數量
 * @param threshold 相似度閾值
 */
export function initializeOptimizedComparator(
  photoCount: number = 100,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): OptimizedImageComparator {
  try {
    const optimizationLevel = getOptimizationLevel(photoCount);
    
    console.info(`初始化圖像比較器，優化級別：${optimizationLevel}，照片數量：${photoCount}`);
    
    const options: ComparisonOptions = {
      optimizationLevel,
      similarityThreshold: threshold,
      useWasm: true,
      maxCandidates: Math.min(500, photoCount * 2),
      featureVectorSize: 16
    };
    
    globalComparator = new OptimizedImageComparator(options);
    return globalComparator;
  } catch (error) {
    errorHandler.handleError({
      type: ErrorType.SYSTEM_ERROR,
      message: "初始化圖像比較器失敗",
      details: `無法初始化優化的圖像比較器：${error}`,
      timestamp: new Date(),
      recoverable: true,
      recoveryAction: () => {
        // 嘗試使用更基本的優化級別重新初始化
        console.warn("使用基本優化級別重試...");
        const options: ComparisonOptions = {
          optimizationLevel: OptimizationLevel.BASIC,
          similarityThreshold: threshold,
          useWasm: false
        };
        globalComparator = new OptimizedImageComparator(options);
      },
      technicalDetails: error
    });
    
    // 返回基本級別的比較器
    return new OptimizedImageComparator({
      optimizationLevel: OptimizationLevel.BASIC,
      similarityThreshold: threshold,
      useWasm: false
    });
  }
}

/**
 * 計算圖片的哈希
 * @param photo 照片對象
 * @returns 哈希結果
 */
export async function calculatePhotoHashes(photo: PhotoFile): Promise<HashResult> {
  try {
    // 創建 ImageData 對象
    const img = new Image();
    
    // 返回 Promise 以支持異步操作
    return new Promise<HashResult>((resolve, reject) => {
      img.onload = () => {
        try {
          // 創建畫布並繪製圖像
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error("無法獲取畫布上下文"));
            return;
          }
          
          // 設置畫布大小
          const maxDimension = 256; // 對於哈希計算，這個大小已經足夠
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const width = Math.floor(img.width * scale);
          const height = Math.floor(img.height * scale);
          
          canvas.width = width;
          canvas.height = height;
          
          // 繪製圖像
          ctx.drawImage(img, 0, 0, width, height);
          
          // 獲取圖像數據
          const imageData = ctx.getImageData(0, 0, width, height);
          
          // 計算多個哈希
          const hashes = calculateMultipleHashes(imageData);
          
          // 清理資源
          canvas.width = 0;
          canvas.height = 0;
          
          // 返回結果
          resolve(hashes);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error(`無法加載圖片 ${photo.file.name}`));
      };
      
      // 設置圖片源
      img.src = photo.preview;
    });
  } catch (error) {
    errorHandler.handleError({
      type: ErrorType.PHOTO_PROCESSING_ERROR,
      message: `計算照片哈希失敗：${photo.file.name}`,
      details: `處理照片時發生錯誤：${error}`,
      timestamp: new Date(),
      recoverable: true,
      technicalDetails: error
    });
    
    // 返回空結果
    return {};
  }
}

/**
 * 提取圖片特徵
 * @param photo 照片對象
 * @returns 特徵向量
 */
export async function extractPhotoFeatures(photo: PhotoFile): Promise<number[]> {
  try {
    // 創建 ImageData 對象
    const img = new Image();
    
    // 返回 Promise 以支持異步操作
    return new Promise<number[]>((resolve, reject) => {
      img.onload = () => {
        try {
          // 創建畫布並繪製圖像
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            reject(new Error("無法獲取畫布上下文"));
            return;
          }
          
          // 設置畫布大小 - 對於特徵提取，保持較高的解析度
          const maxDimension = 512;
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const width = Math.floor(img.width * scale);
          const height = Math.floor(img.height * scale);
          
          canvas.width = width;
          canvas.height = height;
          
          // 繪製圖像
          ctx.drawImage(img, 0, 0, width, height);
          
          // 獲取圖像數據
          const imageData = ctx.getImageData(0, 0, width, height);
          
          // 提取顏色直方圖作為簡單特徵
          const colorFeatures = extractColorHistogramFeatures(imageData);
          
          // 提取紋理特徵
          const textureFeatures = extractTextureFeatures(imageData);
          
          // 合併特徵
          const features = [...colorFeatures, ...textureFeatures];
          
          // 清理資源
          canvas.width = 0;
          canvas.height = 0;
          
          // 返回結果
          resolve(features);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error(`無法加載圖片 ${photo.file.name}`));
      };
      
      // 設置圖片源
      img.src = photo.preview;
    });
  } catch (error) {
    errorHandler.handleError({
      type: ErrorType.PHOTO_PROCESSING_ERROR,
      message: `提取照片特徵失敗：${photo.file.name}`,
      details: `處理照片時發生錯誤：${error}`,
      timestamp: new Date(),
      recoverable: true,
      technicalDetails: error
    });
    
    // 返回空特徵向量
    return [];
  }
}

/**
 * 提取顏色直方圖特徵
 * @param imageData 圖像數據
 * @returns 顏色直方圖特徵向量
 */
function extractColorHistogramFeatures(imageData: ImageData): number[] {
  const { data, width, height } = imageData;
  const binCount = 8; // 每個顏色通道的直方圖箱數
  const histogram = new Array(binCount * 3).fill(0); // R, G, B 三個通道
  
  // 計算直方圖
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.floor(data[i] / 256 * binCount);
    const g = Math.floor(data[i + 1] / 256 * binCount);
    const b = Math.floor(data[i + 2] / 256 * binCount);
    
    histogram[r]++;
    histogram[binCount + g]++;
    histogram[binCount * 2 + b]++;
  }
  
  // 歸一化直方圖
  const pixelCount = width * height;
  return histogram.map(count => count / pixelCount);
}

/**
 * 提取紋理特徵
 * @param imageData 圖像數據
 * @returns 紋理特徵向量
 */
function extractTextureFeatures(imageData: ImageData): number[] {
  const { data, width, height } = imageData;
  const grayData = new Uint8ClampedArray(width * height);
  
  // 轉換為灰度圖像
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    grayData[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  
  // 計算簡化的局部二進制模式 (LBP) 特徵
  const numBins = 16; // LBP 直方圖箱數
  const histogram = new Array(numBins).fill(0);
  
  // 簡化的 LBP 計算
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = grayData[y * width + x];
      let lbpValue = 0;
      
      // 簡化為 4 點 LBP (上下左右)
      lbpValue |= (grayData[(y - 1) * width + x] >= center ? 1 : 0) << 0;
      lbpValue |= (grayData[(y + 1) * width + x] >= center ? 1 : 0) << 1;
      lbpValue |= (grayData[y * width + (x - 1)] >= center ? 1 : 0) << 2;
      lbpValue |= (grayData[y * width + (x + 1)] >= center ? 1 : 0) << 3;
      
      // 映射到更少的箱
      const binIndex = Math.floor(lbpValue / 16 * numBins);
      histogram[binIndex]++;
    }
  }
  
  // 歸一化 LBP 直方圖
  const totalPixels = (width - 2) * (height - 2);
  return histogram.map(count => count / totalPixels);
}

/**
 * 使用優化的算法分析照片相似度並分組
 * @param photos 照片數組
 * @param threshold 相似度閾值 (0-100)
 * @returns 相似照片組
 */
export async function findSimilarPhotosOptimized(
  photos: PhotoFile[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<SimilarityGroup[]> {
  try {
    console.time('findSimilarPhotosOptimized');
    
    // 初始化比較器
    if (!globalComparator) {
      globalComparator = initializeOptimizedComparator(photos.length, threshold);
    } else if (globalComparator.getStats().imageCount > 0) {
      // 如果比較器已有數據，清除之前的數據
      globalComparator.clear();
    }
    
    console.info(`開始處理 ${photos.length} 張照片...`);
    
    // 處理所有照片
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      
      try {
        // 計算哈希
        const hashResult = await calculatePhotoHashes(photo);
        
        // 提取特徵
        let features: number[] = [];
        
        if (globalComparator.options.optimizationLevel === OptimizationLevel.PROFESSIONAL) {
          features = await extractPhotoFeatures(photo);
        }
        
        // 添加到比較器
        globalComparator.addImage(photo.id, hashResult, features, { photo });
        
        // 每處理 20 張照片記錄一次進度
        if ((i + 1) % 20 === 0 || i === photos.length - 1) {
          console.info(`處理進度: ${i + 1}/${photos.length} 張照片 (${Math.round((i + 1) / photos.length * 100)}%)`);
        }
      } catch (error) {
        console.warn(`處理照片 ${photo.file.name} 時出錯:`, error);
      }
    }
    
    // 如果使用降維特徵比較，重新訓練比較器
    if (globalComparator.options.optimizationLevel === OptimizationLevel.PROFESSIONAL) {
      globalComparator.retrainFeatureComparator();
    }
    
    // 查找所有相似組
    const optimizedGroups = globalComparator.findAllSimilarityGroups(threshold);
    
    // 轉換為應用使用的格式
    const result = convertToAppSimilarityGroups(optimizedGroups);
    
    console.timeEnd('findSimilarPhotosOptimized');
    console.info(`找到 ${result.length} 組相似照片`);
    
    return result;
  } catch (error) {
    errorHandler.handleError({
      type: ErrorType.PHOTO_PROCESSING_ERROR,
      message: "照片相似度分析失敗",
      details: `處理照片相似度時發生錯誤：${error}`,
      timestamp: new Date(),
      recoverable: false,
      technicalDetails: error
    });
    
    // 返回空結果
    return [];
  }
}

/**
 * 將優化比較器的相似度組轉換為應用使用的格式
 * @param optimizedGroups 優化比較器的相似度組
 * @returns 應用格式的相似度組
 */
function convertToAppSimilarityGroups(
  optimizedGroups: OptimizedSimilarityGroup[]
): SimilarityGroup[] {
  return optimizedGroups.map(group => {
    const keyPhoto = (group.keyImage.metadata?.photo as PhotoFile);
    
    const similarPhotos = group.similarImages.map(item => 
      item.image.metadata?.photo as PhotoFile
    );
    
    return {
      keyPhoto,
      similarPhotos
    };
  });
}

/**
 * 計算兩張照片的相似度
 * @param photo1 第一張照片
 * @param photo2 第二張照片
 * @returns 相似度百分比 (0-100)
 */
export async function compareTwoPhotos(
  photo1: PhotoFile,
  photo2: PhotoFile
): Promise<number> {
  try {
    // 計算哈希
    const hash1 = await calculatePhotoHashes(photo1);
    const hash2 = await calculatePhotoHashes(photo2);
    
    // 提取特徵
    const features1 = await extractPhotoFeatures(photo1);
    const features2 = await extractPhotoFeatures(photo2);
    
    // 創建臨時比較器
    const comparator = new OptimizedImageComparator({
      optimizationLevel: OptimizationLevel.PROFESSIONAL,
      similarityThreshold: 0,  // 不過濾任何結果
      useWasm: true
    });
    
    // 添加照片
    comparator.addImage('photo1', hash1, features1, { photo: photo1 });
    comparator.addImage('photo2', hash2, features2, { photo: photo2 });
    
    // 如果有特徵向量，訓練比較器
    if (features1.length > 0 && features2.length > 0) {
      comparator.retrainFeatureComparator();
    }
    
    // 比較照片
    const result = comparator.compareImageItems(
      comparator.getImageItem('photo1')!,
      comparator.getImageItem('photo2')!
    );
    
    return result.similarity;
  } catch (error) {
    errorHandler.handleError({
      type: ErrorType.PHOTO_PROCESSING_ERROR,
      message: "照片比較失敗",
      details: `比較照片時發生錯誤：${error}`,
      timestamp: new Date(),
      recoverable: true,
      technicalDetails: error
    });
    
    // 返回 0 表示無法比較或不相似
    return 0;
  }
} 