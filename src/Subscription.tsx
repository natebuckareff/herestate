import React, {
    FC,
    useRef,
    useCallback,
    useEffect,
    useContext,
    useState,
    useMemo,
} from 'react';

export namespace Subscription {
    export interface Context<S> {
        ref: { current: S };
        subscribe: (sub: Sub<S>) => void;
        unsubscribe: (sub: Sub<S>) => void;
    }

    export interface Hook<I, S> {
        (initialState: I): S;
    }

    export type Subs<S> = Set<Sub<S>>;

    export interface Sub<S> {
        (state: S): void;
    }
}

function useCore<I, S>(
    useHook: Subscription.Hook<I, S>,
    initialState: I,
): Subscription.Context<S> {
    const state = useHook(initialState);
    const subs = useRef<Subscription.Subs<S>>(new Set());
    const ref = useRef(state);

    const subscribe = useCallback((sub: Subscription.Sub<S>) => {
        subs.current.add(sub);
        sub(ref.current);
    }, []);

    const unsubscribe = useCallback((sub: Subscription.Sub<S>) => {
        subs.current.delete(sub);
    }, []);

    useEffect(() => {
        ref.current = state;
        for (const sub of subs.current) {
            sub(state);
        }
    }, [state]);

    return useMemo(() => ({ ref, subscribe, unsubscribe }), []);
}

export interface SubscriptionProviderProps<I> {
    initialState: I;
}

export function createSubscription<I, S>(useHook: Subscription.Hook<I, S>) {
    const Context = React.createContext<Subscription.Context<S> | null>(null);

    const useSubscription = (isSubbed = true) => {
        // `Context` won't change and trigger updates because the output of
        // `useCore` is memoized; instead we use the ref to get update-to-date
        // state
        const ctx = useContext(Context)!;

        const [subbed, setSubbed] = useState(isSubbed);
        const [state, setState] = useState(ctx.ref.current);

        useEffect(() => {
            if (subbed) {
                ctx.subscribe(setState);
                return () => ctx.unsubscribe(setState);
            }
            return;
        }, [subbed]);

        return [state, subbed, setSubbed] as const;
    };

    const Provider: FC<SubscriptionProviderProps<I>> = props => {
        const { initialState, children } = props;
        const ctx = useCore(useHook, initialState);
        return React.createElement(Context.Provider, { value: ctx }, children);
    };

    return {
        useSubscription,
        Provider,
    };
}
