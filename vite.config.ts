import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS ? '/schematic-editor/' : '/');

export default defineConfig({
  base,
  plugins: [react()],
});
