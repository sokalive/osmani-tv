import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const BG = '#111215';
const TEXT = '#F3F4F6';

/** Shared copy for full-screen and inline home maintenance states. */
export const MAINTENANCE_USER_MESSAGE =
  'Habari, kuna marekebisho yanaendelea ndani ya app kwa muda mfupi. Tafadhali subiri.';

/**
 * Centered wrench + message (same visual as legacy MaintenanceScreen body)
 * for use inside Home catalog below banners/filters — not full-screen.
 */
export function MaintenanceHomeCentered() {
  return (
    <View style={inlineStyles.inlineRoot} accessibilityRole="text">
      <Ionicons name="build-outline" size={64} color="#FBBF24" accessibilityLabel="Maintenance" />
      <Text style={inlineStyles.inlineMessage}>{MAINTENANCE_USER_MESSAGE}</Text>
    </View>
  );
}

const inlineStyles = StyleSheet.create({
  inlineRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 48,
  },
  inlineMessage: {
    marginTop: 28,
    color: TEXT,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 26,
  },
});

export default function MaintenanceScreen({
  contentPaddingBottom = 0,
  refreshing = false,
  onRefresh,
  showBack = false,
  onBack,
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="light" />
      {showBack ? (
        <View style={styles.topRow}>
          <Pressable onPress={onBack} hitSlop={16} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={28} color={TEXT} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.scrollInner,
          { paddingBottom: contentPaddingBottom + 24 },
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FBBF24"
              colors={['#FBBF24']}
            />
          ) : undefined
        }
      >
        <View style={styles.centerBlock}>
          <MaintenanceHomeCentered />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  topRow: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 8,
  },
  scrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
