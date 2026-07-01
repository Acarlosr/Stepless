/**
 * Stepless — i18n Translations
 *
 * Supports: pt-BR (Portuguese), en (English), es (Spanish)
 * Auto-detected via expo-localization
 *
 * All UI strings for: login, map, rewards, profile, errors, success messages
 * Accessibility-focused language throughout
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

// ─── Translation Resources ────────────────────────────────────────────
const resources = {
  'pt-BR': {
    translation: {
      // ─── Tabs ───
      tabs: {
        map: 'Mapa',
        rewards: 'Recompensas',
        profile: 'Perfil',
      },

      // ─── Common ───
      common: {
        ok: 'OK',
        cancel: 'Cancelar',
        close: 'Fechar',
        save: 'Salvar',
        loading: 'Carregando...',
        retry: 'Tentar novamente',
        confirm: 'Confirmar',
        back: 'Voltar',
        next: 'Próximo',
        done: 'Concluído',
        yes: 'Sim',
        no: 'Não',
      },

      // ─── Login ───
      login: {
        title: 'Stepless',
        subtitle: 'Mapeamento de Acessibilidade Descentralizado',
        description: 'Ajude a mapear locais acessíveis e ganhe recompensas em USDC',
        signInWithGoogle: 'Entrar com Google',
        signInWithApple: 'Entrar com Apple',
        signInWithEmail: 'Entrar com Email',
        connecting: 'Conectando carteira...',
        walletCreated: 'Carteira criada na Arc Testnet!',
        walletCreatedMessage: 'Sua carteira inteligente está pronta. O Gas Station patrocina suas transações.',
        termsAccepted: 'Ao continuar, você aceita os Termos de Uso e a Política de Privacidade',
        poweredBy: 'Desenvolvido na Arc Testnet',
        welcome: 'Bem-vindo ao Stepless',
      },

      // ─── Map Screen ───
      map: {
        addLocation: 'Adicionar Local Acessível',
        addAccessibleLocation: 'Adicionar Local Acessível',
        locationName: 'Nome do Local',
        locationNamePlaceholder: 'Ex.: Rampas do Shopping Center',
        category: 'Categoria',
        coordinates: 'Coordenadas GPS',
        photo: 'Foto do Local',
        takePhoto: 'Tirar Foto',
        submitLocation: 'Registrar Local',
        updatingGPS: 'Atualizando GPS...',
        updateGPS: 'Atualizar GPS',
        uploadingPhoto: 'Enviando foto para IPFS...',
        registeringOnchain: 'Registrando na blockchain...',
        locationRegistered: 'Local registrado com sucesso!',
        rewardPending: 'Recompensa pendente',
        locationsNearby: 'locais próximos',
        refresh: 'Atualizar',
        verified: 'Verificado',
        pending: 'Pendente',
        mapViewLabel: 'Mapa de locais acessíveis',
        gasStationNote: 'ℹ️ O Gas Station da Arc patrocina as taxas de transação. Você não paga gas.',
        nearbyLocations: 'Locais Próximos',
        noNearbyLocations: 'Nenhum local mapeado próximo. Seja o primeiro!',
        yourLocation: 'Sua Localização',
      },

      // ─── Categories ───
      categories: {
        ramp: 'Rampa de Acesso',
        restroom: 'Banheiro Adaptado',
        parking: 'Vaga Preferencial',
        entrance: 'Entrada Acessível',
      },

      // ─── Rewards Screen ───
      rewards: {
        title: 'Recompensas',
        loading: 'Carregando recompensas...',
        totalEarned: 'Total Ganho',
        walletBalance: 'Saldo da Carteira',
        pending: 'Pendente',
        contributions: 'Contribuições',
        verifications: 'Verificações',
        topContributor: '🏆 Top Contribuidor',
        topContributorMessage: 'Você está entre os principais contribuidores! Bônus ativo.',
        rewardTypes: 'Tipos de Recompensa',
        history: 'Histórico de Recompensas',
        noHistory: 'Nenhuma recompensa ainda. Comece a mapear locais para ganhar!',
        withdraw: 'Sacar',
        withdrawTitle: 'Sacar Recompensas',
        withdrawConfirm: 'Deseja sacar {{amount}} USDC para sua carteira?',
        withdrawSuccess: 'Saque Realizado!',
        withdrawSuccessMessage: 'Seus USDC foram transferidos para sua carteira.',
        noRewards: 'Sem Recompensas',
        noRewardsMessage: 'Você ainda não tem recompensas para sacar.',
        pixFuture: 'Em breve: saque via PIX diretamente para sua conta bancária',
        treasuryBalance: 'Saldo do Tesouro',
        types: {
          newlocation: 'Novo Local',
          verification: 'Verificação',
          photoupload: 'Upload de Foto',
          firstofmonthbonus: 'Bônus Mensal',
        },
      },

      // ─── Profile Screen ───
      profile: {
        title: 'Perfil',
        walletAddress: 'Endereço da Carteira',
        connectedWith: 'Conectado via',
        disconnect: 'Desconectar Carteira',
        disconnectConfirm: 'Tem certeza que deseja desconectar?',
        language: 'Idioma',
        portuguese: 'Português (Brasil)',
        english: 'English',
        spanish: 'Español',
        accessibility: 'Acessibilidade',
        highContrast: 'Alto Contraste',
        largeText: 'Texto Grande',
        screenReader: 'Otimizar para Leitor de Tela',
        reduceMotion: 'Reduzir Animações',
        about: 'Sobre o Stepless',
        aboutText: 'Stepless é uma infraestrutura descentralizada de acessibilidade na Arc Testnet. Mapeie locais acessíveis, verifique contribuições de outros usuários e ganhe micro-recompensas em USDC.',
        version: 'Versão',
        privacyPolicy: 'Política de Privacidade',
        termsOfUse: 'Termos de Uso',
        support: 'Suporte',
        myContributions: 'Minhas Contribuições',
        myVerifications: 'Minhas Verificações',
        memberSince: 'Membro desde',
      },

      // ─── Errors ───
      errors: {
        locationPermissionTitle: 'Permissão de Localização',
        locationPermissionMessage: 'O Stepless precisa de acesso à sua localização para mapear locais acessíveis próximos.',
        cameraPermissionTitle: 'Permissão de Câmera',
        cameraPermissionMessage: 'Precisamos de acesso à câmera para tirar fotos dos locais.',
        cameraError: 'Erro na Câmera',
        cameraErrorMessage: 'Não foi possível acessar a câmera. Tente novamente.',
        noLocationTitle: 'Localização Indisponível',
        noLocationMessage: 'Não foi possível obter sua localização. Verifique se o GPS está ativado.',
        nameRequired: 'Nome Obrigatório',
        nameRequiredMessage: 'Por favor, insira um nome para o local.',
        photoRequired: 'Foto Obrigatória',
        photoRequiredMessage: 'Por favor, tire uma foto do local acessível.',
        walletNotConnected: 'Carteira Não Conectada',
        walletNotConnectedMessage: 'Conecte sua carteira para registrar locais.',
        ipfsUploadFailed: 'Falha ao enviar foto para IPFS. Verifique sua conexão e tente novamente.',
        submitFailed: 'Falha no Registro',
        submitFailedMessage: 'Não foi possível registrar o local na blockchain.',
        withdrawFailed: 'Falha no Saque',
        withdrawFailedMessage: 'Não foi possível sacar as recompensas.',
        networkError: 'Erro de Rede',
        networkErrorMessage: 'Verifique sua conexão com a internet.',
        contractError: 'Erro no Contrato',
        blocklisted: 'Este endereço está bloqueado na Arc e não pode receber recompensas.',
        zeroAddress: 'Endereço inválido.',
        insufficientTreasury: 'O tesouro não tem fundos suficientes. Tente novamente mais tarde.',
        alreadyRegistered: 'Este local já foi registrado.',
        notAuthorized: 'Você não está autorizado a realizar esta ação.',
        alreadyVerified: 'Esta contribuição já foi verificada.',
        gasEstimationFailed: 'Não foi possível estimar o gas. Tente novamente.',
        transactionReverted: 'A transação foi revertida pela blockchain.',
      },

      // ─── Success Messages ───
      success: {
        locationRegistered: 'Local registrado com sucesso! Recompensa de $0.10 USDC a caminho.',
        contributionSubmitted: 'Contribuição enviada! Aguardando verificação.',
        contributionVerified: 'Contribuição verificada! Recompensa de $0.05 USDC creditada.',
        rewardReceived: 'Recompensa recebida!',
        walletConnected: 'Carteira conectada com sucesso!',
        withdrawn: 'Saque realizado com sucesso!',
        photoUploaded: 'Foto enviada para IPFS!',
      },

      // ─── Accessibility Labels ───
      accessibility: {
        mapRegion: 'Região do mapa mostrando locais acessíveis',
        addButton: 'Adicionar novo local acessível',
        locationMarker: 'Marcador de local acessível',
        categoryRamp: 'Categoria: Rampa de Acesso',
        categoryRestroom: 'Categoria: Banheiro Adaptado',
        categoryParking: 'Categoria: Vaga Preferencial',
        categoryEntrance: 'Categoria: Entrada Acessível',
        photoButton: 'Tirar foto do local acessível',
        submitButton: 'Registrar local na blockchain',
        rewardAmount: 'Valor da recompensa em USDC',
        totalEarned: 'Total de USDC ganho',
        withdrawButton: 'Sacar recompensas em USDC',
        historyList: 'Lista de histórico de recompensas',
      },
    },
  },

  'en': {
    translation: {
      // ─── Tabs ───
      tabs: {
        map: 'Map',
        rewards: 'Rewards',
        profile: 'Profile',
      },

      // ─── Common ───
      common: {
        ok: 'OK',
        cancel: 'Cancel',
        close: 'Close',
        save: 'Save',
        loading: 'Loading...',
        retry: 'Retry',
        confirm: 'Confirm',
        back: 'Back',
        next: 'Next',
        done: 'Done',
        yes: 'Yes',
        no: 'No',
      },

      // ─── Login ───
      login: {
        title: 'Stepless',
        subtitle: 'Decentralized Accessibility Mapping',
        description: 'Help map accessible locations and earn USDC rewards',
        signInWithGoogle: 'Sign in with Google',
        signInWithApple: 'Sign in with Apple',
        signInWithEmail: 'Sign in with Email',
        connecting: 'Connecting wallet...',
        walletCreated: 'Wallet created on Arc Testnet!',
        walletCreatedMessage: 'Your smart wallet is ready. Gas Station sponsors your transactions.',
        termsAccepted: 'By continuing, you accept the Terms of Use and Privacy Policy',
        poweredBy: 'Built on Arc Testnet',
        welcome: 'Welcome to Stepless',
      },

      // ─── Map Screen ───
      map: {
        addLocation: 'Add Accessible Location',
        addAccessibleLocation: 'Add Accessible Location',
        locationName: 'Location Name',
        locationNamePlaceholder: 'e.g., Shopping Center Ramps',
        category: 'Category',
        coordinates: 'GPS Coordinates',
        photo: 'Location Photo',
        takePhoto: 'Take Photo',
        submitLocation: 'Register Location',
        updatingGPS: 'Updating GPS...',
        updateGPS: 'Update GPS',
        uploadingPhoto: 'Uploading photo to IPFS...',
        registeringOnchain: 'Registering on blockchain...',
        locationRegistered: 'Location registered successfully!',
        rewardPending: 'Pending reward',
        locationsNearby: 'locations nearby',
        refresh: 'Refresh',
        verified: 'Verified',
        pending: 'Pending',
        mapViewLabel: 'Map of accessible locations',
        gasStationNote: 'ℹ️ Arc Gas Station sponsors transaction fees. You do not pay gas.',
        nearbyLocations: 'Nearby Locations',
        noNearbyLocations: 'No locations mapped nearby. Be the first!',
        yourLocation: 'Your Location',
      },

      // ─── Categories ───
      categories: {
        ramp: 'Access Ramp',
        restroom: 'Adapted Restroom',
        parking: 'Accessible Parking',
        entrance: 'Accessible Entrance',
      },

      // ─── Rewards Screen ───
      rewards: {
        title: 'Rewards',
        loading: 'Loading rewards...',
        totalEarned: 'Total Earned',
        walletBalance: 'Wallet Balance',
        pending: 'Pending',
        contributions: 'Contributions',
        verifications: 'Verifications',
        topContributor: '🏆 Top Contributor',
        topContributorMessage: 'You are among the top contributors! Bonus active.',
        rewardTypes: 'Reward Types',
        history: 'Reward History',
        noHistory: 'No rewards yet. Start mapping locations to earn!',
        withdraw: 'Withdraw',
        withdrawTitle: 'Withdraw Rewards',
        withdrawConfirm: 'Do you want to withdraw {{amount}} USDC to your wallet?',
        withdrawSuccess: 'Withdrawal Complete!',
        withdrawSuccessMessage: 'Your USDC has been transferred to your wallet.',
        noRewards: 'No Rewards',
        noRewardsMessage: 'You have no rewards to withdraw yet.',
        pixFuture: 'Coming soon: withdraw via PIX directly to your bank account',
        treasuryBalance: 'Treasury Balance',
        types: {
          newlocation: 'New Location',
          verification: 'Verification',
          photoupload: 'Photo Upload',
          firstofmonthbonus: 'Monthly Bonus',
        },
      },

      // ─── Profile Screen ───
      profile: {
        title: 'Profile',
        walletAddress: 'Wallet Address',
        connectedWith: 'Connected via',
        disconnect: 'Disconnect Wallet',
        disconnectConfirm: 'Are you sure you want to disconnect?',
        language: 'Language',
        portuguese: 'Português (Brasil)',
        english: 'English',
        spanish: 'Español',
        accessibility: 'Accessibility',
        highContrast: 'High Contrast',
        largeText: 'Large Text',
        screenReader: 'Optimize for Screen Reader',
        reduceMotion: 'Reduce Motion',
        about: 'About Stepless',
        aboutText: 'Stepless is a decentralized accessibility infrastructure on Arc Testnet. Map accessible locations, verify other users\' contributions, and earn micro-rewards in USDC.',
        version: 'Version',
        privacyPolicy: 'Privacy Policy',
        termsOfUse: 'Terms of Use',
        support: 'Support',
        myContributions: 'My Contributions',
        myVerifications: 'My Verifications',
        memberSince: 'Member since',
      },

      // ─── Errors ───
      errors: {
        locationPermissionTitle: 'Location Permission',
        locationPermissionMessage: 'Stepless needs access to your location to map nearby accessible locations.',
        cameraPermissionTitle: 'Camera Permission',
        cameraPermissionMessage: 'We need camera access to take photos of locations.',
        cameraError: 'Camera Error',
        cameraErrorMessage: 'Could not access the camera. Please try again.',
        noLocationTitle: 'Location Unavailable',
        noLocationMessage: 'Could not get your location. Make sure GPS is enabled.',
        nameRequired: 'Name Required',
        nameRequiredMessage: 'Please enter a name for the location.',
        photoRequired: 'Photo Required',
        photoRequiredMessage: 'Please take a photo of the accessible location.',
        walletNotConnected: 'Wallet Not Connected',
        walletNotConnectedMessage: 'Connect your wallet to register locations.',
        ipfsUploadFailed: 'Failed to upload photo to IPFS. Check your connection and try again.',
        submitFailed: 'Registration Failed',
        submitFailedMessage: 'Could not register the location on the blockchain.',
        withdrawFailed: 'Withdrawal Failed',
        withdrawFailedMessage: 'Could not withdraw rewards.',
        networkError: 'Network Error',
        networkErrorMessage: 'Check your internet connection.',
        contractError: 'Contract Error',
        blocklisted: 'This address is blocklisted on Arc and cannot receive rewards.',
        zeroAddress: 'Invalid address.',
        insufficientTreasury: 'Treasury has insufficient funds. Please try again later.',
        alreadyRegistered: 'This location has already been registered.',
        notAuthorized: 'You are not authorized to perform this action.',
        alreadyVerified: 'This contribution has already been verified.',
        gasEstimationFailed: 'Could not estimate gas. Please try again.',
        transactionReverted: 'The transaction was reverted by the blockchain.',
      },

      // ─── Success Messages ───
      success: {
        locationRegistered: 'Location registered successfully! $0.10 USDC reward on the way.',
        contributionSubmitted: 'Contribution submitted! Awaiting verification.',
        contributionVerified: 'Contribution verified! $0.05 USDC reward credited.',
        rewardReceived: 'Reward received!',
        walletConnected: 'Wallet connected successfully!',
        withdrawn: 'Withdrawal completed successfully!',
        photoUploaded: 'Photo uploaded to IPFS!',
      },

      // ─── Accessibility Labels ───
      accessibility: {
        mapRegion: 'Map region showing accessible locations',
        addButton: 'Add new accessible location',
        locationMarker: 'Accessible location marker',
        categoryRamp: 'Category: Access Ramp',
        categoryRestroom: 'Category: Adapted Restroom',
        categoryParking: 'Category: Accessible Parking',
        categoryEntrance: 'Category: Accessible Entrance',
        photoButton: 'Take photo of accessible location',
        submitButton: 'Register location on blockchain',
        rewardAmount: 'Reward amount in USDC',
        totalEarned: 'Total USDC earned',
        withdrawButton: 'Withdraw USDC rewards',
        historyList: 'Reward history list',
      },
    },
  },

  'es': {
    translation: {
      // ─── Tabs ───
      tabs: {
        map: 'Mapa',
        rewards: 'Recompensas',
        profile: 'Perfil',
      },

      // ─── Common ───
      common: {
        ok: 'OK',
        cancel: 'Cancelar',
        close: 'Cerrar',
        save: 'Guardar',
        loading: 'Cargando...',
        retry: 'Reintentar',
        confirm: 'Confirmar',
        back: 'Atrás',
        next: 'Siguiente',
        done: 'Hecho',
        yes: 'Sí',
        no: 'No',
      },

      // ─── Login ───
      login: {
        title: 'Stepless',
        subtitle: 'Mapeo de Accesibilidad Descentralizado',
        description: 'Ayuda a mapear lugares accesibles y gana recompensas en USDC',
        signInWithGoogle: 'Iniciar con Google',
        signInWithApple: 'Iniciar con Apple',
        signInWithEmail: 'Iniciar con Email',
        connecting: 'Conectando billetera...',
        walletCreated: '¡Billetera creada en Arc Testnet!',
        walletCreatedMessage: 'Tu billetera inteligente está lista. Gas Station patrocina tus transacciones.',
        termsAccepted: 'Al continuar, aceptas los Términos de Uso y la Política de Privacidad',
        poweredBy: 'Construido en Arc Testnet',
        welcome: 'Bienvenido a Stepless',
      },

      // ─── Map Screen ───
      map: {
        addLocation: 'Agregar Lugar Accesible',
        addAccessibleLocation: 'Agregar Lugar Accesible',
        locationName: 'Nombre del Lugar',
        locationNamePlaceholder: 'Ej.: Rampas del Centro Comercial',
        category: 'Categoría',
        coordinates: 'Coordenadas GPS',
        photo: 'Foto del Lugar',
        takePhoto: 'Tomar Foto',
        submitLocation: 'Registrar Lugar',
        updatingGPS: 'Actualizando GPS...',
        updateGPS: 'Actualizar GPS',
        uploadingPhoto: 'Subiendo foto a IPFS...',
        registeringOnchain: 'Registrando en blockchain...',
        locationRegistered: '¡Lugar registrado con éxito!',
        rewardPending: 'Recompensa pendiente',
        locationsNearby: 'lugares cercanos',
        refresh: 'Actualizar',
        verified: 'Verificado',
        pending: 'Pendiente',
        mapViewLabel: 'Mapa de lugares accesibles',
        gasStationNote: 'ℹ️ Arc Gas Station patrocina las tarifas de transacción. No pagas gas.',
        nearbyLocations: 'Lugares Cercanos',
        noNearbyLocations: 'No hay lugares mapeados cerca. ¡Sé el primero!',
        yourLocation: 'Tu Ubicación',
      },

      // ─── Categories ───
      categories: {
        ramp: 'Rampa de Acceso',
        restroom: 'Baño Adaptado',
        parking: 'Estacionamiento Preferencial',
        entrance: 'Entrada Accesible',
      },

      // ─── Rewards Screen ───
      rewards: {
        title: 'Recompensas',
        loading: 'Cargando recompensas...',
        totalEarned: 'Total Ganado',
        walletBalance: 'Saldo de Billetera',
        pending: 'Pendiente',
        contributions: 'Contribuciones',
        verifications: 'Verificaciones',
        topContributor: '🏆 Top Contribuidor',
        topContributorMessage: '¡Estás entre los principales contribuidores! Bono activo.',
        rewardTypes: 'Tipos de Recompensa',
        history: 'Historial de Recompensas',
        noHistory: 'No hay recompensas aún. ¡Comienza a mapear lugares para ganar!',
        withdraw: 'Retirar',
        withdrawTitle: 'Retirar Recompensas',
        withdrawConfirm: '¿Deseas retirar {{amount}} USDC a tu billetera?',
        withdrawSuccess: '¡Retiro Completado!',
        withdrawSuccessMessage: 'Tus USDC han sido transferidos a tu billetera.',
        noRewards: 'Sin Recompensas',
        noRewardsMessage: 'Aún no tienes recompensas para retirar.',
        pixFuture: 'Próximamente: retiro vía PIX directamente a tu cuenta bancaria',
        treasuryBalance: 'Saldo del Tesoro',
        types: {
          newlocation: 'Nuevo Lugar',
          verification: 'Verificación',
          photoupload: 'Subida de Foto',
          firstofmonthbonus: 'Bono Mensual',
        },
      },

      // ─── Profile Screen ───
      profile: {
        title: 'Perfil',
        walletAddress: 'Dirección de Billetera',
        connectedWith: 'Conectado vía',
        disconnect: 'Desconectar Billetera',
        disconnectConfirm: '¿Estás seguro de que deseas desconectar?',
        language: 'Idioma',
        portuguese: 'Português (Brasil)',
        english: 'English',
        spanish: 'Español',
        accessibility: 'Accesibilidad',
        highContrast: 'Alto Contraste',
        largeText: 'Texto Grande',
        screenReader: 'Optimizar para Lector de Pantalla',
        reduceMotion: 'Reducir Animaciones',
        about: 'Acerca de Stepless',
        aboutText: 'Stepless es una infraestructura descentralizada de accesibilidad en Arc Testnet. Mapea lugares accesibles, verifica contribuciones de otros usuarios y gana micro-recompensas en USDC.',
        version: 'Versión',
        privacyPolicy: 'Política de Privacidad',
        termsOfUse: 'Términos de Uso',
        support: 'Soporte',
        myContributions: 'Mis Contribuciones',
        myVerifications: 'Mis Verificaciones',
        memberSince: 'Miembro desde',
      },

      // ─── Errors ───
      errors: {
        locationPermissionTitle: 'Permiso de Ubicación',
        locationPermissionMessage: 'Stepless necesita acceso a tu ubicación para mapear lugares accesibles cercanos.',
        cameraPermissionTitle: 'Permiso de Cámara',
        cameraPermissionMessage: 'Necesitamos acceso a la cámara para tomar fotos de los lugares.',
        cameraError: 'Error de Cámara',
        cameraErrorMessage: 'No se pudo acceder a la cámara. Inténtalo de nuevo.',
        noLocationTitle: 'Ubicación No Disponible',
        noLocationMessage: 'No se pudo obtener tu ubicación. Asegúrate de que el GPS esté activado.',
        nameRequired: 'Nombre Requerido',
        nameRequiredMessage: 'Por favor, ingresa un nombre para el lugar.',
        photoRequired: 'Foto Requerida',
        photoRequiredMessage: 'Por favor, toma una foto del lugar accesible.',
        walletNotConnected: 'Billetera No Conectada',
        walletNotConnectedMessage: 'Conecta tu billetera para registrar lugares.',
        ipfsUploadFailed: 'Error al subir foto a IPFS. Verifica tu conexión e inténtalo de nuevo.',
        submitFailed: 'Error de Registro',
        submitFailedMessage: 'No se pudo registrar el lugar en la blockchain.',
        withdrawFailed: 'Error de Retiro',
        withdrawFailedMessage: 'No se pudieron retirar las recompensas.',
        networkError: 'Error de Red',
        networkErrorMessage: 'Verifica tu conexión a internet.',
        contractError: 'Error de Contrato',
        blocklisted: 'Esta dirección está bloqueada en Arc y no puede recibir recompensas.',
        zeroAddress: 'Dirección inválida.',
        insufficientTreasury: 'El tesoro no tiene fondos suficientes. Inténtalo más tarde.',
        alreadyRegistered: 'Este lugar ya ha sido registrado.',
        notAuthorized: 'No estás autorizado para realizar esta acción.',
        alreadyVerified: 'Esta contribución ya ha sido verificada.',
        gasEstimationFailed: 'No se pudo estimar el gas. Inténtalo de nuevo.',
        transactionReverted: 'La transacción fue revertida por la blockchain.',
      },

      // ─── Success Messages ───
      success: {
        locationRegistered: '¡Lugar registrado con éxito! Recompensa de $0.10 USDC en camino.',
        contributionSubmitted: '¡Contribución enviada! Esperando verificación.',
        contributionVerified: '¡Contribución verificada! Recompensa de $0.05 USDC acreditada.',
        rewardReceived: '¡Recompensa recibida!',
        walletConnected: '¡Billetera conectada con éxito!',
        withdrawn: '¡Retiro completado con éxito!',
        photoUploaded: '¡Foto subida a IPFS!',
      },

      // ─── Accessibility Labels ───
      accessibility: {
        mapRegion: 'Región del mapa mostrando lugares accesibles',
        addButton: 'Agregar nuevo lugar accesible',
        locationMarker: 'Marcador de lugar accesible',
        categoryRamp: 'Categoría: Rampa de Acceso',
        categoryRestroom: 'Categoría: Baño Adaptado',
        categoryParking: 'Categoría: Estacionamiento Preferencial',
        categoryEntrance: 'Categoría: Entrada Accesible',
        photoButton: 'Tomar foto del lugar accesible',
        submitButton: 'Registrar lugar en blockchain',
        rewardAmount: 'Monto de recompensa en USDC',
        totalEarned: 'Total de USDC ganado',
        withdrawButton: 'Retirar recompensas en USDC',
        historyList: 'Lista de historial de recompensas',
      },
    },
  },
};

// ─── Initialize i18n with auto language detection ─────────────────────
const getDeviceLanguage = (): string => {
  const locales = Localization.getLocales();
  if (locales.length > 0) {
    const langCode = locales[0].languageCode || 'pt';
    const regionCode = locales[0].regionCode;

    // Check for exact match (e.g., pt-BR)
    if (regionCode) {
      const fullLocale = `${langCode}-${regionCode}`;
      if (resources[fullLocale as keyof typeof resources]) {
        return fullLocale;
      }
    }

    // Fall back to language code only
    if (resources[langCode as keyof typeof resources]) {
      return langCode;
    }
  }

  // Default to Portuguese (Brazil) — Stepless primary market
  return 'pt-BR';
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getDeviceLanguage(),
    fallbackLng: 'pt-BR',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
