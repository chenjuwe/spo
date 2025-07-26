import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './index';

describe('Button 組件', () => {
  test('渲染基本按鈕', () => {
    render(<Button>測試按鈕</Button>);
    const buttonElement = screen.getByText('測試按鈕');
    expect(buttonElement).toBeInTheDocument();
    expect(buttonElement.tagName).toBe('BUTTON');
  });

  test('應用不同變體樣式', () => {
    const { rerender } = render(<Button variant="default">默認按鈕</Button>);
    expect(screen.getByText('默認按鈕')).toHaveClass('bg-primary');
    
    rerender(<Button variant="destructive">危險按鈕</Button>);
    expect(screen.getByText('危險按鈕')).toHaveClass('bg-destructive');
    
    rerender(<Button variant="outline">輪廓按鈕</Button>);
    expect(screen.getByText('輪廓按鈕')).toHaveClass('border-input');
  });

  test('應用不同尺寸', () => {
    const { rerender } = render(<Button size="default">默認尺寸</Button>);
    expect(screen.getByText('默認尺寸')).toHaveClass('h-10');
    
    rerender(<Button size="sm">小尺寸</Button>);
    expect(screen.getByText('小尺寸')).toHaveClass('h-9');
    
    rerender(<Button size="lg">大尺寸</Button>);
    expect(screen.getByText('大尺寸')).toHaveClass('h-11');
  });

  test('點擊按鈕觸發回調', async () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>可點擊按鈕</Button>);
    
    const buttonElement = screen.getByText('可點擊按鈕');
    await userEvent.click(buttonElement);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('禁用狀態', async () => {
    const handleClick = jest.fn();
    render(<Button disabled onClick={handleClick}>禁用按鈕</Button>);
    
    const buttonElement = screen.getByText('禁用按鈕');
    expect(buttonElement).toBeDisabled();
    
    await userEvent.click(buttonElement);
    expect(handleClick).not.toHaveBeenCalled();
  });

  test('asChild 功能', () => {
    render(
      <Button asChild>
        <a href="https://example.com">連結按鈕</a>
      </Button>
    );
    
    const linkElement = screen.getByText('連結按鈕');
    expect(linkElement.tagName).toBe('A');
    expect(linkElement).toHaveAttribute('href', 'https://example.com');
    expect(linkElement).toHaveClass('inline-flex');
  });
}); 