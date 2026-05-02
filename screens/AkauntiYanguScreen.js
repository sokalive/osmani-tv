import React, { useCallback, useState } from 'react';
import {
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import HamishaKifurushiModal from '../components/HamishaKifurushiModal';
import PremiumModal from '../components/PremiumModal';

/** Matches App.js theme — do not diverge */
const COLORS = {
  background: '#111215',
  card: '#1A1D23',
  live: '#1BCB5A',
  yellow: '#FFCB3D',
  greenButton: '#1EC967',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
};

const HORIZONTAL_PADDING = 16;
const GRID_GAP = 12;
const { width: SCREEN_W } = Dimensions.get('window');
const STAT_CARD_W = (SCREEN_W - HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;

const TAB_BAR_HEIGHT = 76;
const TAB_BAR_FLOAT_GAP = 4;
const CONTENT_ABOVE_TAB_GAP = 28;

function scrollBottomPad(insets) {
  const tabBottomOffset = insets.bottom + TAB_BAR_FLOAT_GAP;
  const reserved = TAB_BAR_HEIGHT + tabBottomOffset + CONTENT_ABOVE_TAB_GAP;
  return Math.max(100, reserved);
}

const DEVICE_ID_FULL = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function StatCard({ icon, value, label }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={22} color={COLORS.yellow} style={styles.statIcon} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AkauntiYanguScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottomPad = scrollBottomPad(insets);
  const [hamishaModalVisible, setHamishaModalVisible] = useState(false);
  const [premiumModalVisible, setPremiumModalVisible] = useState(false);

  const deviceShort = DEVICE_ID_FULL.slice(0, 8).toUpperCase();

  const handleCopyDeviceId = useCallback(async () => {
    await Clipboard.setStringAsync(DEVICE_ID_FULL);
    Alert.alert('', 'Device ID imenakiliwa');
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.navigate('Home')}
            style={styles.backBtn}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.white} />
          </Pressable>
          <View style={styles.headerMain}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>B</Text>
              </View>
              <View style={styles.onlineDot} />
            </View>
            <View style={styles.headerTextCol}>
              <Text style={styles.companyTitle} numberOfLines={2}>
                Google Inc. Mobile
              </Text>
              <Text style={styles.deviceSubtitle}>ID: {deviceShort}</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard icon="wallet-outline" value="TSh 0" label="Malipo ya Kifurushi" />
            <StatCard icon="tv-outline" value="2" label="Channel Zilizofunguka" />
          </View>
          <View style={styles.statsRow}>
            <StatCard icon="hourglass-outline" value="-" label="Muda wa Kifurushi" />
            <StatCard icon="calendar-outline" value="-" label="Kuisha Tarehe" />
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Hali ya Usajili</Text>
          <Text style={styles.statusBad}>HAKUNA</Text>
        </View>

        <Pressable
          style={styles.infoCard}
          onPress={() => setHamishaModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Hamisha Kifurushi"
        >
          <Text style={styles.infoCardTitle}>Hamisha Kifurushi</Text>
          <Text style={styles.infoCardBody}>HAMISHA KIFURUSHI CHAKO</Text>
        </Pressable>

        <Pressable style={styles.primaryWrap} onPress={() => setPremiumModalVisible(true)}>
          <LinearGradient
            colors={[COLORS.yellow, '#E5A020']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryGradient}
          >
            <Text style={styles.primaryText}>LIPIA TENA</Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.deviceSection}>
          <Text style={styles.deviceSectionTitle}>Device ID ya kifaa hiki</Text>
          <View style={styles.deviceRow}>
            <Text style={styles.deviceIdText} selectable>
              {DEVICE_ID_FULL}
            </Text>
            <Pressable style={styles.copyBtn} onPress={handleCopyDeviceId}>
              <Text style={styles.copyBtnText}>Nakili</Text>
            </Pressable>
          </View>
          <Text style={styles.deviceFooter}>
            Tuma Device ID hii kwa admin wakati wa kuhamisha kifurushi
          </Text>
        </View>
      </ScrollView>

      <HamishaKifurushiModal
        visible={hamishaModalVisible}
        onClose={() => setHamishaModalVisible(false)}
      />

      <PremiumModal
        visible={premiumModalVisible}
        onClose={() => setPremiumModalVisible(false)}
        onUnlockSuccess={() => {}}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  backBtn: {
    paddingVertical: 4,
    paddingRight: 8,
    marginRight: 4,
  },
  headerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    marginRight: 12,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2A2E37',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.live,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  headerTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  companyTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  deviceSubtitle: {
    marginTop: 4,
    color: COLORS.mutedText,
    fontSize: 13,
  },
  statsGrid: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  statCard: {
    width: STAT_CARD_W,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    minHeight: 108,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  statIcon: {
    marginBottom: 10,
  },
  statValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  statLabel: {
    color: COLORS.mutedText,
    fontSize: 12,
    lineHeight: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  infoCardTitle: {
    color: COLORS.mutedText,
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  statusBad: {
    color: '#EF4444',
    fontSize: 18,
    fontWeight: '800',
  },
  infoCardBody: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  primaryWrap: {
    marginTop: 20,
    marginBottom: 24,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  primaryGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deviceSection: {
    marginBottom: 8,
  },
  deviceSectionTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 12,
  },
  deviceIdText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
  },
  copyBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.greenButton,
  },
  copyBtnText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 13,
  },
  deviceFooter: {
    color: COLORS.mutedText,
    fontSize: 12,
    lineHeight: 18,
  },
});
