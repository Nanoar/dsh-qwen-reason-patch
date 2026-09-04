/* qwen-reason-settings — 宿主侧：把 qwenReason.providers 注册进 DSH settings，
 * 并把每次变更镜像到 $DSH_HOME/qwen-reason.json（运行时各补丁读取的白名单源）。 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const name = 'qwen-reason-settings';
const NS = 'qwenReason';
const DEFAULT_PROVIDERS = ['home'];
const toJson = { toJSON: () => ({}) };

function providersOf(value) {
  if (value && typeof value === 'object' && Array.isArray(value.providers)) {
    const list = value.providers.filter((p) => typeof p === 'string' && p.length > 0);
    if (list.length > 0) return list;
  }
  return DEFAULT_PROVIDERS;
}

async function mirror(value) {
  try {
    const home = (typeof process !== 'undefined' && process.env ? (process.env.DSH_HOME || '') : '') || '';
    if (!home) return;
    const file = join(home, 'qwen-reason.json');
    await writeFile(file, JSON.stringify({ providers: providersOf(value) }, null, 2) + '\n');
  } catch (_e) { /* mirror is best-effort */ }
}

export function apply(ctx) {
  ctx.effect(() => {
    const settings = ctx.get('settings');
    if (!settings || typeof settings.register !== 'function') {
      ctx.logger.warn('[qwen-reason-settings] settings service not mounted yet — namespace skipped');
      return;
    }
    const schema = (section) => ({
      providers: Array.isArray(section?.providers) && section.providers.length
        ? section.providers.filter((p) => typeof p === 'string' && p.length > 0)
        : DEFAULT_PROVIDERS,
    });
    schema.toJSON = toJson.toJSON;
    try {
      const scope = settings.register(NS, schema, { base: { providers: DEFAULT_PROVIDERS } });
      scope.watch((value) => { void mirror(value); });
      void mirror(scope.get());
      ctx.logger.info('[qwen-reason-settings] registered namespace "qwenReason" (providers whitelist)');
    } catch (error) {
      ctx.logger.warn('[qwen-reason-settings] register failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }, 'qwen-reason-settings: register namespace');
}
