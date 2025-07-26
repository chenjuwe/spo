import React from 'react';
import { Button } from '@/components/ui/button';
import { HelpCircle } from 'lucide-react';
import { KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';

interface KeyboardShortcutsButtonProps {
  onClick: () => void;
  shortcuts: Record<string, KeyboardShortcut>;
}

/**
 * 鍵盤快捷鍵顯示按鈕元件
 * 負責顯示鍵盤快捷鍵幫助按鈕，點擊後打開快捷鍵說明面板
 */
const KeyboardShortcutsButton: React.FC<KeyboardShortcutsButtonProps> = ({ onClick, shortcuts }) => {
  // 計算有多少有效的快捷鍵
  const shortcutCount = Object.keys(shortcuts).length;
  
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="gap-1.5"
      title="查看鍵盤快捷鍵"
    >
      <HelpCircle className="w-4 h-4" />
      <span className="hidden sm:inline">快捷鍵</span>
      {shortcutCount > 0 && (
        <span className="bg-primary/20 text-primary text-xs px-1.5 rounded-full hidden sm:inline">
          {shortcutCount}
        </span>
      )}
    </Button>
  );
};

export default KeyboardShortcutsButton; 