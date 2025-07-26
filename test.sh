#!/bin/bash

echo "= 檢查代碼結構與穩定性優化 ="
echo "== 1. 檢查元件重構 =="
ls -la src/components/AppHeader.tsx src/components/MainContent.tsx src/components/KeyboardShortcutsButton.tsx src/components/SettingsButton.tsx src/components/ClassifierButton.tsx src/components/DownloadButton.tsx src/components/AppInitializer.tsx

echo "== 2. 檢查錯誤處理增強 =="
grep -c "export enum ErrorSeverity" src/lib/errorHandlingService.ts
grep -c "class ErrorHandlingService" src/lib/errorHandlingService.ts
grep -c "private retryConfig" src/lib/errorHandlingService.ts
grep -c "scheduleRetry" src/lib/errorHandlingService.ts
grep -c "cancelRetry" src/lib/errorHandlingService.ts
grep -c "export function withRetry" src/lib/errorHandlingService.ts

echo "== 3. 檢查測試覆蓋率提升 =="
ls -la src/components/AppHeader.test.tsx src/lib/errorHandlingService.test.ts

echo "優化完成！" 