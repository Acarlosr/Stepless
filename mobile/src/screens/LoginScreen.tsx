/**
 * Stepless — Login Screen
 *
 * Cria/abre a carteira embarcada (ver services/wallet.ts). O usuário não
 * precisa de seed phrase nem extensão: um toque cria uma carteira local
 * segura, cujo endereço serve para receber as recompensas em USDC.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../config/colors';
import { useWallet } from '../services/wallet';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { connectWallet, isConnecting, error } = useWallet();
  const c = Colors.light;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        {/* Marca */}
        <View style={styles.logoCircle}>
          <Image
            source={require('../../assets/robot.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessible
            accessibilityLabel="Stepless"
          />
        </View>
        <Text style={[styles.title, { color: c.text }]}>{t('login.title')}</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {t('login.subtitle')}
        </Text>
        <Text style={[styles.description, { color: c.textMuted }]}>
          {t('login.description')}
        </Text>

        {/* Destaques */}
        <View style={styles.bullets}>
          {[
            { icon: 'cash-outline' as const, text: 'USDC' },
            { icon: 'flash-outline' as const, text: 'Arc Testnet' },
            { icon: 'lock-closed-outline' as const, text: '100% on-chain' },
          ].map((b) => (
            <View key={b.text} style={styles.bullet}>
              <Ionicons name={b.icon} size={18} color={c.primary} />
              <Text style={[styles.bulletText, { color: c.textSecondary }]}>{b.text}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Ação */}
      <View style={styles.footer}>
        {error ? <Text style={[styles.error, { color: c.error }]}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, { backgroundColor: c.primary, opacity: isConnecting ? 0.7 : 1 }]}
          onPress={() => connectWallet()}
          disabled={isConnecting}
          accessibilityRole="button"
          accessibilityLabel={t('login.welcome')}
        >
          {isConnecting ? (
            <ActivityIndicator color={c.onPrimary} />
          ) : (
            <>
              <Ionicons name="wallet-outline" size={20} color={c.onPrimary} />
              <Text style={[styles.buttonText, { color: c.onPrimary }]}>
                {t('login.welcome')}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={[styles.terms, { color: c.textMuted }]}>
          {t('login.termsAccepted')}
        </Text>
        <Text style={[styles.poweredBy, { color: c.textMuted }]}>
          {t('login.poweredBy')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logoCircle: {
    width: 132, height: 132, borderRadius: 66,
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
    backgroundColor: '#EAF2FE',
  },
  logoImage: { width: 76, height: 112 },
  title: { fontSize: 36, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  description: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  bullets: { flexDirection: 'row', gap: 20 },
  bullet: { alignItems: 'center', gap: 6 },
  bulletText: { fontSize: 12, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingBottom: 12 },
  error: { fontSize: 13, textAlign: 'center', marginBottom: 12 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: 16,
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
  terms: { fontSize: 11, textAlign: 'center', marginTop: 14, lineHeight: 16 },
  poweredBy: { fontSize: 11, textAlign: 'center', marginTop: 8, fontWeight: '600' },
});
