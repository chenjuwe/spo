import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AppHeader from './AppHeader';
import { vi, describe, test, expect, beforeEach } from 'vitest';

// 模擬依賴
vi.mock('@/lib/downloadManager', () => ({
  downloadManager: {
    downloadOrganizedFiles: vi.fn().mockResolvedValue(undefined)
  }
}));

// 模擬 toast
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }
}));

describe('AppHeader 組件', () => {
  // 默認 props
  const defaultProps = {
    showSettings: false,
    setShowSettings: vi.fn(),
    setShowShortcuts: vi.fn(),
    setShowClassifier: vi.fn(),
    settings: { 
      autoRename: true, 
      preserveOriginal: true, 
      optimizeQuality: false, 
      maxDimension: 1920 
    },
    similarityGroups: [],
    photosCount: 0,
    shortcuts: {},
    photos: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('渲染應用標題和照片計數', () => {
    render(<AppHeader {...defaultProps} photosCount={10} />);
    
    expect(screen.getByText('Smart Photo Organizer')).toBeInTheDocument();
    expect(screen.getByText(/已載入 10 張照片/i)).toBeInTheDocument();
  });

  test('點擊設定按鈕時調用相應函數', () => {
    render(<AppHeader {...defaultProps} />);
    
    const settingsButton = screen.getByText('設定', { exact: false });
    fireEvent.click(settingsButton);
    
    expect(defaultProps.setShowSettings).toHaveBeenCalledTimes(1);
    expect(defaultProps.setShowSettings).toHaveBeenCalledWith(true);
  });

  test('點擊分類標籤按鈕時調用相應函數', () => {
    render(<AppHeader {...defaultProps} />);
    
    const classifierButton = screen.getByText('分類標籤', { exact: false });
    fireEvent.click(classifierButton);
    
    expect(defaultProps.setShowClassifier).toHaveBeenCalledTimes(1);
  });

  test('下載按鈕在沒有分組結果時應該被禁用', () => {
    render(<AppHeader {...defaultProps} />);
    
    const downloadButton = screen.getByText('下載結果', { exact: false });
    expect(downloadButton).toBeDisabled();
  });

  test('下載按鈕在有分組結果時可用', () => {
    const propsWithGroups = {
      ...defaultProps,
      similarityGroups: [{ id: '1', photos: ['1', '2'], bestPhoto: '1', averageSimilarity: 90 }]
    };
    
    render(<AppHeader {...propsWithGroups} />);
    
    const downloadButton = screen.getByText('下載結果', { exact: false });
    expect(downloadButton).not.toBeDisabled();
  });
}); 