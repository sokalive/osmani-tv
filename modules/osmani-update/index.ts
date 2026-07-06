import { EventEmitter, requireNativeModule, Subscription } from 'expo-modules-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NativeModule: any = requireNativeModule('OsmaniUpdate');
const emitter = new EventEmitter(NativeModule);

export type UpdateDecision = 'NONE' | 'SOFT' | 'FORCE' | 'PLAY_STORE';

export interface UpdateInfo {
  decision: UpdateDecision;
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  autoDownload: boolean;
  apkUrl: string;
  apkSha256: string;
  apkSizeBytes: number;
  playStoreUrl: string;
  releaseNotes: string;
  notice: string;
  title: string;
  source: string;
  installedVersionCode: number;
  installedVersionName: string;
}

export interface InstalledVersion {
  versionName: string;
  versionCode: number;
  packageName: string;
}

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'downloading';
      downloaded: number;
      total: number;
      percent: number;
    }
  | { state: 'verifying' }
  | { state: 'downloaded'; filePath: string }
  | { state: 'installing'; filePath: string }
  | { state: 'needs_unknown_sources_permission' }
  | { state: 'failed'; error: string };

export interface DownloadResult {
  status: 'downloaded';
  filePath: string;
  verifiedSha256?: string;
  sha256Verified?: boolean;
}

export interface InstallResult {
  status: 'installer_launched' | 'needs_unknown_sources_permission';
  filePath: string;
  verifiedSha256?: string;
  sha256Verified?: boolean;
}

const STATE_EVENT: string = NativeModule.STATE_EVENT ?? 'OsmaniUpdate.state';

export function getInstalledVersion(): InstalledVersion {
  return NativeModule.getInstalledVersion() as InstalledVersion;
}

export async function checkForUpdate(
  apiBaseUrl: string,
  deviceId?: string,
): Promise<UpdateInfo> {
  return (await NativeModule.checkForUpdate(
    apiBaseUrl,
    deviceId ?? null,
  )) as UpdateInfo;
}

export async function downloadAndInstall(
  apkUrl: string,
  expectedSha256?: string | null,
): Promise<DownloadResult> {
  return (await NativeModule.downloadAndInstall(
    apkUrl,
    expectedSha256 ?? null,
  )) as DownloadResult;
}

export async function launchInstaller(): Promise<InstallResult> {
  return (await NativeModule.launchInstaller()) as InstallResult;
}

export function cancelDownload(): void {
  NativeModule.cancelDownload();
}

export function quitApp(): void {
  NativeModule.quitApp();
}

export async function openPlayStore(url: string): Promise<void> {
  await NativeModule.openPlayStore(url);
}

export async function handleLandingInstallLink(uri: string): Promise<{
  status: string;
}> {
  return (await NativeModule.handleLandingInstallLink(uri)) as {
    status: string;
  };
}

export function addStateListener(
  listener: (state: UpdateState) => void,
): Subscription {
  return emitter.addListener(STATE_EVENT, listener as (event: unknown) => void);
}

export const PACKAGE_NAME: string = NativeModule.PACKAGE_NAME ?? '';
