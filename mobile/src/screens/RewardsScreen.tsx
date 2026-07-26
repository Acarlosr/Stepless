/**
 * Stepless — Rewards Screen
 *
 * Mostra o saldo em USDC da carteira, a tabela de recompensas por tipo de
 * contribuição e o histórico de contribuições pendentes/pagas do usuário
 * (lidas do backend real via services/api.ts → /api/pending).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { isAddress, type Address } from 'viem';
import { Colors } from '../config/colors';
import { useWallet } from '../services/wallet';
import { fetchPending } from '../services/api';

const ARCSCAN_TX_URL = 'https://testnet.arcscan.app/tx/';
const REWARDS_GUIDE_URL = 'https://www.stepless.lat/como-sacar-recompensas.html';

interface PendingItem {
  user?: string;
  locationHash?: string;
  name?: string | null;
  rewardType?: string;
  status?: string;
  ts?: number;
}

const REWARD_TABLE = [
  { key: 'newlocation', amount: '$0.10' },
  { key: 'verification', amount: '$0.05' },
  { key: 'photoupload', amount: '$0.02' },
  { key: 'firstofmonthbonus', amount: '$5.00' },
] as const;

export default function RewardsScreen() {
  const { t } = useTranslation();
  const { walletAddress, usdcBalance, usdcNativeBalance, refreshBalance, sendUSDC } = useWallet();
  const insets = useSafeAreaInsets();
  const c = Colors.light;

  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ─── Envio de USDC ───
  const [sendVisible, setSendVisible] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);

  // Maior saldo disponível (ERC-20 ou nativo) — usado no botão "Máx"
  const maxSendable = Math.max(Number(usdcBalance || 0), Number(usdcNativeBalance || 0));

  const closeSendModal = useCallback(() => {
    if (sending) return;
    setSendVisible(false);
    setSendTo('');
    setSendAmount('');
  }, [sending]);

  const handleSend = useCallback(async () => {
    const to = sendTo.trim();
    const amount = sendAmount.trim().replace(',', '.');

    if (!isAddress(to)) {
      Alert.alert(t('rewards.send.title'), t('rewards.send.invalidAddress'));
      return;
    }
    const num = Number(amount);
    if (!amount || !Number.isFinite(num) || num <= 0) {
      Alert.alert(t('rewards.send.title'), t('rewards.send.invalidAmount'));
      return;
    }
    if (num > maxSendable) {
      Alert.alert(t('rewards.send.title'), t('rewards.send.insufficient'));
      return;
    }

    setSending(true);
    try {
      const hash = await sendUSDC(to as Address, amount);
      setSending(false);
      setSendVisible(false);
      setSendTo('');
      setSendAmount('');
      Alert.alert(t('rewards.send.success'), t('rewards.send.successMessage'), [
        {
          text: t('rewards.send.viewOnArcscan'),
          onPress: () => Linking.openURL(ARCSCAN_TX_URL + hash),
        },
        { text: 'OK' },
      ]);
    } catch (e: any) {
      setSending(false);
      const code = String(e?.message || '');
      const msg =
        code === 'INSUFFICIENT_FUNDS'
          ? t('rewards.send.insufficient')
          : t('rewards.send.errorGeneric');
      Alert.alert(t('rewards.send.title'), msg);
    }
  }, [sendTo, sendAmount, maxSendable, sendUSDC, t]);

  const load = useCallback(async () => {
    try {
      const all = await fetchPending();
      const mine = walletAddress
        ? all.filter(
            (i: PendingItem) => (i.user || '').toLowerCase() === walletAddress.toLowerCase()
          )
        : [];
      setItems(mine);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshBalance()]);
    setRefreshing(false);
  }, [load, refreshBalance]);

  const pendingCount = items.filter((i) => i.status === 'pending').length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('rewards.title')}</Text>
        </View>

        {/* Saldo */}
        <View style={[styles.balanceCard, { backgroundColor: c.primary }]}>
          <Text style={styles.balanceLabel}>{t('rewards.walletBalance')}</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceValue}>{Number(usdcBalance || 0).toFixed(2)}</Text>
            <Text style={styles.balanceUnit}>USDC</Text>
          </View>
          <View style={styles.pendingChip}>
            <Ionicons name="time-outline" size={14} color={c.onPrimary} />
            <Text style={styles.pendingChipText}>
              {pendingCount} {t('rewards.pending')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.sendButton}
            onPress={() => setSendVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('rewards.send.button')}
          >
            <Ionicons name="paper-plane-outline" size={18} color={c.primary} />
            <Text style={[styles.sendButtonText, { color: c.primary }]}>
              {t('rewards.send.button')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tabela de recompensas */}
        <Text style={[styles.sectionTitle, { color: c.text }]}>{t('rewards.rewardTypes')}</Text>
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          {REWARD_TABLE.map((r, i) => (
            <View
              key={r.key}
              style={[
                styles.rewardRow,
                i < REWARD_TABLE.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border },
              ]}
            >
              <Text style={[styles.rewardType, { color: c.text }]}>
                {t(`rewards.types.${r.key}`)}
              </Text>
              <Text style={[styles.rewardAmount, { color: c.success }]}>{r.amount}</Text>
            </View>
          ))}
        </View>

        {/* Histórico */}
        <Text style={[styles.sectionTitle, { color: c.text }]}>{t('rewards.history')}</Text>
        {loading ? (
          <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={[styles.card, { backgroundColor: c.surface, alignItems: 'center', paddingVertical: 32 }]}>
            <Ionicons name="map-outline" size={40} color={c.textMuted} />
            <Text style={[styles.emptyText, { color: c.textMuted }]}>{t('rewards.noHistory')}</Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: c.surface }]}>
            {items.map((it, i) => (
              <View
                key={(it.locationHash || '') + i}
                style={[
                  styles.histRow,
                  i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border },
                ]}
              >
                <View style={styles.histIcon}>
                  <Ionicons
                    name={it.status === 'pending' ? 'time-outline' : 'checkmark-circle'}
                    size={22}
                    color={it.status === 'pending' ? c.warning : c.success}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.histName, { color: c.text }]} numberOfLines={1}>
                    {it.name || t('rewards.types.newlocation')}
                  </Text>
                  <Text style={[styles.histStatus, { color: c.textMuted }]}>
                    {it.status === 'pending' ? t('map.pending') : t('map.verified')}
                    {it.ts ? ` · ${new Date(it.ts).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <Text style={[styles.histAmount, { color: c.success }]}>$0.10</Text>
              </View>
            ))}
          </View>
        )}

        {/* Como usar as recompensas */}
        <View style={[styles.card, { backgroundColor: c.surface, marginTop: 24, paddingVertical: 16 }]}>
          <View style={styles.helpHeader}>
            <Ionicons name="help-circle-outline" size={20} color={c.primary} />
            <Text style={[styles.helpTitle, { color: c.text }]}>{t('rewards.send.helpTitle')}</Text>
          </View>
          <Text style={[styles.helpText, { color: c.textMuted }]}>{t('rewards.send.helpText')}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(REWARDS_GUIDE_URL)}
            accessibilityRole="link"
            accessibilityLabel={t('rewards.send.helpLink')}
          >
            <Text style={[styles.helpLink, { color: c.primary }]}>{t('rewards.send.helpLink')} →</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.pixNote, { color: c.textMuted }]}>{t('rewards.pixFuture')}</Text>
      </ScrollView>

      {/* ─── Modal: Enviar USDC ─── */}
      <Modal visible={sendVisible} animationType="slide" transparent onRequestClose={closeSendModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { backgroundColor: c.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>{t('rewards.send.title')}</Text>
              <TouchableOpacity
                onPress={closeSendModal}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                disabled={sending}
              >
                <Ionicons name="close" size={26} color={c.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: c.text }]}>{t('rewards.send.toLabel')}</Text>
            <TextInput
              style={[styles.input, { borderColor: c.border, color: c.text }]}
              placeholder={t('rewards.send.toPlaceholder')}
              placeholderTextColor={c.textMuted}
              value={sendTo}
              onChangeText={setSendTo}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!sending}
              accessibilityLabel={t('rewards.send.toLabel')}
            />

            <Text style={[styles.inputLabel, { color: c.text }]}>{t('rewards.send.amountLabel')}</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.input, { borderColor: c.border, color: c.text, flex: 1 }]}
                placeholder={t('rewards.send.amountPlaceholder')}
                placeholderTextColor={c.textMuted}
                value={sendAmount}
                onChangeText={setSendAmount}
                keyboardType="decimal-pad"
                editable={!sending}
                accessibilityLabel={t('rewards.send.amountLabel')}
              />
              <TouchableOpacity
                style={[styles.maxButton, { borderColor: c.primary }]}
                onPress={() => setSendAmount(String(maxSendable))}
                disabled={sending || maxSendable <= 0}
                accessibilityRole="button"
                accessibilityLabel={t('rewards.send.max')}
              >
                <Text style={[styles.maxButtonText, { color: c.primary }]}>{t('rewards.send.max')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.warningBox, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="warning-outline" size={18} color="#B45309" />
              <Text style={styles.warningText}>{t('rewards.send.networkWarning')}</Text>
            </View>

            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: c.primary, opacity: sending ? 0.6 : 1 }]}
              onPress={handleSend}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={sending ? t('rewards.send.sending') : t('rewards.send.confirm')}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmButtonText}>{t('rewards.send.confirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800' },
  balanceCard: { marginHorizontal: 20, marginTop: 12, padding: 24, borderRadius: 20 },
  balanceLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  balanceValue: { fontSize: 40, fontWeight: '800', color: '#FFFFFF' },
  balanceUnit: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  pendingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, marginTop: 14,
  },
  pendingChipText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginHorizontal: 20, marginTop: 24, marginBottom: 12 },
  card: { marginHorizontal: 20, borderRadius: 16, paddingHorizontal: 16 },
  rewardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  rewardType: { fontSize: 15, fontWeight: '600' },
  rewardAmount: { fontSize: 15, fontWeight: '800' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 10 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  histIcon: { width: 36, alignItems: 'center' },
  histName: { fontSize: 15, fontWeight: '700' },
  histStatus: { fontSize: 12, marginTop: 2 },
  histAmount: { fontSize: 15, fontWeight: '800' },
  pixNote: { fontSize: 12, textAlign: 'center', marginHorizontal: 32, marginTop: 20, lineHeight: 18 },
  // ─── Enviar USDC ───
  sendButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 12, marginTop: 16,
    minHeight: 44,
  },
  sendButtonText: { fontSize: 15, fontWeight: '800' },
  helpHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  helpTitle: { fontSize: 15, fontWeight: '700' },
  helpText: { fontSize: 13, lineHeight: 19 },
  helpLink: { fontSize: 14, fontWeight: '700', marginTop: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800' },
  inputLabel: { fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, minHeight: 48,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  maxButton: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    minHeight: 48, justifyContent: 'center',
  },
  maxButtonText: { fontSize: 14, fontWeight: '800' },
  warningBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    borderRadius: 12, padding: 12, marginTop: 16,
  },
  warningText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#78350F' },
  confirmButton: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16, minHeight: 52,
  },
  confirmButtonText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
