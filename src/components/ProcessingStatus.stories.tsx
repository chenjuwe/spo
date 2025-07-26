import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ProcessingStatus } from './ProcessingStatus';

/**
 * 處理狀態組件
 * 
 * 此組件顯示照片處理的進度，包括總數量、已處理數量和錯誤數量
 */
const meta = {
  title: 'Components/ProcessingStatus',
  component: ProcessingStatus,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '顯示照片處理進度的狀態組件，包括處理進度條、照片總數、已處理數量和錯誤數量。'
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    progress: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
      description: '處理進度百分比 (0-100)'
    },
    total: {
      control: { type: 'number', min: 0 },
      description: '照片總數'
    },
    processed: {
      control: { type: 'number', min: 0 },
      description: '已處理的照片數量'
    },
    errors: {
      control: { type: 'number', min: 0 },
      description: '處理過程中的錯誤數量'
    }
  },
} satisfies Meta<typeof ProcessingStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 默認狀態
 */
export const Default: Story = {
  args: {
    progress: 45,
    total: 100,
    processed: 45,
    errors: 0
  },
};

/**
 * 處理中
 */
export const InProgress: Story = {
  args: {
    progress: 65,
    total: 100,
    processed: 65,
    errors: 2
  },
};

/**
 * 已完成
 */
export const Completed: Story = {
  args: {
    progress: 100,
    total: 100,
    processed: 98,
    errors: 2
  },
};

/**
 * 出錯
 */
export const WithErrors: Story = {
  args: {
    progress: 75,
    total: 100,
    processed: 75,
    errors: 15
  },
};

/**
 * 小批量
 */
export const SmallBatch: Story = {
  args: {
    progress: 50,
    total: 10,
    processed: 5,
    errors: 0
  },
};

/**
 * 大批量
 */
export const LargeBatch: Story = {
  args: {
    progress: 20,
    total: 1000,
    processed: 200,
    errors: 5
  },
}; 