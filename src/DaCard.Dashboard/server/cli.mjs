import { resolveModDir } from './paths.mjs';
import { runUpgrade, inspect } from './upgrade.mjs';

function option(args, name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

const out = (kind, payload) => process.stdout.write(`${kind}\t${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n`);

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const modDir = resolveModDir(option(args, '--mod'));
    if (command === 'inspect') {
        const result = inspect(modDir);
        out('done', { databaseExists: result.databaseExists, schemaSteps: result.schemaSteps, legacy: { addons: result.legacy.addons.length, config: result.legacy.config, old: result.legacy.old } });
        return;
    }
    if (command === 'upgrade') {
        let last = 0;
        const summary = await runUpgrade({
            modDir,
            by: option(args, '--by') || 'dashboard',
            onLog: (line) => out('log', line),
            onProgress: ({ done, total, message }) => {
                const t = Date.now();
                if (done === total || t - last > 250) {
                    last = t;
                    out('progress', { done, total, message });
                }
            },
        });
        out('done', summary);
        return;
    }
    out('error', `Unknown command "${command}". Use: upgrade | inspect [--mod <mod folder>] [--by server|dashboard]`);
    process.exitCode = 2;
}

main().catch((e) => {
    out('error', e?.stack || String(e));
    process.exitCode = 1;
});
