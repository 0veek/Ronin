import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ChevronRightIcon } from "lucide-react";
import { type RefObject, useCallback, useState } from "react";
import { cn } from "~/lib/utils";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteRow,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandListHeading,
  CommandListVirtualized,
  CommandShortcut,
} from "./ui/command";
function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function HighlightedSearchText(props: { text: string; query: string }) {
  const query = props.query.trim();
  if (query.length === 0) return props.text;

  const normalizedText = foldAsciiCase(props.text);
  const normalizedQuery = foldAsciiCase(query);
  const parts: Array<{
    readonly text: string;
    readonly highlighted: boolean;
    readonly start: number;
  }> = [];
  let cursor = 0;

  while (cursor < props.text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
    if (matchIndex === -1) {
      parts.push({ text: props.text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({
        text: props.text.slice(cursor, matchIndex),
        highlighted: false,
        start: cursor,
      });
    }
    parts.push({
      text: props.text.slice(matchIndex, matchIndex + query.length),
      highlighted: true,
      start: matchIndex,
    });
    cursor = matchIndex + query.length;
  }

  return parts.map((part) =>
    part.highlighted ? (
      <mark className="bg-transparent font-semibold text-foreground" key={part.start}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

function ThreadContentMatch(props: {
  match: NonNullable<CommandPaletteActionItem["threadContentMatch"]>;
}) {
  const isUser = props.match.source === "user";
  return (
    <span className="truncate text-xs text-muted-foreground/85">
      <span className={isUser ? "text-blue-400" : "text-emerald-400"}>
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      <HighlightedSearchText text={props.match.snippet} query={props.match.query} />
    </span>
  );
}
function getVirtualizedScrollFadeClassName({ top, bottom }: { top: boolean; bottom: boolean }) {
  if (!top && !bottom) return undefined;
  return cn(
    "virtualized-scroll-fade [--fade-size:1.5rem]",
    top &&
      bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,transparent,black_var(--fade-size),black_calc(100%-var(--fade-size)),transparent)]",
    top &&
      !bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,transparent,black_var(--fade-size))]",
    !top &&
      bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,black_calc(100%-var(--fade-size)),transparent)]",
  );
}

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

function CommandPaletteEmptyState(props: { emptyStateMessage?: string; isActionsOnly: boolean }) {
  return (
    <div className="py-10 text-center text-sm text-muted-foreground">
      {props.emptyStateMessage ??
        (props.isActionsOnly
          ? "No matching actions."
          : "No matching commands, projects, or threads.")}
    </div>
  );
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    return <CommandPaletteEmptyState {...props} />;
  }

  return (
    <CommandList>
      {props.groups.map((group) => (
        <CommandGroup items={group.items} key={group.value}>
          {group.label ? (
            <CommandGroupLabel className="ps-[9px]">{group.label}</CommandGroupLabel>
          ) : null}
          <CommandCollection>
            {(item) =>
              item.disabled ? (
                <DisabledCommandPaletteResultRow item={item} key={item.value} />
              ) : (
                <CommandPaletteResultRow
                  item={item}
                  key={item.value}
                  keybindings={props.keybindings}
                  isActive={props.highlightedItemValue === item.value}
                  onExecuteItem={props.onExecuteItem}
                />
              )
            }
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

/**
 * Scrolls a keyboard highlight into view the way the unvirtualized list did:
 * nearest edge, clear of the scroll fade. Rows outside the rendered window
 * fall back to the list's own scrolling.
 */
export function scrollCommandPaletteRowIntoView(list: LegendListRef | null, rowIndex: number) {
  const element = list?.getState?.().elementAtIndex(rowIndex);
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: "nearest" });
    return;
  }
  void list?.scrollIndexIntoView?.({ index: rowIndex, animated: false });
}

interface CommandPaletteVirtualizedResultsProps extends Omit<CommandPaletteResultsProps, "groups"> {
  rows: ReadonlyArray<CommandPaletteRow>;
  listRef: RefObject<LegendListRef | null>;
}

/**
 * Renders only the visible rows. The parent passes the flat item order to the
 * Command root as `items` with `virtualized`, scrolls keyboard highlights into
 * view through `listRef`, and runs Enter itself since the row may be unmounted.
 */
export function CommandPaletteVirtualizedResults(props: CommandPaletteVirtualizedResultsProps) {
  const { listRef } = props;
  const [scrollFade, setScrollFade] = useState({ top: false, bottom: false });
  const updateScrollFade = useCallback(() => {
    const scrollElement = listRef.current?.getScrollableNode?.();
    if (!(scrollElement instanceof HTMLElement)) return;
    const top = scrollElement.scrollTop > 1;
    const bottom =
      scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop > 1;
    setScrollFade((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom },
    );
  }, [listRef]);

  if (props.rows.length === 0) {
    return <CommandPaletteEmptyState {...props} />;
  }

  return (
    <CommandListVirtualized>
      <LegendList<CommandPaletteRow>
        ref={listRef}
        data={props.rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        extraData={props.highlightedItemValue}
        renderItem={({ item: row }) =>
          row.kind === "label" ? (
            <div className={row.first ? undefined : "pt-1.5"}>
              <CommandListHeading>{row.label}</CommandListHeading>
            </div>
          ) : row.itemIndex === null ? (
            <DisabledCommandPaletteResultRow item={row.item} />
          ) : (
            <CommandPaletteResultRow
              index={row.itemIndex}
              item={row.item}
              keybindings={props.keybindings}
              isActive={props.highlightedItemValue === row.item.value}
              onExecuteItem={props.onExecuteItem}
            />
          )
        }
        estimatedItemSize={40}
        drawDistance={400}
        onLayout={updateScrollFade}
        onScroll={updateScrollFade}
        contentContainerClassName="px-2"
        className={cn(
          "min-h-0 scroll-py-6 overflow-x-hidden overscroll-y-contain py-2",
          getVirtualizedScrollFadeClassName(scrollFade),
        )}
      />
    </CommandListVirtualized>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-base opacity-64 sm:min-h-7 sm:text-sm">
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadContentMatch match={props.item.threadContentMatch} />
          ) : null}
          {props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-xs">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  index?: number;
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      {...(props.index === undefined ? {} : { index: props.index })}
      value={props.item.value}
      className={cn(
        "cursor-pointer gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit data-selected:bg-transparent data-selected:text-inherit [&[data-highlighted][data-selected]]:bg-transparent [&[data-highlighted][data-selected]]:text-inherit",
        props.isActive && "bg-accent! text-accent-foreground!",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadContentMatch match={props.item.threadContentMatch} />
          ) : null}
          {props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-xs">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
    </CommandItem>
  );
}
