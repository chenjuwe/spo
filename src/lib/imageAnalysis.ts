import { pipeline, env } from '@huggingface/transformers';
import { errorHandler, ErrorType } from './errorHandlingService';
import { PhotoFile } from './types';

// 設定 transformers 環境，減少 console 訊息
env.setLogLevel('error');
env.useBrowserCache(true);

// 定義分析結果介面
export interface ImageAnalysisResult {
  categories: string[];  // 圖片分類結果
  tags: string[];        // 辨識出的物件或標籤
  scenes: string[];      // 場景描述
  faces: number;         // 識別到的人臉數量
  emotions?: string[];   // 識別出的表情 (可選)
  confidence: {          // 信心值
    category: number;
    tags: number;
    scene: number;
  };
  rawResults?: any;      // 原始分析結果
}

// 模型配置
const MODEL_CONFIG = {
  imageClassification: 'microsoft/resnet-50',
  objectDetection: 'facebook/detr-resnet-50',
  imageToText: 'Salesforce/blip-image-captioning-base',
  faceDetection: 'faceDetection'  // 指向自訂的人臉偵測函數
};

// 載入的模型快取
const modelCache: Record<string, any> = {};

/**
 * 載入模型並快取
 */
async function loadModel(task: string, model: string): Promise<any> {
  const cacheKey = `${task}:${model}`;
  
  try {
    if (!modelCache[cacheKey]) {
      console.log(`載入模型: ${model} (${task})`);
      modelCache[cacheKey] = await pipeline(task, model);
    }
    return modelCache[cacheKey];
  } catch (error) {
    throw errorHandler.handleError(
      error as Error,
      ErrorType.RESOURCE_UNAVAILABLE_ERROR,
      `無法載入模型 ${model}`,
      false
    );
  }
}

/**
 * 執行圖片分類
 */
async function classifyImage(imageUrl: string): Promise<string[]> {
  try {
    const classifier = await loadModel('image-classification', MODEL_CONFIG.imageClassification);
    const results = await classifier(imageUrl, { topk: 5 });
    return results.map((r: any) => ({ label: r.label, score: r.score }))
      .filter((r: any) => r.score > 0.1)
      .map((r: any) => r.label);
  } catch (error) {
    console.error('圖片分類失敗:', error);
    return [];
  }
}

/**
 * 偵測圖片中的物件
 */
async function detectObjects(imageUrl: string): Promise<string[]> {
  try {
    const detector = await loadModel('object-detection', MODEL_CONFIG.objectDetection);
    const results = await detector(imageUrl);
    
    // 提取唯一的標籤
    const uniqueTags = new Set<string>();
    for (const obj of results) {
      if (obj.score > 0.5) {
        uniqueTags.add(obj.label);
      }
    }
    
    return Array.from(uniqueTags);
  } catch (error) {
    console.error('物件偵測失敗:', error);
    return [];
  }
}

/**
 * 生成圖片的描述文字
 */
async function generateImageCaption(imageUrl: string): Promise<string[]> {
  try {
    const captioner = await loadModel('image-to-text', MODEL_CONFIG.imageToText);
    const result = await captioner(imageUrl);
    
    // 結果可能是單一字串或陣列
    const captions = Array.isArray(result) 
      ? result.map((item: any) => item.generated_text)
      : [result.generated_text];
      
    return captions;
  } catch (error) {
    console.error('圖片描述生成失敗:', error);
    return [];
  }
}

/**
 * 使用 Canvas API 偵測人臉
 * 注意：這是簡化的人臉偵測，僅作示範，實際應用建議使用更精確的模型
 */
async function detectFaces(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      // 建立離屏 Canvas
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        console.error('無法創建 Canvas 上下文');
        resolve(0);
        return;
      }
      
      img.onload = () => {
        // 設定 Canvas 尺寸
        canvas.width = img.width;
        canvas.height = img.height;
        
        // 繪製圖片到 Canvas
        ctx.drawImage(img, 0, 0);
        
        // 這裡將返回 0，因為這只是一個簡化的示範
        // 真實的人臉偵測需要使用專門的模型或 API
        resolve(0);
      };
      
      img.onerror = () => {
        console.error('圖片載入失敗');
        resolve(0);
      };
      
      img.crossOrigin = 'anonymous';
      img.src = imageUrl;
    } catch (error) {
      console.error('人臉偵測失敗:', error);
      resolve(0);
    }
  });
}

/**
 * 分析圖片並返回綜合結果
 */
export async function analyzeImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // 並行執行所有分析
    const [categories, tags, captions, faces] = await Promise.all([
      classifyImage(imageUrl),
      detectObjects(imageUrl),
      generateImageCaption(imageUrl),
      detectFaces(imageUrl)
    ]);
    
    return {
      categories: categories.slice(0, 3),  // 只保留前 3 個類別
      tags: tags,
      scenes: captions,
      faces: faces,
      confidence: {
        category: 0.8,  // 這些是預設值，實際應用中應從模型結果中獲取
        tags: 0.7,
        scene: 0.6
      }
    };
  } catch (error) {
    errorHandler.handleError(
      error as Error,
      ErrorType.PHOTO_PROCESSING_ERROR,
      '照片分析失敗',
      false
    );
    
    // 返回空結果
    return {
      categories: [],
      tags: [],
      scenes: [],
      faces: 0,
      confidence: {
        category: 0,
        tags: 0,
        scene: 0
      }
    };
  }
}

/**
 * 批次分析多張照片
 * @param photos 照片檔案陣列
 * @param progressCallback 進度回調
 * @param signal AbortSignal 用於取消操作
 */
export async function batchAnalyzePhotos(
  photos: PhotoFile[], 
  progressCallback?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Map<string, ImageAnalysisResult>> {
  const results = new Map<string, ImageAnalysisResult>();
  const total = photos.length;
  
  try {
    // 每次處理的批次大小
    const batchSize = 3;
    
    for (let i = 0; i < total; i += batchSize) {
      // 檢查是否取消
      if (signal?.aborted) {
        throw new Error('操作已取消');
      }
      
      // 取得當前批次
      const batch = photos.slice(i, i + batchSize);
      
      // 並行處理當前批次
      const batchPromises = batch.map(async photo => {
        const result = await analyzeImage(photo.preview);
        results.set(photo.id, result);
      });
      
      await Promise.all(batchPromises);
      
      // 更新進度
      if (progressCallback) {
        progressCallback(Math.round((i + batch.length) / total * 100));
      }
    }
    
    return results;
  } catch (error) {
    errorHandler.handleError(
      error as Error,
      ErrorType.PHOTO_PROCESSING_ERROR,
      '批次照片分析失敗',
      true,
      () => batchAnalyzePhotos(photos, progressCallback)
    );
    
    return results;  // 返回已處理的結果
  }
}

/**
 * 預熱模型載入
 */
export async function preloadModels(): Promise<void> {
  try {
    // 在背景中預載入模型
    Promise.all([
      loadModel('image-classification', MODEL_CONFIG.imageClassification),
      loadModel('object-detection', MODEL_CONFIG.objectDetection),
      loadModel('image-to-text', MODEL_CONFIG.imageToText)
    ]).then(() => {
      console.log('模型預載完成');
    }).catch(error => {
      console.error('模型預載失敗:', error);
    });
  } catch (error) {
    console.error('模型預載初始化失敗:', error);
  }
}