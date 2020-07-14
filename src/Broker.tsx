import produce, { castImmutable, Immutable } from 'immer';
import React, {
    FC,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';

export namespace Broker {
    export interface Context<S> {
        ref: { current: S };
        state: S;
        subscribe: (ids: string | string[], sub: Sub<S>) => void;
        unsubscribe: (ids: string | string[], sub: Sub<S>) => void;
    }

    export interface Hook<I, S> {
        (update: Update, initialState: I): S;
    }

    export interface Update {
        (id: string): void;
    }

    export interface Subs<S> {
        [key: string]: Sub<S>[];
    }

    export interface Sub<S> {
        (state: S): void;
    }
}

function useCore<I, S>(
    useHook: Broker.Hook<I, S>,
    initialState: I,
): Broker.Context<S> {
    // Flag to reset the updates without having to do an extra `setUpdates()`
    const resetUpdates = useRef(false);

    // Setup state and callback to capture updates within the hook. We use state
    // instead of a ref so that if all the hook does is `update()` it will still
    // trigger a rerender. Alternatively, we could have `useHook` return a list
    // of ids to update
    const [updates, setUpdates] = useState<string[]>([]);
    const update: Broker.Update = (id: string) => {
        if (resetUpdates.current) {
            resetUpdates.current = false;
            setUpdates([id]);
        } else {
            setUpdates(ids => [...ids, id]);
        }
    };

    // Get the next state
    const state = useHook(update, initialState);

    // Ref used by ConstContext so it can always read the current state
    const ref = useRef(state);

    // Keep the ref up to date and check for updates
    useEffect(() => {
        ref.current = state;
        if (updates.length > 0) {
            for (const id of updates) {
                const cbs = subs.current[id];
                if (cbs !== undefined) {
                    for (const f of cbs) {
                        f(ref.current);
                    }
                }
            }
            resetUpdates.current = true;
        }
    }, [state, updates]);

    // Mapping from ids to active subscriptions
    const subs = useRef<Broker.Subs<S>>({});

    const subscribe = useCallback(
        (ids: string | string[], sub: Broker.Sub<S>) => {
            for (const id of Array.isArray(ids) ? ids : [ids]) {
                let s = subs.current[id];
                if (s === undefined) {
                    s = [];
                    subs.current[id] = s;
                }
                s.push(sub);
            }

            // Bootstrap subscriber with initial state
            sub(ref.current);
        },
        [],
    );

    const unsubscribe = useCallback(
        (ids: string | string[], sub: Broker.Sub<S>) => {
            for (const id of Array.isArray(ids) ? ids : [ids]) {
                const s = subs.current[id];
                if (s !== undefined) {
                    const index = s.indexOf(sub);
                    if (index !== -1) {
                        s.splice(index, 1);
                    }
                }
            }
        },
        [],
    );

    return { ref, state, subscribe, unsubscribe };
}

export interface BrokerProviderProps<I> {
    initialState: I;
}

export function createBroker<I, S>(useHook: Broker.Hook<I, S>) {
    const ConstContext = React.createContext<Broker.Context<S> | null>(null);
    const StateContext = React.createContext<Broker.Context<S> | null>(null);

    function unscalar<T>(x: T | T[]) {
        return Array.isArray(x) ? x : [x];
    }

    const useSubscription = (initialIds: string | string[]) => {
        const ctx = useContext(ConstContext)!;

        const [ids, setIds] = useState(unscalar(initialIds));
        const [state, setState] = useState(ctx.ref.current);

        useEffect(() => {
            if (ids.length > 0) {
                ctx.subscribe(ids, setState);
                return () => ctx.unsubscribe(ids, setState);
            }
        }, [ids]);

        return [state, { ids, setIds }] as const;
    };

    const useContainer = () => {
        const { state } = useContext(StateContext)!;
        return state;
    };

    const useWriter = () => {
        const { state } = useContext(ConstContext)!;
        return state;
    };

    const Provider: FC<BrokerProviderProps<I>> = props => {
        const { initialState, children } = props;
        const ctx = useCore(useHook, initialState);
        const ref = useMemo(() => ctx, []);
        const state = useMemo(() => ctx, [ctx.state]);

        return (
            <ConstContext.Provider value={ref}>
                <StateContext.Provider value={state}>
                    {children}
                </StateContext.Provider>
            </ConstContext.Provider>
        );
    };

    return {
        useSubscription,
        useContainer,
        useWriter,
        Provider,
    };
}

export function createBrokerReducer<S, A>(
    updater: (draft: S, action: A, update: Broker.Update) => void,
) {
    function useHook(update: Broker.Update, initialState: S) {
        const curried = produce((draft: S, action: A) =>
            updater(draft, action, update),
        );
        type T = React.Reducer<Immutable<S>, A>;
        const [state, dispatch] = useReducer<T>(
            curried,
            castImmutable(initialState),
        );
        return { state, dispatch };
    }
    return createBroker(useHook);
}
