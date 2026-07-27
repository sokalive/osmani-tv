import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { resolveProfileAvatarStyle } from '../lib/profileAvatarStyle';

/**
 * Circular cartoon profile avatar — deterministic from seed, no upload.
 *
 * @param {{ seed?: string; size?: number; style?: object }} props
 */
export default function ProfileAvatar({ seed = '', size = 52, style }) {
  const avatar = useMemo(() => resolveProfileAvatarStyle(seed), [seed]);
  const faceSize = size * 0.62;
  const eyeSize = Math.max(3, size * 0.09);
  const r = size / 2;

  return (
    <View style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden' }, style]}>
      <LinearGradient
        colors={avatar.bg}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {avatar.hairStyle !== 'none' ? (
        <View
          style={[
            styles.hair,
            {
              backgroundColor: avatar.hair,
              width: size * (avatar.hairStyle === 'side' ? 0.78 : 0.7),
              height: size * (avatar.hairStyle === 'top' ? 0.28 : 0.34),
              top: size * (avatar.hairStyle === 'top' ? 0.06 : 0.08),
              borderRadius: size * 0.2,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.face,
          {
            width: faceSize,
            height: faceSize,
            borderRadius: faceSize / 2,
            backgroundColor: avatar.skin,
            marginTop: size * (avatar.hairStyle === 'none' ? 0.2 : 0.26),
          },
        ]}
      >
        <View style={[styles.eyeRow, { marginTop: faceSize * 0.32, gap: faceSize * 0.18 }]}>
          <View
            style={{
              width: eyeSize,
              height: eyeSize,
              borderRadius: eyeSize / 2,
              backgroundColor: avatar.eye,
            }}
          />
          <View
            style={{
              width: eyeSize,
              height: eyeSize,
              borderRadius: eyeSize / 2,
              backgroundColor: avatar.eye,
            }}
          />
        </View>
        {avatar.accessory === 'blush' ? (
          <View style={[styles.blushRow, { marginTop: faceSize * 0.06 }]}>
            <View style={[styles.blush, { backgroundColor: 'rgba(244,114,182,0.45)' }]} />
            <View style={[styles.blush, { backgroundColor: 'rgba(244,114,182,0.45)' }]} />
          </View>
        ) : null}
        {avatar.accessory === 'glasses' ? (
          <View style={[styles.glassesRow, { top: faceSize * 0.28 }]}>
            <View style={[styles.lens, { borderColor: avatar.eye }]} />
            <View style={[styles.bridge, { backgroundColor: avatar.eye }]} />
            <View style={[styles.lens, { borderColor: avatar.eye }]} />
          </View>
        ) : null}
        <View
          style={[
            styles.mouth,
            avatar.mouth === 'grin' && styles.mouthGrin,
            avatar.mouth === 'open' && styles.mouthOpen,
            avatar.mouth === 'calm' && styles.mouthCalm,
            {
              marginTop: faceSize * (avatar.accessory === 'blush' ? 0.08 : 0.14),
              borderColor: avatar.mouth === 'open' ? '#9F1239' : '#7F1D1D',
              backgroundColor: avatar.mouth === 'open' ? '#BE123C' : 'transparent',
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hair: {
    position: 'absolute',
    alignSelf: 'center',
  },
  face: {
    alignSelf: 'center',
    alignItems: 'center',
  },
  eyeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blushRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '72%',
  },
  blush: {
    width: 8,
    height: 5,
    borderRadius: 4,
  },
  glassesRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  lens: {
    width: 12,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bridge: {
    width: 4,
    height: 1.5,
  },
  mouth: {
    width: 12,
    height: 6,
    borderBottomWidth: 2,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  mouthGrin: {
    width: 14,
    height: 7,
  },
  mouthOpen: {
    width: 8,
    height: 7,
    borderRadius: 4,
    borderBottomWidth: 0,
  },
  mouthCalm: {
    width: 10,
    height: 3,
    borderBottomWidth: 1.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
