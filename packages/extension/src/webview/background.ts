/**
 * Draws in a worker, one drawing at a time, keeping only the newest request.
 *
 * Requests arrive faster than a large diagram can be drawn -- a keystroke, a
 * drop, a theme change -- and only the latest is worth finishing. So while one
 * drawing is under way the next request waits, and any later one replaces it.
 * A drawing that has been running a while is abandoned for a newer request,
 * unless the caller is mid-drag, where a picture that is a moment behind is
 * better than none at all.
 */

import type { RenderInput, Rendered } from 'tonto-canvas/draw';
import { source } from 'render-worker-source';

/** How long a drawing may run before a newer request abandons it. */
const ABANDON_AFTER_MS = 1000;

interface Job {
    input: RenderInput;
    generation: number;
}

export interface BackgroundResult {
    drawn: Rendered;
    input: RenderInput;
    generation: number;
    /** How long the worker spent drawing, so the panel can tell when drawing at once is cheap again. */
    took: number;
}

export class BackgroundRenderer {
    private worker: Worker | undefined;
    private url: string | undefined;
    private running: (Job & { id: number; since: number }) | undefined;
    private waiting: Job | undefined;
    private next = 0;
    private broken = false;

    constructor(
        private readonly drawn: (result: BackgroundResult) => void,
        /** The worker could not draw this; the caller draws it itself. */
        private readonly failed: (job: Job) => void
    ) {}

    /** Whether there is a worker to draw in -- not in a test page, nor after one failed to start. */
    get usable(): boolean {
        return !this.broken && typeof Worker === 'function' && typeof Blob === 'function'
            && typeof URL.createObjectURL === 'function';
    }

    request(input: RenderInput, generation: number, abandon: boolean): void {
        const job = { input, generation };
        if (this.running) {
            if (!abandon || performance.now() - this.running.since < ABANDON_AFTER_MS) {
                this.waiting = job;
                return;
            }
            this.stop();
        }
        this.send(job);
    }

    private send(job: Job): void {
        let worker: Worker;
        try {
            worker = this.start();
        } catch {
            this.giveUp(job);
            return;
        }
        const id = ++this.next;
        this.running = { ...job, id, since: performance.now() };
        worker.postMessage({ id, input: job.input });
    }

    private start(): Worker {
        if (this.worker) {
            return this.worker;
        }
        this.url ??= URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(this.url);
        worker.addEventListener('message', event => this.receive(event.data));
        // A worker that cannot start -- a content policy that will not have it --
        // reports here and never answers, so the request it was given is drawn
        // by the panel instead, and so is everything after it.
        worker.addEventListener('error', event => {
            event.preventDefault();
            const job = this.running ?? this.waiting;
            this.stop();
            this.waiting = undefined;
            if (job) {
                this.giveUp(job);
            } else {
                this.broken = true;
            }
        });
        this.worker = worker;
        return worker;
    }

    private receive(message: { id: number; drawn?: Rendered; took?: number; error?: string }): void {
        const running = this.running;
        if (!running || message.id !== running.id) {
            return;
        }
        this.running = undefined;
        const waiting = this.waiting;
        this.waiting = undefined;
        if (waiting) {
            this.send(waiting);
        }
        if (message.drawn) {
            this.drawn({
                drawn: message.drawn, input: running.input, generation: running.generation, took: message.took ?? 0
            });
        } else if (!waiting) {
            // The drawing itself failed. Drawn again in the panel it fails the
            // same way, and the error is where it always was.
            this.failed(running);
        }
    }

    private giveUp(job: Job): void {
        this.broken = true;
        this.failed(job);
    }

    private stop(): void {
        this.worker?.terminate();
        this.worker = undefined;
        this.running = undefined;
    }
}
