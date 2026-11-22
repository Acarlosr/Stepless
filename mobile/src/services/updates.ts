/**
 * Stepless — aviso de nova versão do app.
 *
 * O APK é distribuído pelo GitHub Releases (não pela Play Store), então o
 * Android não atualiza sozinho. Ao abrir, o app consulta a última release
 * publicada; se a versão for mais nova que a instalada, pergunta se a pessoa
 * quer baixar. O download abre no navegador e o Android oferece "Instalar" —
 * a mesma assinatura do EAS garante que instala por cima, sem perder a conta.
 *
 * Silencioso em qualquer falha (sem rede, GitHub fora): nunca atrapalha o uso.
 * Pergunta no máximo uma vez a cada 24 h para a mesma versão.
 */
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

const LATEST_URL = 'https://api.github.com/repos/Acarlosr/Stepless/releases/latest';
const RELEASES_PAGE = 'https://github.com/Acarlosr/Stepless/releases/latest';
const SNOOZE_KEY = 'stepless-update-snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** "v1.3.0" → [1, 3, 0]. Ignora sufixos como "-beta". */
function parse(v: string): number[] {
  return String(v).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

/** true se a for mais nova que b. */
export function isNewer(a: string, b: string): boolean {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

export function useUpdateCheck() {
  const { t } = useTranslation();

  useEffect(() => {
    if (Platform.OS !== 'android') return; // iOS atualiza pela loja/TestFlight
    let cancelled = false;

    (async () => {
      try {
        const installed = Constants.expoConfig?.version;
        if (!installed) return;

        const resp = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!resp.ok) return;
        const rel = await resp.json();
        const latest: string = rel?.tag_name || '';
        if (!latest || !isNewer(latest, installed) || cancelled) return;

        const snooze = JSON.parse((await AsyncStorage.getItem(SNOOZE_KEY)) || 'null');
        if (snooze?.version === latest && Date.now() - snooze.at < SNOOZE_MS) return;

        const apk = (rel.assets || []).find((a: any) => /\.apk$/i.test(a?.name || ''));
        const url: string = apk?.browser_download_url || RELEASES_PAGE;

        Alert.alert(
          t('update.title'),
          t('update.message', { version: latest.replace(/^v/i, ''), current: installed }),
          [
            {
              text: t('update.later'),
              style: 'cancel',
              onPress: () => { AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: latest, at: Date.now() })).catch(() => {}); },
            },
            { text: t('update.download'), onPress: () => { Linking.openURL(url).catch(() => {}); } },
          ],
        );
      } catch {
        /* sem rede ou GitHub indisponível: tenta na próxima abertura */
      }
    })();

    return () => { cancelled = true; };
  }, [t]);
}
