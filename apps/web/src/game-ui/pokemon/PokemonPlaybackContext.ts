import { createContext } from "react";

export const PokemonPlaybackSettledContext = createContext<(() => void) | null>(null);

export const PokerPlaybackSettledContext = createContext<(() => void) | null>(null);
