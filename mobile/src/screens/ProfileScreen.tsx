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
  Platform,
  Linking,
  Alert,
  Share,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../config/colors';
import { useWallet } from '../services/wallet';
import { fetchMyStats } from '../services/api';
import Constants from 'expo-constants';
import { fetchLatestUpdate } from '../services/updates';
import { STEPLESS_NETWORK } from '../config/network.generated';

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { walletAddress, user, disconnectWallet, usdcBalance, exportPrivateKey } = useWallet();
  const insets = useSafeAreaInsets();

  // ─── Exportar chave privada ──────────────────────────────────────────
  // Fluxo em duas etapas: aviso de risco → revela a chave só depois de
  // confirmação explícita. A chave nunca fica em state depois que o
  // modal fecha (closeExportModal limpa), para não sobreviver em memória
  // além do necessário nem reaparecer sem o usuário pedir de novo.
  const [exportVisible, setExportVisible] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const closeExportModal = useCallback(() => {
    setExportVisible(false);
    setRevealedKey(null);
    setCopied(false);
  }, []);

  const handleExportPress = () => {
    Alert.alert(
      t('profile.exportKeyTitle'),
      t('profile.exportKeyWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.exportKeyContinue'),
          style: 'destructive',
          onPress: async () => {
            setExporting(true);
            setExportVisible(true);
            try {
              const pk = await exportPrivateKey();
              setRevealedKey(pk);
            } catch (e) {
              closeExportModal();
              Alert.alert(t('profile.exportKeyTitle'), t('profile.exportKeyError'));
            } finally {
              setExporting(false);
            }
          },
        },
      ]
    );
  };

  const handleCopyKey = async () => {
    if (!revealedKey) return;
    await Clipboard.setStringAsync(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const [showAdvanced, setShowAdvanced] = useState(false);
  // Totais reais da carteira no Stepless (servidor). O contador antigo vinha
  // da recompensa automática, desligada no modelo de campanhas — mostrava 0.
  const [stats, setStats] = useState<{ submitted: number; approved: number; rejected: number } | null>(null);

  useEffect(() => {
    if (walletAddress) fetchMyStats(walletAddress).then(setStats).catch(() => {});
  }, [walletAddress]);

  const appVersion = Constants.expoConfig?.version || '—';
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    const r = await fetchLatestUpdate();
    setCheckingUpdate(false);
    if (r === 'offline') return Alert.alert(t('profile.checkUpdate'), t('profile.offline'));
    if (!r) return Alert.alert(t('profile.checkUpdate'), t('profile.upToDate'));
    Alert.alert(
      t('update.title'),
      t('update.message', { version: r.latest.replace(/^v/i, ''), current: r.installed }),
      [
        { text: t('update.later'), style: 'cancel' },
        { text: t('update.download'), onPress: () => { Linking.openURL(r.url).catch(() => {}); } },
      ],
    );
  };

  const openUrl = (url: string) => { Linking.openURL(url).catch(() => {}); };

  const openA11ySettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => Linking.openSettings());
    } else {
      Linking.openSettings();
    }
  };

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
              <Ionicons name="phone-portrait-outline" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.connectedViaText}>{t('profile.connectedEmbedded')}</Text>
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
            <Text style={styles.statNumber}>{stats?.submitted ?? 0}</Text>
            <Text style={styles.statText}>{t('profile.sent')}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats?.approved ?? 0}</Text>
            <Text style={styles.statText}>{t('profile.approved')}</Text>
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

        {/* Acessibilidade: o app segue o sistema (texto, TalkBack, contraste).
            Os interruptores antigos não faziam nada — para um app de
            acessibilidade, isso é pior que não ter. */}
        <Text style={styles.sectionTitle}>{t('profile.accessibility')}</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>{t('profile.a11yNote')}</Text>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={openA11ySettings}
            accessibilityRole="button"
            accessibilityLabel={t('profile.a11yOpen')}
          >
            <Ionicons name="accessibility-outline" size={18} color={Colors.light.text} />
            <Text style={styles.exportButtonText}>{t('profile.a11yOpen')}</Text>
          </TouchableOpacity>
        </View>

        {/* Ajuda em Libras: o VLibras só existe para páginas web, então o
            guia fica no site (stepless.lat/ajuda.html) com o tradutor ativo. */}
        <TouchableOpacity
          style={styles.librasButton}
          onPress={() => openUrl('https://www.stepless.lat/ajuda.html')}
          accessibilityRole="link"
          accessibilityLabel={t('profile.helpLibras')}
          accessibilityHint={t('profile.helpLibrasHint')}
        >
          <Ionicons name="hand-left-outline" size={26} color={Colors.light.onPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.librasTitle}>{t('profile.helpLibras')}</Text>
            <Text style={styles.librasHint}>{t('profile.helpLibrasHint')}</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={Colors.light.onPrimary} />
        </TouchableOpacity>

        {/* About */}
        <Text style={styles.sectionTitle}>{t('profile.about')}</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>{t('profile.aboutText')}</Text>
        </View>

        {/* Sobre o app: versão, rede, atualização e links */}
        <Text style={styles.sectionTitle}>{t('profile.appInfo')}</Text>
        <View style={styles.aboutCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('profile.version')}</Text>
            <Text style={styles.infoValue}>{appVersion}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('profile.network')}</Text>
            <Text style={styles.infoValue}>{STEPLESS_NETWORK.name}</Text>
          </View>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate}
            accessibilityRole="button"
            accessibilityLabel={t('profile.checkUpdate')}
          >
            <Ionicons name="refresh-outline" size={18} color={Colors.light.text} />
            <Text style={styles.exportButtonText}>{checkingUpdate ? t('profile.checking') : t('profile.checkUpdate')}</Text>
          </TouchableOpacity>
          {[
            { label: t('profile.website'), url: 'https://www.stepless.lat', icon: 'globe-outline' as const },
            { label: t('profile.termsOfUse'), url: 'https://www.stepless.lat/termos.html', icon: 'document-text-outline' as const },
            { label: t('profile.privacyPolicy'), url: 'https://www.stepless.lat/privacidade.html', icon: 'shield-checkmark-outline' as const },
          ].map((l) => (
            <TouchableOpacity key={l.url} style={styles.linkRow} onPress={() => openUrl(l.url)} accessibilityRole="link" accessibilityLabel={l.label}>
              <Ionicons name={l.icon} size={18} color={Colors.light.primary} />
              <Text style={styles.linkText}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Levar a carteira para outro app — escondido: para o público do
            Stepless, uma chave privada à vista é risco, não recurso. */}
        <TouchableOpacity
          onPress={() => setShowAdvanced((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showAdvanced }}
          style={styles.advancedToggle}
        >
          <Text style={styles.advancedText}>{t('profile.advanced')}</Text>
          <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.light.textSecondary} />
        </TouchableOpacity>
        {showAdvanced && (<>
        <Text style={styles.sectionTitle}>{t('profile.walletPortability')}</Text>
        <View style={styles.aboutCard}>
          <Text style={styles.aboutText}>{t('profile.walletPortabilityDesc')}</Text>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleExportPress}
            accessibilityRole="button"
            accessibilityLabel={t('profile.exportKeyButton')}
          >
            <Ionicons name="key-outline" size={18} color={Colors.light.text} />
            <Text style={styles.exportButtonText}>{t('profile.exportKeyButton')}</Text>
          </TouchableOpacity>
        </View>
        </>)}

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

      {/* ─── Modal: Exportar chave privada ─── */}
      <Modal visible={exportVisible} animationType="slide" transparent onRequestClose={closeExportModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('profile.exportKeyTitle')}</Text>
              <TouchableOpacity
                onPress={closeExportModal}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Ionicons name="close" size={26} color={Colors.light.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.dangerBox}>
              <Ionicons name="warning-outline" size={18} color="#B45309" />
              <Text style={styles.dangerText}>{t('profile.exportKeyNeverShare')}</Text>
            </View>

            {exporting ? (
              <Text style={styles.exportLoading}>{t('profile.exportKeyLoading')}</Text>
            ) : revealedKey ? (
              <>
                <Text style={styles.exportLabel}>{t('profile.exportKeyLabel')}</Text>
                <View style={styles.keyBox}>
                  <Text style={styles.keyText} selectable>{revealedKey}</Text>
                </View>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={handleCopyKey}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.exportKeyCopy')}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={Colors.light.onPrimary}
                  />
                  <Text style={styles.copyButtonText}>
                    {copied ? t('profile.exportKeyCopied') : t('profile.exportKeyCopy')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.exportHint}>{t('profile.exportKeyHint')}</Text>
              </>
            ) : (
              <Text style={styles.exportLoading}>{t('profile.exportKeyError')}</Text>
            )}

            <TouchableOpacity
              style={styles.doneButton}
              onPress={closeExportModal}
              accessibilityRole="button"
            >
              <Text style={styles.doneButtonText}>{t('profile.exportKeyDone')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  librasButton: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20, marginTop: 24, padding: 16, minHeight: 64, borderRadius: 16, backgroundColor: Colors.light.primary },
  librasTitle: { fontSize: 17, fontWeight: '700', color: Colors.light.onPrimary },
  librasHint: { fontSize: 13, color: Colors.light.onPrimary, opacity: 0.9, marginTop: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { fontSize: 15, color: Colors.light.textSecondary },
  infoValue: { fontSize: 15, fontWeight: '700', color: Colors.light.text },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, minHeight: 44 },
  linkText: { fontSize: 15, fontWeight: '600', color: Colors.light.primary },
  advancedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginTop: 24, paddingVertical: 12, minHeight: 48 },
  advancedText: { fontSize: 15, fontWeight: '600', color: Colors.light.textSecondary },
  versionText: { fontSize: 12, color: Colors.light.textMuted, marginTop: 12, fontWeight: '600' },
  disconnectButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 24, paddingVertical: 16, borderRadius: 14,
    backgroundColor: `${Colors.light.error}15`, borderWidth: 1, borderColor: Colors.light.error,
  },
  disconnectText: { fontSize: 16, fontWeight: '700', color: Colors.light.error },

  // ─── Exportar chave ───
  exportButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 14, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.light.border, minHeight: 44,
  },
  exportButtonText: { fontSize: 14.5, fontWeight: '700', color: Colors.light.text },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: {
    backgroundColor: Colors.light.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.light.text },
  dangerBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 16,
  },
  dangerText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#78350F', fontWeight: '600' },
  exportLoading: { fontSize: 14, color: Colors.light.textMuted, textAlign: 'center', paddingVertical: 20 },
  exportLabel: { fontSize: 13, fontWeight: '700', color: Colors.light.text, marginBottom: 6 },
  keyBox: {
    backgroundColor: Colors.light.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.light.border, padding: 14, marginBottom: 12,
  },
  keyText: { fontSize: 13, fontFamily: 'monospace', color: Colors.light.text, lineHeight: 20 },
  copyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 13, minHeight: 46,
  },
  copyButtonText: { fontSize: 14.5, fontWeight: '700', color: Colors.light.onPrimary },
  exportHint: { fontSize: 12, color: Colors.light.textMuted, marginTop: 12, lineHeight: 17 },
  doneButton: { alignItems: 'center', paddingVertical: 14, marginTop: 16 },
  doneButtonText: { fontSize: 15, fontWeight: '700', color: Colors.light.textMuted },
});
