/**
 * Side-effect import: bootstrap OneSignal before App renders (cold-start click attribution).
 */
import { bootstrapOneSignalNative } from './oneSignal.native';

bootstrapOneSignalNative();
