import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logStartupStep } from '../lib/startupStepLog';

/**
 * Top-level render guard — logs fatal UI errors instead of hard-crashing the process.
 */
export default class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      failed: true,
      message: String(error?.message ?? error ?? 'unknown'),
    };
  }

  componentDidCatch(error, info) {
    try {
      const message = String(error?.message ?? error ?? 'unknown');
      const stack = typeof error?.stack === 'string' ? error.stack : null;
      const componentStack = info?.componentStack ?? null;
      logStartupStep('render_crash', 'fail', {
        message,
        stack,
        componentStack,
        file: 'StartupErrorBoundary',
      });
      console.error('[STARTUP_CRASH]', {
        message,
        stack,
        componentStack,
      });
    } catch {
      /* ignore */
    }
  }

  handleRetry = () => {
    this.setState({ failed: false, message: '' });
    if (typeof this.props.onRetry === 'function') {
      this.props.onRetry();
    }
  };

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Hitilafu ya kuanzisha</Text>
        <Text style={styles.message}>
          Programu imeshindwa kuanza. Tafadhali jaribu tena.
        </Text>
        <Pressable style={styles.btn} onPress={this.handleRetry}>
          <Text style={styles.btnText}>Jaribu tena</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C0608',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    color: '#A1A8B5',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
  },
  btn: {
    backgroundColor: '#FFCB3D',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  btnText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
});
