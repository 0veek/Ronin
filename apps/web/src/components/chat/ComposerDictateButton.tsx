import { MicIcon, MicOffIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useDictation } from "~/hooks/useDictation";
import { useSpeechToTextSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Push-to-talk dictation, as a button in the composer strip.
 *
 * Hold the button or the shortcut to speak, release to transcribe. The
 * transcript is appended to whatever is already in the composer rather than
 * replacing it, so dictation composes with typing instead of competing with it.
 *
 * The key handling lives here rather than in the shell's keydown router
 * because push-to-talk is the one binding that needs the release as well as
 * the press, and the router only resolves presses.
 */
export const ComposerDictateButton = memo(function ComposerDictateButton({
  shortcutLabel,
  matchesShortcut,
}: {
  readonly shortcutLabel: string | null;
  /** True when a keyboard event is the dictation binding. */
  readonly matchesShortcut: (event: KeyboardEvent) => boolean;
}) {
  const { enabled, provider } = useSpeechToTextSettings();
  const composerHandleRef = useComposerHandleContext();

  const onTranscript = useCallback(
    (text: string) => {
      // ensureLeadingBoundary so speaking twice in a row does not run the two
      // takes together into one word.
      composerHandleRef?.current?.insertTextAtEnd(text, { ensureLeadingBoundary: true });
      composerHandleRef?.current?.focusAtEnd();
    },
    [composerHandleRef],
  );

  const dictation = useDictation({ onTranscript, provider });
  const { beginHold, endHold, cancel, error, status } = dictation;

  // Microphone problems are the ones worth interrupting for: they are almost
  // always permission or hardware, and the fix is never "hold it again".
  const reportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error === null || error === reportedErrorRef.current) {
      reportedErrorRef.current = error;
      return;
    }
    reportedErrorRef.current = error;
    toastManager.add(stackedThreadToast({ type: "error", title: "Dictation", description: error }));
  }, [error]);

  // Held from the keyboard, as opposed to the pointer. Tracked so a key
  // release only ends a hold the keyboard started.
  const keyHeldRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "Escape" && keyHeldRef.current) {
        keyHeldRef.current = false;
        cancel();
        return;
      }
      if (!matchesShortcut(event)) return;
      event.preventDefault();
      keyHeldRef.current = true;
      beginHold();
    };

    const onKeyUp = () => {
      if (!keyHeldRef.current) return;
      // Releasing any part of the chord ends the hold. Waiting for the exact
      // key would strand the recorder open when the modifier goes up first,
      // which is the common way people let go of a chord.
      keyHeldRef.current = false;
      endHold();
    };

    // A held key never reports its release if the window loses focus first.
    const onBlur = () => {
      if (!keyHeldRef.current) return;
      keyHeldRef.current = false;
      endHold();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [beginHold, cancel, enabled, endHold, matchesShortcut]);

  if (!enabled || !dictation.isSupported) return null;

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";
  const hint =
    dictation.error !== null
      ? dictation.error
      : isRecording
        ? "Release to transcribe"
        : isTranscribing
          ? "Transcribing…"
          : `Hold to dictate${shortcutLabel === null ? "" : ` (${shortcutLabel})`}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Hold to dictate"
            aria-pressed={isRecording}
            className={cn(
              // Same footprint as the send button beside it, so the pair reads as one
              // row of controls rather than a small thing next to a big one.
              // Ghost rather than filled: send stays the primary action.
              "relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 sm:h-8 sm:w-8",
              isRecording && "bg-destructive/12 text-destructive hover:bg-destructive/12",
              isTranscribing && "text-foreground/70",
              dictation.error !== null && !isRecording && "text-destructive/80",
            )}
            disabled={isTranscribing}
            // Pointer capture keeps the release on this element even if the
            // cursor slides off mid-sentence, which otherwise strands the
            // recorder open.
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dictation.dismissError();
              beginHold();
            }}
            onPointerUp={() => endHold()}
            onPointerCancel={() => cancel()}
            // Space and Enter activate a focused button, so they get the same
            // hold semantics rather than firing a click on release.
            onKeyDown={(event) => {
              if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
              event.preventDefault();
              beginHold();
            }}
            onKeyUp={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              endHold();
            }}
            type="button"
          >
            {/* Colour carries the recording state, not motion: a blinking
                live-mic indicator is exactly the idle GPU cost this project
                audits for. */}
            {dictation.error !== null && !isRecording ? (
              <MicOffIcon className="size-4" />
            ) : (
              <MicIcon className="size-4" />
            )}
          </button>
        }
      />
      <TooltipPopup side="top">{hint}</TooltipPopup>
    </Tooltip>
  );
});
