/**
 * featureManager 單元測試
 * 測試 WebWorker 池和持久化存儲功能
 */

import { featureManager, FeatureManager } from './featureManager';
import { PhotoFile } from './types';
import { FeatureLevel } from './multiLevelFeatureFusion';

// 模擬 localStorage
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem: jest.fn((key: string) => mockLocalStorage.store[key] || null),
  setItem: jest.fn((key: string, value: string) => { mockLocalStorage.store[key] = value; }),
  removeItem: jest.fn((key: string) => { delete mockLocalStorage.store[key]; }),
  clear: jest.fn(() => { mockLocalStorage.store = {}; })
};

// 模擬 WebWorker
jest.mock('comlink', () => {
  return {
    wrap: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(true),
      extractHashFeatures: jest.fn().mockResolvedValue({
        aHash: '0123456789abcdef',
        dHash: 'fedcba9876543210',
        pHash: 'abcdef0123456789'
      }),
      calculateVectorSimilarity: jest.fn().mockResolvedValue(0.8),
      calculateBatchSimilarity: jest.fn().mockResolvedValue([0.8, 0.6, 0.9]),
      compressVector: jest.fn().mockImplementation(async (vector, ratio) => {
        const targetLength = Math.max(16, Math.round(vector.length * ratio));
        if (vector.length <= targetLength) return [...vector];
        
        const result = [];
        const step = vector.length / targetLength;
        for (let i = 0; i < targetLength; i++) {
          result.push(vector[Math.floor(i * step)]);
        }
        return result;
      })
    })),
    expose: jest.fn()
  };
});

// 模擬 Worker
jest.mock('worker-loader!./featureWorker.ts', () => {
  return jest.fn().mockImplementation(() => ({
    terminate: jest.fn()
  }));
});

// 測試前替換全局 localStorage
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});

// 創建測試用的照片
function createMockPhoto(id: string): PhotoFile {
  return {
    id,
    file: new File(['mock'], `photo-${id}.jpg`, { type: 'image/jpeg' }),
    preview: `data:image/jpeg;base64,mockbase64string-${id}`
  };
}

// 創建圖像數據
function createMockImageData(width = 10, height = 10): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  
  // 隨機填充像素數據
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.floor(Math.random() * 256);     // R
    data[i + 1] = Math.floor(Math.random() * 256); // G
    data[i + 2] = Math.floor(Math.random() * 256); // B
    data[i + 3] = 255;                             // A
  }
  
  return new ImageData(data, width, height);
}

describe('FeatureManager', () => {
  let manager: FeatureManager;
  
  beforeEach(() => {
    // 重置 localStorage 模擬
    mockLocalStorage.clear();
    
    // 創建新實例
    manager = new FeatureManager();
  });
  
  afterEach(async () => {
    // 釋放資源
    await manager.dispose();
  });
  
  test('should initialize successfully', async () => {
    const result = await manager.initialize(2);
    
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(true);
  });
  
  test('should not initialize twice', async () => {
    await manager.initialize(2);
    
    // @ts-expect-error 訪問私有屬性
    expect(manager.initialized).toBe(true);
    
    const result = await manager.initialize(2);
    expect(result.isOk()).toBe(true);
    
    // @ts-expect-error 訪問私有屬性
    expect(manager.workers.length).toBe(2);
  });
  
  test('should extract hash features', async () => {
    await manager.initialize(1);
    
    const imageData = createMockImageData();
    const result = await manager.extractHashFeatures(imageData);
    
    expect(result.isOk()).toBe(true);
    
    const hashResult = result.unwrap();
    expect(hashResult.aHash).toBeDefined();
    expect(hashResult.dHash).toBeDefined();
    expect(hashResult.pHash).toBeDefined();
  });
  
  test('should calculate similarity', async () => {
    await manager.initialize(1);
    
    const vector1 = [1, 2, 3, 4, 5];
    const vector2 = [5, 4, 3, 2, 1];
    
    const result = await manager.calculateSimilarity(vector1, vector2);
    
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeCloseTo(0.8);
  });
  
  test('should calculate batch similarity', async () => {
    await manager.initialize(1);
    
    const baseVector = [1, 2, 3, 4, 5];
    const vectors = [
      [5, 4, 3, 2, 1],
      [1, 1, 2, 2, 3],
      [1, 2, 3, 4, 5]
    ];
    
    const result = await manager.calculateBatchSimilarity(baseVector, vectors);
    
    expect(result.isOk()).toBe(true);
    
    const similarities = result.unwrap();
    expect(similarities.length).toBe(3);
    expect(similarities[0]).toBeCloseTo(0.8);
    expect(similarities[1]).toBeCloseTo(0.6);
    expect(similarities[2]).toBeCloseTo(0.9);
  });
  
  test('should compress vector', async () => {
    await manager.initialize(1);
    
    const vector = Array(100).fill(0).map((_, i) => i);
    const ratio = 0.2;
    
    const result = await manager.compressVector(vector, ratio);
    
    expect(result.isOk()).toBe(true);
    
    const compressed = result.unwrap();
    expect(compressed.length).toBe(20); // 100 * 0.2 = 20
  });
  
  test('should cache features', async () => {
    await manager.initialize(1);
    
    const photo = createMockPhoto('test1');
    const level = FeatureLevel.LOW;
    
    // 確保沒有緩存
    const initialCached = manager.getCachedFeature(photo, level);
    expect(initialCached).toBeNull();
    
    // 提取並緩存特徵
    const result = await manager.extractAndCacheFeature(photo, level);
    expect(result.isOk()).toBe(true);
    
    // 驗證已緩存
    const cached = manager.getCachedFeature(photo, level);
    expect(cached).not.toBeNull();
    expect(cached?.id).toBe('test1');
    expect(cached?.lowLevelFeatures).toBeDefined();
  });
  
  test('should use cached feature when available', async () => {
    await manager.initialize(1);
    
    const photo = createMockPhoto('test2');
    const level = FeatureLevel.LOW;
    
    // 第一次提取
    const firstResult = await manager.extractAndCacheFeature(photo, level);
    expect(firstResult.isOk()).toBe(true);
    
    // @ts-expect-error 訪問私有屬性
    const extractSpy = jest.spyOn(manager, 'extractLowLevelFeature');
    
    // 第二次提取應該使用緩存
    const secondResult = await manager.extractAndCacheFeature(photo, level);
    expect(secondResult.isOk()).toBe(true);
    
    // 確認沒有調用提取方法
    expect(extractSpy).not.toHaveBeenCalled();
    
    // 還原 spy
    extractSpy.mockRestore();
  });
  
  test('should force update when specified', async () => {
    await manager.initialize(1);
    
    const photo = createMockPhoto('test3');
    const level = FeatureLevel.LOW;
    
    // 第一次提取
    await manager.extractAndCacheFeature(photo, level);
    
    // @ts-expect-error 訪問私有屬性
    const extractSpy = jest.spyOn(manager, 'extractLowLevelFeature');
    
    // 強制更新
    await manager.extractAndCacheFeature(photo, level, { forceUpdate: true });
    
    // 確認調用了提取方法
    expect(extractSpy).toHaveBeenCalled();
    
    // 還原 spy
    extractSpy.mockRestore();
  });
  
  test('should clear cache', async () => {
    await manager.initialize(1);
    
    const photo = createMockPhoto('test4');
    const level = FeatureLevel.LOW;
    
    // 提取並緩存特徵
    await manager.extractAndCacheFeature(photo, level);
    expect(manager.getCachedFeature(photo, level)).not.toBeNull();
    
    // 清除緩存
    manager.clearCache();
    
    // 確認緩存已清除
    expect(manager.getCachedFeature(photo, level)).toBeNull();
  });
  
  test('should save and load cache from storage', async () => {
    await manager.initialize(1);
    
    const photo = createMockPhoto('test5');
    const level = FeatureLevel.LOW;
    
    // 提取並緩存特徵
    await manager.extractAndCacheFeature(photo, level);
    
    // 創建新實例，模擬重新加載頁面
    const newManager = new FeatureManager();
    await newManager.initialize(1);
    
    // 確認新實例加載了緩存
    const cached = newManager.getCachedFeature(photo, level);
    expect(cached).not.toBeNull();
    expect(cached?.id).toBe('test5');
    
    // 釋放資源
    await newManager.dispose();
  });
}); 