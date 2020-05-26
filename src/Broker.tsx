import React, {
    FC,
    useRef,
    useCallback,
    useEffect,
    useContext,
    useState,
    useMemo,
} from 'react';

function objectUnpack<T extends {}>(obj: T) {
    const keys: (keyof T)[] = [];
    const values: T[keyof T][] = [];
    for (const k in obj) {
        keys.push(k);
        values.push(obj[k]);
    }
    return [...keys, ...values];
}

export namespace Broker {
    export interface Context<S, W> {
        ref: { current: S };
        state: S;
        writer: W;
        subscribe: (ids: string | string[], sub: Sub<S>) => void;
        unsubscribe: (ids: string | string[], sub: Sub<S>) => void;
    }

    export interface Hook<I, S, W> {
        (initialState: I, update: Update): HookResult<S, W>;
    }

    export interface HookResult<S, W> {
        state: S;
        writer: W;
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

function useCore<I, S, W>(
    useHook: Broker.Hook<I, S, W>,
    initialState: I,
): Broker.Context<S, W> {
    // Setup callback to capture updates within the hook
    let updates: string[] = [];
    const update: Broker.Update = (id: string) => updates.push(id);

    // Subscription map
    const subs = useRef<Broker.Subs<S>>({});

    // Run the hook and get the output
    const { state, writer } = useHook(initialState, update);

    // Ref so we always have a snapshot of the current state
    const ref = useRef(state);

    // Keep the ref up to date
    useEffect(() => {
        ref.current = state;
    }, [state]);

    // Check to see if there are update to run
    useEffect(() => {
        for (const id of updates) {
            const cbs = subs.current[id];
            if (cbs !== undefined) {
                for (const f of cbs) {
                    f(ref.current);
                }
            }
        }
    }, [updates]);

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

            // Bootstrap subscriber with state
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

    // Check if the contents of writer actually changed
    const w = useMemo(() => writer, [...objectUnpack(writer)]);

    return { ref, state, writer: w, subscribe, unsubscribe };
}

export interface BrokerProviderProps<I> {
    initialState: I;
}

export function createBroker<I, S, W>(useHook: Broker.Hook<I, S, W>) {
    const RefContext = React.createContext<Broker.Context<S, W> | null>(null);
    const StateContext = React.createContext<Broker.Context<S, W> | null>(null);
    const WriterContext = React.createContext<Broker.Context<S, W> | null>(
        null,
    );

    const useSubscription = (ids: string | string[], isSubbed = true) => {
        const ctx = useContext(RefContext)!;

        const [subbed, setSubbed] = useState(isSubbed);
        const [state, setState] = useState(ctx.ref.current);

        useEffect(() => {
            if (subbed) {
                ctx.subscribe(ids, setState);
                return () => ctx.unsubscribe(ids, setState);
            }
            return;
        }, [subbed]);

        return [
            { ...state, ...ctx.writer },
            { subbed, setSubbed },
        ] as const;
    };

    const useContainer = () => {
        const ctx = useContext(StateContext)!;
        return { ...ctx.state, ...ctx.writer };
    };

    const useWriter = () => {
        const ctx = useContext(WriterContext)!;
        return ctx.writer;
    };

    const Provider: FC<BrokerProviderProps<I>> = props => {
        const { initialState, children } = props;
        const ctx = useCore(useHook, initialState);

        const ref = useMemo(() => ctx, []);
        const state = useMemo(() => ctx, [ctx.state]);
        const writer = useMemo(() => ctx, [ctx.writer]);

        return (
            <RefContext.Provider value={ref}>
                <StateContext.Provider value={state}>
                    <WriterContext.Provider value={writer}>
                        {children}
                    </WriterContext.Provider>
                </StateContext.Provider>
            </RefContext.Provider>
        );
    };

    return {
        useSubscription,
        useContainer,
        useWriter,
        Provider,
    };
}
