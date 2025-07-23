import { useEffect, useState } from 'react';

/**
 * 鍵盤快捷鍵定義
 */
export interface KeyboardShortcut {
  key: string;            // 按鍵代碼
  ctrlKey?: boolean;      // 是否按下 Ctrl 鍵
  shiftKey?: boolean;     // 是否按下 Shift 鍵
  altKey?: boolean;       // 是否按下 Alt 鍵
  metaKey?: boolean;      // 是否按下 Meta 鍵 (Windows 或 Command)
  action: () => void;     // 快捷鍵觸發的動作
  preventDefault?: boolean; // 是否阻止默認行為
  description?: string;   // 快捷鍵說明
}

/**
 * 當前已註冊的快捷鍵
 */
export interface RegisteredShortcuts {
  [id: string]: KeyboardShortcut;
}

// 全域快捷鍵註冊表
const globalShortcuts: RegisteredShortcuts = {};

/**
 * 鍵盤快捷鍵鉤子
 * @param shortcuts 快捷鍵配置
 * @param enabled 是否啟用快捷鍵
 * @param scope 快捷鍵作用範圍，用於組織和識別
 */
export const useKeyboardShortcuts = (
  shortcuts: Record<string, KeyboardShortcut>,
  enabled = true,
  scope = 'global'
) => {
  const [registeredShortcuts, setRegisteredShortcuts] = useState<RegisteredShortcuts>({});

  // 註冊快捷鍵
  useEffect(() => {
    if (!enabled) return;

    const registered: RegisteredShortcuts = {};
    
    // 為每個快捷鍵生成唯一 ID 並註冊
    Object.entries(shortcuts).forEach(([name, shortcut]) => {
      const id = `${scope}:${name}`;
      registered[id] = shortcut;
      globalShortcuts[id] = shortcut;
    });
    
    setRegisteredShortcuts(registered);
    
    // 清理函數，移除註冊的快捷鍵
    return () => {
      Object.keys(registered).forEach(id => {
        delete globalShortcuts[id];
      });
      setRegisteredShortcuts({});
    };
  }, [shortcuts, enabled, scope]);

  // 全局鍵盤事件處理
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 檢查是否在輸入元素中
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || 
                     target.tagName === 'TEXTAREA' || 
                     target.isContentEditable;
      
      // 如果在輸入元素中，只有明確指定捕獲的快捷鍵才會觸發
      if (isInput && e.key !== 'Escape') return;

      // 檢查所有已註冊的快捷鍵
      Object.values(globalShortcuts).forEach(shortcut => {
        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          (shortcut.ctrlKey === undefined || e.ctrlKey === shortcut.ctrlKey) &&
          (shortcut.shiftKey === undefined || e.shiftKey === shortcut.shiftKey) &&
          (shortcut.altKey === undefined || e.altKey === shortcut.altKey) &&
          (shortcut.metaKey === undefined || e.metaKey === shortcut.metaKey)
        ) {
          if (shortcut.preventDefault !== false) {
            e.preventDefault();
          }
          shortcut.action();
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);

  // 返回當前註冊的快捷鍵
  return {
    registeredShortcuts,
    allShortcuts: globalShortcuts
  };
};

/**
 * 格式化快捷鍵顯示
 */
export const formatShortcutKey = (shortcut: KeyboardShortcut): string => {
  const modifiers = [];
  
  if (shortcut.ctrlKey) modifiers.push('Ctrl');
  if (shortcut.altKey) modifiers.push('Alt');
  if (shortcut.shiftKey) modifiers.push('Shift');
  if (shortcut.metaKey) modifiers.push(navigator.platform.includes('Mac') ? '⌘' : 'Win');
  
  // 特殊按鍵的顯示格式
  const keyMap: Record<string, string> = {
    'arrowup': '↑',
    'arrowdown': '↓',
    'arrowleft': '←',
    'arrowright': '→',
    'escape': 'Esc',
    'delete': 'Del',
    ' ': 'Space'
  };
  
  const key = keyMap[shortcut.key.toLowerCase()] || shortcut.key.toUpperCase();
  return [...modifiers, key].join('+');
}; 