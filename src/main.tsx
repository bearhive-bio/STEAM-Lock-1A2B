import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx' // 這裡會引入您的遊戲主程式
import './index.css' // 這裡會引入 Tailwind 的設定(如果有)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)