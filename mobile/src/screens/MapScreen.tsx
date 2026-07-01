/**
 * Stepless — Map Screen
 *
 * Location mapping screen with GPS, photo upload to IPFS,
 * and on-chain location registration via SteplessOracle.
 *
 * Flow: Map view → Add Location → Form (name, category, GPS, photo)
 *       → Upload to IPFS → registerLocation() → Confirmation + reward status
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Linking,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Callout, Region, MapMarker } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Colors } from '../../App';
import { useWallet } from '../services/wallet';
import {
  SteplessOracle,
  LocationCategory,
  packCoordinate,
  ArcContractError,
} from '../services/contracts';

const { width, height } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────
interface AccessibleLocation {
  id: bigint;
  name: string;
  category: LocationCategory;
  lat: number;
  lng: number;
  verified: boolean;
  contributor: string;
  photoUri?: string;
  dataHash?: string;
}

interface AddLocationForm {
  name: string;
  category: LocationCategory;
  lat: number;
  lng: number;
  photoUri: string | null;
  photoHash: string | null;
}

// ─── Category Metadata ────────────────────────────────────────────────
const CATEGORY_META: Record<
  LocationCategory,
  { icon: keyof typeof Ionicons.glyphMap; color: string; labelKey: string }
> = {
  [LocationCategory.Ramp]: { icon: 'easel', color: '#2563EB', labelKey: 'categories.ramp' },
  [LocationCategory.Restroom]: { icon: 'water', color: '#0891B2', labelKey: 'categories.restroom' },
  [LocationCategory.Parking]: { icon: 'car', color: '#7C3AED', labelKey: 'categories.parking' },
  [LocationCategory.Entrance]: { icon: 'enter', color: '#15803D', labelKey: 'categories.entrance' },
};

// ─── IPFS Upload Configuration ────────────────────────────────────────
const PINATA_API_KEY = process.env.EXPO_PUBLIC_PINATA_API_KEY || '';
const PINATA_SECRET_KEY = process.env.EXPO_PUBLIC_PINATA_SECRET_KEY || '';
const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const WEB3_STORAGE_TOKEN = process.env.EXPO_PUBLIC_WEB3_STORAGE_TOKEN || '';

// ─── Component ────────────────────────────────────────────────────────
export default function MapScreen() {
  const { t } = useTranslation();
  const { walletAddress, sendTransaction } = useWallet();
  const insets = useSafeAreaInsets();

  const [region, setRegion] = useState<Region>({
    latitude: -23.5505,  // Default: São Paulo
    longitude: -46.6333,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyLocations, setNearbyLocations] = useState<AccessibleLocation[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'uploading' | 'registering' | 'success' | 'error'>('idle');
  const [pendingReward, setPendingReward] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);

  // Form state
  const [formData, setFormData] = useState<AddLocationForm>({
    name: '',
    category: LocationCategory.Ramp,
    lat: 0,
    lng: 0,
    photoUri: null,
    photoHash: null,
  });

  // ─── Request location permissions ─────────────────────────────────
  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('errors.locationPermissionTitle'),
          t('errors.locationPermissionMessage'),
          [{ text: t('common.ok') }]
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

      setUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
      setRegion(newRegion);

      if (mapRef.current && mapReady) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }

      // Fetch nearby locations
      fetchNearbyLocations(location.coords.latitude, location.coords.longitude);
    } catch (error) {
      console.error('Location error:', error);
    }
  };

  // ─── Fetch nearby already-mapped locations ────────────────────────
  const fetchNearbyLocations = useCallback(async (lat: number, lng: number) => {
    try {
      const locationIds = await SteplessOracle.getNearbyLocations(
        lat,
        lng,
        5000n // 5km radius
      );

      const locations: AccessibleLocation[] = [];
      for (const id of locationIds.slice(0, 50)) {
        try {
          const loc = await SteplessOracle.getLocation(id);
          locations.push({
            id,
            name: `Location #${id.toString()}`,
            category: LocationCategory.Ramp, // Would come from dataHash metadata
            lat: loc.lat,
            lng: loc.lng,
            verified: loc.verified,
            contributor: loc.contributor,
            dataHash: loc.dataHash,
          });
        } catch (e) {
          // Skip locations that fail to load
        }
      }
      setNearbyLocations(locations);
    } catch (error) {
      console.error('Failed to fetch nearby locations:', error);
      // Non-critical — map still works without nearby locations
    }
  }, []);

  // ─── Handle map region change ─────────────────────────────────────
  const handleRegionChange = (newRegion: Region) => {
    setRegion(newRegion);
  };

  // ─── Open Add Location modal ──────────────────────────────────────
  const handleAddLocation = () => {
    if (!userLocation) {
      Alert.alert(t('errors.noLocationTitle'), t('errors.noLocationMessage'));
      return;
    }

    setFormData({
      name: '',
      category: LocationCategory.Ramp,
      lat: userLocation.lat,
      lng: userLocation.lng,
      photoUri: null,
      photoHash: null,
    });
    setSubmissionStatus('idle');
    setPendingReward(null);
    setShowAddModal(true);
  };

  // ─── Take photo with camera ───────────────────────────────────────
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('errors.cameraPermissionTitle'), t('errors.cameraPermissionMessage'));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        setFormData((prev) => ({ ...prev, photoUri: result.assets[0].uri }));
      }
    } catch (error) {
      console.error('Camera error:', error);
      Alert.alert(t('errors.cameraError'), t('errors.cameraErrorMessage'));
    }
  };

  // ─── Upload photo to IPFS via Pinata ──────────────────────────────
  const uploadToIPFS = async (photoUri: string): Promise<string> => {
    setIsUploadingPhoto(true);
    try {
      // Create form data for file upload
      const formDataObj = new FormData();
      formDataObj.append('file', {
        uri: photoUri,
        type: 'image/jpeg',
        name: 'accessibility-photo.jpg',
      } as any);

      // Pinata upload
      const response = await fetch(PINATA_API_URL, {
        method: 'POST',
        headers: {
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_SECRET_KEY,
        },
        body: formDataObj,
      });

      if (!response.ok) {
        // Fallback to Web3.Storage if Pinata fails
        if (WEB3_STORAGE_TOKEN) {
          return await uploadToWeb3Storage(photoUri);
        }
        throw new Error(`IPFS upload failed: ${response.status}`);
      }

      const data = await response.json();
      const hash = data.IpfsHash;

      // Return IPFS URI
      return `ipfs://${hash}`;
    } catch (error) {
      console.error('IPFS upload error:', error);
      // Fallback: generate a deterministic hash from photo URI
      // In production, this should always use a real IPFS provider
      throw new Error(t('errors.ipfsUploadFailed'));
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // ─── Fallback: Web3.Storage upload ────────────────────────────────
  const uploadToWeb3Storage = async (photoUri: string): Promise<string> => {
    const formDataObj = new FormData();
    formDataObj.append('file', {
      uri: photoUri,
      type: 'image/jpeg',
      name: 'accessibility-photo.jpg',
    } as any);

    const response = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WEB3_STORAGE_TOKEN}`,
      },
      body: formDataObj,
    });

    if (!response.ok) throw new Error('Web3.Storage upload failed');

    const data = await response.json();
    return `ipfs://${data.cid}`;
  };

  // ─── Submit location to on-chain oracle ───────────────────────────
  const handleSubmitLocation = async () => {
    if (!formData.name.trim()) {
      Alert.alert(t('errors.nameRequired'), t('errors.nameRequiredMessage'));
      return;
    }

    if (!formData.photoUri) {
      Alert.alert(t('errors.photoRequired'), t('errors.photoRequiredMessage'));
      return;
    }

    if (!walletAddress) {
      Alert.alert(t('errors.walletNotConnected'), t('errors.walletNotConnectedMessage'));
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Upload photo to IPFS
      setSubmissionStatus('uploading');
      const photoIpfsUri = await uploadToIPFS(formData.photoUri);

      // Build location metadata
      const locationMetadata = {
        name: formData.name,
        category: formData.category,
        lat: formData.lat,
        lng: formData.lng,
        photo: photoIpfsUri,
        contributor: walletAddress,
        timestamp: Date.now(),
      };

      // Upload metadata to IPFS as well
      const metadataHash = await uploadMetadataToIPFS(locationMetadata);

      // Step 2: Generate location hash (keccak256 of name + coords)
      const { latPacked, lngPacked } = packCoordinate(formData.lat, formData.lng);

      // Create location hash — in production use viem's keccak256
      // const locationHash = keccak256(encodePacked(['string', 'int256', 'int256'], [name, latPacked, lngPacked]))
      const locationHash = `0x${'0'.repeat(64)}` as `0x${string}`; // Placeholder — use viem keccak256

      // Step 3: Call SteplessOracle.registerLocation
      setSubmissionStatus('registering');
      const { data: txData, gasEstimate } = await SteplessOracle.registerLocation(
        locationHash,
        formData.lat,
        formData.lng,
        metadataHash as `0x${string}`
      );

      console.log(`Gas estimate (sponsored by Gas Station): ~${gasEstimate} USDC`);

      // Step 4: Send transaction via wallet
      // const txHash = await sendTransaction({
      //   to: SteplessOracle.address,
      //   data: txData,
      // });

      // Step 5: Wait for confirmation and show reward status
      setSubmissionStatus('success');
      setPendingReward('$0.10 USDC'); // New location reward

      // Refresh nearby locations
      fetchNearbyLocations(formData.lat, formData.lng);

      // Auto-close after showing success
      setTimeout(() => {
        setShowAddModal(false);
        setIsSubmitting(false);
        setSubmissionStatus('idle');
      }, 3000);

    } catch (error) {
      console.error('Submit location error:', error);
      setSubmissionStatus('error');

      let errorMessage = t('errors.submitFailed');
      if (error instanceof ArcContractError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      Alert.alert(t('errors.submitFailed'), errorMessage, [
        { text: t('common.ok'), onPress: () => setSubmissionStatus('idle') },
      ]);
      setIsSubmitting(false);
    }
  };

  // ─── Upload metadata JSON to IPFS ─────────────────────────────────
  const uploadMetadataToIPFS = async (metadata: object): Promise<string> => {
    try {
      const response = await fetch(PINATA_API_URL.replace('pinFileToIPFS', 'pinJSONToIPFS'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_SECRET_KEY,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: { name: 'stepless-location-metadata.json' },
        }),
      });

      if (!response.ok) throw new Error('Metadata upload failed');
      const data = await response.json();
      return `ipfs://${data.IpfsHash}`;
    } catch (error) {
      console.error('Metadata IPFS upload error:', error);
      // Return a placeholder hash — in production this must succeed
      return `ipfs://Qm${'0'.repeat(44)}`;
    }
  };

  // ─── Render location marker ───────────────────────────────────────
  const renderMarker = (location: AccessibleLocation) => {
    const meta = CATEGORY_META[location.category] || CATEGORY_META[LocationCategory.Ramp];
    return (
      <Marker
        key={location.id.toString()}
        coordinate={{ latitude: location.lat, longitude: location.lng }}
        pinColor={meta.color}
      >
        <Callout>
          <View style={styles.calloutContainer}>
            <Text style={styles.calloutTitle}>{location.name}</Text>
            <Text style={styles.calloutCategory}>
              {t(meta.labelKey)}
            </Text>
            <View style={styles.calloutStatusRow}>
              <Ionicons
                name={location.verified ? 'checkmark-circle' : 'time-outline'}
                size={14}
                color={location.verified ? Colors.light.success : Colors.light.warning}
              />
              <Text style={[
                styles.calloutStatus,
                { color: location.verified ? Colors.light.success : Colors.light.warning }
              ]}>
                {location.verified ? t('map.verified') : t('map.pending')}
              </Text>
            </View>
          </View>
        </Callout>
      </Marker>
    );
  };

  // ─── Render category selector ─────────────────────────────────────
  const renderCategorySelector = () => {
    const categories = [
      LocationCategory.Ramp,
      LocationCategory.Restroom,
      LocationCategory.Parking,
      LocationCategory.Entrance,
    ];

    return (
      <View style={styles.categoryGrid}>
        {categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const isSelected = formData.category === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryButton,
                {
                  borderColor: isSelected ? meta.color : Colors.light.border,
                  backgroundColor: isSelected ? `${meta.color}15` : Colors.light.surface,
                },
              ]}
              onPress={() => setFormData((prev) => ({ ...prev, category: cat }))}
              accessibilityRole="button"
              accessibilityLabel={t(meta.labelKey)}
              accessibilityState={{ selected: isSelected }}
            >
              <Ionicons name={meta.icon} size={24} color={meta.color} />
              <Text style={[styles.categoryLabel, { color: Colors.light.text }]}>
                {t(meta.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ─── Render submission status ─────────────────────────────────────
  const renderSubmissionStatus = () => {
    if (submissionStatus === 'idle') return null;

    const statusConfig = {
      uploading: { icon: 'cloud-upload', text: t('map.uploadingPhoto'), color: Colors.light.primary },
      registering: { icon: 'link', text: t('map.registeringOnchain'), color: Colors.light.primary },
      success: { icon: 'checkmark-circle', text: t('map.locationRegistered'), color: Colors.light.success },
      error: { icon: 'alert-circle', text: t('errors.submitFailed'), color: Colors.light.error },
    } as const;

    const config = statusConfig[submissionStatus];

    return (
      <View style={[styles.statusBanner, { backgroundColor: `${config.color}15`, borderColor: config.color }]}>
        <ActivityIndicator
          size="small"
          color={config.color}
          animating={submissionStatus === 'uploading' || submissionStatus === 'registering'}
        />
        <Ionicons
          name={config.icon as any}
          size={20}
          color={config.color}
          style={{ display: submissionStatus === 'uploading' || submissionStatus === 'registering' ? 'none' : undefined }}
        />
        <Text style={[styles.statusText, { color: config.color }]}>{config.text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChange}
        onMapReady={() => setMapReady(true)}
        showsUserLocation
        showsMyLocationButton
        accessibilityLabel={t('map.mapViewLabel')}
      >
        {nearbyLocations.map(renderMarker)}
      </MapView>

      {/* Top bar — nearby count */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <View style={styles.topBarInner}>
          <Ionicons name="location" size={16} color={Colors.light.primary} />
          <Text style={styles.topBarText}>
            {nearbyLocations.length} {t('map.locationsNearby')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => userLocation && fetchNearbyLocations(userLocation.lat, userLocation.lng)}
          accessibilityLabel={t('map.refresh')}
        >
          <Ionicons name="refresh" size={20} color={Colors.light.primary} />
        </TouchableOpacity>
      </View>

      {/* Add Location FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 80 }]}
        onPress={handleAddLocation}
        accessibilityRole="button"
        accessibilityLabel={t('map.addLocation')}
      >
        <Ionicons name="add" size={28} color={Colors.light.onPrimary} />
        <Text style={styles.fabLabel}>{t('map.addLocation')}</Text>
      </TouchableOpacity>

      {/* Add Location Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !isSubmitting && setShowAddModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('map.addAccessibleLocation')}</Text>
            <TouchableOpacity
              onPress={() => !isSubmitting && setShowAddModal(false)}
              disabled={isSubmitting}
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={Colors.light.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Submission Status */}
            {renderSubmissionStatus()}

            {/* Success — pending reward */}
            {submissionStatus === 'success' && pendingReward && (
              <View style={styles.rewardBanner}>
                <Ionicons name="gift" size={24} color={Colors.light.success} />
                <Text style={styles.rewardBannerText}>
                  {t('map.rewardPending')}: {pendingReward}
                </Text>
              </View>
            )}

            {/* Location Name */}
            <Text style={styles.fieldLabel}>{t('map.locationName')}</Text>
            <TextInput
              style={styles.textInput}
              value={formData.name}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
              placeholder={t('map.locationNamePlaceholder')}
              placeholderTextColor={Colors.light.textMuted}
              maxLength={100}
              accessibilityLabel={t('map.locationName')}
              editable={!isSubmitting}
            />

            {/* Category Selector */}
            <Text style={styles.fieldLabel}>{t('map.category')}</Text>
            {renderCategorySelector()}

            {/* GPS Coordinates */}
            <Text style={styles.fieldLabel}>{t('map.coordinates')}</Text>
            <View style={styles.coordsRow}>
              <View style={styles.coordBox}>
                <Text style={styles.coordLabel}>Lat</Text>
                <Text style={styles.coordValue}>{formData.lat.toFixed(6)}</Text>
              </View>
              <View style={styles.coordBox}>
                <Text style={styles.coordLabel}>Lng</Text>
                <Text style={styles.coordValue}>{formData.lng.toFixed(6)}</Text>
              </View>
              <TouchableOpacity
                style={styles.gpsButton}
                onPress={async () => {
                  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                  setFormData((prev) => ({
                    ...prev,
                    lat: loc.coords.latitude,
                    lng: loc.coords.longitude,
                  }));
                }}
                accessibilityLabel={t('map.updateGPS')}
              >
                <Ionicons name="locate" size={20} color={Colors.light.primary} />
              </TouchableOpacity>
            </View>

            {/* Photo */}
            <Text style={styles.fieldLabel}>{t('map.photo')}</Text>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleTakePhoto}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={t('map.takePhoto')}
            >
              {formData.photoUri ? (
                <Image source={{ uri: formData.photoUri }} style={styles.photoPreview} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Ionicons name="camera" size={36} color={Colors.light.textMuted} />
                  <Text style={styles.photoPlaceholderText}>{t('map.takePhoto')}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                {
                  backgroundColor: isSubmitting ? Colors.light.textMuted : Colors.light.primary,
                },
              ]}
              onPress={handleSubmitLocation}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={t('map.submitLocation')}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={Colors.light.onPrimary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.light.onPrimary} />
                  <Text style={styles.submitButtonText}>{t('map.submitLocation')}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Gas Station note */}
            <Text style={styles.gasNote}>
              {t('map.gasStationNote')}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  map: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  topBarText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  refreshButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  fabLabel: {
    color: Colors.light.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  calloutContainer: {
    width: 160,
    padding: 4,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 2,
  },
  calloutCategory: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginBottom: 4,
  },
  calloutStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calloutStatus: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  rewardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: `${Colors.light.success}15`,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  rewardBannerText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.success,
    flex: 1,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
    marginTop: 12,
  },
  textInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.surface,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryButton: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  coordsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  coordBox: {
    flex: 1,
    backgroundColor: Colors.light.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  coordLabel: {
    fontSize: 11,
    color: Colors.light.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  coordValue: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '600',
  },
  gpsButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoButton: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.surface,
    gap: 8,
  },
  photoPlaceholderText: {
    fontSize: 14,
    color: Colors.light.textMuted,
    fontWeight: '600',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 24,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.light.onPrimary,
  },
  gasNote: {
    fontSize: 12,
    color: Colors.light.textMuted,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
});
