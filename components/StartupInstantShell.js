import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

/**
 * Immediate visible chrome so cold start never shows a blank black frame.
 */
export default function StartupInstantShell({ subtitle = 'Inapakia…' }) {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="light" backgroundColor="#0C0608" />
      <View style={styles.content}>
        <Text style={styles.title}>Osmani TV</Text>
        <Text style={styles.subtitle}>Tazama Live Kila Mahali</Text>
        <View style={styles.row}>
          <ActivityIndicator color="#1EC967" />
          <Text style={styles.status}>{subtitle}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0C0608',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    color: '#A1A8B5',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
  },
  status: {
    color: '#A1A8B5',
    fontSize: 14,
  },
});
