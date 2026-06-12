import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div role="alert" style={{ maxWidth: 480, margin: '20vh auto 0', padding: '0 24px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
          The editor hit an unexpected error. Reloading usually fixes it; your schematic files are never uploaded, so nothing is lost server-side.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ font: 'inherit', fontSize: 14, padding: '8px 20px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
