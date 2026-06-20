import { InteractionManager } from 'react-native';
import { safeStartupRun } from './safeStartupRun';

/**
 * Run optional startup work after first paint / interactions — never block Home.
 * @param {string} tag
 * @param {() => void | Promise<void>} fn
 */
export function deferStartupTask(tag, fn) {
  safeStartupRun(`${tag}:schedule`, () => {
    const handle = InteractionManager.runAfterInteractions(() => {
      safeStartupRun(tag, fn);
    });
    return handle;
  });
}
