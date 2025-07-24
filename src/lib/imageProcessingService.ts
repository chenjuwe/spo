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
const getOptimalWorkerCount = (): number => {
  // 獲取設備邏輯核心數量 (如果可用)
  const cpuCores = navigator.hardwareConcurrency || 4;
  // 保留至少1個核心給UI執行緒，但至少使用2個工作者
  return Math.max(2, Math.min(cpuCores - 1, 8)); // 設置上限為8個工作者
};

// 最大工作者數量
export const MAX_WORKERS = getOptimalWorkerCount();
console.info(`初始化 ${MAX_WORKERS} 個工作者線程...`);

// 定義工作者池項目類型
interface WorkerPoolItem {
  worker: Worker;
  busy: boolean;
  taskId: string | null; // 追蹤當前任務ID
  lastUsed: number; // 記錄最後使用時間
}

const workerPool: WorkerPoolItem[] = [];

// 初始化工作者池
for (let i = 0; i < MAX_WORKERS; i++) {
  workerPool.push({
    worker: new ImageWorker(),
    busy: false,
    taskId: null,
    lastUsed: Date.now()
  });
}

// 工作者分配請求隊列
const workerRequestQueue: Array<{
  resolve: (worker: Worker) => void;
  priority: number;
  timestamp: number;
  taskSize?: number; // 任務大小估計（例如文件大小）
}> = [];

// 獲取可用的工作者 - 使用優先級和等待隊列
function getAvailableWorker(priority: number = 0, taskSize?: number): Promise<Worker> {
  return new Promise((resolve) => {
    // 檢查是否有空閒工作者
    const availableWorker = workerPool
      .filter(w => !w.busy)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0]; // 優先使用最久未使用的工作者
    
    if (availableWorker) {
      availableWorker.busy = true;
      availableWorker.lastUsed = Date.now();
      resolve(availableWorker.worker);
      return;
    }
    
    // 如果沒有空閒工作者，將請求加入等待隊列
    const request = {
      resolve,
      priority,
      timestamp: Date.now(),
      taskSize // 允許 undefined 類型
    };
    
    workerRequestQueue.push(request);
    
    // 優化任務隊列排序
    // 1. 高優先級任務優先處理
    // 2. 較小的任務優先處理（如果優先級相同）
    // 3. 等待時間較長的任務優先處理（如果優先級和大小都相似）
    workerRequestQueue.sort((a, b) => {
      // 首先按優先級排序（高優先級優先）
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      
      // 如果優先級相同，根據任務大小排序（較小任務優先）
      if (a.taskSize !== undefined && b.taskSize !== undefined && 
          Math.abs(a.taskSize - b.taskSize) > 1024 * 100) { // 100KB 的差異被視為顯著
        return a.taskSize - b.taskSize;
      }
      
      // 如果優先級和大小相似，按等待時間排序（等待時間長的優先）
      return a.timestamp - b.timestamp;
    });
  });
}

// 釋放工作者
function releaseWorker(worker: Worker, taskId?: string | null) {
  const poolWorker = workerPool.find(w => w.worker === worker);
  if (poolWorker) {
    // 確保正在釋放的是當前任務的工作者
    if (!taskId || poolWorker.taskId === taskId) {
      poolWorker.busy = false;
      poolWorker.taskId = null;
      poolWorker.lastUsed = Date.now();
      
      // 檢查等待隊列，如果有等待的請求，立即分配工作者
      if (workerRequestQueue.length > 0) {
        const nextRequest = workerRequestQueue.shift();
        if (nextRequest) {
          poolWorker.busy = true;
          nextRequest.resolve(poolWorker.worker);
        }
      }
    }
  }
}

// 定期清理長時間未完成的任務 (每30秒執行一次)
setInterval(() => {
  const now = Date.now();
  const MAX_TASK_DURATION = 60000; // 60秒超時時間
  
  for (const worker of workerPool) {
    if (worker.busy && (now - worker.lastUsed > MAX_TASK_DURATION)) {
      console.warn('檢測到長時間運行的工作者任務，強制釋放');
      worker.busy = false;
      worker.taskId = null;
    }
  }
}, 30000);

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

// 執行工作者任務，支援取消、優先級和超時
export function runWorkerTask<T>(
  task: string,
  file: File,
  options?: ProcessingTaskOptions & { 
    priority?: number;
    timeout?: number;
  }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const taskId = Math.random().toString(36).substr(2, 9);
    const priority = options?.priority || 0;
    const timeout = options?.timeout || 30000; // 預設30秒超時
    
    // 建立超時處理器
    let timeoutId: number | null = null;
    
    // 建立任務完成標記
    let isCompleted = false;
    
    // 設置取消處理
    const abortController = { aborted: options?.signal?.aborted || false };
    
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        abortController.aborted = true;
        
        if (!isCompleted) {
          isCompleted = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          reject(new DOMException('操作已取消', 'AbortError'));
        }
      });
    }
    
    // 獲取工作者
    getAvailableWorker(priority)
      .then(worker => {
        const poolWorker = workerPool.find(w => w.worker === worker);
        if (poolWorker) {
          poolWorker.taskId = taskId || null;
        }
        
        // 設置超時處理
        if (timeout > 0) {
          timeoutId = window.setTimeout(() => {
            if (!isCompleted) {
              isCompleted = true;
              console.warn(`任務 ${taskId} (${task}) 執行超時`);
              releaseWorker(worker, taskId);
              reject(new Error('任務執行超時'));
            }
          }, timeout);
        }
        
        const handler = (e: MessageEvent) => {
          if (e.data.id === taskId) {
            worker.removeEventListener("message", handler);
            
            if (!isCompleted) {
              isCompleted = true;
              if (timeoutId !== null) {
                clearTimeout(timeoutId);
              }
              
              // 釋放工作者
              releaseWorker(worker, taskId);
              
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
          }
        };
        
        worker.addEventListener("message", handler);
        
        // 使用較小的塊來傳輸數據，避免大文件傳輸導致主線程阻塞
        // 對於較大的文件(>5MB)，使用轉換後的 Blob URL
        if (file.size > 5 * 1024 * 1024) {
          const fileUrl = URL.createObjectURL(file);
          worker.postMessage({ 
            task, 
            fileUrl, 
            id: taskId, 
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            useFileUrl: true
          });
          
          // 在任務完成後移除 URL
          const originalHandler = handler;
          worker.removeEventListener("message", originalHandler);
          worker.addEventListener("message", (e) => {
            originalHandler(e);
            if (e.data.id === taskId) {
              URL.revokeObjectURL(fileUrl);
            }
          });
        } else {
          worker.postMessage({ task, file, id: taskId });
        }
      })
      .catch(error => {
        if (!isCompleted) {
          isCompleted = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          reject(error);
        }
      });
  });
}

// 處理多個任務，帶進度報告、錯誤處理和記憶體優化
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
    // 自適應批次大小 - 根據照片大小和數量動態調整
    const averagePhotoSize = photos.reduce((sum, photo) => sum + photo.file.size, 0) / photos.length;
    const adaptiveBatchSize = Math.max(
      1, 
      Math.min(
        batchSize,
        // 如果照片平均大小超過 2MB，則減小批次大小
        averagePhotoSize > 2 * 1024 * 1024 ? Math.floor(batchSize / 2) : batchSize,
        // 限制最大並行數
        navigator.hardwareConcurrency || 4
      )
    );
    
    console.log(`處理 ${photos.length} 張照片，每批 ${adaptiveBatchSize} 張，平均大小: ${(averagePhotoSize / 1024 / 1024).toFixed(1)}MB`);
    
    // 分批處理
    for (let i = 0; i < photos.length; i += adaptiveBatchSize) {
      if (cancelled) {
        throw new DOMException('操作已取消', 'AbortError');
      }
      
      const batch = photos.slice(i, i + adaptiveBatchSize);
      const batchPromises = batch.map(photo => {
        // 動態調整任務優先級和超時時間
        const priority = photo.file.size > 5 * 1024 * 1024 ? 2 : 1; // 較大文件獲得更高優先級
        const timeout = Math.max(30000, photo.file.size / 1024); // 按文件大小設置超時
        
        return runWorkerTask<T>(
          taskName, 
          photo.file, 
          {
            ...options,
            priority,
            timeout
          }
        )
        .then(result => {
          results.set(photo.id, result);
          return { success: true, id: photo.id };
        })
        .catch(err => {
          console.error(`處理照片失敗 (${photo.file.name}):`, err);
          results.set(photo.id, null);
          failedItems.push(photo);
          return { success: false, id: photo.id, error: err };
        });
      });
      
      // 等待當前批次完成
      await Promise.allSettled(batchPromises);
      
      // 進度報告
      processedItems += batch.length;
      const progress = Math.round((processedItems / totalItems) * 100);
      
      if (options?.onProgress) {
        options.onProgress(progress);
      }
      
      // 批次間休息，給瀏覽器時間進行垃圾回收
      if (i + adaptiveBatchSize < photos.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 手動觸發垃圾回收 (僅適用於調試)
        if (window.gc) {
          try {
            window.gc();
          } catch (e) {
            // 忽略錯誤
          }
        } else {
          // 幫助觸發垃圾回收
          const largeArray = new Array(1000).fill(0);
          largeArray.length = 0;
        }
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
    // 釋放記憶體
    for (const photo of photos) {
      if (photo.preview && !photo.preview.startsWith('data:')) {
        try {
          URL.revokeObjectURL(photo.preview);
        } catch (e) {
          console.warn('釋放資源失敗:', e);
        }
      }
    }
    
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
      try {
        await hashCache.storeMultiHash(photo.file, hashes);
      } catch (e) {
        console.warn('緩存哈希失敗:', e);
      }
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
  // 檢查是否已取消
  if (options?.signal?.aborted) {
    return Promise.reject(new DOMException('操作已取消', 'AbortError'));
  }
  
  return new Promise((resolve, reject) => {
    try {
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

// 批量處理優化的輔助函數
/**
 * 對照片進行分組批處理，以優化內存和CPU使用
 * @param photos 照片數組
 * @param processFunction 處理函數
 * @param options 處理選項
 * @returns 批處理結果
 */
export async function optimizedBatchProcess<T>(
  photos: PhotoFile[],
  processFunction: (batch: PhotoFile[], opts?: ProcessingTaskOptions) => Promise<T[]>,
  options?: ProcessingTaskOptions
): Promise<T[]> {
  // 獲取優化的批處理大小
  const { optimalBatchSize, estimatedDelay } = calculateOptimalBatchParams(photos);
  
  // 根據照片大小和複雜度進行優化分組
  const batches = optimizePhotoBatches(photos, optimalBatchSize);
  
  const results: T[] = [];
  let processedCount = 0;
  
  // 處理每個批次
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    // 檢查是否被取消
    if (options?.signal?.aborted) {
      throw new DOMException('操作已取消', 'AbortError');
    }
    
    try {
      // 處理當前批次
      const batchResults = await processFunction(batch, {
        ...options,
        onProgress: (progress) => {
          if (options?.onProgress) {
            // 計算整體進度
            const overallProgress = Math.round(
              (processedCount + batch.length * (progress / 100)) / photos.length * 100
            );
            options.onProgress(overallProgress);
          }
        }
      });
      
      results.push(...batchResults);
      processedCount += batch.length;
      
      // 報告批次完成
      console.log(`批次 ${i+1}/${batches.length} 已完成，處理了 ${batch.length} 張照片，總進度: ${Math.round(processedCount/photos.length*100)}%`);
      
      // 批次間延遲，給瀏覽器時間進行垃圾回收
      if (i < batches.length - 1) {
        const delay = Math.max(50, Math.min(300, estimatedDelay));
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // 觸發垃圾回收（如果可用）
        if (window.gc) {
          try {
            window.gc();
          } catch (e) {
            // 忽略錯誤
          }
        }
      }
    } catch (error) {
      console.error(`處理批次 ${i+1} 時發生錯誤:`, error);
      if (options?.onError) {
        options.onError(error as Error);
      }
    }
  }
  
  return results;
}

/**
 * 計算最佳批處理參數
 * @param photos 照片數組
 * @returns 最佳批量大小和建議延遲
 */
function calculateOptimalBatchParams(photos: PhotoFile[]): {
  optimalBatchSize: number;
  estimatedDelay: number;
} {
  const avgPhotoSize = photos.reduce((sum, p) => sum + p.file.size, 0) / photos.length;
  const cpuCores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as any).deviceMemory || 4; // 假設 4GB
  
  // 基於文件大小和設備能力計算最佳批大小
  let baseBatchSize = Math.max(1, Math.min(20, Math.floor(cpuCores * 1.5)));
  
  // 根據平均照片大小調整（大照片需要更小的批次）
  if (avgPhotoSize > 5 * 1024 * 1024) { // > 5MB
    baseBatchSize = Math.max(1, Math.floor(baseBatchSize * 0.5));
  } else if (avgPhotoSize > 2 * 1024 * 1024) { // > 2MB
    baseBatchSize = Math.max(1, Math.floor(baseBatchSize * 0.7));
  }
  
  // 根據可用內存調整
  if (memory < 4) {
    baseBatchSize = Math.max(1, Math.floor(baseBatchSize * 0.6));
  } else if (memory > 8) {
    baseBatchSize = Math.floor(baseBatchSize * 1.3);
  }
  
  // 計算批次間估計延遲（較大批次需要更長的延遲）
  const estimatedDelay = Math.round(50 + (avgPhotoSize / (1024 * 1024)) * 10);
  
  return {
    optimalBatchSize: baseBatchSize,
    estimatedDelay
  };
}

/**
 * 優化照片批處理分組
 * @param photos 照片數組
 * @param batchSize 目標批大小
 * @returns 優化的批次數組
 */
function optimizePhotoBatches(photos: PhotoFile[], batchSize: number): PhotoFile[][] {
  // 首先根據文件大小進行排序
  const sortedPhotos = [...photos].sort((a, b) => {
    // 優先處理較小的文件
    return a.file.size - b.file.size;
  });
  
  const batches: PhotoFile[][] = [];
  let currentBatch: PhotoFile[] = [];
  let currentBatchSize = 0;
  const targetBatchByteSize = 10 * 1024 * 1024; // 目標每批次10MB總大小
  
  for (const photo of sortedPhotos) {
    // 如果當前批次已滿或添加此照片會超過目標大小，創建新批次
    if (currentBatch.length >= batchSize || 
        (currentBatchSize > 0 && currentBatchSize + photo.file.size > targetBatchByteSize)) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchSize = 0;
    }
    
    // 添加照片到當前批次
    currentBatch.push(photo);
    currentBatchSize += photo.file.size;
  }
  
  // 添加最後一個批次（如果有）
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}

// 向量化操作的批量哈希比較
/**
 * 向量化批量哈希比較
 * @param baseHashes 基準哈希數組
 * @param compareHashes 比較哈希數組
 * @returns 相似度矩陣
 */
export async function batchCompareHashes(
  baseHashes: HashResult[],
  compareHashes: HashResult[]
): Promise<number[][]> {
  // 準備結果矩陣
  const result: number[][] = Array(baseHashes.length)
    .fill(null)
    .map(() => Array(compareHashes.length).fill(0));
  
  // 使用 WebAssembly 進行並行處理（如果可用）
  const useWasm = await initializeWasmModule();
  
  // 預處理哈希值以便批量處理
  const processedBaseHashes = baseHashes.map(processHashForBatchCompare);
  const processedCompareHashes = compareHashes.map(processHashForBatchCompare);
  
  // 對每種哈希類型進行批量比較
  for (let i = 0; i < baseHashes.length; i++) {
    for (let j = 0; j < compareHashes.length; j++) {
      // 計算加權相似度
      const similarity = await computeHashSimilarity(
        processedBaseHashes[i],
        processedCompareHashes[j],
        useWasm
      );
      
      result[i][j] = similarity;
    }
  }
  
  return result;
}

/**
 * 處理哈希以進行批量比較
 */
function processHashForBatchCompare(hash: HashResult): {
  pHash?: Uint8Array;
  dHash?: Uint8Array;
  aHash?: Uint8Array;
  validTypes: string[];
} {
  const result: {
    pHash?: Uint8Array;
    dHash?: Uint8Array;
    aHash?: Uint8Array;
    validTypes: string[];
  } = {
    validTypes: []
  };
  
  // 將十六進制哈希轉換為二進制數組以加速比較
  if (hash.pHash) {
    result.pHash = hexToUint8Array(hash.pHash);
    result.validTypes.push('pHash');
  }
  
  if (hash.dHash) {
    result.dHash = hexToUint8Array(hash.dHash);
    result.validTypes.push('dHash');
  }
  
  if (hash.aHash) {
    result.aHash = hexToUint8Array(hash.aHash);
    result.validTypes.push('aHash');
  }
  
  return result;
}

/**
 * 將十六進制字符串轉換為 Uint8Array
 * @param hex 十六進制字符串
 * @returns Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * 初始化 WebAssembly 模塊
 */
async function initializeWasmModule(): Promise<boolean> {
  try {
    // 嘗試從 wasmHashCompare.ts 中導入 initializeModule 函數
    const { initializeModule } = await import('./wasmHashCompare');
    return await initializeModule();
  } catch (error) {
    console.warn('無法初始化 WebAssembly 模塊，將使用 JavaScript 實現:', error);
    return false;
  }
}

/**
 * 計算兩個處理過的哈希的相似度
 */
async function computeHashSimilarity(
  hash1: {
    pHash?: Uint8Array;
    dHash?: Uint8Array;
    aHash?: Uint8Array;
    validTypes: string[];
  },
  hash2: {
    pHash?: Uint8Array;
    dHash?: Uint8Array;
    aHash?: Uint8Array;
    validTypes: string[];
  },
  useWasm: boolean
): Promise<number> {
  // 默認權重
  const weights = {
    pHash: 0.5,
    dHash: 0.3,
    aHash: 0.2
  };
  
  let totalWeight = 0;
  let weightedDistance = 0;
  
  // 比較每種可用的哈希類型
  for (const type of hash1.validTypes) {
    if (hash2.validTypes.includes(type)) {
      // 確保類型安全訪問
      const h1Array = hash1[type as keyof typeof hash1];
      const h2Array = hash2[type as keyof typeof hash2];
      
      if (h1Array && h2Array) {
        const h1 = h1Array as Uint8Array;
        const h2 = h2Array as Uint8Array;
      
        // 計算距離
        let distance;
        if (useWasm) {
          try {
            const { calculateHammingDistanceSync } = await import('./wasmHashCompare');
            // 需要將 Uint8Array 轉換回十六進制字符串，因為 wasmHashCompare 接受字符串
            distance = calculateHammingDistanceSync(
              uint8ArrayToHex(h1),
              uint8ArrayToHex(h2)
            );
          } catch (e) {
            distance = hammingDistance(h1, h2);
          }
        } else {
          distance = hammingDistance(h1, h2);
        }
        
        // 權重
        const typeWeight = weights[type as keyof typeof weights] || 0.33;
        weightedDistance += distance * typeWeight;
        totalWeight += typeWeight;
      }
    }
  }
  
  if (totalWeight === 0) return 0;
  
  // 歸一化加權距離
  const avgDistance = weightedDistance / totalWeight;
  
  // 估算最大距離（基於哈希長度）
  const maxDistance = 64; // 假設平均16字節的哈希 (16 bytes = 128 bits)
  
  // 計算相似度百分比
  const similarity = 100 * (1 - avgDistance / maxDistance);
  
  // 確保結果在 0-100 範圍內
  return Math.max(0, Math.min(100, similarity));
}

/**
 * 計算兩個 Uint8Array 之間的漢明距離
 */
function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  let distance = 0;
  
  for (let i = 0; i < length; i++) {
    const xor = a[i] ^ b[i];
    // 計算設置的位數
    distance += countBits(xor);
  }
  
  // 添加剩餘字節的距離
  for (let i = length; i < a.length; i++) {
    distance += countBits(a[i]);
  }
  
  for (let i = length; i < b.length; i++) {
    distance += countBits(b[i]);
  }
  
  return distance;
}

/**
 * 計算字節中設置的位數
 */
function countBits(byte: number): number {
  // 使用查表法快速計算
  return (byte & 0x0F ? 1 : 0) + 
         (byte & 0x0F & 0x01 ? 1 : 0) + 
         (byte & 0x0F & 0x02 ? 1 : 0) + 
         (byte & 0x0F & 0x04 ? 1 : 0) + 
         (byte & 0x0F & 0x08 ? 1 : 0) + 
         (byte & 0xF0 ? 1 : 0) + 
         (byte & 0xF0 & 0x10 ? 1 : 0) + 
         (byte & 0xF0 & 0x20 ? 1 : 0) + 
         (byte & 0xF0 & 0x40 ? 1 : 0) + 
         (byte & 0xF0 & 0x80 ? 1 : 0);
}

/**
 * 將 Uint8Array 轉換為十六進制字符串
 */
function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
} 