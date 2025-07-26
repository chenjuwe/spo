import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerServiceWorker } from './serviceWorkerRegistration'
import { reportWebVitals } from './reportWebVitals'

// 註冊 Service Worker 啟用離線功能
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);

// 收集效能指標
reportWebVitals();
