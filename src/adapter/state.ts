/**
 * Per-process adapter state, keyed by session id.
 */

export interface SessionState {
	/** false = the dsh `minimal` bootstrap surface; true = everything released. */
	promoted: boolean;
	/** Active tools captured just before the bootstrap narrowing. */
	previousTools?: string[];
}

export interface AdapterState {
	cwd: string;
	sessions: Map<string, SessionState>;
}

export function emptySessionState(): SessionState {
	return { promoted: false };
}

export function createAdapterState(cwd: string): AdapterState {
	return { cwd, sessions: new Map() };
}

/** Session state, created on first touch. */
export function sessionState(state: AdapterState, sessionId: string): SessionState {
	let entry = state.sessions.get(sessionId);
	if (!entry) {
		entry = emptySessionState();
		state.sessions.set(sessionId, entry);
	}
	return entry;
}
