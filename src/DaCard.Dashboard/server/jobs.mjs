import { EventEmitter } from 'node:events';
import { hex } from './ids.mjs';

const KEEP_FINISHED = 20;

export function createJobs() {
    const events = new EventEmitter();
    events.setMaxListeners(100);
    const jobs = new Map();
    let chain = Promise.resolve();

    const publicJob = (job) => {
        const { run, lastSent, ...rest } = job;
        return rest;
    };

    function emit(job, force = false) {
        const now = Date.now();
        if (!force && now - job.lastSent < 150) return;
        job.lastSent = now;
        events.emit('job', publicJob(job));
    }

    function prune() {
        const finished = [...jobs.values()].filter((j) => j.status !== 'running' && j.status !== 'queued').sort((a, b) => b.finished - a.finished);
        for (const job of finished.slice(KEEP_FINISHED)) jobs.delete(job.id);
    }

    function start(kind, title, run, { exclusive = true } = {}) {
        const job = {
            id: hex(6), kind, title, status: 'queued', done: 0, total: 0, message: 'Waiting', result: null, error: null,
            started: Date.now(), finished: null, lastSent: 0, run,
        };
        jobs.set(job.id, job);
        const context = {
            id: job.id,
            progress(done, total, message) {
                job.done = done;
                job.total = total;
                if (message) job.message = message;
                emit(job);
            },
            message(text) {
                job.message = text;
                emit(job, true);
            },
        };
        const execute = async () => {
            job.status = 'running';
            job.message = 'Starting';
            emit(job, true);
            try {
                job.result = await run(context);
                job.status = 'done';
                job.message = 'Done';
                if (job.total) job.done = job.total;
            } catch (e) {
                job.status = 'failed';
                job.error = e?.message || String(e);
                job.message = 'Failed';
            }
            job.finished = Date.now();
            emit(job, true);
            prune();
        };
        if (exclusive) chain = chain.then(execute, execute);
        else execute();
        emit(job, true);
        return publicJob(job);
    }

    return {
        events,
        start,
        get: (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null),
        list: () => [...jobs.values()].map(publicJob).sort((a, b) => b.started - a.started),
        busy: () => [...jobs.values()].some((j) => j.status === 'running' || j.status === 'queued'),
        serial(work) {
            const result = chain.then(() => work());
            chain = result.catch(() => { });
            return result;
        },
    };
}
