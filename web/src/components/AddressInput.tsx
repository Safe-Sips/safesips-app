import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { AddressSuggestion } from "../geocode";
import { searchAddressSuggestions } from "../geocode";

const SUGGEST_DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;

interface AddressInputProps {
  disabled?: boolean;
  onSubmitAddress: (address: string) => void;
  onPickSuggestion: (suggestion: AddressSuggestion) => void;
}

export default function AddressInput({
  disabled = false,
  onSubmitAddress,
  onPickSuggestion,
}: AddressInputProps) {
  const listId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const query = address.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchAddressSuggestions(query, 5, controller.signal);
        setSuggestions(results);
        setOpen(results.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSuggestions([]);
        setOpen(false);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const closeList = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const pickSuggestion = (suggestion: AddressSuggestion) => {
    setAddress(suggestion.displayName);
    closeList();
    onPickSuggestion(suggestion);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    closeList();
    onSubmitAddress(address);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === "Escape") closeList();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      closeList();
    }
  };

  const activeOptionId =
    activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;

  return (
    <form className="address-form" onSubmit={handleSubmit}>
      <div className="address-field" ref={fieldRef}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter your address"
          aria-label="Enter your address"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          maxLength={500}
          disabled={disabled}
          role="combobox"
        />
        {open && (
          <ul className="address-suggestions" id={listId} role="listbox">
            {loading && suggestions.length === 0 && (
              <li className="address-suggestion address-suggestion-muted" role="status">
                Searching…
              </li>
            )}
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.lat}-${suggestion.lng}-${index}`}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`address-suggestion${
                  index === activeIndex ? " is-active" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(suggestion)}
              >
                {suggestion.displayName}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        className="btn btn-secondary"
        type="submit"
        disabled={disabled || !address.trim()}
      >
        Go
      </button>
    </form>
  );
}
