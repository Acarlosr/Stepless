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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../config/colors';
import { useWallet } from '../services/wallet';
import { fetchPending } from '../services/api';

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
  const { walletAddress, usdcBalance, refreshBalance } = useWallet();
  const insets = useSafeAreaInsets();
  const c = Colors.light;

  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

        <Text style={[styles.pixNote, { color: c.textMuted }]}>{t('rewards.pixFuture')}</Text>
      </ScrollView>
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
});
