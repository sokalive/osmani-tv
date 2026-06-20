import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Last-resort guard so a single render/effect error does not kill the process.
 */
export default class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      console.log('[startup-boundary]', error?.message ?? error, info?.componentStack ?? '');
    } catch {
      /* ignore */
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
    try {
      if (Updates.reloadAsync) void Updates.reloadAsync();
    } catch {
      /* ignore */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Osmani TV</Text>
        <Text style={styles.body}>Programu imeshindwa kuanza. Jaribu tena.</Text>
        <Pressable style={styles.btn} onPress={this.handleRetry}>
          <Text style={styles.btnText}>Jaribu tena</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#0C0608',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { color: '#9CA3AF', textAlign: 'center', marginBottom: 20 },
  btn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
