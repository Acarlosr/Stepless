/**
 * Stepless — Decentralized Accessibility Mapping
 * Main App Entry — React Native (Expo)
 *
 * Arc Testnet: Circle's stablecoin-native L1
 * Chain ID: 5042002
 * RPC: https://rpc.testnet.arc.network
 *
 * Navigation: Login → Home (Map) → Rewards → Profile
 * Social login via Crossmint (Google, Apple, Email)
 * WCAG AA color scheme, i18n (pt-BR, en, es)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  StatusBar,
  View,
  ActivityIndicator,
  StyleSheet,
  I18nManager,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme as NavDarkTheme, DefaultTheme as NavDefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import * as Localization from 'expo-localization';
import { useTranslation } from 'react-i18next';
import './src/i18n/translations';

// Services
import { WalletProvider, useWallet } from './src/services/wallet';
import { arcTestnet } from './src/services/contracts';

// Screens
import MapScreen from './src/screens/MapScreen';
import RewardsScreen from './src/screens/RewardsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LoginScreen from './src/screens/LoginScreen';

// ─── WCAG AA Color Palette ────────────────────────────────────────────
// All color combinations meet WCAG AA contrast ratio (≥4.5:1 for text)
export const Colors = {
  light: {
    primary: '#1A56DB',        // Blue 700 — contrast 7.4:1 on white
    primaryLight: '#3B82F6',   // Blue 500
    secondary: '#7C3AED',      // Violet 600
    success: '#15803D',        // Green 700 — 5.9:1 on white
    warning: '#B45309',        // Amber 700 — 5.9:1 on white
    error: '#B91C1C',          // Red 700 — 6.3:1 on white
    background: '#FFFFFF',
    surface: '#F8FAFC',        // Slate 50
    surfaceAlt: '#F1F5F9',     // Slate 100
    text: '#0F172A',           // Slate 900 — 18:1 on white
    textSecondary: '#475569',  // Slate 600 — 7.3:1 on white
    textMuted: '#64748B',      // Slate 500 — 4.6:1 on white
    border: '#CBD5E1',         // Slate 300
    onPrimary: '#FFFFFF',
    mapAccent: '#2563EB',
  },
  dark: {
    primary: '#60A5FA',        // Blue 400 — 8.2:1 on slate 950
    primaryLight: '#93C5FD',
    secondary: '#A78BFA',      // Violet 400
    success: '#4ADE80',        // Green 400 — 7.1:1 on slate 950
    warning: '#FBBF24',        // Amber 400 — 10.1:1 on slate 950
    error: '#F87171',          // Red 400 — 6.5:1 on slate 950
    background: '#0F172A',     // Slate 950
    surface: '#1E293B',        // Slate 800
    surfaceAlt: '#334155',     // Slate 700
    text: '#F1F5F9',           // Slate 100 — 16:1 on slate 950
    textSecondary: '#CBD5E1',  // Slate 300 — 11:1 on slate 950
    textMuted: '#94A3B8',      // Slate 400 — 6.5:1 on slate 950
    border: '#475569',         // Slate 600
    onPrimary: '#0F172A',
    mapAccent: '#60A5FA',
  },
};

// ─── Arc Testnet Configuration ────────────────────────────────────────
export const ARC_TESTNET_CONFIG = {
  chainId: 5042002,
  name: 'Arc Testnet',
  rpcUrl: 'https://rpc.testnet.arc.network',
  blockExplorerUrl: 'https://explorer.testnet.arc.network',
  // USDC on Arc is dual: native (18 dec gas) AND ERC-20 (6 dec transfers)
  usdcNativeDecimals: 18,
  usdcErc20Decimals: 6,
  usdcErc20Address: '0x3600000000000000000000000000000000000000',
  memoContractAddress: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
  // Gas Station sponsors gas — transparent to the app
  gasStationEnabled: true,
};

// ─── Theme ────────────────────────────────────────────────────────────
const useAppTheme = () => {
  const [isDark, setIsDark] = useState(false);
  // Could use useColorScheme() for system detection
  return { isDark, colors: isDark ? Colors.dark : Colors.light, setIsDark };
};

// ─── Bottom Tab Navigator ─────────────────────────────────────────────
export type TabParamList = {
  Map: undefined;
  Rewards: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'map';

          if (route.name === 'Map') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Rewards') {
            iconName = focused ? 'wallet' : 'wallet-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: 4,
          paddingTop: 4,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarLabel: t('tabs.map') }}
      />
      <Tab.Screen
        name="Rewards"
        component={RewardsScreen}
        options={{ tabBarLabel: t('tabs.rewards') }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: t('tabs.profile') }}
      />
    </Tab.Navigator>
  );
}

// ─── Root Stack Navigator ─────────────────────────────────────────────
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { t } = useTranslation();
  const { isWalletConnected, isLoading } = useWallet();
  const { colors } = useAppTheme();

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isWalletConnected ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

// ─── Login Screen (placeholder — full impl in wallet service) ─────────
function LoginScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { connectWallet, isConnecting } = useWallet();

  return (
    <View style={[styles.loginContainer, { backgroundColor: colors.background }]}>
      {/* Full login UI implemented via Crossmint UI components */}
      {/* This is a minimal fallback; the Crossmint provider renders the actual UI */}
    </View>
  );
}

// ─── Profile Screen (minimal — focused on wallet & settings) ──────────
function ProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { walletAddress, disconnectWallet } = useWallet();

  return (
    <View style={[styles.profileContainer, { backgroundColor: colors.background }]}>
      {/* Profile content: wallet address, language settings, accessibility prefs */}
    </View>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────
function AppInner() {
  const { colors } = useAppTheme();
  const navTheme = {
    ...NavDefaultTheme,
    colors: {
      ...NavDefaultTheme.colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
      notification: colors.error,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar
        barStyle={colors.background === '#FFFFFF' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.background}
      />
      <RootNavigator />
    </NavigationContainer>
  );
}

// ─── App Entry ────────────────────────────────────────────────────────
export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await SplashScreen.preventAutoHideAsync();
        // Auto language detection via expo-localization
        const locale = Localization.getLocales()[0];
        const langCode = locale?.languageCode || 'pt';
        // i18n initialized in translations.ts with auto-detection
        // Force RTL if needed
        if (locale?.textDirection === 'rtl' && !I18nManager.isRTL) {
          I18nManager.forceRTL(true);
        }
      } catch (e) {
        console.warn('App preparation error:', e);
      } finally {
        setAppIsReady(true);
        await SplashScreen.hideAsync();
      }
    }
    prepare();
  }, []);

  if (!appIsReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WalletProvider>
          <AppInner />
        </WalletProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  profileContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
});
