import { toast } from "sonner";
import heic2any from "heic2any";
import { 
  PhotoFile, 
  ImageQuality, 
  SimilarityGroup,
  ProcessingTaskOptions,
  HashResult,
  SimilarityThresholds
} from "./types";
import {
  calculateSimilarity,
  calculateHammingDistance,
  calculateWeightedSimilarity,
  calculateAdjustedSimilarity,
  LSHIndex,
  cosineSimilarity
} from "./utils";
import { hashCache } from "./hashCacheService";
import ImageWorker from "./imageWorker.ts?worker&inline";

// 工作者池管理
const MAX_WORKERS = 4;
const workerPool: Array<{
  worker: Worker;
  busy: boolean;
}> = [];

// 初始化工作者池
for (let i = 0; i < MAX_WORKERS; i++) {
  workerPool.push({
    worker: new ImageWorker(),
    busy: false
  });
}

// 獲取可用的工作者
function getAvailableWorker(): Promise<Worker> {
  return new Promise((resolve) => {
    // 檢查是否有空閒工作者
    const availableWorker = workerPool.find(w => !w.busy);
    if (availableWorker) {
      availableWorker.busy = true;
      resolve(availableWorker.worker);
      return;
    }
    
    // 如果沒有空閒工作者，等待並重試
    const checkInterval = setInterval(() => {
      const worker = workerPool.find(w => !w.busy);
      if (worker) {
        clearInterval(checkInterval);
        worker.busy = true;
        resolve(worker.worker);
      }
    }, 100);
  });
}

// 釋放工作者
function releaseWorker(worker: Worker) {
  const poolWorker = workerPool.find(w => w.worker === worker);
  if (poolWorker) {
    poolWorker.busy = false;
  }
}

// 處理 HEIC 檔案
export async function convertHeicToJpeg(file: File, options?: ProcessingTaskOptions): Promise<File> {
  if (!(file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic"))) {
    return file;
  }
  
  try {
    const blob = await heic2any({ 
      blob: file, 
      toType: "image/jpeg", 
      quality: 0.95 
    });
    
    // 處理陣列或單一 blob
    const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
    const jpegFile = new File(
      [jpegBlob], 
      file.name.replace(/\.heic$/i, ".jpg"), 
      { type: "image/jpeg" }
    );
    return jpegFile;
  } catch (error) {
    const errorMsg = `HEIC 轉換失敗: ${file.name}`;
    
    if (options?.onError) {
      options.onError(new Error(errorMsg));
    }
    
    toast.error(errorMsg);
    throw new Error(errorMsg);
  }
}

// 執行工作者任務，支援取消
export function runWorkerTask<T>(
  task: string,
  file: File,
  options?: ProcessingTaskOptions
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    try {
      const worker = await getAvailableWorker();
      const id = Math.random().toString(36).substr(2, 9);
      
      // 設置取消處理
      const abortController = options?.signal ? 
        { aborted: false } : 
        { aborted: false };
        
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          abortController.aborted = true;
          releaseWorker(worker);
          reject(new DOMException('操作已取消', 'AbortError'));
        });
      }
      
      const handler = (e: MessageEvent) => {
        if (e.data.id === id) {
          worker.removeEventListener("message", handler);
          releaseWorker(worker);
          
          if (abortController.aborted) {
            reject(new DOMException('操作已取消', 'AbortError'));
            return;
          }
          
          if (e.data.error) {
            reject(new Error(e.data.error));
            return;
          }
          
          resolve(e.data.result);
        }
      };
      
      worker.addEventListener("message", handler);
      worker.postMessage({ task, file, id });
    } catch (error) {
      reject(error);
    }
  });
}

// 處理多個任務，帶進度報告和錯誤處理
export async function processBatchTasks<T>(
  photos: PhotoFile[],
  taskName: string,
  options?: ProcessingTaskOptions,
  batchSize = 5
): Promise<Map<string, T | null>> {
  const results = new Map<string, T | null>();
  const failedItems: PhotoFile[] = [];
  
  const totalItems = photos.length;
  let processedItems = 0;
  let cancelled = false;
  
  // 監聽取消信號
  if (options?.signal) {
    options.signal.addEventListener('abort', () => {
      cancelled = true;
    });
  }
  
  try {
    for (let i = 0; i < photos.length; i += batchSize) {
      if (cancelled) {
        throw new DOMException('操作已取消', 'AbortError');
      }
      
      const batch = photos.slice(i, i + batchSize);
      const batchPromises = batch.map(photo => 
        runWorkerTask<T>(taskName, photo.file, options)
          .then(result => {
            results.set(photo.id, result);
            return { success: true, id: photo.id };
          })
          .catch(err => {
            console.error(`處理照片失敗 (${photo.file.name}):`, err);
            results.set(photo.id, null);
            failedItems.push(photo);
            return { success: false, id: photo.id, error: err };
          })
      );
      
      await Promise.allSettled(batchPromises);
      
      processedItems += batch.length;
      const progress = Math.round((processedItems / totalItems) * 100);
      
      if (options?.onProgress) {
        options.onProgress(progress);
      }
    }
    
    // 如果所有項目都失敗了，報告錯誤
    if (failedItems.length === photos.length) {
      throw new Error(`無法處理任何照片，所有項目都失敗了`);
    }
    
    // 如果有部分失敗，提示用戶
    if (failedItems.length > 0) {
      toast.warning(`${failedItems.length} 張照片處理失敗，但其他照片已成功處理`);
    }
    
    return results;
  } catch (error) {
    if (options?.onError) {
      options.onError(error as Error);
    }
    throw error;
  } finally {
    if (options?.onComplete) {
      options.onComplete(results);
    }
  }
}

// 分析照片品質，帶錯誤處理和進度報告，使用緩存
export async function analyzePhotosQuality(
  photos: PhotoFile[],
  options?: ProcessingTaskOptions
): Promise<Map<string, ImageQuality | null>> {
  const results = new Map<string, ImageQuality | null>();
  const photosToProcess: PhotoFile[] = [];
  
  // 先檢查緩存中是否有數據
  for (const photo of photos) {
    const cachedQuality = await hashCache.getQuality(photo.file);
    if (cachedQuality) {
      results.set(photo.id, cachedQuality);
    } else {
      photosToProcess.push(photo);
    }
  }
  
  if (photosToProcess.length === 0) {
    return results;
  }
  
  // 計算進度百分比
  const calculateProgress = (processed: number) => {
    if (options?.onProgress) {
      const totalProgress = Math.round((
        ((photos.length - photosToProcess.length) * 100 + processed * photosToProcess.length / 100) / 
        photos.length
      ));
      options.onProgress(totalProgress);
    }
  };
  
  // 對未緩存的照片進行處理
  const customOptions = { 
    ...options, 
    onProgress: calculateProgress 
  };
  
  const newResults = await processBatchTasks<ImageQuality>(
    photosToProcess, 
    'analyzeImageQuality', 
    customOptions
  );
  
  // 存儲新結果到緩存
  for (const [id, quality] of newResults.entries()) {
    const photo = photos.find(p => p.id === id);
    if (photo && quality) {
      await hashCache.storeQuality(photo.file, quality);
      results.set(id, quality);
    } else if (photo) {
      results.set(id, null);
    }
  }
  
  return results;
}

// 計算照片感知哈希，使用緩存
export async function calculatePhotosHash(
  photos: PhotoFile[],
  options?: ProcessingTaskOptions
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const photosToProcess: PhotoFile[] = [];
  
  // 先檢查緩存中是否有數據
  for (const photo of photos) {
    const cachedHash = await hashCache.getHash(photo.file);
    if (cachedHash) {
      results.set(photo.id, cachedHash);
    } else {
      photosToProcess.push(photo);
    }
  }
  
  if (photosToProcess.length === 0) {
    return results;
  }
  
  // 計算進度百分比
  const calculateProgress = (processed: number) => {
    if (options?.onProgress) {
      const totalProgress = Math.round((
        ((photos.length - photosToProcess.length) * 100 + processed * photosToProcess.length / 100) / 
        photos.length
      ));
      options.onProgress(totalProgress);
    }
  };
  
  // 對未緩存的照片進行處理
  const customOptions = { 
    ...options, 
    onProgress: calculateProgress 
  };
  
  const newResults = await processBatchTasks<string>(
    photosToProcess, 
    'calculatePerceptualHash', 
    customOptions
  );
  
  // 存儲新結果到緩存
  for (const [id, hash] of newResults.entries()) {
    const photo = photos.find(p => p.id === id);
    if (photo && hash) {
      await hashCache.storeHash(photo.file, hash);
      results.set(id, hash);
    } else if (photo) {
      results.set(id, null);
    }
  }
  
  return results;
}

// 計算所有類型的哈希值，使用緩存
export async function calculatePhotosAllHashes(
  photos: PhotoFile[],
  options?: ProcessingTaskOptions
): Promise<Map<string, HashResult | null>> {
  const results = new Map<string, HashResult | null>();
  const photosToProcess: PhotoFile[] = [];
  
  // 先檢查緩存中是否有數據
  for (const photo of photos) {
    const cachedHashes = await hashCache.getMultiHash(photo.file);
    if (cachedHashes) {
      results.set(photo.id, cachedHashes);
    } else {
      photosToProcess.push(photo);
    }
  }
  
  if (photosToProcess.length === 0) {
    return results;
  }
  
  // 計算進度百分比
  const calculateProgress = (processed: number) => {
    if (options?.onProgress) {
      const totalProgress = Math.round((
        ((photos.length - photosToProcess.length) * 100 + processed * photosToProcess.length / 100) / 
        photos.length
      ));
      options.onProgress(totalProgress);
    }
  };
  
  // 對未緩存的照片進行處理
  const customOptions = { 
    ...options, 
    onProgress: calculateProgress 
  };
  
  const newResults = await processBatchTasks<HashResult>(
    photosToProcess, 
    'calculateAllHashes', 
    customOptions
  );
  
  // 存儲新結果到緩存
  for (const [id, hashes] of newResults.entries()) {
    const photo = photos.find(p => p.id === id);
    if (photo && hashes) {
      await hashCache.storeMultiHash(photo.file, hashes);
      results.set(id, hashes);
    } else if (photo) {
      results.set(id, null);
    }
  }
  
  return results;
}

// 添加重試機制的哈希計算，使用緩存
export async function calculatePhotoHashWithRetry(
  photo: PhotoFile,
  maxRetries = 3,
  options?: ProcessingTaskOptions
): Promise<string | null> {
  // 先檢查緩存
  const cachedHash = await hashCache.getHash(photo.file);
  if (cachedHash) {
    return cachedHash;
  }
  
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const hash = await runWorkerTask<string>(
        'calculatePerceptualHash', 
        photo.file,
        options
      );
      
      // 存儲到緩存
      if (hash) {
        await hashCache.storeHash(photo.file, hash);
      }
      
      return hash;
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        const errorMsg = `無法計算照片哈希 (${photo.file.name})，嘗試次數: ${retries}`;
        toast.error(errorMsg);
        if (options?.onError) {
          options.onError(new Error(errorMsg));
        }
        return null;
      }
      
      // 等待一下再重試
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return null;
}

// 添加重試機制的多哈希計算，使用緩存
export async function calculatePhotoAllHashesWithRetry(
  photo: PhotoFile,
  maxRetries = 3,
  options?: ProcessingTaskOptions
): Promise<HashResult | null> {
  // 先檢查緩存
  const cachedHashes = await hashCache.getMultiHash(photo.file);
  if (cachedHashes) {
    return cachedHashes;
  }
  
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const hashes = await runWorkerTask<HashResult>(
        'calculateAllHashes', 
        photo.file,
        options
      );
      
      // 存儲到緩存
      if (hashes) {
        await hashCache.storeMultiHash(photo.file, hashes);
      }
      
      return hashes;
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        const errorMsg = `無法計算照片哈希 (${photo.file.name})，嘗試次數: ${retries}`;
        toast.error(errorMsg);
        if (options?.onError) {
          options.onError(new Error(errorMsg));
        }
        return null;
      }
      
      // 等待一下再重試
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return null;
}

// 分段處理大量照片，解決記憶體問題
export async function processBatchWithMemoryManagement<T>(
  photos: PhotoFile[],
  processFunction: (batch: PhotoFile[], options?: ProcessingTaskOptions) => Promise<Map<string, T | null>>,
  options?: ProcessingTaskOptions,
  segmentSize = 20 // 每次處理的照片數量，避免記憶體不足
): Promise<Map<string, T | null>> {
  const results = new Map<string, T | null>();
  const totalBatches = Math.ceil(photos.length / segmentSize);
  
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    // 檢查是否取消
    if (options?.signal?.aborted) {
      throw new DOMException('操作已取消', 'AbortError');
    }
    
    // 獲取當前批次
    const start = batchIdx * segmentSize;
    const end = Math.min(start + segmentSize, photos.length);
    const currentBatch = photos.slice(start, end);
    
    // 計算分段進度
    const segmentOptions = {
      ...options,
      onProgress: (segmentProgress: number) => {
        if (options?.onProgress) {
          const overallProgress = Math.round(
            (batchIdx * segmentSize + (segmentProgress * segmentSize / 100)) / photos.length * 100
          );
          options.onProgress(overallProgress);
        }
      }
    };
    
    // 處理當前批次
    const batchResults = await processFunction(currentBatch, segmentOptions);
    
    // 合併結果
    for (const [id, result] of batchResults.entries()) {
      results.set(id, result);
    }
    
    // 顯式觸發垃圾回收（僅 Chrome/V8 調試時有效）
    if (window.gc) {
      window.gc();
    } else {
      // 幫助觸發垃圾回收
      const largeArray = new Array(100000).fill(0);
      largeArray.length = 0;
    }
    
    // 暫停一小段時間，讓瀏覽器有機會回收記憶體
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  
  return results;
}

// 分組相似照片，考慮對比度和亮度差異
export function groupSimilarPhotosWithAdjustment(
  photos: PhotoFile[],
  options?: ProcessingTaskOptions
): Promise<SimilarityGroup[]> {
  return new Promise(async (resolve, reject) => {
    try {
      if (options?.signal?.aborted) {
        throw new DOMException('操作已取消', 'AbortError');
      }
      
      const groups: SimilarityGroup[] = [];
      const processed = new Set<string>();
      
      // 計算進度用
      let processedPhotos = 0;
      
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('操作已取消', 'AbortError'));
        });
      }
      
      // 初始化局部敏感哈希索引
      const lshIndex = new LSHIndex(64, 4);
      
      // 構建 LSH 索引
      console.log('正在構建照片索引...');
      for (const photo of photos) {
        if (photo.hashes?.pHash) {
          lshIndex.addPhoto(photo.id, photo.hashes.pHash);
        }
      }
      
      try {
        for (let i = 0; i < photos.length; i++) {
          if (options?.signal?.aborted) {
            throw new DOMException('操作已取消', 'AbortError');
          }
          
          if (processed.has(photos[i].id) || !photos[i].hashes?.pHash) continue;
          
          const currentGroup: string[] = [photos[i].id];
          processed.add(photos[i].id);
          
          // 使用 LSH 獲取候選項
          const candidates = lshIndex.query(photos[i].hashes.pHash)
            .filter(id => !processed.has(id) && id !== photos[i].id);
          
          for (const candidateId of candidates) {
            const candidateIdx = photos.findIndex(p => p.id === candidateId);
            if (candidateIdx === -1) continue;
            
            const candidate = photos[candidateIdx];
            if (!candidate.hashes || !candidate.quality) continue;
            
            if (photos[i].quality && candidate.quality) {
              // 使用考慮亮度和對比度的相似度計算
              const similarity = calculateAdjustedSimilarity(
                photos[i].hashes,
                candidate.hashes,
                photos[i].quality.brightness,
                candidate.quality.brightness,
                photos[i].quality.contrast,
                candidate.quality.contrast
              );
              
              // 閾值設為80，可以根據需要調整
              if (similarity >= 80) {
                currentGroup.push(candidateId);
                processed.add(candidateId);
              }
            }
          }
          
          if (currentGroup.length > 1) {
            // 找出品質最好的照片
            const groupPhotos = photos.filter(p => currentGroup.includes(p.id));
            const bestPhoto = groupPhotos.reduce((best, current) => {
              const bestScore = best.quality?.score || 0;
              const currentScore = current.quality?.score || 0;
              return currentScore > bestScore ? current : best;
            });
            
            groups.push({
              id: Math.random().toString(36).substr(2, 9),
              photos: currentGroup,
              bestPhoto: bestPhoto.id,
              averageSimilarity: 80
            });
          }
          
          // 更新進度
          processedPhotos++;
          if (options?.onProgress) {
            const progress = Math.round((processedPhotos / photos.length) * 100);
            options.onProgress(progress);
          }
        }
        
        resolve(groups);
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') {
          reject(error);
        } else {
          console.error('分組照片時發生錯誤:', error);
          reject(new Error('分組照片時發生錯誤'));
        }
      }
    } catch (error) {
      reject(error);
    }
  });
} 