import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './globals.css';

// 初始主题
const savedTheme = localStorage.getItem('pgcm-settings');
if (savedTheme) {
  try {
    const parsed = JSON.parse(savedTheme);
    if (parsed.state?.theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch {}
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
