export const BOOTSTRAP_TIMEOUT_MS = 2000;
export type BootstrapResult<T> = { status: 'ok'; value: T; elapsedMs: number } | { status: 'timeout' | 'error'; elapsedMs: number };

/** Work returns a value, never mutates launch state. Only the winning result commits. */
export function createBootstrap<T>(work: (signal: AbortSignal, deadline: number) => Promise<T>, timeoutMs = BOOTSTRAP_TIMEOUT_MS) {
	let promise: Promise<BootstrapResult<T>> | undefined;
	return () => promise ??= new Promise((resolve) => {
		const start = performance.now();
		let settled = false;
		const controller = new AbortController();
		const finish = (result: { status: 'ok'; value: T } | { status: 'timeout' | 'error' }) => {
			if (settled) return;
			settled = true;
			controller.abort();
			clearTimeout(timer);
			resolve({ ...result, elapsedMs: performance.now() - start });
		};
		const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
		Promise.resolve().then(() => work(controller.signal, start + timeoutMs)).then((value) => finish({ status: 'ok', value }), () => finish({ status: 'error' }));
	});
}
