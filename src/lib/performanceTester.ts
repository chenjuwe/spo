import { hashCache } from './hashCacheService';
import { imageProcessingService } from './imageProcessingService';
import { ErrorType, errorHandler } from './errorHandlingService';

/**
 * 效能測試結果介面
 */
export interface PerformanceTestResult {
  name: string;
  duration: number;
  success: boolean;
  memoryUsage?: {
    before: number;
    after: number;
    diff: number;
  };
  details?: any;
  browser: string;
  timestamp: Date;
}

/**
 * 效能測試套件
 */
export class PerformanceTester {
  private results: PerformanceTestResult[] = [];
  private isRunning = false;
  private testQueue: (() => Promise<void>)[] = [];
  
  /**
   * 執行所有測試
   */
  async runAllTests(): Promise<PerformanceTestResult[]> {
    if (this.isRunning) {
      console.warn('測試已在進行中');
      return this.results;
    }
    
    this.isRunning = true;
    this.results = [];
    
    try {
      // 初始化測試環境
      await this.resetTestEnvironment();
      
      // 執行各個測試
      await this.testImageLoadingPerformance();
      await this.testHashingPerformance();
      await this.testCachePerformance();
      await this.testParallelProcessingPerformance();
      await this.testMemoryUsage();
      
      // 執行排隊的測試
      while (this.testQueue.length > 0) {
        const test = this.testQueue.shift();
        if (test) await test();
      }
      
      return this.results;
    } catch (error) {
      errorHandler.handleError(
        error as Error,
        ErrorType.SYSTEM_ERROR,
        '執行性能測試時出錯',
        false
      );
      return this.results;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * 重置測試環境
   */
  private async resetTestEnvironment(): Promise<void> {
    // 清空緩存
    try {
      await hashCache.pruneOldEntries(0); // 清除所有緩存項
    } catch (error) {
      console.warn('清空緩存時出錯:', error);
    }
    
    // 嘗試釋放記憶體
    if (window.gc) {
      try {
        window.gc();
      } catch (error) {
        console.warn('無法手動觸發垃圾回收:', error);
      }
    }
    
    // 等待一段時間讓系統穩定
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  /**
   * 測試圖像載入性能
   */
  private async testImageLoadingPerformance(): Promise<void> {
    const testResult: PerformanceTestResult = {
      name: '圖像載入效能測試',
      duration: 0,
      success: false,
      browser: navigator.userAgent,
      timestamp: new Date()
    };
    
    try {
      const startMemory = this.getMemoryUsage();
      const startTime = performance.now();
      
      // 創建測試圖像
      const imageSizes = [
        { width: 800, height: 600 },
        { width: 1600, height: 1200 },
        { width: 3200, height: 2400 }
      ];
      
      const testResults = [];
      
      for (const size of imageSizes) {
        const imageBlob = await this.createTestImage(size.width, size.height);
        const imageFile = new File([imageBlob], `test-${size.width}x${size.height}.jpg`, { type: 'image/jpeg' });
        
        const imageLoadStart = performance.now();
        const image = await this.loadImageFromFile(imageFile);
        const imageLoadTime = performance.now() - imageLoadStart;
        
        testResults.push({
          size: `${size.width}x${size.height}`,
          loadTime: imageLoadTime
        });
      }
      
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();
      
      testResult.duration = endTime - startTime;
      testResult.success = true;
      testResult.details = {
        imageResults: testResults
      };
      
      if (startMemory && endMemory) {
        testResult.memoryUsage = {
          before: startMemory,
          after: endMemory,
          diff: endMemory - startMemory
        };
      }
    } catch (error) {
      testResult.success = false;
      testResult.details = { error: (error as Error).message };
    }
    
    this.results.push(testResult);
  }
  
  /**
   * 測試哈希計算效能
   */
  private async testHashingPerformance(): Promise<void> {
    const testResult: PerformanceTestResult = {
      name: '哈希計算效能測試',
      duration: 0,
      success: false,
      browser: navigator.userAgent,
      timestamp: new Date()
    };
    
    try {
      const startMemory = this.getMemoryUsage();
      const startTime = performance.now();
      
      // 創建不同大小的測試圖像
      const imageBlob = await this.createTestImage(1200, 800);
      const imageFile = new File([imageBlob], 'test-hash.jpg', { type: 'image/jpeg' });
      
      // 測試不同類型的哈希算法
      const hashTypes = ['aHash', 'dHash', 'pHash'];
      const hashResults = [];
      
      for (const hashType of hashTypes) {
        const hashStart = performance.now();
        await imageProcessingService.runWorkerTask('calculateImageHash', imageFile, { hashType });
        const hashTime = performance.now() - hashStart;
        
        hashResults.push({
          hashType,
          time: hashTime
        });
      }
      
      // 測試多哈希計算
      const multiHashStart = performance.now();
      await imageProcessingService.runWorkerTask('calculateMultipleHashes', imageFile);
      const multiHashTime = performance.now() - multiHashStart;
      
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();
      
      testResult.duration = endTime - startTime;
      testResult.success = true;
      testResult.details = {
        individualHashResults: hashResults,
        multiHashTime
      };
      
      if (startMemory && endMemory) {
        testResult.memoryUsage = {
          before: startMemory,
          after: endMemory,
          diff: endMemory - startMemory
        };
      }
    } catch (error) {
      testResult.success = false;
      testResult.details = { error: (error as Error).message };
    }
    
    this.results.push(testResult);
  }
  
  /**
   * 測試緩存效能
   */
  private async testCachePerformance(): Promise<void> {
    const testResult: PerformanceTestResult = {
      name: '緩存效能測試',
      duration: 0,
      success: false,
      browser: navigator.userAgent,
      timestamp: new Date()
    };
    
    try {
      const startMemory = this.getMemoryUsage();
      const startTime = performance.now();
      
      // 生成測試數據
      const testData = {
        hash: '1234567890abcdef',
        hashes: {
          aHash: '1234567890abcdef',
          dHash: 'abcdef1234567890',
          pHash: '0987654321fedcba'
        },
        timestamp: Date.now(),
        fileSize: 1024 * 1024, // 1MB
        lastModified: Date.now()
      };
      
      // 測試緩存寫入
      const cacheWriteStart = performance.now();
      await hashCache.setHashData('test-item-1', testData);
      const cacheWriteTime = performance.now() - cacheWriteStart;
      
      // 測試緩存讀取 (未命中)
      const cacheMissStart = performance.now();
      const missResult = await hashCache.getHash({ name: 'not-exists', size: 1024, lastModified: Date.now() } as File);
      const cacheMissTime = performance.now() - cacheMissStart;
      
      // 測試緩存讀取 (命中)
      const cacheHitStart = performance.now();
      await hashCache.getHashData('test-item-1');
      const cacheHitTime = performance.now() - cacheHitStart;
      
      // 測試批量緩存操作
      const batchWriteStart = performance.now();
      for (let i = 0; i < 50; i++) {
        await hashCache.setHashData(`test-item-batch-${i}`, {
          ...testData,
          hash: `hash-${i}`
        });
      }
      const batchWriteTime = performance.now() - batchWriteStart;
      
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();
      
      testResult.duration = endTime - startTime;
      testResult.success = true;
      testResult.details = {
        cacheWriteTime,
        cacheMissTime,
        cacheHitTime,
        batchWriteTime,
        cacheStats: await hashCache.getCacheStats()
      };
      
      if (startMemory && endMemory) {
        testResult.memoryUsage = {
          before: startMemory,
          after: endMemory,
          diff: endMemory - startMemory
        };
      }
    } catch (error) {
      testResult.success = false;
      testResult.details = { error: (error as Error).message };
    }
    
    this.results.push(testResult);
  }
  
  /**
   * 測試並行處理效能
   */
  private async testParallelProcessingPerformance(): Promise<void> {
    const testResult: PerformanceTestResult = {
      name: '並行處理效能測試',
      duration: 0,
      success: false,
      browser: navigator.userAgent,
      timestamp: new Date()
    };
    
    try {
      const startMemory = this.getMemoryUsage();
      const startTime = performance.now();
      
      const testSizes = [8, 16, 32];
      const parallelResults = [];
      
      for (const batchSize of testSizes) {
        // 創建測試文件
        const files: File[] = [];
        for (let i = 0; i < batchSize; i++) {
          const imageBlob = await this.createTestImage(400, 300);
          const file = new File([imageBlob], `test-parallel-${i}.jpg`, { type: 'image/jpeg' });
          files.push(file);
        }
        
        // 測試不同並行度的處理性能
        const sequentialStart = performance.now();
        for (const file of files) {
          await imageProcessingService.runWorkerTask('analyzeImageQuality', file);
        }
        const sequentialTime = performance.now() - sequentialStart;
        
        const parallelStart = performance.now();
        const tasks = files.map(file => 
          imageProcessingService.runWorkerTask('analyzeImageQuality', file)
        );
        await Promise.all(tasks);
        const parallelTime = performance.now() - parallelStart;
        
        parallelResults.push({
          batchSize,
          sequentialTime,
          parallelTime,
          speedup: sequentialTime / parallelTime
        });
      }
      
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();
      
      testResult.duration = endTime - startTime;
      testResult.success = true;
      testResult.details = {
        parallelResults,
        workerCount: navigator.hardwareConcurrency || 'unknown'
      };
      
      if (startMemory && endMemory) {
        testResult.memoryUsage = {
          before: startMemory,
          after: endMemory,
          diff: endMemory - startMemory
        };
      }
    } catch (error) {
      testResult.success = false;
      testResult.details = { error: (error as Error).message };
    }
    
    this.results.push(testResult);
  }
  
  /**
   * 測試記憶體使用情況
   */
  private async testMemoryUsage(): Promise<void> {
    const testResult: PerformanceTestResult = {
      name: '記憶體使用測試',
      duration: 0,
      success: false,
      browser: navigator.userAgent,
      timestamp: new Date()
    };
    
    try {
      const startMemory = this.getMemoryUsage();
      const startTime = performance.now();
      
      // 創建一系列大圖像，觀察記憶體使用情況
      const memorySteps = [];
      const imageUrls: string[] = [];
      
      for (let i = 0; i < 10; i++) {
        const imageBlob = await this.createTestImage(1600, 1200);
        const imageUrl = URL.createObjectURL(imageBlob);
        imageUrls.push(imageUrl);
        
        const stepMemory = this.getMemoryUsage();
        memorySteps.push({
          step: i + 1,
          memory: stepMemory
        });
      }
      
      // 釋放資源
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      
      if (window.gc) {
        window.gc();
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const endTime = performance.now();
      const endMemory = this.getMemoryUsage();
      
      testResult.duration = endTime - startTime;
      testResult.success = true;
      testResult.details = {
        memorySteps,
        afterReleaseMemory: endMemory
      };
      
      if (startMemory && endMemory) {
        testResult.memoryUsage = {
          before: startMemory,
          after: endMemory,
          diff: endMemory - startMemory
        };
      }
    } catch (error) {
      testResult.success = false;
      testResult.details = { error: (error as Error).message };
    }
    
    this.results.push(testResult);
  }
  
  /**
   * 獲取當前記憶體使用量
   */
  private getMemoryUsage(): number | null {
    if (performance && (performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return null;
  }
  
  /**
   * 創建測試圖像
   */
  private async createTestImage(width: number, height: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    
    // 創建漸變背景
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'blue');
    gradient.addColorStop(0.5, 'green');
    gradient.addColorStop(1, 'red');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // 添加一些隨機形狀
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.5)`;
      ctx.beginPath();
      ctx.arc(
        Math.random() * width,
        Math.random() * height,
        Math.random() * 50 + 10,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    
    // 轉換為 Blob
    return new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/jpeg', 0.9);
    });
  }
  
  /**
   * 從文件加載圖像
   */
  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('載入圖像失敗'));
      };
      
      img.src = url;
    });
  }
  
  /**
   * 將測試結果匯出為 JSON
   */
  exportResults(): string {
    return JSON.stringify(this.results, null, 2);
  }
  
  /**
   * 獲取測試結果
   */
  getResults(): PerformanceTestResult[] {
    return [...this.results];
  }
  
  /**
   * 清除測試結果
   */
  clearResults(): void {
    this.results = [];
  }
}

// 聲明全局 gc 函數類型
declare global {
  interface Window {
    gc?: () => void;
  }
}

// 導出單例
export const performanceTester = new PerformanceTester(); 