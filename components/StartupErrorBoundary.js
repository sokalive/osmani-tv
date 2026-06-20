import React from 'react';

const MAX_AUTO_RECOVERIES = 8;

/**
 * Last-resort guard: log render errors with full stack, auto-remount children.
 * Never shows a blocking startup screen during normal operation.
 */
export default class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { remountKey: 0, recoveries: 0 };
  }

  static getDerivedStateFromError(error) {
    return { pendingError: error };
  }

  componentDidCatch(error, info) {
    const message = error?.message ?? String(error);
    const stack = error?.stack ?? '';
    const componentStack = info?.componentStack ?? '';
    try {
      console.log('[startup-boundary]', 'render_error', {
        message,
        stack,
        componentStack,
      });
    } catch {
      /* ignore */
    }

    this.setState((prev) => {
      const recoveries = prev.recoveries + 1;
      if (recoveries > MAX_AUTO_RECOVERIES) {
        try {
          console.log('[startup-boundary]', 'max_recoveries_reached', recoveries);
        } catch {
          /* ignore */
        }
      }
      return {
        pendingError: null,
        remountKey: prev.remountKey + 1,
        recoveries,
      };
    });
  }

  render() {
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>;
  }
}
