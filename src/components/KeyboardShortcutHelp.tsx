import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyboardShortcut, formatShortcutKey } from "@/hooks/useKeyboardShortcuts";
import { KeyboardIcon, Info, X } from "lucide-react";

interface ShortcutCategory {
  title: string;
  shortcuts: Record<string, KeyboardShortcut>;
}

interface KeyboardShortcutHelpProps {
  shortcuts: Record<string, ShortcutCategory>;
  onClose?: () => void;
}

export const KeyboardShortcutHelp = ({ shortcuts, onClose }: KeyboardShortcutHelpProps) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(true);
    
    // 清理函數，當組件卸載時關閉對話框
    return () => {
      setIsOpen(false);
    };
  }, []);
  
  const handleClose = () => {
    setIsOpen(false);
    if (onClose) {
      // 使用setTimeout確保對話框動畫完成
      setTimeout(onClose, 150);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open && onClose) {
          setTimeout(onClose, 150);
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyboardIcon className="w-5 h-5" />
              鍵盤快捷鍵說明
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-4 top-4"
              onClick={handleClose}
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogHeader>

          <div className="mt-4">
            <div className="flex items-center gap-2 mb-4 text-muted-foreground">
              <Info className="w-4 h-4" />
              <p className="text-sm">
                以下是可用的鍵盤快捷鍵，可提高操作效率並改善無障礙訪問體驗。
              </p>
            </div>

            <div className="space-y-6">
              {Object.entries(shortcuts).map(([categoryId, category]) => (
                <div key={categoryId} className="space-y-2">
                  <h3 className="text-lg font-semibold">{category.title}</h3>
                  <div className="border rounded-md divide-y">
                    {Object.entries(category.shortcuts).map(([id, shortcut]) => (
                      <div
                        key={id}
                        className="flex items-center justify-between py-2 px-4"
                      >
                        <div className="text-sm">{shortcut.description || id}</div>
                        <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                          {formatShortcutKey(shortcut)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 text-xs text-muted-foreground">
            <p>
              注意：在表單輸入區域內，大多數快捷鍵會被停用，以避免干擾輸入。
              Escape 鍵可在任何地方使用。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default KeyboardShortcutHelp; 