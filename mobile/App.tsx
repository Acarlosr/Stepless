/**
 * Stepless — Decentralized Accessibility Mapping
 * Main App Entry — React Native (Expo)
 *
 * Arc Testnet: Circle's stablecoin-native L1
 * Chain ID: 5042002
 * RPC: https://rpc.testnet.arc.network
 *
 * Navigation: Login → Home (Map) → Rewards → Profile
 * Carteira embarcada (viem + expo-secure-store) — recebe USDC; relayer paga o gas
 * WCAG AA color scheme, i18n (pt-BR, en, es)
 */

import 'react-native-get-random-values'; // polyfill de crypto p/ viem (deve vir 1º)
import 'fast-text-encoding'; // polyfill de TextEncoder/TextDecoder p/ viem (Hermes não tem nativo)
import React, { useEffect, useState } from 'react';
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
import { Colors } from './src/config/colors';
import { ARC_TESTNET_CONFIG } from './src/config/arc';

// Services
import { WalletProvider, useWallet } from './src/services/wallet';
import { arcTestnet } from './src/services/contracts';

// Screens
import MapScreen from './src/screens/MapScreen';
import RewardsScreen from './src/screens/RewardsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LoginScreen from './src/screens/LoginScreen';

// ─── WCAG AA Color Palette / Arc Testnet Configuration ────────────────
// Movidas para src/config/colors.ts e src/config/arc.ts para evitar import
// circular (telas e services importavam de volta daqui, causando valores
// `undefined` no Hermes dependendo da ordem de inicialização dos módulos).
// Importadas acima e re-exportadas aqui só por compatibilidade — outros
// módulos devem importar diretamente de 'src/config/colors' / 'src/config/arc',
// nunca de './App'.
export { Colors, ARC_TESTNET_CONFIG };

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
