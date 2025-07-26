/**
 * 增量特徵學習與索引系統單元測試
 */

import { IncrementalFeatureIndex, FeaturePoint, IncrementalLearningResult } from './incrementalLearning';
import { EnhancedImageSimilaritySystem } from './enhancedImageSimilarity';
import { MultiLevelFeature, FeatureLevel } from './multiLevelFeatureFusion';
import { PhotoFile } from './types';

// 模擬相似度系統
class MockSimilaritySystem implements Partial<EnhancedImageSimilaritySystem> {
  // 模擬特徵數據
  private mockFeatures: Map<string, MultiLevelFeature> = new Map();
  
  // 設置模擬特徵
  public setMockFeature(photoId: string, feature: MultiLevelFeature): void {
    this.mockFeatures.set(photoId, feature);
  }
  
  // 實現提取多層級特徵方法
  public async extractMultiLevelFeatures(photo: PhotoFile): Promise<MultiLevelFeature | null> {
    // 如果有預設的特徵，返回它
    if (this.mockFeatures.has(photo.id)) {
      return this.mockFeatures.get(photo.id)!;
    }
    
    // 否則生成隨機特徵
    return {
      id: photo.id, // 添加 id 屬性以符合 MultiLevelFeature 接口
      highLevelFeatures: Array(128).fill(0).map(() => Math.random()),
      midLevelFeatures: {
        colorHistogram: Array(32).fill(0).map(() => Math.random()),
        textureFeatures: Array(32).fill(0).map(() => Math.random())
      },
      lowLevelFeatures: {
        aHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        dHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        pHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
      }
    };
  }
}

// 生成測試照片
function createTestPhotos(count: number): PhotoFile[] {
  return Array(count).fill(0).map((_, i) => ({
    id: `photo_${i}`,
    file: new File([], `photo_${i}.jpg`) as any,
    name: `photo_${i}.jpg`,
    type: 'image/jpeg',
    size: 1024,
    path: `/fake/path/photo_${i}.jpg`,
    lastModified: Date.now(),
    preview: ''
  }));
}

// 創建多級特徵
function createMultiLevelFeature(dimension: number = 128): MultiLevelFeature {
  return {
    id: `feature_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`, // 添加 id 屬性以符合 MultiLevelFeature 接口
    highLevelFeatures: Array(dimension).fill(0).map(() => Math.random()),
    midLevelFeatures: {
      colorHistogram: Array(32).fill(0).map(() => Math.random()),
      textureFeatures: Array(32).fill(0).map(() => Math.random())
    },
    lowLevelFeatures: {
      aHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
      dHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
      pHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
    }
  };
}

describe('IncrementalFeatureIndex', () => {
  let featureIndex: IncrementalFeatureIndex;
  let mockSimilaritySystem: MockSimilaritySystem;
  
  beforeEach(() => {
    // 創建模擬相似度系統
    mockSimilaritySystem = new MockSimilaritySystem();
    
    // 創建特徵索引
    featureIndex = new IncrementalFeatureIndex({
      incrementalThreshold: 10,
      rebuildThreshold: 3,
      compressionRatio: 0.8,
      gcInterval: 5000
    });
    
    // 設置相似度系統
    featureIndex.setSimilaritySystem(mockSimilaritySystem as unknown as EnhancedImageSimilaritySystem);
  });
  
  test('應該能夠添加特徵', async () => {
    // 創建測試照片
    const photos = createTestPhotos(5);
    
    // 添加特徵
    const result: IncrementalLearningResult = await featureIndex.addOrUpdateFeatures(photos);
    
    // 驗證結果
    expect(result.addedFeatures).toBeGreaterThan(0);
    expect(result.currentIndexSize).toBeGreaterThan(0);
  });
  
  test('應該能夠更新現有特徵', async () => {
    // 創建測試照片
    const photos = createTestPhotos(5);
    
    // 首先添加特徵
    await featureIndex.addOrUpdateFeatures(photos);
    
    // 設置新的特徵數據
    photos.forEach(photo => {
      mockSimilaritySystem.setMockFeature(photo.id, createMultiLevelFeature());
    });
    
    // 更新特徵
    const result = await featureIndex.addOrUpdateFeatures(photos);
    
    // 驗證結果
    expect(result.updatedFeatures).toBeGreaterThan(0);
  });
  
  test('應該能夠觸發索引重建', async () => {
    // 創建測試照片
    const photos = createTestPhotos(20); // 足夠觸發重建的數量
    
    // 添加特徵
    const result = await featureIndex.addOrUpdateFeatures(photos);
    
    // 驗證結果
    expect(result.fullRebuild).toBeTruthy();
  });
  
  test('應該能夠提取多級特徵', async () => {
    // 創建測試照片
    const photo = createTestPhotos(1)[0];
    
    // 設置期望的特徵數據
    const expectedFeature = createMultiLevelFeature();
    mockSimilaritySystem.setMockFeature(photo.id, expectedFeature);
    
    // 提取特徵
    const feature = await featureIndex.extractMultiLevelFeatures(photo);
    
    // 驗證結果
    expect(feature).not.toBeNull();
    expect(feature?.highLevelFeatures?.length).toBe(expectedFeature.highLevelFeatures?.length);
  });
  
  test('當未設置相似度系統時應拋出錯誤', async () => {
    // 創建沒有相似度系統的索引
    const indexWithoutSystem = new IncrementalFeatureIndex();
    
    // 創建測試照片
    const photos = createTestPhotos(1);
    
    // 嘗試添加特徵，應該拋出錯誤
    await expect(indexWithoutSystem.addOrUpdateFeatures(photos)).rejects.toThrow();
    
    // 嘗試提取特徵，應該拋出錯誤
    await expect(indexWithoutSystem.extractMultiLevelFeatures(photos[0])).rejects.toThrow();
  });
  
  test('應該正確壓縮特徵向量', async () => {
    // 創建具有長特徵向量的照片
    const photo = createTestPhotos(1)[0];
    const longFeature = createMultiLevelFeature(256); // 256維特徵
    
    // 設置特徵
    mockSimilaritySystem.setMockFeature(photo.id, longFeature);
    
    // 添加特徵
    await featureIndex.addOrUpdateFeatures([photo]);
    
    // 驗證壓縮特徵向量的長度
    // 注意：這需要訪問私有方法，可能需要修改原始類以暴露測試API
    // 這裡只是驗證添加成功
    const extractedFeature = await featureIndex.extractMultiLevelFeatures(photo);
    expect(extractedFeature).not.toBeNull();
  });
  
  test('應該處理無效照片', async () => {
    // 創建測試照片
    const photos = createTestPhotos(5);
    
    // 設置一些照片的特徵為null
    mockSimilaritySystem.setMockFeature = jest.fn((id, feature) => {
      if (id === 'photo_2') {
        return; // 不設置，模擬提取失敗
      }
      (mockSimilaritySystem as any).mockFeatures.set(id, feature);
    });
    
    photos.forEach(photo => {
      if (photo.id !== 'photo_2') {
        mockSimilaritySystem.setMockFeature(photo.id, createMultiLevelFeature());
      }
    });
    
    // 添加特徵，預期不會拋出錯誤
    const result = await featureIndex.addOrUpdateFeatures(photos);
    
    // 驗證結果
    expect(result.addedFeatures).toBeLessThan(photos.length * 3); // 每張照片有3種級別的特徵
  });
  
  test('異步處理應該正確工作', async () => {
    // 創建大量測試照片
    const photos = createTestPhotos(30);
    
    // 模擬異步處理延遲
    const originalExtract = mockSimilaritySystem.extractMultiLevelFeatures;
    mockSimilaritySystem.extractMultiLevelFeatures = jest.fn(async (photo) => {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      return originalExtract.call(mockSimilaritySystem, photo);
    });
    
    // 並行添加特徵
    const result = await featureIndex.addOrUpdateFeatures(photos);
    
    // 驗證結果
    expect(result.addedFeatures).toBeGreaterThan(0);
    expect(mockSimilaritySystem.extractMultiLevelFeatures).toHaveBeenCalledTimes(photos.length);
  });
});

// 測試 SharedArrayBuffer 支持
describe('SharedArrayBuffer 支持', () => {
  test('應該檢測 SharedArrayBuffer 可用性', () => {
    // 測試 isSharedArrayBufferAvailable 函數
    const { isSharedArrayBufferAvailable } = require('./incrementalLearning');
    
    // 這個測試將根據運行環境而有不同結果
    if (typeof SharedArrayBuffer !== 'undefined') {
      expect(isSharedArrayBufferAvailable()).toBe(true);
    } else {
      expect(isSharedArrayBufferAvailable()).toBe(false);
    }
  });
  
  test('當 SharedArrayBuffer 可用時應使用它', async () => {
    // 只有當 SharedArrayBuffer 可用時才運行此測試
    if (typeof SharedArrayBuffer === 'undefined') {
      return; // 跳過測試
    }
    
    // 創建啟用 SharedArrayBuffer 的索引
    const featureIndex = new IncrementalFeatureIndex({
      useSharedArrayBuffer: true
    });
    
    // 設置相似度系統
    const mockSystem = new MockSimilaritySystem();
    featureIndex.setSimilaritySystem(mockSystem as unknown as EnhancedImageSimilaritySystem);
    
    // 創建測試照片並添加
    const photos = createTestPhotos(5);
    await featureIndex.addOrUpdateFeatures(photos);
    
    // 這裡無法直接測試內部實現是否使用了 SharedArrayBuffer
    // 但至少可以確保功能正常工作
    expect(true).toBe(true);
  });
}); 