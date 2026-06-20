import React from 'react';
import StartupInstantShell from './StartupInstantShell';
import { logStartupPaint } from '../lib/startupPaintDiagnostics';

const MAX_AUTO_RECOVERIES = 3;

/**
 * Log render errors; recover with visible shell (never blank black / blocking retry UI).
 */
export default class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { remountKey: 0, recoveries: 0, recovering: false };
    this.recoverTimer = null;
  }

  componentDidCatch(error, info) {
    const message = error?.message ?? String(error);
    const stack = error?.stack ?? '';
    const componentStack = info?.componentStack ?? '';
    try {
      logStartupPaint('boundary_render_error', { message });
      console.log('[startup-boundary]', 'render_error', {
        message,
        stack,
        componentStack,
      });
    } catch {
      /* ignore */
    }

    if (this.recoverTimer) clearTimeout(this.recoverTimer);

    this.setState((prev) => {
      const recoveries = prev.recoveries + 1;
      return { recovering: true, recoveries };
    });

    this.recoverTimer = setTimeout(() => {
      this.setState((prev) => ({
        recovering: false,
        remountKey: prev.remountKey + 1,
      }));
    }, 80);
  }

  componentWillUnmount() {
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
  }

  render() {
    if (this.state.recovering) {
      return <StartupInstantShell subtitle="Inaendelea…" />;
    }
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>;
  }
}
