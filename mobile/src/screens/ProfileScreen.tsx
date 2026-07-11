/**
 * Stepless — Profile Screen
 *
 * Shows wallet address, language settings, accessibility preferences,
 * contribution stats, and app info.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Colors } from '../config/colors';
import { useWallet } from '../services/wallet';
import { RewardDistributor } from '../services/contracts';

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { walletAddress, user, disconnectWallet, usdcBalance } = useWallet();
  const insets = useSafeAreaInsets();

  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [stats, setStats] = useState<{
    totalEarned: string;
    contributionCount: number;
    verificationCount: number;
    isTopContributor: boolean;
  } | null>(null);

  useEffect(() => {
    if (walletAddress) {
      RewardDistributor.getContributorStats(walletAddress)
        .then(setStats)
        .catch(console.error);
    }
  }, [walletAddress]);

  const handleDisconnect = () => {
    Alert.alert(
      t('profile.disconnect'),
      t('profile.disconnectConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.disconnect'),
          style: 'destructive',
          onPress: disconnectWallet,
        },
      ]
    );
  };

  const handleShareAddress = async () => {
    if (!walletAddress) return;
    try {
      await Share.share({ message: walletAddress });
    } catch (e) { /* ignore */ }
  };

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`
    : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('profile.title')}</Text>
        </View>

        {/* Wallet Card */}
        <View style={styles.walletCard}>
          <View style={styles.walletIconRow}>
            <View style={styles.walletIconContainer}>
              <Ionicons name="wallet" size={28} color={Colors.light.onPrimary} />
            </View>
            <View style={styles.walletInfo}>
              <Text style={styles.walletLabel}>{t('profile.walletAddress')}</Text>
              <TouchableOpacity onPress={handleShareAddress} style={styles.addressRow}>
                <Text style={styles.walletAddress}>{shortAddress}</Text>
                <Ionicons name="copy-outline" size={16} color={Colors.light.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
          {user && (
            <View style={styles.connectedViaRow}>
              <Ionicons name="logo-google" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.connectedViaText}>
                {t('profile.connectedWith')} {user.provider}
              </Text>
            </View>
          )}
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>USDC</Text>
            <Text style={styles.balanceValue}>{usdcBalance}</Text>
          </View>
        </View>

        {/* Contribution Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats?.contributionCount || 0}</Text>
            <Text style={styles.statText}>{t('profile.myContributions')}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats?.verificationCount || 0}</Text>
            <Text style={styles.statText}>{t('profile.myVerifications')}</Text>
          </View>
        </View>

        {/* Language Settings */}
        <Text style={styles.sectionTitle}>{t('profile.language')}</Text>
        <View style={styles.settingsCard}>
          {[
            { code: 'pt-BR', label: t('profile.portuguese'), icon: 'flag' as const },
            { code: 'en', label: t('profile.english'), icon: 'flag' as const },
            { code: 'es', label: t('profile.spanish'), icon: 'flag' as const },
          ].map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={styles.langRow}
              onPress={() => changeLanguage(lang.code)}
              accessibilityRole="button"
              accessibilityLabel={lang.label}
            >
              <Ionicons name={lang.icon} size={20} color={Colors.light.textSecondary} />
              <Text style={styles.langLabel}>{lang.label}</Text>
              {i18n.language === lang.code && (
                <Ionicons name="checkmark" size={20} color={Colors.light.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Accessibility Settings */}
        <Text style={styles.sectionTitle}>{t('profile.accessibility')}</Text>
        <View style={styles.settingsCard}>
          <View style={styles.toggleRow}>
            <Ionicons name="contrast" size={20} color={Colors.light.textSecondary} />
            <Text style={styles.toggleLabel}>{t('profile.highContrast')}</Text>
            <Switch
              value={highContrast}
              onValueChange={setHighContrast}
              trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Ionicons name="text" size={20} color={Colors.light.textSecondary} />
            <Text style={styles.toggleLabel}>{t('profile.largeText')}</Text>
            <Switch
              value={largeText}
              onValueChange={setLargeText}
              trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Ionicons name="volume-high" size={20} color={Colors.light.textSecondary} />
            <Text style={styles.toggleLabel}>{t('profile.screenReader')}</Text>
            <Switch
              value={screenReader}
              onValueChange={setScreenReader}
              trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
            />
          </View>
          <View style={styles.toggleRow}>
            <Ionicons name="pause" size={20} color={Colors.light.textSecondary} />
            <Text style={styles.toggleLabel}>{t('profile.reduceMotion')}</Text>
            <Switch
              value={reduceMotion}
              onValueChange={setReduceMotion}
              trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
            />
          </View>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>{t('profile.about')}</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>{t('profile.aboutText')}</Text>
          <Text style={styles.versionText}>{t('profile.version')} 1.0.0</Text>
        </View>

        {/* Disconnect */}
        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={handleDisconnect}
          accessibilityRole="button"
          accessibilityLabel={t('profile.disconnect')}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.light.error} />
          <Text style={styles.disconnectText}>{t('profile.disconnect')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scrollView: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.light.text },
  walletCard: {
    marginHorizontal: 20, marginTop: 12, padding: 20, borderRadius: 20,
    backgroundColor: Colors.light.primary,
  },
  walletIconRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  walletIconContainer: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  walletInfo: { flex: 1 },
  walletLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  walletAddress: { fontSize: 16, fontWeight: '700', color: Colors.light.onPrimary },
  connectedViaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  connectedViaText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16 },
  balanceLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  balanceValue: { fontSize: 24, fontWeight: '800', color: Colors.light.onPrimary },
  statsRow: { flexDirection: 'row', gap: 12, marginHorizontal: 20, marginTop: 16 },
  statBox: {
    flex: 1, backgroundColor: Colors.light.surface, borderRadius: 16, padding: 20, alignItems: 'center',
  },
  statNumber: { fontSize: 28, fontWeight: '800', color: Colors.light.text },
  statText: { fontSize: 12, fontWeight: '600', color: Colors.light.textSecondary, marginTop: 4, textAlign: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.text, marginHorizontal: 20, marginTop: 24, marginBottom: 12 },
  settingsCard: { marginHorizontal: 20, backgroundColor: Colors.light.surface, borderRadius: 16, padding: 8 },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12 },
  langLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.light.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12 },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.light.text },
  aboutCard: { marginHorizontal: 20, backgroundColor: Colors.light.surface, borderRadius: 16, padding: 20 },
  aboutText: { fontSize: 14, lineHeight: 22, color: Colors.light.textSecondary },
  versionText: { fontSize: 12, color: Colors.light.textMuted, marginTop: 12, fontWeight: '600' },
  disconnectButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 24, paddingVertical: 16, borderRadius: 14,
    backgroundColor: `${Colors.light.error}15`, borderWidth: 1, borderColor: Colors.light.error,
  },
  disconnectText: { fontSize: 16, fontWeight: '700', color: Colors.light.error },
});
