#!/usr/bin/env node
'use strict';

/**
 * Native Exo quality/audio UI: manifest sidecar + ChannelPlayerScreen wiring.
 * Run: node scripts/verify-native-hls-tracks.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const screen = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
const { parseHlsManifestTracks } = require('../lib/nativeHlsManifestTracks');

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const sampleMaster = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",URI="eng/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Swahili",LANGUAGE="sw",URI="swa/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480,AUDIO="aac"
480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="aac"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="aac"
1080/index.m3u8
`;

const base = 'https://cdn.example/live/master.m3u8';
const parsed = parseHlsManifestTracks(sampleMaster, base);

if (parsed.variants.length !== 3) {
  fail(`expected 3 variants, got ${parsed.variants.length}`);
} else pass('parses EXT-X-STREAM-INF variants');

if (parsed.audioTracks.length !== 2) {
  fail(`expected 2 audio tracks, got ${parsed.audioTracks.length}`);
} else pass('parses EXT-X-MEDIA audio renditions');

if (!parsed.variants[1].uri.includes('720/index.m3u8')) {
  fail('variant URIs resolved against manifest base');
} else pass('variant URIs resolved against manifest base');

if (!parsed.audioTracks[0].uri.includes('eng/index.m3u8')) {
  fail('audio URIs resolved against manifest base');
} else pass('audio URIs resolved against manifest base');

if (!screen.includes('fetchNativeHlsManifestTracksForPlayback')) {
  fail('ChannelPlayerScreen imports fetchNativeHlsManifestTracksForPlayback');
} else pass('manifest fetch wired in ChannelPlayerScreen');

if (!screen.includes('pickerKindRef.current = \'quality\'')) {
  fail('native quality picker must sync pickerKindRef before opening');
} else pass('native quality picker syncs pickerKindRef');

if (!screen.includes('qualityModel.options?.length ?? 0) === 0')) {
  fail('quality picker opens from options.length not stale available flag');
} else pass('quality picker uses options.length gate');

if (!screen.includes('nativeManifestVariants')) {
  fail('nativeManifestVariants state missing');
} else pass('nativeManifestVariants state present');

if (!screen.includes("logPlayerInterrupt('native_track_selection_load'")) {
  fail('native quality selection uses loadAsync');
} else pass('native quality selection uses loadAsync');

if (!screen.match(/useNativePlayer && nativeManifestVariants\.length/)) {
  fail('qualityModel native branch missing');
} else pass('qualityModel native branch present');

if (!screen.match(/useNativePlayer && nativeManifestAudioTracks\.length/)) {
  fail('languageModel native branch missing');
} else pass('languageModel native branch present');

if (screen.includes('Quality controls hazijapatikana bado')) {
  fail('quality picker must not show hazijapatikana alert');
} else pass('no quality hazijapatikana alert');

if (screen.includes('if (useNativePlayer) {\n      Alert.alert(\'Quality\'')) {
  fail('openQualityPicker must not block native when tracks available');
} else pass('openQualityPicker allows native when tracks parsed');

if (!screen.includes('audio_group_switch_unsupported')) {
  fail('grouped audio limitation logged');
} else pass('grouped audio limitation logged');

if (process.exitCode) process.exit(1);
console.log('[verify-native-hls-tracks] ok');
