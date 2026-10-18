import type { EnvironmentId } from "@t3tools/contracts";
import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES,
} from "../composerInlineChip";
import { WorkspaceEntryIcon } from "./WorkspaceEntryIcon";

export const FILE_TAG_CHIP_CLASS_NAME = `${COMPOSER_INLINE_CHIP_CLASS_NAME} ${CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.mention}`;
export const CHAT_FILE_TAG_CHIP_CLASS_NAME = `${CHAT_INLINE_CHIP_CLASS_NAME} ${CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.mention}`;

export function FileTagChipContent(props: {
  path: string;
  label: string;
  theme: "light" | "dark";
  selectable?: boolean;
  environmentId?: EnvironmentId | null | undefined;
  cwd?: string | undefined;
}) {
  return (
    <>
      <WorkspaceEntryIcon
        path={props.path}
        environmentId={props.environmentId}
        cwd={props.cwd}
        theme={props.theme}
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
      />
      <span
        className={
          props.selectable
            ? CHAT_INLINE_CHIP_LABEL_CLASS_NAME
            : COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME
        }
      >
        {props.label}
      </span>
    </>
  );
}
