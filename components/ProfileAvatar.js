import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { resolveProfileAvatarStyle } from '../lib/profileAvatarStyle';

/**
 * Circular human-style cartoon profile avatar — deterministic from seed, no upload.
 *
 * @param {{ seed?: string; size?: number; style?: object }} props
 */
export default function ProfileAvatar({ seed = '', size = 52, style }) {
  const avatar = useMemo(() => resolveProfileAvatarStyle(seed), [seed]);
  const r = size / 2;
  const faceW = size * 0.58;
  const faceH = size * 0.64;
  const eyeW = Math.max(4.5, size * 0.11);
  const eyeH = Math.max(5, size * 0.13);
  const pupil = Math.max(2.2, size * 0.055);
  const { hair: hairStyle, gender } = avatar.presentation;
  const isFemale = gender === 'female';

  return (
    <View style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden' }, style]}>
      <LinearGradient
        colors={avatar.bg}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft studio highlight */}
      <LinearGradient
        colors={['rgba(255,255,255,0.22)', 'transparent']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.7, y: 0.55 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Shirt / shoulders */}
      <View
        style={[
          styles.shirt,
          {
            backgroundColor: avatar.shirt,
            width: size * 0.92,
            height: size * 0.34,
            bottom: -size * 0.02,
            borderTopLeftRadius: size * 0.35,
            borderTopRightRadius: size * 0.35,
          },
        ]}
      />
      <View
        style={[
          styles.collar,
          {
            borderTopColor: avatar.shirt,
            borderLeftWidth: size * 0.12,
            borderRightWidth: size * 0.12,
            borderTopWidth: size * 0.1,
            bottom: size * 0.22,
          },
        ]}
      />

      {/* Neck */}
      <View
        style={[
          styles.neck,
          {
            backgroundColor: avatar.skin,
            width: size * 0.2,
            height: size * 0.14,
            bottom: size * 0.26,
          },
        ]}
      />

      {/* Back / long hair behind head */}
      {hairStyle === 'long' || hairStyle === 'waves' || hairStyle === 'pony' ? (
        <View
          style={[
            styles.hairBack,
            {
              backgroundColor: avatar.hair,
              width: size * (hairStyle === 'pony' ? 0.34 : 0.72),
              height: size * (hairStyle === 'pony' ? 0.42 : 0.48),
              top: size * 0.28,
              left: hairStyle === 'pony' ? size * 0.58 : size * 0.14,
              borderRadius: size * 0.2,
              opacity: hairStyle === 'waves' ? 0.95 : 1,
            },
          ]}
        />
      ) : null}
      {hairStyle === 'pony' ? (
        <View
          style={[
            styles.hairBack,
            {
              backgroundColor: avatar.hair,
              width: size * 0.34,
              height: size * 0.42,
              top: size * 0.28,
              left: size * 0.08,
              borderRadius: size * 0.2,
            },
          ]}
        />
      ) : null}

      {/* Head */}
      <View
        style={[
          styles.head,
          {
            width: faceW,
            height: faceH,
            borderRadius: faceW * (isFemale ? 0.48 : 0.44),
            backgroundColor: avatar.skin,
            marginTop: size * (hairStyle === 'bald' ? 0.18 : 0.2),
          },
        ]}
      >
        {/* Ears */}
        <View
          style={[
            styles.ear,
            {
              backgroundColor: avatar.skin,
              width: size * 0.1,
              height: size * 0.14,
              left: -size * 0.06,
              top: faceH * 0.38,
              borderRadius: size * 0.05,
            },
          ]}
        />
        <View
          style={[
            styles.ear,
            {
              backgroundColor: avatar.skin,
              width: size * 0.1,
              height: size * 0.14,
              right: -size * 0.06,
              top: faceH * 0.38,
              borderRadius: size * 0.05,
            },
          ]}
        />

        {/* Bangs / top hair on head */}
        {hairStyle !== 'bald' ? (
          <View
            style={[
              styles.hairTop,
              hairTopStyle(hairStyle, size, avatar.hair, faceW),
            ]}
          />
        ) : null}
        {hairStyle === 'bun' ? (
          <View
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: -size * 0.1,
              width: size * 0.22,
              height: size * 0.22,
              borderRadius: size * 0.11,
              backgroundColor: avatar.hair,
            }}
          />
        ) : null}
        {hairStyle === 'curly' || hairStyle === 'fade' ? (
          <View
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: -size * 0.04,
              width: faceW * 1.08,
              height: size * 0.2,
              borderRadius: size * 0.16,
              backgroundColor: avatar.hair,
            }}
          />
        ) : null}

        {/* Eyebrows */}
        <View style={[styles.browRow, { marginTop: faceH * 0.3, gap: faceW * 0.22 }]}>
          <View
            style={{
              width: eyeW * 1.15,
              height: 2,
              borderRadius: 1,
              backgroundColor: avatar.hair,
              opacity: 0.85,
              transform: [{ rotate: isFemale ? '-8deg' : '-4deg' }],
            }}
          />
          <View
            style={{
              width: eyeW * 1.15,
              height: 2,
              borderRadius: 1,
              backgroundColor: avatar.hair,
              opacity: 0.85,
              transform: [{ rotate: isFemale ? '8deg' : '4deg' }],
            }}
          />
        </View>

        {/* Eyes */}
        <View style={[styles.eyeRow, { marginTop: faceH * 0.04, gap: faceW * 0.16 }]}>
          <Eye eyeW={eyeW} eyeH={eyeH} pupil={pupil} color={avatar.eye} />
          <Eye eyeW={eyeW} eyeH={eyeH} pupil={pupil} color={avatar.eye} />
        </View>

        {avatar.blush ? (
          <View style={[styles.blushRow, { marginTop: faceH * 0.02, width: faceW * 0.78 }]}>
            <View style={[styles.blush, { width: size * 0.1, height: size * 0.055 }]} />
            <View style={[styles.blush, { width: size * 0.1, height: size * 0.055 }]} />
          </View>
        ) : null}

        {/* Soft nose */}
        <View
          style={{
            marginTop: faceH * (avatar.blush ? 0.02 : 0.05),
            width: size * 0.06,
            height: size * 0.05,
            borderRadius: size * 0.03,
            backgroundColor: 'rgba(0,0,0,0.08)',
          }}
        />

        {/* Mouth */}
        <View
          style={[
            styles.mouth,
            avatar.expression === 'grin' && styles.mouthGrin,
            avatar.expression === 'bright' && styles.mouthBright,
            avatar.expression === 'soft' && styles.mouthSoft,
            {
              marginTop: faceH * 0.04,
              borderColor: '#9F1239',
              width: size * (avatar.expression === 'grin' ? 0.2 : 0.16),
            },
          ]}
        />
      </View>
    </View>
  );
}

function Eye({ eyeW, eyeH, pupil, color }) {
  return (
    <View
      style={{
        width: eyeW,
        height: eyeH,
        borderRadius: eyeW / 2,
        backgroundColor: '#FFFDF8',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: pupil * 1.35,
          height: pupil * 1.35,
          borderRadius: pupil,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: Math.max(1.2, pupil * 0.35),
            height: Math.max(1.2, pupil * 0.35),
            borderRadius: 2,
            backgroundColor: 'rgba(255,255,255,0.85)',
            marginTop: -pupil * 0.25,
            marginLeft: pupil * 0.15,
          }}
        />
      </View>
    </View>
  );
}

function hairTopStyle(hairStyle, size, color, faceW) {
  const base = {
    backgroundColor: color,
    position: 'absolute',
    alignSelf: 'center',
  };
  switch (hairStyle) {
    case 'bob':
      return {
        ...base,
        top: -size * 0.06,
        width: faceW * 1.12,
        height: size * 0.28,
        borderTopLeftRadius: size * 0.28,
        borderTopRightRadius: size * 0.28,
        borderBottomLeftRadius: size * 0.08,
        borderBottomRightRadius: size * 0.08,
      };
    case 'long':
    case 'waves':
      return {
        ...base,
        top: -size * 0.08,
        width: faceW * 1.14,
        height: size * 0.3,
        borderTopLeftRadius: size * 0.3,
        borderTopRightRadius: size * 0.3,
      };
    case 'pony':
    case 'pixie':
      return {
        ...base,
        top: -size * 0.05,
        width: faceW * 1.05,
        height: size * 0.24,
        borderRadius: size * 0.18,
      };
    case 'side':
      return {
        ...base,
        top: -size * 0.04,
        width: faceW * 1.08,
        height: size * 0.22,
        borderTopLeftRadius: size * 0.2,
        borderTopRightRadius: size * 0.08,
        marginLeft: size * 0.04,
      };
    case 'top':
      return {
        ...base,
        top: -size * 0.07,
        width: faceW * 0.7,
        height: size * 0.22,
        borderRadius: size * 0.12,
      };
    case 'short':
    default:
      return {
        ...base,
        top: -size * 0.05,
        width: faceW * 1.06,
        height: size * 0.22,
        borderTopLeftRadius: size * 0.22,
        borderTopRightRadius: size * 0.22,
      };
  }
}

const styles = StyleSheet.create({
  shirt: {
    position: 'absolute',
    alignSelf: 'center',
  },
  collar: {
    position: 'absolute',
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    opacity: 0.35,
  },
  neck: {
    position: 'absolute',
    alignSelf: 'center',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  hairBack: {
    position: 'absolute',
    zIndex: 0,
  },
  head: {
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 2,
    overflow: 'visible',
  },
  ear: {
    position: 'absolute',
    zIndex: 1,
  },
  hairTop: {
    zIndex: 3,
  },
  browRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blushRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  blush: {
    borderRadius: 8,
    backgroundColor: 'rgba(244,114,182,0.42)',
  },
  mouth: {
    height: 6,
    borderBottomWidth: 2.2,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  mouthGrin: {
    height: 7,
    borderBottomWidth: 2.6,
  },
  mouthBright: {
    height: 7,
    borderBottomWidth: 2.4,
    width: 12,
  },
  mouthSoft: {
    height: 4,
    borderBottomWidth: 1.8,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
});
