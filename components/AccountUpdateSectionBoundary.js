import React from 'react';

/**
 * Catches Update App section render failures and logs [ACCOUNT_UPDATE_MISSING] for ops monitoring.
 */
export default class AccountUpdateSectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    try {
      console.error('[ACCOUNT_UPDATE_MISSING]', {
        message: String(error?.message ?? error ?? 'unknown'),
        componentStack: info?.componentStack ?? null,
      });
    } catch {}
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
