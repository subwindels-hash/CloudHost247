/** Same production pages/runner as the platform, mounted inside WHMCS's own shell. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ToolsCenterPage from './pages/ToolsCenterPage';
import ToolPage from './pages/ToolPage';
import { toolsHost } from './lib/tools-runtime';
import './tools-center.css';
const root = document.getElementById('ch247-tools-root');
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter basename={toolsHost().webRoot || '/'}>
        <Routes>
          <Route path="/tools" element={<ToolsCenterPage />} />
          <Route
            path="/tools/category/:category"
            element={<ToolsCenterPage />}
          />
          <Route path="/tools/*" element={<ToolPage />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>
  );
